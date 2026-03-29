# SPEC_legal.md — Documentos legales para Cielo Estrellado v5

> **Disclaimer:** Estos documentos son un punto de partida elaborado sin asesoría jurídica profesional. Antes del lanzamiento público, **deben ser revisados y ajustados por un abogado colombiano** especializado en protección de datos y comercio electrónico. Este SPEC documenta qué se necesita y cómo implementarlo técnicamente, no constituye asesoría legal.

---

## Auditoría del estado actual

### Datos personales recolectados

| Dato | Fuente | Almacenado en | Tipo |
|------|--------|---------------|------|
| `email` | Firebase Auth | Firestore `users/{uid}.email` | PII — contacto |
| `displayName` | Firebase Auth / Google | Firestore `users/{uid}.displayName` | PII — identidad |
| `photoURL` | Google OAuth | Firestore `users/{uid}.photoURL` (URL externa) | PII — imagen |
| `uid` | Firebase Auth | Firestore document ID | Identificador único |
| `providers[]` | Firebase Auth | Firestore `users/{uid}.providers` | Dato técnico |
| `emailVerifiedAt` | Firebase Auth | Firestore `users/{uid}.emailVerifiedAt` | Dato técnico |
| `createdAt` | Backend (ISO timestamp) | Firestore `users/{uid}.createdAt` | Dato temporal |
| `lastLoginAt` | Backend (ISO timestamp) | Firestore `users/{uid}.lastLoginAt` | Dato temporal |
| `stardust` | Sistema de economía | Firestore `users/{uid}.stardust` | Dato económico virtual |
| Imágenes | Usuario sube | Cloud Storage `stars/{skyId}/{starId}/image` | Media — hasta 5MB |
| Videos | Usuario sube | Cloud Storage `stars/{skyId}/{starId}/video` | Media — hasta 50MB |

### Datos financieros (pagos)

| Dato | Almacenado | Detalle |
|------|-----------|---------|
| `wompiTransactionId` | Sí | Referencia de Wompi, no dato de tarjeta |
| `wompiReference` | Sí | Referencia interna generada por backend |
| `amountInCents` | Sí | Monto en COP |
| `paymentMethod` | Sí | Tipo (ej: "CARD", "PSE"), no número |
| `status` | Sí | Estado de la transacción |
| Número de tarjeta | **NO** | Wompi maneja PCI-DSS directamente |
| Datos bancarios | **NO** | PSE/Nequi resueltos en Wompi |

### Datos NO recolectados
- Dirección IP
- User agent / dispositivo
- Geolocalización
- Datos biométricos

### Seguridad existente
- Firestore rules: `allow read, write: if false` en `/users`, `/payments`, `/transactions` — acceso solo vía Admin SDK (Cloud Functions)
- Storage rules: lectura restringida a miembros activos del cielo, escritura controlada por rol
- CSP headers configurados en `firebase.json` (X-Content-Type-Options, X-Frame-Options, CSP estricto)
- Webhook Wompi con verificación de firma SHA256 + validación de montos + idempotencia
- Encriptación en tránsito (HTTPS forzado por Firebase Hosting)

### Brechas identificadas
1. **No existe** archivo LICENSE
2. **No existe** política de privacidad
3. **No existe** términos de servicio
4. **No existe** checkbox de consentimiento en registro
5. **No existen** campos `acceptedTermsAt` ni `acceptedTermsVersion` en `UserRecord`
6. **No existe** política de tratamiento de datos (Ley 1581/2012)
7. **Parcialmente resuelto** — mecanismo de eliminación de cuenta: la UI existe en `ProfilePage.tsx` (botón "Eliminar mi cuenta" con confirmación escribiendo "ELIMINAR"), pero actualmente muestra un toast con email de contacto como mecanismo temporal. Falta el endpoint `DELETE /api/user/account` para eliminación automática.

---

## Fase 1 — Archivo LICENSE (MIT)

### Objetivo
Establecer la licencia de código abierto del proyecto.

### Archivo a crear

**`LICENSE`** (raíz del repo)

