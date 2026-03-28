# CLAUDE.md — Cielo Estrellado v5

## Filosofia operativa

- **Simplicidad extrema.** La solucion mas simple que funcione es la correcta. Si tres lineas resuelven el problema, no crear una abstraccion.
- **Entender el dominio antes de codear.** Un cielo tiene estrellas, miembros e invitaciones. Un usuario tiene Polvo Estelar (balance), inventario (temas desbloqueados) y un limite de cielos. Toda decision tecnica debe partir de ese modelo, no al reves.
- **No abstracciones prematuras.** No crear helpers, utils ni wrappers hasta que haya al menos 3 usos reales. Duplicar es mejor que abstraer sin motivo.
- **Soluciones directas, verificables, mantenibles.** Si no se puede verificar que funciona en menos de 2 minutos, probablemente es demasiado compleja.

## Principios tecnicos

- **TypeScript estricto.** `strict: true` en ambos tsconfig. Cero `any`. Tipar explicitamente lo que no se infiere.
- **Separacion clara de capas:**
  - `engine/` — rendering puro, sin dependencias de React ni Firebase
  - `domain/` — contratos, tipos, catalogo de tienda, reglas de economia, definiciones de temas (compartido entre frontend y functions)
  - `lib/` — integraciones (Firebase, API client, auth)
  - `hooks/` — logica reactiva que conecta lib con UI
  - `components/` — solo presentacion e interaccion
  - `pages/` — composicion de componentes + routing
  - `handlers/` (functions) — logica de negocio del backend
- **Tailwind CSS + shadcn/ui.** Utility-first con componentes de shadcn. Magic UI para animaciones premium.
  Design tokens via CSS custom properties en globals.css + extension en tailwind.config.
  Objetivo: diseno unico y premium, nunca generico.
- **Consistencia de naming:**
  - Archivos: `PascalCase.tsx` para componentes, `camelCase.ts` para todo lo demas
  - Funciones/variables: `camelCase`
  - Tipos/interfaces: `PascalCase`, sin prefijo `I`
  - Constantes: `UPPER_SNAKE_CASE`
- **No crear archivos fuera del scope.** Cada archivo nuevo debe justificarse con un uso inmediato. No crear "por si acaso".
- **Formato de respuesta de error en handlers:**
  - Error generico: `{ error: 'Mensaje descriptivo para el usuario' }`
  - Error de negocio con codigo: `{ error: 'Mensaje', code: 'error_code' }`
  - Error con datos contextuales: `{ error: 'Mensaje', ...campos_relevantes }`
  - Webhook Wompi: `{ message: '...' }` (convencion de Wompi, no cambiar)
  - No mezclar `error` y `message` como clave principal en el mismo tipo de endpoint.

## Regla de complejidad

Si introduces complejidad (nueva dependencia, nueva capa de abstraccion, patron no trivial), justifica:
1. Que problema resuelve
2. Por que no hay alternativa mas simple
3. Que costo de mantenimiento agrega

Si no puedes responder las tres, simplifica.

## Orquestacion con subagentes

Para tareas complejas, evaluar si conviene dividir el trabajo en subagentes paralelos.
Usar la skill `orchestrate` para la estrategia de delegacion. No duplicar trabajo entre agente principal y subagentes.

## Politica de cambios de alto impacto (mini-RFC)

Antes de tocar cualquiera de estos, proponer el cambio y esperar aprobacion:
- Modelo de datos en Firestore (colecciones, campos, indices)
- Flujo de autenticacion o permisos
- Estructura de carpetas o capas del proyecto
- Dependencias nuevas al proyecto
- Cambios en la API publica del SkyEngine
- Configuracion de Firebase (rules, hosting, functions)

Formato: que se cambia, por que, que alternativas se descartaron, que se rompe si sale mal.

## Contexto del proyecto

- **Stack:** React 19 + Vite 6 + TypeScript (frontend), Cloud Functions v2 gen2 + Node 22 (backend)
- **Firebase project:** `masmelito-f209c`
- **SkyEngine se modifica para aceptar `ThemeParams`** (mini-RFC aprobado en SPEC_v2.md §2.2). El cambio es quirurgico: parametrizar colores hardcodeados. Cualquier cambio adicional al engine sigue requiriendo mini-RFC.
- **Fase actual:** Economia (Fase 1) y temas (Fase 2) completados. 114 tests en verde. Siguiente: Fase 3 (pagos reales + temas avanzados).
- **Reads directos desde cliente** via `onSnapshot`. Solo writes van por Cloud Functions.
- **Sin SSR.** SPA pura desplegada en Firebase Hosting.
- **Pagos:** Wompi (Bancolombia) para compra de Polvo Estelar con dinero real (COP). Nequi, PSE, tarjetas.

## Testing

- **Framework:** Vitest v4.1.1 en frontend y functions.
- **Tests al lado del codigo:** `economy.ts` → `economy.test.ts` en la misma carpeta.
- **Patron de mocking backend:** `vi.hoisted()` + `vi.mock()` para `firebaseAdmin`, `authenticateRequest`. `mockReset()` en `beforeEach`.
- **Patron de mocking frontend:** `vi.mock()` para `api()`, `useAuth()`. `@testing-library/react` para hooks y componentes.
- **Correr tests antes de deploy.** Si un test falla, no deployar. Arreglar el test o el codigo.
- **Cada feature nueva debe incluir tests.** Minimo: tests unitarios de la logica de negocio. Ideal: tambien tests del handler/hook.
- **No testear implementacion, testear comportamiento.** El test describe *que* debe pasar, no *como* se implementa.
- **Guia completa:** `SPEC_Test.md` — fases, archivos, tests especificos, patrones de mocking.

## Comandos

```bash
# Frontend
cd frontend && npm run dev          # Dev server (proxy /api → produccion)
cd frontend && npm run build        # Build produccion
cd frontend && npm run test         # Tests en watch mode
cd frontend && npm run test:run     # Tests single run (CI)

# Functions
cd functions && npm run build       # Compilar TypeScript
cd functions && npm run test        # Tests en watch mode
cd functions && npm run test:run    # Tests single run (CI)

# Deploy (correr tests antes)
cd functions && npm run test:run && npm run build && cd .. && firebase deploy --only functions
cd frontend && npm run test:run && npm run build && cd .. && firebase deploy --only hosting
firebase deploy                     # Todo junto
```

## Principios de economia

- **Todo grant de Polvo Estelar ocurre en Cloud Functions.** Nunca en el cliente. El cliente solo muestra el balance.
- **Catalogo de tienda es dato estatico en el bundle** (`shopCatalog.ts`). No se almacena en Firestore.
- **Resolucion de temas es client-side.** `themeId → ThemeParams` es un lookup estatico en `themes.ts`. El engine recibe parametros, no IDs.
- **Balance es campo en `UserRecord`**, no coleccion separada. Evita un read extra por auth check.
- **Compras usan transacciones Firestore atomicas.** Debito + inventario + log en una sola transaccion.
- **Pagos con dinero real via Wompi (Bancolombia).** El usuario compra paquetes de PE en COP. El flujo: Cloud Function crea transaccion → Wompi procesa → webhook confirma → acreditar PE. Nunca acreditar desde el cliente ni desde el endpoint de creacion — solo desde el webhook validado.

## Especificacion

- `SPEC.md` — features base (cielos, estrellas, miembros, invitaciones, auth, SkyEngine)
- `SPEC_v2.md` — economia (Polvo Estelar) y sistema de temas desbloqueables
- `SPEC_Test.md` — guia de testing (fases, archivos, tests, patrones de mocking)

Consultar antes de implementar cualquier feature o escribir tests.
