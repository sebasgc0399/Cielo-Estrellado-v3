# Auditoria: Firestore Rules y Storage Rules

**Fecha:** 2026-03-25
**Alcance:** `firestore.rules`, `storage.rules`, `firestore.indexes.json`, verificacion cruzada con handlers y frontend
**Severidad general:** Baja

## Resumen ejecutivo

Las reglas de seguridad estan bien disenadas siguiendo un modelo de denegacion por defecto. Todos los writes estan bloqueados para el cliente, los reads son selectivos (solo stars para miembros activos), y hay un catch-all deny. Se identifican **1 hallazgo medio** y **3 bajos**, principalmente relacionados con eficiencia de reads en rules y cobertura de edge cases en Storage.

---

## Hallazgos

### [MEDIO] M1 — Multiple reads redundantes en Storage rules (costo y latencia)

- **Archivo:** `storage.rules:6-35`
- **Descripcion:** Las funciones `isActiveMember()`, `canAttach()` y `starExistsAndActive()` hacen multiples llamadas a `firestore.get()` y `firestore.exists()` sobre los mismos documentos. En el peor caso (un `create` o `update`), se realizan hasta **7 reads a Firestore** para una sola operacion de Storage:
  - `firestore.exists(memberRef())` — 1 read
  - `firestore.get(memberRef()).data.status` — 1 read (no se cachea con exists)
  - `firestore.get(memberRef()).data.role` — repetido en `canAttach` (hasta 2 reads mas)
  - `firestore.exists(starRef())` — 1 read
  - `firestore.get(starRef()).data.deletedAt` — 1 read
  - `firestore.get(starRef()).data.imagePath` — 1 read
  - `firestore.get(starRef()).data.authorUserId` — 1 read (para editors)
