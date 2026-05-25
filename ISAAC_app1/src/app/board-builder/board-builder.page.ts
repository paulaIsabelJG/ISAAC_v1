import { Component, OnInit } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import JSZip from 'jszip';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';
import {
  BoardService, Board, BoardCell, CellPictogram, CellAction,
  ActionType, WordType, FITZGERALD, BoardShape, CreateBoardPayload,
} from '../services/board.service';

// ─── Tipos OBF para importación OBZ ──────────────────────────────────────────

interface ObfImageOBZ {
  id:            string | number;
  data?:         string;
  path?:         string;
  url?:          string;
  content_type?: string;
  width?:        number;
  height?:       number;
}

interface ObfButtonOBZ {
  id:                          string | number;
  label?:                      string;
  vocalization?:               string;
  background_color?:           string;
  image_id?:                   string | number;
  action?:                     string;
  load_board?:                 { id?: string | number; name?: string; path?: string };
  ext_isaac_disabled?:         boolean;
  ext_isaac_role?:             string;   // 'outer' | 'center' | 'location'
  ext_isaac_angle?:            number;   // grados, solo outer
  ext_isaac_show_last_phrase?: boolean;
  left?:   number;
  top?:    number;
  width?:  number;
  height?: number;
}

interface ObfGridOBZ {
  rows:    number;
  columns: number;
  order:   (string | number | null)[][];
}

