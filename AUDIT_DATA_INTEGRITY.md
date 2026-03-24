# Auditoría de Integridad de Datos — Firestore

**Fecha:** 2026-03-24
**Scope:** Todos los handlers en `functions/src/handlers/` que escriben a Firestore
**Arquitectura:** Cloud Functions v2 gen2 como única vía de escritura. Cliente solo lee con `onSnapshot`.

---

## Resumen ejecutivo

| Severidad | Cantidad |
|-----------|----------|
| Crítico   | 4        |
| Medio     | 4        |
| Bajo      | 3        |

**Estado general:** La mayoría de operaciones económicas (compras, rewards diarios, streaks) usan transacciones correctamente. Los problemas principales son: (1) defaults inconsistentes entre handlers para los mismos campos, (2) race conditions en verificaciones de límites que ocurren fuera de transacciones, (3) writes no atómicos en userSync.ts para creación de usuario y migración.

---

## Tabla comparativa de defaults por campo y handler

| Campo | userSync.ts (nuevo) | userSync.ts (migración) | economy.ts | shop.ts | skies.ts | stars.ts | invitePublic.ts | Consistente |
|-------|---------------------|------------------------|------------|---------|----------|----------|-----------------|-------------|
| `stardust` | 100 (WELCOME_BONUS) | 100 (WELCOME_BONUS) | **100** (L57) | **0** (L43) | — | **0** (L138) | **0** (L92) | **NO** |
| `maxSkies` | 2 (L94) | Math.max(2, ownerSnap.size) (L62) | — | **3** (L62) | **2** (L87) | — | — | **NO** |
| `maxMemberships` | 20 (L95) | 20 (L63) | — | — | — | — | 20 (L66) | Sí |
| `loginStreak` | 0 (L97) | 0 (L65) | 0 (L58) | — | — | — | — | Sí |
| `previousStreak` | 0 (L98) | 0 (L66) | 0 (L59) | — | — | — | — | Sí |
| `createdStarsToday` | 0 (L99) | 0 (L67) | — | — | — | 0 (L136) | — | Sí |
| `acceptedInvitesToday` | 0 (L102) | 0 (L70) | — | — | — | — | 0 (L90) | Sí |

---

## Hallazgos por área

---

### 1. Transacciones y atomicidad

#### [CRÍTICO] H-01: userSync.ts — Creación de usuario NO atómica
- **Archivo:** `functions/src/handlers/userSync.ts:106-107`
- **Descripción:** La creación de un usuario nuevo hace dos writes separados: `userRef.set(newUser)` (L106) y `userRef.collection('transactions').add(welcomeTx)` (L107). Si el servidor falla entre ambas, el usuario existe con balance de 100 stardust pero sin registro en el audit log.
- **Escenario:** Crash o timeout entre las dos operaciones. El usuario ve 100 stardust sin transacción de bienvenida registrada. Inconsistencia en auditoría.
- **Fix sugerido:** Envolver ambos writes en `db.batch()`:
  ```typescript
  const batch = db.batch()
  batch.set(userRef, newUser)
  batch.create(userRef.collection('transactions').doc(), welcomeTx)
  await batch.commit()
  ```

#### [CRÍTICO] H-02: userSync.ts — Transaction log de migración fuera de transacción
- **Archivo:** `functions/src/handlers/userSync.ts:79-80`
- **Descripción:** La migración de usuario legacy se hace en transacción (L48-77), pero el log de transacción de bienvenida se escribe FUERA de ella (L80). Si la transacción de migración tuvo éxito pero el log falla, el balance de 100 stardust otorgado no tiene audit trail.
- **Escenario:** Usuario legacy entra por primera vez, se le otorgan 100 stardust (atómico), pero el `transactions.add()` falla. Balance sin evidencia.
- **Fix sugerido:** Mover el `transactions.add()` dentro de la transacción de migración:
  ```typescript
  // Dentro del runTransaction, después del update:
  if (freshData.stardust === undefined) {
    transaction.update(userRef, { ... })
    transaction.create(userRef.collection('transactions').doc(), welcomeTx)
    migrated = true
  }
  ```

