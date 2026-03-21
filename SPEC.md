# SPEC.md — Cielo Estrellado v5

Especificacion completa para reconstruir Cielo Estrellado desde cero con React + Firebase Cloud Functions, reutilizando la base de datos, Storage y Auth existentes.

---

## 1. Vision del proyecto

Cielo Estrellado es una app donde usuarios crean "cielos" privados y colocan "estrellas" — cada estrella representa un recuerdo, persona o momento. Multiples usuarios pueden colaborar en un mismo cielo via invitaciones.

### Problema con v4

La version actual (Next.js) trata el cielo como un componente mas dentro de una pagina administrativa. La experiencia se siente como un panel de gestion con un preview del cielo a un lado, en vez del cielo inmersivo que era en v1.

### Vision v5

**El canvas del cielo ES la aplicacion.** No hay paneles, no hay listas de estrellas, no hay formularios que compitan con el cielo por espacio. El usuario entra a su cielo y lo ve en pantalla completa. Toda interaccion sucede directamente sobre el cielo o en UI flotante minima que aparece sobre el.

La sensacion debe ser: mirar un cielo real a traves de un telescopio, donde cada estrella tiene significado personal.

---

## 2. Tech Stack

| Capa | Tecnologia | Deploy |
|------|-----------|--------|
| Frontend | React 19 + Vite 6 + TypeScript + CSS plano | Firebase Hosting |
| Backend | Cloud Functions v2 (gen2) + Node.js 22 | Firebase Functions |
| Auth | Firebase Auth (Google + email/password) | — |
| Base de datos | Cloud Firestore (existente) | — |
| Almacenamiento | Firebase Storage (existente) | — |
| Routing | React Router v7 (client-side) | — |

**Proyecto Firebase:** `masmelito-f209c` (mismo proyecto, sin migracion).

---

## 3. Arquitectura

### 3.1 Estructura del repositorio

```
cielo-estrellado-v5/
  frontend/                     # SPA React
    src/
      main.tsx                  # Entry point + React Router
      pages/
        LoginPage.tsx
        SkiesPage.tsx           # Selector de cielos
        SkyPage.tsx             # Experiencia inmersiva (core)
        InvitePage.tsx          # Preview + aceptar invitacion
        ProfilePage.tsx
      components/
        sky/
          SkyCanvas.tsx         # Wrapper fullscreen del engine
          StarOverlay.tsx       # Detalle de estrella (sobre el cielo)
          StarFormSheet.tsx     # Crear/editar estrella (bottom sheet)
          FloatingToolbar.tsx   # Barra flotante de acciones
          SkySettingsSheet.tsx  # Config del cielo
          CollaboratorsSheet.tsx
        ui/
          BottomSheet.tsx
          Modal.tsx
          Toast.tsx
          LoadingScreen.tsx
      engine/
        SkyEngine.ts            # Motor visual (copiado de v4 sin cambios)
      domain/
        contracts.ts            # Tipos de datos (copiado de v4)
        policies.ts             # Constantes
      lib/
        firebase/
          client.ts             # Init Firebase client SDK
          storage.ts            # Upload de imagenes a Storage
        auth/
          AuthContext.tsx        # Proveedor de auth (React Context)
          useRequireAuth.ts     # Guard hook para rutas protegidas
        api/
          client.ts             # Fetch wrapper con Bearer token
      hooks/
        useSkyStars.ts          # onSnapshot suscripcion realtime
        useSkyData.ts           # Carga sky + member data
      styles/
        global.css
        tokens.css              # Design tokens
    index.html
    vite.config.ts

  functions/                    # Cloud Functions v2
    src/
      index.ts                  # Exporta todas las functions
      middleware/
        auth.ts                 # verifyIdToken helper
        cors.ts                 # CORS config
      handlers/
        userSync.ts             # Upsert users/{uid} on login
        skies.ts                # createSky, getUserSkies, getSky
        stars.ts                # createStar, updateStar, deleteStar
        invites.ts              # createInvite, listInvites, revokeInvite
        invitePublic.ts         # previewInvite, acceptInvite
        members.ts              # listMembers
      domain/
        contracts.ts            # Tipos compartidos (copia)
        policies.ts             # Constantes compartidas (copia)
      lib/
        getSkyWithAccess.ts
        createInvite.ts
        acceptInvite.ts
        revokeInvite.ts
        findInviteIdByToken.ts
    package.json
    tsconfig.json

  firebase.json
  firestore.rules               # Sin cambios
  storage.rules                 # Sin cambios
  firestore.indexes.json        # Sin cambios
```