interface ObfDocumentOBZ {
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

/** Registro interno para la importación OBZ en dos pasadas */
interface ObzParsedBoard {
  obfId:       string;
  mongoId:     string;
  shape:       BoardShape;
  cells:       BoardCell[];
  linksByCell: Map<string, string>; // "row,col" → ID original OBF destino
}

@Component({
  selector: 'app-board-builder',
  templateUrl: './board-builder.page.html',
  styleUrls: ['./board-builder.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class BoardBuilderPage implements OnInit {

  /** Ruta a la que volver — la impone el caller vía ?returnTo= */
  private returnTo = '/organization-dashboard';

  /** Contexto del builder: de quién son los tableros que se muestran.
   *  Si no se pasa creatorId en query params, se usa el usuario de sesión. */
  contextCreatorId   = '';
  contextCreatorName = '';

  boards: Board[] = [];
  isLoading = false;
  loadError = '';

  // ── Búsqueda y selección ─────────────────────────────────────────────────────
  searchQuery = '';
  selectMode  = false;
  selectedIds = new Set<string>();

  private _arasaacMetaCache = new Map<string, Record<string, unknown> | null>();

  constructor(
    private route:       ActivatedRoute,
    private router:      Router,
    private authSvc:     AuthService,
    private boardSvc:    BoardService,
    private toastCtrl:   ToastController,
    private alertCtrl:   AlertController,
    private sanitizer:   DomSanitizer,
  ) {}

  ngOnInit() {
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }

    // Contexto del builder: ¿de quién son los tableros que vamos a mostrar?
    const qCreatorId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qCreatorName = this.route.snapshot.queryParamMap.get('creatorName');

    const me = this.authSvc.getCurrentUser();

    // Si viene creatorId por param, ese es el contexto; si no, yo mismo soy el contexto.
    this.contextCreatorId   = qCreatorId   || me?.id   || '';
    this.contextCreatorName = qCreatorName || me?.name || '';
  }

  ionViewWillEnter() {
    // Refrescar contexto del route snapshot (cubre el caso en que Ionic reutiliza
    // la instancia y el dashboard abre un builder con un creatorId diferente)
    const qCreatorId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qCreatorName = this.route.snapshot.queryParamMap.get('creatorName');
    const me           = this.authSvc.getCurrentUser();
    if (qCreatorId)   { this.contextCreatorId   = qCreatorId; }
    if (qCreatorName) { this.contextCreatorName = qCreatorName; }
    if (!this.contextCreatorId) {
      this.contextCreatorId   = me?.id   || '';
      this.contextCreatorName = me?.name || '';
    }
    this.loadBoards();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoards(): Promise<void> {
    if (!this.contextCreatorId) {
      this.loadError = 'No se pudo determinar el creador del builder.';
      return;
    }
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(
        this.boardSvc.getBoardsByCreator(this.contextCreatorId)
      );
      this.boards = res.boards;
    } catch {
      this.loadError = 'Error al cargar los tableros.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  goBack() { this.router.navigateByUrl(this.returnTo); }

  goToCreate() {
    this.router.navigate(['/board-builder-create'], {
      queryParams: {
        returnTo:    '/board-builder',
        creatorId:   this.contextCreatorId,
        creatorName: this.contextCreatorName,
      },
    });
  }

  openEditor(boardId: string) {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: {
        returnTo:    '/board-builder',
        creatorId:   this.contextCreatorId,
        creatorName: this.contextCreatorName,
      },
    });
  }

  // ── Búsqueda y secciones ─────────────────────────────────────────────────────

  get filteredBoards(): Board[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.boards;
    return this.boards.filter((b) => b.name.toLowerCase().includes(q));
  }

  get mainBoards(): Board[] {
    return this.filteredBoards.filter(
      (b) => !b.boardRole || b.boardRole === 'main',
    );
  }

  get secondaryBoards(): Board[] {
    return this.filteredBoards.filter((b) => b.boardRole === 'secondary');
  }

  // ── Selección múltiple ────────────────────────────────────────────────────────

  toggleSelectMode(): void {
    this.selectMode = !this.selectMode;
    if (!this.selectMode) { this.selectedIds.clear(); }
  }

  toggleSelect(boardId: string, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedIds.has(boardId)) {
      this.selectedIds.delete(boardId);
    } else {
      this.selectedIds.add(boardId);
    }
    this.selectedIds = new Set(this.selectedIds); // trigger change detection
  }

  isSelected(boardId: string): boolean {
    return this.selectedIds.has(boardId);
  }

  get selectedCount(): number { return this.selectedIds.size; }

  async deleteSelected(): Promise<void> {
    const count = this.selectedIds.size;
    if (count === 0) return;

    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tableros?',
      message: `Se eliminarán ${count} tablero${count > 1 ? 's' : ''} de forma permanente. Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            const ids = [...this.selectedIds];
            this.isLoading = true;
            try {
              const results = await Promise.allSettled(
                ids.map((id) => firstValueFrom(this.boardSvc.deleteBoard(id))),
              );
              const ok    = results.filter((r) => r.status === 'fulfilled').length;
              const fail  = results.filter((r) => r.status === 'rejected').length;
              this.boards = this.boards.filter((b) => !ids.includes(b._id));
              this.selectedIds.clear();
              this.selectMode = false;
              const msg = fail === 0
                ? `${ok} tablero${ok !== 1 ? 's' : ''} eliminado${ok !== 1 ? 's' : ''}`
                : `Se eliminaron ${ok} de ${count} tableros (${fail} con error)`;
              (await this.toastCtrl.create({
                message: msg, duration: 2500,
                color: fail === 0 ? 'success' : 'warning',
                position: 'top',
              })).present();
            } finally {
              this.isLoading = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Importación OBZ ───────────────────────────────────────────────────────────

  /** Abre selector de archivo .obz y lanza la importación */
  async importOBZ(): Promise<void> {
    const input   = document.createElement('input');
    input.type    = 'file';
    input.accept  = '.obz,.zip,application/zip,application/octet-stream';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const zip = await JSZip.loadAsync(file);
        await this.processOBZImport(zip);
      } catch (err) {
        console.error('importOBZ error:', err);
        (await this.toastCtrl.create({
          message:  'Error al leer el archivo OBZ. ¿Es un ZIP válido?',
          duration: 3000, color: 'danger', position: 'top',
        })).present();
      }
    };
    input.click();
  }

  /** Lógica principal de importación OBZ en dos pasadas */
  private async processOBZImport(zip: JSZip): Promise<void> {

    // ── 1. Leer y validar manifest.json ────────────────────────────────────
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      (await this.toastCtrl.create({
        message:  'El archivo OBZ no contiene manifest.json.',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(await manifestFile.async('string'));
    } catch {
      (await this.toastCtrl.create({
        message:  'manifest.json del OBZ no es JSON válido.',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }

    const rootPath   = manifest['root']  as string | undefined;
    const pathsObj   = manifest['paths'] as Record<string, unknown> | undefined;
    const boardPaths = pathsObj?.['boards'] as Record<string, string> | undefined;

    if (!rootPath) {
      (await this.toastCtrl.create({
        message:  'manifest.json no tiene campo "root".',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }
    if (!boardPaths || typeof boardPaths !== 'object') {
      (await this.toastCtrl.create({
        message:  'manifest.json no tiene "paths.boards" válido.',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }

    // ── Resolver root con fallback si el archivo no existe en el ZIP ─────────
    const warnings: string[] = [];
    const allBoardPaths = new Map<string, string>(Object.entries(boardPaths));

    let resolvedRootPath = rootPath;
    let rootObfId: string;

    const rootExists = !!zip.file(rootPath);
    console.log('[OBZ] manifest.root:', rootPath, '| existe en ZIP:', rootExists);

    if (!rootExists) {
      // Fallback a) primer board de paths.boards que sí exista en el ZIP
      const fallbackEntry = Object.entries(boardPaths).find(([, p]) => !!zip.file(p));
      if (fallbackEntry) {
        resolvedRootPath = fallbackEntry[1];
        rootObfId        = fallbackEntry[0];
        console.log('[OBZ] root fallback (paths.boards):', resolvedRootPath, '| obfId:', rootObfId);
        warnings.push(`El root del OBZ no existe en el paquete; se ha usado el primer tablero disponible: "${resolvedRootPath}".`);
      } else {
        // Fallback b) primer boards/*.obf encontrado dentro del ZIP
        const zipEntries  = Object.keys(zip.files);
        const firstObfPath = zipEntries.find((f) => f.startsWith('boards/') && f.endsWith('.obf') && !zip.files[f].dir);
        if (firstObfPath) {
          resolvedRootPath = firstObfPath;
          rootObfId        = firstObfPath.split('/').pop()?.replace('.obf', '') ?? firstObfPath;
          // Añadir al mapa si no estaba en paths.boards
          if (!allBoardPaths.has(rootObfId)) {
            allBoardPaths.set(rootObfId, firstObfPath);
          }
          console.log('[OBZ] root fallback (ZIP scan):', resolvedRootPath, '| obfId:', rootObfId);
          warnings.push(`El root del OBZ no existe en el paquete; se ha usado el primer tablero disponible: "${resolvedRootPath}".`);
        } else {
          (await this.toastCtrl.create({
            message:  'El OBZ no contiene ningún tablero válido.',
            duration: 3000, color: 'danger', position: 'top',
          })).present();
          return;
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

    // ── 2. Resolver contexto de creación ─────────────────────────────────
    // userId asignado = el creador de contexto (el builder que estamos editando)
    // contextCreatorId = createdBy que se enviará al backend
    const currentUser = this.authSvc.getCurrentUser();
    if (!currentUser?.id) {
      (await this.toastCtrl.create({
        message:  'No hay sesión activa. Inicia sesión e inténtalo de nuevo.',
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }
    // userId = contexto del builder (puede ser diferente al usuario de sesión)
    const userId = this.contextCreatorId || currentUser.id;

    // ── 3. PASADA 1 — parsear y crear todos los tableros sin enlaces ───────
    const entries: ObzParsedBoard[]   = [];
    const obfIdToMongoId              = new Map<string, string>();

    this.isLoading = true;
    try {
      for (const [obfId, boardPath] of allBoardPaths) {
        // Verificar que el fichero existe en el ZIP
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

        // Pre-cargar metadata ARASAAC para botones sin color explícito
        const metaMap = new Map<string, Record<string, unknown> | null>();
        const metaFetches = (obf.buttons ?? [])
          .filter((btn) => !btn.background_color && btn.image_id !== undefined && btn.image_id !== null)
          .map(async (btn) => {
            const imgUrl = imgMap.get(String(btn.image_id)) ?? '';
            if (!imgUrl) return;
            const arasaacId = this.extractArasaacIdFromUrl(imgUrl);
            if (!arasaacId) return;
            const meta = await this.getLocalArasaacMetadata(arasaacId);
            console.log('[ARASAAC meta]', btn.label?.trim() || String(btn.id), arasaacId,
              (meta as Record<string, unknown> | null)?.['keywords']);
            metaMap.set(String(btn.id), meta);
          });
        await Promise.all(metaFetches);

        const { cells, linksByCell } = shape === 'circular'
          ? this.buildCircularCells(obf, imgMap, warnings, metaMap)
          : this.buildGridCells(obf, imgMap, warnings, metaMap);

        const boardName = obf.name?.trim() || 'Tablero importado';
        console.log(`[OBZ] "${boardName}" (${shape}): ${cells.length} celda(s), `
          + `${(obf.buttons ?? []).length} button(s), `
          + `${(obf.images ?? []).length} image(s)`);
        const circleSlots  = obf.ext_isaac_circle_slots ?? 8;
        const locEnabled   = obf.ext_isaac_location_column ?? false;
        const locSlots     = obf.ext_isaac_location_slots  ?? 6;

        // Determinar boardRole: root = 'main', resto = 'secondary'
        const isRootBoard = (obfId === rootObfId);
        const boardRole: 'main' | 'secondary' = isRootBoard ? 'main' : 'secondary';

        // Crear tablero en backend
        try {
          const createPayload: CreateBoardPayload = {
            name:                  boardName,
            userId,
            shape,
            rows:                  shape === 'grid' ? obf.grid.rows    : 3,
            columns:               shape === 'grid' ? obf.grid.columns : 3,
            circleSlots:           shape === 'circular' ? circleSlots : 8,
            locationColumnEnabled: locEnabled,
            locationColumnSlots:   locSlots,
            boardRole,
            // createdBy lo fija el backend usando contextCreatorId con validación de permisos
            contextCreatorId:      this.contextCreatorId || undefined,
          };
          const created = await firstValueFrom(this.boardSvc.createBoard(createPayload));
          const mongoId = created.board._id;

          // Guardar celdas (sin targetBoardId — pendiente pasada 2)
          if (cells.length > 0) {
            await firstValueFrom(this.boardSvc.updateBoard(mongoId, { cells }));
          }

          obfIdToMongoId.set(obfId, mongoId);
          entries.push({ obfId, mongoId, shape, cells, linksByCell });

        } catch (err) {
          console.error('importOBZ createBoard error:', err);
          warnings.push(`Error al crear el tablero "${boardName}" en el servidor.`);
        }
      }

      // ── 4. PASADA 2 — resolver targetBoardId con los IDs de Mongo ────────
      for (const entry of entries) {
        if (entry.linksByCell.size === 0) continue;

        let needsUpdate = false;
        // Clonar celdas para modificar acción sin mutar el array original
        const updatedCells = entry.cells.map((cell) => ({
          ...cell,
          action: { ...cell.action },
        }));

        for (const cell of updatedCells) {
          const cellKey     = `${cell.row},${cell.col}`;
          const obfTargetId = entry.linksByCell.get(cellKey);
          if (!obfTargetId) continue;

          const mongoTargetId = obfIdToMongoId.get(obfTargetId);
          if (!mongoTargetId) {
            warnings.push(
              `Enlace no resuelto: tablero OBF "${obfTargetId}" no estaba en el paquete.`
            );
            continue;
          }

          // Verificar compatibilidad de shape
          const targetEntry = entries.find((e) => e.mongoId === mongoTargetId);
          if (targetEntry && targetEntry.shape !== entry.shape) {
            warnings.push(
              `Enlace incompatible (${entry.shape} → ${targetEntry.shape}): `
              + `"${entry.obfId}" → "${obfTargetId}". El enlace se desactiva.`
            );
            cell.action = { type: 'disabled', targetBoardId: null };
            needsUpdate  = true;
            continue;
          }

          cell.action.targetBoardId = mongoTargetId;
          needsUpdate = true;
        }

        if (needsUpdate) {
          try {
            await firstValueFrom(
              this.boardSvc.updateBoard(entry.mongoId, { cells: updatedCells })
            );
            entry.cells = updatedCells;
          } catch (err) {
            console.error('importOBZ pass2 error:', err);
            warnings.push(`Error al actualizar enlaces del tablero "${entry.obfId}".`);
          }
        }
      }

    } finally {
      this.isLoading = false;
    }

    // ── 5. Refrescar lista ────────────────────────────────────────────────
    await this.loadBoards();

    const rootMongoId = obfIdToMongoId.get(rootObfId);
    const total = entries.length;

    // Toast de resultado
    (await this.toastCtrl.create({
      message: `✓ OBZ importado correctamente · ${total} tablero(s)`
        + (warnings.length ? ` · ${warnings.length} aviso(s)` : ''),
      duration: 3000, color: 'success', position: 'top',
    })).present();

    // Alerta de avisos con opción de abrir tablero raíz
    if (warnings.length > 0) {
      const alert = await this.alertCtrl.create({
        header:  'Avisos de importación OBZ',
        message: warnings.map((w) => `• ${w}`).join('\n'),
        buttons: [
          { text: 'Cerrar', role: 'cancel' },
          ...(rootMongoId ? [{
            text:    'Abrir tablero raíz',
            handler: () => { this.openEditor(rootMongoId); },
          }] : []),
        ],
      });
      await alert.present();
    } else if (rootMongoId) {
      this.openEditor(rootMongoId);
    }
  }

  // ── Helpers privados de parseo OBZ ────────────────────────────────────────────

  /** Lee y parsea un OBF desde el ZIP. Devuelve null si falla. */
  private async parseObfFromZip(zip: JSZip, path: string): Promise<ObfDocumentOBZ | null> {
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
   * Prioridad: data > path (ZIP) > url > vacío.
   * Devuelve Map<imageId, resolvedUrl>.
   */
  private async resolveZipImages(
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
            const ab     = await zipFile.async('arraybuffer');
            const bytes  = new Uint8Array(ab);
            let binary   = '';
            const chunk  = 8192;
            for (let i = 0; i < bytes.length; i += chunk) {
              binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
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

      imgMap.set(imgId, '');   // sin imagen resoluble
    }

    // Log de depuración: primeras 3 URLs resueltas
    const sampleUrls = [...imgMap.values()].filter((v) => !!v).slice(0, 3);
    console.log(`[OBZ] Images resueltas: ${imgMap.size} total.`,
      sampleUrls.length ? 'Primeras URLs: ' + sampleUrls.map((u) => u.length > 80 ? u.slice(0, 80) + '…' : u).join(' | ') : '(ninguna)');

    return imgMap;
  }

  /**
   * Detecta si el OBF representa un tablero circular o de cuadrícula.
   * ISAAC: usa ext_isaac_layout. Genérico: botones con left/top/width/height.
   */
  private detectBoardShape(obf: ObfDocumentOBZ): BoardShape {
    if (obf.ext_isaac_layout === 'circular') return 'circular';
    const hasAbsPos = (obf.buttons ?? []).some(
      (b) => b.left !== undefined && b.top !== undefined
           && b.width !== undefined && b.height !== undefined
    );
    return hasAbsPos ? 'circular' : 'grid';
  }

  /**
   * Construye celdas desde un OBF circular.
   * ISAAC: prioriza ext_isaac_role + ext_isaac_angle.
   * Genérico: ordena por ángulo calculado desde las posiciones absolutas.
   */
  private buildCircularCells(
    obf:      ObfDocumentOBZ,
    imgMap:   Map<string, string>,
    warnings: string[],
    metaMap:  Map<string, Record<string, unknown> | null> = new Map(),
  ): { cells: BoardCell[]; linksByCell: Map<string, string> } {
    const cells: BoardCell[]        = [];
    const linksByCell               = new Map<string, string>();
    const btns                      = obf.buttons ?? [];

    const outerBtns  = btns.filter((b) => b.ext_isaac_role === 'outer');
    const centerBtns = btns.filter((b) => b.ext_isaac_role === 'center');
    const locBtns    = btns.filter((b) => b.ext_isaac_role === 'location');
    const hasRoles   = outerBtns.length > 0 || centerBtns.length > 0;

    if (hasRoles) {
      // ── ISAAC circular con roles explícitos ──────────────────────────────
      outerBtns.sort((a, b) => (a.ext_isaac_angle ?? 0) - (b.ext_isaac_angle ?? 0));
      for (let i = 0; i < outerBtns.length; i++) {
        const btn  = outerBtns[i];
        const cell = this.obfBtnToCell(btn, i, 0, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board?.id !== undefined) {
            linksByCell.set(`${i},0`, String(btn.load_board.id));
          }
        }
      }
      if (centerBtns.length > 0) {
        const btn  = centerBtns[0];
        const cell = this.obfBtnToCell(btn, 0, -1, imgMap, metaMap);
        if (cell) {
          if (btn.ext_isaac_show_last_phrase) cell.action.showLastPhrase = true;
          cells.push(cell);
          if (btn.load_board?.id !== undefined) {
            linksByCell.set('0,-1', String(btn.load_board.id));
          }
        }
      }
      locBtns.sort((a, b) => (a.top ?? 0) - (b.top ?? 0));
      for (let i = 0; i < locBtns.length; i++) {
        const btn  = locBtns[i];
        const cell = this.obfBtnToCell(btn, i, -2, imgMap, metaMap);
        if (cell) {
          cells.push(cell);
          if (btn.load_board?.id !== undefined) {
            linksByCell.set(`${i},-2`, String(btn.load_board.id));
          }
        }
      }
    } else {
      // ── Circular genérico con posiciones absolutas ────────────────────────
      const withPos = btns.filter((b) => b.left !== undefined && b.top !== undefined);
      withPos.sort((a, b) => {
        const angA = Math.atan2(
          (a.top!  + (a.height ?? 0) / 2) - 0.5,
          (a.left! + (a.width  ?? 0) / 2) - 0.5
        );
        const angB = Math.atan2(
          (b.top!  + (b.height ?? 0) / 2) - 0.5,
          (b.left! + (b.width  ?? 0) / 2) - 0.5
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
          if (btn.load_board?.id !== undefined) {
            linksByCell.set(`${i},0`, String(btn.load_board.id));
          }
        }
      }
    }

    return { cells, linksByCell };
  }

  /**
   * Construye celdas desde un OBF de cuadrícula usando grid.order.
   */
  private buildGridCells(
    obf:      ObfDocumentOBZ,
    imgMap:   Map<string, string>,
    warnings: string[],
    metaMap:  Map<string, Record<string, unknown> | null> = new Map(),
  ): { cells: BoardCell[]; linksByCell: Map<string, string> } {
    const cells: BoardCell[]  = [];
    const linksByCell         = new Map<string, string>();
    const btnMap              = new Map<string, ObfButtonOBZ>();
    for (const btn of obf.buttons ?? []) { btnMap.set(String(btn.id), btn); }

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
          if (btn.load_board?.id !== undefined) {
            linksByCell.set(`${r},${c}`, String(btn.load_board.id));
          }
        }
      }
    }
    return { cells, linksByCell };
  }

  /**
   * Convierte un botón OBF en BoardCell (targetBoardId siempre null en pasada 1).
   * Devuelve null si el botón no tiene label.
   * metaMap: pre-cargado antes de llamar al constructor de celdas.
   */
  private obfBtnToCell(
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
      // [inferWordType] se loguea dentro de inferWordTypeFromLocalArasaacMetadata
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

  // ── Helpers ARASAAC metadata local ───────────────────────────────────────────

  /**
   * Extrae el ID numérico ARASAAC de una URL de imagen.
   * Soporta:
   *   https://api.arasaac.org/api/pictograms/36914?download=false&...
   *   https://static.arasaac.org/pictograms/36914/36914_500.png
   */
  private extractArasaacIdFromUrl(url?: string | null): string | null {
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
   * Consulta la BD local ARASAAC sin llamar a la API externa.
   * Cachea por arasaacId durante la sesión para evitar peticiones duplicadas.
   */
  private async getLocalArasaacMetadata(
    arasaacId: string,
  ): Promise<Record<string, unknown> | null> {
    if (this._arasaacMetaCache.has(arasaacId)) {
      return this._arasaacMetaCache.get(arasaacId) ?? null;
    }
    console.log('[getLocalArasaacMetadata] request id:', arasaacId);
    try {
      const res = await fetch(
        `${environment.apiUrl}/arasaac/local/${arasaacId}`,
        { headers: { Authorization: `Bearer ${this.authSvc.getToken()}` } },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = res.ok ? (await res.json()) as Record<string, unknown> : null;
      this._arasaacMetaCache.set(arasaacId, data);
      console.log('[getLocalArasaacMetadata] response:', {
        id:         arasaacId,
        found:      !!data,
        arasaacId:  (data as any)?.arasaacId,
        label:      (data as any)?.label,
        keywords:   (data as any)?.keywords,
        categories: (data as any)?.categories,
        tags:       (data as any)?.tags,
      });
      return data;
    } catch {
      this._arasaacMetaCache.set(arasaacId, null);
      return null;
    }
  }

  /**
   * Infiere WordType ISAAC solo si alguna keyword coincide exactamente
   * (case-insensitive) con el label del botón.
   * Devuelve null si no hay coincidencia → el caller aplica fallback visual.
   *
   * Mapeo ARASAAC type → WordType:
   *   3 → verb | 4 → descriptor | 2 → noun | 1 → noun
   */
  private inferWordTypeFromLocalArasaacMetadata(
    meta:          Record<string, unknown>,
    fallbackLabel: string,
  ): WordType | null {
    const normalizedLabel = fallbackLabel.trim().toLowerCase();
    const rawKeywords     = (meta['keywords'] as unknown[]) ?? [];

    // Buscar keyword que coincida exactamente con el label del botón
    let matchType: number | null = null;
    for (const k of rawKeywords) {
      if (k !== null && typeof k === 'object') {
        const kw = String((k as Record<string, unknown>)['keyword'] ?? '').trim().toLowerCase();
        if (kw === normalizedLabel) {
          const t = (k as Record<string, unknown>)['type'];
          matchType = typeof t === 'number' ? t : null;
          break;
        }
      }
    }

    // Sin coincidencia exacta → no aplicar Fitzgerald
    if (matchType === null) {
      console.log('[inferWordType]', {
        fallbackLabel,
        metaLabel:    (meta as any)?.label,
        keywordTypes: (meta as any)?.keywords?.map((k: any) => k.type),
        keywords:     (meta as any)?.keywords?.map((k: any) => k.keyword),
        result:       null,
      });
      return null;
    }

    // Mapeo ARASAAC type → WordType
    let wordType: WordType;
    if      (matchType === 3) wordType = 'verb';
    else if (matchType === 4) wordType = 'descriptor';
    else if (matchType === 2) wordType = 'noun';
    else if (matchType === 1) wordType = 'noun';
    else                      wordType = 'misc';

    console.log('[inferWordType]', {
      fallbackLabel,
      metaLabel:    (meta as any)?.label,
      keywordTypes: (meta as any)?.keywords?.map((k: any) => k.type),
      keywords:     (meta as any)?.keywords?.map((k: any) => k.keyword),
      result:       wordType,
    });
    return wordType;
  }

  /**
   * Normaliza cualquier color CSS a #rrggbb para su uso en pictogram.color.
   * Soporta: #rgb · #rrggbb · rgb(r,g,b) · rgba(r,g,b,a)
   * Si no puede parsear devuelve '#f5f5f5'.
   */
  private normalizeCssColorToHex(color: string | undefined): string {
    if (!color) return '#f5f5f5';

    // ── #rgb o #rrggbb ────────────────────────────────────────────────────
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

    // ── rgb(r,g,b) o rgba(r,g,b,a) ───────────────────────────────────────
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    return '#f5f5f5';
  }

  /** Mapea acción OBF a ActionType ISAAC */
  private resolveObzActionType(btn: ObfButtonOBZ): ActionType {
    if (btn.action === ':ext_isaac_disabled' || btn.ext_isaac_disabled === true) {
      return 'disabled';
    }
    if (btn.load_board) {
      return btn.vocalization?.trim() ? 'voice+navigate' : 'navigate';
    }
    return 'voice';
  }

  async duplicateBoard(board: Board, event: Event): Promise<void> {
    event.stopPropagation();
    this.isLoading = true;
    try {
      const res = await firstValueFrom(this.boardSvc.duplicateBoard(board._id));
      // Insertar la copia justo después del tablero original en la lista local
      const idx = this.boards.findIndex((b) => b._id === board._id);
      if (idx >= 0) {
        this.boards = [
          ...this.boards.slice(0, idx + 1),
          res.board,
          ...this.boards.slice(idx + 1),
        ];
      } else {
        this.boards = [res.board, ...this.boards];
      }
      (await this.toastCtrl.create({
        message:  `✓ "${res.board.name}" creado`,
        duration: 2000,
        color:    'success',
        position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message:  'No se pudo duplicar el tablero',
        duration: 2500,
        color:    'danger',
        position: 'top',
      })).present();
    } finally {
      this.isLoading = false;
    }
  }

  async deleteBoard(board: Board, event: Event) {
    event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header:  '¿Eliminar tablero?',
      message: `Se eliminará "${board.name}" de forma permanente.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              await firstValueFrom(this.boardSvc.deleteBoard(board._id));
              this.boards = this.boards.filter((b) => b._id !== board._id);
              this.selectedIds.delete(board._id);
              (await this.toastCtrl.create({
                message: 'Tablero eliminado', duration: 1800,
                color: 'success', position: 'top',
              })).present();
            } catch {
              (await this.toastCtrl.create({
                message: 'Error al eliminar el tablero', duration: 2500,
                color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  shapeLabel(shape: string): string {
    return shape === 'circular' ? 'Circular' : 'Cuadrícula';
  }

  dimensionLabel(b: Board): string {
    if (b.shape === 'grid') return `${b.rows} × ${b.columns}`;
    return `${b.circleSlots} posiciones`;
  }

  formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    if (!url) return '';
    if (url.startsWith('data:')) return this.sanitizer.bypassSecurityTrustUrl(url);
    return url;
  }
}
