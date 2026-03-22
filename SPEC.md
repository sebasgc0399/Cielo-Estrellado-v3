# SPEC.md — Cielo Estrellado (Referencia Base)

Referencia lean del modelo de datos, API, permisos y rutas. Para economia y temas ver `SPEC_v2.md`.

---

## 1. Modelo de datos

### 1.1 `users/{uid}`

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

### 1.2 `skies/{skyId}`

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

### 1.3 `skies/{skyId}/members/{uid}`

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

### 1.4 `skies/{skyId}/stars/{starId}`

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

### 1.5 `invites/{inviteId}`

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

### 1.6 Storage paths

```
stars/{skyId}/{starId}/image      # Imagen de estrella (max 5MB, jpeg/png/webp)
legacy/stars/{fileName}           # Imagenes legacy (solo lectura)
```

### 1.7 Firestore indexes

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

---

## 2. Permisos por rol

| Accion | owner | editor | viewer |
|--------|:-----:|:------:|:------:|
| Ver estrellas | Si | Si | Si |
| Crear estrella | Si | Si | No |
| Editar estrella propia | Si | Si | No |
| Editar cualquier estrella | Si | No | No |
| Eliminar estrella propia | Si | Si | No |
| Eliminar cualquier estrella | Si | No | No |
| Gestionar invitaciones | Si | No | No |
| Ver/gestionar miembros | Si | No | No |
| Editar settings del cielo | Si | No | No |

---

## 3. API Endpoints

| Metodo | Path | Auth | Descripcion |
|--------|------|:----:|-------------|
| POST | `/api/userSync` | Si | Upsert `users/{uid}` al login |
| GET | `/api/skies` | Si | Listar cielos del usuario |
| POST | `/api/skies` | Si | Crear cielo + membership owner |
| GET | `/api/skies/{skyId}` | Si | Obtener cielo + rol del usuario |
| PATCH | `/api/skies/{skyId}` | Owner | Actualizar titulo o personalizacion |
| DELETE | `/api/skies/{skyId}` | Owner | Eliminar cielo (cascade) |
| POST | `/api/skies/{skyId}/stars` | Owner/Editor | Crear estrella |
| PATCH | `/api/skies/{skyId}/stars/{starId}` | Owner/Editor* | Actualizar estrella |
| DELETE | `/api/skies/{skyId}/stars/{starId}` | Owner/Editor* | Soft-delete estrella |
| GET | `/api/skies/{skyId}/members` | Owner | Listar miembros activos |
| PATCH | `/api/skies/{skyId}/members/{userId}` | Owner | Cambiar rol o revocar miembro |
| POST | `/api/skies/{skyId}/members/leave` | Miembro | Salir del cielo |
| POST | `/api/skies/{skyId}/invites` | Owner | Crear invitacion |
| GET | `/api/skies/{skyId}/invites` | Owner | Listar invitaciones pendientes |
| DELETE | `/api/skies/{skyId}/invites/{inviteId}` | Owner | Revocar invitacion |
| GET | `/api/invites/{token}/preview` | Publica | Preview de invitacion |
| POST | `/api/invites/{token}/accept` | Si | Aceptar invitacion |

*Editor solo puede modificar/eliminar sus propias estrellas.

### Reglas de validacion

- **Estrella:** `title` requerido (max 200), `message` opcional (max 2000), coordenadas 0-1 (ambas o ninguna), `imagePath` solo cuando actual es null, `year` opcional
- **Cielo:** `title` requerido (max 100)
- **Invitacion:** `role` = `editor` (default) o `viewer`

---

## 4. Reglas de seguridad

**Firestore:** Stars legibles por miembros activos. Todos los writes via Admin SDK (Cloud Functions).

**Storage:**
- Leer imagen: miembro activo + estrella existe y no soft-deleted
- Crear imagen: miembro activo + (owner O editor autor) + imagePath == null + <5MB + tipo imagen
- Eliminar: cerrado

---

## 5. Rutas del SPA

| Ruta | Auth | Descripcion |
|------|:----:|-------------|
| `/login` | No | Login/registro |
| `/skies` | Si | Selector de cielos |
| `/sky/{skyId}` | Si | Experiencia inmersiva |
| `/invite/{token}` | No* | Preview + aceptar invitacion |
| `/profile` | Si | Perfil + cerrar sesion |

*Preview es publica, aceptar requiere auth. Ruta `/` redirige a `/skies` o `/login`.
