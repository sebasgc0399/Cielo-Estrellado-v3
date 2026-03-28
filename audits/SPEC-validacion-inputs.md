# SPEC: Correcciones a la Validacion de Inputs

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/05-validacion-inputs.md` (auditoria de validacion)
**Archivos afectados:**
- `functions/src/handlers/stars.ts` (comentarios de documentacion)
- `functions/src/handlers/skies.ts` (comentarios de documentacion)
- `functions/src/handlers/economy.ts` (validacion de cursor)
- `functions/src/handlers/economy.test.ts` (tests nuevos)
## Contexto

Una auditoria de validacion de inputs identifico 1 hallazgo medio y 4 bajos. La validacion es solida en general: tipos, longitudes, rangos y enums se validan consistentemente. No se encontraron vulnerabilidades explotables. Los hallazgos son mejoras defensivas y documentacion de decisiones implicitas.

La mayoria de los fixes son **comentarios de documentacion** (no cambian comportamiento). Solo el Fix 3 (cursor) modifica codigo ejecutable. Esto es consistente con la filosofia del proyecto: la solucion mas simple que funcione.

---

## Fix 1: Documentar decision de no-sanitizacion HTML [M1 — Severidad Media]

### Problema

Los campos `title` y `message` (stars) y `title` (skies) se validan por tipo y longitud, pero no se sanitizan contra contenido HTML o scripts. Un titulo como `<script>alert('xss')</script>` se almacena tal cual en Firestore.

### Archivos y ubicaciones

6 ubicaciones donde se procesan campos de texto del body:

| Archivo | Linea | Campo | Funcion |
|---------|-------|-------|---------|
| `stars.ts` | 59 | `rawTitle` | `createStar` |
| `stars.ts` | 69 | `rawMessage` | `createStar` |
| `stars.ts` | 246 | `rawTitle` | `updateStar` |
| `stars.ts` | 256 | `rawMessage` | `updateStar` |
| `skies.ts` | 74 | `rawTitle` | `createSky` |
| `skies.ts` | 175 | `rawTitle` | `updateSky` |

### Codigo actual (ejemplo — `stars.ts:59`)

```typescript
const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
```

### Codigo propuesto

Agregar un comentario **antes** de cada una de las 6 lineas listadas:

```typescript
// No HTML sanitization — React escapes {text} in JSX by default.
// Safe as long as these values are rendered as text content, not via
// dangerouslySetInnerHTML or as href/src attributes.
// See audits/05-validacion-inputs.md M1.
const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
```

Para `rawMessage` (stars.ts:69, stars.ts:256):

```typescript
// No HTML sanitization — React escapes {text} in JSX by default.
// Safe as long as these values are rendered as text content, not via
// dangerouslySetInnerHTML or as href/src attributes.
// See audits/05-validacion-inputs.md M1.
const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
```

### Decisiones de diseno

- **Documentar, no sanitizar.** React escapa HTML por defecto en JSX (`{star.title}`). El frontend es un SPA React puro y no usa `dangerouslySetInnerHTML` para estos campos. Sanitizar agregaria complejidad sin beneficio actual.
- **Un regex strip como `.replace(/<[^>]*>/g, '')` romperia contenido legitimo.** Titulos como "x < y" o "I <3 esto" contienen `<` y serian corrompidos.
- **El comentario sirve como contrato de seguridad.** Si en el futuro se agrega un consumer que no escape HTML (app movil, email, export PDF), el desarrollador vera la advertencia en el punto exacto donde debe agregar sanitizacion.
- **Sin cambios en tests.** No hay cambio de comportamiento.

---

## Fix 2: Documentar inmutabilidad de `year` en updateStar [B2 — Severidad Baja]

### Problema

`createStar` valida y acepta `year` (linea 100), pero `updateStar` lo excluye del body tipado (lineas 238-244). El campo es inmutable despues de la creacion, pero no esta documentado.

### Archivo y ubicacion

`functions/src/handlers/stars.ts:238-244`

### Codigo actual

```typescript
const body = req.body as {
  title?: unknown
  message?: unknown
  xNormalized?: unknown
  yNormalized?: unknown
  imagePath?: unknown
}
```

### Codigo propuesto

```typescript
// year is intentionally excluded — immutable after creation. See audits/05-validacion-inputs.md B2.
const body = req.body as {
  title?: unknown
  message?: unknown
  xNormalized?: unknown
  yNormalized?: unknown
  imagePath?: unknown
}
```

### Decisiones de diseno

- **Solo un comentario.** El comportamiento actual es correcto: `year` enviado en un update se ignora silenciosamente porque no se extrae del body ni se incluye en `updatePayload`. Ningun campo extra llega a Firestore.
- **Sin cambios en tests.** Comportamiento inalterado.

---

## Fix 3: Validacion de longitud del cursor en getTransactions [B3 — Severidad Baja]

### Problema

El parametro `cursor` del query string se usa directamente como document ID de Firestore. Un cursor invalido o extremadamente largo no causa error, pero desperdicia un read a Firestore (`doc(cursor).get()`) que siempre retornara `exists: false`.

### Archivo y ubicacion

`functions/src/handlers/economy.ts:185`

### Codigo actual (`economy.ts:185`)

```typescript
const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
```

### Codigo propuesto

```typescript
const rawCursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
const cursor = rawCursor && rawCursor.length > 0 && rawCursor.length <= 128 ? rawCursor : null
```

El bloque `if (cursor)` de las lineas 192-197 no requiere cambios — un cursor `null` simplemente no ejecuta el read.

### Decisiones de diseno

- **Validacion inline, sin helper.** La filosofia del proyecto dice "no crear helpers hasta 3 usos reales". Este es el unico cursor en todo el codebase. Una linea inline es mas simple que importar una utilidad.
- **128 es un limite practico generoso para auto-IDs de Firestore (20 chars).** El limite real de Firestore para document IDs es 1,500 bytes UTF-8 — 128 chars es mucho menor, pero suficiente para cualquier auto-ID legitimo y rechaza strings obviamente invalidos.
- **Cursor invalido cae silenciosamente a primera pagina.** Esto mantiene el comportamiento actual (cursor doc no encontrado = empezar desde el inicio). No se retorna error — el cliente simplemente recibe la primera pagina.
- **Beneficio concreto:** Evita un read innecesario a Firestore para cursors obviamente invalidos (strings vacios, URLs pegadas por error, etc.).

---

## Fix 4: Agregar SKY_DESCRIPTION_MAX_LENGTH a policies.ts [B4 — Severidad Baja]

### Decision: Diferido

La constante no tiene consumidor actual — `description` no es editable via API (skies.ts:114 lo fija como `null`, updateSky no lo acepta). Agregar la constante ahora seria codigo sin uso por tiempo indeterminado. Se implementara cuando la edicion de descripcion entre al roadmap. El hallazgo queda rastreado en `audits/05-validacion-inputs.md B4`.

---

## Fix 5: Documentar decision sobre validacion de route params [B1 — Severidad Baja]

### Problema

Todos los handlers extraen `skyId`, `starId`, `userId`, `inviteId`, `reference` y `token` de `req.routeParams` sin validar formato. La auditoria recomienda un helper `isValidDocId()`.

### Ubicaciones (12+ extracciones)

| Archivo | Linea | Params |
|---------|-------|--------|
| `stars.ts` | 49 | `skyId` |
| `stars.ts` | 204 | `skyId, starId` |
| `stars.ts` | 357 | `skyId, starId` |
| `skies.ts` | 147, 227, 255, 334 | `skyId` |
| `invites.ts` | 26, 61, 104 | `skyId`, `inviteId` |
| `members.ts` | 12, 83, 165 | `skyId`, `userId` |
| `payments.ts` | 283 | `reference` |

### Decision: No se modifica codigo

### Justificacion

- **Crear `isValidDocId()` viola la filosofia del proyecto.** "No crear helpers hasta 3 usos reales" — pero aqui el problema no es la reutilizacion, sino que no hay 0 bugs observados por IDs invalidos.
- **Firestore ya maneja IDs arbitrarios de forma segura.** `doc()` lanza error si el ID contiene `/`. IDs vacios o inexistentes resultan en `exists: false`, que los handlers manejan con "no encontrado".
- **Agregar validacion inline en 12+ ubicaciones es excesivo para un riesgo teorico.** Cada handler ya tiene un `catch` que retorna 500 ante cualquier error de Firestore.
- **La auditoria lo califico como "no urgente" e "impacto minimo".**
- **Si se observa un bug por route param malformado, se revisita esta decision.** El hallazgo queda rastreado, no ignorado.

---

## Plan de tests

### Tests existentes que necesitan modificacion

Ninguno. Fixes 1, 2, 4 y 5 no cambian comportamiento.

### Mocks existentes (sin modificacion)

Los mocks de `economy.test.ts` ya cubren todo lo necesario:
- `mocks.docGet` (linea 24) — mock del `.get()` del cursor document
- `mocks.txCollection.doc` (linea 32) — mock de `.doc(cursor)`
- `mocks.queryGet` (linea 23) — mock del query `.get()` principal

### Nuevos tests a agregar

**En `economy.test.ts`, dentro de `describe('getTransactions')` (despues de linea 399):**

```typescript
it('ignora cursor excesivamente largo (> 128 chars)', async () => {
  const longCursor = 'a'.repeat(200)

  const res = makeRes()
  await getTransactions(makeReq({ cursor: longCursor }), res)

  expect(res.status).toHaveBeenCalledWith(200)
  // docGet NO debe llamarse — cursor rechazado antes del read a Firestore
  expect(mocks.docGet).not.toHaveBeenCalled()
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ transactions: expect.any(Array) }),
  )
})

