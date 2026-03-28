# SPEC: Correcciones a Firestore Rules, Storage Rules y firebase.json

**Fecha:** 2026-03-27
**Estado:** Pendiente
**Origen:** `audits/02-firestore-rules.md` (auditoria de seguridad) + inspeccion directa de codigo
**Archivos afectados:**
- `firebase.json` (configuracion Firebase CLI)
- `storage.rules` (reglas de Storage)
- `firestore.rules` (reglas de Firestore)

## Contexto

La auditoria `02-firestore-rules.md` identifico 1 hallazgo medio y 3 bajos en las reglas de Firebase. Durante la inspeccion directa de los archivos se encontro adicionalmente un **bug critico de configuracion** en `firebase.json` que no fue detectado en la auditoria original.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 0: Bug en firebase.json — clave duplicada `rules` [NUEVO — Critico]

### Problema

`firebase.json` declara dos veces la clave `"rules"` dentro del objeto `"firestore"`. En JSON, cuando hay claves duplicadas, la ultima sobreescribe la anterior. El CLI de Firebase recibe:

- `rules` → `"firestore.indexes.json"` (la segunda entrada gana — apunta al archivo de indices, no al de reglas)
- `indexes` → **ausente** (nunca se deployean los indices)

### Codigo actual (`firebase.json:25-28`)

```json
"firestore": {
  "rules": "firestore.rules",
  "rules": "firestore.indexes.json"
}
```

### Codigo propuesto

```json
"firestore": {
  "rules": "firestore.rules",
  "indexes": "firestore.indexes.json"
}
```

### Impacto

Los 5 indices compuestos definidos en `firestore.indexes.json` probablemente **nunca se han desplegado** si este bug existe desde el inicio del proyecto:

- `stars`: `authorUserId` + `deletedAt`
- `members`: `userId` + `role` + `status` (collection group)
- `invites`: `skyId` + `status` + `expiresAt`
- `payments`: `wompiReference` + `userId`
- `payments`: `userId` + `status` ← **requerido por el rate limiting de SPEC-Pagos-Wompi Fix M1**

Las queries que dependen de indices compuestos pueden estar realizando full-scans o fallando con error en produccion. El indice `payments: userId+status` en particular es prerequisito del rate limiting de pagos — si ese fix se deploya antes de corregir este bug, falla con error de Firestore en produccion.

Hay una segunda implicacion: si el bug ha estado activo, cada `firebase deploy --only firestore:rules` ha intentado deployar `firestore.indexes.json` (un JSON de indices) como si fuera un archivo de reglas. Firebase CLI probablemente rechazo ese deploy con error de parsing — lo que significa que las reglas en produccion pueden ser de un deploy anterior, de un estado previo al bug, o de un deploy manual desde la consola. Puede haber **drift entre el repo y produccion**.

### Verificacion obligatoria pre-deploy

Antes de cualquier cambio, ir a Firebase Console y registrar el estado actual:

1. **Firebase Console → Firestore → Indexes:** listar cuales de los 5 indices existen y cuales no. Dos escenarios posibles:
   - *Indices no existen:* el bug ha estado activo y las queries dependientes han estado fallando o haciendo full-scans. Deployar F0 crea los indices desde cero.
   - *Indices existen (creados manualmente):* alguien los creo desde la consola cuando Firestore lanzo el error con el link automatico. El fix de firebase.json sigue siendo necesario para que los deploys futuros no los borren — pero no hay urgencia de datos.

2. **Firebase Console → Firestore → Rules:** comparar el contenido desplegado con `firestore.rules` en el repo. Si no coinciden, hay drift que debe reconciliarse **antes** de hacer cualquier deploy de rules. El fix de rules debe partir del estado actual en produccion, no del estado en el repo.

3. **Firebase Console → Storage → Rules:** igual — comparar con `storage.rules` en el repo.

### Decisiones de diseno

