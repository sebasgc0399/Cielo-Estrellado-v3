# AUDIT REPORT — Cielo Estrellado v3

**Fecha:** 2026-03-24
**Alcance:** Firebase Cloud Functions (backend) + React SPA (frontend)
**Commit auditado:** `7273ff3` (branch `main`)

---

## Estado general

| Area | Estado |
|------|--------|
| Seguridad (auth, permisos) | VERDE — Todos los endpoints protegidos usan `authenticateRequest`. Sin escrituras directas a Firestore desde cliente. |
| Integridad de datos | ROJO — Bug critico: `userSync` nunca se invoca, usuarios nuevos no tienen documento en Firestore. |
| Consistencia de reglas de negocio | AMARILLO — Default de `maxSkies` inconsistente entre handlers (2 vs 3). Magic numbers duplicados. |
| Calidad de codigo | AMARILLO — Manejo de errores debil en algunos hooks. Optimistic updates sin rollback. |
| Mantenibilidad | VERDE — Capas bien separadas. Contratos y catalogo sincronizados entre frontend y backend. |

**Veredicto global: AMARILLO** — Arquitectura solida, pero un bug critico bloquea el registro de usuarios nuevos y hay inconsistencias que pueden causar comportamiento inesperado.

---

## Resumen de hallazgos

| # | Severidad | Hallazgo | Archivo principal |
|---|-----------|----------|-------------------|
| 1 | CRITICO | `userSync` nunca se llama desde frontend | `frontend/src/lib/auth/AuthContext.tsx:53` |
| 2 | CRITICO | Default de `maxSkies` inconsistente (2 vs 3) | `functions/src/handlers/shop.ts:62` |
| 3 | MEDIO | Magic numbers hardcodeados en multiples handlers | `functions/src/handlers/userSync.ts:62` |
| 4 | MEDIO | Fallback de stardust usa 100 hardcodeado | `functions/src/handlers/economy.ts:57` |
| 5 | MEDIO | `useSkyStars` solo hace `console.error` en fallo | `frontend/src/hooks/useSkyStars.ts:52` |
| 6 | MEDIO | `getTransactions` no valida existencia de usuario | `functions/src/handlers/economy.ts:218` |
| 7 | MEDIO | `getCatalog` no valida existencia de usuario | `functions/src/handlers/shop.ts:104` |
| 8 | MEDIO | Optimistic update de stardust sin rollback | `frontend/src/hooks/useUserEconomy.ts:63` |
| 9 | BAJO | Naming inconsistente: `economy.ts` vs `economyRules.ts` | `frontend/src/domain/economy.ts` |
| 10 | BAJO | Sin prevencion de doble-click en llamadas API | Componentes varios |
| 11 | BAJO | Posicion de estrella no validada en frontend | `frontend/src/pages/SkyPage.tsx:77` |
| 12 | BAJO | Mensajes de error genericos en catch blocks | Todos los handlers |
| 13 | BAJO | Riesgo de archivos huerfanos en Storage | `frontend/src/components/sky/StarFormSheet.tsx` |
| 14 | BAJO | `previewInvite` retorna 200 en caso de error | `functions/src/handlers/invitePublic.ts:48` |

---

## Hallazgos detallados

### CRITICOS

#### #1 — userSync nunca se llama desde frontend

- **Archivo:** `frontend/src/lib/auth/AuthContext.tsx` lineas 53-55
- **Descripcion:** El endpoint `POST /api/userSync` existe y funciona correctamente en `functions/src/handlers/userSync.ts`, pero ni el listener `onIdTokenChanged` (linea 53) ni los metodos de autenticacion (`signInWithEmail`, `signUpWithEmail`, `signInWithGoogle`) lo invocan. El listener solo ejecuta `setUser(toAuthUser(firebaseUser))` sin llamar al backend. Sin esta llamada, el documento `users/{uid}` en Firestore nunca se crea para usuarios nuevos.
- **Impacto:** Bloquea completamente el registro. Usuarios nuevos reciben 404 en `GET /api/user/economy` y 500 al crear cielos. La aplicacion es inutilizable para nuevos registros.
- **Evidencia:** Documentado tambien en `BUG_ANALYSIS_userSync.md`.
- **Fix sugerido:** Agregar `await api('/api/userSync', { method: 'POST' })` dentro del callback de `onIdTokenChanged` cuando `firebaseUser` es truthy. `userSync` ya es idempotente (solo actualiza `lastLoginAt` si el doc existe).

