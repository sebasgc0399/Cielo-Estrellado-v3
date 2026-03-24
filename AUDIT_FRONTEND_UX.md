# Auditoría: Resiliencia del Frontend y Experiencia de Usuario en Edge Cases

**Fecha:** 2026-03-24
**Alcance:** SPA React 19 + Vite 6 + TypeScript — hooks, pages, components, API client, auth
**Áreas auditadas:** 8 (errores silenciosos, loading states, optimistic updates, auth/guards, formularios, cleanup de efectos, empty states, navegación)

---

## Resumen ejecutivo

| Severidad | Cantidad |
|-----------|----------|
| Crítico   | 6        |
| Medio     | 10       |
| Bajo      | 4        |
| PASS      | 12       |

**Estado general:** La app tiene bases sólidas — prevención de doble submit, cleanup de efectos, y validación de formularios están bien implementados. Sin embargo, el manejo de errores tiene un patrón sistémico: los errores se capturan internamente pero rara vez se comunican al usuario, dejando la UI en estados de loading infinito o pantallas en blanco. El problema más grave es la ausencia total de manejo de expiración de token (401), que afecta a toda la app después de ~1 hora de inactividad.

---

## 1. Errores silenciosos y feedback al usuario

### CRÍTICO-1: API client no maneja 401 — sin re-auth ni redirect
**Archivo:** `frontend/src/lib/api/client.ts:36-39`
**Descripción:** `ApiError` almacena el `status` HTTP pero ningún consumidor lo usa para manejar 401. No hay interceptor global que refresque el token o redirija a login.
**Escenario:** Usuario deja la app abierta >1 hora. Intenta crear estrella → falla con 401 → toast genérico "Error al crear la estrella". El usuario sigue "autenticado" visualmente pero ninguna operación funciona.
**Fix sugerido:**
```typescript
// En api() después de recibir response
if (response.status === 401) {
  try {
    await auth.currentUser?.getIdToken(true) // Force refresh
    // Retry request con nuevo token
  } catch {
    window.location.href = '/login'
  }
}
```

### CRÍTICO-2: useSkyStars — error state se setea pero nunca se renderiza
**Archivo:** `frontend/src/hooks/useSkyStars.ts:15,51-55`
**Descripción:** El hook captura errores del listener Firestore y setea `error` state, pero el componente consumidor (`SkyPage.tsx:27`) destructura `error` y lo ignora.
**Escenario:** Firestore listener falla (permisos, red) → usuario ve un cielo vacío sin estrellas ni mensaje de error.
**Fix sugerido:** En `SkyPage.tsx`, verificar `error` después de loading y renderizar UI de error con botón de retry.

### CRÍTICO-3: useUserEconomy — error nunca se muestra al usuario
**Archivo:** `frontend/src/hooks/useUserEconomy.ts:47-50`
**Descripción:** Error se captura con `console.error` y se setea en state, pero ninguna página que usa el hook renderiza ese error.
**Escenario:** `/api/user/economy` retorna 500 → balance queda en `null` → componentes que dependen de `economy` no renderizan o muestran datos incorrectos. El usuario no sabe que sus datos económicos no cargaron.
**Fix sugerido:** Exponer `error` en el return del hook y mostrar toast/banner en páginas consumidoras.

### CRÍTICO-4: SkyPage ignora error de useSkyStars — loading infinito
**Archivo:** `frontend/src/pages/SkyPage.tsx:27`
**Descripción:** `if (skyLoading || starsLoading) return <LoadingScreen />` — si el listener falla, `loading` queda en `false` pero `error` no se verifica. Si falla antes de setear loading, la página queda en loading infinito.
**Escenario:** Permisos de Firestore incorrectos → loading spinner eterno sin explicación.
**Fix sugerido:**
```tsx
if (skyLoading || starsLoading) return <LoadingScreen />
if (starsError) return <ErrorScreen message="No se pudieron cargar las estrellas" onRetry={...} />
```

### CRÍTICO-5: ShopPage stuck en loading infinito si economy falla
**Archivo:** `frontend/src/pages/ShopPage.tsx:27`
**Descripción:** `if (authLoading || economyLoading || !economy) return <LoadingScreen />` — si `useUserEconomy` falla, `economy` queda en `null` permanentemente.
**Escenario:** Error de red al abrir la tienda → loading spinner infinito. El usuario no puede ver ni comprar temas.
**Fix sugerido:** Verificar `economyError` y mostrar pantalla de error con botón de reintentar.

### CRÍTICO-6: Sin ErrorBoundary en la app
**Archivo:** `frontend/src/main.tsx`
**Descripción:** No hay componente `ErrorBoundary` envolviendo las rutas. Si cualquier componente lanza un error en render, toda la UI colapsa a pantalla blanca.
**Escenario:** Error inesperado en un componente (propiedad undefined, error de tipado en runtime) → pantalla blanca sin recuperación posible.
**Fix sugerido:** Agregar `ErrorBoundary` alrededor de las rutas con fallback que muestre mensaje + botón "Volver al inicio".

