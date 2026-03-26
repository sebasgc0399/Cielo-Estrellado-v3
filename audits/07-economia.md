# Auditoria: Logica de Economia

**Fecha:** 2026-03-25
**Alcance:** `functions/src/handlers/economy.ts`, `functions/src/domain/economyRules.ts`, `functions/src/domain/defaults.ts`, `functions/src/domain/shopCatalog.ts`, `frontend/src/domain/economy.ts`, `frontend/src/domain/shopCatalog.ts`, `frontend/src/hooks/useUserEconomy.ts`, `functions/src/handlers/economy.test.ts`
**Severidad general:** Baja

## Resumen ejecutivo

La logica de economia es correcta y bien testeada. Las constantes son identicas entre frontend y backend. Los calculos de streak, weekly bonus y limites diarios funcionan correctamente con UTC consistente. Se identifican **0 criticos**, **1 medio** y **3 bajos** relacionados con edge cases de streak, bonus sin cap a largo plazo, y un getter side-effectful.

---

## Hallazgos

### [MEDIO] M1 — `getEconomy` es un GET con side effects (escribe recompensas)

- **Archivo:** `functions/src/handlers/economy.ts:29-218`
- **Descripcion:** El endpoint `GET /user/economy` no solo retorna datos — tambien calcula y acredita rewards (daily, weekly, streak). Esto viola el principio HTTP de que GET es idempotente y sin side effects.

  Consecuencias practicas:
  1. **Caching/proxies:** Cualquier proxy o CDN que cachee GETs podria servir una respuesta cacheada sin acreditar la recompensa. Actualmente se mitiga con `Cache-Control: private, no-store` (linea 31).
  2. **Prefetch/crawlers:** Un browser que haga prefetch de `/api/user/economy` podria trigger la recompensa antes de que el usuario la "reclame" intencionalmente.
  3. **Semantica confusa:** El frontend llama a este endpoint al montar `useUserEconomy`, lo que significa que la recompensa se acredita al cargar la app, no cuando el usuario la "reclama" explicitamente.

- **Impacto:** Medio. No hay vulnerabilidad de seguridad, pero la semantica es confusa y podria causar sorpresas en el futuro (ej: si se agrega una animacion de "reclamar recompensa", la recompensa ya se habria acreditado al cargar la pagina).
- **Recomendacion:** Dos opciones:
  1. **Aceptar como esta:** Documentar que `GET /user/economy` es el trigger de recompensas. Es mas simple y evita un endpoint adicional.
  2. **Separar:** Crear `POST /user/economy/claim` para acreditar y dejar `GET /user/economy` como lectura pura. Mas correcto semanticamente pero agrega complejidad.

---

### [BAJO] B1 — Streak bonus solo en dias exactos 7 y 30 — sin bonus intermedios

- **Archivo:** `functions/src/handlers/economy.ts:93-97`
- **Descripcion:**
  ```typescript
  if (newStreak === 7) {
    rewardsStreak = STREAK_7_BONUS    // 50 PE
  } else if (newStreak === 30) {
    rewardsStreak = STREAK_30_BONUS   // 350 PE
  }
  ```
  Solo se otorgan bonuses en los dias exactos 7 y 30. Un usuario con racha de 31+ dias no recibe ningun bonus adicional hasta que pierda la racha y vuelva a alcanzar 7 o 30.
- **Impacto:** No es un bug — es una decision de diseno. Pero podria desmotivar a usuarios con rachas largas (dia 31+) al no recibir ningun beneficio extra.
- **Recomendacion:** Documentar como decision intencional. Si se quiere incentivar rachas largas, considerar bonuses en multiples de 30 (60, 90) o un bonus recurrente semanal para rachas activas.

### [BAJO] B2 — `balanceAfter` en audit logs puede ser incorrecto con multiples rewards simultaneos