it('ignora cursor vacio', async () => {
  const res = makeRes()
  await getTransactions(makeReq({ cursor: '' }), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(mocks.docGet).not.toHaveBeenCalled()
})
```

### Test existente de cursor con mock — SIN CAMBIOS

El test "respeta limit y retorna nextCursor" (linea 374) no usa cursor como input — solo verifica que el response contiene `nextCursor`. No necesita modificacion.

---

## Orden de implementacion

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | B2 — Documentar inmutabilidad year | Minima | 1 comentario. Sin dependencias. |
| 2 | M1 — Documentar no-sanitizacion HTML | Minima | 6 comentarios. Sin cambio de comportamiento. |
| 3 | B3 — Validacion cursor | Baja | 1 linea cambiada. 2 tests nuevos. |
| 4 | B1 — Documentar decision route params | Nula | Solo en este SPEC. Sin cambios en codigo. |
| — | B4 — SKY_DESCRIPTION_MAX_LENGTH | Diferido | Se implementa cuando la edicion de descripcion entre al roadmap. |

### Dependencias entre cambios

Ninguna. Todos los fixes son independientes y pueden implementarse en cualquier orden.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/economy.test.ts
cd functions && npx tsc --noEmit
```

### Conteo esperado de tests

- **economy.test.ts antes:** 19 tests (16 getEconomy + 3 getTransactions)
- **economy.test.ts despues:** 21 tests (16 getEconomy + 5 getTransactions)
- **Delta:** +2 tests (ambos en getTransactions)
- **Todos los demas test files:** Sin cambios

### Checklist post-implementacion

- [ ] Verificar comentario de no-sanitizacion en stars.ts (lineas 59, 69, 246, 256)
- [ ] Verificar comentario de no-sanitizacion en skies.ts (lineas 74, 175)
- [ ] Verificar comentario de inmutabilidad de year en stars.ts (linea 238)
- [ ] Verificar validacion de cursor en economy.ts (linea 185)
- [ ] Correr full test suite: `cd functions && npx vitest run` — todos los tests en verde
- [ ] Type check: `cd functions && npx tsc --noEmit` — sin errores

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Cursor de 128 chars es demasiado restrictivo para Firestore auto-IDs | Muy baja | Auto-IDs de Firestore son 20 chars. Limite real de Firestore es 1,500 bytes UTF-8. 128 es generoso para auto-IDs y conservador vs el limite real. |
| Comentarios de M1 se vuelven obsoletos si se cambia de React | Muy baja | El proyecto es un SPA React sin planes de cambio. El comentario nombra las condiciones bajo las cuales se necesitaria sanitizacion (dangerouslySetInnerHTML, href/src attributes). |
