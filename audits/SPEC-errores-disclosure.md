# SPEC: Correcciones al Manejo de Errores y Disclosure

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/06-errores-disclosure.md` (auditoria de errores y disclosure)
**Archivos afectados:**
- `functions/src/logError.ts` (archivo nuevo — helper de logging)
- `functions/src/logError.test.ts` (archivo nuevo — tests del helper)
- `functions/src/handlers/economy.ts` (2 instancias)
- `functions/src/handlers/invitePublic.ts` (2 instancias)
- `functions/src/handlers/invites.ts` (3 instancias + fix B3)
- `functions/src/handlers/members.ts` (3 instancias)
- `functions/src/handlers/payments.ts` (3 instancias + fix B1)
- `functions/src/handlers/shop.ts` (2 instancias)
- `functions/src/handlers/skies.ts` (6 instancias)
- `functions/src/handlers/stars.ts` (4 instancias)
- `functions/src/handlers/userSync.ts` (1 instancia)
- `CLAUDE.md` (documentacion de convencion)

## Contexto

Una auditoria de manejo de errores identifico 1 hallazgo medio y 3 bajos. El manejo de errores es robusto: 100% de handlers tienen try/catch y respuestas genericas al cliente. No se exponen stack traces ni mensajes internos al usuario. El gap principal es que `console.error` loguea objetos error completos en Cloud Logging, donde podrian contener tokens, paths internos, configuracion del proyecto o datos de usuario. Los hallazgos bajos son refinamientos: un mensaje que expone una variable de entorno, otro que revela un problema de configuracion vs logica, y formato de respuesta inconsistente.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

### Interaccion con otros SPECs

`SPEC-Pagos-Wompi.md` ya fue implementado (verificado en el codigo actual de `payments.ts`). Los cambios de este SPEC en `payments.ts` no entran en conflicto: solo se reemplaza `console.error(..., error)` por `logError(...)` en las lineas de catch generico (97, 275, 308) y se cambia el mensaje de respuesta en las lineas 38 y 45. Los logs de seguridad estructurados (lineas 149, 206) NO se modifican.

---

## Fix 1: Crear helper `logError` [M1 — Severidad Media]

### Problema

26 instancias en 9 archivos loguean `console.error('context:', error)` donde `error` es el objeto completo. En Cloud Functions, esto escribe el error serializado a Cloud Logging. Si el error es un objeto de Firestore o Firebase Auth, puede contener tokens, paths internos, configuracion del proyecto o datos del usuario en su payload.

Solo una instancia filtra correctamente y sirve como patron de referencia:
- `invitePublic.ts:48`: `console.error('Invite preview failed:', error instanceof Error ? error.message : String(error))`

### Justificacion del helper

CLAUDE.md dice: "No crear helpers, utils ni wrappers hasta que haya al menos 3 usos reales." Con 26 usos reales, un helper esta ampliamente justificado. El helper tiene 3 lineas de logica, evita duplicar el patron `instanceof Error ? error.message : String(error)` en 26 ubicaciones, y reduce el riesgo de errores en la repeticion.

### Archivo nuevo: `functions/src/logError.ts`

```typescript
export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = error != null && typeof (error as Record<string, unknown>).code === 'string'
    ? (error as Record<string, unknown>).code as string : undefined
  console.error(`${context}:`, code ? `[${code}] ${message}` : message)
}
```

### Decisiones de diseno

- **Ubicacion `functions/src/logError.ts`** (flat, al nivel de `router.ts` e `index.ts`) — no se crea un directorio `utils/` para un solo archivo. El directorio `lib/` existe pero contiene modulos de dominio (`acceptInvite.ts`, `createInvite.ts`, `firebaseAdmin.ts`), no utilidades genericas.
- **Import desde handlers:** `import { logError } from '../logError.js'` — mismo patron que `import { db } from '../lib/firebaseAdmin.js'`.
- **Se loguea `error.code` cuando existe** — los errores de negocio tipados (`ShopError`, `PaymentError`, etc.) se manejan ANTES del catch generico y nunca llegan a `logError`. Pero errores inesperados de Firestore SI llegan al catch generico, y estos tienen codes como `DEADLINE_EXCEEDED`, `UNAVAILABLE` o `PERMISSION_DENIED` que son criticos para diagnostico. Con solo `message`, multiples errores de Firestore lucen iguales en los logs. Con `code`, el log dice `[deadline-exceeded] Deadline exceeded` en vez de solo `Deadline exceeded`, lo cual hace la diferencia cuando debuggeas un outage a las 2am.
- **Sin segundo argumento adicional** — se podria agregar `metadata?: Record<string, unknown>` para logging estructurado, pero ningun uso actual lo necesita. Simplicidad.

---

## Fix 2: Reemplazar 26 instancias de logging [M1 — Severidad Media]

### Patron de cambio

En cada archivo afectado, agregar el import y reemplazar la llamada:

```typescript
// Agregar al inicio del archivo:
import { logError } from '../logError.js'