#### [TODO BIEN] shop.ts — Compras atómicas
- `purchase()` (L36-77): `db.runTransaction()` que lee balance, verifica fondos, debita stardust, incrementa maxSkies (si sky-slot), y crea inventory item. Todo en una sola transacción. El audit log (L80-88) se escribe fuera, lo cual es aceptable (append-only, no crítico).

#### [TODO BIEN] economy.ts — Rewards diarios atómicos
- `getEconomy()` (L42-138): Toda la lógica de daily login, streak, weekly bonus dentro de `db.runTransaction()`. Correctamente resetea variables de reward al inicio de cada intento (L43-47) para prevenir valores stale en retries.

#### [TODO BIEN] acceptInvite.ts — Aceptación de invitación atómica
- `acceptInvite()` (L16-65): Lectura de invite + verificación de estado + creación de member + update de invite, todo en una transacción.

#### [TODO BIEN] skies.ts — createSky usa batch
- `createSky()` (L127-130): Sky + owner member creados en `db.batch()`.

#### [TODO BIEN] skies.ts — deleteSky con cascada completa
- `deleteSky()` (L266-301): Elimina stars, members, revoca invites pendientes, y elimina el sky. Procesado en batches de 500.

#### [TODO BIEN] members.ts — leaveSky en transacción
- `leaveSky()` (L168-183): Lee y actualiza member en `db.runTransaction()`.

---

### 2. Documentos huérfanos y cascadas de borrado

#### [TODO BIEN] deleteSky cascada completa
- **Archivo:** `functions/src/handlers/skies.ts:266-301`
- Stars: eliminados (L279)
- Members: eliminados (L282)
- Invites pendientes: marcados como 'revoked' (L285)
- Sky doc: eliminado último (L288)
- Sin subcolecciones huérfanas.

#### [BAJO] H-03: Borrado de miembro no limpia estrellas del autor
- **Archivo:** `functions/src/handlers/members.ts:140` (revoke) y `members.ts:182` (leave)
- **Descripción:** Cuando un miembro es revocado o abandona un cielo, sus estrellas permanecen visibles con `authorUserId` apuntando al miembro revocado. No es un bug técnico si es intencional (las estrellas son contenido del cielo, no del miembro), pero no está documentado.
- **Escenario:** Owner revoca a un editor. Las estrellas del editor siguen visibles. Si la UI muestra "creado por X", X aparece como miembro inactivo.
- **Fix sugerido:** Decisión de producto: documentar que estrellas persisten, o agregar soft-delete cascada.

#### [BAJO] H-04: MemberStatus 'pending' nunca se escribe
- **Archivo:** `functions/src/domain/contracts.ts:8`
- **Descripción:** `MemberStatus = 'active' | 'revoked' | 'pending'`. Ningún handler escribe `status: 'pending'`. Los miembros se crean directamente como `active` y solo transicionan a `revoked`. El valor 'pending' es muerto.
- **Fix sugerido:** Eliminar 'pending' del tipo si no hay plan de usarlo.

---

### 3. Race conditions en operaciones read-then-write

#### [CRÍTICO] H-05: createSky — Límite de cielos sin transacción
- **Archivo:** `functions/src/handlers/skies.ts:85-130`
- **Descripción:** La verificación de límite de cielos ocurre en 3 pasos NO atómicos:
  1. L85-87: Lee `maxSkies` del usuario (fuera de transacción)
  2. L89-93: Cuenta cielos del usuario via collectionGroup (fuera de transacción)
  3. L95: Compara `ownerSnap.size >= maxSkies`
  4. L127-130: Crea sky + member en batch (atómico, pero no incluye las lecturas)
