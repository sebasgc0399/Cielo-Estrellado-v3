# Auditoria: Seguridad de Pagos (Wompi)

**Fecha:** 2026-03-25
**Alcance:** `functions/src/handlers/payments.ts`, `functions/src/handlers/payments.test.ts`, `functions/src/domain/stardustPackages.ts`, `functions/src/domain/contracts.ts`
**Severidad general:** Media

## Resumen ejecutivo

El flujo de pagos Wompi esta bien implementado en sus fundamentos: firma SHA256 validada, atomicidad con `runTransaction`, idempotencia, verificacion de monto y separacion entre creacion y acreditacion. Se identifican **2 hallazgos medios** y **4 bajos** relacionados con rate limiting, manejo de errores edge-case y respuestas del webhook.

---

## Hallazgos

### [MEDIO] M1 — Sin rate limiting en creacion de pagos

- **Archivo:** `functions/src/handlers/payments.ts:15-87`
- **Descripcion:** El endpoint `createPayment` no tiene limite de creacion de pagos por usuario por periodo de tiempo. Un usuario autenticado puede crear miles de `PaymentRecord` con status `pending` en Firestore.
- **Impacto:** Abuso de almacenamiento en Firestore, posible DoS economico (costo de reads/writes en Firestore), generacion masiva de referencias Wompi que nunca se resuelven.
- **Recomendacion:** Agregar un limite diario de pagos pendientes por usuario. Ejemplo: antes de crear, contar pagos `pending` del usuario en las ultimas 24h. Si excede N (ej. 5), rechazar con 429.
- **Codigo relevante:**
  ```typescript
  // No hay validacion de frecuencia antes de:
  const docRef = await db.collection('payments').add(paymentDoc)
  ```

### [MEDIO] M2 — Webhook retorna 200 en TODOS los casos, incluyendo firma invalida

- **Archivo:** `functions/src/handlers/payments.ts:133-137`
- **Descripcion:** Cuando la firma del webhook no coincide, se retorna `200 OK` con mensaje `"Invalid signature"`. Si bien retornar 200 es correcto para errores internos (evitar reintentos de Wompi), una firma invalida indica un intento de spoofing, no un error temporal.
- **Impacto:** Un atacante que envie webhooks falsos recibe confirmacion de que el endpoint existe y procesa requests. No puede causar dano (la firma se valida), pero no hay visibilidad de ataques sostenidos.
- **Recomendacion:** Mantener 200 (para no dar info al atacante), pero agregar logging estructurado con nivel `error` (no solo `warn`) y considerar una metrica/alerta para firmas invalidas consecutivas. Evaluar retornar 401 en lugar de 200 para firmas invalidas — Wompi solo reintenta en 5xx, no en 4xx.
- **Codigo relevante:**
  ```typescript
  if (computedHash !== checksum) {
    console.warn('Webhook signature mismatch')  // Solo warn, deberia ser error
    res.status(200).json({ message: 'Invalid signature' })
    return
  }
  ```

---

### [BAJO] B1 — TransactionRecord (audit log) fuera de la transaccion atomica

- **Archivo:** `functions/src/handlers/payments.ts:223-232`
- **Descripcion:** El log de auditoria (`TransactionRecord`) se escribe fuera del `runTransaction`. Si la funcion crashea despues del commit de la transaccion pero antes de escribir el log, el balance se actualiza sin registro.
- **Impacto:** Inconsistencia en el historial de transacciones del usuario. El balance seria correcto pero el log estaria incompleto. Impacto bajo porque el `PaymentRecord` SI se actualiza dentro de la transaccion y sirve como fuente de verdad alternativa.
- **Recomendacion:** Mover el `add` del `TransactionRecord` dentro del `runTransaction`. Firestore permite hasta 500 operaciones por transaccion, agregar una mas no es problema.
- **Codigo relevante:**
  ```typescript
  // Dentro de la transaccion:
  firestoreTransaction.update(userRef, { stardust: balance })
  firestoreTransaction.update(paymentDocRef, { status: 'approved', ... })

  // Fuera de la transaccion (riesgo):
  await db.collection('users').doc(paymentData.userId)
    .collection('transactions').add(txRecord)
  ```

### [BAJO] B2 — No se valida el campo `event` del webhook