- **El fix es trivial** (un caracter: `"rules"` → `"indexes"`), pero el impacto es alto.
- **Este fix va primero** antes de cualquier deploy de codigo que dependa de indices.
- **La verificacion pre-deploy no es opcional** — sin saber el estado actual de indices y rules en produccion, hay riesgo de deployar sobre un estado desconocido.

---

## Fix 1: Reads redundantes en Storage rules [M1 — Medio]

### Problema

Las funciones `isActiveMember()`, `starExistsAndActive()` y `canAttach()` en `storage.rules` combinan `firestore.exists()` + `firestore.get()` sobre el mismo path. Firebase cachea multiples llamadas a `get()` sobre el mismo path dentro de una evaluacion de rules, pero `exists()` y `get()` son funciones distintas y pueden no compartir el mismo cache entry.

En el peor caso para `allow create, update` (evaluacion de `canAttach()`):

| Llamada | Tipo | Path |
|---------|------|------|
| `firestore.exists(memberRef())` en `canAttach` | exists | memberRef |
| `firestore.get(memberRef()).data.status` en `canAttach` | get | memberRef |
| `firestore.exists(starRef())` en `starExistsAndActive` | exists | starRef |
| `firestore.get(starRef()).data.deletedAt` en `starExistsAndActive` | get | starRef |
| `firestore.get(memberRef()).data.role == 'owner'` en `canAttach` | get | memberRef |
| `firestore.get(memberRef()).data.role == 'editor'` en `canAttach` | get | memberRef |
| `firestore.get(starRef()).data.authorUserId` en `canAttach` | get | starRef |
| `firestore.get(starRef()).data.imagePath` en allow rule | get | starRef |

Si `exists()` no comparte cache con `get()`, se realizan hasta 8 reads individuales por upload.

### Codigo actual (`storage.rules:6-51`)

```
function isActiveMember() {
  return firestore.exists(memberRef())
    && firestore.get(memberRef()).data.status == 'active'
    && firestore.get(memberRef()).data.role in ['owner', 'editor', 'viewer'];
}

function starExistsAndActive() {
  return firestore.exists(starRef())
    && firestore.get(starRef()).data.deletedAt == null;
}

function canAttach() {
  return firestore.exists(memberRef())
    && firestore.get(memberRef()).data.status == 'active'
    && starExistsAndActive()
    && (
      firestore.get(memberRef()).data.role == 'owner'
      || (
        firestore.get(memberRef()).data.role == 'editor'
        && firestore.get(starRef()).data.authorUserId == request.auth.uid
      )
    );
}
```

Y en el bloque legacy (`storage.rules:66-70`):

```
function isActiveSharedLegacyMember() {
  return firestore.exists(legacyMemberRef())
    && firestore.get(legacyMemberRef()).data.status == 'active'
    && firestore.get(legacyMemberRef()).data.role in ['owner', 'editor', 'viewer'];
}
```

### Codigo propuesto

**Bloque principal** — reemplazar las 3 funciones (`storage.rules:6-36`):

```
function isActiveMember() {
  let member = firestore.get(memberRef());
  return member.data != null
    && member.data.status == 'active'
    && member.data.role in ['owner', 'editor', 'viewer'];
}

function starExistsAndActive() {
  let star = firestore.get(starRef());
  return star.data != null
    && star.data.deletedAt == null;
}

function canAttach() {
  let member = firestore.get(memberRef());
  let star = firestore.get(starRef());
  return member.data != null
    && member.data.status == 'active'
    && star.data != null
    && star.data.deletedAt == null
    && (member.data.role == 'owner'
      || (member.data.role == 'editor'
        && star.data.authorUserId == request.auth.uid));
}
```

**Bloque legacy** — reemplazar `isActiveSharedLegacyMember()` (`storage.rules:66-70`):

```
function isActiveSharedLegacyMember() {
  let member = firestore.get(legacyMemberRef());
  return member.data != null
    && member.data.status == 'active'
    && member.data.role in ['owner', 'editor', 'viewer'];
}
```

