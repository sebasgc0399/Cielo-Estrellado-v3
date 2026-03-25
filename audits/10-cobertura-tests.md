# Auditoria: Cobertura de Tests

**Fecha:** 2026-03-25
**Alcance:** Todos los `*.test.ts` y `*.test.tsx` del proyecto (excluyendo node_modules), comparacion contra archivos de implementacion
**Severidad general:** Media

## Resumen ejecutivo

El proyecto tiene 17 archivos de test con buena cobertura de la logica de economia y handlers criticos. Sin embargo, se identifican **gaps significativos** en handlers sin tests, escenarios negativos no cubiertos, y ausencia de tests para flujos de autorizacion. Se identifican **0 criticos**, **3 medios** y **4 bajos**.

---

## Inventario de tests

### Backend (`functions/src/`)

| Archivo de test | Archivo testeado | Tests | Cobertura |
|----------------|------------------|-------|-----------|
| `handlers/economy.test.ts` | `handlers/economy.ts` | 12 | Buena — daily, streak, weekly, idempotencia, retry, contadores |
| `handlers/payments.test.ts` | `handlers/payments.ts` | 13 | Buena — create, webhook, firma, idempotencia, status |
| `handlers/shop.test.ts` | `handlers/shop.ts` | 7 | Buena — compra exitosa, balance, already_owned, sky-slot, audit |
| `handlers/stars.test.ts` | `handlers/stars.ts` | 5 | Parcial — solo `createStar` rewards, no `updateStar`/`deleteStar` |
| `handlers/skies.test.ts` | `handlers/skies.ts` | 5 | Parcial — solo `createSky` y `updateSkyTheme`, no update/delete/get |
| `handlers/userSync.test.ts` | `handlers/userSync.ts` | (leido) | Presente |
| `handlers/invitePublic.test.ts` | `handlers/invitePublic.ts` | 3 | Parcial — solo `acceptInvite`, no `previewInvite` |
| `domain/economyRules.test.ts` | `domain/economyRules.ts` | 3 | Basica — constantes positivas, valores especificos |
| `domain/shopCatalog.test.ts` | `domain/shopCatalog.ts` | (existe) | Presente |

### Frontend (`frontend/src/`)

| Archivo de test | Archivo testeado | Cobertura |
|----------------|------------------|-----------|
| `domain/economy.test.ts` | `domain/economy.ts` | Constantes |
| `domain/themes.test.ts` | `domain/themes.ts` | Temas |
| `hooks/useUserEconomy.test.ts` | `hooks/useUserEconomy.ts` | Hook con loading, error, success |
| `components/economy/DailyRewardModal.test.tsx` | Component | Renderizado |
| `components/economy/StardustBalance.test.tsx` | Component | Renderizado |
| `components/economy/StardustOnboarding.test.tsx` | Component | Renderizado |
| `components/economy/StreakIndicator.test.tsx` | Component | Renderizado |
| `components/economy/TransactionHistory.test.ts` | Component | Renderizado |

---

## Hallazgos

### [MEDIO] M1 — Handlers sin tests: `invites.ts`, `members.ts`

- **Descripcion:** Los siguientes handlers no tienen archivos de test:
  - **`handlers/invites.ts`** — `createInviteHandler`, `listInvites`, `revokeInviteHandler`. Manejan autorizacion (owner-only), validacion de roles, y tienen multiple error paths.
  - **`handlers/members.ts`** — `listMembers`, `updateMember`, `leaveSky`. Incluyen logica de roles, verificacion de owner, y la transaccion atomica de `leaveSky`.

  Estas son funcionalidades con logica de autorizacion critica que deberian tener tests.
- **Impacto:** Regresiones en autorizacion (ej: un editor pudiendo revocar invitaciones) no serian detectadas por tests.
- **Recomendacion:** Agregar tests para:
  - `invites.ts`: crear invite como owner, rechazar como non-owner, validar rol, listar invites
  - `members.ts`: listar como owner, rechazar como editor, updateMember validaciones, leaveSky atomicidad, owner no puede abandonar

### [MEDIO] M2 — `updateStar` y `deleteStar` sin tests

- **Archivo:** `functions/src/handlers/stars.test.ts`
- **Descripcion:** Solo `createStar` tiene tests (5 tests de rewards). Los handlers `updateStar` y `deleteStar` no tienen tests a pesar de tener logica significativa:
  - `updateStar`: validacion de coordenadas, imagePath canonical check, sobreescritura prevenida, permisos editor-solo-sus-stars
  - `deleteStar`: soft-delete, permisos, limpieza de Storage
