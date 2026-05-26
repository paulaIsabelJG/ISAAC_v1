/**
 * ObzImportService
 *
 * Encapsula TODA la lógica de parseo e importación OBZ/OBF:
 *
 *  • importOBZ(zip, options) — importación completa en dos pasadas
 *  • previewOBZ(zip)         — lectura ligera de nombres de tablero (para diálogos)
 *  • Utilidades públicas     — resolveZipImages, buildGridCells, buildCircularCells,
 *                              obfBtnToCell, normalizeCssColorToHex, etc.
 *
 * Tanto BoardBuilderPage (crea todos los tableros nuevos) como
 * BoardBuilderEditorPage (actualiza el tablero raíz existente) usan este
 * servicio para garantizar un comportamiento idéntico y evitar duplicación.
 *
 * La implementación de referencia es BoardBuilderPage.processOBZImport
 * (build funcional). Este servicio extrae esa lógica sin alterarla.
 */

import { Injectable } from '@angular/core';
import JSZip from 'jszip';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import {
  BoardService,
  BoardCell,
  CellPictogram,
  CellAction,
  ActionType,
  BoardShape,
  CreateBoardPayload,
} from './board.service';
import { WordType, FITZGERALD } from '../shared/constants/fitzgerald';

// ─── Tipos OBF exportados ─────────────────────────────────────────────────────
// Usados tanto por este servicio como por los componentes que los necesiten
// para tipar sus variables locales (p.ej. processOBFImport en el editor).

export interface ObfImageOBZ {
  id:            string | number;
  data?:         string;
  path?:         string;
  url?:          string;
  content_type?: string;
  width?:        number;
  height?:       number;
}

export interface ObfButtonOBZ {
  id:                          string | number;
  label?:                      string;
  vocalization?:               string;
  background_color?:           string;
  border_color?:               string;
  image_id?:                   string | number;
  action?:                     string;
  load_board?:                 { id?: string | number; name?: string; path?: string };
  ext_isaac_disabled?:         boolean;
  ext_isaac_role?:             string;
  ext_isaac_angle?:            number;
  ext_isaac_show_last_phrase?: boolean;
  left?:   number;
  top?:    number;
  width?:  number;
  height?: number;
}

export interface ObfGridOBZ {
  rows:    number;
  columns: number;
  order:   (string | number | null)[][];
}

export interface ObfDocumentOBZ {
  format?:                    string;
  id?:                        string | number;
  name?:                      string;
  buttons?:                   ObfButtonOBZ[];
  images?:                    ObfImageOBZ[];
  grid?:                      ObfGridOBZ;
  ext_isaac_layout?:          string;
  ext_isaac_circle_slots?:    number;
  ext_isaac_location_column?: boolean;
  ext_isaac_location_slots?:  number;
}

/** Referencia a un tablero destino tal como viene en btn.load_board */
export type ObzLinkRef = { id?: string; path?: string; name?: string };

// ─── Opciones de importación ──────────────────────────────────────────────────

export interface ObzImportOptions {
  /**
   * Si se proporciona, el tablero raíz del OBZ se aplica SOBRE este ID de Mongo
   * (modo editor: reemplaza el tablero actual).
   * Si se omite, se crea un tablero nuevo para el raíz (modo builder).
   */
  existingRootBoardId?: string;

  /** userId para los tableros creados nuevos */
  userId: string;

  /** contextCreatorId pasado a createBoard (permite que el backend asigne createdBy) */
  contextCreatorId?: string;

  /** assignedUserIds para tableros creados nuevos (heredado por el editor) */
  assignedUserIds?: string[];
}

// ─── Resultado de importación ─────────────────────────────────────────────────

export interface ObzImportEntry {
  obfId:   string;
  mongoId: string;
  isRoot:  boolean;
  name:    string;
}

export interface ObzImportResult {
  entries:     ObzImportEntry[];
  rootMongoId: string | null;
  warnings:    string[];
}

export interface ObzPreviewResult {
  rootName:    string;
  boardNames:  string[];  // todos los tableros (raíz primero si se puede determinar)
  totalBoards: number;
  warnings:    string[];
}

// ─── Estado interno de la importación en dos pasadas ─────────────────────────