- **Archivo:** `functions/src/handlers/payments.ts:94`
- **Descripcion:** Se extrae `event` del body pero nunca se valida que sea `"transaction.updated"`. El webhook procesa cualquier tipo de evento de Wompi que pase la firma.
- **Impacto:** Bajo en la practica — Wompi envia diferentes tipos de eventos, pero la logica busca `data.transaction` que solo existe en eventos de transaccion. Sin embargo, un evento futuro de Wompi podria tener una estructura similar y procesarse inesperadamente.
- **Recomendacion:** Agregar validacion explicita:
  ```typescript
  if (event !== 'transaction.updated') {
    res.status(200).json({ message: 'Event type ignored' })
    return
  }
  ```

### [BAJO] B3 — `WOMPI_EVENTS_SECRET` ausente retorna 200 en lugar de loguear alerta critica

- **Archivo:** `functions/src/handlers/payments.ts:109-114`
- **Descripcion:** Si `WOMPI_EVENTS_SECRET` no esta configurado, el webhook retorna 200 con `"Configuration error"` y un `console.error`. En produccion esto significaria que NINGUN pago se puede procesar, y el error podria pasar desapercibido.
- **Impacto:** Pagos aprobados por Wompi que nunca se acreditan al usuario. El `console.error` puede perderse en logs si no hay alertas configuradas.
- **Recomendacion:** Considerar retornar 500 en este caso especifico (Wompi reintentara, dando tiempo a arreglar la config). Alternativamente, agregar un health check que valide la presencia de secrets al arrancar la funcion.

### [BAJO] B4 — Referencia de pago incluye parte del UID del usuario

- **Archivo:** `functions/src/handlers/payments.ts:47`
- **Descripcion:** La referencia de pago se genera como `ce-${uid.slice(0, 8)}-${timestamp}-${random}`. Los primeros 8 caracteres del UID de Firebase son parte de la referencia, visible en Wompi y en logs.
- **Impacto:** Minimo. Los primeros 8 chars de un UID de Firebase no son un secreto (no permiten autenticacion), pero exponen parcialmente un identificador interno. Un atacante no puede hacer nada util con esto.
- **Recomendacion:** Considerar usar solo bytes aleatorios para la referencia si se desea evitar cualquier correlacion. No es urgente.
- **Codigo relevante:**
  ```typescript
  const reference = `ce-${uid.slice(0, 8)}-${Date.now()}-${randomBytes(4).toString('hex')}`
  ```

---

## Aspectos positivos

1. **Firma SHA256 bien implementada:** El calculo del hash sigue exactamente el algoritmo de Wompi (concatenar valores de properties + timestamp + secret).
2. **Idempotencia correcta:** El check `paymentData.status !== 'pending'` evita doble acreditacion.
3. **Defense in depth:** La verificacion de monto (`wompiAmount !== paymentData.amountInCents`) previene ataques de manipulacion de monto.
4. **Atomicidad:** `runTransaction` asegura que el credito de PE y el cambio de status del pago son atomicos.
5. **Separacion creacion/acreditacion:** `createPayment` NUNCA acredita PE — solo el webhook lo hace.
6. **getPaymentStatus filtra por userId:** Un usuario no puede consultar pagos de otro usuario.
7. **Catalogo estatico:** Los paquetes estan hardcodeados, no se pueden manipular desde el cliente.
8. **Integridad:** La firma SHA256 en `createPayment` protege contra manipulacion de monto en el checkout de Wompi.
9. **Tests solidos:** 13 tests cubren los caminos principales: exito, rechazo, firma invalida, idempotencia, error interno.

---

## Conclusion

El sistema de pagos tiene una implementacion solida y segura en sus aspectos criticos. Los hallazgos medios (rate limiting y manejo de firma invalida) son mejoras defensivas, no vulnerabilidades explotables. El hallazgo B1 (log fuera de transaccion) es el mas accionable y simple de resolver. No se encontraron vulnerabilidades criticas.

### Proximos pasos recomendados (por prioridad):
1. Mover `TransactionRecord` dentro del `runTransaction` (B1)
2. Agregar validacion de tipo de evento (B2)
3. Implementar rate limiting en `createPayment` (M1)
4. Elevar log de firma invalida a `error` + considerar metricas (M2)