- **Impacto:** Regresiones en validacion de imagePath o permisos de edicion no serian detectadas.
- **Recomendacion:** Agregar tests para:
  - `updateStar`: validacion de imagePath (canonical, sobreescritura), permisos editor vs owner, coordenadas, no-op detection
  - `deleteStar`: soft-delete, permisos, limpieza de Storage (mock)

### [MEDIO] M3 — Sin tests de autorizacion cross-handler

- **Descripcion:** Cada handler testea su logica de negocio, pero no hay tests sistematicos que verifiquen:
  - Que un `viewer` no puede crear estrellas
  - Que un `editor` no puede eliminar estrellas de otros
  - Que un non-member no puede acceder a un cielo
  - Que `getSkyWithAccess` se llama correctamente y su resultado se respeta

  Los tests existentes mockean `getSkyWithAccess` para retornar siempre `{ ok: true, member: { role: 'owner' } }`, lo que significa que nunca se prueba el rechazo por falta de acceso.
- **Impacto:** Un cambio en `getSkyWithAccess` o en la logica de roles podria pasar inadvertido.
- **Recomendacion:** En los tests de `stars.ts` y `skies.ts`, agregar casos donde `getSkyWithAccess` retorna `{ ok: false }` y donde el rol es `viewer`.

---

### [BAJO] B1 — `previewInvite` sin tests

- **Archivo:** `functions/src/handlers/invitePublic.test.ts`
- **Descripcion:** Solo `acceptInviteHandler` tiene tests. `previewInvite` (el endpoint publico sin auth) no tiene tests. Este endpoint maneja:
  - Token invalido → `{ valid: false }`
  - Invite expirada → `{ valid: false }`
  - Invite valida → `{ valid: true, skyTitle, role }`
  - Error interno → `{ valid: false }` (no 500)
- **Recomendacion:** Agregar tests basicos para `previewInvite`.

### [BAJO] B2 — Lib files sin tests: `createInvite`, `findInviteIdByToken`, `revokeInvite`, `acceptInvite`, `getSkyWithAccess`

- **Descripcion:** Los archivos en `functions/src/lib/` no tienen tests unitarios propios. Se testean indirectamente via los handlers que los usan, pero con mocks que bypassean su logica real.
- **Impacto:** Bajo. `acceptInvite` y `revokeInvite` tienen logica de transaccion importante que se mockea en los tests de handlers. La logica real no se verifica.
- **Recomendacion:** Para `acceptInvite` y `revokeInvite`, considerar tests unitarios que verifiquen la logica de transaccion (estados, validaciones).

### [BAJO] B3 — Tests de frontend solo cubren componentes de economia, no de sky/shop

- **Descripcion:** Los tests de frontend cubren:
  - ✅ `useUserEconomy` hook
  - ✅ 5 componentes de economia (DailyRewardModal, StardustBalance, etc.)
  - ✅ Domain (economy, themes)
  - ❌ `StarFormSheet` (creacion/edicion de estrellas con upload)
  - ❌ `ThemePicker`, `ShopPage`
  - ❌ `SkyCanvas`, `SkyPage`, `SkiesPage`
  - ❌ `InvitePage`, `LoginPage`
  - ❌ `useAuth`, `useSkyData`, `useSkyStars` hooks
  - ❌ `api/client.ts` (auto-refresh, error handling)
- **Impacto:** Bajo para la mayoria de componentes de presentacion. Mas relevante para `api/client.ts` que tiene logica de retry y `useSkyStars` que maneja onSnapshot.
- **Recomendacion:** Priorizar tests para:
  1. `api/client.ts` — auto-refresh en 401, error handling
  2. `useSkyStars` — onSnapshot lifecycle, cleanup

### [BAJO] B4 — Sin tests para `updateSky`, `deleteSky`, `getSky`, `getUserSkies`

- **Archivo:** `functions/src/handlers/skies.test.ts`
- **Descripcion:** Solo `createSky` (2 tests) y `updateSkyTheme` (3 tests) estan testeados. Faltan:
  - `updateSky`: validacion de personalization, unknown keys rejection, titulo
  - `deleteSky`: batch deletion, cleanup de Storage, revocacion de invites
  - `getSky`: acceso, response shape
  - `getUserSkies`: collectionGroup query, multiple skies
- **Recomendacion:** `deleteSky` es el mas importante por su logica de cleanup multi-documento.

---

## Mapa de cobertura