```
MIT License

Copyright (c) 2026 Sebastian Gutierrez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Impacto
- Ningún otro archivo se modifica.

### Verificación
- [ ] `LICENSE` existe en la raíz del repositorio
- [ ] Contiene el nombre correcto del titular y el año

---

## Fase 2 — Política de Privacidad

### Objetivo
Informar a los usuarios qué datos personales se recolectan, para qué, y cómo ejercer sus derechos bajo la Ley 1581 de 2012.

### Archivo a crear

**`frontend/public/legal/privacy.html`** — HTML estático, no React.

### Estructura del documento

```
Política de Privacidad — Cielo Estrellado
Última actualización: [fecha de implementación]

1. Responsable del tratamiento
   - Nombre: Sebastian Gutierrez
   - Ubicación: Medellín, Colombia
   - Contacto: sebasgc0399@gmail.com

2. Datos personales que recolectamos
   2.1 Datos de cuenta (automáticos al registrarse)
       - Dirección de correo electrónico
       - Nombre para mostrar (displayName)
       - Foto de perfil (URL proporcionada por Google, si usas Google Sign-In)
       - Proveedor de autenticación (Google, email/contraseña)
       - Fecha de creación de cuenta
       - Fecha del último inicio de sesión
   2.2 Contenido que subes
       - Imágenes (JPEG, PNG, WebP — máximo 5 MB)
       - Videos (MP4, WebM — máximo 50 MB)
   2.3 Datos de transacciones
       - Referencia de transacción de Wompi (NO números de tarjeta)
       - Monto de la compra en COP
       - Tipo de método de pago (tarjeta, PSE, Nequi)
       - Estado de la transacción
   2.4 Datos que NO recolectamos
       - Dirección IP
       - Información del dispositivo o navegador
       - Ubicación geográfica
       - Datos biométricos

3. Finalidad del tratamiento
   - Crear y gestionar tu cuenta de usuario
   - Permitir la funcionalidad de la aplicación (crear cielos, estrellas, subir media)
   - Procesar compras de Polvo Estelar (moneda virtual)
   - Enviar notificaciones relacionadas con tu cuenta (si aplica)
   - Cumplir obligaciones legales

4. Terceros con los que compartimos datos
   4.1 Firebase / Google Cloud (almacenamiento y autenticación)
       - Qué recibe: email, displayName, photoURL, UID, imágenes, videos
       - Para qué: autenticación de usuarios, almacenamiento de datos en Firestore y Cloud Storage
       - Ubicación: servidores de Google (ver política de privacidad de Google Cloud)
   4.2 Wompi / Bancolombia (procesamiento de pagos)
       - Qué recibe: referencia de pago, monto, moneda (COP)
       - Para qué: procesar pagos con tarjeta, PSE y Nequi
       - Nota: los datos de tarjeta/cuenta bancaria se ingresan directamente en Wompi, nunca pasan por nuestros servidores
       - Wompi es PCI-DSS compliant
   4.3 No vendemos ni compartimos datos con terceros para fines publicitarios

5. Almacenamiento y protección
   - Los datos se almacenan en Firebase (Google Cloud Platform)
   - Toda comunicación usa HTTPS (encriptación en tránsito via TLS)
   - Las reglas de Firestore bloquean acceso directo del cliente a datos de usuarios y pagos
   - Las reglas de Cloud Storage restringen acceso a media por membresía del cielo
   - Los passwords son gestionados por Firebase Authentication (nunca almacenados por nosotros en texto plano)

6. Cookies y almacenamiento local
   - Firebase Authentication usa localStorage/sessionStorage para mantener la sesión activa
   - No usamos cookies de tracking, analytics, ni publicidad
   - Datos almacenados localmente: token de autenticación de Firebase

7. Retención de datos
   - Los datos de cuenta se mantienen mientras la cuenta esté activa
   - Los datos de transacciones de pago se mantienen por el periodo requerido por la ley colombiana (mínimo 5 años para registros contables)
   - Las imágenes y videos se mantienen mientras exista la estrella a la que pertenecen
   - Al eliminar tu cuenta: se eliminan tus datos personales de Firestore; las imágenes y videos asociados a tus estrellas se eliminan de Cloud Storage
   - Para solicitar la eliminación de tu cuenta y todos tus datos personales, puedes hacerlo desde la sección Cuenta en tu perfil dentro de la aplicación, o contactando a sebasgc0399@gmail.com. Procesaremos tu solicitud dentro de los 15 días hábiles establecidos por la ley.

8. Derechos del titular (Ley 1581 de 2012)
   [Ver Fase 4 — sección integrada]