interface ObzParsedBoard {
  obfId:       string;
  boardPath:   string;
  mongoId:     string;
  isRoot:      boolean;
  name:        string;
  shape:       BoardShape;
  cells:       BoardCell[];
  linksByCell: Map<string, ObzLinkRef>;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ObzImportService {

  /** Caché de metadata ARASAAC para la sesión activa */
  private _metaCache = new Map<string, Record<string, unknown> | null>();

  constructor(
    private boardSvc: BoardService,
    private authSvc:  AuthService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // API pública principal
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Lectura ligera del OBZ para mostrar un diálogo de confirmación.
   * No realiza ninguna operación en la base de datos.
   */
  async previewOBZ(zip: JSZip): Promise<ObzPreviewResult> {
    const warnings:   string[] = [];
    const boardNames: string[] = [];

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      return { rootName: '', boardNames: [], totalBoards: 0, warnings: ['No se encontró manifest.json.'] };
    }

    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(await manifestFile.async('string')); }
    catch {
      return { rootName: '', boardNames: [], totalBoards: 0, warnings: ['manifest.json no es JSON válido.'] };
    }

    const rootPath  = manifest['root']  as string | undefined;
    const pathsObj  = manifest['paths'] as Record<string, unknown> | undefined;
    const boardPaths = pathsObj?.['boards'] as Record<string, string> | undefined;

    if (!rootPath || !boardPaths) {
      return { rootName: '', boardNames: [], totalBoards: 0, warnings: ['manifest.json incompleto (falta root o paths.boards).'] };
    }

    const normRoot = this.normalizeObzPath(rootPath);
    let rootName   = '';

    for (const [, boardPath] of Object.entries(boardPaths)) {
      const obf = await this.parseObfFromZip(zip, boardPath);
      if (!obf) continue;
      const name = obf.name?.trim() || 'Tablero importado';
      const normPath = this.normalizeObzPath(boardPath);
      // Poner el raíz primero en la lista
      if (normPath === normRoot || boardPath === rootPath) {
        rootName = name;
        boardNames.unshift(name);
      } else {
        boardNames.push(name);
      }
    }

    return { rootName, boardNames, totalBoards: boardNames.length, warnings };
  }

