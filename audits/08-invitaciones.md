# Auditoria: Sistema de Invitaciones

**Fecha:** 2026-03-25
**Alcance:** `functions/src/handlers/invites.ts`, `functions/src/handlers/invitePublic.ts`, `functions/src/lib/createInvite.ts`, `functions/src/lib/acceptInvite.ts`, `functions/src/lib/findInviteIdByToken.ts`, `functions/src/lib/revokeInvite.ts`, `functions/src/handlers/invitePublic.test.ts`
**Severidad general:** Baja

## Resumen ejecutivo

El sistema de invitaciones esta bien implementado con tokens de alta entropia, hash SHA-256 irreversible, validaciones de estado/expiracion, y aceptacion atomica via transaccion. Se identifican **0 criticos**, **1 medio** y **3 bajos** relacionados con falta de limite de invitaciones creadas, sin limpieza de invites expiradas, y un edge case en el flujo preview→accept.

---

## Hallazgos

### [MEDIO] M1 — Sin limite de invitaciones creadas por cielo/owner

- **Archivo:** `functions/src/handlers/invites.ts:22-54`, `functions/src/lib/createInvite.ts`
- **Descripcion:** Un owner puede crear invitaciones sin limite. No hay check de:
  - Cantidad maxima de invites pendientes por cielo
  - Cantidad maxima de invites creadas por dia
  - Cantidad maxima de miembros por cielo

  El handler solo valida que el usuario sea owner, luego crea la invitacion directamente.
- **Impacto:** Un owner malicioso (o un script usando su token) puede generar miles de invitaciones pendientes en Firestore, acumulando documentos innecesarios y potencialmente generando costos de almacenamiento.
- **Recomendacion:** Agregar un limite de invitaciones pendientes por cielo:
  ```typescript
  const pendingSnap = await db.collection('invites')
    .where('skyId', '==', skyId)
    .where('status', '==', 'pending')
    .get()

  if (pendingSnap.size >= MAX_PENDING_INVITES) {
    res.status(400).json({ error: 'Demasiadas invitaciones pendientes' })
    return
  }
  ```
  Considerar tambien un limite de miembros activos por cielo para evitar cielos con miles de miembros.

---

### [BAJO] B1 — Invitaciones expiradas no se limpian de Firestore

- **Archivo:** `functions/src/lib/createInvite.ts:20` (TTL 7 dias), `functions/src/handlers/invites.ts:83`
- **Descripcion:** Las invitaciones tienen un `expiresAt` de 7 dias (`INVITE_TTL_MS`). Cuando expiran:
  - `acceptInvite` las rechaza (check `invite.expiresAt < now`)
  - `previewInvite` las marca como invalidas
  - `listInvites` las filtra (check `new Date(invite.expiresAt) > now`)
  - `revokeInvite` las rechaza (`invite_expired`)

  Sin embargo, el documento permanece en Firestore con status `pending` indefinidamente. No hay job de limpieza ni TTL policy.
- **Impacto:** Bajo. Acumulacion gradual de documentos en la coleccion `invites`. Dado el tamano esperado de la aplicacion, esto no sera un problema por un tiempo largo.
- **Recomendacion:** Dos opciones:
  1. **Firestore TTL policy:** Configurar una TTL policy en la coleccion `invites` basada en `expiresAt` + un margen (ej: 30 dias). Firestore las elimina automaticamente.
  2. **Cloud Function programada:** Un cron job semanal que elimine invites con `expiresAt` < hace 30 dias y status `pending`.

### [BAJO] B2 — `findInviteIdByToken` filtra por status `pending`, pero `acceptInvite` re-valida

- **Archivo:** `functions/src/lib/findInviteIdByToken.ts:9`, `functions/src/lib/acceptInvite.ts:27-35`
- **Descripcion:** `findInviteIdByToken` busca invites con `status == 'pending'`. Si la invite fue revocada o aceptada entre el `find` y el `accept`, `acceptInvite` la rechaza dentro de la transaccion.

  Sin embargo, hay un edge case: si la invite expiro pero no fue marcada como `expired` (porque no hay job de limpieza), `findInviteIdByToken` la encontrara (status sigue siendo `pending`), y `acceptInvite` la rechazara por `expiresAt < now`.

  Esto funciona correctamente, pero genera un read extra a Firestore (el `transaction.get` en `acceptInvite`) para un caso que podria filtrarse antes.
- **Impacto:** Minimo. Un read extra en un caso poco frecuente.
- **Recomendacion:** Opcionalmente agregar un filtro de expiracion en `findInviteIdByToken`:
  ```typescript
  .where('expiresAt', '>', new Date().toISOString())
  ```
  Requeriria un indice compuesto (`tokenHash` + `status` + `expiresAt`).

### [BAJO] B3 — `previewInvite` busca por hash sin filtrar status, `findInviteIdByToken` SI filtra

- **Archivo:** `functions/src/handlers/invitePublic.ts:17-22` vs `functions/src/lib/findInviteIdByToken.ts:6-11`
- **Descripcion:** Los dos flujos buscan invites por tokenHash de forma diferente:
  - **`previewInvite`:** Busca por `tokenHash` sin filtrar por status (linea 20-23). Luego valida el status manualmente (linea 33).
  - **`findInviteIdByToken`:** Busca por `tokenHash` + `status == 'pending'` (linea 8-9).

  La diferencia es intencional — preview debe mostrar `{ valid: false }` para invites aceptadas/revocadas, mientras que `findInviteIdByToken` solo necesita encontrar invites aceptables. Pero la inconsistencia podria confundir a un futuro desarrollador.