9. Cambios a esta política
   - Nos reservamos el derecho de modificar esta política
   - Los cambios se publicarán en esta misma página con la fecha actualizada
   - Si los cambios son sustanciales, notificaremos a los usuarios activos

10. Contacto
    - Para cualquier consulta sobre esta política: sebasgc0399@gmail.com
```

### Impacto
- Crear directorio `frontend/public/legal/`
- Configurar `cleanUrls: true` en `firebase.json` (ver Fase 5d)

### Verificación
- [ ] `frontend/public/legal/privacy.html` existe y es HTML válido
- [ ] Accesible en `/legal/privacy` sin JavaScript
- [ ] Contiene todas las secciones listadas
- [ ] Todos los datos de la tabla de auditoría están mencionados

---

## Fase 3 — Términos de Servicio

### Objetivo
Definir las reglas de uso de la aplicación, la economía virtual, y la relación legal con el usuario.

### Archivo a crear

**`frontend/public/legal/terms.html`** — HTML estático, no React.

### Estructura del documento

```
Términos de Servicio — Cielo Estrellado
Última actualización: [fecha de implementación]

1. Aceptación de los términos
   - Al crear una cuenta, el usuario acepta estos términos y la Política de Privacidad
   - Si no estás de acuerdo, no debes usar el servicio

2. Descripción del servicio
   - Cielo Estrellado es una aplicación web que permite crear "cielos" virtuales compartidos donde los miembros agregan "estrellas" con imágenes, videos y mensajes
   - El servicio incluye un sistema de economía virtual (Polvo Estelar) y temas visuales personalizables

3. Requisitos de uso
   - Edad mínima: 13 años (o la edad mínima requerida en tu jurisdicción para usar servicios en línea)
   - Se requiere una cuenta válida (email o Google Sign-In)
   - Una persona por cuenta; las cuentas no son transferibles
   - El usuario es responsable de mantener la seguridad de su cuenta

4. Reglas de contenido
   4.1 El usuario puede subir:
       - Imágenes (JPEG, PNG, WebP — máximo 5 MB)
       - Videos (MP4, WebM, QuickTime — máximo 50 MB)
   4.2 Está prohibido subir contenido que:
       - Sea ilegal bajo la ley colombiana
       - Contenga pornografía, violencia extrema o contenido de explotación
       - Infrinja derechos de autor de terceros
       - Contenga malware o código malicioso
       - Sea spam o contenido automatizado
   4.3 Nos reservamos el derecho de remover contenido que viole estas reglas sin previo aviso

5. Propiedad intelectual
   5.1 Contenido del usuario:
       - El usuario mantiene todos los derechos sobre el contenido que sube
       - Al subir contenido, el usuario otorga a Cielo Estrellado una licencia no exclusiva, mundial y gratuita para mostrar, almacenar y procesar dicho contenido dentro de la plataforma
       - Esta licencia termina cuando el usuario elimina el contenido o su cuenta
   5.2 Propiedad de la plataforma:
       - El código, diseño, marcas y elementos visuales de Cielo Estrellado son propiedad de Sebastian Gutierrez
       - El código fuente se distribuye bajo licencia MIT (ver archivo LICENSE)

6. Economía virtual — Polvo Estelar (PE)
   6.1 Naturaleza:
       - El Polvo Estelar es una moneda virtual de uso exclusivo dentro de Cielo Estrellado
       - NO tiene valor monetario real fuera de la plataforma
       - NO es convertible a dinero real
       - NO es transferible entre usuarios
   6.2 Obtención:
       - Bonificación de bienvenida al crear cuenta
       - Recompensas diarias por uso de la aplicación
       - Compra con dinero real (COP) a través de Wompi
   6.3 Uso:
       - Desbloquear temas visuales para los cielos
       - Otros items virtuales disponibles en la tienda

7. Pagos y reembolsos
   7.1 Procesador de pagos:
       - Los pagos se procesan a través de Wompi (Bancolombia)
       - Métodos aceptados: tarjeta de crédito/débito, PSE, Nequi
       - Moneda: Pesos colombianos (COP)
   7.2 Política de reembolsos:
       - Las compras de Polvo Estelar son finales y NO reembolsables una vez acreditadas
       - Si un pago falla o es rechazado por Wompi, no se acredita Polvo Estelar y no se realiza cobro
       - Si se acredita Polvo Estelar por error (doble cobro, monto incorrecto), se procesará el reembolso correspondiente
       - Para disputas de pago, contactar a sebasgc0399@gmail.com con el ID de referencia de la transacción
   7.3 Precios:
       - Los precios se muestran en COP e incluyen impuestos aplicables
       - Nos reservamos el derecho de modificar precios con previo aviso

