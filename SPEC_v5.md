# SPEC v5 — HTTP Security Headers (Referencia Lean)

Referencia lean de los headers de seguridad HTTP configurados. Para modelo base ver `SPEC.md`. Para economia ver `SPEC_v2.md`. Para video clips ver `SPEC_v3.md`. Para rendimiento ver `SPEC_v4.md`.

---

## 1. Estado actual

Todos los headers configurados en `firebase.json` bajo `"source": "**"`. CSP en modo **enforce** (Fase 2 completada).

| Header | Valor |
|--------|-------|
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| X-XSS-Protection | `1; mode=block` |
| Content-Security-Policy | Politica completa (ver §2) |
| HSTS | Automatico por Firebase Hosting |
| Cache-Control (assets) | `public, max-age=31536000, immutable` en `/assets/**` |

`security.txt` en `frontend/public/.well-known/security.txt` (RFC 9116). Expira 2027-03-29.

---

## 2. Content-Security-Policy

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
object-src 'none'
```

### Origenes por directiva

| Directiva | Origenes | Razon |
|-----------|----------|-------|
| `script-src` | `'self'`, `apis.google.com`, `accounts.google.com` | App code + Firebase Auth SDK (`gapi.js`) + Google Identity Services |
| `style-src` | `'self'`, `'unsafe-inline'` | CSS compilado + `<style>` inline en `index.html` (LCP splash) |
| `img-src` | `'self'`, `data:`, `blob:`, Storage (2 dominios), `lh3.googleusercontent.com` | Assets locales + VideoTrimmer thumbnails + Storage + fotos Google |
| `connect-src` | `'self'`, Firestore (REST + WSS), googleapis (3 dominios), Storage (2 dominios) | API calls + Firestore realtime + Auth tokens + Storage upload/download |
| `frame-src` | `firebaseapp.com`, `accounts.google.com` | Firebase Auth iframe + Google Sign-In popup |
| `media-src` | `blob:`, Storage (2 dominios) | Preview local de video + videos de estrellas |
| `worker-src` | `'self'` | Service Worker PWA (`/sw.js`) |

**Nota:** `'unsafe-inline'` en `style-src` es necesario por los `<style>` y atributos `style=""` inline del splash screen en `index.html`. Eliminable extrayendo ese CSS a archivo externo.

---

## 3. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `firebase.json` | Headers de seguridad + CSP en `"source": "**"` |
| `frontend/public/.well-known/security.txt` | RFC 9116 — contacto, idiomas, canonical, expiracion |

---

## 4. Riesgos documentados

| Riesgo | Mitigacion |
|--------|------------|
| CSP rompe Google Sign-In | `frame-src` y `script-src` incluyen dominios de Google Auth |
| CSP bloquea Firestore realtime | `connect-src` incluye `wss://firestore.googleapis.com` |
| CSP bloquea uploads Storage | `connect-src` incluye ambos dominios de Storage |
| Firebase Storage cambia dominios | Incluidos formato legacy (`.googleapis.com`) y nuevo (`.firebasestorage.app`) |
| API se llama directo a Cloud Run | Actualmente va por `/api/*` (same-origin rewrite). Si cambia, agregar dominio a `connect-src` |

---

## 5. Verificacion

```bash
# Headers
curl -I https://cielo-estrellado-web.web.app

# security.txt
curl https://cielo-estrellado-web.web.app/.well-known/security.txt

# CSP + otros headers
curl -s -D - https://cielo-estrellado-web.web.app -o /dev/null | grep -i "content-security-policy\|x-content-type\|x-frame\|x-xss"
```

Herramientas externas: securityheaders.com (grade A/A+), csp-evaluator.withgoogle.com, web-check.xyz.

### Checklist funcional post-cambio CSP

- Login con Google (popup) funciona
- Login con email funciona
- Firestore onSnapshot carga estrellas
- Imagenes y videos cargan desde Storage
- Upload de imagen/video funciona
- VideoTrimmer (blob: URLs) funciona
- Fotos de perfil Google se muestran
- Service Worker se registra