### 3.2 Decisiones arquitectonicas clave

1. **Sin SSR.** Es una SPA pura. El initial load muestra un loading screen oscuro mientras Firebase Auth resuelve el estado de sesion.

2. **Sin session cookies.** Firebase Auth client SDK maneja tokens automaticamente. Cada request a Cloud Functions lleva `Authorization: Bearer <idToken>`. Las Functions verifican con `admin.auth().verifyIdToken()`.

3. **Reads directos desde cliente.** Las reglas de Firestore ya permiten lectura de `skies/{skyId}/stars` a miembros activos. El SPA usa `onSnapshot` directo para realtime. Solo writes van por Cloud Functions.

4. **Functions independientes.** Cada endpoint es una Cloud Function standalone (no Express router). Esto minimiza cold starts y permite escalar cada funcion por separado.

---

## 4. Modelo de datos (existente — sin cambios)

Se reutiliza la BD Firestore existente tal cual. A continuacion la referencia completa.

### 4.1 Coleccion `users/{uid}`

```typescript
type IsoDateString = string
type UserStatus = 'active' | 'pending' | 'disabled'

interface UserRecord {
  displayName: string | null
  email: string
  photoURL: string | null
  providers: string[]           // ej: ["google.com", "password"]
  emailVerifiedAt: IsoDateString | null
  createdAt: IsoDateString
  lastLoginAt: IsoDateString | null
  status: UserStatus
  sessionVersion: number
}
```

### 4.2 Coleccion `skies/{skyId}`

```typescript
type SkyPrivacy = 'private'
type SkyTheme = 'classic' | 'romantic' | 'deep-night'
type SkyDensity = 'low' | 'medium' | 'high'

interface SkyPersonalization {
  theme: SkyTheme
  density: SkyDensity
  nebulaEnabled: boolean
  twinkleEnabled: boolean
  shootingStarsEnabled: boolean
}

interface SkyRecord {
  title: string
  description: string | null
  ownerUserId: string | null
  privacy: SkyPrivacy
  coverImagePath: string | null
  personalization: SkyPersonalization
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

const DEFAULT_SKY_PERSONALIZATION: SkyPersonalization = {
  theme: 'classic',
  density: 'medium',
  nebulaEnabled: true,
  twinkleEnabled: true,
  shootingStarsEnabled: true,
}
```

### 4.3 Subcoleccion `skies/{skyId}/members/{uid}`

```typescript
type MemberRole = 'owner' | 'editor' | 'viewer'
type MemberStatus = 'active' | 'revoked' | 'pending'

interface MemberRecord {
  userId: string
  role: MemberRole
  status: MemberStatus
  invitedByUserId: string | null
  joinedAt: IsoDateString
}
```

### 4.4 Subcoleccion `skies/{skyId}/stars/{starId}`

```typescript
interface StarRecord {
  title: string | null
  message: string | null
  imagePath: string | null      // path en Storage: stars/{skyId}/{starId}/image
  xNormalized: number | null    // 0–1 posicion en canvas
  yNormalized: number | null    // 0–1 posicion en canvas
  year: number | null
  authorUserId: string | null
  updatedByUserId: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
  deletedAt: IsoDateString | null   // soft delete
  deletedByUserId: string | null
}
```

### 4.5 Coleccion `invites/{inviteId}`

```typescript
type InviteRole = 'editor' | 'viewer'
type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

interface InviteRecord {
  skyId: string
  role: InviteRole
  tokenHash: string             // SHA256 del token
  createdByUserId: string
  expiresAt: IsoDateString
  status: InviteStatus
  acceptedByUserId: string | null
  acceptedAt: IsoDateString | null
}
```

### 4.6 Firebase Storage paths