### MEDIO-1: StarFormSheet — errores genéricos sin contexto HTTP
**Archivo:** `frontend/src/components/sky/StarFormSheet.tsx:145-146`
**Descripción:** Todos los errores de API colapsan en mensajes genéricos: `toast.error('Error al crear la estrella')`. No distingue 400 (validación), 401 (auth), 403 (permisos), 500 (servidor).
**Escenario:** Usuario intenta crear estrella con título que excede longitud → ve "Error al crear la estrella" sin saber qué corregir.
**Fix sugerido:** Parsear `ApiError.status` y mostrar mensajes contextuales.

### MEDIO-2: StarFormSheet — image upload falla como warning, no como error
**Archivo:** `frontend/src/components/sky/StarFormSheet.tsx:107-118`
**Descripción:** Si la imagen falla al subir, muestra `toast.warning()` y cierra el formulario. No ofrece retry.
**Escenario:** Conexión lenta → estrella se crea sin imagen → usuario no entiende por qué la imagen no aparece.
**Fix sugerido:** Usar `toast.error()`, mantener el formulario abierto con opción de reintentar solo la imagen.

### MEDIO-3: InvitePage — solo maneja 409, resto genérico
**Archivo:** `frontend/src/pages/InvitePage.tsx:64-86`
**Descripción:** Solo distingue 409 (ya es miembro). Para 401 (token expirado), 404 (invitación expirada), 410 (gone) muestra "Error al aceptar la invitación".
**Escenario:** Enlace de invitación expirado → usuario ve error genérico en vez de "Este enlace ya no es válido".
**Fix sugerido:** Agregar manejo para 401 (re-auth), 404/410 (enlace expirado).

### MEDIO-4: CollaboratorsSheet — datos parciales sin indicación
**Archivo:** `frontend/src/components/sky/CollaboratorsSheet.tsx:86-96`
**Descripción:** Members e invites se fetchean en paralelo. Si uno falla, la sheet muestra datos parciales sin indicar incompletud.
**Escenario:** API de invites falla → usuario ve miembros pero la sección de invitaciones está vacía sin mensaje de error. Puede pensar que no hay invitaciones pendientes.
**Fix sugerido:** Mostrar error inline en la sección que falló, deshabilitar acciones afectadas.

### MEDIO-5: PurchaseDialog — error genérico sin distinción de causa
**Archivo:** `frontend/src/components/economy/PurchaseDialog.tsx:39-48`
**Descripción:** `toast.error('Error al realizar la compra')` para todos los errores. No distingue balance insuficiente, duplicado, o error de servidor.
**Escenario:** Usuario intenta comprar un tema que ya tiene (409) → ve error genérico en vez de "Ya tienes este tema".
**Fix sugerido:** Distinguir errores por status code y mostrar mensajes específicos.

### BAJO-1: TransactionHistory — load-more no se deshabilita tras error
**Archivo:** `frontend/src/components/economy/TransactionHistory.tsx:84-91`
**Descripción:** Si "cargar más" falla, muestra toast pero el botón sigue habilitado. El usuario puede reintentar infinitamente.
**Escenario:** Error de red persistente → usuario clickea "cargar más" repetidamente, cada vez ve el mismo toast de error.
**Fix sugerido:** Mostrar error inline y deshabilitar botón o cambiar a "Reintentar".

---

## 2. Loading states y estados intermedios

### MEDIO-6: SkiesPage — no coordina loading entre skies y economy
**Archivo:** `frontend/src/pages/SkiesPage.tsx:85-101,262-266`
**Descripción:** El loading screen se quita cuando los cielos cargan, pero la economía puede seguir cargando. `StreakIndicator` y `StardustBalance` se renderizan condicionalmente con `economy &&`, causando layout shift.
**Escenario:** Cielos cargan rápido, economía tarda → header aparece sin balance ni racha, luego "salta" cuando llega la data.
**Fix sugerido:** Mantener `LoadingScreen` hasta que ambos (`loading || economyLoading`) se resuelvan, o usar skeleton loaders para streak/balance.

### PASS: LoginPage — previene flash de login form correctamente
`LoginPage.tsx:60-79` retorna `null` durante auth loading, evitando que el formulario de login flashee si el usuario ya está autenticado.

### PASS: SkyPage — coordina múltiples loaders correctamente
`SkyPage.tsx:118-120` muestra `LoadingScreen` mientras cualquier fuente de datos esté cargando.

---

## 3. Optimistic updates y sincronización de estado

