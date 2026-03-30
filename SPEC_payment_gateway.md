# SPEC: Wompi Webhook Gateway

## Objetivo

Un microservicio gateway que recibe **todos** los webhooks de Wompi (una sola cuenta, una sola URL configurada en el dashboard) y los reenvía al proyecto Firebase correcto según el prefijo de la referencia de pago.

Esto permite que múltiples proyectos Firebase compartan una sola cuenta de Wompi sin conflictos.

---

## Contexto actual (Cielo Estrellado)

Auditoría de `functions/src/handlers/payments.ts`:

| Aspecto | Implementación actual |
|---|---|
| **Formato de referencia** | `ce-{timestamp}-{16 hex chars}` — ejemplo: `ce-1711234567890-a1b2c3d4e5f6g7h8` |
| **Prefijo existente** | `ce-` (ya incluido, línea 61) |
| **Campo en Firestore** | `payments.wompiReference` |
| **Búsqueda en webhook** | `db.collection('payments').where('wompiReference', '==', wompiReference)` |
| **Firma del webhook** | SHA-256: resolver paths de `signature.properties` sobre `body.data`, concatenar valores + `timestamp` + `WOMPI_EVENTS_SECRET`, comparar con `signature.checksum` |
| **Evento procesado** | Solo `transaction.updated` |
| **Campos usados del body** | `data.transaction.reference`, `.status`, `.id`, `.amount_in_cents`, `.payment_method_type` |
| **Respuesta a Wompi** | Siempre `200` con `{ message: '...' }` — incluso en errores internos, para evitar reintentos |

---

## Arquitectura

```
Wompi Dashboard
    │
    │  POST (webhook)
    ▼
┌─────────────────────────┐
│   wompi-gateway         │
│   Cloud Function HTTP   │
│   POST /webhook         │
│                         │
│   1. Extraer referencia │
│   2. Parsear prefijo    │
│   3. Buscar destino     │
│   4. Reenviar body      │
└─────────┬───────────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
Cielo Estrel.  Proyecto 2
ce-* →         p2-* →
/api/payments  /api/payments
/webhook       /webhook
```

- **Proyecto Firebase independiente** (ej. `wompi-gateway`)
- **Una sola Cloud Function HTTP**: `POST /webhook`
- **Tabla de routing**: prefijo → URL destino

---

## Flujo del gateway

```
1. Recibe POST de Wompi en /webhook
2. Extrae body.data.transaction.reference
3. Parsea prefijo: todo antes del primer '-' (ej. "ce" de "ce-1711234567890-a1b2c3d4")
4. Busca en tabla de routing: "ce" → "https://us-central1-masmelito-f209c.cloudfunctions.net/api/payments/webhook"
5. Reenvía el body completo al destino con Content-Type: application/json
6. Retorna el status code del destino a Wompi
7. Si falla → retorna 500 a Wompi (Wompi reintentará)
```

### Extracción de referencia

```typescript
// Body de Wompi:
// body.data.transaction.reference → "ce-1711234567890-a1b2c3d4e5f6g7h8"
const reference = body?.data?.transaction?.reference
const prefix = typeof reference === 'string' ? reference.split('-')[0] : null
// prefix → "ce"
```

---

## Tabla de routing

Configurada vía **variables de entorno** (opción recomendada — sin Firestore, sin lecturas, sin costos extra).

```bash
# Formato: ROUTE_{PREFIX}=url_destino
ROUTE_CE=https://us-central1-masmelito-f209c.cloudfunctions.net/api/payments/webhook
ROUTE_P2=https://us-central1-proyecto2.cloudfunctions.net/api/payments/webhook
```

En código:

```typescript
// Construir tabla de routing desde env vars
const routes: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('ROUTE_') && value) {
    const prefix = key.slice(6).toLowerCase() // ROUTE_CE → ce
    routes[prefix] = value
  }
}

function getDestination(prefix: string): string | undefined {
  return routes[prefix]
}
```