// Reemplazar cada instancia:
// ANTES:
console.error('Context message:', error)
// DESPUES:
logError('Context message', error)
```

Nota: el helper ya agrega `:` despues del contexto, asi que se elimina el `:` del string pasado como argumento.

### Lista exhaustiva de instancias (26 total, 9 archivos)

**`economy.ts`** (2 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 173 | `console.error('getEconomy failed:', error)` | `logError('getEconomy failed', error)` |
| 221 | `console.error('getTransactions failed:', error)` | `logError('getTransactions failed', error)` |

**`invitePublic.ts`** (2 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 133 | `console.error('Invite accept reward failed (non-blocking):', rewardError)` | `logError('Invite accept reward failed (non-blocking)', rewardError)` |
| 161 | `console.error('Accept invite failed:', error)` | `logError('Accept invite failed', error)` |

Nota: `invitePublic.ts:48` ya filtra correctamente — NO se cambia.

**`invites.ts`** (3 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 52 | `console.error('Invite creation failed:', error)` | `logError('Invite creation failed', error)` |
| 95 | `console.error('Invite list failed:', error)` | `logError('Invite list failed', error)` |
| 146 | `console.error('Revoke invite failed:', error)` | `logError('Revoke invite failed', error)` |

**`members.ts`** (3 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 73 | `console.error('Members list failed:', error)` | `logError('Members list failed', error)` |
| 154 | `console.error('Update member failed:', error)` | `logError('Update member failed', error)` |
| 195 | `console.error('Leave sky failed:', error)` | `logError('Leave sky failed', error)` |

**`payments.ts`** (3 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 97 | `console.error('createPayment failed:', error)` | `logError('createPayment failed', error)` |
| 275 | `console.error('wompiWebhook error:', error)` | `logError('wompiWebhook error', error)` |
| 308 | `console.error('getPaymentStatus failed:', error)` | `logError('getPaymentStatus failed', error)` |

**NO se cambian en payments.ts:**
- Linea 37: string literal `'WOMPI_INTEGRITY_SECRET not configured'` — no hay objeto error
- Linea 44: string literal `'WOMPI_PUBLIC_KEY not configured'` — no hay objeto error
- Linea 124: string literal `'CRITICAL: WOMPI_EVENTS_SECRET...'` — no hay objeto error
- Linea 149: `console.error('SECURITY: Webhook signature mismatch', {...})` — logging de seguridad estructurado, intencional
- Linea 206: `console.error('Webhook amount mismatch:', {...})` — logging de seguridad estructurado, intencional

**`shop.ts`** (2 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 98 | `console.error('purchase failed:', error)` | `logError('purchase failed', error)` |
| 121 | `console.error('getCatalog failed:', error)` | `logError('getCatalog failed', error)` |

**`skies.ts`** (6 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 64 | `console.error('getUserSkies failed:', error)` | `logError('getUserSkies failed', error)` |
| 143 | `console.error('Sky creation failed:', error)` | `logError('Sky creation failed', error)` |
| 223 | `console.error('updateSky failed:', error)` | `logError('updateSky failed', error)` |
| 250 | `console.error('getSky failed:', error)` | `logError('getSky failed', error)` |
| 331 | `console.error('deleteSky failed:', error)` | `logError('deleteSky failed', error)` |
| 385 | `console.error('updateSkyTheme failed:', error)` | `logError('updateSkyTheme failed', error)` |

**`stars.ts`** (4 instancias, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 195 | `console.error('Star creation reward failed (non-blocking):', rewardError)` | `logError('Star creation reward failed (non-blocking)', rewardError)` |
| 200 | `console.error('Star creation failed:', error)` | `logError('Star creation failed', error)` |
| 359 | `console.error('Star update failed:', error)` | `logError('Star update failed', error)` |
| 418 | `console.error('Star delete failed:', error)` | `logError('Star delete failed', error)` |

**`userSync.ts`** (1 instancia, agregar 1 import):

| Linea | Antes | Despues |
|-------|-------|---------|
| 78 | `console.error('User sync failed:', error)` | `logError('User sync failed', error)` |

### Instancias que NO se cambian (correctas o intencionales)

| Archivo | Linea | Razon |
|---------|-------|-------|
| `invitePublic.ts` | 48 | Ya filtra con `error instanceof Error ? error.message : String(error)` |
| `payments.ts` | 37 | String literal, no hay objeto error |
| `payments.ts` | 44 | String literal, no hay objeto error |
| `payments.ts` | 124 | String literal CRITICAL, no hay objeto error |
| `payments.ts` | 149 | Logging de seguridad estructurado, intencional |
| `payments.ts` | 206 | Logging de seguridad estructurado, intencional |
| `skies.ts` | 307 | `console.warn` con string literal de imagePath, no es un error object |
| `stars.ts` | 412 | `console.warn` con string literal de imagePath, no es un error object |

---

## Fix 3: Cambiar mensaje de `APP_URL no configurado` [B3 — Severidad Baja]

### Problema

`invites.ts:36` retorna al cliente `'APP_URL no configurado'`, exponiendo el nombre exacto de la variable de entorno faltante. Un atacante sabe que existe `APP_URL` como variable de configuracion.

### Codigo actual (`invites.ts:34-37`)

```typescript
const appUrl = process.env.APP_URL?.trim()
if (!appUrl) {
  res.status(500).json({ error: 'APP_URL no configurado' })
  return
}
```

### Codigo propuesto

```typescript
const appUrl = process.env.APP_URL?.trim()
if (!appUrl) {
  console.error('APP_URL not configured')
  res.status(500).json({ error: 'Error de configuración del servidor' })
  return
}
```

### Decisiones de diseno

- **Se agrega `console.error`** para que la causa quede visible en Cloud Logging. Sin el log, un deploy con APP_URL faltante seria dificil de diagnosticar. Este es un string literal, no un objeto error, asi que no necesita `logError`.
- **Mensaje generico** al cliente: `'Error de configuración del servidor'` — no revela que variable ni que tipo de configuracion.
- **Se mantiene status 500** — es un error de infraestructura, semanticamente correcto.

---

## Fix 4: Cambiar mensaje de configuracion de pagos [B1 — Severidad Baja]

### Problema

`payments.ts:38,45` retornan `'Error de configuración de pagos'` al cliente cuando `WOMPI_INTEGRITY_SECRET` o `WOMPI_PUBLIC_KEY` no estan configurados. Esto revela que el error es un problema de configuracion, no de logica de negocio.

### Codigo actual (`payments.ts:35-46`)

```typescript
const integritySecret = process.env.WOMPI_INTEGRITY_SECRET
if (!integritySecret) {
  console.error('WOMPI_INTEGRITY_SECRET not configured')
  res.status(500).json({ error: 'Error de configuración de pagos' })
  return
}