### PASS: SkyCanvas drag & drop — excelente implementación
**Archivo:** `frontend/src/components/sky/SkyCanvas.tsx:75-86,298-322`
Implementa optimistic update visual durante drag con rollback completo si el PATCH falla. Patrón ejemplar.

### PASS: onSnapshot listeners sincronizados correctamente
**Archivo:** `frontend/src/hooks/useSkyStars.ts`
No hay conflicto entre estado local y servidor. Stars son server-driven via Firestore listener.

### PASS: addStardust es código muerto (seguro)
**Archivo:** `frontend/src/hooks/useUserEconomy.ts:63-65`
La función `addStardust` existe pero no se usa en ningún componente. No hay optimistic updates de balance — correcto según la política de economía en CLAUDE.md.

### MEDIO-7: SkySettingsSheet — debounce pierde cambios rápidos múltiples
**Archivo:** `frontend/src/components/sky/SkySettingsSheet.tsx:114-126`
**Descripción:** Si el usuario cambia nebula ON y twinkle ON en <800ms, solo el último cambio se persiste. El debounce reemplaza el payload completo en vez de acumularlo.
**Escenario:** Usuario activa dos opciones rápidamente → solo la segunda se guarda → al recargar, la primera opción volvió a su valor anterior.
**Fix sugerido:** Acumular cambios pendientes en un ref y enviar el estado acumulado en el debounce.

---

## 4. Autenticación, guards y expiración de sesión

### PASS: useRequireAuth previene flash de contenido
**Archivo:** `frontend/src/lib/auth/useRequireAuth.ts:5-16`
Las páginas protegidas retornan `<LoadingScreen />` mientras `authLoading || !user`, previniendo flash de contenido antes del redirect.

### PASS: No hay loops de redirección
**Archivo:** `frontend/src/main.tsx:16-20`
`RootRedirect` usa `replace` correctamente. No se identificaron ciclos de redirección.

### MEDIO-8: InvitePage — falta check de `user` en handleAccept
**Archivo:** `frontend/src/pages/InvitePage.tsx:64-86`
**Descripción:** `handleAccept()` no verifica `user` antes de llamar API. El botón solo se renderiza si `user` existe, pero manipulación de DOM o race condition podrían triggerear la función sin auth.
**Escenario:** Edge case improbable pero defensivamente debería validarse.
**Fix sugerido:** Agregar `if (!user || !token || !preview?.valid) return` al inicio de `handleAccept`.

### BAJO-2: InvitePage — espera auth loading innecesariamente para invitaciones inválidas
**Archivo:** `frontend/src/pages/InvitePage.tsx:88`
**Descripción:** `isReady = !loading && !authLoading` — si la invitación es inválida, podría mostrar el mensaje de error sin esperar a que auth termine.
**Escenario:** Usuario accede a enlace expirado → ve spinner mientras Firebase inicializa → luego ve "invitación inválida". Podría mostrarse inmediatamente.

---

## 5. Formularios y prevención de doble submit

### PASS: Todos los botones de submit se deshabilitan durante operación
**Archivos verificados:**
- `PurchaseDialog.tsx:139` — `disabled={!canAfford || purchasing}`
- `StarFormSheet.tsx:298` — botón disabled durante submit
- `SkiesPage.tsx:474,518,571` — botones de crear/editar/eliminar disabled
- `SkySettingsSheet.tsx:281` — botón de guardar título disabled

### PASS: Formularios limpian estado después de submit exitoso
- `StarFormSheet.tsx:52-65` — reset via `useEffect` cuando `open` cambia
- `SkiesPage.tsx:117` — `setNewTitle('')` post-éxito
- `SkiesPage.tsx:167` — `setEditEntry(null)` post-éxito

### PASS: Validación inline presente en todos los formularios
- `StarFormSheet.tsx:89` — `if (!trimTitle) return`
- `SkiesPage.tsx:108` — `if (!title) return`
- `PurchaseDialog.tsx:139` — `disabled={!canAfford}`
- `ThemePicker.tsx:26` — `if (themeId === activeId || applying) return`

---

## 6. Limpieza de efectos y memory leaks

### PASS: Todos los fetches tienen flag de cancelación
**Archivos verificados:**
- `useUserEconomy.ts:38` — `let cancelled = false`
- `useSkyData.ts:27` — `let cancelled = false`
- `SkiesPage.tsx:87` — `let cancelled = false`
- `TransactionHistory.tsx:59` — `let cancelled = false`

### PASS: onSnapshot listeners retornan unsubscribe
**Archivo:** `useSkyStars.ts:58` — `return unsubscribe` en cleanup del efecto.

### PASS: Event listeners se remueven correctamente
- `SkyPage.tsx:107-114` — keydown listener con cleanup
- `SkyCanvas.tsx:89-112` — ResizeObserver con disconnect
- `StarOverlay.tsx:47-54` — Escape key listener con cleanup