### Cambios clave

1. **`firestore.exists()` eliminado** en todas las funciones. La existencia del documento se verifica con `member.data != null` — semanticamente equivalente: un documento que no existe tiene `data == null`.
2. **Variables locales `let member` / `let star`** — dentro de `canAttach()`, los dos reads se realizan una sola vez y los campos se leen desde la variable local. Firebase cachea `get()` por path dentro de la misma evaluacion, por lo que multiples accesos al mismo `memberRef()` desde distintas funciones comparten el cache.
3. **`canAttach()` es autosuficiente** — ya no delega en `starExistsAndActive()` para evitar ambiguedad sobre cuantos reads internos genera esa funcion dentro de `canAttach`. Las funciones `isActiveMember()` y `starExistsAndActive()` siguen existiendo para el `allow read` rule que las llama directamente.

### Decisiones de diseno

- **Comportamiento identico** para documentos existentes. `member.data != null` es identico a `firestore.exists(memberRef())` en todos los casos practicos.
- **No se cambia la logica de negocio** — las condiciones de rol, status y authorUserId son identicas.
- **La validacion de `imagePath == null` permanece fuera de `canAttach()`** en la regla `allow create, update` — es una condicion de negocio sobre el estado del upload, no sobre quien puede adjuntar, y mantenerla separada preserva la legibilidad.
- **Supuesto de orden de evaluacion para `imagePath`:** la regla `allow create, update` evalua `canAttach()` antes de la condicion `firestore.get(starRef()).data.imagePath == null`. Firebase evalua de izquierda a derecha con short-circuit, por lo que `canAttach()` siempre se ejecuta primero y cachea `starRef()`. La llamada posterior a `firestore.get(starRef())` reutiliza ese cache — no genera un read adicional. Este supuesto es correcto en la implementacion actual de Firebase Rules, pero queda documentado aqui para que sea explicito.

---

## Fix 2: Catch-all explicito en Storage rules [B3 — Bajo]

### Problema

`storage.rules` solo cubre dos paths: `/stars/{skyId}/{starId}/image` y `/legacy/stars/{fileName}`. No hay regla para otros paths. Firebase Storage deniega por defecto cualquier path sin regla, pero la ausencia de catch-all explicito:
- No comunica la intencion de seguridad al lector del archivo
- Un desarrollador que agregue `/stars/{skyId}/{starId}/thumbnail` podria asumir que funcionara, cuando en realidad es denegado silenciosamente

### Codigo a agregar

Al final de `storage.rules`, antes del cierre de `match /b/{bucket}/o {`:

```
// Catch-all deny — cualquier path no cubierto explicitamente queda bloqueado.
// Para agregar paths nuevos (ej. SPEC_v3: temp/{skyId}/{starId}/raw,
// stars/{skyId}/{starId}/video, stars/{skyId}/{starId}/thumb),
// insertar las reglas ANTES de este bloque.
match /{allPaths=**} {
  allow read, write: if false;
}
```

### Decisiones de diseno

- **Sin impacto funcional** — Firebase ya deniega por defecto. Este cambio es solo claridad.
- **El comentario importa** — mencionar explicitamente que paths nuevos deben agregarse antes del catch-all previene el error de agregar una regla despues y preguntarse por que no aplica.
- **Dependencia con SPEC_v3 (video clips):** el roadmap agrega tres paths nuevos de Storage: `temp/{skyId}/{starId}/raw`, `stars/{skyId}/{starId}/video`, y `stars/{skyId}/{starId}/thumb`. El catch-all los bloqueara correctamente hasta que se implemente SPEC_v3. Quien implemente SPEC_v3 debe insertar las reglas de video **antes** del bloque catch-all, no despues.

---

## Fix 3: Comentario de colecciones en firestore.rules [B2 — Bajo]

### Problema

`firestore.rules` tiene un catch-all deny (`/{document=**}`) que bloquea cualquier coleccion sin regla explicita. Esto es correcto como seguridad, pero si se agrega una nueva coleccion en el backend sin actualizar las rules, el acceso se denegara silenciosamente sin ningun error obvio.

