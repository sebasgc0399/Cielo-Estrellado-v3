# Auditoria: Validacion de Inputs

**Fecha:** 2026-03-25
**Alcance:** `functions/src/handlers/skies.ts`, `functions/src/handlers/stars.ts`, `functions/src/handlers/shop.ts`, `functions/src/handlers/invites.ts`, `functions/src/handlers/members.ts`, `functions/src/handlers/payments.ts`, `functions/src/handlers/economy.ts`, `functions/src/domain/policies.ts`
**Severidad general:** Baja

## Resumen ejecutivo

La validacion de inputs es consistente y bien implementada en la mayoria de handlers. Se validan tipos, longitudes, rangos y enums correctamente. Se identifican **0 hallazgos criticos**, **1 medio** y **4 bajos** relacionados con campos no validados en edge cases, falta de sanitizacion para XSS almacenado, y parametros de URL sin validacion de formato.

---

## Hallazgos

### [MEDIO] M1 — Sin sanitizacion de HTML/scripts en campos de texto almacenados

- **Archivo:** `functions/src/handlers/stars.ts:60-74`, `functions/src/handlers/skies.ts:74,175`
- **Descripcion:** Los campos `title`, `message` (stars) y `title` (skies) se validan por tipo y longitud, pero no se sanitizan contra contenido HTML o scripts. Los valores se almacenan tal cual en Firestore:
  ```typescript
  const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
  // No hay sanitizacion — un titulo como "<script>alert('xss')</script>" se almacena sin cambios
  ```
- **Impacto:** Si el frontend renderiza estos campos con `dangerouslySetInnerHTML` o similar, podria haber XSS almacenado. Sin embargo, React escapa HTML por defecto en JSX (`{star.title}`), lo que mitiga el riesgo significativamente. El riesgo real es si un futuro consumer (app movil, export PDF, email) no escapa el contenido.
- **Recomendacion:** Dos opciones:
  1. **Minimalista (recomendada):** No sanitizar en el backend — depender del escapado de React y documentar que los campos pueden contener HTML crudo. Agregar un comentario en el codigo.
  2. **Defensiva:** Aplicar un strip basico de tags HTML en el backend:
     ```typescript
     const sanitized = rawTitle.replace(/<[^>]*>/g, '')
     ```
     Nota: esto podria afectar titulos legitimos con `<` (ej: "x < y").

---

### [BAJO] B1 — Parametros de URL (`skyId`, `starId`, `inviteId`) sin validacion de formato

- **Archivo:** Todos los handlers que usan `req.routeParams`
- **Descripcion:** Los IDs de ruta (`skyId`, `starId`, `inviteId`, `reference`, `userId`, `token`) se extraen de `req.routeParams` y se usan directamente en queries de Firestore sin validar formato. Por ejemplo:
  ```typescript
  const { skyId } = req.routeParams
  const skyRef = db.collection('skies').doc(skyId) // skyId podria ser cualquier string
  ```
  Firestore acepta cualquier string como document ID, asi que no hay riesgo de inyeccion. Sin embargo, IDs malformados (vacios, con `/`, extremadamente largos) podrian causar comportamientos inesperados.
- **Impacto:** Minimo. Firestore maneja IDs arbitrarios de forma segura. Un ID con `/` podria crear un path inesperado, pero `doc()` no permite `/` en IDs y lanzaria un error interno.
- **Recomendacion:** Agregar una validacion basica reutilizable:
  ```typescript
  function isValidDocId(id: string): boolean {
    return id.length > 0 && id.length <= 128 && !id.includes('/')
  }
  ```
  Aplicar al inicio de cada handler. No es urgente.

### [BAJO] B2 — `updateStar` no valida `year` en actualizacion

- **Archivo:** `functions/src/handlers/stars.ts:201-352`
- **Descripcion:** En `createStar` (linea 101), `year` se valida:
  ```typescript
  const year = typeof body.year === 'number' && Number.isFinite(body.year) ? body.year : null
  ```
  Pero en `updateStar`, no hay campo `year` en el body tipado (linea 239-245) y no se puede actualizar. Esto podria ser intencional (year es inmutable), pero no esta documentado ni validado explicitamente.
- **Impacto:** Bajo. Si un cliente envia `year` en un update, Firestore lo ignoraria porque no se incluye en `updatePayload`. No hay riesgo de datos invalidos.
- **Recomendacion:** Si `year` es inmutable, documentarlo. Si deberia ser editable, agregar la validacion y el campo al `updatePayload`.

### [BAJO] B3 — `getTransactions` acepta `cursor` como cualquier string

- **Archivo:** `functions/src/handlers/economy.ts:227,234-238`
- **Descripcion:** El parametro `cursor` se toma del query string y se usa como document ID para paginacion. Si el cursor no corresponde a un documento existente, simplemente no se aplica el `startAfter` y retorna desde el inicio.
  ```typescript
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null
  if (cursor) {
    const cursorDoc = await userRef.collection('transactions').doc(cursor).get()
    if (cursorDoc.exists) {
      query = query.startAfter(cursorDoc)
    }
  }
  ```
- **Impacto:** Bajo. Un cursor invalido no causa error, simplemente retorna la primera pagina. Sin embargo, genera un read innecesario a Firestore.
- **Recomendacion:** Agregar validacion de formato basica antes del read:
  ```typescript
  if (cursor && cursor.length > 0 && cursor.length <= 128) { ... }
  ```

