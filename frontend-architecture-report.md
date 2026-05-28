# Frontend Architecture Report — ISAAC App
**Fecha:** 2026-05-26  
**Estado:** Solo auditoría. Sin cambios al código.

---

## 1. Resumen ejecutivo

El frontend está en un **estado mixto**: algunas páginas son ejemplares (communicator, organization-dashboard), mientras que la página más crítica —`board-builder-editor`— concentra el 40% de la complejidad de toda la app en un único archivo de 2.690 líneas TS + 1.001 líneas HTML. Los servicios están razonablemente separados, pero hay duplicación de tipos, constantes y helpers entre 5–6 archivos.

La refactorización debe hacerse en fases, empezando por lo que no toca lógica funcional.

---

## 2. Tamaño de archivos (líneas de código)

### Pages — TypeScript

| Página | Líneas TS | Valoración |
|---|---|---|
| `board-builder-editor.page.ts` | **2.690** | 🔴 Crítico — página monolítica |
| `board-builder-create.page.ts` | 377 | 🟡 Aceptable |
| `board-builder.page.ts` | 372 | 🟡 Aceptable |
| `add-user.page.ts` | 422 | 🟡 Aceptable |
| `user-final-form.page.ts` | 288 | 🟢 Correcto |
| `user-session.page.ts` | 243 | 🟢 Correcto |
| `organization-profile.page.ts` | 214 | 🟢 Correcto |
| `organization-dashboard.page.ts` | 190 | 🟢 Correcto |
| `register.page.ts` | 174 | 🟢 Correcto |
| `communicator.page.ts` | **164** | 🟢 Modelo a seguir |

### Pages — HTML Templates

| Página | Líneas HTML | Valoración |
|---|---|---|
| `board-builder-editor.page.html` | **1.001** | 🔴 Crítico |
| `board-builder-create.page.html` | 313 | 🟡 Aceptable |
| `board-builder.page.html` | 293 | 🟡 Aceptable |
| `organization-dashboard.page.html` | 201 | 🟢 Correcto |
| `communicator.page.html` | **121** | 🟢 Modelo a seguir |

### Servicios

| Servicio | Líneas | Valoración |
|---|---|---|
| `obz-import.service.ts` | 973 | 🟡 Justificado (lógica compleja) |
| `aac-runtime.service.ts` | 325 | 🟡 Mejorable (voz + log mezclados) |
| `board.service.ts` | 230 | 🟢 Correcto |
| `user.service.ts` | 204 | 🟢 Correcto |
| `auth.service.ts` | 187 | 🟢 Correcto |
| `pictogram-state.service.ts` | 47 | ⚠️ Obsoleto/conflictivo |

---

## 3. Problemas detectados

### 3.1 🔴 CRÍTICO — `board-builder-editor.page.ts` es un monolito

La página mezcla **10 responsabilidades distintas** en un único componente:

```
Responsabilidad                        Aprox. líneas
────────────────────────────────────────────────────
Routing + state management             ~70
Carga / save del tablero               ~120
Grid helpers + D&D + touch-move        ~230
Config panel (columna izquierda)       ~200
Cell editing + saveCell                ~170
ARASAAC search + personal picts        ~100
Preview mode + AAC en editor           ~80
OBF import (processOBFImport)          ~380
OBZ import (importOBZ delegado)        ~90
OBF/OBZ export (buildOBF + validate)   ~330
Circular layout helpers + geometry     ~130
Board list helpers                      ~80
Link-back flow                          ~60
────────────────────────────────────────────────────
TOTAL                                  2.690
```

**El 31% del archivo (≈854 líneas) corresponde solo a import/export OBF/OBZ.** Buena noticia: el bloque de importación OBZ ya fue extraído al servicio. Queda el bloque de exportación.

### 3.2 🔴 CRÍTICO — Duplicación `FITZGERALD` / `WordType`

Hay **dos definiciones distintas** del mismo sistema de colores en dos servicios distintos, con valores diferentes:

```typescript
// board.service.ts — Record<WordType, string>
FITZGERALD = { verb: '#4caf50', pronoun: '#ffd700', noun: '#ff9800', ... }

// pictogram-state.service.ts — FitzgeraldColor[]  
FITZGERALD = [{ type: 'verb', bg: '#43a047', text: '#fff', help: '...' }, ...]
```

