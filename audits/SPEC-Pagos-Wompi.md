# SPEC: Correcciones al Sistema de Pagos Wompi

**Fecha:** 2026-03-25
**Estado:** Pendiente
**Origen:** `audits/01-pagos-wompi.md` (auditoria de seguridad)
**Archivos afectados:**
- `functions/src/handlers/payments.ts` (handler principal)
- `functions/src/handlers/payments.test.ts` (tests)
- `functions/src/domain/contracts.ts` (tipos)
- `functions/src/domain/stardustPackages.ts` (catalogo de paquetes)

## Contexto

Una auditoria de seguridad identifico 6 hallazgos (2 medios, 4 bajos) en el flujo de pagos Wompi. Ninguno es una vulnerabilidad explotable — el sistema ya valida firmas SHA256, usa transacciones atomicas, verifica montos y aisla usuarios correctamente. Sin embargo, los hallazgos representan mejoras defensivas necesarias: rate limiting, logging de seguridad, atomicidad de audit logs, y limpieza de codigo muerto.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 1: Rate limiting en createPayment [M1 — Severidad Media]

### Problema

El endpoint `createPayment` no tiene limite de creacion de pagos por usuario. Un usuario autenticado puede crear miles de `PaymentRecord` con status `pending`, causando abuso de almacenamiento Firestore y generacion masiva de referencias Wompi que nunca se resuelven.

### Archivo y ubicacion

`functions/src/handlers/payments.ts` — insertar entre linea 45 (fin de validacion de `publicKey`) y linea 47 (generacion de referencia).

### Cambios requeridos

**1a. Agregar constante** (despues de los imports, antes de `PaymentError`):

```typescript
const MAX_CONCURRENT_PENDING_PAYMENTS = 5
```

**1b. Agregar query de conteo** (despues de la validacion de `publicKey` en linea 45):

```typescript
const pendingSnap = await db.collection('payments')
  .where('userId', '==', uid)
  .where('status', '==', 'pending')
  .count()
  .get()

if (pendingSnap.data().count >= MAX_CONCURRENT_PENDING_PAYMENTS) {
  res.status(429).json({ error: 'Demasiados pagos pendientes. Intenta mas tarde.' })
  return
}
```

### Indice Firestore requerido

Este query necesita un indice compuesto en la coleccion `payments`:
- **Campos:** `userId` (ASC), `status` (ASC)
- Si no existe, Firestore lanzara un error con un link para crearlo automaticamente en la consola.

### Decisiones de diseno

- **Limite de concurrencia, no hard cap diario.** El rate limit cuenta pagos `pending` sin ventana temporal. Un usuario que completa sus pagos puede crear nuevos — eso es comportamiento legitimo (comprar 3 paquetes diferentes en un dia). Lo que queremos prevenir es el abuso automatizado: un bot acumulando miles de `PaymentRecord` pending que nunca se resuelven. Si se necesitara un hard cap diario en el futuro, se podria agregar un campo `paymentsCreatedToday` en `UserRecord` (mismo patron que `createdStarsToday`), pero para el caso de uso actual la concurrencia es la metrica correcta.
- Se usa `.count().get()` en lugar de `.get()` para evitar transferir documentos completos. Solo necesitamos el conteo.
- Limite de 5 es generoso para uso legitimo (un usuario rara vez tiene mas de 1-2 pagos pendientes simultaneos) pero previene abuso automatizado.
- Sin filtro de `createdAt`, el indice es mas simple: solo `userId` + `status`.

---

## Fix 2: Firma invalida con logging estructurado [M2 — Severidad Media]

### Problema

Cuando la firma del webhook no coincide, se loguea con `console.warn` sin contexto y se retorna `200 OK`. No hay visibilidad de ataques sostenidos de spoofing.

### Codigo actual (`payments.ts:133-137`)

```typescript
if (computedHash !== checksum) {
  console.warn('Webhook signature mismatch')
  res.status(200).json({ message: 'Invalid signature' })
  return
}
```

### Codigo propuesto

```typescript
if (computedHash !== checksum) {
  console.error('SECURITY: Webhook signature mismatch', {
    receivedChecksum: checksum,
    ip: req.ip ?? req.headers['x-forwarded-for'] ?? 'unknown',
    timestamp,
    event,
  })
  res.status(200).json({ message: 'Invalid signature' })
  return
}
```

### Decisiones de diseno