  /**
   * Importación OBZ completa en dos pasadas.
   *
   * PASADA 1 — parsea cada OBF del paquete, crea/actualiza tableros en el backend
   *             (sin targetBoardId aún), registra tres claves en pathToMongoId.
   *
   * PASADA 2 — resuelve cada linksByCell con la cascada
   *             rawPath → fileName → withoutExt → obfId,
   *             aplica targetBoardId y actualiza los tableros que lo necesiten.
   *
   * Si options.existingRootBoardId está definido (modo editor), el tablero raíz
   * se actualiza sobre ese ID. Si no (modo builder), se crea un tablero nuevo.
   */
  async importOBZ(zip: JSZip, options: ObzImportOptions): Promise<ObzImportResult> {
    const warnings: string[] = [];

    // ── Parsear manifest ───────────────────────────────────────────────────────
    const { allBoardPaths, rootObfId, resolvedRootPath, manifestWarnings } =
      await this._parseManifest(zip);
    warnings.push(...manifestWarnings);

    if (!resolvedRootPath) {
      return { entries: [], rootMongoId: null, warnings };
    }

    // ── PASADA 1: parsear y crear/actualizar todos los tableros ───────────────
    const parsedEntries:  ObzParsedBoard[] = [];
    const obfIdToMongoId = new Map<string, string>();
    const pathToMongoId  = new Map<string, string>();

    for (const [obfId, boardPath] of allBoardPaths) {
      if (!zip.file(boardPath)) {
        warnings.push(`"${boardPath}" listado en manifest pero no encontrado en el ZIP.`);
        continue;
      }

      const obf = await this.parseObfFromZip(zip, boardPath);
      if (!obf) {
        warnings.push(`No se pudo leer o parsear "${boardPath}".`);
        continue;
      }
      if (!Array.isArray(obf.buttons) || !obf.grid) {
        warnings.push(`"${boardPath}" no tiene estructura OBF válida (buttons/grid).`);
        continue;
      }

      const shape  = this.detectBoardShape(obf);
      const imgMap = await this.resolveZipImages(obf, zip, warnings);

      // Pre-cargar metadata ARASAAC para inferir colores Fitzgerald
      const metaMap = new Map<string, Record<string, unknown> | null>();
      await Promise.all(
        (obf.buttons ?? [])
          .filter(btn => !btn.background_color && btn.image_id != null)
          .map(async btn => {
            const imgUrl    = imgMap.get(String(btn.image_id)) ?? '';
            const arasaacId = this.extractArasaacIdFromUrl(imgUrl);
            if (!arasaacId) return;
            const meta = await this.getLocalArasaacMetadata(arasaacId);
            console.log('[ARASAAC meta]', btn.label?.trim() || String(btn.id), arasaacId,
              (meta as Record<string, unknown> | null)?.['keywords']);
            metaMap.set(String(btn.id), meta);
          }),
      );

      const { cells, linksByCell } = shape === 'circular'
        ? this.buildCircularCells(obf, imgMap, warnings, metaMap)
        : this.buildGridCells(obf, imgMap, warnings, metaMap);

      const boardName   = obf.name?.trim() || 'Tablero importado';
      const isRoot      = (obfId === rootObfId);
      const boardRole: 'main' | 'secondary' = isRoot ? 'main' : 'secondary';
      const circleSlots = obf.ext_isaac_circle_slots    ?? 8;
      const locEnabled  = obf.ext_isaac_location_column ?? false;
      const locSlots    = obf.ext_isaac_location_slots  ?? 6;

      console.log(`[OBZ] "${boardName}" (${shape}): ${cells.length} celda(s), `
        + `${(obf.buttons ?? []).length} button(s), `
        + `${(obf.images ?? []).length} image(s)`);

      let mongoId: string;

      try {
        if (isRoot && options.existingRootBoardId) {
          // ── Modo editor: actualizar el tablero abierto ──────────────────────
          const res = await firstValueFrom(
            this.boardSvc.updateBoard(options.existingRootBoardId, {
              name:    boardName,
              rows:    shape === 'grid' ? obf.grid.rows    : 3,
              columns: shape === 'grid' ? obf.grid.columns : 3,
              cells:   [],
            }),
          );
          mongoId = res.board._id;
          console.log('[OBZ root update]', { boardPath, mongoId, name: res.board.name });
        } else {
          // ── Modo builder o tablero secundario: crear nuevo ──────────────────
          const payload: CreateBoardPayload = {
            name:                  boardName,
            userId:                options.userId,
            shape,
            rows:                  shape === 'grid' ? obf.grid.rows    : 3,
            columns:               shape === 'grid' ? obf.grid.columns : 3,
            circleSlots:           shape === 'circular' ? circleSlots : 8,
            locationColumnEnabled: locEnabled,
            locationColumnSlots:   locSlots,
            boardRole,
            contextCreatorId:      options.contextCreatorId || undefined,
          };
          if (options.assignedUserIds?.length) {
            payload.assignedUserIds = options.assignedUserIds;
          }
          const res = await firstValueFrom(this.boardSvc.createBoard(payload));
          mongoId = res.board._id;
          console.log('[OBZ created]', { boardPath, mongoId, name: res.board.name, isRoot });
        }

        // Guardar celdas (sin targetBoardId — pendiente PASADA 2)
        if (cells.length > 0) {
          await firstValueFrom(this.boardSvc.updateBoard(mongoId, { cells }));
        }

        // Registrar tres claves para compatibilidad con Asterics/ARASAAC
        // (solo guardan load_board.path, no load_board.id)
        obfIdToMongoId.set(obfId, mongoId);
        const normBoardPath  = boardPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
        const boardFileName  = normBoardPath.split('/').pop() || normBoardPath;
        const boardNameNoExt = boardFileName.replace(/\.obf$/i, '');
        pathToMongoId.set(normBoardPath,  mongoId);
        pathToMongoId.set(boardFileName,  mongoId);
        pathToMongoId.set(boardNameNoExt, mongoId);

        parsedEntries.push({ obfId, boardPath, mongoId, isRoot, name: boardName, shape, cells, linksByCell });

      } catch (err) {
        console.error('[OBZ] createBoard error:', err);
        warnings.push(`Error al crear "${boardName}" en el servidor.`);
      }
    }

    // ── PASADA 2: resolver targetBoardId ─────────────────────────────────────
    for (const entry of parsedEntries) {
      if (entry.linksByCell.size === 0) continue;

      let needsUpdate = false;
      const updatedCells = entry.cells.map(c => ({ ...c, action: { ...c.action } }));

      for (const cell of updatedCells) {
        const ref = entry.linksByCell.get(`${cell.row},${cell.col}`);
        if (!ref) continue;

        // Cascada de resolución: ruta completa → filename → sin extensión → id
        const rawPath    = ref.path
          ? ref.path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '')
          : '';
        const fileName   = rawPath.split('/').pop() || '';
        const withoutExt = fileName.replace(/\.obf$/i, '');

        const mongoTargetId =
          (rawPath    ? pathToMongoId.get(rawPath)    : undefined)
          ?? (fileName   ? pathToMongoId.get(fileName)   : undefined)
          ?? (withoutExt ? pathToMongoId.get(withoutExt) : undefined)
          ?? (ref.id     ? obfIdToMongoId.get(ref.id)    : undefined);

        if (!mongoTargetId) {
          warnings.push(
            `Enlace no resuelto: id="${ref.id ?? ''}" path="${ref.path ?? ''}" name="${ref.name ?? ''}".`,
          );
          continue;
        }

        // Verificar compatibilidad de shape
        const targetEntry = parsedEntries.find(e => e.mongoId === mongoTargetId);
        if (targetEntry && targetEntry.shape !== entry.shape) {
          warnings.push(
            `Enlace incompatible (${entry.shape} → ${targetEntry.shape}): `
            + `"${entry.obfId}" → "${ref.id ?? ref.path}". El enlace se desactiva.`,
          );
          cell.action = { type: 'disabled', targetBoardId: null };
          needsUpdate = true;
          continue;
        }

        cell.action.targetBoardId = mongoTargetId;
        needsUpdate = true;
      }

      if (needsUpdate) {
        try {
          await firstValueFrom(this.boardSvc.updateBoard(entry.mongoId, { cells: updatedCells }));
          entry.cells = updatedCells;
        } catch (err) {
          console.error('[OBZ] pass2 error:', err);
          warnings.push(`Error al actualizar enlaces del tablero "${entry.obfId}".`);
        }
      }
    }