8. Limitación de responsabilidad
   - El servicio se proporciona "tal como está" (AS IS) sin garantías expresas o implícitas
   - No garantizamos disponibilidad ininterrumpida del servicio
   - No somos responsables por pérdida de contenido debido a fallos técnicos fuera de nuestro control
   - Nuestra responsabilidad máxima se limita al monto pagado por el usuario en los últimos 12 meses
   - No somos responsables por el contenido subido por otros usuarios

9. Terminación de cuenta
   9.1 Por el usuario:
       - El usuario puede solicitar la eliminación de su cuenta en cualquier momento contactando a sebasgc0399@gmail.com
       - Al eliminar la cuenta se pierden todos los datos, contenido y Polvo Estelar acumulado
   9.2 Por nosotros:
       - Podemos suspender o eliminar cuentas que violen estos términos
       - Se notificará al usuario al email registrado antes de la eliminación (excepto en casos graves)
       - El Polvo Estelar no utilizado no será reembolsado en caso de terminación por violación de términos

10. Modificaciones a los términos
    - Nos reservamos el derecho de modificar estos términos en cualquier momento
    - Los cambios entrarán en vigor al publicarse en esta página
    - El uso continuado del servicio después de una modificación constituye aceptación de los nuevos términos
    - Para cambios sustanciales, notificaremos a los usuarios con al menos 15 días de anticipación

11. Ley aplicable y jurisdicción
    - Estos términos se rigen por las leyes de la República de Colombia
    - Cualquier disputa se resolverá ante los tribunales competentes de Medellín, Colombia
    - Antes de acudir a tribunales, las partes intentarán resolver la disputa de forma amistosa

12. Contacto
    - Email: sebasgc0399@gmail.com
    - Ubicación: Medellín, Colombia
```

### Impacto
- Mismo directorio `frontend/public/legal/` de la Fase 2

### Verificación
- [ ] `frontend/public/legal/terms.html` existe y es HTML válido
- [ ] Accesible en `/legal/terms` sin JavaScript
- [ ] Contiene todas las secciones listadas
- [ ] La sección de PE refleja las reglas en `economyRules.ts`

---

## Fase 4 — Política de Tratamiento de Datos (Ley 1581 de 2012)

### Objetivo
Cumplir con los requisitos específicos de la Ley 1581 de 2012 de protección de datos personales de Colombia.

### Ubicación
Integrado como **sección 8** dentro de `frontend/public/legal/privacy.html` con anchor `#tratamiento-datos`.

### Contenido de la sección

```
8. Tratamiento de datos personales — Ley 1581 de 2012

8.1 Responsable del tratamiento
    - Nombre: Sebastian Gutierrez
    - Dirección: Medellín, Colombia
    - Correo: sebasgc0399@gmail.com
    - Calidad: Responsable del tratamiento de datos personales

8.2 Finalidad del tratamiento
    Los datos personales se recolectan y tratan con las siguientes finalidades:
    a) Crear y gestionar la cuenta de usuario en la plataforma
    b) Permitir el uso de las funcionalidades de Cielo Estrellado
    c) Procesar transacciones de compra de Polvo Estelar
    d) Enviar comunicaciones relacionadas con el servicio
    e) Cumplir obligaciones legales y regulatorias
    f) Prevenir actividades fraudulentas

8.3 Derechos de los titulares (Artículo 8, Ley 1581 de 2012)
    Como titular de datos personales, tienes derecho a:
    a) Conocer, actualizar y rectificar tus datos personales
    b) Solicitar prueba de la autorización otorgada
    c) Ser informado sobre el uso que se ha dado a tus datos
    d) Presentar quejas ante la Superintendencia de Industria y Comercio (SIC) por violaciones a la ley
    e) Revocar la autorización y/o solicitar la supresión de tus datos cuando no se respeten los principios, derechos y garantías constitucionales y legales
    f) Acceder de forma gratuita a tus datos personales que hayan sido tratados

8.4 Autorización
    - Al crear tu cuenta y aceptar estos términos, otorgas autorización expresa para el tratamiento de tus datos personales conforme a esta política
    - La autorización es libre, previa, expresa e informada
    - Puedes revocar esta autorización en cualquier momento contactando a sebasgc0399@gmail.com

8.5 Procedimiento para consultas y reclamos
    a) Consultas (Artículo 14):
       - Enviar solicitud a sebasgc0399@gmail.com indicando nombre, email de la cuenta y la consulta
       - Plazo de respuesta: máximo 10 días hábiles
       - Si no es posible responder en ese plazo, se informará al titular indicando los motivos y la fecha estimada de respuesta (máximo 5 días hábiles adicionales)
    b) Reclamos (Artículo 15):
       - Enviar reclamo a sebasgc0399@gmail.com indicando: identificación del titular, descripción de los hechos, dirección, documentos de soporte
       - Plazo de respuesta: máximo 15 días hábiles
       - Si el reclamo está incompleto, se requerirá al titular dentro de los 5 días siguientes para que subsane las fallas
    c) Supresión de datos:
       - Solicitar eliminación de cuenta y datos a sebasgc0399@gmail.com
       - Se procederá a la eliminación dentro de los 15 días hábiles siguientes, salvo obligación legal de conservación
    d) Autoridad de control:
       - Superintendencia de Industria y Comercio (SIC)
       - www.sic.gov.co

8.6 Vigencia
    - Esta política entra en vigor a partir de la fecha de su publicación
    - Los datos personales se tratarán mientras exista la finalidad para la cual fueron recolectados y/o mientras el titular no solicite su supresión
    - Los datos de transacciones financieras se conservarán por el plazo legal aplicable (mínimo 5 años)
```