- **Se mantiene 200** para firma invalida. Wompi reintenta **cualquier respuesta diferente a 200** (no solo 5xx). Si se retornara 401, Wompi reintentaria la misma request con firma invalida 3 veces mas durante 24 horas (30min, 3h, 24h), contaminando los logs de seguridad: cada intento de spoofing generaria 4 entradas `SECURITY:` en vez de 1, dificultando distinguir un ataque sostenido de un solo intento reintentado. El 200 le dice a Wompi "recibido, no reintentes", que es lo que queremos para requests con firma invalida.
- **`console.error` en lugar de `console.warn`:** Firmas invalidas son un evento de seguridad, no una advertencia operacional. Cloud Logging puede alertar sobre errores.
- **No se incluye el hash computado** en el log por seguridad — podria facilitar ingenieria inversa del secret si los logs se exponen.
- **Se incluye IP, timestamp y event** para correlacion y deteccion de patrones de ataque.
- **Alerta automatica recomendada:** El prefijo `SECURITY:` permite crear un filtro en Cloud Logging (ej. `textPayload =~ "SECURITY:"`) con una alerta que notifique al equipo si hay firmas invalidas consecutivas. Agregar al checklist post-deploy.

### Nota: signature.properties es dinamico (validado)

La documentacion de Wompi advierte que los valores de `signature.properties` pueden variar entre eventos. El codigo actual (linea 101, 117) ya lee dinamicamente el arreglo `properties` del payload y navega el body por cada path — no tiene propiedades hardcodeadas. Esto es correcto y no requiere cambios.

---

## Fix 3: TransactionRecord dentro de la transaccion atomica [B1 — Severidad Baja]

### Problema

El `TransactionRecord` de auditoria se escribe FUERA del `runTransaction`. Si la funcion crashea despues de la transaccion pero antes del write, el balance se actualiza sin registro en el historial.

### Codigo actual (`payments.ts:198-232`)

```typescript
if (wompiStatus === 'APPROVED') {
  const userRef = db.collection('users').doc(paymentData.userId)

  const newBalance = await db.runTransaction(async (firestoreTransaction) => {
    const userSnap = await firestoreTransaction.get(userRef)
    if (!userSnap.exists) {
      throw new PaymentError('user_not_found', 'Usuario no encontrado')
    }

    const userData = userSnap.data()!
    const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : 0
    const balance = currentStardust + paymentData.stardustAmount

    firestoreTransaction.update(userRef, { stardust: balance })
    firestoreTransaction.update(paymentDocRef, {
      status: 'approved',
      wompiTransactionId,
      paymentMethod: wompiPaymentMethod,
      resolvedAt: nowISO,
    })

    return balance
  })

  // Audit log (append-only, outside transaction) ← RIESGO
  const txRecord: TransactionRecord = {
    type: 'earn',
    amount: paymentData.stardustAmount,
    reason: 'purchase',
    itemId: paymentData.packageId,
    balanceAfter: newBalance,
    createdAt: nowISO,
  }
  await db.collection('users').doc(paymentData.userId).collection('transactions').add(txRecord)
}
```

### Codigo propuesto

```typescript
if (wompiStatus === 'APPROVED') {
  const userRef = db.collection('users').doc(paymentData.userId)

  await db.runTransaction(async (firestoreTransaction) => {
    const userSnap = await firestoreTransaction.get(userRef)
    if (!userSnap.exists) {
      throw new PaymentError('user_not_found', 'Usuario no encontrado')
    }

    const userData = userSnap.data()!
    const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : 0
    const balance = currentStardust + paymentData.stardustAmount

    firestoreTransaction.update(userRef, { stardust: balance })
    firestoreTransaction.update(paymentDocRef, {
      status: 'approved',
      wompiTransactionId,
      paymentMethod: wompiPaymentMethod,
      resolvedAt: nowISO,
    })

    const txRecord: TransactionRecord = {
      type: 'earn',
      amount: paymentData.stardustAmount,
      reason: 'purchase',
      itemId: paymentData.packageId,
      balanceAfter: balance,
      createdAt: nowISO,
    }

    const txDocRef = db.collection('users').doc(paymentData.userId)
      .collection('transactions').doc()
    firestoreTransaction.set(txDocRef, txRecord)
  })
}
```

### Cambios clave