const publicKey = process.env.WOMPI_PUBLIC_KEY
if (!publicKey) {
  console.error('WOMPI_PUBLIC_KEY not configured')
  res.status(500).json({ error: 'Error de configuración de pagos' })
  return
}
```

### Codigo propuesto

```typescript
const integritySecret = process.env.WOMPI_INTEGRITY_SECRET
if (!integritySecret) {
  console.error('WOMPI_INTEGRITY_SECRET not configured')
  res.status(500).json({ error: 'Error interno al crear pago' })
  return
}

const publicKey = process.env.WOMPI_PUBLIC_KEY
if (!publicKey) {
  console.error('WOMPI_PUBLIC_KEY not configured')
  res.status(500).json({ error: 'Error interno al crear pago' })
  return
}
```

### Decisiones de diseno

- **Mismo mensaje que el catch generico** de `createPayment` (linea 98): `'Error interno al crear pago'`. El cliente no distingue entre un error de configuracion y otro tipo de fallo, que es exactamente lo que queremos.
- **Los `console.error` con string literal se mantienen** — son seguros (no loguean objetos error) y necesarios para diagnostico en Cloud Logging.
- **Los tests existentes (lineas 285-303) NO verifican el texto del mensaje**, solo el status 500 y que `paymentAdd` no fue llamado. No se rompen.

---

## Fix 5: Documentar convencion de formato de error [B2 — Severidad Baja]

### Problema

Las respuestas de error tienen formatos ligeramente diferentes:
- Mayoria: `{ error: 'mensaje' }`
- Shop errors: `{ error: 'mensaje', code: 'error_code' }`
- CreateSky limit: `{ error: 'mensaje', maxSkies: N, currentCount: N }`
- AcceptInvite already_member: `{ error: 'mensaje', skyId: '...' }`
- Webhook: `{ message: '...' }` (no `error`)
- Success: `{ ok: true }`, `{ skyId: '...' }`, `{ status: '...' }` (variado)

### Accion

**No se refactoriza codigo existente.** Se documenta la convencion para nuevos handlers en CLAUDE.md.

### Texto a agregar en `CLAUDE.md`, seccion "Principios tecnicos"

Agregar al final de la seccion "Principios tecnicos":

```markdown
- **Formato de respuesta de error en handlers:**
  - Error generico: `{ error: 'Mensaje descriptivo para el usuario' }`
  - Error de negocio con codigo: `{ error: 'Mensaje', code: 'error_code' }`
  - Error con datos contextuales: `{ error: 'Mensaje', ...campos_relevantes }`
  - Webhook Wompi: `{ message: '...' }` (convencion de Wompi, no cambiar)
  - No mezclar `error` y `message` como clave principal en el mismo tipo de endpoint.