### [BAJO] B4 — `description` no tiene validacion de longitud en SkyRecord

- **Archivo:** `functions/src/handlers/skies.ts:112-122`, `functions/src/domain/policies.ts`
- **Descripcion:** `SkyRecord.description` se inicializa como `null` al crear un cielo. En `updateSky`, no hay campo `description` aceptado en el body (linea 160). Sin embargo, si se agregara en el futuro, no hay constante `SKY_DESCRIPTION_MAX_LENGTH` en `policies.ts`.
- **Impacto:** Nulo actualmente — `description` no se puede modificar via API. Si se agrega esa funcionalidad, faltaria el limite.
- **Recomendacion:** Agregar `SKY_DESCRIPTION_MAX_LENGTH` a `policies.ts` preventivamente cuando se implemente la edicion de descripcion.

---

## Matriz de validacion por handler

| Handler | Campo | Tipo | Longitud | Rango/Enum | Formato |
|---------|-------|------|----------|------------|---------|
| **createSky** | title | string ✅ | MAX 100 ✅ | — | trim ✅ |
| **updateSky** | title | string ✅ | MAX 100 ✅ | — | trim ✅ |
| **updateSky** | personalization.density | string ✅ | — | low/medium/high ✅ | — |
| **updateSky** | personalization.*Enabled | boolean ✅ | — | — | — |
| **updateSky** | unknown keys | rejected ✅ | — | — | — |
| **updateSkyTheme** | themeId | string ✅ | — | VALID_THEME_IDS ✅ | trim ✅ |
| **createStar** | title | string ✅ | MAX 200 ✅ | — | trim ✅ |
| **createStar** | message | string ✅ | MAX 2000 ✅ | — | trim ✅ |
| **createStar** | x/yNormalized | number ✅ | — | 0-1 ✅, isFinite ✅ | pair validation ✅ |
| **createStar** | year | number ✅ | — | isFinite ✅ | — |
| **updateStar** | title | string ✅ | MAX 200 ✅ | — | trim ✅ |
| **updateStar** | message | string ✅ | MAX 2000 ✅ | — | trim ✅ |
| **updateStar** | x/yNormalized | number ✅ | — | 0-1 ✅, isFinite ✅ | pair validation ✅ |
| **updateStar** | imagePath | string/null ✅ | — | canonical path ✅ | — |
| **updateStar** | year | — | — | — | no aceptado ⚠️ |
| **purchase** | itemId | string ✅ | — | catalogo ✅ | trim ✅ |
| **createPayment** | packageId | string ✅ | — | catalogo ✅ | trim ✅ |
| **createInvite** | role | string ✅ | — | editor/viewer ✅ | default editor ✅ |
| **updateMember** | role | string ✅ | — | editor/viewer ✅ | — |
| **updateMember** | status | string ✅ | — | solo "revoked" ✅ | — |
| **updateMember** | status+role | — | — | mutuamente exclusivos ✅ | — |
| **getTransactions** | limit | number ✅ | — | 1-50 ✅ | NaN → 20 ✅ |
| **getTransactions** | cursor | string ✅ | — | — | sin formato ⚠️ |
| **URL params** | skyId/starId/etc | — | — | — | sin validacion ⚠️ |

---

## Aspectos positivos

1. **Validacion de tipo consistente:** Todos los handlers verifican `typeof` antes de usar valores del body. El patron `typeof body.field === 'string' ? body.field.trim() : ''` es uniforme.
2. **Longitudes de policies.ts aplicadas:** `STAR_TITLE_MAX_LENGTH` (200), `STAR_MESSAGE_MAX_LENGTH` (2000), `SKY_TITLE_MAX_LENGTH` (100) se aplican en todos los puntos de entrada.
3. **Coordenadas rigurosas:** Validacion de par (ambas o ninguna), tipo numerico, `isFinite()`, rango 0-1. Exhaustivo.
4. **Enums validados:** Roles (`editor`, `viewer`), densidades (`low`, `medium`, `high`), status (`revoked`), themeId contra catalogo. No se aceptan valores arbitrarios.
5. **Claves desconocidas rechazadas:** En `updateSky`, los campos de personalization no reconocidos se rechazan explicitamente (linea 189-194).
6. **imagePath canonico:** En `updateStar`, el `imagePath` se valida contra el path canonico esperado (`stars/{skyId}/{starId}/image`). Previene path traversal.
7. **Limites de paginacion:** `getTransactions` limita entre 1 y 50 con default 20.
8. **Item validation contra catalogo estatico:** Tanto `purchase` como `createPayment` validan contra catalogos hardcodeados (`getShopItem`, `getStardustPackage`).
9. **Trim en strings:** Previene titulos de solo espacios y whitespace innecesario.
10. **No-op detection:** `updateStar` detecta cuando no hay cambios y retorna 200 sin write a Firestore.

---

## Conclusion

La validacion de inputs es solida y consistente. El hallazgo medio (M1) sobre sanitizacion HTML es mitigado por React, pero vale la pena documentar la decision. Los hallazgos bajos son edge cases con impacto minimo. No se encontraron vectores de inyeccion explotables.

### Proximos pasos recomendados (por prioridad):
1. Documentar que campos de texto pueden contener HTML crudo y que React los escapa (M1)
2. Agregar validacion basica de formato a IDs de URL cuando sea conveniente (B1)
3. Definir si `year` es inmutable o editable en `updateStar` (B2)