    const entries: ObzImportEntry[] = parsedEntries.map(e => ({
      obfId:   e.obfId,
      mongoId: e.mongoId,
      isRoot:  e.isRoot,
      name:    e.name,
    }));

    return {
      entries,
      rootMongoId: parsedEntries.find(e => e.isRoot)?.mongoId ?? null,
      warnings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilidades públicas de parseo
  // (usadas también por los componentes para la importación OBF individual)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Lee y parsea un OBF del ZIP. Devuelve null si el archivo no existe o falla el JSON. */
  async parseObfFromZip(zip: JSZip, path: string): Promise<ObfDocumentOBZ | null> {
    const file = zip.file(path);
    if (!file) return null;
    try {
      return JSON.parse(await file.async('string')) as ObfDocumentOBZ;
    } catch {
      return null;
    }
  }

  /**
   * Resuelve todas las imágenes de un OBF.
   * Prioridad: data (base64 embebido) > path (extrae del ZIP) > url (HTTP)
   * Devuelve Map<imageId, resolvedUrl>.
   */
  async resolveZipImages(
    obf:      ObfDocumentOBZ,
    zip:      JSZip,
    warnings: string[],
  ): Promise<Map<string, string>> {
    const imgMap = new Map<string, string>();

    for (const img of obf.images ?? []) {
      const imgId = String(img.id);

      if (img.data) { imgMap.set(imgId, img.data); continue; }

      if (img.path) {
        const zipFile = zip.file(img.path);
        if (zipFile) {
          try {
            const ab    = await zipFile.async('arraybuffer');
            const bytes = new Uint8Array(ab);
            let binary  = '';
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(
                ...(bytes.subarray(i, i + chunk) as unknown as number[]),
              );
            }
            const base64 = btoa(binary);
            const mime   = img.content_type || 'image/png';
            imgMap.set(imgId, `data:${mime};base64,${base64}`);
            continue;
          } catch {
            warnings.push(`No se pudo leer la imagen "${img.path}" del ZIP.`);
          }
        } else {
          warnings.push(`Imagen "${img.path}" no encontrada en el ZIP.`);
        }
      }

      if (img.url) { imgMap.set(imgId, img.url); continue; }

      imgMap.set(imgId, '');  // sin imagen resoluble
    }

    const sampleUrls = [...imgMap.values()].filter(v => !!v).slice(0, 3);
    console.log(`[OBZ] Images resueltas: ${imgMap.size}.`,
      sampleUrls.length
        ? 'Primeras URLs: ' + sampleUrls.map(u => u.length > 80 ? u.slice(0, 80) + '…' : u).join(' | ')
        : '(ninguna)');

    return imgMap;
  }