Los colores de `verb` son `#4caf50` vs `#43a047`. Son distintos. Esto puede causar inconsistencias visuales según qué código path se ejecute.

**Además**, `WordType` está definida dos veces:
- `board.service.ts` (usado por todo el editor, obz-import)
- `pictogram-state.service.ts` (usado por add-user, user-final-form, assigned-professionals)

### 3.3 🟠 ALTO — `buildSafeUrl` duplicada en 5 páginas

La misma función de 4 líneas está copiada en:
- `board-builder-editor.page.ts`
- `board-builder.page.ts`
- `organization-dashboard.page.ts`
- `user-session.page.ts`
- `communicator.page.ts` (como `buildImageUrl`)

### 3.4 🟠 ALTO — `gridCells` / `getCellData` / `getCellPict` duplicadas

Tres métodos idénticos copiados en `board-builder-editor.page.ts` y `communicator.page.ts`:

```typescript
// IDÉNTICO en ambas páginas
get gridCells(): { row: number; col: number }[] { ... }
getCellData(row: number, col: number): BoardCell | null { ... }
getCellPict(row: number, col: number): CellPictogram | null { ... }
```

### 3.5 🟡 MEDIO — `aac-runtime.service.ts` mezcla TTS + logging OBL

El servicio `AacRuntimeService` (325 líneas) tiene dos responsabilidades claramente separables:
- **Voice synthesis** (TTS, selección de voz según género, `speakText`, `speakPhrase`)
- **OBL event logging** (sesiones, buffer de eventos, flush HTTP, `logButtonEvent`, `logActionEvent`)

### 3.6 🟡 MEDIO — Tipos de dominio embebidos en `board.service.ts`

Interfaces como `Board`, `BoardCell`, `CellPictogram`, `CellAction`, `CreateBoardPayload`, `UpdateBoardPayload` están definidas dentro del archivo del servicio HTTP. Son tipos del dominio, no del servicio de red.

### 3.7 🟡 MEDIO — `pictogram-state.service.ts` está prácticamente obsoleto

Este servicio ya no gestiona estado real (su `pictograms[]` en memoria nunca se usa en el flujo activo). Solo exporta tipos (`WordType`, `FITZGERALD`) que duplican los de `board.service.ts`. Los únicos consumers activos (`add-user`, `user-final-form`) podrían importar directamente desde un archivo de tipos compartido.

### 3.8 🟡 MEDIO — `UserCardData` definida en una page

La interfaz `UserCardData` está en `organization-dashboard.page.ts` con `export`. Las interfaces de datos no deberían vivir en páginas.

### 3.9 🟢 MENOR — Helpers de formato duplicados

`formatDate`, `shapeLabel`, `dimensionLabel` en `board-builder.page.ts` son helpers puros que podrían ser funciones utilitarias compartidas.

### 3.10 🟢 MENOR — Contexto de navegación (creatorId / returnTo) duplicado

Las pages `board-builder`, `board-builder-editor`, `board-builder-create` todas leen y propagan los mismos query params (`creatorId`, `creatorName`, `returnTo`). No hay tipo ni interfaz que los defina.

---

## 4. Pages demasiado grandes

### `board-builder-editor` — El problema principal

**2.690 líneas TS + 1.001 líneas HTML = 3.691 líneas totales.**

Desglose del HTML en regiones lógicas:

```
HTML Region                       Aprox. líneas
────────────────────────────────────────────────
Header toolbar                        ~65
Loading/error states                  ~15
Preview mode — AAC bar                ~45
Preview mode — Grid board             ~40
Preview mode — Circular board         ~50
Edit mode — Left panel (config)       ~115
Edit mode — Left panel (boards list)  ~80
Edit mode — Center grid (editor)      ~100
Edit mode — Center circular (editor)  ~200
Edit mode — Right panel (pictograms)  ~250
Edit mode — Right panel (action)      ~40
────────────────────────────────────────────────
TOTAL                                 ~1.001
```

Cada una de estas regiones es candidata a ser un componente independiente.

---

## 5. Lógica duplicada