```

### Decisiones de diseno

- **No se refactoriza** lo existente. El frontend ya maneja los formatos actuales (`ApiError` captura `response.text()`), y cambiarlos requeriria coordinacion frontend-backend sin beneficio inmediato.
- **La convencion es descriptiva** (documenta lo que existe) mas que prescriptiva. Los campos extra (`code`, `maxSkies`) son utiles para UX.

---

## Plan de tests

### Test nuevo: `functions/src/logError.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { logError } from './logError.js'

describe('logError', () => {
  it('extrae message de instancias de Error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('test context', new Error('something broke'))
    expect(spy).toHaveBeenCalledWith('test context:', 'something broke')
    spy.mockRestore()
  })

  it('incluye error.code cuando existe', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const firestoreError = Object.assign(new Error('Deadline exceeded'), { code: 'deadline-exceeded' })
    logError('db query', firestoreError)
    expect(spy).toHaveBeenCalledWith('db query:', '[deadline-exceeded] Deadline exceeded')
    spy.mockRestore()
  })

  it('convierte non-Error a string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('test context', { weird: 'object' })
    expect(spy).toHaveBeenCalledWith('test context:', '[object Object]')
    spy.mockRestore()
  })

  it('maneja null y undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('null error', null)
    expect(spy).toHaveBeenCalledWith('null error:', 'null')
    logError('undefined error', undefined)
    expect(spy).toHaveBeenCalledWith('undefined error:', 'undefined')
    spy.mockRestore()
  })

  it('maneja string directo', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('string error', 'simple message')
    expect(spy).toHaveBeenCalledWith('string error:', 'simple message')
    spy.mockRestore()
  })
})
```

### Tests existentes: NO se modifican

- **No se testea que handlers usen `logError`** — eso es testear implementacion, no comportamiento. Los tests existentes de handlers verifican las respuestas HTTP, que no cambian.
- **Tests de `payments.test.ts`** (lineas 285-303) verifican status 500 para secrets faltantes, pero NO verifican el texto del mensaje de error. No necesitan cambios.

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad y riesgo de conflicto.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | Fix 1 — Crear `logError.ts` + tests | Minima | 5 lineas de logica + 5 tests. Base para todo lo demas. |
| 2 | Fix 3 — APP_URL mensaje generico | Minima | 2 lineas cambiadas. Sin dependencias. |
| 3 | Fix 4 — Config pagos mensaje generico | Minima | 2 strings cambiados. Sin dependencias. |
| 4 | Fix 2 — Reemplazar 26 instancias | Media | Mecanico pero afecta 9 archivos. Cada archivo: agregar import + reemplazar llamadas. |
| 5 | Fix 5 — Documentar convencion | Minima | Solo texto en CLAUDE.md. |

### Dependencias entre cambios

- **Fix 2 depende de Fix 1** — el helper debe existir antes de importarlo.
- **Fixes 3, 4, 5 son independientes** entre si y de Fix 1/2.
- **Fix 2 puede hacerse archivo por archivo**, compilando despues de cada uno para detectar errores temprano.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/logError.test.ts   # Tests del helper
cd functions && npx tsc --noEmit                       # Type check
cd functions && npx vitest run                         # Todos los tests
```