- **Escenario:** Usuario con maxSkies=2 y 1 cielo envía 2 requests simultáneos. Ambos leen `ownerSnap.size=1`, ambos pasan el check `1 < 2`, ambos crean un cielo. Resultado: 3 cielos con límite de 2.
- **Fix sugerido:** Las queries `collectionGroup` no pueden ejecutarse dentro de transacciones Firestore. La solución más robusta es mantener un campo `ownedSkiesCount` en el user doc y verificar/incrementar atómicamente dentro de una transacción.

#### [CRÍTICO] H-06: acceptInviteHandler — Límite de membresías sin transacción
- **Archivo:** `functions/src/handlers/invitePublic.ts:64-77`
- **Descripción:** La verificación de `maxMemberships` ocurre fuera de cualquier transacción:
  1. L64-66: Lee `maxMemberships` del usuario
  2. L68-72: Cuenta membresías activas (editor/viewer) via collectionGroup
  3. L74: Compara
  4. L79: Llama `acceptInvite()` que tiene su propia transacción (pero no re-verifica el límite)
- **Escenario:** Usuario con maxMemberships=20 y 19 membresías acepta 2 invitaciones simultáneamente. Ambas pasan el check `19 < 20`, ambas crean member. Resultado: 21 membresías con límite de 20.
- **Fix sugerido:** Mantener un campo `activeMembershipsCount` en el user doc y verificar dentro de la transacción de `acceptInvite()`.

#### [MEDIO] H-07: createStar — Bonus de primera estrella duplicable
- **Archivo:** `functions/src/handlers/stars.ts:117-123, 151`
- **Descripción:** `isFirstStar` se calcula en L117-123 fuera de la transacción de reward (L130-166). La variable se captura antes de crear la estrella y antes de la transacción.
- **Escenario:** Usuario crea 2 estrellas simultáneamente en un cielo donde nunca había creado. Ambas queries retornan `empty=true`. Ambas transacciones otorgan `FIRST_STAR_BONUS` (25 stardust). Ganancia indebida: 25 stardust.
- **Fix sugerido:** Mover la verificación de `isFirstStar` dentro de la transacción, o agregar un flag `hasCreatedFirstStar` en el user doc que se setea atómicamente.

#### [MEDIO] H-08: userSync.ts — Update de perfil + transacción de migración no atómicos
- **Archivo:** `functions/src/handlers/userSync.ts:37-77`
- **Descripción:** Primero actualiza campos de perfil (L37-44) con `userRef.update()` standalone, luego ejecuta transacción de migración (L48-77). El update de L37 no está en la transacción.
- **Escenario:** Bajo riesgo práctico ya que los campos de perfil (email, displayName) y los campos de economía (stardust, maxSkies) son independientes. El riesgo real es mínimo.
- **Fix sugerido:** Bajo prioridad. Podría unificarse, pero la separación actual es funcionalmente correcta.

---

### 4. Defaults inconsistentes entre handlers

#### [CRÍTICO] H-09: stardust default 100 vs 0
- **Archivos:**
  - `functions/src/handlers/economy.ts:57` → default **100**
  - `functions/src/handlers/shop.ts:43` → default **0**
  - `functions/src/handlers/stars.ts:138` → default **0**
  - `functions/src/handlers/invitePublic.ts:92` → default **0**
- **Descripción:** Cuando `stardust` es `undefined`, economy.ts trata al usuario como si tuviera 100, mientras que los demás lo tratan como 0.
- **Escenario:** Usuario con `stardust: undefined` ve 100 stardust en economy, pero shop rechaza compras por "balance insuficiente" (lo ve como 0).
- **Fix sugerido:** Centralizar defaults en un archivo compartido:
  ```typescript
  // functions/src/domain/defaults.ts
  export const DEFAULT_USER_VALUES = {
    stardust: 0,
    maxSkies: 2,
    maxMemberships: 20,
    loginStreak: 0,
    previousStreak: 0,
    createdStarsToday: 0,
    acceptedInvitesToday: 0,
  } as const
  ```
  El default debe ser **0** (no 100), ya que 100 es el WELCOME_BONUS y solo debe otorgarse explícitamente.

