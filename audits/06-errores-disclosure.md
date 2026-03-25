# Auditoria: Manejo de Errores y Disclosure

**Fecha:** 2026-03-25
**Alcance:** Todos los handlers en `functions/src/handlers/`, `functions/src/router.ts`, `functions/src/middleware/auth.ts`, `frontend/src/lib/api/client.ts`
**Severidad general:** Baja

## Resumen ejecutivo

El manejo de errores es consistente y seguro. Todos los handlers siguen el patron try/catch con respuestas genericas al cliente y logging interno detallado. No se exponen stack traces ni mensajes internos. Se identifican **0 criticos**, **1 medio** y **3 bajos** relacionados con logging del objeto error completo, inconsistencia en formato de respuesta, y un caso donde se expone informacion de configuracion.

---

## Hallazgos

### [MEDIO] M1 — `console.error` loguea objetos `error` completos, incluyendo posible informacion sensible

- **Archivo:** Todos los handlers (30+ instancias)
- **Descripcion:** La mayoria de los handlers loguean el error completo sin filtrar:
  ```typescript
  } catch (error) {
    console.error('Star creation failed:', error)  // error completo
    res.status(500).json({ error: 'Error interno al crear la estrella' })
  }
  ```
  En Cloud Functions, `console.error` escribe a Cloud Logging. Si el error es un objeto de Firestore o Firebase Auth, puede contener tokens, paths internos, configuracion del proyecto, o datos del usuario en su payload.

  Contraste con `invitePublic.ts:48` que SI filtra:
  ```typescript
  console.error('Invite preview failed:', error instanceof Error ? error.message : String(error))
  ```
  Y `economy.ts:190` que tambien filtra:
  ```typescript
  console.error('Failed to create audit log:', logError instanceof Error ? logError.message : logError)
  ```
- **Impacto:** Los logs de Cloud Functions son accesibles a quien tenga permisos de Cloud Logging en el proyecto GCP. Si un error de Firestore incluye datos del documento, estos quedan en logs. No es una vulnerabilidad de la aplicacion per se, pero es una mala practica de higiene de datos.
- **Recomendacion:** Estandarizar el patron de logging a solo `error.message`:
  ```typescript
  console.error('Handler failed:', error instanceof Error ? error.message : String(error))
  ```
  O crear un helper minimo:
  ```typescript
  function logError(context: string, error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`${context}:`, msg)
  }
  ```

---

### [BAJO] B1 — Mensajes de error 500 revelan el tipo de operacion que fallo

- **Archivo:** Todos los handlers
- **Descripcion:** Los mensajes de error 500 son descriptivos sobre la operacion:
  - `"Error interno al crear la estrella"`
  - `"Error interno al procesar compra"`
  - `"Error interno al sincronizar usuario"`
  - `"Error de configuración de pagos"` (payments.ts:36,43)

  Estos mensajes ayudan al usuario a entender que paso, pero un atacante puede inferir la funcionalidad del endpoint por el mensaje de error.
- **Impacto:** Minimo. Los endpoints ya son conocidos por el frontend (API client). Los mensajes no revelan detalles de implementacion (no dicen "Firestore transaction failed" ni "Firebase Auth error").
- **Recomendacion:** Aceptable como esta. Los mensajes son utiles para UX sin revelar internals. Solo considerar cambiar `"Error de configuración de pagos"` a un mensaje mas generico, ya que revela que es un problema de config vs logica.

### [BAJO] B2 — Formato de respuesta de error no estandarizado

- **Archivo:** Todos los handlers
- **Descripcion:** Las respuestas de error tienen formatos ligeramente diferentes:
  - Mayoria: `{ error: 'mensaje' }`
  - Shop errors: `{ error: 'mensaje', code: 'error_code' }`
  - CreateSky limit: `{ error: 'mensaje', maxSkies: N, currentCount: N }`
  - AcceptInvite already_member: `{ error: 'mensaje', skyId: '...' }`
  - Webhook: `{ message: '...' }` (no `error`)
  - Success: `{ ok: true }`, `{ skyId: '...' }`, `{ status: '...' }` (variado)

- **Impacto:** El frontend tiene que manejar multiples formatos. `ApiError` en el client solo captura `response.text()`, no parsea JSON, lo que significa que los campos extra (`code`, `maxSkies`) se pierden a menos que el consumidor parsee manualmente.
- **Recomendacion:** Considerar un formato estandar para futuras features:
  ```typescript
  // Error
  { error: { message: string, code?: string, details?: Record<string, unknown> } }
  // Success
  { data: T }
  ```
  No es urgente refactorizar lo existente, pero documentar la convencion para nuevos handlers.

