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
  UserService,
  BackendUser,
  BackendPictogram,
  AddPictogramPayload,
} from '../services/user.service';
import {
  BoardService,
  Board,
  BoardCell,
  CellPictogram,
  CellAction,
  WordType,
  ActionType,
  FITZGERALD,
  WORD_TYPE_LABELS,
} from '../services/board.service';

// ─── Resultado de búsqueda ARASAAC ───────────────────────────────────────────
interface ArasaacResult {
  id: string | number;
  label: string;
  imageUrl: string;
  keywords: string[];
}

// ─── Forma de la columna derecha ──────────────────────────────────────────────
interface PictForm {
  source: 'arasaac' | 'custom' | 'new';
  id: string;
  label: string;
  sound: string;
  imageUrl: string;
  tags: string; // coma-separado en UI, array al guardar
  description: string;
  wordType: WordType;
  fitzgeraldEnabled: boolean;
  color: string;
}

interface ActionForm {
  type: ActionType;
  targetBoardId: string;
}

// ─── Tipos OBF para importación ───────────────────────────────────────────────

interface ObfImage {
  id: string | number;
  data?: string; // base64 data URI  — prioridad 1
  path?: string; // path en ZIP      — no disponible en OBF individual
  url?: string; // URL HTTP         — prioridad 3
  content_type?: string;
  width?: number;
  height?: number;
}

interface ObfButton {
  id: string | number;
  label?: string;
  vocalization?: string;
  background_color?: string;
  border_color?: string;
  image_id?: string | number;
  action?: string;
  load_board?: { id?: string | number; name?: string; path?: string };
  ext_isaac_disabled?: boolean;
  ext_isaac_role?: string;
}

interface ObfGrid {
  rows: number;
  columns: number;
  order: (string | number | null)[][];
}

interface ObfDocument {
  format?: string;
  id?: string | number;
  name?: string;
  buttons?: ObfButton[];
  images?: ObfImage[];
  grid?: ObfGrid;
  ext_isaac_layout?: string;
}