### Impacto
- Parte del mismo archivo `privacy.html` de la Fase 2

### Verificación
- [ ] La sección existe dentro de `privacy.html`
- [ ] El anchor `#tratamiento-datos` funciona
- [ ] Contiene todos los artículos de la Ley 1581 referenciados (Art. 8, 14, 15)
- [ ] Menciona a la SIC como autoridad de control

---

## Fase 5 — Implementación en la app

> **Mini-RFC requerido:** Esta fase modifica el modelo de datos en Firestore (`UserRecord`) y el flujo de autenticación. Según CLAUDE.md, requiere aprobación antes de implementar.

### 5a. Campos en UserRecord

**Archivo:** `functions/src/domain/contracts.ts`

Agregar a `UserRecord` (después de `lastVideoProcessDate`):

```typescript
acceptedTermsAt: IsoDateString | null    // timestamp ISO de aceptación
acceptedTermsVersion: string             // versión de los términos, ej: "2026-03-29"
```

- `acceptedTermsAt`: `null` para usuarios existentes que no han aceptado (migración gradual)
- `acceptedTermsVersion`: permite detectar si el usuario aceptó una versión desactualizada

**Impacto en otros archivos:**
- `functions/src/handlers/userSync.ts` — agregar campos al crear usuario nuevo
- Tests de userSync — actualizar `UserRecord` mock

### 5b. Checkbox en LoginPage.tsx — Modo Email/Password

**Archivo:** `frontend/src/pages/LoginPage.tsx`

Cambios:
1. Agregar estado: `const [acceptedTerms, setAcceptedTerms] = useState(false)`
2. Renderizar checkbox solo cuando `isRegister === true`, después del campo de contraseña:

```tsx
{isRegister && (
  <div className="flex items-start gap-2">
    <input
      type="checkbox"
      id="terms"
      checked={acceptedTerms}
      onChange={(e) => setAcceptedTerms(e.target.checked)}
      className="mt-1 ..."
    />
    <label htmlFor="terms" className="text-xs ..." style={{ color: 'var(--text-secondary)' }}>
      Al crear tu cuenta, aceptas los{' '}
      <a href="/legal/terms" target="_blank" ...>Términos de Servicio</a>
      {' '}y la{' '}
      <a href="/legal/privacy" target="_blank" ...>Política de Privacidad</a>
    </label>
  </div>
)}
```

3. Deshabilitar botón "Crear cuenta": `disabled={submitting || (isRegister && !acceptedTerms)}`
4. Deshabilitar botón "Continuar con Google" cuando `isRegister && !acceptedTerms`
5. Resetear `acceptedTerms` a `false` cuando se cambia de modo (`setIsRegister`)

### 5c. Google Sign-In — Edge case: login de usuario nuevo