#### #2 — Default de maxSkies inconsistente (2 vs 3)

- **Archivos:**
  - `functions/src/handlers/shop.ts` linea 62: `rawData.maxSkies : 3`
  - `functions/src/handlers/skies.ts` linea 87: `userData.maxSkies : 2`
  - `functions/src/handlers/userSync.ts` lineas 62, 94: `maxSkies: 2`
- **Descripcion:** Cuando `maxSkies` no existe en el documento del usuario, `shop.ts` usa un default de 3 mientras que `skies.ts` y `userSync.ts` usan 2. Si un usuario compra un sky-slot y su documento no tiene `maxSkies`, el handler de tienda sumara 1 a 3 (resultado: 4) en vez de sumar 1 a 2 (resultado: 3).
- **Impacto:** Un usuario podria terminar con mas sky-slots de los que deberia. Afecta la economia.
- **Fix sugerido:** Cambiar el default en `shop.ts:62` de 3 a 2. Mejor aun: extraer `DEFAULT_MAX_SKIES = 2` a `economyRules.ts` e importar en todos los handlers.

---

### MEDIOS

#### #3 — Magic numbers hardcodeados en multiples handlers

- **Archivos:**
  - `functions/src/handlers/userSync.ts` lineas 62-63, 94-95: `maxSkies: 2`, `maxMemberships: 20`
  - `functions/src/handlers/skies.ts` linea 87: `maxSkies` default 2
  - `functions/src/handlers/invitePublic.ts` linea 66: `maxMemberships` default 20