### [BAJO] B3 — `invites.ts:36` expone que `APP_URL` no esta configurado

- **Archivo:** `functions/src/handlers/invites.ts:34-37`
- **Descripcion:**
  ```typescript
  const appUrl = process.env.APP_URL?.trim()
  if (!appUrl) {
    res.status(500).json({ error: 'APP_URL no configurado' })
    return
  }
  ```
  Esto expone al cliente que una variable de entorno especifica no esta configurada.
- **Impacto:** Bajo. Un atacante sabe que existe `APP_URL` como variable de configuracion, lo cual no es util para un ataque.
- **Recomendacion:** Cambiar a un mensaje generico:
  ```typescript
  res.status(500).json({ error: 'Error de configuración del servidor' })
  ```

---

## Mapa de manejo de errores por handler

| Handler | try/catch | 500 generico | Error logging | Formato |
|---------|-----------|-------------|---------------|---------|
| userSync | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| getEconomy | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| getTransactions | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| purchase | ✅ | ✅ | `error` completo ⚠️ | `{ error, code }` |
| getCatalog | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| createPayment | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| wompiWebhook | ✅ | ✅ (siempre 200) | `error` completo ⚠️ | `{ message }` |
| getPaymentStatus | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| getUserSkies | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| createSky | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| getSky | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| updateSky | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| updateSkyTheme | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| deleteSky | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| createStar | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| updateStar | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| deleteStar | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| createInvite | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| listInvites | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| revokeInvite | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| previewInvite | ✅ | ✅ | **filtrado** ✅ | `{ valid }` |
| acceptInvite | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| listMembers | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| updateMember | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |
| leaveSky | ✅ | ✅ | `error` completo ⚠️ | `{ error }` |

**100% de handlers tienen try/catch y respuestas genericas al cliente.** El unico gap es el logging verbose.

---

## Aspectos positivos

1. **100% try/catch:** Todos los handlers envuelven su logica en try/catch. Ningun error no capturado puede crashear el proceso o exponer un stack trace.
2. **Mensajes genericos al cliente:** Ningun handler retorna `error.message` ni `error.stack` al usuario. Siempre mensajes estaticos como `"Error interno al..."`.
3. **Codigos HTTP correctos:**
   - 400 para inputs invalidos
   - 401 via `HttpsError('unauthenticated')` en middleware
   - 403 para falta de permisos
   - 404 para recursos no encontrados
   - 409 para conflictos (invitaciones)
   - 500 para errores internos
4. **Webhook siempre retorna 200:** Correcto para evitar reintentos innecesarios de Wompi.
5. **Errores de negocio tipados:** `ShopError`, `PaymentError`, `InviteError`, `RevokeError` con codigos semanticos permiten manejo diferenciado sin exponer internals.
6. **Router 404:** Rutas no reconocidas retornan `{ error: 'Not found' }` sin informacion adicional.
7. **Frontend con auto-retry:** El API client reintenta en 401 con token refrescado antes de redirigir a login.
8. **Frontend sin stack traces:** `ApiError` solo contiene status + message text, no detalles internos.
9. **Reward failures non-blocking:** Errores en acreditacion de PE no bloquean la operacion principal (stars, invites).
10. **`previewInvite` filtra error:** Unico handler que filtra `error.message` antes de loguear — patron a seguir.

---

## Frontend: manejo de errores en API client

| Escenario | Comportamiento | Correcto? |
|-----------|---------------|-----------|
| 401 | Refresca token, reintenta, redirige a `/login` si falla | ✅ |
| 204 | Retorna `undefined as T` | ✅ |
| Otro error | Lanza `ApiError(status, text)` | ✅ |
| Network error | `fetch` lanza — no capturado en `api()`, propaga al caller | ⚠️ parcial |
| Response no-JSON en 200 | `.json()` lanza — propaga al caller | ⚠️ parcial |

---

## Conclusion

El manejo de errores es robusto y seguro. No hay fuga de informacion tecnica al cliente. El hallazgo medio (M1) es una mejora de higiene de logs que no afecta la seguridad de la aplicacion sino la seguridad de los datos en Cloud Logging. Los hallazgos bajos son refinamientos de consistencia.

### Proximos pasos recomendados (por prioridad):
1. Estandarizar logging a `error.message` en todos los handlers (M1)
2. Cambiar mensaje de `APP_URL no configurado` a generico (B3)
3. Documentar convencion de formato de error para nuevos handlers (B2)