**Problema:** Cuando `isRegister === false`, el botón de Google no está bloqueado por el checkbox. Si el usuario resulta ser nuevo (primera vez con Google), necesita aceptar términos.

**Solución en dos pasos:**

#### Paso 1 — userSync retorna `isNewUser`

**Archivo:** `functions/src/handlers/userSync.ts`

```typescript
// Respuesta actual:
res.status(200).json({ status: 'ok' })

// Cambiar a:
res.status(200).json({ status: 'ok', isNewUser: !userSnap.exists })
```

Leer `req.body.termsVersion` (opcional). Si es usuario nuevo Y viene con `termsVersion`, guardar:
```typescript
acceptedTermsAt: now,
acceptedTermsVersion: req.body.termsVersion,
```

Si es usuario nuevo sin `termsVersion` (caso Google login→new user), guardar:
```typescript
acceptedTermsAt: null,
acceptedTermsVersion: '',
```

#### Paso 2 — Modal de aceptación post-registro

**Archivo nuevo:** `frontend/src/components/legal/TermsAcceptanceModal.tsx`

Componente modal/sheet que:
- Se muestra cuando `isNewUser === true && acceptedTermsAt === null`
- Contiene el texto: "Para continuar usando Cielo Estrellado, acepta los Términos de Servicio y la Política de Privacidad"
- Checkbox + botón "Aceptar y continuar"
- Si el usuario cierra sin aceptar → sign-out (no puede usar la app sin aceptar)

#### Paso 3 — Endpoint acceptTerms

**Archivo nuevo:** `functions/src/handlers/acceptTerms.ts`

Endpoint ligero `POST /api/acceptTerms`:
```typescript
export async function acceptTerms(req: Request, res: Response): Promise<void> {
  const decoded = await authenticateRequest(req)
  const termsVersion = req.body.termsVersion  // ej: "2026-03-29"
  if (!termsVersion) {
    res.status(400).json({ error: 'termsVersion requerido' })
    return
  }
  const now = new Date().toISOString()
  await db.collection('users').doc(decoded.uid).update({
    acceptedTermsAt: now,
    acceptedTermsVersion: termsVersion,
  })
  res.status(200).json({ status: 'ok' })
}
```

Registrar en el router de la API junto a los demás endpoints.

#### Paso 4 — AuthContext pasa termsVersion al sync

**Archivo:** `frontend/src/lib/auth/AuthContext.tsx`

Cambios en `onIdTokenChanged` callback:
- El POST a `/api/userSync` ahora puede incluir `{ termsVersion }` en el body
- Necesita un mecanismo para saber si el registro fue con términos aceptados

Opción elegida: usar un `ref` que almacene `pendingTermsVersion`:
```typescript
const pendingTermsVersion = useRef<string | null>(null)

// En signUpWithEmail:
const signUpWithEmail = useCallback(async (email: string, password: string, termsVersion: string) => {
  pendingTermsVersion.current = termsVersion
  await createUserWithEmailAndPassword(auth, email, password)
}, [])

// En onIdTokenChanged:
const body = pendingTermsVersion.current
  ? { termsVersion: pendingTermsVersion.current }
  : undefined
const response = await api('/api/userSync', {
  method: 'POST',
  ...(body && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
})
pendingTermsVersion.current = null
```

Para Google en modo registro:
```typescript
const signInWithGoogle = useCallback(async (termsVersion?: string) => {
  if (termsVersion) pendingTermsVersion.current = termsVersion
  const provider = new GoogleAuthProvider()
  await signInWithPopup(auth, provider)
}, [])
```

### 5d. Firebase Hosting — URLs limpias

**Archivo:** `firebase.json`

Agregar `cleanUrls` al bloque de hosting:

```json
{
  "hosting": {
    "target": "web",
    "public": "frontend/dist",
    "cleanUrls": true,
    "rewrites": [ ... ]
  }
}
```

Esto permite acceder a `/legal/privacy` y `/legal/terms` sin extensión `.html`. Firebase sirve archivos estáticos ANTES del rewrite SPA, así que los archivos en `public/legal/` se sirven directamente sin pasar por `index.html`.

### 5e. Links a documentos legales

Agregar links en el footer o menú de la app:
- "Términos de Servicio" → `/legal/terms`
- "Política de Privacidad" → `/legal/privacy`

Ubicación exacta depende del componente de layout existente. Si no existe un footer global, agregar links en el menú de usuario o en la página de configuración.

