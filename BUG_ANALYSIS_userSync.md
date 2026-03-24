# Bug Analysis: "Usuario no encontrado" y "Error interno al crear el cielo"

**Fecha:** 2026-03-24
**Sintoma:** Usuario nuevo se registra, llega a SkiesPage, y dos llamadas API fallan:
1. `GET /api/user/economy` → `{error: "Usuario no encontrado"}` (404)
2. `POST /api/skies` → `{error: "Error interno al crear el cielo"}` (500)

---

## Causa raiz

**`userSync` nunca se llama desde el frontend.**

El endpoint `POST /api/userSync` existe y esta completamente funcional en `functions/src/handlers/userSync.ts`, pero ninguna parte del frontend lo invoca despues del login o signup. Sin esa llamada, el documento `users/{uid}` en Firestore nunca se crea, y todos los endpoints que dependen de el fallan.

---

## Flujo actual (roto)

```
Usuario se registra (Firebase Auth)
  → AuthContext detecta usuario via onIdTokenChanged
  → setUser() actualiza estado React
  → Redireccion a /skies
  → SkiesPage monta
  → useUserEconomy() llama GET /api/user/economy
  → getEconomy() busca doc users/{uid} en Firestore
  → Doc NO EXISTE → return null → 404 "Usuario no encontrado"

  → Simultaneamente, usuario intenta crear cielo
  → createSky() busca users/{uid} para leer maxSkies
  → userData es undefined (doc no existe)
  → Alguna operacion falla → catch generico → 500
```

## Flujo correcto (esperado por SPEC_v2.md)

```
Usuario se registra (Firebase Auth)
  → Frontend llama POST /api/userSync         ← FALTA ESTE PASO
  → userSync crea doc users/{uid} con:
      stardust: 100, maxSkies: 2, maxMemberships: 20, etc.
  → Luego GET /api/user/economy funciona ✓
  → Luego POST /api/skies funciona ✓
```

---

## Evidencia en el codigo

### 1. AuthContext no llama userSync
**Archivo:** `frontend/src/lib/auth/AuthContext.tsx`

- `signUpWithEmail` (linea 65-68): solo llama `createUserWithEmailAndPassword` + `setUser`
- `signInWithEmail` (linea 60-63): solo llama `signInWithEmailAndPassword` + `setUser`
- `signInWithGoogle` (linea 70-74): solo llama `signInWithPopup` + `setUser`
- **Ninguno invoca `/api/userSync`**

### 2. getEconomy retorna 404 si no existe el doc
**Archivo:** `functions/src/handlers/economy.ts`

- Linea 49: `const userSnap = await transaction.get(userRef)`
- Linea 51-52: `if (!userSnap.exists) { return null }`
- Linea 140-142: `if (result === null) { res.status(404).json({ error: 'Usuario no encontrado' }) }`

### 3. createSky asume que el doc existe
**Archivo:** `functions/src/handlers/skies.ts`

- Linea 85-87: lee `userSnap.data()` sin verificar `.exists`
- Si el doc no existe, `userData` es `undefined`
- `maxSkies` defaultea a 2 (safe gracias al ternario), pero la query de collectionGroup o el batch commit pueden fallar por otras razones (reglas de seguridad, indices)
- El error real se pierde en el catch generico (linea 133-135)

### 4. userSync existe pero esta huerfano
**Archivo:** `functions/src/handlers/userSync.ts`

- El handler esta completo y funcional
- Crea el doc con todos los campos de economia
- Registrado en `functions/src/index.ts` linea 14 como `POST /userSync`
- **Nadie lo llama**

---

## Solucion propuesta

### Opcion A: Llamar userSync en onIdTokenChanged (recomendada)

**Archivo a modificar:** `frontend/src/lib/auth/AuthContext.tsx`

Agregar la llamada a userSync dentro del listener de `onIdTokenChanged`, que cubre login, signup, y refresh de token:

```typescript
useEffect(() => {
  const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      setUser(toAuthUser(firebaseUser))
      try {
        await api('/api/userSync', { method: 'POST' })
      } catch (e) {
        console.error('userSync failed:', e)
      }
    } else {
      setUser(null)
    }
    setLoading(false)
  })
  return unsubscribe
}, [])
```

**Pros:**
- Cubre todos los casos (email, Google, refresh)
- `userSync` ya es idempotente (si el doc existe, solo actualiza `lastLoginAt`)
- Un solo punto de integracion

**Contras:**
- Se ejecuta en cada refresh de token (pero el costo es minimo: un read + posible write)

### Opcion B: Llamar userSync en cada metodo de auth individualmente

Agregar `await api('/api/userSync', { method: 'POST' })` en `signInWithEmail`, `signUpWithEmail`, y `signInWithGoogle`.

**Pros:** Mas explicito, solo se llama en login real
**Contras:** Tres puntos de modificacion, no cubre edge cases como refresh de sesion

### Fix defensivo adicional en createSky

Independientemente de la opcion elegida, `createSky` deberia verificar que el documento existe:

**Archivo:** `functions/src/handlers/skies.ts` (linea 85)

```typescript
const userSnap = await db.collection('users').doc(decoded.uid).get()
if (!userSnap.exists) {
  res.status(404).json({ error: 'Usuario no encontrado. Intenta cerrar sesion y volver a entrar.' })
  return
}
```

---

## Archivos a modificar

| Archivo | Cambio | Prioridad |
|---------|--------|-----------|
| `frontend/src/lib/auth/AuthContext.tsx` | Agregar llamada a `POST /api/userSync` post-auth | **Critica** |
| `functions/src/handlers/skies.ts` | Agregar check `userSnap.exists` antes de continuar | Defensivo |

---

## Plan de verificacion

1. Crear usuario nuevo con email/password → debe llamar userSync automaticamente
2. Verificar en logs de Cloud Functions que userSync se ejecuto
3. Verificar que `GET /api/user/economy` retorna 200 con `stardust: 100`
4. Verificar que se puede crear un cielo sin error 500
5. Login con usuario existente → verificar que no rompe nada (idempotencia de userSync)
6. Login con Google → verificar que tambien funciona
7. Correr tests existentes: `cd frontend && npm run test:run` y `cd functions && npm run test:run`

---

## Notas

- El import de `api` ya existe en el frontend (`frontend/src/lib/api/client.ts`), solo hay que importarlo en AuthContext
- `userSync` ya maneja migracion de usuarios viejos (agrega campos de economia si faltan)
- El welcome bonus de 100 stardust se crea automaticamente en userSync para usuarios nuevos
