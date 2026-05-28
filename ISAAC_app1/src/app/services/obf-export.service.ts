/**
 * ObfExportService
 *
 * Encapsula toda la lógica de exportación OBF/OBZ:
 *
 *  • buildOBF(board, idPrefix?, knownBoards?)   — Board → Open Board Format 0.1 JSON
 *  • validateOBF(obf)                            — valida el objeto OBF generado
 *  • collectLinkedBoards(root)                  — BFS de tableros enlazados
 *  • buildOBZPackage(rootBoard, allBoards)       — empaqueta varios OBF en un ZIP
 *  • makeSafeName(name)                          — nombre de archivo seguro
 *
 * El componente board-builder-editor delega aquí toda la lógica pura y solo
 * gestiona UI (toasts, alerts, spinners, descarga por ancla DOM).
 */

import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { firstValueFrom } from 'rxjs';
import { BoardService, Board, BoardCell } from './board.service';

// ─── Resultado de buildOBZPackage ─────────────────────────────────────────────

export interface OBZPackageResult {
  /** Blob ZIP listo para descargar */
  blob:       Blob;
  /** Número de tableros incluidos en el paquete */
  boardCount: number;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ObfExportService {

  constructor(private boardSvc: BoardService) {}

  // ── API pública ───────────────────────────────────────────────────────────────

  /**
   * Recopila recursivamente (BFS) todos los tableros enlazados desde `root`.
   * Excluye: ciclos (visited set), shapes incompatibles, usuarios distintos,
   * cargas fallidas. Devuelve Map ordenado en BFS + lista de advertencias.
   */
  async collectLinkedBoards(
    root: Board,
  ): Promise<{ boards: Map<string, Board>; warnings: string[] }> {
    const boards  = new Map<string, Board>();
    const visited = new Set<string>();
    const warnings: string[] = [];
    const queue: Board[] = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cid = String(current._id);
      if (visited.has(cid)) continue;
      visited.add(cid);
      boards.set(cid, current);

      for (const cell of current.cells) {
        const rawTarget = cell.action?.targetBoardId;
        if (!rawTarget) continue;
        const targetId = String(rawTarget);
        if (visited.has(targetId)) continue;

        try {
          const res = await firstValueFrom(
            this.boardSvc.getBoardById(targetId),
          );
          const linked = res.board;

          // Verificar compatibilidad de shape (grid↔circular no se mezclan)
          if (linked.shape !== current.shape) {
            warnings.push(
              `"${current.name}" enlaza a "${linked.name}" con layout incompatible ` +
                `(${current.shape} → ${linked.shape}). El enlace se excluye del paquete.`,
            );
            visited.add(String(linked._id)); // no reintentar
            continue;
          }

          // Verificar que pertenece al mismo usuario
          if (String(linked.userId) !== String(current.userId)) {
            warnings.push(
              `"${linked.name}" pertenece a otro usuario y no se incluye en el paquete.`,
            );
            visited.add(String(linked._id));
            continue;
          }

          queue.push(linked);
        } catch {
          warnings.push(
            `No se pudo cargar el tablero enlazado (ID: ${targetId}).`,
          );
          visited.add(targetId);
        }
      }
    }

    return { boards, warnings };
  }