```
stars/{skyId}/{starId}/image      # Imagen de estrella (max 5MB, jpeg/png/webp)
legacy/stars/{fileName}           # Imagenes legacy (solo lectura, sky shared-legacy-v1)
```

### 4.7 Firestore indexes

```json
{
  "indexes": [
    {
      "collectionGroup": "members",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "invites",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "skyId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "expiresAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

### 4.8 Matriz de permisos por rol

| Accion | owner | editor | viewer |
|--------|-------|--------|--------|
| Ver estrellas | Si | Si | Si |
| Crear estrella | Si | Si | No |
| Editar estrella propia | Si | Si | No |
| Editar cualquier estrella | Si | No | No |
| Eliminar estrella propia | Si | Si | No |
| Eliminar cualquier estrella | Si | No | No |
| Gestionar invitaciones | Si | No | No |
| Ver miembros | Si | No | No |

---

## 5. Autenticacion

### 5.1 Flujo de auth (SPA + Cloud Functions)

```
1. Usuario inicia sesion (Google o email/password) via Firebase Auth client SDK
2. onAuthStateChanged dispara en React → setUser(firebaseUser)
3. Frontend llama POST /api/userSync con Bearer token
   → Cloud Function hace upsert en users/{uid}
4. Cada request posterior incluye Authorization: Bearer <idToken>
5. Cloud Functions verifican con admin.auth().verifyIdToken(token)
```

### 5.2 Proteccion de rutas (frontend)

```typescript
// Hook que protege rutas — redirige a /login si no autenticado
function useRequireAuth() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && !user) {
      navigate(`/login?redirect=${location.pathname}`)
    }
  }, [user, loading])

  return { user, loading }
}
```

### 5.3 Auth middleware (Cloud Functions)

```typescript
async function authenticateRequest(req: Request): Promise<DecodedIdToken> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new HttpsError('unauthenticated')
  const token = header.split('Bearer ')[1]
  return admin.auth().verifyIdToken(token)
}
```

### 5.4 Metodos de autenticacion

- **Google OAuth:** `signInWithPopup(GoogleAuthProvider)`
- **Email/password:** `signInWithEmailAndPassword()` / `createUserWithEmailAndPassword()`
- **Token refresh:** Automatico por Firebase SDK (~1 hora). `getIdToken()` siempre devuelve token valido.

---

## 6. Especificacion de features

### 6.1 Gestion de cielos

**Selector de cielos (`/skies`):**
- Cloud Function `GET /api/skies` consulta collection group `members` donde `userId == uid && status == active`, luego batch-get de los docs `skies/{skyId}` padres
- Muestra grid minimal de cards con titulo, rol badge, fecha de creacion
- Boton flotante "+" abre bottom sheet con input de titulo
- `POST /api/skies` crea doc en `skies` + membership `owner` (batch write atomico)

**Personalizacion del cielo:**
- Desde SkySettingsSheet en la vista del cielo
- Toggles: nebula, twinkle, shooting stars
- Selector: theme (classic/romantic/deep-night), density (low/medium/high)
- Los cambios se persisten en `skies/{skyId}.personalization`

### 6.2 Gestion de estrellas (CRUD)

**Crear estrella:**
- Trigger: tap en espacio vacio del canvas O boton "+" del toolbar
- Bottom sheet sube con: titulo (requerido, max 200), mensaje (opcional, max 2000), anio (opcional)
- Si se hizo tap en canvas, coordenadas pre-rellenadas desde la posicion del tap
- `POST /api/skies/{skyId}/stars`
- Al crearse, la estrella aparece en el cielo via realtime (onSnapshot)

**Ver estrella:**
- Trigger: tap en una estrella del canvas
- StarOverlay aparece sobre el cielo: titulo, mensaje, imagen (si tiene), fecha, autor
- El cielo sigue visible y animado detras (backdrop semi-transparente oscuro)
- Cerrar con swipe-down, tap en backdrop, o boton X

**Editar estrella:**
- Trigger: long-press en estrella (movil) o doble-click (desktop), o boton editar en StarOverlay
- Mismo bottom sheet que crear, pre-rellenado con datos actuales
- Seccion de upload de imagen (5MB max, jpeg/png/webp)
- `PATCH /api/skies/{skyId}/stars/{starId}`

**Eliminar estrella:**
- Opcion dentro del StarOverlay en modo edicion
- Dialogo de confirmacion compacto
- `DELETE /api/skies/{skyId}/stars/{starId}` — soft delete (pone `deletedAt`)

**Drag-and-drop:**
- PointerDown detecta hit en estrella (radio 20px)
- PointerMove actualiza posicion visual en engine (optimistic)
- PointerUp envia `PATCH` con nuevas coordenadas normalizadas (0–1)
- Parallax se congela durante drag
- Revert visual si el server falla

**Upload de imagen:**
- Se sube directo a Storage desde el cliente: `stars/{skyId}/{starId}/image`
- Storage rules validan: miembro activo, autor o owner, imagePath == null en Firestore, <5MB, tipo imagen
- Despues del upload exitoso, `PATCH` al star doc para setear `imagePath`
- Una vez seteado imagePath, no se puede reemplazar (attach-only)

### 6.3 Invitaciones

**Crear invitacion (solo owner):**
- Desde CollaboratorsSheet → boton "Generar invitacion"
- Seleccionar rol: editor o viewer
- `POST /api/skies/{skyId}/invites`
  - Genera token aleatorio de 32 bytes (hex)
  - Almacena SHA256(token) en Firestore
  - TTL: 7 dias
  - Retorna URL completa: `{APP_URL}/invite/{token}`
- URL se muestra con boton copiar al clipboard

**Preview de invitacion (publico):**
- Ruta: `/invite/{token}`
- `GET /api/invites/{token}/preview` — no requiere auth
- Muestra: titulo del cielo, rol que se asignara, estado de validez
- Si usuario logueado: boton "Aceptar invitacion"
- Si no logueado: boton "Iniciar sesion" → redirige a login → vuelve

**Aceptar invitacion:**
- `POST /api/invites/{token}/accept`
- Transaccion Firestore:
  1. Busca inviteId por hash del token
  2. Verifica: no expirado, no revocado, no ya aceptado
  3. Verifica: usuario no es ya miembro activo
  4. Crea doc en `members/{uid}` con status `active`
  5. Actualiza invite: status `accepted`, acceptedByUserId, acceptedAt
- Redirige a `/sky/{skyId}`

**Revocar invitacion (solo owner):**
- `DELETE /api/skies/{skyId}/invites/{inviteId}`
- Cambia status a `revoked`

### 6.4 Miembros

**Listar miembros (solo owner):**
- `GET /api/skies/{skyId}/members` retorna miembros activos con info de display
- Se muestra en CollaboratorsSheet junto con invitaciones pendientes

### 6.5 Realtime

- Suscripcion via `onSnapshot` a `skies/{skyId}/stars` ordenado por `createdAt desc`
- Filtro client-side: excluir docs donde `deletedAt != null`
- Las estrellas se pasan al SkyEngine como `UserStar[]` (id, x, y)
- Cada cambio en la coleccion actualiza automaticamente el canvas

---

## 7. UX/UI — Principios de diseno

### 7.1 Principios fundamentales

1. **Canvas-first:** El cielo ocupa 100vh x 100vw. Toda UI flota encima.
2. **Chrome minimo:** Sin barras de navegacion, sin sidebars, sin listas de estrellas. Las estrellas existen en el cielo.
3. **UI contextual:** Las acciones aparecen solo cuando son relevantes (tap estrella = ver detalle, tap vacio = opcion de crear).
4. **Dark-native:** Todo es oscuro por defecto. Elementos UI usan vidrio translucido oscuro.
5. **Micro-animaciones:** Sheets que suben suavemente, glow que pulsa, transiciones fluidas.
6. **Touch-native, mouse-enhanced:** Interaccion primaria es touch. Mouse agrega hover states y right-click.
7. **Premium feel:** Gradientes sutiles, blur, tipografia fina, spacing generoso.

### 7.2 Design tokens

```css
/* Colores base */
--bg-void: #05080f;
--glass-bg: rgba(10, 15, 30, 0.75);
--glass-border: rgba(255, 255, 255, 0.08);
--glass-blur: 20px;