| Duplicación | Archivos afectados | Riesgo si se toca |
|---|---|---|
| `buildSafeUrl` / `buildImageUrl` | 5 páginas | 🟢 Bajo |
| `WordType` (tipo) | board.service + pictogram-state | 🟡 Medio |
| `FITZGERALD` (colores distintos!) | board.service + pictogram-state | 🟠 Alto |
| `gridCells` / `getCellData` / `getCellPict` | editor + communicator | 🟡 Medio |
| `UserCardData` interface | org-dashboard (exportada) | 🟢 Bajo |
| `formatDate` / `shapeLabel` / `dimensionLabel` | solo board-builder | 🟢 Bajo |
| Context query params shape | 3 páginas (no tipado) | 🟢 Bajo |

---

## 6. Componentes que extraería

Ordenados de menor a mayor acoplamiento:

### Fase A — Bajo riesgo (no tienen estado propio complejo)

| Componente | Extraído de | Inputs | Eventos |
|---|---|---|---|
| `<app-board-card>` | board-builder.page | `board`, `selectMode`, `isSelected` | `(open)`, `(duplicate)`, `(delete)`, `(select)` |
| `<app-loading-error-state>` | múltiples páginas | `isLoading`, `error`, `emptyMsg` | — |
| `<app-arasaac-search-panel>` | editor (right col) | `query`, `results`, `searching` | `(queryChange)`, `(select)` |
| `<app-pictogram-grid>` | editor (right col) | `pictograms` | `(select)` |

### Fase B — Riesgo medio (estado local, pero bien acotado)

| Componente | Extraído de | Complejidad |
|---|---|---|
| `<app-pictogram-form>` | editor right col (label/sound/tags/FitzGerald) | Media — múltiples fields enlazados |
| `<app-action-form>` | editor right col (tipo acción + tablero destino) | Media — depende de `sameShapeBoards` |
| `<app-board-config-panel>` | editor left col (nombre, imagen, filas, toggles) | Media — muchos campos |
| `<app-board-list-panel>` | editor left col (lista tableros del usuario) | Media — acciones inline |
| `<app-aac-phrase-bar>` | editor preview + communicator | Media — compartida entre dos contextos |

### Fase C — Alto riesgo (profundamente acoplados al estado del editor)

| Componente | Por qué es difícil |
|---|---|
| `<app-board-grid-editor>` | Arrastra estado de D&D, movimiento táctil, selección, preview/edit mode |
| `<app-circular-board-editor>` | Geometría circular acoplada al estado de config + export OBF |
| `<app-cell>` / `<app-circ-slot>` | Muchas clases CSS condicionadas a estado del padre |

---

## 7. Servicios que crearía

### Prioridad alta (ya hay base o el impacto es grande)

| Servicio | Qué contendría | Extraído de |
|---|---|---|
| `ObfExportService` | `buildOBF()`, `buildCircularGridFallback()`, `exportOBF()`, `exportOBZ()`, `hexToRgb()`, `validateOBF()` | editor (≈330 líneas TS) |
| `BoardLayoutService` | `buildGridCells(board)`, `getCellAt(board,r,c)`, `getCircleSlotStyle(i,N)`, `circleSlotSizePx(N)`, `outerSlots(N)`, `locationSlots(board)` | editor + communicator |

### Prioridad media

| Servicio | Qué contendría | Notas |
|---|---|---|
| `SpeechService` | `speakText()`, `speakPhrase()`, selección de voz por género | Extraído de `AacRuntimeService` |
| `OblLoggingService` | `startSession()`, `endSession()`, `logButtonEvent()`, `logActionEvent()`, `logUtteranceEvent()`, `flushEvents()` | Extraído de `AacRuntimeService` |

### Ya existe — sin tocar

| Servicio | Estado |
|---|---|
| `ObzImportService` | ✅ Correcto, bien extraído (sprint actual) |
| `AacRuntimeService` | ✅ Funcional — no tocar hasta que SpeechService/OblLoggingService se prueben |
| `BoardService` | ✅ Limpio (solo HTTP) |
| `AuthService` | ✅ Limpio |
| `UserService` | ✅ Limpio |

---

## 8. Shared / Utils / Types que movería

### Estructura propuesta