  /**
   * Detecta si el OBF representa un tablero circular o de cuadrícula.
   * Usa ext_isaac_layout si está presente; si no, comprueba posiciones absolutas.
   */
  detectBoardShape(obf: ObfDocumentOBZ): BoardShape {
    if (obf.ext_isaac_layout === 'circular') return 'circular';
    const hasAbsPos = (obf.buttons ?? []).some(
      b => b.left !== undefined && b.top !== undefined
        && b.width !== undefined && b.height !== undefined,
    );
    return hasAbsPos ? 'circular' : 'grid';
  }

  /**
   * Construye celdas para un OBF de cuadrícula usando grid.order.
   * Devuelve celdas con action.targetBoardId = null (se resuelve en PASADA 2).
   */
  buildGridCells(
    obf:      ObfDocumentOBZ,
    imgMap:   Map<string, string>,
    warnings: string[],
    metaMap:  Map<string, Record<string, unknown> | null> = new Map(),
  ): { cells: BoardCell[]; linksByCell: Map<string, ObzLinkRef> } {
    const cells: BoardCell[]  = [];
    const linksByCell         = new Map<string, ObzLinkRef>();
    const btnMap              = new Map<string, ObfButtonOBZ>();
    for (const btn of obf.buttons ?? []) { btnMap.set(String(btn.id), btn); }

    const setLink = (key: string, lb: { id?: string | number; path?: string; name?: string }) => {
      linksByCell.set(key, {
        id:   lb.id   != null ? String(lb.id) : undefined,
        path: lb.path ?? undefined,
        name: lb.name ?? undefined,
      });
    };

    const grid = obf.grid!;
    for (let r = 0; r < grid.rows; r++) {
      const orderRow = grid.order[r];
      if (!orderRow) continue;
      for (let c = 0; c < grid.columns; c++) {
        const rawId = orderRow[c];
        if (rawId === null || rawId === undefined) continue;
        const btnId = String(rawId);
        const btn   = btnMap.get(btnId);
        if (!btn) {
          warnings.push(`grid.order[${r}][${c}] referencia button "${btnId}" desconocido → celda vacía.`);
          continue;
        }
        const cell = this.obfBtnToCell(btn, r, c, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board) { setLink(`${r},${c}`, btn.load_board); }
        }
      }
    }