/* Texto */
--text-primary: rgba(255, 255, 255, 0.95);
--text-secondary: rgba(255, 255, 255, 0.70);
--text-muted: rgba(255, 255, 255, 0.40);

/* Accent */
--accent: rgb(140, 180, 255);
--accent-glow: rgba(140, 180, 255, 0.25);

/* Radios */
--radius-sheet: 16px;
--radius-card: 12px;
--radius-pill: 24px;

/* Sombras */
--shadow-elevated: 0 8px 32px rgba(0, 0, 0, 0.5);
```

### 7.3 Pantallas

#### Loading screen
- Fondo `--bg-void` con gradiente radial central tenue
- Pequena constelacion animada (3-4 estrellas con twinkling)
- Sin texto o minimo "Cielo Estrellado" en serif delgado

#### Login (`/login`)
- Canvas del cielo animado como fondo (modo demo, sin estrellas de usuario)
- Card de vidrio centrada con opciones de login
- Boton Google + formulario email/password
- Minimo, elegante, el cielo se ve detras

#### Selector de cielos (`/skies`)
- Canvas del cielo como fondo (modo demo)
- Area de contenido centrada: saludo, cards de cielos como tiles de vidrio
- Cada tile: titulo del cielo + conteo de estrellas + badge de rol
- Boton flotante "+" para crear cielo nuevo
- Si solo tiene un cielo, considerar auto-entrar

#### Experiencia del cielo (`/sky/{skyId}`) — pantalla core
- Canvas SkyEngine fullscreen, 100vh x 100vw, sin scroll
- **Floating toolbar:** pill translucida centrada abajo
  - Iconos: "+" (crear estrella), personas (colaboradores, solo owner), engranaje (settings), flecha atras
  - Se auto-oculta tras 3 segundos de inactividad, reaparece al tocar/mover
- **Interaccion con estrellas:**
  - TAP en estrella → abre StarOverlay
  - LONG PRESS / DOBLE-CLICK en estrella → modo edicion
  - TAP en espacio vacio → abre StarFormSheet con posicion pre-rellenada
  - DRAG de estrella → reposiciona (mecanismo existente)
- **StarOverlay (ver):**
  - Sube desde abajo (movil) o card centrada (desktop)
  - Muestra: titulo grande, mensaje, imagen si tiene (full-width), fecha, nombre del autor
  - Cielo visible detras con backdrop translucido
  - Cerrar con swipe-down, tap backdrop, o X
- **StarFormSheet (crear/editar):**
  - Bottom sheet con fondo glass
  - Input titulo (auto-focus), textarea mensaje, indicador de posicion
  - Seccion upload imagen (en modo edicion)
  - Boton "Crear" / "Guardar". Se cierra al tener exito
  - En modo edicion: boton eliminar en rojo al fondo
- **CollaboratorsSheet:**
  - Bottom sheet con lista de miembros + gestion de invitaciones
  - Generar link, copiar, revocar
- **SkySettingsSheet:**
  - Toggles de personalizacion (nebula, twinkle, shooting stars, density)
  - Toggle calidad (high/low)
  - Modo de movimiento (mouse/gyro)

#### Invitacion (`/invite/{token}`)
- Canvas del cielo como fondo
- Card de vidrio centrada: titulo del cielo, rol, boton aceptar/login
- Tras aceptar, redirige a `/sky/{skyId}`

---

## 8. SkyEngine — Motor visual

El `SkyEngine.ts` se copia verbatim de v4. Es un renderer de canvas puro sin dependencias de framework.

### 8.1 Capas de canvas (5, de atras hacia adelante)

| Capa | Contenido | Parallax |
|------|-----------|----------|
| far | Estrellas lejanas (pequenas) | 0.015 |
| mid | Estrellas intermedias | 0.035 |
| near | Estrellas cercanas (grandes) | 0.06 |
| nebula | Textura procedural de nebulosa | — |
| fx | Estrellas de usuario + efectos | — |

### 8.2 Configuracion

```typescript
type SkyConfig = {
  twinkle: boolean
  nebula: boolean
  shootingStars: boolean
  quality: 'high' | 'low'
  motion: 'mouse' | 'gyro'
}
```

### 8.3 API publica

```typescript
class SkyEngine {
  constructor(canvases: LayerCanvases, options?: { onFps?: (fps: number) => void })