### Agregar un nuevo proyecto

1. Elegir un prefijo único (ej. `p2`)
2. El proyecto genera referencias con ese prefijo: `p2-{timestamp}-{random}`
3. Agregar env var al gateway: `ROUTE_P2=https://...`
4. Redeploy del gateway

---

## Validación de firma

### Opción A: No validar en gateway (recomendada)

El gateway reenvía el body tal cual. Cada proyecto destino valida la firma con su propio `WOMPI_EVENTS_SECRET`.

| Pro | Contra |
|---|---|
| Gateway más simple (~30 líneas) | El gateway reenvía webhooks falsos al destino |
| Cada proyecto maneja su propia seguridad | El destino gasta compute procesando webhooks inválidos |
| No necesita compartir secrets entre proyectos | — |
| Si Wompi cambia el formato de firma, solo se actualizan los destinos | — |

### Opción B: Validar en gateway

El gateway valida la firma antes de reenviar. Descarta webhooks falsos.

| Pro | Contra |
|---|---|
| Previene forwards de webhooks falsos | Requiere que el gateway tenga `WOMPI_EVENTS_SECRET` |
| Los destinos reciben solo webhooks legítimos | Todos los proyectos deben compartir el mismo events secret (misma cuenta Wompi, así que sí es el mismo) |
| Menos compute desperdiciado en destinos | Gateway más complejo (~60 líneas) |

### Recomendación: Opción B

Dado que todos los proyectos comparten la misma cuenta de Wompi, el `WOMPI_EVENTS_SECRET` es el mismo para todos. El gateway puede validar la firma una vez y descartar webhooks falsos antes de reenviar. El código de validación es ~15 líneas extra y previene abuso.

La lógica de validación es:

```typescript
// Replicar la validación de firma de Wompi
const { signature, timestamp, data } = body
const values = signature.properties.map((prop: string) => {
  // Navegar body.data por el path (ej. "transaction.id" → data.transaction.id)
  return prop.split('.').reduce((obj, key) => obj?.[key], data)
})
const concatenated = values.join('') + timestamp + WOMPI_EVENTS_SECRET
const computed = createHash('sha256').update(concatenated).digest('hex')
return computed === signature.checksum
```

> **Nota:** Aunque el gateway valide la firma, los proyectos destino **deben seguir validando** la firma también (defense in depth). El gateway es un layer extra, no un reemplazo.

---

## Cambios necesarios en Cielo Estrellado

### 1. Referencia — Sin cambios necesarios

La referencia ya tiene prefijo `ce-`:

```typescript
// payments.ts:61 — ya existe
const reference = `ce-${Date.now()}-${randomBytes(8).toString('hex')}`
```

El gateway parseará `ce` del primer segmento.

### 2. Webhook handler — Sin cambios necesarios

El webhook busca por `wompiReference` exacto en Firestore:

```typescript
// payments.ts:187-189
const paymentsSnap = await db.collection('payments')
  .where('wompiReference', '==', wompiReference)
  .limit(1)
  .get()
```

No depende del prefijo para la búsqueda — usa la referencia completa. Funciona igual con o sin gateway.

### 3. URL del webhook en Wompi Dashboard

Cambiar de:
```
https://us-central1-masmelito-f209c.cloudfunctions.net/api/payments/webhook
```
A:
```
https://us-central1-wompi-gateway.cloudfunctions.net/webhook
```

(La URL exacta depende del proyecto Firebase del gateway)

---

## Implementación del gateway

### Estructura del proyecto

```
wompi-gateway/
├── firebase.json
├── .firebaserc
└── functions/
    ├── package.json
    ├── tsconfig.json
    └── src/
        └── index.ts          # ~50-80 líneas, toda la lógica
```

### Código completo estimado

