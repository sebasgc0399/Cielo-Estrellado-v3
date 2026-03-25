# Auditoria: Autenticacion y Autorizacion

**Fecha:** 2026-03-25
**Alcance:** `functions/src/middleware/auth.ts`, `functions/src/middleware/cors.ts`, `functions/src/index.ts`, `functions/src/router.ts`, `frontend/src/lib/auth/AuthContext.tsx`, `frontend/src/lib/api/client.ts`, `functions/src/handlers/userSync.ts`, `functions/src/handlers/invitePublic.ts`, `functions/src/lib/getSkyWithAccess.ts`
**Severidad general:** Media

## Resumen ejecutivo

La autenticacion es solida en su nucleo: Bearer token verificado por Firebase Admin SDK, aplicado en cada handler. Sin embargo, se identifican **2 hallazgos medios** y **3 bajos** relacionados con `sessionVersion` sin enforcement, race conditions en userSync, y CORS con localhost hardcodeado.

---

## Hallazgos

### [MEDIO] M1 — `sessionVersion` existe en el modelo pero NUNCA se valida

- **Archivo:** `functions/src/middleware/auth.ts:5-12`, `functions/src/handlers/userSync.ts:72`
- **Descripcion:** El campo `sessionVersion` se inicializa en `1` al crear un usuario (userSync.ts:72,87) y existe en el tipo `UserRecord`. Sin embargo, `authenticateRequest()` solo llama a `auth.verifyIdToken(token)` — nunca compara el `sessionVersion` del token con el almacenado en Firestore. Esto significa que **no hay forma de invalidar sesiones activas**.
- **Impacto:** Si un usuario necesita revocar todas sus sesiones (cuenta comprometida, cambio de password), no hay mecanismo para hacerlo. Los tokens de Firebase expiran en 1 hora, pero durante ese tiempo un token robado sigue siendo valido.
- **Recomendacion:** Dos opciones:
  1. **Simple:** Usar `auth.revokeRefreshTokens(uid)` de Firebase Admin para invalidar refresh tokens. Luego en `authenticateRequest`, pasar `checkRevoked: true` a `verifyIdToken`:
     ```typescript
     return auth.verifyIdToken(token, true) // true = checkRevoked
     ```
     Nota: esto agrega un read a Firebase Auth por cada request.
  2. **Si sessionVersion no se va a usar:** Eliminar el campo del modelo para evitar falsa sensacion de seguridad.

### [MEDIO] M2 — Race condition en welcome bonus de userSync

- **Archivo:** `functions/src/handlers/userSync.ts:26-104`
- **Descripcion:** El flujo tiene dos paths:
  - **Usuario nuevo** (linea 77-104): `batch.set(userRef, newUser)` — no es atomico contra otra invocacion concurrente. Si dos tabs se abren al mismo tiempo en el primer login, ambas podrian ejecutar el path `!userSnap.exists` y crear el usuario con `WELCOME_BONUS` dos veces (la segunda sobreescribiria la primera por `set`).
  - **Usuario existente sin economia** (linea 46-76): Usa `runTransaction` con fresh read, lo cual SI protege contra race conditions. Sin embargo, este path solo se ejecuta si el usuario ya existe pero no tiene `stardust`.
- **Impacto:** En el path de usuario nuevo, la segunda ejecucion sobreescribiria con `set`, asi que el balance final seria correcto (un solo `WELCOME_BONUS`). Pero se perderian datos del primer write (como `createdAt` del primer request). El batch tambien crea un `TransactionRecord`, que podria duplicarse.
- **Recomendacion:** Usar `set` con `{ merge: false }` (ya es el default) esta bien, pero envolver la creacion de usuario nuevo en una transaccion para evitar el `TransactionRecord` duplicado:
  ```typescript
  await db.runTransaction(async (t) => {
    const snap = await t.get(userRef)
    if (snap.exists) return // otro request ya lo creo
    t.set(userRef, newUser)
    t.create(userRef.collection('transactions').doc(), welcomeTx)
  })
  ```

---

### [BAJO] B1 — CORS permite `localhost:5173` en produccion

- **Archivo:** `functions/src/middleware/cors.ts:9`
- **Descripcion:** La funcion `getAllowedOrigin` siempre permite `http://localhost:5173`, independientemente del entorno. Esto aplica en produccion tambien.
- **Impacto:** Bajo. Un atacante necesitaria un token Bearer valido para hacer cualquier request, y CORS es una proteccion del navegador, no del servidor. Sin embargo, permite requests cross-origin desde un servidor local de desarrollo que podria estar comprometido.
- **Recomendacion:** Condicionar localhost al entorno:
  ```typescript
  if (process.env.NODE_ENV !== 'production' && requestOrigin === 'http://localhost:5173') {
    return requestOrigin
  }
  ```
  O usar una variable de entorno `CORS_ALLOWED_ORIGINS`.

### [BAJO] B2 — No hay autenticacion a nivel de router, sino por handler