### 5f. CSP — Sin cambios necesarios

Los links a `/legal/*` son same-origin, no requieren ajuste en Content-Security-Policy.

---

## Resumen de archivos

### Archivos a crear
| Archivo | Tipo | Fase |
|---------|------|------|
| `LICENSE` | MIT license text | 1 |
| `frontend/public/legal/privacy.html` | HTML estático | 2, 4 |
| `frontend/public/legal/terms.html` | HTML estático | 3 |
| `functions/src/handlers/acceptTerms.ts` | Cloud Function handler | 5c |
| `frontend/src/components/legal/TermsAcceptanceModal.tsx` | Componente React | 5c |

### Archivos a modificar
| Archivo | Cambio | Fase |
|---------|--------|------|
| `functions/src/domain/contracts.ts` | +2 campos en `UserRecord` | 5a |
| `functions/src/handlers/userSync.ts` | Leer `body.termsVersion`, retornar `isNewUser`, guardar campos de terms | 5c |
| `frontend/src/lib/auth/AuthContext.tsx` | `pendingTermsVersion` ref, firmas de `signUpWithEmail` y `signInWithGoogle` | 5c |
| `frontend/src/pages/LoginPage.tsx` | Checkbox + lógica de gating para ambos modos | 5b |
| `firebase.json` | Agregar `cleanUrls: true` | 5d |
| Router de la API (donde se registran endpoints) | Registrar `/api/acceptTerms` | 5c |
| Tests de `userSync` | Actualizar para nuevos campos y respuesta `isNewUser` | 5 |
| Tests de `LoginPage` (si existen) | Actualizar para checkbox | 5 |

---

## Orden de implementación recomendado

1. **Fase 1** — `LICENSE` (independiente, 1 minuto)
2. **Fase 5a** — Campos en `contracts.ts` (mini-RFC, base para todo lo demás)
3. **Fase 5d** — `cleanUrls` en `firebase.json` (independiente, 1 minuto)
4. **Fase 2 + 4** — `privacy.html` con sección de tratamiento de datos (independiente del código)
5. **Fase 3** — `terms.html` (independiente del código)
6. **Fase 5b** — Checkbox en `LoginPage.tsx`
7. **Fase 5c** — Flujo completo: `userSync` modificado + `acceptTerms` endpoint + `AuthContext` + modal
8. **Fase 5e** — Links en footer/menú
9. **Tests** — Actualizar tests existentes + nuevos tests para `acceptTerms`

---

## Verificación end-to-end

### Fase 1
- [ ] `LICENSE` existe en raíz, formato MIT, titular: Sebastian Gutierrez, año: 2026

### Fases 2-4
- [ ] `curl https://[dominio]/legal/privacy` retorna HTML completo sin depender de JavaScript
- [ ] `curl https://[dominio]/legal/terms` retorna HTML completo sin depender de JavaScript
- [ ] El anchor `#tratamiento-datos` existe en `privacy.html`
- [ ] Ambos documentos están en español (Colombia)

### Fase 5 — Flujo email/password registro
- [ ] En modo registro: checkbox visible, botón "Crear cuenta" deshabilitado sin checkbox
- [ ] Marcar checkbox → botón habilitado → registro exitoso
- [ ] En Firestore: `acceptedTermsAt` tiene timestamp, `acceptedTermsVersion` tiene versión
- [ ] En modo login: NO hay checkbox, login funciona normalmente

### Fase 5 — Flujo Google registro
- [ ] En modo registro (`isRegister === true`): checkbox bloquea botón de Google
- [ ] Marcar checkbox → Google Sign-In → registro exitoso con terms guardados

### Fase 5 — Flujo Google login → usuario nuevo (edge case)
- [ ] En modo login: click en Google → usuario nuevo detectado → modal de términos aparece
- [ ] Aceptar en modal → `acceptTerms` endpoint llamado → terms guardados → acceso completo
- [ ] Cerrar modal sin aceptar → sign-out automático

### Fase 5 — Migración de usuarios existentes
- [ ] Usuarios existentes sin `acceptedTermsAt` pueden seguir usando la app (sin bloqueo inmediato)
- [ ] Se puede implementar re-consent en una fase posterior

### Tests
- [ ] `npm run test:run` pasa en `functions/`
- [ ] `npm run test:run` pasa en `frontend/`