1. **`newBalance` eliminado** — ya no se necesita fuera de la transaccion. Se usa `balance` directamente dentro del callback.
2. **`firestoreTransaction.set()` en vez de `.add()`** — Firestore transactions no soportan `.add()` directamente. Se genera una referencia con `.doc()` (sin argumento = auto-ID) y luego `.set()`.
3. **3 operaciones en la transaccion** — `update` user, `update` payment, `set` transaction. Muy por debajo del limite de 500 de Firestore.
4. **Atomicidad total** — Si cualquier operacion falla, NINGUNA se aplica. El balance, el status del pago y el audit log son consistentes o no existen.

---

## Fix 4: Validacion del tipo de evento [B2 — Severidad Baja]

### Problema

Se extrae `event` del body del webhook pero nunca se valida. El webhook procesa cualquier tipo de evento de Wompi que pase la firma.

### Archivo y ubicacion

`functions/src/handlers/payments.ts` — agregar despues de linea 137 (despues del bloque de validacion de firma, antes de la extraccion de datos de la transaccion).

### Codigo a agregar

```typescript
if (event !== 'transaction.updated') {
  res.status(200).json({ message: 'Event type not processed' })
  return
}
```

### Decisiones de diseno

- **Retorna 200** porque un evento no soportado no es un error — simplemente no lo procesamos. No queremos que Wompi reintente.
- **Se ubica DESPUES de la validacion de firma** para no revelar a requests no autenticados que tipos de eventos procesa el sistema.
- **Solo procesamos `transaction.updated`** que es el evento que Wompi envia cuando una transaccion cambia de estado.

---

## Fix 5: WOMPI_EVENTS_SECRET ausente retorna 500 [B3 — Severidad Baja]

### Problema

Si `WOMPI_EVENTS_SECRET` no esta configurado, el webhook retorna `200` con `"Configuration error"`. Esto significa que Wompi NO reintentara, y todos los pagos aprobados nunca se acreditaran. El error puede pasar desapercibido.

### Codigo actual (`payments.ts:109-114`)

```typescript
const eventsSecret = process.env.WOMPI_EVENTS_SECRET
if (!eventsSecret) {
  console.error('WOMPI_EVENTS_SECRET not configured')
  res.status(200).json({ message: 'Configuration error' })
  return
}
```

### Codigo propuesto

```typescript
const eventsSecret = process.env.WOMPI_EVENTS_SECRET
if (!eventsSecret) {
  console.error('CRITICAL: WOMPI_EVENTS_SECRET not configured — webhook cannot process payments')
  res.status(500).json({ message: 'Configuration error' })
  return
}
```

### Decisiones de diseno

- **500 en lugar de 200:** Wompi reintenta **cualquier respuesta diferente a 200** (documentacion oficial: maximo 3 reintentos en 24h — a los 30min, 3h y 24h). Un secret faltante es un problema de infraestructura temporal que se resolvera al configurar/desplegar correctamente. Retornar 500 (semantica HTTP correcta para error de servidor) activa los reintentos de Wompi, dando una ventana de 24 horas para restaurar la configuracion antes de perder webhooks definitivamente.
- **Nota importante:** Este `return` ocurre ANTES del `try` principal de procesamiento. El bloque `catch` general (linea 248-252) que retorna 200 en errores internos NO cubre este caso — eso es correcto, porque un error de infraestructura es diferente a un error de logica.
- **Mensaje mejorado** en el log para que sea mas facil de identificar en Cloud Logging.
- **Riesgo de acumulacion de webhooks:** Si el secret se borra accidentalmente en produccion, Wompi reintentara cada webhook hasta 3 veces durante 24 horas (30min, 3h, 24h). Al restaurar el secret, los webhooks acumulados se procesaran. Esto NO es un problema porque el procesamiento es **idempotente por diseno**: el check `paymentData.status !== 'pending'` (linea 191) descarta webhooks duplicados sin efectos secundarios. El test existente "es idempotente — no procesa pago ya resuelto" (linea 364 del test file) valida este escenario exacto con un pago en status `approved`.

---

## Fix 6: Remover UID de referencia [B4 — Severidad Baja]

### Problema

La referencia de pago incluye los primeros 8 caracteres del UID de Firebase, exponiendo parcialmente un identificador interno en Wompi y en logs.

### Codigo actual (`payments.ts:47`)

```typescript
const reference = `ce-${uid.slice(0, 8)}-${Date.now()}-${randomBytes(4).toString('hex')}`
```

### Codigo propuesto