#### [MEDIO] H-10: maxSkies default 3 vs 2
- **Archivos:**
  - `functions/src/handlers/shop.ts:62` → default **3**
  - `functions/src/handlers/skies.ts:87` → default **2**
  - `functions/src/handlers/userSync.ts:94` → escribe **2**
- **Descripción:** Cuando `maxSkies` es `undefined`, shop.ts lo trata como 3, skies.ts como 2.
- **Escenario:** Si compra un sky-slot con maxSkies undefined, shop.ts calcula `3 + 1 = 4` en lugar de `2 + 1 = 3`. El usuario gana 1 slot extra gratis.
- **Fix sugerido:** Usar `DEFAULT_USER_VALUES.maxSkies` (2) en ambos handlers.

---

### 5. Validación de escrituras y rangos

#### [TODO BIEN] Balance nunca se escribe negativo
- shop.ts:45 verifica `stardust < item.price` antes de debitar.
- Los handlers de rewards solo suman al balance, nunca restan.

#### [TODO BIEN] Strings validados por longitud
- Títulos de cielo: `SKY_TITLE_MAX_LENGTH` en skies.ts:80-82
- Títulos de estrella: `STAR_TITLE_MAX_LENGTH` en stars.ts:64-66
- Mensajes de estrella: `STAR_MESSAGE_MAX_LENGTH` en stars.ts:70-71

#### [TODO BIEN] Enums validados
- `density`: validado contra `VALID_DENSITIES` en skies.ts:192
- `role` (member update): validado contra `VALID_ROLES` en members.ts:142
- `themeId`: validado contra SHOP_CATALOG en skies.ts:338

#### [MEDIO] H-11: Invite role — default silencioso en lugar de rechazo
- **Archivo:** `functions/src/handlers/invites.ts:41`
- **Descripción:** `const role: InviteRole = body?.role === 'viewer' ? 'viewer' : 'editor'`. Cualquier valor inválido silenciosamente se convierte en `'editor'`.
- **Escenario:** Cliente envía `{ role: "owner" }`. El servidor crea invitación de editor sin error. Viola el principio de fallar explícitamente.
- **Fix sugerido:**
  ```typescript
  if (body?.role !== undefined && body.role !== 'editor' && body.role !== 'viewer') {
    res.status(400).json({ error: 'Rol debe ser "editor" o "viewer"' })
    return
  }
  const role: InviteRole = body?.role === 'viewer' ? 'viewer' : 'editor'
  ```

#### [TODO BIEN] Campos extra filtrados implícitamente
- Todos los handlers leen solo los campos específicos del body que necesitan. No se hace spread de `req.body` a Firestore.
- skies.ts `updateSky` (L184-189) explícitamente rechaza claves desconocidas en personalization.

#### [TODO BIEN] Inputs sanitizados con trim()
- Todos los strings: `.trim()` antes de validar.

---

### 6. Lecturas sin verificación de existencia

#### [TODO BIEN] stars.ts — .exists verificado antes de .data()
- `updateStar()` L220-225: Verifica `!starSnap.exists` → return 404, luego `.data()`. Correcto.
- `deleteStar()` L373-378: Mismo patrón. Correcto.

#### [TODO BIEN] shop.ts — .exists verificado dentro de transacción
- `purchase()` L38-42: `if (!userSnap.exists) throw` antes de `.data()!`. Correcto.

#### [TODO BIEN] economy.ts — .exists verificado
- `getEconomy()` L51-55: `if (!userSnap.exists) return null` antes de `.data()!`. Correcto.

#### [TODO BIEN] acceptInvite.ts — .exists verificado para invite y member
- L20-21: invite `.exists` check. L40-46: member `.exists` check. Correcto.