### PASS: Timers se limpian correctamente
- `SkySettingsSheet.tsx:112,128-132` — persistTimeout con clearTimeout en unmount
- `SkyCanvas.tsx:105` — resizeTimeout con cleanup

### BAJO-3: CollaboratorsSheet — timer de copy no se limpia
**Archivo:** `frontend/src/components/sky/CollaboratorsSheet.tsx:168`
**Descripción:** `setTimeout(() => setCopied(false), 2000)` no se trackea en ref ni se limpia en unmount.
**Escenario:** Usuario copia enlace → cierra sheet rápidamente → timeout intenta setState en componente desmontado.
**Fix sugerido:** Trackear timeout en ref y limpiar en efecto de cleanup.

### PASS: No hay listeners duplicados
Todos los hooks usan dependency arrays correctos. No se encontraron suscripciones duplicadas.

---

## 7. Empty states y listas vacías

### PASS: Lista de cielos — empty state con CTA
**Archivo:** `SkiesPage.tsx:303-343` — "Tu primer cielo te espera" con botón de crear. Visualmente distinto del loading.

### PASS: Historial de transacciones — empty state
**Archivo:** `TransactionHistory.tsx:105-114` — "Aún no hay transacciones" con icono de estrella.

### PASS: Lista de invitaciones — empty state
**Archivo:** `CollaboratorsSheet.tsx:268` — "No hay invitaciones pendientes".

### MEDIO-9: Members list sin empty state
**Archivo:** `frontend/src/components/sky/CollaboratorsSheet.tsx:189-253`
**Descripción:** Si `members.length === 0` (edge case de datos corruptos), la sección no renderiza nada — ni loading ni mensaje.
**Escenario:** Datos de Firestore corruptos o permisos incorrectos → sección de miembros vacía sin explicación.
**Fix sugerido:** Agregar ternario para `members.length === 0` con mensaje informativo.

### BAJO-4: ShopPage — grid de temas sin empty state explícito
**Archivo:** `frontend/src/pages/ShopPage.tsx:96-116`
**Descripción:** Si el catálogo está vacío o todos los temas están filtrados, el grid renderiza vacío sin mensaje.
**Escenario:** Improbable (catálogo es estático), pero defensivamente debería tener fallback.

---

## 8. Navegación y estado al volver

### PASS: SkyPage maneja skyId inválido correctamente
**Archivo:** `SkyPage.tsx:122-161` — muestra error "Cielo no encontrado" con botón "Volver a mis cielos".

### PASS: Modal state se destruye correctamente al desmontar
**Archivo:** `SkyPage.tsx:30-37` — estados de modales viven en useState, se destruyen con el componente al navegar.

### MEDIO-10: CollaboratorsSheet no limpia UI state al cerrar
**Archivo:** `frontend/src/components/sky/CollaboratorsSheet.tsx:64-97`
**Descripción:** Cuando `open` cambia a `false`, el efecto retorna early sin limpiar `copied`, `revokingId`, `kickTarget`, `kicking`, `changingRoleId`.
**Escenario:** Usuario empieza a revocar una invitación → cierra sheet → reabre → UI muestra estado "revocando..." del intento anterior.
**Fix sugerido:** En el efecto, cuando `!open`, resetear todos los estados de UI antes de retornar.

---

## Plan de acción priorizado

### Prioridad 1 — Impacto crítico al usuario (fixes inmediatos)
| # | Hallazgo | Esfuerzo |
|---|----------|----------|
| CRÍTICO-1 | Interceptor 401 en `api/client.ts` con token refresh + retry | Medio |
| CRÍTICO-6 | Agregar `ErrorBoundary` global en `main.tsx` | Bajo |
| CRÍTICO-2,3,4,5 | Renderizar `error` state en SkyPage, ShopPage, y exponer desde hooks | Medio |

### Prioridad 2 — UX degradada pero funcional
| # | Hallazgo | Esfuerzo |
|---|----------|----------|
| MEDIO-1,3,5 | Mensajes de error contextuales por HTTP status en StarForm, Invite, Purchase | Medio |
| MEDIO-7 | Acumular cambios en SkySettingsSheet debounce | Bajo |
| MEDIO-10 | Reset UI state en CollaboratorsSheet al cerrar | Bajo |
| MEDIO-6 | Coordinar loading entre skies y economy en SkiesPage | Bajo |
| MEDIO-4 | Indicar datos parciales en CollaboratorsSheet | Bajo |

### Prioridad 3 — Polish
| # | Hallazgo | Esfuerzo |
|---|----------|----------|
| MEDIO-8,9 | Guard defensivo en InvitePage, empty state en Members | Bajo |
| BAJO-1,2,3,4 | Timer cleanup, load-more disable, invite loading, shop empty state | Bajo |