- **Archivo:** `functions/src/handlers/economy.ts:150-184`
- **Descripcion:** Cuando se otorgan daily + weekly + streak en la misma llamada, se crean hasta 3 `TransactionRecord` con `balanceAfter` calculado incrementalmente:
  ```typescript
  // Daily: balanceAfter = previousStardust + 15
  // Weekly: balanceAfter = previousStardust + 15 + 20
  // Streak: balanceAfter = previousStardust + 15 + 20 + 50
  ```
  Esto es correcto en el calculo, pero los 3 registros se crean con el mismo `createdAt` (mismo instante). Si un consumidor ordena por `createdAt` y lee el primero, vera un `balanceAfter` parcial que no refleja el balance real.
- **Impacto:** Bajo. El frontend usa el balance del response de `getEconomy`, no de los logs individuales. Solo afecta a un eventual analisis manual de transacciones.
- **Recomendacion:** Considerar consolidar multiples rewards en un solo `TransactionRecord`:
  ```typescript
  { type: 'earn', amount: 85, reason: 'daily_login+weekly_bonus+streak_7', balanceAfter: finalBalance }
  ```
  O agregar un campo `order` para desambiguar registros con mismo timestamp.

### [BAJO] B3 — Catalogos frontend/backend duplicados sin validacion cruzada

- **Archivo:** `frontend/src/domain/shopCatalog.ts`, `functions/src/domain/shopCatalog.ts`
- **Descripcion:** Los catalogos son archivos identicos en frontend y backend. No hay un test ni un mecanismo que verifique que ambos estan sincronizados. Si alguien modifica un precio en el backend sin actualizar el frontend, el usuario veria un precio diferente al que paga.
- **Impacto:** Bajo. El precio real es el del backend (es donde ocurre el debito). El frontend solo muestra informacion. Sin embargo, la discrepancia seria confusa para el usuario.
- **Recomendacion:** Dos opciones:
  1. **Test de sincronizacion:** Crear un test que importe ambos catalogos y verifique igualdad.
  2. **Uso del catalogo via API:** El endpoint `GET /shop/catalog` ya retorna el catalogo del backend. Considerar usarlo como fuente unica en el frontend en vez de importar el catalogo local.

  Lo mismo aplica para `economyRules.ts` (identico en frontend y backend).

---

## Verificacion de calculos

### Streak logic

| Escenario | `lastDailyRewardDate` | `loginStreak` | Resultado | Correcto? |
|-----------|----------------------|--------------|-----------|-----------|
| Primer login | `null` | `0` | streak=1, daily=15, weekly=20 | ✅ |
| Dia consecutivo | yesterday | `5` | streak=6, daily=15 | ✅ |
| Gap de 1 dia | 2 days ago | `5` | streak=1, previousStreak=5, daily=15 | ✅ |
| Mismo dia | today | `5` | no-op, rewards=0 | ✅ |
| Streak 7 | yesterday, streak=6 | `6` | streak=7, bonus=50 | ✅ |
| Streak 30 | yesterday, streak=29 | `29` | streak=30, bonus=350 | ✅ |
| Streak 8 | yesterday, streak=7 | `7` | streak=8, bonus=0 | ✅ |
| Streak 31 | yesterday, streak=30 | `30` | streak=31, bonus=0 | ✅ |

### Weekly bonus

| Escenario | `weeklyBonusWeek` | Resultado | Correcto? |
|-----------|-------------------|-----------|-----------|
| Primer login | `null` | weekly=20, weeklyBonusWeek=currentWeek | ✅ |
| Misma semana | currentWeek | weekly=0 | ✅ |
| Semana diferente | "2025-W52" | weekly=20, weeklyBonusWeek=currentWeek | ✅ |

### Limites diarios

| Escenario | Contador | Limite | Reset | Correcto? |
|-----------|----------|--------|-------|-----------|
| Stars hoy | `createdStarsToday` | 10 (`MAX_STARS_REWARD_PER_DAY`) | `getEconomy` si dia anterior | ✅ |
| Invites hoy | `acceptedInvitesToday` | 5 (`MAX_INVITE_REWARDS_PER_DAY`) | `getEconomy` si dia anterior | ✅ |

### Timezone consistency

