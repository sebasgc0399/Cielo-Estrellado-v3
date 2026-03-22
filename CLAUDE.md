# CLAUDE.md — Cielo Estrellado v5

## Filosofia operativa

- **Simplicidad extrema.** La solucion mas simple que funcione es la correcta. Si tres lineas resuelven el problema, no crear una abstraccion.
- **Entender el dominio antes de codear.** Un cielo tiene estrellas, miembros e invitaciones. Toda decision tecnica debe partir de ese modelo, no al reves.
- **No abstracciones prematuras.** No crear helpers, utils ni wrappers hasta que haya al menos 3 usos reales. Duplicar es mejor que abstraer sin motivo.
- **Soluciones directas, verificables, mantenibles.** Si no se puede verificar que funciona en menos de 2 minutos, probablemente es demasiado compleja.

## Principios tecnicos

- **TypeScript estricto.** `strict: true` en ambos tsconfig. Cero `any`. Tipar explicitamente lo que no se infiere.
- **Separacion clara de capas:**
  - `engine/` — rendering puro, sin dependencias de React ni Firebase
  - `lib/` — integraciones (Firebase, API client, auth)
  - `hooks/` — logica reactiva que conecta lib con UI
  - `components/` — solo presentacion e interaccion
  - `pages/` — composicion de componentes + routing
  - `handlers/` (functions) — logica de negocio del backend
- **Tailwind CSS + shadcn/ui.** Utility-first con componentes de shadcn. Magic UI para animaciones premium.
  Design tokens via CSS custom properties en globals.css + extension en tailwind.config.
  Objetivo: diseno unico y premium, nunca generico.
- **Consistencia de naming:**
  - Archivos: `PascalCase.tsx` para componentes, `camelCase.ts` para todo lo demas
  - Funciones/variables: `camelCase`
  - Tipos/interfaces: `PascalCase`, sin prefijo `I`
  - Constantes: `UPPER_SNAKE_CASE`
- **No crear archivos fuera del scope.** Cada archivo nuevo debe justificarse con un uso inmediato. No crear "por si acaso".

## Regla de complejidad

Si introduces complejidad (nueva dependencia, nueva capa de abstraccion, patron no trivial), justifica:
1. Que problema resuelve
2. Por que no hay alternativa mas simple
3. Que costo de mantenimiento agrega

Si no puedes responder las tres, simplifica.

## Orquestacion con subagentes

Para tareas complejas, evaluar si conviene dividir el trabajo en subagentes paralelos.
Usar la skill `orchestrate` para la estrategia de delegacion. No duplicar trabajo entre agente principal y subagentes.

## Politica de cambios de alto impacto (mini-RFC)

Antes de tocar cualquiera de estos, proponer el cambio y esperar aprobacion:
- Modelo de datos en Firestore (colecciones, campos, indices)
- Flujo de autenticacion o permisos
- Estructura de carpetas o capas del proyecto
- Dependencias nuevas al proyecto
- Cambios en la API publica del SkyEngine
- Configuracion de Firebase (rules, hosting, functions)

Formato: que se cambia, por que, que alternativas se descartaron, que se rompe si sale mal.

## Contexto del proyecto

- **Stack:** React 19 + Vite 6 + TypeScript (frontend), Cloud Functions v2 gen2 + Node 22 (backend)
- **Firebase project:** `masmelito-f209c` — se reutiliza BD, Storage y Auth existentes de v4
- **v4 esta en:** `../cielo-estrellado-v4/` — fuente para copiar SkyEngine, contracts, policies y reglas
- **SkyEngine se copia verbatim de v4.** No se modifica a menos que haya un bug. Cualquier cambio requiere mini-RFC.
- **Reads directos desde cliente** via `onSnapshot`. Solo writes van por Cloud Functions.
- **Sin SSR.** SPA pura desplegada en Firebase Hosting.

## Comandos

```bash
# Frontend
cd frontend && npm run dev          # Dev server
cd frontend && npm run build        # Build produccion

# Functions
cd functions && npm run build       # Compilar TypeScript
cd functions && npm run serve       # Emulador local

# Deploy
firebase deploy --only functions
firebase deploy --only hosting,firestore,storage
```

## Especificacion

La especificacion completa del proyecto esta en `SPEC.md`. Consultarlo antes de implementar cualquier feature.