  setConfig(config: SkyConfig): void
  resize(width: number, height: number, dprCap: number): void
  setInputTarget(x: number, y: number): void       // parallax input (-1 a 1)
  setPointer(x: number, y: number, active: boolean): void  // glow del cursor
  setUserStars(stars: UserStar[]): void
  getParallaxOffset(): { x: number; y: number }
  syncInputTargetToCurrent(): void                  // congela parallax para drag
  hitTest(clientX: number, clientY: number): string | null  // retorna starId o null
  start(): void
  stop(): void
}

type UserStar = {
  id: string
  x: number    // 0–1 normalizado
  y: number    // 0–1 normalizado
  highlighted?: boolean
}
```

### 8.4 Caracteristicas visuales

- **Twinkling:** Alpha modulado con seno: `baseAlpha + sin(time * speed + phase) * amp`
- **Parallax:** Input del pointer/gyro se interpola suavemente. Cada capa se desplaza segun su factor de parallax
- **Shooting stars:** Velocidad aleatoria, trail con gradiente, fade out. Additive blending
- **Nebulosa:** 10 gradientes radiales + 4 overlays, se construye una vez y se cachea
- **Estrellas de usuario:** Mas grandes (radio 2.2-3.2), mas brillantes (alpha 0.9-1.0), glow calido `rgb(255, 245, 225)`
- **Highlight:** Estrellas seleccionadas con glow mas brillante y radio mayor
- **Hit test:** Detecta estrella mas cercana dentro de 20px del click

### 8.5 Performance

- `quality: 'low'` reduce estrellas 40%, baja DPR cap, reduce blur
- Estrellas fuera de viewport se cullan
- Textura de nebulosa se cachea hasta resize o cambio de calidad

---

## 9. API — Cloud Functions v2

Todos los endpoints son Cloud Functions v2 gen2 HTTP. Auth via header `Authorization: Bearer <idToken>`.

### 9.1 Tabla de endpoints

| Metodo | Path | Auth | Descripcion |
|--------|------|------|-------------|
| POST | `/api/userSync` | Requerida | Upsert doc `users/{uid}` al hacer login |
| GET | `/api/skies` | Requerida | Listar cielos del usuario (via members collection group) |
| POST | `/api/skies` | Requerida | Crear cielo + membership owner |
| GET | `/api/skies/{skyId}` | Requerida | Obtener datos del cielo + rol del usuario |
| POST | `/api/skies/{skyId}/stars` | owner/editor | Crear estrella |
| PATCH | `/api/skies/{skyId}/stars/{starId}` | owner/editor* | Actualizar estrella |
| DELETE | `/api/skies/{skyId}/stars/{starId}` | owner/editor* | Soft-delete estrella |
| GET | `/api/skies/{skyId}/members` | owner | Listar miembros activos |
| POST | `/api/skies/{skyId}/invites` | owner | Crear invitacion |
| GET | `/api/skies/{skyId}/invites` | owner | Listar invitaciones pendientes |
| DELETE | `/api/skies/{skyId}/invites/{inviteId}` | owner | Revocar invitacion |
| GET | `/api/invites/{token}/preview` | Publica | Preview de invitacion |
| POST | `/api/invites/{token}/accept` | Requerida | Aceptar invitacion (transaccional) |

*editor solo puede modificar/eliminar sus propias estrellas; owner puede con cualquiera.

### 9.2 Reglas de validacion

**Estrella:**
- `title`: requerido, string, max 200 caracteres
- `message`: opcional, string, max 2000 caracteres
- `xNormalized` / `yNormalized`: ambos o ninguno, numeros entre 0 y 1, finitos
- `imagePath`: debe coincidir con `stars/{skyId}/{starId}/image`, solo cuando imagePath actual es null
- `year`: opcional, numero

**Cielo:**
- `title`: requerido, string, max 100 caracteres

**Invitacion:**
- `role`: `editor` (default) o `viewer`

### 9.3 API client (frontend)

```typescript
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_URL

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const res = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new ApiError(res.status, error.code, error.message)
  }
  return res.json()
}
```

---

## 10. Deployment

### 10.1 firebase.json

```json
{
  "hosting": {
    "target": "web",
    "public": "frontend/dist",
    "rewrites": [
      { "source": "/api/**", "function": "api" },
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      {
        "source": "/assets/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      }
    ]
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "api",
      "runtime": "nodejs22"
    }
  ],
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

### 10.2 Variables de entorno

**Frontend (Vite):**
```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=masmelito-f209c
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FUNCTIONS_URL=              # URL base de Cloud Functions
```

**Cloud Functions:**
```env
APP_URL=                         # URL de Hosting (para generar URLs de invitacion)
```

Firebase Admin SDK usa Application Default Credentials en produccion.

### 10.3 Secuencia de deploy

```bash
# 1. Build frontend
cd frontend && npm run build

# 2. Deploy functions
firebase deploy --only functions

# 3. Deploy hosting (incluye Firestore rules, Storage rules, indexes)
firebase deploy --only hosting,firestore,storage
```

---

## 11. Reglas de seguridad (existentes — sin cambios)

### 11.1 Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isActiveMember(skyId) {
      return request.auth != null
        && exists(memberRef(skyId))
        && get(memberRef(skyId)).data.status == 'active';
    }

    match /skies/{skyId}/stars/{starId} {
      allow read: if isActiveMember(skyId);
      allow write: if false;                    // writes solo via Admin SDK (Functions)
    }

    match /{document=**} {
      allow read, write: if false;              // todo lo demas cerrado
    }
  }
}
```

### 11.2 Storage rules

- **Leer imagen:** miembro activo + estrella existe y no esta soft-deleted
- **Crear/actualizar imagen:** miembro activo + (owner O editor autor) + imagePath == null + <5MB + tipo imagen
- **Eliminar:** cerrado
- **Legacy (`legacy/stars/{fileName}`):** solo lectura para miembros activos de `shared-legacy-v1`

---

## 12. Notas de migracion desde v4

### Copiar verbatim (sin cambios)
- `SkyEngine.ts` — motor visual
- `domain/contracts.ts` — todos los tipos TypeScript
- `firestore.rules` — reglas de Firestore
- `storage.rules` — reglas de Storage
- `firestore.indexes.json` — indices

### Adaptar (misma logica, diferente framework)
- Route handlers de Next.js → Cloud Functions (misma validacion, mismas operaciones Firestore, diferente req/res)
- `getSkyWithAccess.ts`, `createInvite.ts`, `acceptInvite.ts`, `revokeInvite.ts`, `findInviteIdByToken.ts` — remover `import 'server-only'`, resto identico
- `AuthContext.tsx` — remover sync de session cookies, agregar llamada a `userSync` tras login
- `SkyCanvas.tsx` — mismo componente, remover dependencia de `next/navigation`
- `storage.ts` (upload) — reusar `uploadStarImage` sin cambios

### No portar (eliminar)
- `middleware.ts` — reemplazado por guards client-side
- `lib/auth/session.ts` — no mas session cookies
- `lib/auth/getSessionUser.ts` — reemplazado por `verifyIdToken` en Functions
- Toda la estructura `app/` de Next.js — reemplazada por React Router pages
- `next.config.ts`, `next-env.d.ts` — no aplica

### Lo que no se toca en Firebase
- Todos los datos en Firestore (users, skies, stars, invites, members)
- Todos los archivos en Storage (imagenes de estrellas, legacy)
- Usuarios y config de Firebase Auth
- Indices de Firestore (ya desplegados)

---

## 13. Rutas del SPA

| Ruta | Componente | Auth | Descripcion |
|------|-----------|------|-------------|
| `/login` | LoginPage | No | Login/registro |
| `/skies` | SkiesPage | Si | Selector de cielos |
| `/sky/{skyId}` | SkyPage | Si | Experiencia inmersiva |
| `/invite/{token}` | InvitePage | No* | Preview + aceptar |
| `/profile` | ProfilePage | Si | Perfil + cerrar sesion |

*La pagina de invite es publica para preview, pero aceptar requiere auth.

Ruta raiz `/` redirige a `/skies` si autenticado, `/login` si no.