- **Descripcion:** `maxSkies: 2` aparece en 3 archivos y `maxMemberships: 20` en 3 archivos como literales numericos. Cambiar un limite requiere buscar y actualizar multiples archivos manualmente, con riesgo de omitir alguno (como ya ocurrio en el hallazgo #2).
- **Fix sugerido:** Exportar `DEFAULT_MAX_SKIES` y `DEFAULT_MAX_MEMBERSHIPS` desde `economyRules.ts` y reemplazar todos los literales.

#### #4 — Fallback de stardust usa 100 hardcodeado en vez de constante

- **Archivo:** `functions/src/handlers/economy.ts` linea 57
- **Descripcion:** `const stardust = typeof rawData.stardust === 'number' ? rawData.stardust : 100`. El modulo ya importa `DAILY_LOGIN_REWARD`, `STREAK_7_BONUS`, etc. desde `economyRules.ts`, pero el fallback de 100 no usa la constante `WELCOME_BONUS` que existe en ese mismo archivo.
- **Impacto:** Si `WELCOME_BONUS` cambia, este fallback quedara desincronizado.
- **Fix sugerido:** Importar `WELCOME_BONUS` y usar `rawData.stardust ?? WELCOME_BONUS`.

#### #5 — useSkyStars solo hace console.error en fallo de listener

- **Archivo:** `frontend/src/hooks/useSkyStars.ts` lineas 51-54
- **Descripcion:** El callback de error del `onSnapshot` solo ejecuta `console.error('Stars listener error:', err)` y `setError(err)`. Aunque el hook expone `error` al componente padre, ningun componente consumidor muestra feedback al usuario.
- **Impacto:** El usuario ve un cielo vacio sin explicacion si el listener de Firestore falla.
- **Fix sugerido:** Los componentes que consumen este hook deben verificar `error` y mostrar un toast o mensaje de error en la UI.

#### #6 — getTransactions no valida existencia de usuario

- **Archivo:** `functions/src/handlers/economy.ts` lineas 218-263
- **Descripcion:** `getTransactions` accede directamente a `userRef.collection('transactions')` sin verificar que el documento del usuario exista. Si el usuario no tiene documento (hallazgo #1), la query retorna lista vacia en vez de un error informativo.
- **Impacto:** Bajo si se corrige el hallazgo #1. Sin esa correccion, enmascara el problema real.
- **Fix sugerido:** Agregar check de `userSnap.exists` antes de la query, retornando 404 si no existe.

#### #7 — getCatalog no valida existencia de usuario

- **Archivo:** `functions/src/handlers/shop.ts` lineas 104-123
- **Descripcion:** Lee la subcollection `inventory` sin verificar que el documento padre del usuario exista. Si no existe, retorna catalogo con `owned: false` para todo — correcto por coincidencia, pero no intencional.
- **Fix sugerido:** Agregar check de existencia del usuario. Retornar 404 si no existe.

#### #8 — Optimistic update de stardust sin rollback

- **Archivo:** `frontend/src/hooks/useUserEconomy.ts` lineas 63-64
- **Descripcion:** `addStardust(amount)` actualiza el estado local inmediatamente (`prev.stardust + amount`). Si la operacion del servidor falla, el balance local queda inflado hasta el proximo `refetch()`.
- **Impacto:** El usuario podria ver un balance incorrecto temporalmente. No causa perdida de datos.
- **Fix sugerido:** Que el caller haga rollback en el `.catch()` con `addStardust(-amount)`, o mejor, usar `refetch()` tras confirmacion del servidor.

---

### BAJOS

#### #9 — Naming inconsistente de archivos de dominio

- **Archivos:** `frontend/src/domain/economy.ts` vs `functions/src/domain/economyRules.ts`
- **Descripcion:** Ambos archivos son identicos en contenido pero tienen nombres distintos. `contracts.ts`, `policies.ts` y `shopCatalog.ts` si usan el mismo nombre en ambos lados.
- **Fix sugerido:** Renombrar `frontend/src/domain/economy.ts` a `economyRules.ts` para consistencia.

#### #10 — Sin prevencion de doble-click en llamadas API

- **Descripcion:** Acciones como crear estrellas, aceptar invitaciones o comprar items no deshabilitan el boton durante la ejecucion. Multiples clicks rapidos pueden enviar requests duplicados.
- **Impacto:** Mitigado parcialmente por validaciones server-side (idempotencia de compras por `already_owned`), pero genera requests innecesarios.
- **Fix sugerido:** Agregar estado `isSubmitting` en los componentes relevantes para deshabilitar botones durante requests.

#### #11 — Posicion de estrella no validada en frontend

- **Archivo:** `frontend/src/pages/SkyPage.tsx` linea 77
- **Descripcion:** El frontend envia `xNormalized` y `yNormalized` sin verificar rango [0, 1] antes de la llamada API. El backend valida correctamente, pero genera un round-trip innecesario si los valores estan fuera de rango.
- **Fix sugerido:** Clampar valores a [0, 1] en el frontend antes de enviar.

#### #12 — Mensajes de error genericos en catch blocks

- **Descripcion:** Todos los handlers retornan mensajes como "Error interno del servidor". El `console.error` loguea el error real, pero el cliente no recibe informacion util.
- **Fix sugerido:** Agregar un campo `errorCode` machine-readable en las respuestas de error para facilitar debugging desde el frontend. No enviar detalles internos (correcto por seguridad).

#### #13 — Riesgo de archivos huerfanos en Storage

- **Archivo:** `frontend/src/components/sky/StarFormSheet.tsx`
- **Descripcion:** Si la estrella se crea exitosamente pero el upload de imagen falla, o si el upload se completa pero el PATCH para asociar `imagePath` falla, el archivo queda huerfano en Storage sin referencia.
- **Fix sugerido:** Implementar cleanup via Cloud Function trigger o TTL policy en el bucket de Storage.

#### #14 — previewInvite retorna 200 en caso de error

- **Archivo:** `functions/src/handlers/invitePublic.ts` linea 48
- **Descripcion:** El catch block retorna `res.status(200).json({ valid: false })` incluso para errores de servidor. Esto es intencional (endpoint publico que no debe revelar informacion), pero dificulta distinguir invitaciones invalidas de errores reales en monitoreo.
- **Fix sugerido:** Mantener el 200 al cliente pero agregar un log con severidad `warn` para distinguir de invitaciones simplemente invalidas.

---

## Endpoints: cobertura frontend

Los 22 endpoints registrados en `functions/src/index.ts` fueron verificados contra llamadas en el frontend:

| Endpoint | Metodo | Llamado desde frontend |
|----------|--------|----------------------|
| `/userSync` | POST | NO — hallazgo #1 |
| `/user/economy` | GET | SI — `useUserEconomy.ts:42` |
| `/user/transactions` | GET | SI — `TransactionHistory.tsx:64,84` |
| `/shop/catalog` | GET | SI — `ShopPage.tsx` |
| `/shop/purchase` | POST | SI — `ShopPage.tsx:35`, `SkiesPage.tsx:133` |
| `/skies` | GET | SI — `SkiesPage.tsx:89` |
| `/skies` | POST | SI — `SkiesPage.tsx:112` |
| `/skies/:skyId` | GET | SI — `useSkyData.ts:29` |
| `/skies/:skyId` | PATCH | SI — `SkySettingsSheet.tsx:118,196` |
| `/skies/:skyId/theme` | PATCH | SI — `SkySettingsSheet.tsx:229` |
| `/skies/:skyId` | DELETE | SI — `SkiesPage.tsx:180` |
| `/skies/:skyId/stars` | POST | SI — `StarFormSheet.tsx:102` |
| `/skies/:skyId/stars/:starId` | PATCH | SI — `StarFormSheet.tsx:110,138` |
| `/skies/:skyId/stars/:starId` | DELETE | SI — `StarFormSheet.tsx:156` |
| `/skies/:skyId/members` | GET | SI — `CollaboratorsSheet.tsx:86` |
| `/skies/:skyId/members/leave` | POST | SI — `SkySettingsSheet.tsx:212` |
| `/skies/:skyId/members/:userId` | PATCH | SI — `CollaboratorsSheet.tsx:116,133` |
| `/skies/:skyId/invites` | POST | SI — `CollaboratorsSheet.tsx:150` |
| `/skies/:skyId/invites` | GET | SI — `CollaboratorsSheet.tsx:91` |
| `/skies/:skyId/invites/:inviteId` | DELETE | SI — `CollaboratorsSheet.tsx:102` |
| `/invites/:token/preview` | GET | SI — `InvitePage.tsx:56` |
| `/invites/:token/accept` | POST | SI — `InvitePage.tsx:69` |

**Resultado:** 21/22 endpoints se usan correctamente. Solo `POST /userSync` no se llama (hallazgo #1).

---

## Hallazgos positivos

| Area | Detalle |
|------|---------|
| Autenticacion | 21 endpoints protegidos usan `authenticateRequest`. `previewInvite` correctamente omite auth (publico). |
| Escrituras | Zero escrituras a Firestore desde el frontend. Todas van via Cloud Functions. |
| Contratos | `contracts.ts`, `policies.ts`, `shopCatalog.ts` son identicos entre frontend y backend. |
| Auth en hooks | Todos los hooks verifican estado de autenticacion antes de hacer llamadas API. |
| Cleanup de efectos | Todos los hooks implementan patrones de cancelacion (`cancelled` flag, `unsubscribe`). |
| Economia | Valores de rewards provienen de constantes en `economyRules.ts`. Precios vienen de `SHOP_CATALOG`. |
| Atomicidad | Operaciones criticas (compras, balance, memberships) usan transacciones de Firestore. |
| Testing | 114 tests en verde. Cobertura de handlers, hooks y logica de dominio. |
| Secrets | No hay credenciales ni `.env` files en el repositorio. Correctamente en `.gitignore`. |

---

## Plan de accion recomendado

### Prioridad 1 — Inmediato (bloquea usuarios nuevos)
1. Fix #1: Agregar llamada a `POST /api/userSync` en `AuthContext.tsx`
2. Fix #2: Corregir default de `maxSkies` en `shop.ts:62` de 3 a 2

### Prioridad 2 — Sprint actual (consistencia de negocio)
3. Fix #3 + #4: Extraer `DEFAULT_MAX_SKIES`, `DEFAULT_MAX_MEMBERSHIPS` a `economyRules.ts` y reemplazar magic numbers. Usar `WELCOME_BONUS` en `economy.ts:57`.
4. Fix #6 + #7: Agregar validacion de existencia de usuario en `getTransactions` y `getCatalog`.

### Prioridad 3 — Siguiente sprint (calidad y UX)
5. Fix #5 + #8: Mejorar manejo de errores en hooks y rollback de optimistic updates.
6. Fix #9: Renombrar `economy.ts` a `economyRules.ts` en frontend.
7. Fix #10: Agregar `isSubmitting` state para prevencion de doble-click.

### Prioridad 4 — Backlog
8. Fixes #11, #12, #13, #14.