#### [BAJO] H-12: userSync.ts — .data()! en transacción sin .exists
- **Archivo:** `functions/src/handlers/userSync.ts:50`
- **Descripción:** Dentro del `runTransaction()`, `freshSnap.data()!` se usa sin verificar `freshSnap.exists`. El código confía en que el documento existe porque la rama de ejecución está dentro de `if (userSnap.exists)` (L26). Sin embargo, una operación concurrente podría eliminar el documento.
- **Escenario:** Extremadamente improbable (no existe handler para borrar usuarios). Si ocurriera, crash manejado por catch genérico (L111-114) retornando 500.
- **Fix sugerido:** Agregar check defensivo:
  ```typescript
  const freshSnap = await transaction.get(userRef)
  if (!freshSnap.exists) return
  const freshData = freshSnap.data()!
  ```

---

### 7. Consistencia entre contratos y datos reales

#### [TODO BIEN] UserRecord — Alineado
- Todos los campos del tipo se escriben en `userSync.ts`. Los handlers que actualizan campos parciales solo tocan campos existentes en el tipo.

#### [TODO BIEN] SkyRecord — Alineado
- `createSky` escribe todos los campos. `coverImagePath` se inicializa como `null` (feature futura, no bug).

#### [TODO BIEN] MemberRecord — Alineado
- `acceptInvite.ts` y `skies.ts` escriben todos los campos.

#### [TODO BIEN] InviteRecord — Alineado

#### [TODO BIEN] TransactionRecord — Alineado

#### [TODO BIEN] InventoryItem — Alineado

#### [MEDIO] H-13: StarRecord.title y .authorUserId son nullable en tipo pero always set
- **Archivo:** `functions/src/domain/contracts.ts:56,62`
- **Descripción:** `title: string | null` y `authorUserId: string | null` permiten null, pero `createStar` siempre requiere título no vacío y siempre setea `authorUserId: decoded.uid`. Ningún code path escribe null.
- **Escenario:** No es bug funcional, pero fuerza null-checks innecesarios en consumidores.
- **Fix sugerido:** Cambiar a `title: string` y `authorUserId: string`. Si hay documentos legacy con null, limpiarlos primero.

---

## Plan de acción priorizado

### P0 — Fix inmediato (riesgo de corrupción de datos)
1. **H-09**: Centralizar defaults en `domain/defaults.ts`, reemplazar en todos los handlers
2. **H-10**: Corregir maxSkies default en shop.ts de 3 a 2
3. **H-05**: Agregar campo `ownedSkiesCount` al user doc, verificar/incrementar atómicamente en createSky
4. **H-06**: Agregar campo `activeMembershipsCount` al user doc, verificar dentro de acceptInvite

### P1 — Fix pronto (inconsistencia de datos menor)
5. **H-01**: Hacer creación de usuario atómica con batch
6. **H-02**: Mover transaction log de migración dentro de la transacción
7. **H-07**: Mover isFirstStar check dentro de la transacción de reward

### P2 — Mejoras de calidad
8. **H-11**: Validar role explícitamente en createInvite
9. **H-12**: Agregar `.exists` check en userSync transaction
10. **H-13**: Ajustar StarRecord types para reflejar non-nullability
11. **H-04**: Eliminar 'pending' de MemberStatus
12. **H-03**: Documentar decisión sobre estrellas de miembros revocados

---

## Archivos críticos a modificar

| Archivo | Hallazgos |
|---------|-----------|
| `functions/src/handlers/userSync.ts` | H-01, H-02, H-08, H-12 |
| `functions/src/handlers/skies.ts` | H-05 |
| `functions/src/handlers/shop.ts` | H-09, H-10 |
| `functions/src/handlers/economy.ts` | H-09 |
| `functions/src/handlers/stars.ts` | H-07, H-09 |
| `functions/src/handlers/invitePublic.ts` | H-06, H-09 |
| `functions/src/handlers/invites.ts` | H-11 |
| `functions/src/domain/contracts.ts` | H-04, H-13 |
| `functions/src/domain/defaults.ts` (nuevo) | H-09, H-10 |
| `functions/src/lib/acceptInvite.ts` | H-06 |