No hay ningun comentario que liste las colecciones conocidas del proyecto.

### Codigo a agregar

En `firestore.rules`, despues de `rules_version = '2';` y antes de `service cloud.firestore {`:

```
// Colecciones activas del proyecto: ver functions/src/domain/contracts.ts
// Invariante clave: /skies/{skyId}/stars/{starId} es el unico path con read directo desde el cliente.
// Todas las escrituras son via Cloud Functions (Admin SDK, bypasea estas reglas).
// El catch-all al final deniega cualquier coleccion no listada explicitamente.
```

### Decisiones de diseno

- **Solo documentacion** — sin cambio funcional.
- **Puntero a `contracts.ts` en lugar de lista duplicada:** una lista de colecciones en el archivo de rules es una segunda fuente de verdad que se desincroniza con el tiempo. `contracts.ts` ya se actualiza naturalmente cuando se agregan colecciones (nuevos tipos, interfaces). El comentario apunta ahi en vez de mantener una copia.
- **El invariante sobre stars permanece en el comentario** porque es la unica excepcion relevante para el lector de rules — el resto de colecciones estan todas bloqueadas para el cliente.
- **La nota sobre Admin SDK** evita confusion futura sobre por que el backend puede escribir en colecciones que tienen `allow write: if false`.

---

## Storage rules — archivo completo propuesto

Para referencia, el archivo `storage.rules` completo despues de Fix 1 + Fix 2:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /stars/{skyId}/{starId}/image {

      function memberRef() {
        return /databases/(default)/documents/skies/$(skyId)/members/$(request.auth.uid);
      }

      function starRef() {
        return /databases/(default)/documents/skies/$(skyId)/stars/$(starId);
      }

      function isActiveMember() {
        let member = firestore.get(memberRef());
        return member.data != null
          && member.data.status == 'active'
          && member.data.role in ['owner', 'editor', 'viewer'];
      }

      function starExistsAndActive() {
        let star = firestore.get(starRef());
        return star.data != null
          && star.data.deletedAt == null;
      }

      function canAttach() {
        let member = firestore.get(memberRef());
        let star = firestore.get(starRef());
        return member.data != null
          && member.data.status == 'active'
          && star.data != null
          && star.data.deletedAt == null
          && (member.data.role == 'owner'
            || (member.data.role == 'editor'
              && star.data.authorUserId == request.auth.uid));
      }

      // read: miembro activo + estrella existe y no esta soft-deleted
      allow read: if request.auth != null
        && isActiveMember()
        && starExistsAndActive();

      // create, update: permitido SOLO mientras imagePath es null en Firestore
      // - primer attach: imagePath == null → create aplica
      // - reintento tras PATCH fallido: imagePath sigue siendo null → update aplica (sobreescribe huerfano)
      // - tras PATCH exitoso: imagePath != null → bloqueado (replace fuera de scope)
      allow create, update: if request.auth != null
        && canAttach()
        && firestore.get(starRef()).data.imagePath == null
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/(jpeg|png|webp)');

      // delete: cerrado en este corte
      allow delete: if false;
    }

    // Compatibilidad legacy: imagenes importadas bajo legacy/stars/{fileName}
    // Solo lectura para miembros activos del cielo shared-legacy-v1.
    // Writes permanecen cerrados.
    match /legacy/stars/{fileName} {

      function legacyMemberRef() {
        return /databases/(default)/documents/skies/shared-legacy-v1/members/$(request.auth.uid);
      }

      function isActiveSharedLegacyMember() {
        let member = firestore.get(legacyMemberRef());
        return member.data != null
          && member.data.status == 'active'
          && member.data.role in ['owner', 'editor', 'viewer'];
      }

      allow read: if request.auth != null && isActiveSharedLegacyMember();
      allow write: if false;
    }

    // Catch-all deny — cualquier path no cubierto explicitamente queda bloqueado.
    // Para agregar paths nuevos (ej. SPEC_v3: temp/{skyId}/{starId}/raw,
    // stars/{skyId}/{starId}/video, stars/{skyId}/{starId}/thumb),
    // insertar las reglas ANTES de este bloque.
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Orden de implementacion

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | F0 — firebase.json | Minima | Critico. Prerequisito para que los indices existan en prod. Sin esto, el rate limiting de SPEC-Pagos-Wompi falla. |
| 2 | F1 + F2 — storage.rules | Baja | Mismo archivo. Refactor de funciones + catch-all en un solo commit. |
| 3 | F3 — firestore.rules | Minima | Solo comentario. Sin riesgo. |