```typescript
const reference = `ce-${Date.now()}-${randomBytes(8).toString('hex')}`
```

### Cambios clave

- Se eliminan los primeros 8 chars del UID.
- Se duplican los bytes aleatorios de 4 a 8 (16 hex chars) para compensar la entropia perdida.
- Formato anterior: `ce-a1b2c3d4-1711234567890-ab12cd34` (38 chars)
- Formato nuevo: `ce-1711234567890-ab12cd34ef56gh78` (36 chars)

### Compatibilidad con pagos existentes

**Verificado:** La referencia se usa como **identificador opaco** en todo el sistema. Ningun codigo parsea la referencia para extraer el UID — todos los lookups son por query (`where('wompiReference', '==', value)`). No hay `reference.split()`, `reference.slice()`, ni regex de extraccion. Pagos existentes en Firestore con el formato anterior siguen siendo validos porque el webhook busca por igualdad exacta, no por patron. El cambio de formato solo afecta pagos NUEVOS.

---

## Fix 7: Remover bonusPercent del backend [BONUS]

### Problema

`bonusPercent` esta definido en `StardustPackage` y presente en todos los paquetes del backend, pero NUNCA se usa en la logica de pagos. Es codigo muerto que crea confusion.

### Hallazgo importante

El frontend SI usa `bonusPercent` en `frontend/src/components/shop/PackageCard.tsx:146,154` para mostrar un badge de "+X%". El frontend tiene su PROPIA copia independiente de los tipos y datos en `frontend/src/domain/`.

### Cambios requeridos

**7a. `functions/src/domain/contracts.ts:121-127`** — Remover `bonusPercent` del tipo:

```typescript
// ANTES:
export interface StardustPackage {
  packageId: string
  name: string
  stardustAmount: number
  priceInCents: number
  bonusPercent: number      // ← ELIMINAR
}

// DESPUES:
export interface StardustPackage {
  packageId: string
  name: string
  stardustAmount: number
  priceInCents: number
}
```

**7b. `functions/src/domain/stardustPackages.ts`** — Remover `bonusPercent` de cada entrada:

```typescript
// ANTES:
{ packageId: 'pack-500', name: 'Puñado de Polvo', stardustAmount: 500, priceInCents: 500000, bonusPercent: 0 },

// DESPUES:
{ packageId: 'pack-500', name: 'Puñado de Polvo', stardustAmount: 500, priceInCents: 500000 },
```

Repetir para las 5 entradas.

**7c. NO tocar archivos del frontend** — `frontend/src/domain/contracts.ts` y `frontend/src/domain/stardustPackages.ts` conservan `bonusPercent` porque se usa en la UI.

---

## Plan de tests

### Tests existentes que necesitan modificacion

| # | Test actual | Linea | Cambio requerido |
|---|-------------|-------|------------------|
| 1 | "crea pago exitosamente con packageId valido" | 189 | Actualizar regex de referencia: `/^ce-\d+-[a-f0-9]{16}$/` |
| 2 | "crea TransactionRecord de audit en aprobacion" | 280 | Verificar `transaction.set` en vez de `mocks.add`. Verificar que `mocks.add` NO fue llamado |

### Mocks a agregar/modificar

**En `vi.hoisted()` — agregar `set` al mock de transaction (linea 8-11):**

```typescript
const transaction = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),             // NUEVO: para B1
}
```

**En `vi.hoisted()` — agregar mocks para count query:**

```typescript
const countGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
const countFn = vi.fn().mockReturnValue({ get: countGet })
```

**Agregar `countGet` y `countFn` al return del hoisted (linea 33-37):**

```typescript
return {
  transaction, add, paymentAdd, paymentDocRef,
  paymentsGet, paymentsLimit, paymentsWhere,
  userRef, runTransaction,
  countGet, countFn,          // NUEVO
}
```

**Actualizar `paymentsWhere` en `beforeEach` (linea 168) para soportar `.count()`:**

```typescript
mocks.paymentsWhere.mockReturnValue({
  limit: mocks.paymentsLimit,
  where: mocks.paymentsWhere,
  count: mocks.countFn,
})
```

**Agregar resets en `beforeEach` (despues de linea 169):**

```typescript
mocks.transaction.set.mockReset()
mocks.countGet.mockResolvedValue({ data: () => ({ count: 0 }) })
```

### Nuevos tests a agregar

#### En `describe('createPayment')`:

```typescript
it('rechaza con 429 si el usuario excede el limite de pagos pendientes', async () => {
  mocks.countGet.mockResolvedValue({ data: () => ({ count: 5 }) })

  const res = makeRes()
  await createPayment(makeReq({ packageId: 'pack-500' }), res)

  expect(res.status).toHaveBeenCalledWith(429)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ error: expect.stringContaining('pendientes') }),
  )
  expect(mocks.paymentAdd).not.toHaveBeenCalled()
})

it('permite creacion si pagos pendientes estan bajo el limite', async () => {
  mocks.countGet.mockResolvedValue({ data: () => ({ count: 4 }) })

  const res = makeRes()
  await createPayment(makeReq({ packageId: 'pack-500' }), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(mocks.paymentAdd).toHaveBeenCalled()
})

it('retorna 500 si WOMPI_INTEGRITY_SECRET no esta configurado', async () => {
  delete process.env.WOMPI_INTEGRITY_SECRET

  const res = makeRes()
  await createPayment(makeReq({ packageId: 'pack-500' }), res)

  expect(res.status).toHaveBeenCalledWith(500)
  expect(mocks.paymentAdd).not.toHaveBeenCalled()
})

it('retorna 500 si WOMPI_PUBLIC_KEY no esta configurado', async () => {
  delete process.env.WOMPI_PUBLIC_KEY

  const res = makeRes()
  await createPayment(makeReq({ packageId: 'pack-500' }), res)

  expect(res.status).toHaveBeenCalledWith(500)
  expect(mocks.paymentAdd).not.toHaveBeenCalled()
})
```

#### En `describe('wompiWebhook')`:

```typescript
it('rechaza webhook con amount mismatch sin procesar', async () => {
  setupPendingPayment({ amountInCents: 999999 })

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody()), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Amount mismatch' }),
  )
  expect(mocks.runTransaction).not.toHaveBeenCalled()
})

it('retorna 200 con error cuando usuario no existe en APPROVED', async () => {
  setupPendingPayment()
  mocks.transaction.get.mockResolvedValue({
    exists: false,
    data: () => undefined,
  })

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody()), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Internal error, logged' }),
  )
})

it('retorna 500 si WOMPI_EVENTS_SECRET no esta configurado', async () => {
  delete process.env.WOMPI_EVENTS_SECRET

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody()), res)

  expect(res.status).toHaveBeenCalledWith(500)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Configuration error' }),
  )
})

it('ignora eventos que no son transaction.updated', async () => {
  const body = makeWebhookBody()
  body.event = 'nequi_token.updated'

  const res = makeRes()
  await wompiWebhook(makeReq(body), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Event type not processed' }),
  )
  expect(mocks.paymentsGet).not.toHaveBeenCalled()
})

it('mapea status desconocido a error', async () => {
  const { paymentRef } = setupPendingPayment()

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody({ status: 'UNKNOWN_STATUS' })), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(paymentRef.update).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'error' }),
  )
})

it('es idempotente para pagos ya declinados', async () => {
  setupPendingPayment({ status: 'declined' })

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody({ status: 'DECLINED' })), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Already processed' }),
  )
  expect(mocks.runTransaction).not.toHaveBeenCalled()
})
```

### Test existente a actualizar (B1)

El test "crea TransactionRecord de audit en aprobacion" (linea 280) debe cambiar de verificar `mocks.add` a verificar `mocks.transaction.set`:

```typescript
it('crea TransactionRecord de audit dentro de la transaccion', async () => {
  setupPendingPayment()
  mocks.transaction.get.mockResolvedValue({
    exists: true,
    data: () => ({ stardust: 100 }),
  })

  const res = makeRes()
  await wompiWebhook(makeReq(makeWebhookBody()), res)

  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      type: 'earn',
      amount: 500,
      reason: 'purchase',
      itemId: 'pack-500',
      balanceAfter: 600,
    }),
  )
  // El add fuera de la transaccion ya no debe ocurrir
  expect(mocks.add).not.toHaveBeenCalled()
})
```

### Test existente: firma invalida (M2) — SIN CAMBIOS

El test "rechaza firma invalida sin procesar" (linea 330) **no necesita cambios**. El status se mantiene en 200 (Wompi reintenta cualquier respuesta != 200). El unico cambio en Fix 2 es el nivel de log (`warn` → `error`) y el logging estructurado, que no se validan en el test actual.

### Test existente a actualizar (B4)

