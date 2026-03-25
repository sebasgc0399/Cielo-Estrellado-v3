# Auditoria: Atomicidad de Transacciones

**Fecha:** 2026-03-25
**Alcance:** `functions/src/handlers/shop.ts`, `functions/src/handlers/economy.ts`, `functions/src/handlers/payments.ts`, `functions/src/handlers/stars.ts`, `functions/src/handlers/userSync.ts`, `functions/src/handlers/invitePublic.ts`, `functions/src/lib/acceptInvite.ts`
**Severidad general:** Media

## Resumen ejecutivo

El uso de `db.runTransaction()` es consistente en las operaciones criticas de la economia. La proteccion contra doble-gasto es efectiva. Sin embargo, se identifican **1 hallazgo critico** y **2 medios** relacionados con la separacion entre creacion de recursos y recompensas, y audit logs fuera de transacciones de forma sistematica.

---

## Hallazgos

### [CRITICO] C1 — `createStar`: la estrella se crea FUERA de la transaccion de recompensa

- **Archivo:** `functions/src/handlers/stars.ts:118-167`
- **Descripcion:** La creacion de la estrella y la transaccion de recompensa son operaciones independientes:
  1. **Linea 118-124:** Query para verificar si es la primera estrella del usuario (`isFirstStar`) — fuera de transaccion
  2. **Linea 126:** `starRef.set(starData)` — crea la estrella, fuera de transaccion
  3. **Linea 131-167:** `runTransaction` para acreditar recompensa — lee `createdStarsToday` y acredita PE

  El problema es que `isFirstStar` se calcula ANTES de la transaccion. Si dos requests de `createStar` llegan simultaneamente:
  - Ambas ven `existingStarsSnap.empty === true`
  - Ambas crean una estrella
  - Ambas entran a la transaccion con `isFirstStar === true`
  - Ambas acreditan `FIRST_STAR_BONUS` (duplicando la recompensa)

  Ademas, `createdStarsToday` se lee en la transaccion pero las dos transacciones no contencionan entre si si el `userRef.update` no genera conflicto de retry.

- **Impacto:** Un usuario puede obtener `FIRST_STAR_BONUS` multiples veces enviando requests paralelos. El `createdStarsToday` puede no incrementarse correctamente si dos transacciones leen el mismo valor.
- **Recomendacion:** Mover el check de `isFirstStar` DENTRO de la transaccion:
  ```typescript
  const rewardResult = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    // ... validaciones de usuario ...

    // Verificar primera estrella dentro de la transaccion
    // Nota: Firestore transactions soportan reads de otras colecciones
    const existingStarsSnap = await transaction.get(
      db.collection('skies').doc(skyId).collection('stars')
        .where('authorUserId', '==', decoded.uid)
        .where('deletedAt', '==', null)
        .limit(1)
    )
    const isFirstStar = existingStarsSnap.empty

    // ... calcular y acreditar recompensa ...
  })
  ```
  Alternativamente, si mover la query de stars dentro de la transaccion es costoso, usar un campo `firstStarClaimed: boolean` en el `UserRecord` como flag idempotente.

---

### [MEDIO] M1 — Patron sistematico: audit logs fuera de transacciones

- **Archivo:** Multiples handlers
- **Descripcion:** El patron de escribir `TransactionRecord` (audit log) fuera del `runTransaction` es consistente en todo el codebase:
  - `payments.ts:223-232` — log de pago aprobado
  - `shop.ts:80-89` — log de compra
  - `economy.ts:147-191` — logs de daily/weekly/streak rewards
  - `stars.ts:169-189` — logs de recompensa por creacion
  - `invitePublic.ts:112-123` — log de recompensa por aceptar invite

  En todos los casos, si la funcion crashea entre el commit de la transaccion y la escritura del log, el balance cambia pero no queda registro.

- **Impacto:** Inconsistencia en el historial de transacciones. El balance es correcto (se actualizo en la transaccion), pero el log no refleja el cambio. En `economy.ts`, los logs se escriben con `try/catch` que silencia el error (linea 187-191), lo cual es una mitigacion parcial pero no una solucion.
- **Recomendacion:** Hay dos approaches:
  1. **Mover logs dentro de la transaccion** (recomendado para shop y payments donde hay un solo log). Firestore soporta hasta 500 writes por transaccion.
  2. **Para economy.ts** donde puede haber 3 logs simultaneos (daily + weekly + streak): considerar un solo `TransactionRecord` con un array de rewards en vez de multiples documentos, para poder incluirlo en la transaccion sin complicar la logica.

### [MEDIO] M2 — Shop purchase: doble compra de `sky-slot` es posible

- **Archivo:** `functions/src/handlers/shop.ts:55-57`
- **Descripcion:** La validacion de `already_owned` solo aplica a items de tipo `theme`:
  ```typescript
  if (item.category === 'theme' && ownedItemIds.has(item.itemId)) {
    throw new ShopError('already_owned', 'Ya posees este item')
  }
  ```
  Para `sky-slot`, no hay check de duplicado — lo cual es intencional (se pueden comprar multiples slots). Sin embargo, dos requests simultaneos de `sky-slot` podrian leer el mismo `maxSkies` e incrementar ambos a `maxSkies + 1` en vez de `maxSkies + 2`.

  **Analisis:** Esto NO es un problema real porque ambos reads ocurren dentro del mismo `runTransaction`. Si dos transacciones contientan en el mismo `userRef`, Firestore reintenta la que pierde. La segunda transaccion leera el `maxSkies` actualizado por la primera.