- **Impacto:** Cada upload de imagen genera 5-7 reads adicionales a Firestore. Con Firebase, los security rules reads tienen un limite de 10 por request y cuentan para facturacion. El limite no se supera, pero el costo se multiplica innecesariamente.
- **Recomendacion:** Firebase cachea `get()` calls al mismo path dentro de la misma evaluacion de rules. Verificar en documentacion actual si `exists()` + `get()` al mismo path comparten cache. Si no, refactorizar para usar solo `get()` y verificar existencia con `get().data != null`. Ejemplo:
  ```
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

---

### [BAJO] B1 — Firestore rules no distinguen entre coleccion `invites` de nivel raiz y posible subcoleccion

- **Archivo:** `firestore.rules:45-47`
- **Descripcion:** Las invitaciones se almacenan como coleccion de nivel raiz (`/invites/{inviteId}`). Sin embargo, en el codigo de handlers, se observa que `invites` se consulta con `where('skyId', '==', skyId)`, lo que sugiere una coleccion plana. La rule cubre el path `/invites/{inviteId}` con `allow read, write: if false`, lo cual es correcto.
- **Impacto:** Ninguno actualmente. La cobertura es correcta para la estructura actual.
- **Recomendacion:** Solo documentar la decision de usar coleccion raiz vs subcoleccion para referencia futura. No requiere cambio.

### [BAJO] B2 — El catch-all deny puede enmascarar colecciones futuras sin reglas

- **Archivo:** `firestore.rules:55-57`
- **Descripcion:** La regla `match /{document=**} { allow read, write: if false; }` deniega todo lo que no tiene regla explicita. Esto es correcto como seguridad, pero si se agrega una nueva coleccion en el backend sin actualizar las rules, no habra error — simplemente se denegara silenciosamente.
- **Impacto:** Un desarrollador podria agregar una coleccion nueva en un handler y asumir que funciona desde el cliente, cuando en realidad esta bloqueada. Sin embargo, dado que el modelo del proyecto es "writes via Cloud Functions", esto es mas una proteccion que un problema.
- **Recomendacion:** Agregar un comentario en `firestore.rules` listando todas las colecciones conocidas para que sea evidente cuando se agrega una nueva. No requiere cambio funcional.

### [BAJO] B3 — Storage rules no cubren paths arbitrarios (no hay catch-all)

- **Archivo:** `storage.rules`
- **Descripcion:** Las storage rules solo cubren `/stars/{skyId}/{starId}/image` y `/legacy/stars/{fileName}`. No hay regla catch-all para otros paths. En Firebase Storage, si no hay regla que matchee un path, el acceso se deniega por defecto (a diferencia de Realtime Database). Sin embargo, esto no esta documentado explicitamente.
- **Impacto:** Bajo. Firebase Storage ya deniega por defecto si no hay match. Pero un path como `/stars/{skyId}/{starId}/thumbnail` no tendria regla explicita — seria denegado implicitamente.
- **Recomendacion:** Agregar un catch-all explicito al final de storage.rules por claridad:
  ```
  // Catch-all deny — todo path no cubierto
  match /{allPaths=**} {
    allow read, write: if false;
  }
  ```

---

## Aspectos positivos

1. **Modelo de denegacion por defecto:** Todas las colecciones tienen `allow write: if false`. Solo Cloud Functions escriben via Admin SDK que bypasea las rules.
2. **Reads selectivos y minimos:** Solo `skies/{skyId}/stars/{starId}` permite lectura desde el cliente, y solo para miembros activos. Esto es exactamente lo que el frontend necesita (onSnapshot en `useSkyStars.ts`).
3. **Usuarios completamente protegidos:** `/users/{uid}` y sus subcolecciones (`inventory`, `transactions`) estan bloqueados. Todo acceso es via Cloud Functions.
4. **Payments bloqueados:** Ningun acceso de cliente a pagos. Correcto.
5. **Storage con validacion de contenido:** Tipo MIME (`jpeg|png|webp`), tamano (<5MB) y condicion de negocio (`imagePath == null`) validados en rules.
6. **Prevencion de reemplazo de imagen:** Solo se permite upload cuando `imagePath == null` en Firestore, previniendo sobreescritura de imagenes ya adjuntas.
7. **Control de acceso por rol en Storage:** Owners pueden subir a cualquier star, editors solo a sus propias stars.
8. **Delete de Storage bloqueado:** Correcto para el modelo actual donde las imagenes se manejan desde Cloud Functions.
9. **Catch-all en Firestore:** La regla `/{document=**}` deniega cualquier coleccion no listada.
10. **Indexes correctos:** Los composite indexes en `firestore.indexes.json` cubren las queries usadas en los handlers (members por userId+status, payments por reference+userId, invites por skyId+status).
11. **Consistencia frontend-backend:** El unico `onSnapshot` del frontend (`useSkyStars.ts`) accede exactamente al path permitido: `skies/{skyId}/stars`.
12. **Legacy path protegido:** El acceso legacy esta limitado a un skyId especifico (`shared-legacy-v1`) y solo lectura.

---

## Matriz de cobertura

| Coleccion | Path en Rules | Read cliente | Write cliente | Backend (Admin SDK) |
|-----------|---------------|-------------|---------------|---------------------|
| users | `/users/{uid}` | Bloqueado | Bloqueado | OK |
| users/inventory | `/users/{uid}/inventory/{itemId}` | Bloqueado | Bloqueado | OK |
| users/transactions | `/users/{uid}/transactions/{txId}` | Bloqueado | Bloqueado | OK |
| skies | `/skies/{skyId}` | Bloqueado | Bloqueado | OK |
| skies/stars | `/skies/{skyId}/stars/{starId}` | Miembro activo | Bloqueado | OK |
| skies/members | `/skies/{skyId}/members/{memberId}` | Bloqueado | Bloqueado | OK |
| invites | `/invites/{inviteId}` | Bloqueado | Bloqueado | OK |
| payments | `/payments/{paymentId}` | Bloqueado | Bloqueado | OK |
| Storage: stars | `/stars/{skyId}/{starId}/image` | Miembro + star activa | canAttach + imagePath null | Via Admin SDK |
| Storage: legacy | `/legacy/stars/{fileName}` | Miembro legacy | Bloqueado | N/A |

Todas las colecciones usadas en handlers tienen regla explicita. Sin gaps.

---

## Conclusion

Las Firestore y Storage rules estan bien implementadas con un modelo conservador de denegacion por defecto. No se encontraron vulnerabilidades. El hallazgo medio (M1) es una optimizacion de costo/rendimiento en Storage rules, no un problema de seguridad. Los hallazgos bajos son mejoras de claridad y documentacion.

### Proximos pasos recomendados (por prioridad):
1. Optimizar reads redundantes en Storage rules (M1) — reducir de ~7 a ~2 reads por upload
2. Agregar catch-all explicito en Storage rules (B3) — claridad
3. Documentar colecciones en comentario de firestore.rules (B2) — mantenibilidad