    return { cells, linksByCell };
  }

  /**
   * Construye celdas para un OBF circular.
   * Prioriza ext_isaac_role + ext_isaac_angle (ISAAC nativo);
   * para OBF genérico ordena por ángulo calculado desde posiciones absolutas.
   */
  buildCircularCells(
    obf:      ObfDocumentOBZ,
    imgMap:   Map<string, string>,
    warnings: string[],
    metaMap:  Map<string, Record<string, unknown> | null> = new Map(),
  ): { cells: BoardCell[]; linksByCell: Map<string, ObzLinkRef> } {
    const cells: BoardCell[]  = [];
    const linksByCell         = new Map<string, ObzLinkRef>();
    const btns                = obf.buttons ?? [];

    const setLink = (key: string, lb: { id?: string | number; path?: string; name?: string }) => {
      linksByCell.set(key, {
        id:   lb.id   != null ? String(lb.id) : undefined,
        path: lb.path ?? undefined,
        name: lb.name ?? undefined,
      });
    };

    const outerBtns  = btns.filter(b => b.ext_isaac_role === 'outer');
    const centerBtns = btns.filter(b => b.ext_isaac_role === 'center');
    const locBtns    = btns.filter(b => b.ext_isaac_role === 'location');
    const hasRoles   = outerBtns.length > 0 || centerBtns.length > 0;

    if (hasRoles) {
      // ── ISAAC circular con roles explícitos ──────────────────────────────────
      outerBtns.sort((a, b) => (a.ext_isaac_angle ?? 0) - (b.ext_isaac_angle ?? 0));
      for (let i = 0; i < outerBtns.length; i++) {
        const btn  = outerBtns[i];
        const cell = this.obfBtnToCell(btn, i, 0, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board) { setLink(`${i},0`, btn.load_board); }
        }
      }
      if (centerBtns.length > 0) {
        const btn  = centerBtns[0];
        const cell = this.obfBtnToCell(btn, 0, -1, imgMap, metaMap);
        if (cell) {
          if (btn.ext_isaac_show_last_phrase) cell.action.showLastPhrase = true;
          cells.push(cell);
          if (btn.load_board) { setLink('0,-1', btn.load_board); }
        }
      }
      locBtns.sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
      for (let i = 0; i < locBtns.length; i++) {
        const btn  = locBtns[i];
        const cell = this.obfBtnToCell(btn, i, -2, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board) { setLink(`${i},-2`, btn.load_board); }
        }
      }
    } else {
      // ── Circular genérico: ordenar por ángulo calculado ─────────────────────
      const withPos = btns.filter(b => b.left !== undefined && b.top !== undefined);
      withPos.sort((a, b) => {
        const angA = Math.atan2(
          (a.top!  + (a.height ?? 0) / 2) - 0.5,
          (a.left! + (a.width  ?? 0) / 2) - 0.5,
        );
        const angB = Math.atan2(
          (b.top!  + (b.height ?? 0) / 2) - 0.5,
          (b.left! + (b.width  ?? 0) / 2) - 0.5,
        );
        return angA - angB;
      });
      if (withPos.length === 0 && btns.length > 0) {
        warnings.push('Tablero circular sin posiciones absolutas ni roles ISAAC — se importa como cuadrícula.');
      }
      for (let i = 0; i < withPos.length; i++) {
        const btn  = withPos[i];
        const cell = this.obfBtnToCell(btn, i, 0, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board) { setLink(`${i},0`, btn.load_board); }
        }
      }
    }

    return { cells, linksByCell };
  }

  /**
   * Convierte un botón OBF en BoardCell.
   * action.targetBoardId siempre null en PASADA 1 (se resuelve después).
   * Devuelve null si el botón no tiene label.
   */
  obfBtnToCell(
    btn:     ObfButtonOBZ,
    row:     number,
    col:     number,
    imgMap:  Map<string, string>,
    metaMap: Map<string, Record<string, unknown> | null> = new Map(),
  ): BoardCell | null {
    const label = btn.label?.trim();
    if (!label) return null;

    const imageUrl  = btn.image_id !== undefined
      ? (imgMap.get(String(btn.image_id)) ?? '')
      : '';
    const arasaacId = this.extractArasaacIdFromUrl(imageUrl);
    const sound     = btn.vocalization?.trim() || label;

    let color: string;
    let wordType: WordType;
    let fitzgeraldEnabled: boolean;

    if (btn.background_color) {
      color             = this.normalizeCssColorToHex(btn.background_color);
      wordType          = 'misc';
      fitzgeraldEnabled = false;
      console.log('[OBF color]', label, btn.background_color, '→', color);
    } else {
      const meta     = metaMap.get(String(btn.id)) ?? null;
      const inferred = meta
        ? this.inferWordTypeFromLocalArasaacMetadata(meta, label)
        : null;
      if (inferred !== null) {
        wordType          = inferred;
        color             = FITZGERALD[wordType];
        fitzgeraldEnabled = true;
      } else {
        wordType          = 'misc';
        color             = '#ffffff';
        fitzgeraldEnabled = false;
      }
    }

    console.log('[import color final]', {
      label,
      imageUrl,
      arasaacId,
      hasBackgroundColor: !!btn.background_color,
      backgroundColor:    btn.background_color,
      wordType,
      fitzgeraldEnabled,
      color,
    });

    const pictogram: CellPictogram = {
      source:            'custom',
      id:                String(btn.id),
      label,
      imageUrl,
      sound,
      tags:              [],
      description:       '',
      wordType,
      fitzgeraldEnabled,
      color,
    };
    const action: CellAction = {
      type:          this.resolveObzActionType(btn),
      targetBoardId: null,
    };
    return { row, col, pictogram, action };
  }

  /** Mapea acción OBF a ActionType ISAAC */
  resolveObzActionType(btn: ObfButtonOBZ): ActionType {
    if (btn.action === ':ext_isaac_disabled' || btn.ext_isaac_disabled === true) {
      return 'disabled';
    }
    if (btn.load_board) {
      return btn.vocalization?.trim() ? 'voice+navigate' : 'navigate';
    }
    return 'voice';
  }

  /**
   * Normaliza rutas OBZ para comparación consistente:
   * convierte \ → /, elimina barras iniciales y ./
   */
  normalizeObzPath(path: string): string {
    return String(path)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^\.\/+/, '')
      .trim();
  }

  /**
   * Extrae el ID numérico ARASAAC de una URL de imagen.
   * Soporta rutas de api.arasaac.org y static.arasaac.org.
   */
  extractArasaacIdFromUrl(url?: string | null): string | null {
    if (!url) return null;
    const clean = String(url);

    const apiMatch = clean.match(/\/api\/pictograms\/(\d+)/);
    if (apiMatch?.[1]) {
      console.log('[extractArasaacIdFromUrl]', clean, '→', apiMatch[1]);
      return apiMatch[1];
    }
    const staticMatch = clean.match(/\/pictograms\/(\d+)(?:\/|$)/);
    if (staticMatch?.[1]) {
      console.log('[extractArasaacIdFromUrl]', clean, '→', staticMatch[1]);
      return staticMatch[1];
    }
    const genericMatch = clean.match(/pictograms\/(\d+)/);
    if (genericMatch?.[1]) {
      console.log('[extractArasaacIdFromUrl]', clean, '→', genericMatch[1]);
      return genericMatch[1];
    }
    console.log('[extractArasaacIdFromUrl]', clean, '→', null);
    return null;
  }

  /**
   * Consulta la BD local ARASAAC (sin llamar a API externa).
   * Cachea por arasaacId durante la vida del servicio para evitar peticiones duplicadas.
   */
  async getLocalArasaacMetadata(
    arasaacId: string,
  ): Promise<Record<string, unknown> | null> {
    if (this._metaCache.has(arasaacId)) {
      return this._metaCache.get(arasaacId) ?? null;
    }
    console.log('[getLocalArasaacMetadata] request id:', arasaacId);
    try {
      const res = await fetch(
        `${environment.apiUrl}/arasaac/local/${arasaacId}`,
        { headers: { Authorization: `Bearer ${this.authSvc.getToken()}` } },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.ok ? (await res.json()) as Record<string, unknown> : null;
      this._metaCache.set(arasaacId, data);
      console.log('[getLocalArasaacMetadata] response:', {
        id:         arasaacId,
        found:      !!data,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arasaacId:  (data as any)?.arasaacId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        label:      (data as any)?.label,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keywords:   (data as any)?.keywords,
      });
      return data;
    } catch {
      this._metaCache.set(arasaacId, null);
      return null;
    }
  }

  /**
   * Infiere WordType ISAAC solo si alguna keyword coincide exactamente con el label.
   * Mapeo ARASAAC type: 3→verb · 4→descriptor · 2→noun · 1→noun
   * Devuelve null si no hay coincidencia (el llamador aplica fallback).
   */
  inferWordTypeFromLocalArasaacMetadata(
    meta:          Record<string, unknown>,
    fallbackLabel: string,
  ): WordType | null {
    const normalizedLabel = fallbackLabel.trim().toLowerCase();
    const rawKeywords     = (meta['keywords'] as unknown[]) ?? [];

    let matchType: number | null = null;
    for (const k of rawKeywords) {
      if (k !== null && typeof k === 'object') {
        const kw = String((k as Record<string, unknown>)['keyword'] ?? '').trim().toLowerCase();
        if (kw === normalizedLabel) {
          const t   = (k as Record<string, unknown>)['type'];
          matchType = typeof t === 'number' ? t : null;
          break;
        }
      }
    }

    if (matchType === null) {
      console.log('[inferWordType]', {
        fallbackLabel,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metaLabel:    (meta as any)?.label,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        keywords:     (meta as any)?.keywords?.map((k: any) => k.keyword),
        result:       null,
      });
      return null;
    }

    let wordType: WordType;
    if      (matchType === 3) wordType = 'verb';
    else if (matchType === 4) wordType = 'descriptor';
    else if (matchType === 2) wordType = 'noun';
    else if (matchType === 1) wordType = 'noun';
    else                      wordType = 'misc';

    console.log('[inferWordType]', {
      fallbackLabel,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metaLabel: (meta as any)?.label,
      result:    wordType,
    });
    return wordType;
  }

  /**
   * Normaliza cualquier color CSS a #rrggbb.
   * Soporta: #rgb · #rrggbb · rgb(r,g,b) · rgba(r,g,b,a)
   * Devuelve '#f5f5f5' si no puede parsear.
   */
  normalizeCssColorToHex(color: string | undefined): string {
    if (!color) return '#f5f5f5';

    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      }
      if (hex.length === 6) return color.toLowerCase();
      return '#f5f5f5';
    }

    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    return '#f5f5f5';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Privado: parseo del manifest
  // ─────────────────────────────────────────────────────────────────────────────

  private async _parseManifest(zip: JSZip): Promise<{
    allBoardPaths:    Map<string, string>;
    rootObfId:        string;
    resolvedRootPath: string | null;
    manifestWarnings: string[];
  }> {
    const manifestWarnings = new Array<string>();
    const allBoardPaths    = new Map<string, string>();

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      manifestWarnings.push('El archivo OBZ no contiene manifest.json.');
      return { allBoardPaths, rootObfId: '', resolvedRootPath: null, manifestWarnings };
    }

    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(await manifestFile.async('string')); }
    catch {
      manifestWarnings.push('manifest.json del OBZ no es JSON válido.');
      return { allBoardPaths, rootObfId: '', resolvedRootPath: null, manifestWarnings };
    }

    const rootPath   = manifest['root']  as string | undefined;
    const pathsObj   = manifest['paths'] as Record<string, unknown> | undefined;
    const boardPaths = pathsObj?.['boards'] as Record<string, string> | undefined;

    if (!rootPath) {
      manifestWarnings.push('manifest.json no tiene campo "root".');
      return { allBoardPaths, rootObfId: '', resolvedRootPath: null, manifestWarnings };
    }
    if (!boardPaths || typeof boardPaths !== 'object') {
      manifestWarnings.push('manifest.json no tiene "paths.boards" válido.');
      return { allBoardPaths, rootObfId: '', resolvedRootPath: null, manifestWarnings };
    }

    for (const [id, path] of Object.entries(boardPaths)) {
      allBoardPaths.set(id, path);
    }

    // ── Resolver root con fallbacks ──────────────────────────────────────────
    let resolvedRootPath = rootPath;
    let rootObfId = '';

    const rootExists = !!zip.file(rootPath);
    console.log('[OBZ] manifest.root:', rootPath, '| existe en ZIP:', rootExists);

    if (!rootExists) {
      const fallbackEntry = Object.entries(boardPaths).find(([, p]) => !!zip.file(p));
      if (fallbackEntry) {
        resolvedRootPath = fallbackEntry[1];
        rootObfId        = fallbackEntry[0];
        manifestWarnings.push(`El root del OBZ no existe; se usa "${resolvedRootPath}".`);
        console.log('[OBZ] root fallback (paths.boards):', resolvedRootPath);
      } else {
        const zipEntries   = Object.keys(zip.files);
        const firstObfPath = zipEntries.find(
          f => f.startsWith('boards/') && f.endsWith('.obf') && !zip.files[f].dir,
        );
        if (firstObfPath) {
          resolvedRootPath = firstObfPath;
          rootObfId        = firstObfPath.split('/').pop()?.replace('.obf', '') ?? firstObfPath;
          if (!allBoardPaths.has(rootObfId)) {
            allBoardPaths.set(rootObfId, firstObfPath);
          }
          manifestWarnings.push(`El root del OBZ no existe; se usa "${resolvedRootPath}".`);
          console.log('[OBZ] root fallback (ZIP scan):', resolvedRootPath);
        } else {
          manifestWarnings.push('El OBZ no contiene ningún tablero válido.');
          return { allBoardPaths, rootObfId: '', resolvedRootPath: null, manifestWarnings };
        }
      }
    } else {
      const rootEntry = Object.entries(boardPaths).find(([, p]) => p === rootPath);
      rootObfId = rootEntry?.[0]
        ?? rootPath.split('/').pop()?.replace('.obf', '')
        ?? '';
      console.log('[OBZ] root OK:', rootPath, '| obfId:', rootObfId);
    }

    console.log('[OBZ] Tableros a importar:', allBoardPaths.size, [...allBoardPaths.entries()]);

    return { allBoardPaths, rootObfId, resolvedRootPath, manifestWarnings };
  }
}