@Component({
  selector: 'app-board-builder-editor',
  templateUrl: './board-builder-editor.page.html',
  styleUrls: ['./board-builder-editor.page.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class BoardBuilderEditorPage implements OnInit {
  // ── Routing ─────────────────────────────────────────────────────────────────
  boardId = '';
  returnTo = '/board-builder';

  // ── Estado principal ─────────────────────────────────────────────────────────
  board: Board | null = null;
  isLoading = true;
  isSaving = false;
  loadError = '';

  // ── Vista previa ─────────────────────────────────────────────────────────────
  previewMode = false;
  aacPhrase: CellPictogram[] = [];

  // ── Celda seleccionada ───────────────────────────────────────────────────────
  selectedCell: { row: number; col: number } | null = null;
  isEditingCell = false; // true cuando la celda seleccionada ya tiene pictograma

  // ── Drag and drop ────────────────────────────────────────────────────────────
  draggedCell:  { row: number; col: number } | null = null;
  dragOverCell: { row: number; col: number } | null = null;

  // ── Modo mover táctil (alternativa al DnD para tablet/touch) ─────────────────
  // Flujo: doble toque en celda rellena → moveSrcCell se establece
  //        siguiente toque en destino   → se ejecuta el movimiento / intercambio
  moveSrcCell: { row: number; col: number } | null = null;

  // ── Columna izquierda: config en vivo ─────────────────────────────────────────
  cfgName = '';
  cfgImageB64: string | null = null;
  cfgRows = 3;
  cfgCols = 4;
  cfgPredictor = false;
  cfgAiRewrite = false;
  cfgIaRows = 5;
  cfgIaCols = 1;
  cfgUserId = '';
  cfgSaving = false;

  // Circular config
  cfgCircleSlots = 8;
  cfgLocationEnabled = false;
  cfgLocationSlots = 6;

  // Rol y perfil
  cfgBoardRole: 'main' | 'secondary' = 'main';

  // Simulación circular en preview
  circularSimMode = false; // true cuando se activó AI navigation
  circularSimCenter: CellPictogram | null = null;

  // Tableros del usuario asignado (panel izquierdo)
  userBoards: Board[] = [];
  userBoardsLoading = false;
  boardsReady = false; // true cuando userBoards ha cargado (evita bug ion-select timing)

  // Usuarios del centro (para cambiar userId en config)
  centerUsers: BackendUser[] = [];

  // ── Columna derecha: modo ────────────────────────────────────────────────────
  rightMode: 'arasaac' | 'personal' | 'new' = 'arasaac';

  // ARASAAC
  arasaacQuery = '';
  arasaacResults: ArasaacResult[] = [];
  arasaacSearching = false;
  private _arasaacDeb: ReturnType<typeof setTimeout> | null = null;

  // Pictogramas personales del usuario asignado al tablero
  personalPicts: BackendPictogram[] = [];
  personalLoading = false;

  // Formulario de pictograma (columna derecha)
  pictForm: PictForm = this.emptyPictForm();

  // Formulario de acción
  actionForm: ActionForm = { type: 'voice', targetBoardId: '' };

  // Imagen nueva (modo 'new')
  newImgB64: string | null = null;
  newImgUrl: SafeUrl | null = null;

  // ── Constantes expuestas al template ─────────────────────────────────────────
  readonly FITZGERALD = FITZGERALD; // expuesto para el template
  readonly wordTypeLabels = WORD_TYPE_LABELS;
  readonly wordTypes: WordType[] = [
    'verb',
    'pronoun',
    'noun',
    'descriptor',
    'social',
    'misc',
  ];
  readonly actionTypes: { value: ActionType; label: string }[] = [
    { value: 'voice', label: 'Voz' },
    { value: 'navigate', label: 'Navegar a otro tablero' },
    { value: 'voice+navigate', label: 'Voz + Navegar a otro tablero' },
    { value: 'disabled', label: 'Desactivado' },
  ];

  // Acciones especiales para tablero circular
  actionFormAiTarget = false;
  actionFormShowLastPhrase = false; // "Último pictograma pulsado" (solo celda central)

  // Caché de metadata ARASAAC local (persiste durante la sesión, evita peticiones duplicadas)
  private _arasaacMetaCache = new Map<string, Record<string, unknown> | null>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authSvc: AuthService,
    private userSvc: UserService,
    private boardSvc: BoardService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    this.boardId = this.route.snapshot.paramMap.get('boardId') ?? '';
    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) {
      this.returnTo = rt;
    }
  }

  ionViewWillEnter() {
    if (this.boardId) {
      this.loadBoard();
    }
    this.loadCenterUsers();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoard(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(
        this.boardSvc.getBoardById(this.boardId),
      );
      this.board = res.board;
      this.syncConfigFromBoard();
      this.loadUserBoards(this.board.userId);
      this.loadPersonalPicts(this.board.userId);
    } catch {
      this.loadError = 'Error al cargar el tablero.';
    } finally {
      this.isLoading = false;
    }
  }

  private syncConfigFromBoard(): void {
    if (!this.board) return;
    this.cfgName = this.board.name;
    this.cfgImageB64 = this.board.imageUrl || null;
    this.cfgRows = this.board.rows;
    this.cfgCols = this.board.columns;
    this.cfgPredictor = this.board.predictorEnabled;
    this.cfgAiRewrite = this.board.aiRewriteEnabled;
    this.cfgIaRows = this.board.iaRows ?? 5;
    this.cfgIaCols = this.board.iaCols ?? 1;
    this.cfgUserId = this.board.userId;
    this.cfgCircleSlots = this.board.circleSlots ?? 8;
    this.cfgLocationEnabled = this.board.locationColumnEnabled ?? false;
    this.cfgLocationSlots = this.board.locationColumnSlots ?? 6;
    this.cfgBoardRole = this.board.boardRole ?? 'main';
  }

  private async loadUserBoards(userId: string): Promise<void> {
    this.userBoardsLoading = true;
    this.boardsReady = false;
    try {
      const res = await firstValueFrom(this.boardSvc.getBoardsByUser(userId));
      this.userBoards = res.boards.filter((b) => b._id !== this.boardId);
    } catch {
      /* silencioso */
    } finally {
      this.userBoardsLoading = false;
      this.boardsReady = true;
    }
  }

  private async loadPersonalPicts(userId: string): Promise<void> {
    this.personalLoading = true;
    try {
      const res = await firstValueFrom(
        this.userSvc.getPictogramsByUserId(userId),
      );
      this.personalPicts = res.pictograms;
    } catch {
      /* silencioso */
    } finally {
      this.personalLoading = false;
    }
  }

  private async loadCenterUsers(): Promise<void> {
    const org = this.authSvc.getCurrentUser();
    if (!org?.centro) return;
    try {
      const res = await firstValueFrom(
        this.userSvc.getUsersByCenter(org.centro),
      );
      this.centerUsers = res.users.filter((u) => u.type === 'user');
    } catch {
      /* silencioso */
    }
  }

  // ── Grid helpers ─────────────────────────────────────────────────────────────

  /** Genera la lista de coordenadas {row, col} para el grid actual */
  get gridCells(): { row: number; col: number }[] {
    if (!this.board) return [];
    const cells: { row: number; col: number }[] = [];
    for (let r = 0; r < this.board.rows; r++) {
      for (let c = 0; c < this.board.columns; c++) {
        cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  getCellData(row: number, col: number): BoardCell | null {
    return (
      this.board?.cells.find((c) => c.row === row && c.col === col) ?? null
    );
  }

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.getCellData(row, col)?.pictogram ?? null;
  }

  isSelected(row: number, col: number): boolean {
    return this.selectedCell?.row === row && this.selectedCell?.col === col;
  }

  // ── Drag and drop helpers ────────────────────────────────────────────────────

  isDragging(row: number, col: number): boolean {
    return this.draggedCell?.row === row && this.draggedCell?.col === col;
  }

  isDragOver(row: number, col: number): boolean {
    return this.dragOverCell?.row === row && this.dragOverCell?.col === col;
  }

  /** true cuando la celda es el ORIGEN seleccionado para el modo mover táctil */
  isMoveSrc(row: number, col: number): boolean {
    return this.moveSrcCell?.row === row && this.moveSrcCell?.col === col;
  }

  /** true cuando hay una celda origen pendiente de destino (modo mover activo) */
  get isMoveMode(): boolean {
    return !!this.moveSrcCell;
  }

  onCellDragStart(event: DragEvent, row: number, col: number): void {
    // Guardia: no arrastrar en preview ni celdas vacías (sin preventDefault para no bloquear)
    if (this.previewMode || !this.getCellPict(row, col)) return;
    this.draggedCell = { row, col };
    event.dataTransfer?.setData('text/plain', `${row},${col}`);
    event.dataTransfer!.effectAllowed = 'move';
    console.log('[DND start]', row, col, event);
  }

  onCellDragOver(event: DragEvent, row: number, col: number): void {
    if (!this.draggedCell) return;
    if (this.isDragging(row, col)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    this.dragOverCell = { row, col };
    console.log('[DND over]', row, col);
  }

  onCellDragLeave(event: DragEvent, row: number, col: number): void {
    const target  = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    if (this.dragOverCell?.row === row && this.dragOverCell?.col === col) {
      this.dragOverCell = null;
    }
  }

  onCellDrop(event: DragEvent, row: number, col: number): void {
    event.preventDefault();
    console.log('[DND drop]', this.draggedCell, '→', row, col);
    if (!this.draggedCell) return;
    const src = { ...this.draggedCell };
    this.draggedCell  = null;
    this.dragOverCell = null;
    if (src.row === row && src.col === col) return;
    void this.executeCellMove(src.row, src.col, row, col);
  }

  onCellDragEnd(): void {
    console.log('[DND end]');
    this.draggedCell  = null;
    this.dragOverCell = null;
  }

  // ── Modo mover táctil: doble toque activa origen ──────────────────────────

  async onCellDblClick(row: number, col: number): Promise<void> {
    if (this.previewMode) return;

    // Si ya había un origen: doble toque en la misma = cancelar; en otra rellena = nuevo origen
    if (this.moveSrcCell) {
      if (this.moveSrcCell.row === row && this.moveSrcCell.col === col) {
        this.moveSrcCell = null;
        return;
      }
      if (this.getCellPict(row, col)) {
        const pict = this.getCellPict(row, col)!;
        this.moveSrcCell = { row, col };
        (await this.toastCtrl.create({
          message: `Toca destino para mover "${pict.label}". Doble toque aquí para cancelar.`,
          duration: 3000,
          color: 'dark',
          position: 'bottom',
        })).present();
      }
      return;
    }

    // Activar modo mover si la celda tiene pictograma
    const pict = this.getCellPict(row, col);
    if (!pict) return;
    this.moveSrcCell  = { row, col };
    this.selectedCell = null; // quitar el foco del panel derecho
    (await this.toastCtrl.create({
      message: `Toca una celda destino para mover "${pict.label}". Doble toque para cancelar.`,
      duration: 3000,
      color: 'dark',
      position: 'bottom',
    })).present();
  }

  private async executeCellMove(
    srcRow: number, srcCol: number,
    dstRow: number, dstCol: number,
  ): Promise<void> {
    if (!this.board) return;

    const srcCellData = this.getCellData(srcRow, srcCol);
    const dstCellData = this.getCellData(dstRow, dstCol);
    if (!srcCellData?.pictogram) return;

    const srcPict   = srcCellData.pictogram;
    const srcAction = srcCellData.action   ?? { type: 'voice' as ActionType, targetBoardId: null };
    const dstPict   = dstCellData?.pictogram ?? null;
    const dstAction = dstCellData?.action   ?? { type: 'voice' as ActionType, targetBoardId: null };

    // Swap: build new cells list without src/dst, then add them swapped
    const newCells: BoardCell[] = this.board.cells.filter(
      (c) => !(c.row === srcRow && c.col === srcCol) &&
             !(c.row === dstRow && c.col === dstCol),
    );

    // dst ← src's pict+action
    newCells.push({ row: dstRow, col: dstCol, pictogram: srcPict, action: srcAction });

    // src ← dst's pict+action (only if dst was filled; else src becomes empty → omit)
    if (dstPict) {
      newCells.push({ row: srcRow, col: srcCol, pictogram: dstPict, action: dstAction });
    }

    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, { cells: newCells }),
      );
      this.board = res.board;
      const msg = dstPict
        ? `✓ "${srcPict.label}" ⇆ "${dstPict.label}"`
        : `✓ "${srcPict.label}" movido`;
      (await this.toastCtrl.create({
        message: msg,
        duration: 1600,
        color: 'success',
        position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al mover el pictograma.',
        duration: 2200,
        color: 'danger',
        position: 'top',
      })).present();
      await this.loadBoard(); // revert local state
    }
  }

  /** Color base (Fitzgerald o manual) de la celda */
  private getCellBaseColor(row: number, col: number): string | null {
    const p = this.getCellPict(row, col);
    if (!p) return null;
    return p.fitzgeraldEnabled
      ? (FITZGERALD[p.wordType as WordType] ?? '#f5f5f5')
      : p.color || '#f5f5f5';
  }

  /** Fondo: tinte muy claro del color base (color-mix con blanco); gris si desactivado */
  getCellBgColor(row: number, col: number): string {
    if (this.getCellIsDisabled(row, col)) return '#eeeeee';
    const base = this.getCellBaseColor(row, col);
    if (!base) return '#ffffff';
    return `color-mix(in srgb, ${base} 20%, white)`;
  }
 /* getCellBgColor(row: number, col: number): string {
    if (this.getCellIsDisabled(row, col)) return '#eeeeee';

    const p = this.getCellPict(row, col);
    if (!p) return '#ffffff';

    if (!p.fitzgeraldEnabled && p.color) {
      return p.color;
    }

    const base = this.getCellBaseColor(row, col);
    if (!base) return '#ffffff';
    return `color-mix(in srgb, ${base} 20%, white)`;
  }*/

  /** Borde: versión algo más saturada del mismo color base; gris si desactivado */
  getCellBorderColor(row: number, col: number): string {
    if (this.getCellIsDisabled(row, col)) return '#bdbdbd';
    const base = this.getCellBaseColor(row, col);
    if (!base) return '#ffb6c1';  // borde rosa por defecto (celda vacía)
    if (base === '#ffffff') return '#cccccc'; // reborde gris visible en fallback blanco
    return `color-mix(in srgb, ${base} 55%, white)`;
  }

  getCellIsDisabled(row: number, col: number): boolean {
    return this.getCellData(row, col)?.action?.type === 'disabled';
  }

  // ── Selección de celda ───────────────────────────────────────────────────────

  onCellClick(row: number, col: number): void {
    if (this.previewMode) {
      if (this.isCircular) {
        this.handleCircularPreviewClick(row, col);
      } else {
        this.handlePreviewCellClick(row, col);
      }
      return;
    }

    // ── Modo mover táctil: este toque es el destino ──────────────────────────
    if (this.moveSrcCell) {
      const src = { ...this.moveSrcCell };
      this.moveSrcCell = null;
      if (src.row === row && src.col === col) return; // misma celda → cancelar
      void this.executeCellMove(src.row, src.col, row, col);
      return;
    }

    // ── Selección normal para edición ────────────────────────────────────────
    this.selectedCell = { row, col };
    const existing = this.getCellData(row, col);
    this.isEditingCell = !!existing?.pictogram;

    if (existing?.pictogram) {
      this.loadCellIntoForm(existing);
    } else {
      this.pictForm = this.emptyPictForm();
      this.actionForm = { type: 'voice', targetBoardId: '' };
      this.actionFormAiTarget = false;
      this.actionFormShowLastPhrase = false;
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  private loadCellIntoForm(cell: BoardCell): void {
    const p = cell.pictogram!;
    this.pictForm = {
      source: p.source,
      id: p.id,
      label: p.label,
      sound: p.sound,
      imageUrl: p.imageUrl,
      tags: (p.tags ?? []).join(', '),
      description: p.description,
      wordType: p.wordType as WordType,
      fitzgeraldEnabled: p.fitzgeraldEnabled,
      color: p.color,
    };
    this.actionForm = {
      type: cell.action?.type ?? 'voice',
      targetBoardId: cell.action?.targetBoardId ?? '',
    };
    this.actionFormAiTarget = !!cell.action?.aiGeneratedBoardTarget;
    this.actionFormShowLastPhrase = !!cell.action?.showLastPhrase;
    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Guardar/eliminar celda ────────────────────────────────────────────────────

  async saveCell(): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    if (!this.pictForm.label.trim()) {
      (
        await this.toastCtrl.create({
          message: 'Introduce una etiqueta para el pictograma.',
          duration: 2200,
          color: 'warning',
          position: 'top',
        })
      ).present();
      return;
    }

    // Validación: tableros de distinto tipo no pueden enlazarse
    if (
      (this.actionForm.type === 'navigate' ||
        this.actionForm.type === 'voice+navigate') &&
      this.actionForm.targetBoardId
    ) {
      const target = this.userBoards.find(
        (b) => b._id === this.actionForm.targetBoardId,
      );
      if (target && (target.shape ?? 'grid') !== (this.board.shape ?? 'grid')) {
        (
          await this.toastCtrl.create({
            message: 'No se pueden enlazar tableros de distinto tipo.',
            duration: 2800,
            color: 'danger',
            position: 'top',
          })
        ).present();
        return;
      }
    }

    const pict: CellPictogram = {
      source: this.pictForm.source,
      id: this.pictForm.id,
      label: this.pictForm.label.trim(),
      imageUrl: this.pictForm.imageUrl,
      sound: this.pictForm.sound || this.pictForm.label.trim(),
      tags: this.pictForm.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description: this.pictForm.description,
      wordType: this.pictForm.wordType,
      fitzgeraldEnabled: this.pictForm.fitzgeraldEnabled,
      color: this.pictForm.fitzgeraldEnabled
        ? (FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5')
        : this.pictForm.color,
    };

    const isCenterCell =
      this.selectedCell.row === 0 && this.selectedCell.col === -1;
    const action: CellAction = {
      type: this.actionForm.type,
      targetBoardId: this.actionForm.targetBoardId || null,
      aiGeneratedBoardTarget: this.isCircular ? this.actionFormAiTarget : false,
      showLastPhrase:
        this.isCircular && isCenterCell ? this.actionFormShowLastPhrase : false,
    };

    // Si es pictograma nuevo, guardarlo también en pictogramas del usuario
    if (this.pictForm.source === 'new') {
      try {
        const payload: AddPictogramPayload = {
          id: 'bb-' + Date.now(),
          label: pict.label,
          imageUrl: pict.imageUrl,
          wordType: pict.wordType,
          description: pict.description,
        };
        await firstValueFrom(
          this.userSvc.addPictogramToUser(this.board.userId, payload),
        );
        // Refrescar lista personal
        this.loadPersonalPicts(this.board.userId);
      } catch {
        /* no crítico */
      }
    }

    this.isSaving = true;
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateCell(this.boardId, {
          row: this.selectedCell.row,
          col: this.selectedCell.col,
          pictogram: pict,
          action,
        }),
      );
      this.board = res.board;
      this.isEditingCell = true;
      (
        await this.toastCtrl.create({
          message: this.isEditingCell
            ? '✓ Pictograma actualizado'
            : '✓ Pictograma añadido',
          duration: 1800,
          color: 'success',
          position: 'top',
        })
      ).present();
    } catch {
      (
        await this.toastCtrl.create({
          message: 'Error al guardar el pictograma.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
    } finally {
      this.isSaving = false;
    }
  }

  async removeCell(): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    const alert = await this.alertCtrl.create({
      header: 'Eliminar pictograma',
      message: '¿Quieres vaciar esta celda?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              const res = await firstValueFrom(
                this.boardSvc.updateCell(this.boardId, {
                  row: this.selectedCell!.row,
                  col: this.selectedCell!.col,
                  pictogram: null,
                }),
              );
              this.board = res.board;
              this.isEditingCell = false;
              this.pictForm = this.emptyPictForm();
            } catch {
              (
                await this.toastCtrl.create({
                  message: 'Error al eliminar.',
                  duration: 2000,
                  color: 'danger',
                  position: 'top',
                })
              ).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Guardar configuración (columna izquierda) ─────────────────────────────────

  async saveConfig(): Promise<void> {
    if (!this.board) return;

    // Verificar si reducir filas/cols elimina pictogramas (solo para grid)
    const willLoseCells =
      !this.isCircular &&
      this.board.cells.some(
        (c) => c.pictogram && (c.row >= this.cfgRows || c.col >= this.cfgCols),
      );

    if (willLoseCells) {
      const alert = await this.alertCtrl.create({
        header: 'Perderás pictogramas',
        message:
          'Reducir el tamaño del tablero eliminará algunos pictogramas. ¿Continuar?',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Continuar',
            handler: () => {
              this.doSaveConfig();
            },
          },
        ],
      });
      await alert.present();
    } else {
      this.doSaveConfig();
    }
  }

  private async doSaveConfig(): Promise<void> {
    if (!this.board) return;
    this.cfgSaving = true;
    try {
      // Filtrar celdas que quedan fuera del nuevo tamaño (sólo grid)
      const remainingCells = this.isCircular
        ? this.board.cells // circular: todas las celdas son válidas (coords especiales)
        : this.board.cells.filter(
            (c) => c.row < this.cfgRows && c.col < this.cfgCols,
          );

      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, {
          name: this.cfgName,
          imageUrl: this.cfgImageB64 ?? '',
          userId: this.cfgUserId,
          rows: this.cfgRows,
          columns: this.cfgCols,
          circleSlots: this.cfgCircleSlots,
          locationColumnEnabled: this.cfgLocationEnabled,
          locationColumnSlots: this.cfgLocationSlots,
          predictorEnabled: this.cfgPredictor,
          aiRewriteEnabled: this.cfgAiRewrite,
          iaRows: this.cfgIaRows,
          iaCols: this.cfgIaCols,
          boardRole: this.cfgBoardRole,
          cells: remainingCells,
        }),
      );
      this.board = res.board;
      this.syncConfigFromBoard();
      // Si cambió el userId, recargar tableros y pictogramas del nuevo usuario
      if (this.cfgUserId !== this.board.userId) {
        this.loadUserBoards(this.board.userId);
        this.loadPersonalPicts(this.board.userId);
      }
      (
        await this.toastCtrl.create({
          message: '✓ Configuración guardada',
          duration: 1800,
          color: 'success',
          position: 'top',
        })
      ).present();
    } catch {
      (
        await this.toastCtrl.create({
          message: 'Error al guardar la configuración.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
    } finally {
      this.cfgSaving = false;
    }
  }

  // ── Vista previa ──────────────────────────────────────────────────────────────

  togglePreview(): void {
    this.previewMode = !this.previewMode;
    if (this.previewMode) {
      this.aacPhrase = [];
      this.selectedCell = null;
      this.moveSrcCell  = null; // cancelar modo mover táctil al entrar en preview
      this.circularSimMode = false;
      this.circularSimCenter = null;
    }
  }

  private handlePreviewCellClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    const type = cell.action?.type ?? 'voice';

    // Añadir a frase cuando la acción incluye voz
    if (type === 'voice' || type === 'voice+navigate') {
      this.aacPhrase.push({ ...cell.pictogram });
    }

    // Navegar cuando la acción incluye navigate: cargar el tablero destino en el mismo componente
    // La frase NO se borra al navegar (sigue acumulando pictogramas entre tableros)
    if (type === 'navigate' || type === 'voice+navigate') {
      const targetId = cell.action.targetBoardId;
      if (targetId) {
        this.boardId = targetId;
        this.loadBoard(); // previewMode sigue siendo true
      }
    }
  }

  aacDeleteLast(): void {
    this.aacPhrase.pop();
  }
  aacClearPhrase(): void {
    this.aacPhrase = [];
  }

  async aacSpeak() {
    (
      await this.toastCtrl.create({
        message: 'Síntesis de voz pendiente de implementación.',
        duration: 2200,
        color: 'medium',
        position: 'top',
      })
    ).present();
  }

  // ── ARASAAC search ────────────────────────────────────────────────────────────

  onArasaacInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.arasaacQuery = val;
    if (this._arasaacDeb) clearTimeout(this._arasaacDeb);
    if (!val.trim() || val.length < 2) {
      this.arasaacResults = [];
      return;
    }
    this._arasaacDeb = setTimeout(() => this.searchArasaac(val.trim()), 400);
  }

  private async searchArasaac(q: string): Promise<void> {
    this.arasaacSearching = true;
    try {
      // Reutilizamos el endpoint backend que ya existe
      const res = await fetch(
        `http://localhost:4000/api/arasaac/search?query=${encodeURIComponent(q)}&lang=es`,
        { headers: { Authorization: `Bearer ${this.authSvc.getToken()}` } },
      );
      const data: ArasaacResult[] = await res.json();
      this.arasaacResults = Array.isArray(data) ? data.slice(0, 24) : [];
    } catch {
      this.arasaacResults = [];
    } finally {
      this.arasaacSearching = false;
    }
  }

  selectArasaacResult(r: ArasaacResult): void {
    const wordType = this.inferWordType(r.keywords);
    this.pictForm = {
      source: 'arasaac',
      id: r.id?.toString() ?? '',
      label: r.label,
      sound: r.label,
      imageUrl: r.imageUrl,
      tags: r.keywords.join(', '),
      description: '',
      wordType,
      fitzgeraldEnabled: true,
      color: FITZGERALD[wordType],
    };
    this.newImgB64 = null;
    this.newImgUrl = null;
  }

  private inferWordType(keywords: string[]): WordType {
    // Inferencia básica por keywords — puede mejorarse
    const kw = keywords.join(' ').toLowerCase();
    if (/\b(yo|tú|él|ella|nosotros|ellos|vosotros|usted)\b/.test(kw))
      return 'pronoun';
    if (/\b(comer|beber|dormir|jugar|ir|quiero|necesito|hacer)\b/.test(kw))
      return 'verb';
    if (/\b(grande|pequeño|rojo|azul|caliente|frío|bonito|feliz)\b/.test(kw))
      return 'descriptor';
    if (/\b(hola|gracias|por favor|sí|no|adiós|perdona)\b/.test(kw))
      return 'social';
    return 'misc';
  }

  // ── Pictogramas personales ────────────────────────────────────────────────────

  selectPersonalPict(p: BackendPictogram): void {
    this.pictForm = {
      source: 'custom',
      id: p.id,
      label: p.label,
      sound: p.label,
      imageUrl: p.imageUrl,
      tags: '',
      description: p.description ?? '',
      wordType: (p.wordType ?? 'misc') as WordType,
      fitzgeraldEnabled: true,
      color: FITZGERALD[(p.wordType ?? 'misc') as WordType] ?? '#f5f5f5',
    };
    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Imagen nueva ──────────────────────────────────────────────────────────────

  pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (
          await this.toastCtrl.create({
            message: 'La imagen supera 2 MB',
            duration: 2500,
            color: 'warning',
            position: 'top',
          })
        ).present();
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64 = ev.target!.result as string;
        this.newImgB64 = b64;
        this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(b64);
        this.pictForm.imageUrl = b64;
        this.pictForm.source = 'new';
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Imagen del tablero (config) ───────────────────────────────────────────────

  pickBoardImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (
          await this.toastCtrl.create({
            message: 'La imagen supera 2 MB',
            duration: 2500,
            color: 'warning',
            position: 'top',
          })
        ).present();
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.cfgImageB64 = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removeBoardImage(): void {
    this.cfgImageB64 = null;
  }

  // ── OBF / OBZ ────────────────────────────────────────────────────────────────

  /** Exporta el tablero actual y sus tableros enlazados como paquete .obz */
  async exportOBZ(): Promise<void> {
    if (!this.board) {
      (
        await this.toastCtrl.create({
          message: 'No hay tablero cargado para exportar.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
      return;
    }

    this.isSaving = true;
    try {
      // ── 1. Recopilar tableros enlazados recursivamente (BFS) ──────────────
      const { boards, warnings } = await this.collectLinkedBoards(this.board);

      // ── 2. Mapa boardId → ruta dentro del ZIP ─────────────────────────────
      const boardPaths = new Map<string, string>();
      for (const boardId of boards.keys()) {
        boardPaths.set(boardId, `boards/${boardId}.obf`);
      }

      // ── 3. Generar un OBF por tablero; IDs prefijados con los 8 primeros
      //       caracteres del boardId para garantizar unicidad global en el OBZ ─
      const zip = new JSZip();
      const pathsManifest: Record<string, string> = {};

      for (const [boardId, board] of boards) {
        const idPrefix = `${boardId.slice(0, 8)}-`;
        const obf = this.buildOBF(board, idPrefix);

        // Añadir load_board.path a los botones cuyo destino esté en el OBZ
        for (const btn of obf['buttons'] as Record<string, unknown>[]) {
          const lb = btn['load_board'] as Record<string, unknown> | undefined;
          if (lb) {
            const targetId = String(lb['id'] ?? '');
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

      // ── 4. manifest.json ─────────────────────────────────────────────────
      const rootId = this.board._id;
      const manifest = {
        format: 'open-board-0.1',
        root: `boards/${rootId}.obf`,
        paths: {
          boards: pathsManifest,
          images: {},
          sounds: {},
        },
        ext_isaac_package_type: 'OBZ',
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));

      // ── 5. Generar blob y descargar ──────────────────────────────────────
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
      });
      const blobUrl = URL.createObjectURL(blob);
      const safeName =
        (this.board.name || 'tablero')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-áéíóúüñ]/gi, '')
          .replace(/^-+|-+$/g, '') || 'tablero';
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${safeName}.obz`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);

      // ── 6. Toast de resultado + alerta de avisos ─────────────────────────
      const n = boards.size;
      (
        await this.toastCtrl.create({
          message:
            `✓ Exportado como ${safeName}.obz · ${n} tablero(s)` +
            (warnings.length ? ` · ${warnings.length} aviso(s)` : ''),
          duration: 3000,
          color: 'success',
          position: 'top',
        })
      ).present();

      if (warnings.length > 0) {
        const alert = await this.alertCtrl.create({
          header: 'Avisos de exportación OBZ',
          message: warnings.map((w) => `• ${w}`).join('\n'),
          buttons: ['Cerrar'],
        });
        await alert.present();
      }
    } catch (err) {
      console.error('exportOBZ:', err);
      (
        await this.toastCtrl.create({
          message: 'Error al generar el paquete OBZ.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * BFS sobre tableros enlazados vía action.targetBoardId.
   * Excluye: ciclos (visited set), shapes incompatibles, usuarios distintos,
   * cargas fallidas. Devuelve Map ordenado en BFS + lista de advertencias.
   */
  private async collectLinkedBoards(
    root: Board,
  ): Promise<{ boards: Map<string, Board>; warnings: string[] }> {
    const boards = new Map<string, Board>();
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

  /** Abre selector de archivo y lanza la importación OBF */
  async importOBF(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.obf,application/json';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          (
            await this.toastCtrl.create({
              message: 'El archivo no contiene JSON válido.',
              duration: 2500,
              color: 'danger',
              position: 'top',
            })
          ).present();
          return;
        }
        await this.processOBFImport(parsed as ObfDocument);
      } catch (err) {
        console.error('importOBF error:', err);
        (
          await this.toastCtrl.create({
            message: 'Error al leer el archivo OBF.',
            duration: 2500,
            color: 'danger',
            position: 'top',
          })
        ).present();
      }
    };
    input.click();
  }

  /** Valida, parsea y aplica el OBF al tablero activo */
  private async processOBFImport(doc: ObfDocument): Promise<void> {
    // ── 1. Validación de estructura básica ─────────────────────────────────
    if (doc.format && doc.format !== 'open-board-0.1') {
      (
        await this.toastCtrl.create({
          message: `Formato no reconocido: "${doc.format}". Solo se soporta open-board-0.1.`,
          duration: 3000,
          color: 'danger',
          position: 'top',
        })
      ).present();
      return;
    }
    if (!Array.isArray(doc.buttons)) {
      (
        await this.toastCtrl.create({
          message: 'El OBF no contiene un array buttons[] válido.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
      return;
    }
    const grid = doc.grid;
    if (
      !grid ||
      typeof grid.rows !== 'number' ||
      typeof grid.columns !== 'number' ||
      !Array.isArray(grid.order)
    ) {
      (
        await this.toastCtrl.create({
          message:
            'El OBF no tiene grid válido (rows, columns, order son obligatorios).',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
      return;
    }

    // ── 2. Detectar layout circular → no soportado en Fase 2 ──────────────
    const isCircularOBF =
      doc.ext_isaac_layout === 'circular' ||
      doc.buttons.some(
        (b) => b.ext_isaac_role === 'center' || b.ext_isaac_role === 'outer',
      );

    if (isCircularOBF) {
      (
        await this.toastCtrl.create({
          message:
            'La importación OBF circular aún no está disponible. Solo se importan tableros de cuadrícula.',
          duration: 4000,
          color: 'warning',
          position: 'top',
        })
      ).present();
      return;
    }

    // ── 3. Verificar tablero destino ───────────────────────────────────────
    if (!this.board) {
      (
        await this.toastCtrl.create({
          message:
            'No hay tablero activo. Abre un tablero en el editor antes de importar.',
          duration: 2500,
          color: 'warning',
          position: 'top',
        })
      ).present();
      return;
    }
    if (this.board.shape === 'circular') {
      (
        await this.toastCtrl.create({
          message:
            'El tablero actual es circular. La importación OBF solo está disponible en tableros de cuadrícula.',
          duration: 3500,
          color: 'warning',
          position: 'top',
        })
      ).present();
      return;
    }

    // ── 4. Recopilar advertencias informativas ────────────────────────────
    const warnings: string[] = [];
    const images: ObfImage[] = doc.images ?? [];

    if (images.some((img) => img.path && !img.data && !img.url)) {
      warnings.push(
        'Algunas imágenes usan rutas de ZIP (.obz) y se importarán sin imagen.',
      );
    }
    if (doc.buttons.some((b) => b.load_board)) {
      warnings.push(
        'Hay enlaces a otros tableros (load_board) que no se resolverán en OBF individual.',
      );
    }
    const specialActions = [
      ...new Set(
        doc.buttons
          .map((b) => b.action)
          .filter(
            (a): a is string =>
              !!a && a !== ':ext_isaac_disabled' && a.startsWith(':'),
          ),
      ),
    ];
    if (specialActions.length > 0) {
      warnings.push(
        `Acciones especiales ignoradas: ${specialActions.join(', ')}`,
      );
    }

    // ── 5. Mapa de imágenes: id → URL resuelta ─────────────────────────────
    // Prioridad OBF: data > path (no resoluble sin ZIP) > url
    const imgMap = new Map<string, string>();
    for (const img of images) {
      const imgId = String(img.id);
      if (img.data) {
        imgMap.set(imgId, img.data);
      } else if (img.url) {
        imgMap.set(imgId, img.url);
      } else if (img.path) {
        imgMap.set(imgId, '');
      } // path sin ZIP → vacío
      // symbol: sin soporte en ISAAC → ignorado
    }

    // ── 6. Mapa de botones: id → ObfButton ───────────────────────────────
    const btnMap = new Map<string, ObfButton>();
    for (const btn of doc.buttons) {
      btnMap.set(String(btn.id), btn);
    }

    // ── 6b. Pre-cargar metadata ARASAAC para botones sin color explícito ────
    const metaByBtnId = new Map<string, Record<string, unknown> | null>();
    const metaFetches = doc.buttons
      .filter((btn) => !btn.background_color && btn.image_id !== undefined && btn.image_id !== null)
      .map(async (btn) => {
        const imgId   = String(btn.image_id);
        const imgUrl  = imgMap.get(imgId) ?? '';
        if (!imgUrl) return;
        const arasaacId = this.extractArasaacIdFromUrl(imgUrl);
        if (!arasaacId) return;
        const meta = await this.getLocalArasaacMetadata(arasaacId);
        console.log('[ARASAAC meta]', btn.label?.trim() || String(btn.id), arasaacId,
          (meta as Record<string, unknown> | null)?.['keywords']);
        metaByBtnId.set(String(btn.id), meta);
      });
    await Promise.all(metaFetches);

    // ── 7. Convertir grid.order a cells[] ────────────────────────────────
    const rows = grid.rows;
    const columns = grid.columns;
    const cells: BoardCell[] = [];
    const missingBtns: string[] = [];
    const missingImgs: string[] = [];

    for (let r = 0; r < rows; r++) {
      const orderRow = grid.order[r];
      if (!orderRow) continue;
      for (let c = 0; c < columns; c++) {
        const rawId = orderRow[c];
        if (rawId === null || rawId === undefined) continue;

        const btnId = String(rawId);
        const btn = btnMap.get(btnId);
        if (!btn) {
          missingBtns.push(btnId);
          continue;
        }

        // Resolver imagen
        let imageUrl = '';
        if (btn.image_id !== undefined && btn.image_id !== null) {
          const imgId = String(btn.image_id);
          if (imgMap.has(imgId)) {
            imageUrl = imgMap.get(imgId) ?? '';
          } else {
            missingImgs.push(imgId);
          }
        }

        const label = btn.label?.trim() || `Pictograma ${btnId}`;
        const sound = btn.vocalization?.trim() || label;

        let color: string;
        let wordType: WordType;
        let fitzgeraldEnabled: boolean;

        const arasaacId = this.extractArasaacIdFromUrl(imageUrl);

        if (btn.background_color) {
          color              = this.normalizeCssColorToHex(btn.background_color);
          wordType           = 'misc';
          fitzgeraldEnabled  = false;
          console.log('[OBF color]', label, btn.background_color, '→', color);
        } else {
          const meta     = metaByBtnId.get(btnId) ?? null;
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

        const pict: CellPictogram = {
          source: 'custom',
          id: btnId,
          label,
          imageUrl,
          sound,
          tags: [],
          description: '',
          wordType,
          fitzgeraldEnabled,
          color,
        };
        const action: CellAction = {
          type: this.resolveOBFActionType(btn),
          targetBoardId: null, // load_board no se resuelve en OBF individual
        };

        cells.push({ row: r, col: c, pictogram: pict, action });
      }
    }

    if (missingBtns.length > 0) {
      warnings.push(
        `${missingBtns.length} celda(s) con button ID desconocido → importadas vacías.`,
      );
    }
    if (missingImgs.length > 0) {
      warnings.push(
        `${missingImgs.length} referencia(s) image_id sin imagen → importadas sin imagen.`,
      );
    }

    // ── 8. Diálogo de confirmación ────────────────────────────────────────
    const importedName = doc.name?.trim() || 'Tablero importado';
    let confirmMsg =
      `Se reemplazará "${this.board.name}" por "${importedName}" ` +
      `(${rows}×${columns}, ${cells.length} celda(s) con pictograma).`;
    if (warnings.length > 0) {
      confirmMsg += '\n\nAvisos:\n' + warnings.map((w) => `• ${w}`).join('\n');
    }

    const alert = await this.alertCtrl.create({
      header: 'Importar OBF',
      message: confirmMsg,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Importar',
          handler: () => {
            void this.applyOBFImport(importedName, rows, columns, cells);
          },
        },
      ],
    });
    await alert.present();
  }

  /** Resuelve el tipo de acción ISAAC a partir de un botón OBF */
  private resolveOBFActionType(btn: ObfButton): ActionType {
    if (
      btn.action === ':ext_isaac_disabled' ||
      btn.ext_isaac_disabled === true
    ) {
      return 'disabled';
    }
    if (btn.load_board) {
      return btn.vocalization?.trim() ? 'voice+navigate' : 'navigate';
    }
    return 'voice';
  }

  /** Guarda el tablero importado en backend y refresca el editor */
  private async applyOBFImport(
    name: string,
    rows: number,
    columns: number,
    cells: BoardCell[],
  ): Promise<void> {
    if (!this.board) return;
    this.isLoading = true;
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, { name, rows, columns, cells }),
      );
      this.board = res.board;
      this.syncConfigFromBoard();
      this.selectedCell = null;
      this.isEditingCell = false;
      this.pictForm = this.emptyPictForm();
      this.actionForm = { type: 'voice', targetBoardId: '' };
      (
        await this.toastCtrl.create({
          message: `✓ OBF importado: "${name}" · ${cells.length} celda(s)`,
          duration: 2500,
          color: 'success',
          position: 'top',
        })
      ).present();
    } catch {
      (
        await this.toastCtrl.create({
          message: 'Error al guardar el tablero importado en el servidor.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
    } finally {
      this.isLoading = false;
    }
  }

  /** Exporta el tablero actual como archivo .obf (Open Board Format 0.1) */
  async exportOBF(): Promise<void> {
    if (!this.board) {
      (
        await this.toastCtrl.create({
          message: 'No hay tablero cargado para exportar.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
      return;
    }
    try {
      const obf = this.buildOBF(this.board);
      const error = this.validateOBF(obf);
      if (error) {
        (
          await this.toastCtrl.create({
            message: `OBF inválido: ${error}`,
            duration: 3000,
            color: 'danger',
            position: 'top',
          })
        ).present();
        return;
      }
      const json = JSON.stringify(obf, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const blobUrl = URL.createObjectURL(blob);
      const safeName =
        (this.board.name || 'tablero')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-áéíóúüñ]/gi, '')
          .replace(/^-+|-+$/g, '') || 'tablero';
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${safeName}.obf`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      (
        await this.toastCtrl.create({
          message: `✓ Exportado como ${safeName}.obf`,
          duration: 2500,
          color: 'success',
          position: 'top',
        })
      ).present();
    } catch (err) {
      console.error('exportOBF:', err);
      (
        await this.toastCtrl.create({
          message: 'Error al generar el archivo OBF.',
          duration: 2500,
          color: 'danger',
          position: 'top',
        })
      ).present();
    }
  }

  /**
   * Transforma un tablero ISAAC al objeto JSON Open Board Format 0.1.
   * Soporta tableros grid y circulares.
   */
  private buildOBF(board: Board, idPrefix = ''): Record<string, unknown> {
    const isCircular = board.shape === 'circular';
    const buttons: Record<string, unknown>[] = [];
    const images: Record<string, unknown>[] = [];
    const imgMap = new Map<string, string>(); // imageUrl → imageId
    const r4 = (n: number) => Math.round(n * 10000) / 10000; // 4 decimales

    /** Registra imagen; deduplica por URL. Prioridad OBF: data > url — nunca ambos */
    const addImage = (imageUrl: string, btnId: string): string | null => {
      if (!imageUrl) return null;
      if (imgMap.has(imageUrl)) return imgMap.get(imageUrl)!;
      const imgId = `img-${btnId}`;
      imgMap.set(imageUrl, imgId);
      const imgObj: Record<string, unknown> = {
        id: imgId,
        width: 300,
        height: 300,
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
      cell: BoardCell,
      btnId: string,
      extra?: Record<string, unknown>,
    ): Record<string, unknown> => {
      const p = cell.pictogram!;
      const imgId = p.imageUrl ? addImage(p.imageUrl, btnId) : null;
      const actionType = cell.action.type;
      const targetId = cell.action.targetBoardId;
      const vocalization = p.sound.trim() || p.label;

      const btn: Record<string, unknown> = {
        id: btnId,
        label: p.label,
        vocalization,
        background_color: this.hexToRgb(p.color || '#f5f5f5'),
        border_color: 'rgba(0,0,0,0.12)',
      };
      if (imgId) btn['image_id'] = imgId;

      // FIX 1: action solo en casos especiales; voz normal NO lleva action en OBF
      if (actionType === 'disabled') {
        btn['action'] = ':ext_isaac_disabled';
        btn['ext_isaac_disabled'] = true;
      } else if (actionType === 'navigate' && targetId) {
        // FIX 6: load_board con name si disponible en userBoards
        const linked = this.userBoards.find((b) => b._id === String(targetId));
        btn['load_board'] = linked?.name
          ? { id: String(targetId), name: linked.name }
          : { id: String(targetId) };
      } else if (actionType === 'voice+navigate' && targetId) {
        const linked = this.userBoards.find((b) => b._id === String(targetId));
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
        format: 'open-board-0.1',
        id: String(board._id),
        locale: 'es',
        name: board.name,
        buttons,
        images,
        grid: { rows: board.rows, columns: board.columns, order },
      };
    }

    // ── CIRCULAR ──────────────────────────────────────────────────────────────
    const N = board.circleSlots ?? 8;
    const locEnabled = board.locationColumnEnabled ?? false;
    const L = locEnabled ? (board.locationColumnSlots ?? 6) : 0;
    const R = 0.44; // radio normalizado, igual que el editor
    // Tamaño del slot: misma fórmula que circleSlotSizePx; canvas de referencia = 400 px
    const chordPx = 2 * 176 * Math.sin(Math.PI / N);
    const sizePx = Math.max(34, Math.min(72, Math.floor(chordPx * 0.78)));
    const slotSz = r4(sizePx / 400);
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
          left: r4(Math.max(0, Math.min(1, cx - slotSz / 2))),
          top: r4(Math.max(0, Math.min(1, cy - slotSz / 2))),
          width: slotSz,
          height: slotSz,
          ext_isaac_role: 'outer',
          ext_isaac_angle: r4(angleDeg),
        }),
      );
    }

    // Center (row=0, col=-1)
    const centerCell = board.cells.find((c) => c.row === 0 && c.col === -1);
    let centerBtnId: string | null = null;
    if (centerCell?.pictogram) {
      centerBtnId = `${idPrefix}btn-center`;
      const extra: Record<string, unknown> = {
        left: r4(0.5 - centerSz / 2),
        top: r4(0.5 - centerSz / 2),
        width: centerSz,
        height: centerSz,
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
      const btnId = `${idPrefix}btn-loc-${i}`;
      locIds.push(btnId);
      buttons.push(
        buildBtn(cell, btnId, {
          left: 0.01,
          top: topPos,
          width: locSlotSz,
          height: locSlotSz,
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
      format: 'open-board-0.1',
      id: String(board._id),
      locale: 'es',
      name: board.name,
      ext_isaac_layout: 'circular',
      ext_isaac_circle_slots: N,
      ext_isaac_location_column: locEnabled,
      ext_isaac_location_slots: L,
      buttons,
      images,
      grid: { rows: gRows, columns: gCols, order },
    };
  }

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
    N: number,
    outerIds: string[], // outerIds[i] = btnId  |  '' si slot sin pictograma
    centerBtnId: string | null,
    locIds: string[], // locIds[i]   = btnId  |  '' si slot sin pictograma
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
    for (let c = 0; c < gSize; c++) fullPerim.push([0, c]); // fila sup
    for (let r = 1; r < gSize; r++) fullPerim.push([r, gSize - 1]); // col derecha
    for (let c = gSize - 2; c >= 0; c--) fullPerim.push([gSize - 1, c]); // fila inf
    for (let r = gSize - 2; r >= 1; r--) fullPerim.push([r, 0]); // col izquierda
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
      const normDeg = (angleDeg + 90 + 360) % 360; // 0° = 12h, crece CW
      const targetIdx = Math.round((normDeg / 360) * perimLen) % perimLen;

      let placed = false;
      for (let off = 0; off < perimLen; off++) {
        const idx = (targetIdx + off) % perimLen;
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

  /**
   * Normaliza cualquier color CSS a #rrggbb para su uso en pictogram.color.
   * Soporta: #rgb · #rrggbb · rgb(r,g,b) · rgba(r,g,b,a)
   * Si no puede parsear devuelve '#f5f5f5'.
   */
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

  /**
   * Valida un objeto OBF antes de descargarlo.
   * Comprueba campos obligatorios, unicidad de IDs, referencias cruzadas
   * y coordenadas absolutas válidas en tableros circulares.
   */
  private validateOBF(obf: Record<string, unknown>): string | null {
    if (obf['format'] !== 'open-board-0.1') return 'format incorrecto';
    if (!Array.isArray(obf['buttons'])) return 'buttons[] ausente';
    if (!Array.isArray(obf['images'])) return 'images[] ausente';
    const grid = obf['grid'] as Record<string, unknown> | undefined;
    if (!grid) return 'grid ausente';
    if (typeof grid['rows'] !== 'number') return 'grid.rows ausente';
    if (typeof grid['columns'] !== 'number') return 'grid.columns ausente';
    if (!Array.isArray(grid['order'])) return 'grid.order ausente';

    const btns = obf['buttons'] as Array<Record<string, unknown>>;
    const imgs = obf['images'] as Array<Record<string, unknown>>;
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

  // ── Añadir al perfil ─────────────────────────────────────────────────────────

  async addToProfile(): Promise<void> {
    if (!this.board) return;

    // Nombre por defecto
    const defName  = this.board.profileName  || this.board.name;
    const defDesc  = this.board.profileDescription || '';
    const defImage = this.board.profileImage || this.board.imageUrl || '';

    const alert = await this.alertCtrl.create({
      header:  'Añadir al perfil',
      message: 'Este tablero aparecerá en el perfil del usuario asignado.',
      inputs: [
        {
          name:        'profileName',
          type:        'text',
          value:       defName,
          placeholder: 'Nombre visible',
          attributes:  { maxlength: 60 },
        },
        {
          name:        'profileDescription',
          type:        'textarea',
          value:       defDesc,
          placeholder: 'Descripción breve (opcional)',
          attributes:  { maxlength: 200, rows: 2 },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Añadir',
          handler: async (data: { profileName: string; profileDescription: string }) => {
            try {
              const res = await firstValueFrom(
                this.boardSvc.updateBoard(this.boardId, {
                  visibleInProfile:   true,
                  profileName:        data.profileName?.trim() || this.board!.name,
                  profileDescription: data.profileDescription?.trim() || '',
                  profileImage:       defImage,
                }),
              );
              this.board = res.board;
              (await this.toastCtrl.create({
                message:  '✓ Tablero añadido al perfil del usuario',
                duration: 2500, color: 'success', position: 'top',
              })).present();
            } catch {
              (await this.toastCtrl.create({
                message:  'Error al actualizar el perfil.',
                duration: 2500, color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async removeFromProfile(): Promise<void> {
    if (!this.board) return;
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, { visibleInProfile: false }),
      );
      this.board = res.board;
      (await this.toastCtrl.create({
        message:  'Tablero eliminado del perfil',
        duration: 2000, color: 'medium', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message:  'Error al actualizar el perfil.',
        duration: 2000, color: 'danger', position: 'top',
      })).present();
    }
  }

  /** Getter: mostrar botón "Añadir al perfil" solo en tableros principales con usuario */
  get canAddToProfile(): boolean {
    return (this.board?.boardRole ?? 'main') === 'main' && !!this.board?.userId;
  }

  /** Getter: el tablero ya está visible en el perfil */
  get isInProfile(): boolean {
    return !!this.board?.visibleInProfile;
  }

  // ── Navegación a otro tablero del panel izquierdo ─────────────────────────────

  openBoard(boardId: string): void {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: { returnTo: this.returnTo },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  goBack(): void {
    this.router.navigateByUrl(this.returnTo);
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    if (!url) return '';
    if (url.startsWith('data:'))
      return this.sanitizer.bypassSecurityTrustUrl(url);
    return url;
  }

  /** Color base del formulario (Fitzgerald o manual) */
  get fitzgeraldColor(): string {
    if (!this.pictForm.fitzgeraldEnabled)
      return this.pictForm.color || '#f5f5f5';
    return FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5';
  }

  /** Fondo claro para la preview del pictograma en el formulario (mismo tinte que las celdas) */
  get fitzgeraldBgColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 20%, white)`;
  }

  /** Borde semisaturado para la preview del pictograma en el formulario */
  get fitzgeraldBorderColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 55%, white)`;
  }

  /** Muestra la columna IA cuando el predictor está activado */
  get iaColumnVisible(): boolean {
    return !!this.board?.predictorEnabled;
  }

  /** Índices para los pictogramas de la columna IA (filas × columnas) */
  get iaCells(): number[] {
    const count =
      (this.board?.iaRows ?? this.cfgIaRows ?? 5) *
      (this.board?.iaCols ?? this.cfgIaCols ?? 1);
    return Array.from({ length: count }, (_, i) => i);
  }

  get hasSelectedCell(): boolean {
    return !!this.selectedCell;
  }

  get previewBoardName(): string {
    return this.board?.name ?? '';
  }

  // ── Circular helpers ──────────────────────────────────────────────────────────

  /** true cuando el tablero cargado es circular */
  get isCircular(): boolean {
    return this.board?.shape === 'circular';
  }

  /** Slots exteriores: índices 0..(circleSlots-1), col=0 */
  get outerSlots(): number[] {
    const n = this.board?.circleSlots ?? this.cfgCircleSlots ?? 8;
    return Array.from({ length: n }, (_, i) => i);
  }

  /** Slots de columna de ubicación: índices 0..(locationSlots-1), col=-2 */
  get locationSlots(): number[] {
    if (!this.board?.locationColumnEnabled) return [];
    const n = this.board?.locationColumnSlots ?? this.cfgLocationSlots ?? 6;
    return Array.from({ length: n }, (_, i) => i);
  }

  /**
   * Posición CSS para ranura circular exterior i de N.
   * R=44% → el centro del slot coincide con la línea del anillo (::before inset 6%).
   */
  getCircleSlotStyle(i: number): { left: string; top: string } {
    const n = this.board?.circleSlots ?? this.cfgCircleSlots ?? 8;
    const angleDeg = (i / n) * 360 - 90;
    const angleRad = (angleDeg * Math.PI) / 180;
    const R = 44; // % desde el centro del canvas
    const left = 50 + R * Math.cos(angleRad);
    const top = 50 + R * Math.sin(angleRad);
    return { left: `${left}%`, top: `${top}%` };
  }

  /**
   * Tamaño de cada slot exterior en px según N.
   * Cuerda a R=44% (ref. 400px canvas) = 2·176·sin(π/N). Límite 34–72 px.
   */
  get circleSlotSizePx(): string {
    const N = this.board?.circleSlots ?? this.cfgCircleSlots ?? 8;
    const chord = 2 * 176 * Math.sin(Math.PI / N);
    const size = Math.max(34, Math.min(72, Math.floor(chord * 0.78)));
    return `${size}px`;
  }

  /** Pictograma del slot central (row=0, col=-1) */
  get circularCenterPict(): CellPictogram | null {
    return this.getCellPict(0, -1);
  }

  /** true si la celda central tiene showLastPhrase activado */
  get isCenterShowingLastPhrase(): boolean {
    return !!this.getCellData(0, -1)?.action?.showLastPhrase;
  }

  /** true si la celda seleccionada es el centro circular */
  get isCenterSelected(): boolean {
    return this.selectedCell?.row === 0 && this.selectedCell?.col === -1;
  }

  /**
   * En preview: si sim activo → simCenter.
   * Si showLastPhrase → último picto de la frase.
   * Sino → pictograma guardado.
   */
  get previewCenterPict(): CellPictogram | null {
    if (this.circularSimMode) return this.circularSimCenter;
    const centerCell = this.getCellData(0, -1);
    if (centerCell?.action?.showLastPhrase) {
      return this.aacPhrase.length > 0
        ? this.aacPhrase[this.aacPhrase.length - 1]
        : null;
    }
    return this.circularCenterPict;
  }

  /** Gestión de click en slot circular en preview */
  handleCircularPreviewClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    const type = cell.action?.type ?? 'voice';

    // Añadir a frase (voz)
    if (type === 'voice' || type === 'voice+navigate') {
      this.aacPhrase.push({ ...cell.pictogram });
    }

    // Si la acción tiene aiGeneratedBoardTarget → modo simulación IA (circular)
    if (cell.action?.aiGeneratedBoardTarget) {
      this.circularSimCenter = { ...cell.pictogram };
      this.circularSimMode = true;
      return; // no navegar, solo simular
    }

    // Navegar a otro tablero (la frase NO se borra)
    if (type === 'navigate' || type === 'voice+navigate') {
      const targetId = cell.action.targetBoardId;
      if (targetId) {
        this.boardId = targetId;
        this.circularSimMode = false;
        this.circularSimCenter = null;
        this.loadBoard(); // previewMode sigue siendo true
      }
    }
  }

  /** Resetear simulación circular */
  circularSimReset(): void {
    this.circularSimMode = false;
    this.circularSimCenter = null;
  }

  /** ¿Tiene pictograma la acción aiGeneratedBoardTarget? */
  isAiTargetAction(row: number, col: number): boolean {
    return !!this.getCellData(row, col)?.action?.aiGeneratedBoardTarget;
  }

  private emptyPictForm(): PictForm {
    return {
      source: 'new',
      id: '',
      label: '',
      sound: '',
      imageUrl: '',
      tags: '',
      description: '',
      wordType: 'misc',
      fitzgeraldEnabled: true,
      color: '#f5f5f5',
    };
  }

  // ── Board list helpers ────────────────────────────────────────────────────────

  /** Tableros grid del usuario (para la lista izquierda) */
  get gridBoards(): Board[] {
    return this.userBoards.filter((b) => (b.shape ?? 'grid') === 'grid');
  }

  /** Tableros circulares del usuario (para la lista izquierda) */
  get circularBoards(): Board[] {
    return this.userBoards.filter((b) => b.shape === 'circular');
  }

  /** Solo tableros del mismo shape que el actual (para selector de navegación) */
  get sameShapeBoards(): Board[] {
    const shape = this.board?.shape ?? 'grid';
    return this.userBoards.filter((b) => (b.shape ?? 'grid') === shape);
  }

  /** Meta-texto de un tablero para la lista izquierda */
  boardShapeMeta(b: Board): string {
    if (b.shape === 'circular') return `⊙ ${b.circleSlots || 8} ranuras`;
    return `${b.rows}×${b.columns}`;
  }

  onUserSelect(event: Event): void {
    this.cfgUserId =
      (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  onActionTypeSelect(event: Event): void {
    this.actionForm.type = (
      event as CustomEvent<{ value: ActionType }>
    ).detail.value;
  }

  onTargetBoardSelect(event: Event): void {
    this.actionForm.targetBoardId =
      (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }
}