El test "crea pago exitosamente con packageId valido" (linea 196) debe actualizar el regex:

```typescript
// Cambiar:
expect(response.reference).toMatch(/^ce-test-uid-\d+-[a-f0-9]{8}$/)
// Por:
expect(response.reference).toMatch(/^ce-\d+-[a-f0-9]{16}$/)
```

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad y riesgo de conflicto.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | B2 — Validacion event type | Minima | 3 lineas de codigo, 1 test nuevo. Sin dependencias. |
| 2 | B3 — EVENTS_SECRET retorna 500 | Minima | 2 lineas cambiadas, 1 test nuevo. Sin dependencias. |
| 3 | M2 — Logging de seguridad en firma invalida | Baja | 5 lineas cambiadas, sin cambios en tests. |
| 4 | B4 — Remover UID de referencia | Baja | 1 linea cambiada, 1 regex de test actualizada. |
| 5 | BONUS — Remover bonusPercent | Baja | 2 archivos de dominio. Sin impacto en logica de pagos. |
| 6 | M1 — Rate limiting | Media | Requiere mocks nuevos (countGet, countFn). |
| 7 | B1 — TransactionRecord atomico | Media | Requiere `set` en mock de transaction, reestructura del bloque APPROVED. |

### Dependencias entre cambios

- **M1 y B1** ambos modifican la estructura de mocks — implementarlos en secuencia para evitar conflictos.
- **B2** se inserta despues de la validacion de firma (que M2 modifica), pero no hay conflicto de lineas.
- **BONUS** no tiene dependencias con ningun otro fix.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/payments.test.ts
cd functions && npx tsc --noEmit
```

### Conteo esperado de tests

- **Antes:** 16 tests (5 createPayment + 8 wompiWebhook + 3 getPaymentStatus)
- **Despues:** 26 tests (9 createPayment + 14 wompiWebhook + 3 getPaymentStatus)
- **Delta:** +4 en createPayment, +6 en wompiWebhook. getPaymentStatus sin cambios.

### Checklist post-deploy

- [ ] Crear el indice compuesto de Firestore para M1: `payments` → `userId` (ASC), `status` (ASC)
- [ ] Verificar en Cloud Logging que un webhook valido se procesa correctamente (status 200, mensaje "OK")
- [ ] Verificar en Cloud Logging que un webhook con firma invalida genera `console.error` con `SECURITY:` prefix y retorna 200
- [ ] Crear alerta en Cloud Logging con filtro `textPayload =~ "SECURITY:"` para notificar sobre intentos de spoofing sostenidos
- [ ] Confirmar que `WOMPI_EVENTS_SECRET` esta configurado en produccion
- [ ] Enviar un test webhook desde el dashboard de Wompi sandbox para validar el flujo completo
- [ ] Verificar que un usuario no puede crear mas de 5 pagos pendientes simultaneos

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Indice de Firestore no creado antes del deploy (M1) | Media | El error de Firestore incluye link para crear el indice. Crear ANTES del deploy. |
| Mock de `transaction.set` no captura correctamente la llamada (B1) | Baja | El mock pattern es el mismo que `transaction.update`, que ya funciona. |
| `count()` no disponible en version de Firestore SDK (M1) | Muy baja | `count()` esta disponible desde `firebase-admin@11.0`. Verificar version en `package.json`. |
| Acumulacion de webhooks tras restaurar `WOMPI_EVENTS_SECRET` (B3) | Baja | Wompi reintenta maximo 3 veces en 24h (30min, 3h, 24h). Al restaurar el secret, los webhooks acumulados se procesan. No causa problemas: el procesamiento es **idempotente por diseno** — el check `status !== 'pending'` descarta duplicados. Test existente valida este escenario (linea 364). |

### Nota sobre politica de reintentos de Wompi

**Referencia oficial:** Wompi reintenta cualquier webhook cuya respuesta HTTP sea **diferente a 200**. Maximo 3 reintentos: a los 30 minutos, 3 horas y 24 horas. Solo un `200` detiene los reintentos. Esta politica informo las decisiones de este spec:
- **Fix 2 (firma invalida):** Retorna 200 para evitar reintentos innecesarios de requests con firma invalida.
- **Fix 4 (evento no soportado):** Retorna 200 para evitar reintentos de eventos que no procesamos.
- **Fix 5 (secret faltante):** Retorna 500 para activar reintentos — queremos que Wompi reintente porque el problema es temporal.