- **Impacto:** Sin impacto real. Firestore transactions protegen contra esto. Sin embargo, la race condition en `stardust` es la misma — y tambien esta protegida.
- **Recomendacion:** Documentar como "verificado seguro" en el codigo. Agregar un test que simule contencion de transacciones (dificil con mocks, pero documentable).

---

### [BAJO] B1 — `getEconomy` usa variables mutables fuera del closure de transaccion

- **Archivo:** `functions/src/handlers/economy.ts:39-49`
- **Descripcion:** Las variables `rewardsDaily`, `rewardsWeekly`, `rewardsStreak` y `streakDays` se declaran fuera de `runTransaction` y se mutan dentro. El comentario en linea 45-46 indica que se resetean al inicio de cada retry, lo cual es correcto. Sin embargo, el patron es fragil — si se agregara logica entre la declaracion y el `runTransaction`, los valores podrian quedar stale.
- **Impacto:** Bajo. El codigo actual es correcto. El riesgo es de mantenibilidad futura.
- **Recomendacion:** Retornar estos valores como parte del resultado de la transaccion en vez de mutarlos externamente:
  ```typescript
  const result = await db.runTransaction(async (transaction) => {
    // ... logica ...
    return {
      stardust: newStardust,
      loginStreak: newStreak,
      // ... incluir rewardsDaily, rewardsWeekly, etc ...
    }
  })
  ```

### [BAJO] B2 — `acceptInvite` es atomico pero la recompensa no esta en la misma transaccion

- **Archivo:** `functions/src/lib/acceptInvite.ts:16-66`, `functions/src/handlers/invitePublic.ts:84-123`
- **Descripcion:** `acceptInvite()` es una transaccion que atomicamente:
  - Valida la invitacion (status, expiracion)
  - Crea el `MemberRecord`
  - Marca la invitacion como aceptada

  La recompensa de PE por aceptar se maneja en una transaccion SEPARADA en `invitePublic.ts:85-110`. Esto es correcto porque son operaciones sobre documentos diferentes (invite + member vs user), pero significa que si la segunda transaccion falla, el usuario acepta la invite sin recibir PE.

- **Impacto:** Bajo. La recompensa esta en un `try/catch` no-bloqueante (linea 124-126). El usuario pierde PE pero la invitacion funciona. Es un trade-off aceptable.
- **Recomendacion:** Documentar este trade-off. Opcionalmente, combinar ambas transacciones si Firestore permite reads de multiples colecciones en la misma transaccion (si, lo permite).

---

## Mapa de atomicidad

| Operacion | Transaccion? | Dentro de txn | Fuera de txn | Race condition? |
|-----------|-------------|---------------|--------------|-----------------|
| **Shop purchase** | `runTransaction` | debito + inventario + maxSkies | audit log | Protegido por retry |
| **Daily reward** | `runTransaction` | stardust + streak + counters | 1-3 audit logs | Protegido por retry |
| **Payment webhook** | `runTransaction` | stardust + payment status | audit log | Protegido por retry |
| **Star creation** | Separado | estrella: `set()` sola; reward: `runTransaction` | audit logs | **isFirstStar vulnerable** |
| **Accept invite** | `runTransaction` (x2) | invite+member atomico; reward separado | audit log | Protegido (2 txns independientes) |
| **User sync (nuevo)** | `batch.commit()` | user + welcome tx | ninguno | **Vulnerable a doble-create** |
| **User sync (existente)** | `runTransaction` | economia initial | ninguno | Protegido por retry |

---

## Aspectos positivos

1. **`runTransaction` usado consistentemente** para operaciones que tocan balance de PE.
2. **Doble-gasto prevenido:** En shop, economy y payments, el balance se lee dentro de la transaccion con `transaction.get()`, no fuera.
3. **Retry semantics correctos:** En `economy.ts`, las variables de reward se resetean al inicio de cada retry (linea 45-49). Esto previene acumulacion de rewards en reintentos.
4. **Idempotencia en payments:** El check `paymentData.status !== 'pending'` previene doble acreditacion de PE por webhook.
5. **Validacion de ownership en shop:** Temas no se pueden comprar dos veces (`already_owned` check dentro de la transaccion).
6. **`acceptInvite` completamente atomico:** La creacion de membresia + marca de invitacion aceptada es una sola transaccion.
7. **Balance negativo prevenido:** `stardust < item.price` se verifica DENTRO de la transaccion en shop.ts.
8. **Limites diarios atomicos:** `createdStarsToday` y `acceptedInvitesToday` se leen y actualizan dentro de transacciones.

---

## Conclusion

La atomicidad es solida en las operaciones de economia core. El hallazgo critico (C1) es explotable para duplicar `FIRST_STAR_BONUS` mediante requests paralelos. El patron de audit logs fuera de transacciones (M1) es sistematico y deberia resolverse al menos en los flujos de pago y compras. Los demas hallazgos son mejoras de robustez con impacto limitado.

### Proximos pasos recomendados (por prioridad):
1. **Mover `isFirstStar` check dentro de la transaccion en `createStar`** (C1) — fix critico
2. **Mover audit logs dentro de transacciones** al menos en `shop.ts` y `payments.ts` (M1)
3. Documentar trade-off de recompensa separada en `acceptInvite` (B2)
4. Refactorizar variables mutables en `getEconomy` (B1) — mejora de mantenibilidad