```
src/app/
├── shared/
│   ├── models/
│   │   ├── board.model.ts       ← Board, BoardCell, CellPictogram, CellAction,
│   │   │                           BoardShape, CreateBoardPayload, UpdateBoardPayload
│   │   ├── user.model.ts        ← UserCardData, BackendUser, FullBackendUser
│   │   └── aac.model.ts         ← AacPhraseItem, OblEvent, AacMode
│   ├── constants/
│   │   └── fitzgerald.ts        ← WordType (único), FITZGERALD (único), WORD_TYPE_LABELS
│   └── utils/
│       ├── image.utils.ts       ← buildSafeUrl(url, sanitizer): SafeUrl | string
│       ├── board-layout.utils.ts ← buildGridCells(board), getCellAt(board,r,c)
│       ├── board-meta.utils.ts  ← formatDate(), shapeLabel(), dimensionLabel()
│       └── nav-context.ts       ← interface BuilderNavContext { creatorId, creatorName, returnTo }
```

### Prioridad de migración

| Artefacto | Riesgo | Impacto |
|---|---|---|
| `fitzgerald.ts` — consolidar en único fichero | 🟠 Medio (2 fuentes conflictivas) | Alto (elimina inconsistencia de colores) |
| `image.utils.ts` — `buildSafeUrl` | 🟢 Bajo | 5 pages afectadas |
| `board.model.ts` — mover types fuera de board.service | 🟡 Medio (muchos imports) | Limpieza importante |
| `board-layout.utils.ts` | 🟢 Bajo | editor + communicator |
| `board-meta.utils.ts` | 🟢 Bajo | solo board-builder |

---

## 9. Dependencias importantes a respetar

```
communicator.page
    └── AacRuntimeService  ← NO tocar hasta que sea estable
            └── BoardService (no directo, boardNavigated$ observable)

board-builder-editor.page
    ├── BoardService       ← OK, bien acotado
    ├── ObzImportService   ← Recién refactorizado, no tocar
    ├── AacRuntimeService  ← Solo en modo preview, acoplado ligero
    ├── UserService
    └── AuthService

board-builder.page
    ├── BoardService
    ├── ObzImportService
    └── AuthService

ObzImportService
    └── BoardService  ← IMPORTANTE: el servicio llama a createBoard/updateBoard directamente
```

### Acoplamiento crítico: `ObzImportService` ↔ `BoardService`

`ObzImportService` llama a `boardSvc.createBoard()` y `boardSvc.updateBoard()` internamente (diseño de dos pasadas). Esto es correcto pero significa que el servicio tiene una dependencia de escritura a la API, no solo parsing. No cambiar este contrato.

---

## 10. Riesgos por área

| Área | Riesgo de rotura | Razón |
|---|---|---|
| Import OBZ (dos pasadas) | 🔴 Muy alto | Recién refactorizado; fragil por diseño con IDs temporales |
| Export OBF/OBZ circular | 🟠 Alto | Geometría de coordenadas absolutas, validación estricta |
| AAC session lifecycle | 🟠 Alto | `startSession`/`endSession` con efectos externos (OBL HTTP) |
| D&D + touch-move | 🟠 Alto | Manejo de eventos nativo del browser, frágil al cambiar contexto |
| Circular board rendering | 🟠 Alto | Cálculo CSS con fórmula geométrica acoplada al export OBF |
| Grid rendering + selection | 🟡 Medio | Estado de selección muy acoplado al editor |
| Link-back flow | 🟡 Medio | Query params entre 3 páginas (editor → create → editor) |
| Board config panel | 🟢 Bajo | Solo formulario + llamada HTTP |
| ARASAAC search | 🟢 Bajo | Debounce + HTTP, sin estado crítico |
| `buildSafeUrl` | 🟢 Muy bajo | Función pura de 4 líneas |

---

## 11. Orden recomendado de migración

### ✅ FASE 0 — Checkpoint de seguridad (YA HECHO en sprint actual)
- `ObzImportService` extraído y funcionando
- 0 errores TypeScript

---

### 🟢 FASE 1 — Consolidación de tipos y utils puros (sin riesgo funcional)
*Estos cambios son solo mover código, sin alterar lógica.*

**1a. Consolidar `fitzgerald.ts`**
- Crear `src/app/shared/constants/fitzgerald.ts` con UNA definición canónica
- Decidir el formato: `Record<WordType, string>` (el que usa todo el flujo activo)
- Actualizar `pictogram-state.service.ts` para re-exportar desde ahí
- Verificar que `board.service.ts` y `obz-import.service.ts` importan los mismos valores

