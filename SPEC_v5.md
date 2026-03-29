# SPEC v5 — HTTP Security Headers

> **Objetivo:** Configurar los headers de seguridad HTTP faltantes sin romper funcionalidad.
> **Principio:** CSP en modo report-only primero. Endurecer despues de verificar.

---

## 1. Estado actual

### Headers existentes

| Header | Estado | Valor |
|--------|--------|-------|
| Strict-Transport-Security (HSTS) | OK | Configurado por Firebase Hosting automaticamente |
| Cache-Control (assets) | OK | `public, max-age=31536000, immutable` en `/assets/**` |
| Content-Security-Policy | Falta | No configurado |
| X-Content-Type-Options | Falta | No configurado |
| X-Frame-Options | Falta | No configurado |
| X-XSS-Protection | Falta | No configurado |
| security.txt | Falta | No existe `/.well-known/security.txt` |

### firebase.json actual (seccion hosting)

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
  }
}
```

---

## 2. Auditoria de origenes para CSP

### 2.1 script-src

| Origen | Razon |
|--------|-------|
| `'self'` | Todos los JS de la app son same-origin (Vite build con hashes) |
| `https://apis.google.com` | Firebase Auth SDK carga `gapi.js` dinamicamente para `signInWithPopup` |
| `https://accounts.google.com` | Google Identity Services |

**No se necesita:** `'unsafe-eval'` (no hay `eval()` ni generacion dinamica de scripts en el codigo). `'unsafe-inline'` para scripts tampoco (Vite usa `type="module"`, no inline scripts).

### 2.2 style-src

| Origen | Razon |
|--------|-------|
| `'self'` | CSS compilado en `/assets/index-*.css` |
| `'unsafe-inline'` | Requerido: `index.html` tiene 2 bloques `<style>` inline (background + keyframe animation del LCP splash) y atributos `style=""` inline en el splash screen. Eliminar esto requeriria extraer a CSS externo o usar hashes SHA-256 (pero los atributos `style` inline no se pueden hashear sin `'unsafe-hashes'`). |

### 2.3 img-src

| Origen | Razon |
|--------|-------|
| `'self'` | Assets locales (icon-512.png) |
| `data:` | `canvas.toDataURL()` en VideoTrimmer para filmstrip thumbnails |
| `blob:` | `URL.createObjectURL()` en VideoTrimmer |
| `https://firebasestorage.googleapis.com` | URLs de descarga de Storage (formato legacy) |
| `https://masmelito-f209c.firebasestorage.app` | URLs de descarga de Storage (formato nuevo) |
| `https://lh3.googleusercontent.com` | Fotos de perfil de Google via `user.photoURL` |

### 2.4 connect-src

| Origen | Razon |
|--------|-------|
| `'self'` | `/api/*` endpoints (Cloud Functions via Firebase Hosting rewrite) |
| `https://firestore.googleapis.com` | Firestore REST/gRPC |
| `wss://firestore.googleapis.com` | Firestore realtime `onSnapshot` via WebSocket |
| `https://www.googleapis.com` | Firebase Auth token operations |
| `https://securetoken.googleapis.com` | Firebase Auth token refresh |
| `https://identitytoolkit.googleapis.com` | Firebase Auth sign-in |
| `https://firebasestorage.googleapis.com` | Storage upload/download (legacy) |
| `https://masmelito-f209c.firebasestorage.app` | Storage upload/download (nuevo) |

### 2.5 frame-src

| Origen | Razon |
|--------|-------|
| `https://masmelito-f209c.firebaseapp.com` | Firebase Auth iframe (`/__/auth/iframe` y `/__/auth/handler`) |
| `https://accounts.google.com` | Google Sign-In consent popup content |

> **Nota:** Firebase Auth con `signInWithPopup` abre un popup (nueva ventana), pero internamente usa un iframe hidden para comunicacion cross-origin. Si se bloquea `frame-src` para `firebaseapp.com`, el login con Google se rompe silenciosamente.

### 2.6 media-src

| Origen | Razon |
|--------|-------|
| `blob:` | `URL.createObjectURL(file)` para preview local de video en VideoTrimmer |
| `https://firebasestorage.googleapis.com` | Videos de estrellas (legacy) |
| `https://masmelito-f209c.firebasestorage.app` | Videos de estrellas (nuevo) |