- **Impacto:** Ninguno. Ambos flujos funcionan correctamente.
- **Recomendacion:** Agregar un comentario en `previewInvite` explicando por que no filtra por status (necesita retornar `valid: false` en vez de 404 para invites usadas/revocadas).

---

## Flujo completo de invitaciones

```
CREAR INVITE (owner):
  1. createInviteHandler → requireOwner(skyId, uid) ✅
  2. createInvite() → randomBytes(32).toString('base64url') → 256 bits entropia ✅
  3. SHA-256 hash → almacena tokenHash, no el token ✅
  4. expiresAt = now + 7 dias ✅
  5. Retorna inviteUrl con token en texto plano (solo al owner) ✅

PREVIEW INVITE (sin auth):
  1. Hash del token de la URL ✅
  2. Busca por tokenHash ✅
  3. Valida: status, expiracion ✅
  4. Retorna: valid, skyTitle, role ✅
  5. NO retorna: owner, miembros, estrellas, tokenHash ✅

ACEPTAR INVITE (con auth):
  1. authenticateRequest → Bearer token ✅
  2. findInviteIdByToken → busca pending por hash ✅
  3. Verifica maxMemberships ✅
  4. acceptInvite (transaccion atomica): ✅
     a. Re-lee invite fresca
     b. Valida status (pending, no revoked, no accepted)
     c. Valida expiracion
     d. Verifica no es ya miembro
     e. Crea MemberRecord
     f. Marca invite como accepted
  5. Acredita INVITE_ACCEPTED_REWARD (transaccion separada) ✅
  6. Respeta MAX_INVITE_REWARDS_PER_DAY ✅

REVOCAR INVITE (owner):
  1. authenticateRequest + requireOwner ✅
  2. revokeInvite (transaccion atomica): ✅
     a. Verifica skyId coincide
     b. Valida status (no accepted, no revoked, no expired)
     c. Marca status = revoked

LISTAR INVITES (owner):
  1. requireOwner ✅
  2. Filtra pending + expiracion > now ✅
  3. Solo retorna: inviteId, role, expiresAt ✅
```

---

## Seguridad del token

| Aspecto | Implementacion | Evaluacion |
|---------|---------------|------------|
| **Generacion** | `randomBytes(32)` = 256 bits | ✅ Entropia criptograficamente segura |
| **Encoding** | `.toString('base64url')` = 43 chars | ✅ URL-safe, sin padding |
| **Almacenamiento** | SHA-256 hash (`tokenHash`) | ✅ Irreversible |
| **Token en texto** | Solo retornado al owner en `inviteUrl` | ✅ Nunca almacenado |
| **Colision** | 2^256 posibilidades → probabilidad negligible | ✅ |
| **Brute force** | 256 bits → imposible computacionalmente | ✅ |
| **Timing attack** | `===` comparison (string) — teoricamente vulnerable | ⚠️ Ver nota |

**Nota sobre timing attack:** La comparacion `tokenHash == tokenHash` en Firestore (`where('tokenHash', '==', ...)`) es una query de base de datos, no una comparacion en memoria. No es vulnerable a timing attacks porque Firestore no expone tiempos de query de forma util para un atacante.

---

## Control de acceso

| Operacion | Quien puede | Validacion | Correcto? |
|-----------|-------------|------------|-----------|
| Crear invite | Owner del cielo | `requireOwner` | ✅ |
| Listar invites | Owner del cielo | `requireOwner` | ✅ |
| Revocar invite | Owner del cielo | `requireOwner` + `skyId` match | ✅ |
| Preview invite | Cualquiera con el token | Sin auth, retorna info minima | ✅ |
| Aceptar invite | Usuario autenticado con el token | Bearer + token + max memberships | ✅ |

---

## Aspectos positivos

1. **Token de 256 bits:** `randomBytes(32)` genera tokens criptograficamente seguros. Imposible de adivinar o bruteforcear.
2. **Hash SHA-256 almacenado:** El token nunca se almacena en texto plano en Firestore. Solo el hash.
3. **Aceptacion atomica:** `acceptInvite` usa `runTransaction` para atomicamente crear el miembro y marcar la invite como aceptada. Previene race conditions.
4. **Revocacion atomica:** `revokeInvite` usa `runTransaction` para prevenir race conditions entre revocacion y aceptacion simultanea.
5. **Validacion completa en accept:** Re-valida status, expiracion y membresia existente dentro de la transaccion con datos frescos.
6. **skyId match en revoke:** Previene que un owner revoque invites de otro cielo (aunque tendria que adivinar el inviteId).
7. **maxMemberships enforced:** Antes de aceptar, verifica que el usuario no exceda su limite de membresias.
8. **Rate limit en rewards:** `MAX_INVITE_REWARDS_PER_DAY = 5` limita cuantas recompensas por aceptar invites se pueden obtener por dia.
9. **Preview seguro:** No expone datos sensibles — solo titulo del cielo y rol. No expone tokenHash, owner, ni miembros.
10. **Expiracion validada:** Tanto en preview como en accept, se verifica que la invite no haya expirado.

---

## Conclusion

El sistema de invitaciones es seguro y bien disenado. El token de 256 bits con hash SHA-256 es criptograficamente solido. La aceptacion y revocacion son atomicas. El hallazgo medio (M1) sobre la falta de limite de invitaciones creadas es una mejora defensiva importante para prevenir abuso. Los hallazgos bajos son mejoras de eficiencia y limpieza.

### Proximos pasos recomendados (por prioridad):
1. Agregar limite de invitaciones pendientes por cielo (M1) — prevenir abuso
2. Configurar TTL policy o cron job para limpiar invites expiradas (B1)
3. Agregar comentario explicativo en `previewInvite` sobre por que no filtra status (B3)