**1b. Extraer `buildSafeUrl` a utilidad**
- Crear `src/app/shared/utils/image.utils.ts`
- Función pura: `buildSafeUrl(url: string | null | undefined, sanitizer: DomSanitizer): SafeUrl | string`
- Reemplazar en las 5 páginas afectadas (cambio mecánico)

**1c. Extraer helpers de formato de tablero**
- Crear `src/app/shared/utils/board-meta.utils.ts`
- Mover `formatDate()`, `shapeLabel()`, `dimensionLabel()` desde `board-builder.page.ts`

**1d. Definir `BuilderNavContext`**
- Crear `src/app/shared/utils/nav-context.ts`
- Interface con `{ creatorId: string; creatorName: string; returnTo: string }`

---

### 🟡 FASE 2 — Extracción de `ObfExportService` (riesgo medio-bajo)
*La lógica de exportación es auto-contenida y no tiene estado externo.*

**2a. Crear `src/app/services/obf-export.service.ts`**
- Mover de editor: `buildOBF()`, `buildCircularGridFallback()`, `hexToRgb()`, `validateOBF()`
- Mover de editor: `exportOBF()`, `exportOBZ()` (orquestadores que usan `BoardService`)
- El editor llama `this.obfExportSvc.exportOBZ(this.board, this.boardId, this.contextCreatorId)`
- Prerequisito: los tipos `Board`, `BoardCell` etc. deben estar bien importados en el servicio

**Resultado esperado:** editor pierde ~330 líneas TS.

---

### 🟡 FASE 3 — Extracción de `BoardLayoutService` (riesgo bajo)
*Funciones puras sobre el modelo `Board`, sin efectos secundarios.*

**3a. Crear `src/app/services/board-layout.service.ts`**
- Mover: `buildGridCells(board)`, `getCellAt(board, r, c)`, `getCircleSlotStyle(i, N)`, `circleSlotSizePx(N)`, `outerSlots(N)`, `locationSlots(board)`
- Actualizar editor + communicator para inyectar el servicio

---

### 🟡 FASE 4 — Componentes de UI de bajo riesgo
*Extraer componentes que no tienen estado complejo propio.*

**4a. `<app-board-card>` desde `board-builder.page`**
- Inputs: `[board]`, `[selectMode]`, `[isSelected]`
- Outputs: `(open)`, `(duplicate)`, `(delete)`, `(toggle)`
- El HTML de cada tarjeta (≈40 líneas) se extrae limpiamente

**4b. `<app-loading-error-state>`**
- Spinner / error / empty state genérico
- Presente en casi todas las páginas

**4c. `<app-arasaac-search-panel>`**
- Input: `query`, resultados
- Output: pictograma seleccionado
- Auto-contenido, sin dependencias del editor

---

### 🟠 FASE 5 — Componentes del editor de riesgo medio (futuro)
*Solo cuando Fases 1–4 estén consolidadas y probadas en producción.*

- `<app-board-config-panel>` — columna izquierda de configuración
- `<app-pictogram-form>` — campos comunes + Fitzgerald
- `<app-action-form>` — tipo de acción + destino

---

### 🔴 FASE 6 — No hacer todavía (alto riesgo)

Los siguientes cambios son demasiado arriesgados para hacerse sin un plan de regresión completo:

- ❌ Separar `board-builder-editor.page` en múltiples sub-pages/routes
- ❌ Extraer `<app-board-grid-editor>` (estado D&D acoplado)
- ❌ Extraer `<app-circular-board>` (geometría acoplada al export OBF)
- ❌ Refactorizar `AacRuntimeService` (sesión fragil, afecta comunicador)
- ❌ Mover tipos fuera de `board.service.ts` hasta que Fase 1 esté completa
- ❌ Tocar nada relacionado con el import OBZ (recién refactorizado)
- ❌ Cambiar el flujo de link-back (creatorId/returnTo) sin tests E2E

---

## 12. Plan de refactorización incremental por fases