### 2.7 font-src

| Origen | Razon |
|--------|-------|
| `'self'` | No se cargan fonts externos. Solo system fonts (Georgia, Palatino, system-ui) |

### 2.8 worker-src

| Origen | Razon |
|--------|-------|
| `'self'` | `/sw.js` — Service Worker de la PWA registrado via `registerSW.js` |

---

## 3. Configuracion propuesta para firebase.json

### 3.1 Headers de seguridad simples

```json
{
  "source": "**",
  "headers": [
    {
      "key": "X-Content-Type-Options",
      "value": "nosniff"
    },
    {
      "key": "X-Frame-Options",
      "value": "DENY"
    },
    {
      "key": "X-XSS-Protection",
      "value": "1; mode=block"
    }
  ]
}
```

**Justificacion:**
- `X-Content-Type-Options: nosniff` — Previene MIME-type sniffing. Sin downside.
- `X-Frame-Options: DENY` — Previene clickjacking. La app no se embebe en iframes de terceros. Firebase Auth usa popups (ventanas nuevas) y iframes internos que no son afectados por este header porque el header aplica a la pagina principal, no a los iframes que ella misma carga.
- `X-XSS-Protection: 1; mode=block` — Filtro XSS legacy. Algunos browsers modernos lo ignoran, pero no tiene downside.

### 3.2 Content-Security-Policy (Fase 1 — Report-Only)

**Header:** `Content-Security-Policy-Report-Only`

Usar `Report-Only` en la primera fase para detectar violaciones sin bloquear funcionalidad.

```
default-src 'self';
script-src 'self' https://apis.google.com https://accounts.google.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app https://lh3.googleusercontent.com;
connect-src 'self' https://firestore.googleapis.com wss://firestore.googleapis.com https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app;
frame-src https://masmelito-f209c.firebaseapp.com https://accounts.google.com;
media-src blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app;
font-src 'self';
worker-src 'self';
manifest-src 'self';
base-uri 'self';
form-action 'self';
object-src 'none';
```

**En firebase.json** (como una sola linea):

```json
{
  "key": "Content-Security-Policy-Report-Only",
  "value": "default-src 'self'; script-src 'self' https://apis.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app https://lh3.googleusercontent.com; connect-src 'self' https://firestore.googleapis.com wss://firestore.googleapis.com https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app; frame-src https://masmelito-f209c.firebaseapp.com https://accounts.google.com; media-src blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
}
```

### 3.3 Content-Security-Policy (Fase 2 — Enforce)

Despues de verificar que no hay violaciones en report-only, cambiar el header a:
- Key: `Content-Security-Policy` (sin `-Report-Only`)
- Mismo valor