```
BACKEND HANDLERS
├── economy.ts          ████████████ 12 tests — BUENA
├── payments.ts         █████████████ 13 tests — BUENA
├── shop.ts             ███████ 7 tests — BUENA
├── stars.ts            █████ 5 tests (solo create) — PARCIAL
├── skies.ts            █████ 5 tests (solo create+theme) — PARCIAL
├── userSync.ts         ██ presente — BASICA
├── invitePublic.ts     ███ 3 tests (solo accept) — PARCIAL
├── invites.ts          ░░ SIN TESTS
└── members.ts          ░░ SIN TESTS

BACKEND DOMAIN
├── economyRules.ts     ███ 3 tests — BASICA
└── shopCatalog.ts      ██ presente — BASICA

BACKEND LIB
├── createInvite.ts     ░░ SIN TESTS (testeado indirecto)
├── acceptInvite.ts     ░░ SIN TESTS (testeado indirecto)
├── revokeInvite.ts     ░░ SIN TESTS (testeado indirecto)
├── findInviteIdByToken ░░ SIN TESTS (testeado indirecto)
└── getSkyWithAccess.ts ░░ SIN TESTS (siempre mockeado)

FRONTEND HOOKS
├── useUserEconomy.ts   ███ tests — BUENA
├── useSkyData.ts       ░░ SIN TESTS
└── useSkyStars.ts      ░░ SIN TESTS

FRONTEND COMPONENTS
├── economy/*           █████ 5 test files — BUENA
├── sky/*               ░░ SIN TESTS
├── shop/*              ░░ SIN TESTS
└── ui/*                ░░ SIN TESTS (shadcn — aceptable)

FRONTEND LIB
├── api/client.ts       ░░ SIN TESTS
└── auth/AuthContext.tsx ░░ SIN TESTS
```

---

## Calidad de tests existentes

### Patrones positivos

1. **`vi.hoisted()` + `vi.mock()` consistente:** Todos los tests backend usan el mismo patron de mocking. Facil de leer y mantener.
2. **`mockReset()` en `beforeEach`:** Previene contaminacion entre tests.
3. **`vi.useFakeTimers()` para fechas:** Tests de economia y stars usan tiempos controlados. Deterministas.
4. **Tests de idempotencia:** `economy.test.ts` y `payments.test.ts` verifican que llamadas duplicadas no re-acreditan.
5. **Tests de retry de transaccion:** `economy.test.ts` verifica que las variables se resetean en reintentos.
6. **Tests negativos en shop:** Balance insuficiente, item ya comprado, item invalido.
7. **Tests de firma de webhook:** Firma valida, firma invalida, payload incompleto.
8. **Tests best-effort:** `stars.test.ts` verifica que la estrella se crea aunque el reward falle.

### Patrones a mejorar

1. **Mocks demasiado permisivos:** `getSkyWithAccess` siempre retorna `{ ok: true, role: 'owner' }`. No se prueban escenarios de acceso denegado.
2. **Sin tests de integracion:** Todos los tests mockean Firestore. La logica de transacciones reales (retry, contencion) no se prueba.
3. **Assertions incompletas en algunos tests:** Algunos tests solo verifican `status(200)` sin verificar el body o los side effects.

---

## Escenarios criticos sin cobertura

| Escenario | Handler | Riesgo |
|-----------|---------|--------|
| Viewer intenta crear estrella | `createStar` | Auth bypass |
| Editor intenta eliminar estrella de otro | `deleteStar` | Escalacion de privilegios |
| Non-owner crea invite | `createInviteHandler` | Auth bypass |
| Non-owner lista/revoca invites | `listInvites`, `revokeInvite` | Auth bypass |
| Owner intenta abandonar su cielo | `leaveSky` | Data integrity |
| updateMember con rol invalido | `updateMember` | Input validation |
| deleteSky con estrellas + imagenes | `deleteSky` | Cleanup incompleto |
| updateStar con imagePath invalido | `updateStar` | Path traversal |
| updateStar sobreescritura de imagen | `updateStar` | Data integrity |
| previewInvite con token expirado | `previewInvite` | Info disclosure |
| Dos compras simultaneas del mismo tema | `purchase` | Race condition |

---

## Conclusion

La cobertura de tests es buena para la economia y pagos, pero tiene gaps significativos en handlers de invitaciones, miembros, y operaciones CRUD de skies/stars. El mayor riesgo es la ausencia de tests de autorizacion — los mocks permisivos de `getSkyWithAccess` significan que el control de acceso por rol nunca se verifica en tests. Los tests existentes son de buena calidad y siguen patrones consistentes.

### Proximos pasos recomendados (por prioridad):
1. **Agregar tests para `invites.ts` y `members.ts`** — handlers sin cobertura con logica de auth (M1)
2. **Agregar tests para `updateStar` y `deleteStar`** — validacion de imagePath y permisos (M2)
3. **Agregar tests con `getSkyWithAccess` retornando `{ ok: false }` y roles restrictivos** (M3)
4. Agregar tests basicos para `previewInvite` (B1)
5. Tests para `api/client.ts` auto-refresh y error handling (B3)
6. Tests para `deleteSky` cleanup multi-documento (B4)