```
ESTADO ACTUAL
│
├─ FASE 0 ✅ — ObzImportService extraído (completado en sprint 2025-05)
│
├─ FASE 1 🟢 — Consolidación tipos/utils (3-5 días, 0 riesgo funcional)
│   ├─ 1a: fitzgerald.ts unificado
│   ├─ 1b: image.utils.ts (buildSafeUrl)
│   ├─ 1c: board-meta.utils.ts (formatDate, etc.)
│   └─ 1d: BuilderNavContext interface
│
├─ FASE 2 🟡 — ObfExportService (2-3 días, riesgo medio-bajo)
│   └─ Extrae ~330 líneas del editor
│   → Editor pasa de 2.690 a ~2.360 líneas
│
├─ FASE 3 🟡 — BoardLayoutService (1-2 días)
│   └─ Extrae ~80 líneas del editor + elimina duplicación con communicator
│   → Editor pasa a ~2.280 líneas
│
├─ FASE 4 🟡 — Componentes simples (4-6 días)
│   ├─ board-card component
│   ├─ loading-error-state component
│   └─ arasaac-search-panel component
│   → Editor HTML pasa de 1.001 a ~900 líneas
│
├─ FASE 5 🟠 — Componentes del editor (1-2 semanas, con cuidado)
│   ├─ board-config-panel
│   ├─ pictogram-form
│   └─ action-form
│   → Editor HTML pasa a ~600 líneas
│
└─ FASE 6 🔴 — Refactorización estructural (NO planificar todavía)
    ├─ AacRuntimeService split
    ├─ Board model extraction
    └─ Editor sub-components (grid, circular)
```

---

## 13. Métricas objetivo

Si se ejecutan las Fases 1-4:

| Archivo | Ahora | Objetivo F4 |
|---|---|---|
| `board-builder-editor.page.ts` | 2.690 líneas | ~2.000 líneas |
| `board-builder-editor.page.html` | 1.001 líneas | ~800 líneas |
| Archivos con `buildSafeUrl` duplicado | 5 | 0 |
| Definiciones de `FITZGERALD` | 2 (inconsistentes) | 1 |
| Definiciones de `WordType` | 2 | 1 |

Si se ejecutan las Fases 1-5:

| Archivo | Objetivo F5 |
|---|---|
| `board-builder-editor.page.ts` | ~1.400 líneas |
| `board-builder-editor.page.html` | ~500 líneas |

---

## 14. Migraciones seguras de bajo riesgo (puedes hacer hoy)

Estas no cambian ningún comportamiento funcional. Son reemplazos mecánicos:

1. **`buildSafeUrl` → utility function** — cambio de `this.buildSafeUrl(url)` a `buildSafeUrl(url, this.sanitizer)` en 5 archivos
2. **`formatDate` / `shapeLabel` / `dimensionLabel` → board-meta.utils** — solo usadas en `board-builder.page.ts`
3. **`fitzgerald.ts` canónico** — mover la definición de `board.service.ts` a un archivo propio; `board.service.ts` re-exporta desde ahí; `pictogram-state.service.ts` hace lo mismo
4. **`UserCardData` → `user.model.ts`** — mover la interface; actualizar el único import en `organization-dashboard.page.ts`
5. **`BuilderNavContext` interface** — nueva interface, sin romper nada

---

## 15. Migraciones peligrosas que NO deben hacerse todavía

1. ❌ **Tocar `ObzImportService`** — recién refactorizado, frágil, en producción activa
2. ❌ **Separar `AacRuntimeService`** en Speech + OBL — riesgo de romper la sesión del comunicador
3. ❌ **Extraer `<app-board-grid-editor>`** — el D&D tiene eventos nativos del DOM acoplados a estado del componente padre; extracción requiere diseño cuidadoso de `@Input`/`@Output` para drag state
4. ❌ **Extraer `<app-circular-board>`** — la geometría de slots en el editor y la geometría del export OBF usan la **misma fórmula matemática**; separar primero en una utilidad/servicio antes de componentizar
5. ❌ **Mover tipos de `board.service.ts`** — muchos archivos importan desde ahí; hacer solo después de un commit limpio con Fase 1 completada
6. ❌ **Nada relacionado con el link-back flow** (editor→create→editor con query params) — depende del ciclo de vida de Ionic y es muy sensible al orden de eventos

---

*Generado como auditoría arquitectónica. No se ha modificado ningún archivo de código fuente.*