### Conteo esperado de tests

- **Antes:** tests existentes sin cambios
- **Despues:** +5 tests (los 5 de `logError.test.ts`)
- **Ningun test existente debe romperse** — las respuestas HTTP no cambian excepto los 2 mensajes de Fix 3 y Fix 4, y los tests existentes no verifican esos strings exactos.

### Verificacion post-implementacion

Correr grep para verificar que no queden `console.error` que pasen variables (no solo string literals):

```bash
# Todas las llamadas a console.error que pasen algo mas que un string literal
grep -rn 'console\.error(' functions/src/handlers/ | grep -v "console\.error('[^']*')"
```

Este grep captura cualquier `console.error` con variables como argumento (independientemente del nombre: `error`, `rewardError`, `logError`, etc.), filtrando las que solo pasan string literals. Es mas robusto que buscar `error)` porque `rewardError` y otros nombres de variable no matchean ese patron.

**Instancias esperadas despues del fix (3 total):**
- `invitePublic.ts:48` — ya filtra con instanceof (NO se cambio, pasa `error instanceof Error ? ...`)
- `payments.ts:149` — logging de seguridad estructurado (pasa `{ receivedChecksum, ip, ... }`)
- `payments.ts:206` — logging de seguridad estructurado (pasa `{ expected, received, ... }`)

Cualquier otro resultado indica una instancia que se olvido de migrar.

### Checklist post-deploy

- [ ] Verificar en Cloud Logging que errores loguean solo `message`, no objetos completos
- [ ] Provocar un error (ej. Firestore indisponible temporalmente) y verificar que el log muestra `Handler failed: mensaje` en lugar del objeto completo
- [ ] Verificar que `createInviteHandler` con APP_URL faltante retorna `'Error de configuración del servidor'` (no `'APP_URL no configurado'`)
- [ ] Verificar que `createPayment` con secret faltante retorna `'Error interno al crear pago'` (no `'Error de configuración de pagos'`)

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Import path incorrecto | Baja | El proyecto usa `.js` extension en imports. Seguir el patron existente: `'../logError.js'`. |
| Olvidar instancias | Baja | Correr grep post-fix y verificar que solo quedan las 3 instancias excluidas. |
| `logError` pierde stack trace del error | Baja | Se mitiga parcialmente con `error.code` (los errores de Firestore se distinguen por code, no por stack). Si se necesita el stack completo para un error especifico, se puede temporalmente revertir a `console.error(error)` en ese handler puntual. |
| Test falla por diferencia de serializacion de String() | Muy baja | `String(null)` retorna `'null'`, `String(undefined)` retorna `'undefined'`. Comportamiento estandar de JS. |