```typescript
// functions/src/index.ts
import { onRequest } from 'firebase-functions/v2/https'
import { createHash } from 'node:crypto'

// Construir tabla de routing desde env vars
const routes: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('ROUTE_') && value) {
    routes[key.slice(6).toLowerCase()] = value
  }
}

function validateSignature(body: Record<string, unknown>, secret: string): boolean {
  const signature = body.signature as { properties?: string[]; checksum?: string } | undefined
  const timestamp = body.timestamp
  const data = body.data as Record<string, unknown> | undefined

  if (!signature?.properties || !signature.checksum || !timestamp || !data) return false

  const values = signature.properties.map((prop: string) => {
    let current: unknown = data
    for (const part of prop.split('.')) {
      if (current !== null && typeof current === 'object') {
        current = (current as Record<string, unknown>)[part]
      } else {
        return ''
      }
    }
    return String(current ?? '')
  })

  const concatenated = values.join('') + String(timestamp) + secret
  const computed = createHash('sha256').update(concatenated).digest('hex')
  return computed === signature.checksum
}

export const webhook = onRequest(
  { region: 'us-central1', timeoutSeconds: 30 },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ message: 'Method not allowed' })
      return
    }

    const body = req.body as Record<string, unknown>

    // Validar firma
    const eventsSecret = process.env.WOMPI_EVENTS_SECRET
    if (!eventsSecret) {
      console.error('WOMPI_EVENTS_SECRET not configured')
      res.status(500).json({ message: 'Configuration error' })
      return
    }

    if (!validateSignature(body, eventsSecret)) {
      console.warn('Invalid webhook signature', { ip: req.ip })
      res.status(200).json({ message: 'Invalid signature' })
      return
    }

    // Extraer referencia y parsear prefijo
    const data = body.data as Record<string, unknown> | undefined
    const transaction = data?.transaction as Record<string, unknown> | undefined
    const reference = String(transaction?.reference ?? '')
    const prefix = reference.split('-')[0]

    if (!prefix || !routes[prefix]) {
      console.warn(`Unknown prefix: "${prefix}" from reference: "${reference}"`)
      res.status(200).json({ message: 'Unknown prefix' })
      return
    }

    // Reenviar al destino
    try {
      const response = await fetch(routes[prefix], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000), // 25s timeout (función tiene 30s)
      })

      res.status(response.status).json(await response.json())
    } catch (error) {
      console.error(`Forward failed for prefix "${prefix}":`, error)
      res.status(500).json({ message: 'Forward failed' })
    }
  }
)
```

### package.json mínimo

```json
{
  "name": "wompi-gateway",
  "main": "lib/index.js",
  "engines": { "node": "22" },
  "dependencies": {
    "firebase-admin": "^13.0.0",
    "firebase-functions": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  },
  "scripts": {
    "build": "tsc",
    "deploy": "npm run build && cd .. && firebase deploy --only functions"
  }
}
```

> **Nota:** `firebase-admin` es requerido por `firebase-functions` aunque no se use directamente. `fetch` es nativo en Node 22, no necesita `node-fetch`.

---

## Error handling

| Escenario | Comportamiento | Respuesta a Wompi |
|---|---|---|
| Firma inválida | Loguear warning, descartar | `200` (no reintentar basura) |
| Prefijo no reconocido | Loguear warning, descartar | `200` (no reintentar basura) |
| Sin referencia en el body | Loguear warning, descartar | `200` |
| Destino no responde / timeout | Loguear error | `500` (Wompi reintenta) |
| Destino responde con error | Pasar el status code del destino | Status code del destino |
| Error interno del gateway | Loguear error | `500` (Wompi reintenta) |

**Política de reintentos de Wompi:** Wompi reintenta webhooks que no reciben `200`. Para webhooks falsos o sin destino, siempre retornar `200` para evitar reintentos innecesarios. Solo retornar `500` cuando el destino legítimo falla (así Wompi reintenta y el destino eventualmente recibe el webhook).

---

## Seguridad