### 3.4 firebase.json completo propuesto

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
      },
      {
        "source": "**",
        "headers": [
          {
            "key": "X-Content-Type-Options",
            "value": "nosniff"
          },
          {
            "key": "X-Frame-Options",
            "value": "DENY"
          },
          {
            "key": "X-XSS-Protection",
            "value": "1; mode=block"
          },
          {
            "key": "Content-Security-Policy-Report-Only",
            "value": "default-src 'self'; script-src 'self' https://apis.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app https://lh3.googleusercontent.com; connect-src 'self' https://firestore.googleapis.com wss://firestore.googleapis.com https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app; frame-src https://masmelito-f209c.firebaseapp.com https://accounts.google.com; media-src blob: https://firebasestorage.googleapis.com https://masmelito-f209c.firebasestorage.app; font-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
          }
        ]
      }
    ]
  }
}
```

---

## 4. security.txt

### Ubicacion

Firebase Hosting sirve archivos estaticos desde `frontend/dist/`. Para que `/.well-known/security.txt` funcione, crear el archivo en `frontend/public/.well-known/security.txt`. Vite copia el contenido de `public/` a `dist/` en el build.

### Contenido propuesto

```
Contact: mailto:soporte@cieloestrellado.app
Preferred-Languages: es, en
Canonical: https://cielo-estrellado-web.web.app/.well-known/security.txt
Expires: 2027-03-28T00:00:00.000Z
```

> **Nota:** Ajustar el email de contacto al real del proyecto. El campo `Expires` es obligatorio segun RFC 9116. Poner 1 año desde la fecha de creacion.

---

## 5. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|-------------|---------|------------|
| CSP rompe Google Sign-In | Media | Alto — login no funciona | Usar `Report-Only` primero. `frame-src` y `script-src` incluyen los dominios de Google Auth. Testear popup login antes de enforce. |
| CSP bloquea Firestore realtime | Baja | Alto — estrellas no cargan | `connect-src` incluye `wss://firestore.googleapis.com` para WebSockets. |
| CSP bloquea upload de imagenes/video | Baja | Medio — crear estrella falla | `connect-src` incluye ambos dominios de Storage. `img-src` y `media-src` incluyen `blob:` para previews locales. |
| CSP bloquea fotos de perfil Google | Baja | Bajo — avatar no se muestra | `img-src` incluye `https://lh3.googleusercontent.com`. |
| `X-Frame-Options: DENY` rompe algo | Muy baja | Bajo | La app no se embebe en iframes. Firebase Auth usa popup (nueva ventana) y iframe interno que no es afectado por el header de la pagina padre. |
| `'unsafe-inline'` en style-src | N/A | Seguridad reducida | Necesario por los `<style>` inline en `index.html`. Se puede eliminar en el futuro extrayendo el CSS del LCP splash a un archivo externo. |
| Firebase Storage cambia dominios | Baja | Medio | Se incluyen ambos formatos (legacy `.googleapis.com` y nuevo `.firebasestorage.app`). Si Firebase agrega un tercero, habra que actualizar el CSP. |
| Dominio de API cambia | Baja | Alto | Las API calls van por `/api/*` (same-origin via rewrite). Si se llama directamente a Cloud Run (`api-*.a.run.app`), habra que agregar ese dominio a `connect-src`. |

---

## 6. Plan de implementacion

### Fase 1 — Headers simples + CSP Report-Only

1. Crear `frontend/public/.well-known/security.txt`
2. Actualizar `firebase.json` con los headers propuestos (§3.4)
3. `npm run build` (para que security.txt se copie a dist)
4. `firebase deploy --only hosting`
5. Verificar headers con `curl -I https://cielo-estrellado-web.web.app`
6. Verificar security.txt con `curl https://cielo-estrellado-web.web.app/.well-known/security.txt`

### Fase 2 — Verificacion funcional

Abrir Chrome DevTools → Console. Navegar por toda la app buscando violaciones CSP (aparecen como `[Report Only]` warnings):

- [ ] Cargar landing/login — verificar que no hay violaciones CSP
- [ ] Login con Google (popup) — verificar que `signInWithPopup` funciona
- [ ] Login con email — verificar que auth funciona
- [ ] Lista de cielos — verificar que la API responde
- [ ] Entrar a un cielo — verificar que Firestore onSnapshot funciona (estrellas cargan)
- [ ] Abrir una estrella con imagen — verificar que la imagen carga desde Storage
- [ ] Abrir una estrella con video — verificar que el video carga
- [ ] Crear estrella con imagen — verificar que el upload funciona
- [ ] Crear estrella con video — verificar VideoTrimmer (blob: URLs)
- [ ] Perfil — verificar que la foto de Google se muestra
- [ ] Tienda — verificar que funciona
- [ ] Verificar que el Service Worker se registra correctamente

### Fase 3 — Enforce CSP

Si no hay violaciones despues de la verificacion:

1. En `firebase.json`, cambiar `Content-Security-Policy-Report-Only` a `Content-Security-Policy`
2. `firebase deploy --only hosting`
3. Verificar de nuevo con web-check.xyz

---

## 7. Verificacion con herramientas externas

```bash
# Headers manuales
curl -I https://cielo-estrellado-web.web.app

# Verificar security.txt
curl https://cielo-estrellado-web.web.app/.well-known/security.txt

# Verificar CSP headers
curl -s -D - https://cielo-estrellado-web.web.app -o /dev/null | grep -i "content-security-policy\|x-content-type\|x-frame\|x-xss"
```

- web-check.xyz — scan completo de headers
- securityheaders.com — grade de headers (objetivo: A o A+)
- csp-evaluator.withgoogle.com — validar la policy CSP