  /**
   * Empaqueta un conjunto de tableros (ya recopilados por collectLinkedBoards)
   * como paquete OBZ (ZIP con manifest.json).
   *
   * @param rootBoard  — tablero raíz (determina la entrada en manifest.json)
   * @param allBoards  — Map BFS con todos los tableros a incluir
   */
  async buildOBZPackage(
    rootBoard: Board,
    allBoards: Map<string, Board>,
  ): Promise<OBZPackageResult> {
    // ── 1. Mapa boardId → ruta dentro del ZIP ─────────────────────────────────
    const boardPaths = new Map<string, string>();
    for (const boardId of allBoards.keys()) {
      boardPaths.set(boardId, `boards/${boardId}.obf`);
    }

    // ── 2. Generar un OBF por tablero; IDs prefijados con los 8 primeros
    //       caracteres del boardId para garantizar unicidad global en el OBZ ─
    const zip          = new JSZip();
    const pathsManifest: Record<string, string> = {};
    const allBoardsList = [...allBoards.values()];

    for (const [boardId, board] of allBoards) {
      const idPrefix = `${boardId.slice(0, 8)}-`;
      const obf = this.buildOBF(board, idPrefix, allBoardsList);

      // Añadir load_board.path a los botones cuyo destino esté en el OBZ
      for (const btn of obf['buttons'] as Record<string, unknown>[]) {
        const lb = btn['load_board'] as Record<string, unknown> | undefined;
        if (lb) {
          const targetId   = String(lb['id'] ?? '');
          const targetPath = boardPaths.get(targetId);
          if (targetPath) {
            lb['path'] = targetPath;
          }
          // Si el destino no está en el OBZ (shape incompatible, otro usuario)
          // → load_board queda sin "path"; el visor sabrá que es un enlace externo
        }
      }

      const filePath = boardPaths.get(boardId)!;
      zip.file(filePath, JSON.stringify(obf, null, 2));
      pathsManifest[boardId] = filePath;
    }

    // ── 3. manifest.json ─────────────────────────────────────────────────────
    const manifest = {
      format: 'open-board-0.1',
      root:   `boards/${rootBoard._id}.obf`,
      paths: {
        boards: pathsManifest,
        images: {},
        sounds: {},
      },
      ext_isaac_package_type: 'OBZ',
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // ── 4. Generar blob ───────────────────────────────────────────────────────
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    return { blob, boardCount: allBoards.size };
  }

  /**
   * Transforma un tablero ISAAC al objeto JSON Open Board Format 0.1.
   * Soporta tableros grid y circulares.
   *
   * @param board        — tablero a exportar
   * @param idPrefix     — prefijo para IDs de botones (evita colisiones en OBZ)
   * @param knownBoards  — tableros conocidos para enriquecer load_board con nombre
   */
  buildOBF(board: Board, idPrefix = '', knownBoards: Board[] = []): Record<string, unknown> {
    const isCircular = board.shape === 'circular';
    const buttons: Record<string, unknown>[] = [];
    const images:  Record<string, unknown>[] = [];
    const imgMap = new Map<string, string>(); // imageUrl → imageId
    const r4 = (n: number) => Math.round(n * 10000) / 10000; // 4 decimales

    /** Registra imagen; deduplica por URL. Prioridad OBF: data > url — nunca ambos */
    const addImage = (imageUrl: string, btnId: string): string | null => {
      if (!imageUrl) return null;
      if (imgMap.has(imageUrl)) return imgMap.get(imageUrl)!;
      const imgId = `img-${btnId}`;
      imgMap.set(imageUrl, imgId);
      const imgObj: Record<string, unknown> = {
        id:           imgId,
        width:        300,
        height:       300,
        content_type: imageUrl.startsWith('data:')
          ? (imageUrl.split(';')[0].split(':')[1] ?? 'image/png')
          : 'image/png',
      };
      if (imageUrl.startsWith('data:')) {
        imgObj['data'] = imageUrl;
      } else {
        imgObj['url'] = imageUrl;
      }
      images.push(imgObj);
      return imgId;
    };

    /** Construye un botón OBF desde una celda con pictograma */
    const buildBtn = (
      cell:  BoardCell,
      btnId: string,
      extra?: Record<string, unknown>,
    ): Record<string, unknown> => {
      const p           = cell.pictogram!;
      const imgId       = p.imageUrl ? addImage(p.imageUrl, btnId) : null;
      const actionType  = cell.action.type;
      const targetId    = cell.action.targetBoardId;
      const vocalization = p.sound.trim() || p.label;

      const btn: Record<string, unknown> = {
        id:               btnId,
        label:            p.label,
        vocalization,
        background_color: this.hexToRgb(p.color || '#f5f5f5'),
        border_color:     'rgba(0,0,0,0.12)',
      };
      if (imgId) btn['image_id'] = imgId;

      // FIX 1: action solo en casos especiales; voz normal NO lleva action en OBF
      if (actionType === 'disabled') {
        btn['action']               = ':ext_isaac_disabled';
        btn['ext_isaac_disabled']   = true;
      } else if (actionType === 'navigate' && targetId) {
        // FIX 6: load_board con name si disponible en knownBoards
        const linked = knownBoards.find((b) => b._id === String(targetId));
        btn['load_board'] = linked?.name
          ? { id: String(targetId), name: linked.name }
          : { id: String(targetId) };
      } else if (actionType === 'voice+navigate' && targetId) {
        const linked = knownBoards.find((b) => b._id === String(targetId));
        btn['load_board'] = linked?.name
          ? { id: String(targetId), name: linked.name }
          : { id: String(targetId) };
        btn['ext_isaac_action_type'] = 'voice_board';
        // vocalization ya cubre la voz; no se añade action adicional
      }
      // 'voice': sin action — vocalization es suficiente según OBF

      if (cell.action.aiGeneratedBoardTarget) btn['ext_isaac_ai_target'] = true;
      if (extra) Object.assign(btn, extra);
      return btn;
    };

    // ── GRID ──────────────────────────────────────────────────────────────────
    if (!isCircular) {
      const order: (string | null)[][] = [];
      for (let r = 0; r < board.rows; r++) {
        const row: (string | null)[] = [];
        for (let c = 0; c < board.columns; c++) {
          const cell =
            board.cells.find((cl) => cl.row === r && cl.col === c) ?? null;
          if (!cell?.pictogram) {
            row.push(null);
            continue;
          }
          const btnId = `${idPrefix}btn-${r}-${c}`;
          row.push(btnId);
          buttons.push(buildBtn(cell, btnId));
        }
        order.push(row);
      }
      // FIX 3: description_html omitido si vacío
      return {
        format:  'open-board-0.1',
        id:      String(board._id),
        locale:  'es',
        name:    board.name,
        buttons,
        images,
        grid:    { rows: board.rows, columns: board.columns, order },
      };
    }

    // ── CIRCULAR ──────────────────────────────────────────────────────────────
    const N          = board.circleSlots ?? 8;
    const locEnabled = board.locationColumnEnabled ?? false;
    const L          = locEnabled ? (board.locationColumnSlots ?? 6) : 0;
    const R          = 0.44; // radio normalizado, igual que el editor
    // Tamaño del slot: misma fórmula que circleSlotSizePx; canvas de referencia = 400 px
    const chordPx = 2 * 176 * Math.sin(Math.PI / N);
    const sizePx  = Math.max(34, Math.min(72, Math.floor(chordPx * 0.78)));
    const slotSz  = r4(sizePx / 400);
    const centerSz = 0.2;

    // Outer slots (row=i, col=0)
    const outerIds: string[] = []; // '' = slot sin pictograma
    for (let i = 0; i < N; i++) {
      const cell = board.cells.find((c) => c.row === i && c.col === 0);
      if (!cell?.pictogram) {
        outerIds.push('');
        continue;
      }
      const angleDeg = (i / N) * 360 - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const cx = 0.5 + R * Math.cos(angleRad);
      const cy = 0.5 + R * Math.sin(angleRad);
      const btnId = `${idPrefix}btn-outer-${i}`;
      outerIds.push(btnId);
      // FIX 5: coordenadas clampeadas [0,1] con 4 decimales
      buttons.push(
        buildBtn(cell, btnId, {
          left:              r4(Math.max(0, Math.min(1, cx - slotSz / 2))),
          top:               r4(Math.max(0, Math.min(1, cy - slotSz / 2))),
          width:             slotSz,
          height:            slotSz,
          ext_isaac_role:    'outer',
          ext_isaac_angle:   r4(angleDeg),
        }),
      );
    }

    // Center (row=0, col=-1)
    const centerCell = board.cells.find((c) => c.row === 0 && c.col === -1);
    let centerBtnId: string | null = null;
    if (centerCell?.pictogram) {
      centerBtnId = `${idPrefix}btn-center`;
      const extra: Record<string, unknown> = {
        left:           r4(0.5 - centerSz / 2),
        top:            r4(0.5 - centerSz / 2),
        width:          centerSz,
        height:         centerSz,
        ext_isaac_role: 'center',
      };
      if (centerCell.action.showLastPhrase)
        extra['ext_isaac_show_last_phrase'] = true;
      buttons.push(buildBtn(centerCell, centerBtnId, extra));
    }

    // Location slots (row=i, col=-2)
    const locSlotSz = 0.12;
    const locIds: string[] = [];
    for (let i = 0; i < L; i++) {
      const cell = board.cells.find((c) => c.row === i && c.col === -2);
      if (!cell?.pictogram) {
        locIds.push('');
        continue;
      }
      const topPos = r4(L > 1 ? (i / (L - 1)) * (1 - locSlotSz) : 0);
      const btnId  = `${idPrefix}btn-loc-${i}`;
      locIds.push(btnId);
      buttons.push(
        buildBtn(cell, btnId, {
          left:           0.01,
          top:            topPos,
          width:          locSlotSz,
          height:         locSlotSz,
          ext_isaac_role: 'location',
        }),
      );
    }

    // FIX 4: grid fallback con posicionamiento angular
    const {
      rows: gRows,
      columns: gCols,
      order,
    } = this.buildCircularGridFallback(N, outerIds, centerBtnId, locIds);

    // FIX 3: description_html omitido
    return {
      format:                       'open-board-0.1',
      id:                           String(board._id),
      locale:                       'es',
      name:                         board.name,
      ext_isaac_layout:             'circular',
      ext_isaac_circle_slots:       N,
      ext_isaac_location_column:    locEnabled,
      ext_isaac_location_slots:     L,
      buttons,
      images,
      grid: { rows: gRows, columns: gCols, order },
    };
  }

  /**
   * Valida un objeto OBF antes de descargarlo.
   * Comprueba campos obligatorios, unicidad de IDs, referencias cruzadas
   * y coordenadas absolutas válidas en tableros circulares.
   * Devuelve null si es válido, o un string con la descripción del primer error.
   */
  validateOBF(obf: Record<string, unknown>): string | null {
    if (obf['format'] !== 'open-board-0.1') return 'format incorrecto';
    if (!Array.isArray(obf['buttons']))      return 'buttons[] ausente';
    if (!Array.isArray(obf['images']))       return 'images[] ausente';
    const grid = obf['grid'] as Record<string, unknown> | undefined;
    if (!grid)                                  return 'grid ausente';
    if (typeof grid['rows'] !== 'number')       return 'grid.rows ausente';
    if (typeof grid['columns'] !== 'number')    return 'grid.columns ausente';
    if (!Array.isArray(grid['order']))          return 'grid.order ausente';

    const btns   = obf['buttons'] as Array<Record<string, unknown>>;
    const imgs   = obf['images']  as Array<Record<string, unknown>>;
    const btnMap = new Map(btns.map((b) => [b['id'], b]));
    const imgSet = new Set(imgs.map((i) => i['id']));

    // FIX 9a: IDs únicos
    if (btnMap.size !== btns.length) return 'IDs de botones duplicados';
    if (imgSet.size !== imgs.length) return 'IDs de imágenes duplicados';

    // FIX 9b: todos los IDs en grid.order deben existir en buttons[]
    for (const row of grid['order'] as (string | null)[][]) {
      for (const cellId of row) {
        if (cellId !== null && !btnMap.has(cellId))
          return `grid.order referencia ID desconocido: ${cellId}`;
      }
    }

    // FIX 9c: todos los image_id en buttons[] deben existir en images[]
    for (const btn of btns) {
      const imgId = btn['image_id'];
      if (imgId !== undefined && !imgSet.has(imgId))
        return `button "${btn['id']}" tiene image_id desconocido: ${imgId}`;
    }

    // FIX 9d: circular — coordenadas absolutas en [0, 1]
    if (obf['ext_isaac_layout'] === 'circular') {
      for (const btn of btns) {
        for (const prop of ['left', 'top', 'width', 'height']) {
          const v = btn[prop] as number | undefined;
          if (v !== undefined && (v < 0 || v > 1))
            return `button "${btn['id']}" tiene ${prop}=${v} fuera de [0, 1]`;
        }
      }
    }

    return null;
  }

  /**
   * Convierte un nombre de tablero a nombre de archivo seguro para descarga.
   * Preserva letras españolas (áéíóúüñ). Resultado nunca vacío ('tablero' como fallback).
   */
  makeSafeName(name: string): string {
    return (name || 'tablero')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-áéíóúüñ]/gi, '')
      .replace(/^-+|-+$/g, '') || 'tablero';
  }

  // ── Helpers privados ──────────────────────────────────────────────────────────

  /**
   * Construye el grid fallback para tableros circulares.
   *
   * Garantías:
   * - Grid siempre impar (mín. 3×3) → centro en la celda exactamente central.
   * - Cada slot exterior se mapea al perímetro según su ángulo (0° = 12h, CW).
   * - Colisiones resueltas eligiendo la celda de perímetro más próxima libre.
   * - Location slots van a las celdas interiores libres restantes.
   */
  private buildCircularGridFallback(
    N:          number,
    outerIds:   string[], // outerIds[i] = btnId  |  '' si slot sin pictograma
    centerBtnId: string | null,
    locIds:     string[], // locIds[i]   = btnId  |  '' si slot sin pictograma
  ): { rows: number; columns: number; order: (string | null)[][] } {
    // Tamaño impar: 4*(gSize-1) ≥ N para que haya perímetro suficiente
    let gSize = Math.max(3, Math.ceil(N / 4) + 1);
    if (gSize % 2 === 0) gSize++; // forzar impar → centro exacto

    const midRow = Math.floor(gSize / 2);
    const midCol = Math.floor(gSize / 2);

    const order: (string | null)[][] = Array.from({ length: gSize }, () =>
      Array<string | null>(gSize).fill(null),
    );

    // Centro en la celda central
    if (centerBtnId) order[midRow][midCol] = centerBtnId;

    // Perímetro completo CW desde [0,0]
    const fullPerim: [number, number][] = [];
    for (let c = 0; c < gSize; c++) fullPerim.push([0, c]);             // fila sup
    for (let r = 1; r < gSize; r++) fullPerim.push([r, gSize - 1]);     // col derecha
    for (let c = gSize - 2; c >= 0; c--) fullPerim.push([gSize - 1, c]); // fila inf
    for (let r = gSize - 2; r >= 1; r--) fullPerim.push([r, 0]);        // col izquierda
    const perimLen = fullPerim.length; // 4*(gSize-1)

    // Rotar para que el índice 0 sea [0, midCol] = 12 en punto
    const startIdx = fullPerim.findIndex(([r, c]) => r === 0 && c === midCol);
    const perim = [
      ...fullPerim.slice(startIdx),
      ...fullPerim.slice(0, startIdx),
    ];
    const usedIdx = new Set<number>();

    // Asignar cada outer slot a la posición de perímetro más cercana según ángulo
    for (let i = 0; i < N; i++) {
      const btnId = outerIds[i];
      if (!btnId) continue;

      // angleDeg: -90° = 12h; +90° = 6h
      const angleDeg = (i / N) * 360 - 90;
      const normDeg  = (angleDeg + 90 + 360) % 360; // 0° = 12h, crece CW
      const targetIdx = Math.round((normDeg / 360) * perimLen) % perimLen;

      let placed = false;
      for (let off = 0; off < perimLen; off++) {
        const idx    = (targetIdx + off) % perimLen;
        const [pr, pc] = perim[idx];
        if (!usedIdx.has(idx) && !(pr === midRow && pc === midCol)) {
          order[pr][pc] = btnId;
          usedIdx.add(idx);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // fallback extremo: primera celda libre
        outer: for (let r = 0; r < gSize; r++) {
          for (let c = 0; c < gSize; c++) {
            if (order[r][c] === null) {
              order[r][c] = btnId;
              break outer;
            }
          }
        }
      }
    }

    // Location slots en celdas internas libres
    for (const btnId of locIds) {
      if (!btnId) continue;
      outer: for (let r = 0; r < gSize; r++) {
        for (let c = 0; c < gSize; c++) {
          if (order[r][c] === null) {
            order[r][c] = btnId;
            break outer;
          }
        }
      }
    }

    return { rows: gSize, columns: gSize, order };
  }

  /** Convierte color HEX (#rrggbb | #rgb) a rgb(...) compatible con OBF. No modifica rgb/rgba. */
  private hexToRgb(color: string): string {
    if (!color) return 'rgb(245,245,245)';
    if (color.startsWith('rgb')) return color;
    const hex = color.replace('#', '');
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgb(${r},${g},${b})`;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgb(${r},${g},${b})`;
    }
    return color; // formato desconocido: devolver tal cual
  }
}