- **Endpoint público** — Wompi necesita acceso directo, no hay forma de restringir por IP
- **Validación de firma** — Primera línea de defensa contra webhooks falsos
- **Rate limiting** — Cloud Functions v2 permite configurar `maxInstances` para limitar concurrencia (ej. `maxInstances: 10`)
- **CORS** — No aplica (server-to-server)
- **Secrets** — `WOMPI_EVENTS_SECRET` configurado vía `firebase functions:secrets:set` o env vars en Cloud Run
- **No almacena datos** — El gateway no tiene Firestore, no guarda nada, solo reenvía

---

## Estimación de costos

Basado en Cloud Functions v2 (gen2) con pricing de Google Cloud Run:

| Concepto | Estimación |
|---|---|
| **Invocaciones** | ~100-500/mes (basado en volumen de pagos de un proyecto pequeño) |
| **Compute** | 256MB RAM, ~200ms por invocación = ~0.01-0.05 USD/mes |
| **Networking** | Egress mínimo (reenviar JSON de ~1KB) = ~0.00 USD/mes |
| **Total estimado** | < 0.10 USD/mes (dentro del free tier de Cloud Functions) |

Cloud Functions free tier: 2M invocaciones/mes, 400K GB-seconds. Este gateway no se acercará a esos límites.

---

## Plan de implementación

1. **Crear proyecto Firebase**
   ```bash
   firebase projects:create wompi-gateway
   mkdir wompi-gateway && cd wompi-gateway
   firebase init functions  # TypeScript, Node 22
   ```

2. **Escribir el código** — Copiar el código de la sección "Implementación del gateway" en `functions/src/index.ts`

3. **Configurar env vars**
   ```bash
   # Secret para validación de firma
   firebase functions:secrets:set WOMPI_EVENTS_SECRET

   # Rutas por proyecto
   firebase functions:config:set \
     route.ce="https://us-central1-masmelito-f209c.cloudfunctions.net/api/payments/webhook"
   ```
   > O usar `defineSecret` / `defineString` de firebase-functions/params.

4. **Deploy**
   ```bash
   cd functions && npm run build && cd .. && firebase deploy --only functions
   ```

5. **Verificar** — Enviar un POST manual al gateway con un body de prueba y verificar que llega al destino

6. **Configurar Wompi** — Actualizar la URL del webhook en el dashboard de Wompi

---

## Plan de migración (sin downtime)

```
Fase 1: Preparar (sin cambios en producción)
  ├─ Crear y deployar el gateway
  ├─ Verificar con requests de prueba que el forward funciona
  └─ Verificar que Cielo Estrellado procesa webhooks reenviados correctamente

Fase 2: Migrar (cambio atómico)
  ├─ Cambiar URL de webhook en dashboard de Wompi al gateway
  └─ (Las referencias ya tienen prefijo ce-, no hay cambio en el código)

Fase 3: Verificar
  ├─ Monitorear logs del gateway — confirmar que reenvía correctamente
  ├─ Monitorear logs de Cielo Estrellado — confirmar que procesa pagos normalmente
  └─ Hacer un pago de prueba end-to-end
```

**Riesgo de downtime:** Mínimo. El cambio de URL en Wompi es instantáneo. Si el gateway falla, Wompi reintenta automáticamente. En el peor caso, se revierte la URL en el dashboard a la URL directa de Cielo Estrellado.

**Rollback:** Cambiar la URL de webhook en Wompi de vuelta a la URL directa de Cielo Estrellado. Tiempo de rollback: ~30 segundos.

---

## Convenciones de prefijo

| Proyecto | Prefijo | Ejemplo de referencia |
|---|---|---|
| Cielo Estrellado | `ce` | `ce-1711234567890-a1b2c3d4e5f6g7h8` |
| (Futuro proyecto) | `p2` | `p2-1711234567890-b2c3d4e5f6g7h8i9` |

**Regla:** El prefijo es todo antes del primer `-` en la referencia. Debe ser único por proyecto. 2-4 caracteres alfanuméricos lowercase.
