# Auditoria: Codigo muerto de migracion en userSync

**Fecha:** 2026-03-27
**Alcance:** `functions/src/handlers/userSync.ts:46-75`, `functions/src/handlers/userSync.test.ts`
**Severidad general:** Baja (rendimiento + deuda tecnica)

## Resumen ejecutivo

El handler `userSync` contiene un bloque de migracion de economia (lineas 46-75) que verifica `freshData.stardust === undefined` y agrega campos de economia a usuarios existentes. **Todos los usuarios ya fueron migrados** — este codigo nunca se ejecuta. Sin embargo, en cada login de usuario existente se ejecuta un `runTransaction` + `collectionGroup('members')` query solo para verificar la condicion y no hacer nada. Se recomienda eliminar el bloque completo.

---

## Hallazgos

### [BAJO] H1 — Bloque de migracion es codigo muerto con costo de rendimiento

- **Archivo:** `functions/src/handlers/userSync.ts:46-75`
- **Descripcion:** El path de usuario existente ejecuta una transaccion Firestore que:
  1. Hace un `get` fresco del documento del usuario (read adicional)
  2. Verifica `freshData.stardust === undefined`
  3. Si es `undefined`, ejecuta un `collectionGroup('members')` con 3 filtros + un `update` + un `create`
  4. Si `stardust` ya existe (100% de los casos actuales), no hace nada
- **Impacto:**
  - **Rendimiento:** Cada login de usuario existente paga 1 read adicional (transaccion get) que siempre resulta en noop. El `collectionGroup` query nunca se ejecuta, pero el overhead del `runTransaction` si.
  - **Complejidad:** 30 lineas de codigo muerto que un nuevo desarrollador debe entender y mantener. 3 tests dedicados (~90 lineas) que validan comportamiento que ya no ocurre.
  - **Mocks:** `collectionGroupGet` y `membersQuery` en los tests existen exclusivamente para soportar la migracion.
- **Recomendacion:** Eliminar el bloque completo (lineas 46-75) y los 3 tests asociados.

### [INFO] H2 — El codebase ya es defensivo contra stardust ausente

- **Archivo:** `functions/src/handlers/economy.ts:59`
- **Descripcion:** Los handlers de economia usan `typeof rawData.stardust === 'number' ? rawData.stardust : DEFAULT_USER_ECONOMY.stardust` como fallback. Si un usuario hipotetico no tuviera `stardust`, obtendria 0 en vez de un crash. La migracion en userSync no es la unica proteccion.
- **Impacto:** Ninguno. Confirma que eliminar la migracion no introduce riesgo de crash.

---

## Aspectos positivos

1. **La migracion fue bien implementada en su momento:** Uso de `runTransaction` con fresh read para evitar race conditions. El `collectionGroup` query para calcular `maxSkies` basado en cielos existentes fue una buena decision durante la migracion.
2. **El path de usuario nuevo esta correctamente separado:** Crear un usuario nuevo (lineas 76-105) es independiente de la migracion. Eliminar la migracion no afecta la creacion de nuevos usuarios.
3. **`welcomeTx` sigue siendo necesario:** Se usa tanto en migracion como en creacion de usuario nuevo. Al eliminar la migracion, `welcomeTx` sigue siendo usado por el path de usuario nuevo.

---

## Codigo a eliminar

```typescript
// userSync.ts:46-75 — ELIMINAR COMPLETO
await db.runTransaction(async (transaction) => {
  const freshSnap = await transaction.get(userRef)
  if (!freshSnap.exists) return
  const freshData = freshSnap.data()!

  if (freshData.stardust === undefined) {
    const ownerSnap = await db
      .collectionGroup('members')
      .where('userId', '==', decoded.uid)
      .where('role', '==', 'owner')
      .where('status', '==', 'active')
      .get()

    transaction.update(userRef, {
      stardust: WELCOME_BONUS,
      maxSkies: Math.max(2, ownerSnap.size),
      maxMemberships: 20,
      lastDailyRewardDate: null,
      loginStreak: 0,
      previousStreak: 0,
      createdStarsToday: 0,
      lastStarCreationDate: null,
      weeklyBonusWeek: null,
      acceptedInvitesToday: 0,
      lastInviteAcceptDate: null,
      status: 'active',
    })
    transaction.create(userRef.collection('transactions').doc(), welcomeTx)
  }
})
```

## Tests a eliminar

| Test | Linea | Razon |
|------|-------|-------|
| "migra usuario existente sin stardust" | 122-149 | Valida path de migracion que ya no existe |
| "no migra usuario ya migrado" | 151-167 | Valida skip de migracion que ya no existe |
| "migracion es idempotente" | 169-209 | Valida idempotencia de migracion que ya no existe |

## Mocks a limpiar en tests

- `collectionGroupGet` — solo usado por test de migracion
- `membersQuery` — solo usado por test de migracion
- `db.collectionGroup` mock — solo usado por test de migracion

---

## Conclusion

El bloque de migracion cumplio su proposito y puede ser eliminado con seguridad. No hay usuarios sin `stardust` en produccion, el codebase es defensivo contra el campo ausente, y la eliminacion reduce la complejidad del handler y elimina un read innecesario por login. La unica precondicion es confirmar que no existen documentos de usuario con `stardust === undefined` en produccion.

### Proximos pasos:
1. Verificar en Firestore que no hay usuarios con `stardust === undefined` (query de confirmacion)
2. Eliminar bloque de migracion de `userSync.ts`
3. Eliminar 3 tests y mocks asociados
4. Agregar test de update de perfil para usuario existente (no existia)