| Componente | Metodo de fecha | Timezone |
|------------|----------------|----------|
| economy.ts | `new Date().toISOString().slice(0, 10)` | UTC ✅ |
| economy.ts getISOWeek | `Date.UTC()` | UTC ✅ |
| economy.ts getYesterday | `'T00:00:00Z'` suffix | UTC ✅ |
| stars.ts | `new Date().toISOString().slice(0, 10)` | UTC ✅ |
| invitePublic.ts | `new Date().toISOString().slice(0, 10)` | UTC ✅ |

Consistente en todos los puntos. No hay riesgo de timezone mismatch.

### Precios del catalogo

| Item | Frontend | Backend | Match? |
|------|----------|---------|--------|
| Aurora Boreal | 800 | 800 | ✅ |
| Horizonte Atardecer | 800 | 800 | ✅ |
| Cosmos Purpura | 800 | 800 | ✅ |
| Jardin de Rosas | 600 | 600 | ✅ |
| Profundidades del Oceano | 800 | 800 | ✅ |
| Noche Dorada | 800 | 800 | ✅ |
| Cristal de Hielo | 600 | 600 | ✅ |
| Lluvia de Meteoros | 1200 | 1200 | ✅ |
| Luciernagas | 1200 | 1200 | ✅ |
| Constelaciones | 1500 | 1500 | ✅ |
| Jardin Encantado | 1500 | 1500 | ✅ |
| Cristal de Diamante | 1500 | 1500 | ✅ |
| Corazones Celestiales | 1500 | 1500 | ✅ |
| Sky slot | 500 | 500 | ✅ |

Todos identicos. Constantes de economia (`economyRules.ts`) tambien identicas.

### Balance negativo?

- **Shop:** `stardust < item.price` → rechaza DENTRO de transaccion. ✅ No posible.
- **Payments:** Solo acredita (earn), nunca debita. ✅
- **Rewards:** Solo acreditan (earn), nunca debitan. ✅
- **Balance puede llegar a 0** pero no negativo. ✅

---

## Aspectos positivos

1. **UTC consistente:** Todas las comparaciones de fecha usan `toISOString().slice(0, 10)` y `Date.UTC()`. No hay riesgo de timezone.
2. **Idempotencia correcta:** `lastDailyRewardDate === todayUTC` previene doble-claim. Testeado explicitamente.
3. **Retry-safe:** Variables de reward se resetean al inicio de cada retry de transaccion (linea 45-49). Test explicito para esto.
4. **ISO week correcto:** `getISOWeek()` usa el algoritmo estandar ISO 8601 con ajuste por dia de la semana.
5. **`getYesterday` correcto:** Maneja cambio de mes y ano correctamente (usa `setUTCDate(-1)` que JavaScript resuelve automaticamente).
6. **Contadores diarios se resetean en `getEconomy`:** `createdStarsToday` y `acceptedInvitesToday` se resetean a 0 cuando cambia el dia. Esto asegura que los limites diarios funcionan correctamente.
7. **Balance negativo imposible:** Check `stardust < item.price` dentro de la transaccion.
8. **Catalogos identicos:** Frontend y backend tienen los mismos items con los mismos precios (verificado manualmente en esta auditoria).
9. **Tests solidos:** 12 tests cubren: daily reward, idempotencia, streak consecutivo, streak gap, bonus 7, bonus 30, no-bonus intermedios, weekly bonus, weekly idempotencia, reset contadores, retry-safety, usuario no encontrado.
10. **`DEFAULT_USER_ECONOMY` como fallback:** Todos los campos numericos/string se validan con `typeof` y usan defaults si no existen, previniendo errores en documentos migrados.

---

## Conclusion

La logica de economia es correcta, consistente y bien testeada. El hallazgo medio (M1) es una decision de diseno sobre GET con side effects que funciona pero viola semantica HTTP. Los hallazgos bajos son mejoras de mantenibilidad y documentacion, no bugs.

### Proximos pasos recomendados (por prioridad):
1. Documentar que `GET /user/economy` es el trigger de rewards (M1) — o separar en POST si se prefiere
2. Agregar test de sincronizacion entre catalogos frontend/backend (B3)
3. Documentar decision de streak bonuses solo en dias 7 y 30 (B1)