- **Archivo:** `functions/src/index.ts:14-40`, `functions/src/router.ts`
- **Descripcion:** La autenticacion no se aplica como middleware en el router. Cada handler llama individualmente a `authenticateRequest(req)`. Esto funciona correctamente hoy — todos los handlers lo hacen excepto `wompiWebhook` y `previewInvite` que no lo necesitan. Sin embargo, un nuevo handler podria olvidar la llamada.
- **Impacto:** Bajo. Requiere un error del desarrollador para crear una vulnerabilidad. Los tests existentes mockean `authenticateRequest`, lo que mitiga parcialmente el riesgo.
- **Recomendacion:** No requiere cambio inmediato dado el tamano del equipo. Si el proyecto crece, considerar un approach declarativo en la definicion de rutas:
  ```typescript
  { method: 'POST', pattern: '/shop/purchase', handler: purchase, auth: true },
  { method: 'POST', pattern: '/payments/webhook', handler: wompiWebhook, auth: false },
  ```

### [BAJO] B3 — `acceptInviteHandler` requiere auth pero `previewInvite` no — verificar que preview no expone datos sensibles

- **Archivo:** `functions/src/handlers/invitePublic.ts:12-51`
- **Descripcion:** `previewInvite` es accesible sin autenticacion y retorna `{ valid, skyId, skyTitle, role }`. Esto es necesario para mostrar la preview antes de que el usuario se autentique.
- **Impacto:** Un atacante con un token de invitacion puede ver el titulo del cielo y el rol ofrecido. Dado que el token es necesario, esto es aceptable — quien tiene el token fue intencionalmente invitado.
- **Recomendacion:** Verificado como correcto. No expone datos sensibles (no retorna owner, miembros, ni estrellas). Solo confirmar que los tokens tienen suficiente entropia (ver Auditoria 8).

---

## Aspectos positivos

1. **`authenticateRequest` es minimalista y correcto:** Verifica Bearer token via Firebase Admin SDK `verifyIdToken()`, que valida firma, expiracion y audiencia automaticamente.
2. **Cobertura completa de autenticacion:** Todos los 26 handlers autenticados llaman a `authenticateRequest`. Solo 2 endpoints correctamente excluidos: `wompiWebhook` (validacion por firma SHA256) y `previewInvite` (publico por diseno).
3. **`acceptInviteHandler` SI requiere auth:** Aunque el preview es publico, aceptar la invitacion requiere Bearer token. Correcto.
4. **Control de acceso por rol via `getSkyWithAccess`:** Verifica existencia del sky + membresia activa. Los handlers que necesitan roles especificos (owner) hacen checks adicionales.
5. **CORS estricto:** Solo permite el origin de la app y localhost. Usa `Vary: Origin` correctamente para proxies/CDN.
6. **API client con auto-refresh:** En 401, intenta refrescar el token con `getIdToken(true)`. Si falla, redirige a `/login`. Patron robusto.
7. **`onIdTokenChanged` en vez de `onAuthStateChanged`:** El frontend escucha cambios de token (incluyendo refresh), no solo cambios de estado de auth. Esto asegura que `userSync` se llame al refrescar tokens.
8. **Router retorna 404 para rutas no matcheadas:** No hay default handler que pueda exponer informacion.
9. **HttpsError tipado:** El middleware lanza `HttpsError('unauthenticated', ...)` que se traduce automaticamente en HTTP 401.

---

## Matriz de autenticacion por endpoint

| Endpoint | Auth | Metodo de acceso |
|----------|------|------------------|
| POST /userSync | Bearer token | `authenticateRequest` |
| GET /user/economy | Bearer token | `authenticateRequest` |
| GET /user/transactions | Bearer token | `authenticateRequest` |
| GET /shop/catalog | Bearer token | `authenticateRequest` |
| POST /shop/purchase | Bearer token | `authenticateRequest` |
| POST /payments/create | Bearer token | `authenticateRequest` |
| **POST /payments/webhook** | **Firma SHA256** | **Wompi events secret** |
| GET /payments/:ref/status | Bearer token | `authenticateRequest` |
| GET/POST/PATCH/DELETE /skies/* | Bearer token | `authenticateRequest` + `getSkyWithAccess` |
| POST /skies/:id/invites | Bearer token | `authenticateRequest` + owner check |
| **GET /invites/:token/preview** | **Sin auth** | **Token en URL** |
| POST /invites/:token/accept | Bearer token | `authenticateRequest` |

Todos los endpoints estan correctamente clasificados.

---

## Conclusion

La autenticacion es funcionalmente correcta y robusta. Los hallazgos medios son mejoras defensivas: `sessionVersion` deberia implementarse o eliminarse (M1), y la race condition en userSync tiene impacto limitado pero deberia corregirse (M2). No se encontraron endpoints sin proteccion que debieran tenerla.

### Proximos pasos recomendados (por prioridad):
1. Decidir sobre `sessionVersion`: implementar `verifyIdToken(token, true)` o eliminar el campo (M1)
2. Envolver creacion de usuario nuevo en transaccion en userSync (M2)
3. Condicionar localhost en CORS al entorno de desarrollo (B1)