### Dependencias entre cambios

- **F0 es bloqueante para SPEC-Pagos-Wompi Fix M1** — si los indices no existen, la query `.count().get()` sobre `payments: userId+status` lanza error en produccion. Deploy de firebase.json primero.
- **F1 y F2 no tienen dependencias** entre si ni con F0/F3.

---

## Verificacion

### Validacion de sintaxis (local, sin necesidad de deploy)

```bash
# Requiere Firebase CLI instalado
firebase firestore:rules --check --rules firestore.rules
# Nota: no existe un comando equivalente para storage.rules en el CLI actual,
# la sintaxis se valida al hacer deploy.
```

### Deploy

```bash
# Deployar todo junto (rules + indexes + storage)
firebase deploy --only firestore:rules,firestore:indexes,storage

# O todo el proyecto si hay otros cambios pendientes
firebase deploy
```

### Checklist post-deploy

- [ ] **Indices desplegados:** Firebase Console → Firestore → Indexes → verificar que los 5 indices aparecen con estado `Enabled`:
  - `stars`: `authorUserId ASC, deletedAt ASC`
  - `members`: `userId ASC, role ASC, status ASC` (collection group)
  - `invites`: `skyId ASC, status ASC, expiresAt ASC`
  - `payments`: `wompiReference ASC, userId ASC`
  - `payments`: `userId ASC, status ASC` ← **critico para SPEC-Pagos-Wompi M1**
- [ ] **Reglas de Firestore:** Firebase Console → Firestore → Rules → confirmar que el contenido desplegado coincide con `firestore.rules`
- [ ] **Reglas de Storage:** Firebase Console → Storage → Rules → confirmar que el contenido desplegado coincide con `storage.rules`
- [ ] **Test upload:** subir una imagen a una estrella existente como owner — debe funcionar
- [ ] **Test upload bloqueado:** intentar subir a una estrella de otro usuario como editor — debe rechazarse con `PERMISSION_DENIED`
- [ ] **Test read:** `onSnapshot` en un cielo del que eres miembro activo — debe recibir las estrellas
- [ ] **Test read bloqueado:** consultar estrellas de un cielo del que NO eres miembro — debe fallar con `PERMISSION_DENIED`
- [ ] **Cloud Logging:** verificar que no hay errores `PERMISSION_DENIED` inesperados en los primeros minutos post-deploy

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Drift entre rules en produccion y `firestore.rules` en el repo | Media | **Verificacion obligatoria pre-deploy** (ver Fix 0). Si hay drift, reconciliar antes de deployar. |
| Indices ya existian (desplegados manualmente desde la consola) | Media | **Verificacion obligatoria pre-deploy** (ver Fix 0). Listar indices en Firebase Console antes del deploy. Si ya existen, no hay impacto funcional — el fix de firebase.json evita que deploys futuros los borren. |
| `member.data != null` se comporta diferente a `firestore.exists()` en alguna edge case | Muy baja | Son semanticamente equivalentes en Firebase Rules. Un documento inexistente siempre tiene `data == null`. |
| Las rules refactorizadas no pasan la evaluacion del emulador de Firebase | Muy baja | La logica de negocio es identica. Solo cambia la estructura de las llamadas `get()`. |
