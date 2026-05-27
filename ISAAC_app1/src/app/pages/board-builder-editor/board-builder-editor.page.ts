import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import JSZip from 'jszip';
import { AuthService } from '../../services/auth.service';
import {
  UserService,
  BackendUser,
  BackendPictogram,
  AddPictogramPayload,
} from '../../services/user.service';
import {
  BoardService,
  Board,
  BoardCell,
  CellPictogram,
  CellAction,
  ActionType,
} from '../../services/board.service';
import { WordType, FITZGERALD, WORD_TYPE_LABELS } from '../../shared/constants/fitzgerald';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { ObfExportService } from '../../services/obf-export.service';
import {
  ObzImportService,
  ObfButtonOBZ,
  ObfDocumentOBZ,
  ObfImageOBZ,
} from '../../services/obz-import.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { PictCellContentComponent } from '../../components/pict-cell-content/pict-cell-content.component';
import { BoardGridComponent } from '../../components/board-grid/board-grid.component';
import { BoardCircularComponent } from '../../components/board-circular/board-circular.component';
import { PhraseBandComponent } from '../../components/phrase-band/phrase-band.component';
import {
  BoardSidebarLeftComponent,
  BoardSidebarConfig,
} from '../../components/board-sidebar-left/board-sidebar-left.component';

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

@Component({
  selector: 'app-board-builder-editor',
  templateUrl: './board-builder-editor.page.html',
  styleUrls: ['./board-builder-editor.page.scss'],
  standalone: true,
  imports: [
    IonicModule,
    FormsModule,
    LoadingErrorStateComponent,
    PictCellContentComponent,
    BoardGridComponent,
    BoardCircularComponent,
    PhraseBandComponent,
    BoardSidebarLeftComponent,
  ],
})
export class BoardBuilderEditorPage implements OnInit, OnDestroy {
  // ── Routing ─────────────────────────────────────────────────────────────────
  boardId = '';
  returnTo = '/board-builder';
  /** Contexto del builder: se propaga al volver para que la lista filtre correctamente. */
  contextCreatorId   = '';
  contextCreatorName = '';

  /** Suscripción al observable paramMap para detectar cambios de :boardId
   *  cuando Ionic reutiliza el componente (el snapshot no se actualiza en ese caso). */
  private routeSub?: Subscription;

  // ── Pending link (vuelta desde "Crear nuevo tablero") ────────────────────────
  private pendingLinkBoardId    = '';
  private pendingLinkRow        = -1;
  private pendingLinkCol        = -1;
  private pendingLinkActionType = '';

  // ── Estado principal ─────────────────────────────────────────────────────────
  board: Board | null = null;
  isLoading = true;
  isSaving = false;
  loadError = '';

  // ── Configuración: modelo para BoardSidebarLeftComponent ────────────────────
  // La page es la fuente de verdad (board); el sidebar tiene copias locales.
  // Cada vez que se guarda con éxito, syncConfigFromBoard() crea un nuevo
  // objeto (referencia nueva) para disparar ngOnChanges en el sidebar.
  sidebarConfig: BoardSidebarConfig = {
    name: '', imageB64: null, rows: 3, cols: 4,
    predictor: false, aiRewrite: false, iaRows: 5, iaCols: 1,
    boardRole: 'main', circleSlots: 8, locationEnabled: false,
    locationSlots: 6, assignedUserIds: [],
  };
  /** true mientras se procesa el guardado de configuración del tablero. */
  sidebarSaving = false;

  // ── Vista previa ─────────────────────────────────────────────────────────────
  previewMode = false;
  aacPhrase: CellPictogram[] = [];

  // ── Celda seleccionada ───────────────────────────────────────────────────────
  selectedCell: { row: number; col: number } | null = null;
  isEditingCell = false; // true cuando la celda seleccionada ya tiene pictograma

  // ── Drag and drop ────────────────────────────────────────────────────────────
  draggedCell:  { row: number; col: number } | null = null;
  dragOverCell: { row: number; col: number } | null = null;

  // ── Modo mover táctil ─────────────────────────────────────────────────────────
  moveSrcCell: { row: number; col: number } | null = null;

  // ── Simulación circular en preview ───────────────────────────────────────────
  circularSimMode = false;
  circularSimCenter: CellPictogram | null = null;

  // ── Datos del sidebar (lista de tableros y usuarios del centro) ──────────────
  userBoards: Board[] = [];
  userBoardsLoading = false;
  boardsReady = false; // evita bug ion-select en el selector de acción derecho
  highlightedBoardId = '';

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
  readonly FITZGERALD = FITZGERALD;
  readonly wordTypeLabels = WORD_TYPE_LABELS;
  readonly wordTypes: WordType[] = [
    'verb', 'pronoun', 'noun', 'descriptor', 'social', 'misc',
  ];
  readonly actionTypes: { value: ActionType; label: string }[] = [
    { value: 'voice',          label: 'Voz' },
    { value: 'navigate',       label: 'Navegar a otro tablero' },
    { value: 'voice+navigate', label: 'Voz + Navegar a otro tablero' },
    { value: 'disabled',       label: 'Desactivado' },
  ];

  // Acciones especiales para tablero circular
  actionFormAiTarget = false;
  actionFormShowLastPhrase = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authSvc: AuthService,
    private userSvc: UserService,
    private boardSvc: BoardService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
    private aacRuntime: AacRuntimeService,
    private obfExportSvc: ObfExportService,
    private obzImportSvc: ObzImportService,
    private boardLayoutSvc: BoardLayoutService,
  ) {}

  ngOnInit() {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const freshId = params.get('boardId') ?? '';
      if (freshId) { this.boardId = freshId; }
    });

    const rt = this.route.snapshot.queryParamMap.get('returnTo');
    if (rt) { this.returnTo = rt; }

    const qCreatorId   = this.route.snapshot.queryParamMap.get('creatorId');
    const qCreatorName = this.route.snapshot.queryParamMap.get('creatorName');
    if (qCreatorId)   { this.contextCreatorId   = qCreatorId; }
    if (qCreatorName) { this.contextCreatorName = qCreatorName; }
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  ionViewWillEnter() {
    const linkFlag = this.route.snapshot.queryParamMap.get('linkCreatedBoard');
    if (linkFlag === 'true') {
      this.pendingLinkBoardId    = this.route.snapshot.queryParamMap.get('newlyCreatedTargetBoardId') ?? '';
      this.pendingLinkRow        = Number(this.route.snapshot.queryParamMap.get('sourceCellRow') ?? '-1');
      this.pendingLinkCol        = Number(this.route.snapshot.queryParamMap.get('sourceCellCol') ?? '-1');
      this.pendingLinkActionType = this.route.snapshot.queryParamMap.get('sourceActionType') ?? 'navigate';
    }

    if (this.boardId) {
      void this.loadBoard().then(() => this.applyLinkedBoard());
    }
    this.loadCenterUsers();
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadBoard(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.boardSvc.getBoardById(this.boardId));
      this.board = res.board;
      this.syncConfigFromBoard();
      const assignedIds = this.board.assignedUserIds ?? [];
      this.loadUserBoards(assignedIds);
      this.loadPersonalPicts(assignedIds[0] || this.board.userId);
    } catch {
      this.loadError = 'Error al cargar el tablero.';
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Construye y asigna un nuevo objeto sidebarConfig desde el board guardado.
   * Al crear una referencia nueva, ngOnChanges del sidebar resetea el formulario.
   */
  private syncConfigFromBoard(): void {
    if (!this.board) return;
    this.sidebarConfig = this.buildSidebarConfig();
  }

  private buildSidebarConfig(): BoardSidebarConfig {
    const b = this.board!;
    return {
      name:            b.name,
      imageB64:        b.imageUrl || null,
      rows:            b.rows,
      cols:            b.columns,
      predictor:       b.predictorEnabled,
      aiRewrite:       b.aiRewriteEnabled,
      iaRows:          b.iaRows ?? 5,
      iaCols:          b.iaCols ?? 1,
      boardRole:       b.boardRole ?? 'main',
      circleSlots:     b.circleSlots ?? 8,
      locationEnabled: b.locationColumnEnabled ?? false,
      locationSlots:   b.locationColumnSlots ?? 6,
      assignedUserIds: b.assignedUserIds?.length
        ? [...b.assignedUserIds]
        : (b.userId ? [b.userId] : []),
    };
  }

  private async loadUserBoards(assignedUserIds: string[]): Promise<void> {
    if (assignedUserIds.length === 0) {
      this.userBoards = [];
      this.userBoardsLoading = false;
      this.boardsReady = true;
      return;
    }
    this.userBoardsLoading = true;
    this.boardsReady = false;
    try {
      const res = await firstValueFrom(this.boardSvc.getAvailableTargets(assignedUserIds));
      this.userBoards = res.boards.filter((b) => b._id !== this.boardId);
    } catch {
      /* silencioso */
    } finally {
      this.userBoardsLoading = false;
      this.boardsReady = true;
    }
  }

  private async loadPersonalPicts(userId: string): Promise<void> {
    if (this.isSharedBoard) {
      this.personalPicts = [];
      this.personalLoading = false;
      return;
    }
    this.personalLoading = true;
    try {
      const res = await firstValueFrom(this.userSvc.getPictogramsByUserId(userId));
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
      const res = await firstValueFrom(this.userSvc.getUsersByCenter(org.centro));
      this.centerUsers = res.users.filter((u) => u.type === 'user');
    } catch {
      /* silencioso */
    }
  }

  // ── Grid helpers (delegados a BoardLayoutService) ────────────────────────────

  get gridCells(): { row: number; col: number }[] {
    return this.boardLayoutSvc.gridCells(this.board);
  }

  getCellData(row: number, col: number): BoardCell | null {
    return this.boardLayoutSvc.getCellData(this.board, row, col);
  }

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.boardLayoutSvc.getCellPict(this.board, row, col);
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

  isMoveSrc(row: number, col: number): boolean {
    return this.moveSrcCell?.row === row && this.moveSrcCell?.col === col;
  }

  get isMoveMode(): boolean {
    return !!this.moveSrcCell;
  }

  onCellDragStart(event: DragEvent, row: number, col: number): void {
    event.dataTransfer?.setData('text/plain', '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.draggedCell = { row, col };
  }

  onCellDragOver(event: DragEvent, row: number, col: number): void {
    if (!this.draggedCell) return;
    if (this.isDragging(row, col)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.dragOverCell = { row, col };
  }

  onCellDragLeave(event: DragEvent, row: number, col: number): void {
    const target  = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget  as Node | null;
    if (target && related && target.contains(related)) return;
    if (this.dragOverCell?.row === row && this.dragOverCell?.col === col) {
      this.dragOverCell = null;
    }
  }

  onCellDrop(event: DragEvent, row: number, col: number): void {
    event.preventDefault();
    if (!this.draggedCell) return;
    const src = { ...this.draggedCell };
    this.draggedCell  = null;
    this.dragOverCell = null;
    if (src.row === row && src.col === col) return;
    void this.executeCellMove(src.row, src.col, row, col);
  }

  onCellDragEnd(): void {
    this.draggedCell  = null;
    this.dragOverCell = null;
  }

  // ── Modo mover táctil ─────────────────────────────────────────────────────────

  async onCellDblClick(row: number, col: number): Promise<void> {
    if (this.previewMode) return;

    if (this.moveSrcCell) {
      if (this.moveSrcCell.row === row && this.moveSrcCell.col === col) {
        this.moveSrcCell = null;
        return;
      }
      if (this.getCellPict(row, col)) {
        const pict = this.getCellPict(row, col)!;
        this.moveSrcCell = { row, col };
        (await this.toastCtrl.create({
          message:  `Toca destino para mover "${pict.label}". Doble toque aquí para cancelar.`,
          duration: 3000, color: 'dark', position: 'bottom',
        })).present();
      }
      return;
    }

    const pict = this.getCellPict(row, col);
    if (!pict) return;
    this.moveSrcCell  = { row, col };
    this.selectedCell = null;
    (await this.toastCtrl.create({
      message:  `Toca una celda destino para mover "${pict.label}". Doble toque para cancelar.`,
      duration: 3000, color: 'dark', position: 'bottom',
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

    const newCells: BoardCell[] = this.board.cells.filter(
      (c) => !(c.row === srcRow && c.col === srcCol) &&
             !(c.row === dstRow && c.col === dstCol),
    );
    newCells.push({ row: dstRow, col: dstCol, pictogram: srcPict, action: srcAction });
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
        message: msg, duration: 1600, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al mover el pictograma.', duration: 2200, color: 'danger', position: 'top',
      })).present();
      await this.loadBoard();
    }
  }

  // ── Selección de celda ───────────────────────────────────────────────────────

  onCellClick(row: number, col: number): void {
    if (this.previewMode) {
      if (this.isCircular) {
        if (this.circularSimMode && row === 0 && col === -1) {
          this.circularSimReset();
          return;
        }
        this.handleCircularPreviewClick(row, col);
      } else {
        this.handlePreviewCellClick(row, col);
      }
      return;
    }

    if (this.moveSrcCell) {
      const src = { ...this.moveSrcCell };
      this.moveSrcCell = null;
      if (src.row === row && src.col === col) return;
      void this.executeCellMove(src.row, src.col, row, col);
      return;
    }

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
      (await this.toastCtrl.create({
        message: 'Introduce una etiqueta para el pictograma.',
        duration: 2200, color: 'warning', position: 'top',
      })).present();
      return;
    }

    if (
      (this.actionForm.type === 'navigate' || this.actionForm.type === 'voice+navigate') &&
      this.actionForm.targetBoardId
    ) {
      const target = this.userBoards.find((b) => b._id === this.actionForm.targetBoardId);
      if (target && (target.shape ?? 'grid') !== (this.board.shape ?? 'grid')) {
        (await this.toastCtrl.create({
          message: 'No se pueden enlazar tableros de distinto tipo.',
          duration: 2800, color: 'danger', position: 'top',
        })).present();
        return;
      }
    }

    const pict: CellPictogram = {
      source: this.pictForm.source,
      id: this.pictForm.id,
      label: this.pictForm.label.trim(),
      imageUrl: this.pictForm.imageUrl,
      sound: this.pictForm.sound || this.pictForm.label.trim(),
      tags: this.pictForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      description: this.pictForm.description,
      wordType: this.pictForm.wordType,
      fitzgeraldEnabled: this.pictForm.fitzgeraldEnabled,
      color: this.pictForm.fitzgeraldEnabled
        ? (FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5')
        : this.pictForm.color,
    };

    const isCenterCell = this.selectedCell.row === 0 && this.selectedCell.col === -1;
    const action: CellAction = {
      type: this.actionForm.type,
      targetBoardId: this.actionForm.targetBoardId || null,
      aiGeneratedBoardTarget: this.isCircular ? this.actionFormAiTarget : false,
      showLastPhrase: this.isCircular && isCenterCell ? this.actionFormShowLastPhrase : false,
    };

    if (this.pictForm.source === 'new' && !this.isSharedBoard) {
      try {
        const payload: AddPictogramPayload = {
          id: 'bb-' + Date.now(),
          label: pict.label,
          imageUrl: pict.imageUrl,
          wordType: pict.wordType,
          description: pict.description,
        };
        await firstValueFrom(this.userSvc.addPictogramToUser(this.board.userId, payload));
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
      (await this.toastCtrl.create({
        message: this.isEditingCell ? '✓ Pictograma actualizado' : '✓ Pictograma añadido',
        duration: 1800, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar el pictograma.', duration: 2500, color: 'danger', position: 'top',
      })).present();
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
              (await this.toastCtrl.create({
                message: 'Error al eliminar.', duration: 2000, color: 'danger', position: 'top',
              })).present();
            }
          },
        },
      ],
    });
    await alert.present();
  }

  // ── Guardar configuración (delegado desde BoardSidebarLeftComponent) ───────────

  /**
   * Recibe el payload del sidebar cuando el usuario pulsa "Guardar configuración".
   * Comprueba si hay pérdida de celdas (solo para grid), pide confirmación si es
   * el caso, y luego delega en doSaveConfig().
   */
  async onSaveConfigRequest(payload: BoardSidebarConfig): Promise<void> {
    if (!this.board) return;

    const willLoseCells =
      !this.isCircular &&
      this.board.cells.some(
        (c) => c.pictogram && (c.row >= payload.rows || c.col >= payload.cols),
      );

    if (willLoseCells) {
      const alert = await this.alertCtrl.create({
        header: 'Perderás pictogramas',
        message: 'Reducir el tamaño del tablero eliminará algunos pictogramas. ¿Continuar?',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Continuar', handler: () => { this.doSaveConfig(payload); } },
        ],
      });
      await alert.present();
    } else {
      this.doSaveConfig(payload);
    }
  }

  private async doSaveConfig(payload: BoardSidebarConfig): Promise<void> {
    if (!this.board) return;
    this.sidebarSaving = true;
    try {
      const remainingCells = this.isCircular
        ? this.board.cells
        : this.board.cells.filter((c) => c.row < payload.rows && c.col < payload.cols);

      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, {
          name:                  payload.name,
          imageUrl:              payload.imageB64 ?? '',
          userId:                payload.assignedUserIds[0] || '',
          assignedUserIds:       payload.assignedUserIds,
          rows:                  payload.rows,
          columns:               payload.cols,
          circleSlots:           payload.circleSlots,
          locationColumnEnabled: payload.locationEnabled,
          locationColumnSlots:   payload.locationSlots,
          predictorEnabled:      payload.predictor,
          aiRewriteEnabled:      payload.aiRewrite,
          iaRows:                payload.iaRows,
          iaCols:                payload.iaCols,
          boardRole:             payload.boardRole,
          cells:                 remainingCells,
        }),
      );
      this.board = res.board;
      // Nuevo objeto → ngOnChanges en el sidebar resetea el formulario
      this.syncConfigFromBoard();
      const assignedIds = this.board.assignedUserIds ?? [];
      this.loadUserBoards(assignedIds);
      this.loadPersonalPicts(assignedIds[0] || this.board.userId);
      (await this.toastCtrl.create({
        message: '✓ Configuración guardada', duration: 1800, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar la configuración.', duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.sidebarSaving = false;
    }
  }

  // ── Vista previa ──────────────────────────────────────────────────────────────

  togglePreview(): void {
    this.previewMode = !this.previewMode;
    if (this.previewMode) {
      this.aacPhrase = [];
      this.selectedCell = null;
      this.moveSrcCell  = null;
      this.circularSimMode = false;
      this.circularSimCenter = null;
      void this.aacRuntime.startSession('', this.boardId, 'preview');
    } else {
      this.aacRuntime.reset();
    }
  }

  private handlePreviewCellClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    this.aacRuntime.handlePictogramPress(cell, this.boardId);
    this.aacPhrase = this.aacRuntime.phrase.map(p => this.phraseItemToCellPict(p));

    const type = cell.action?.type ?? 'voice';
    if (type === 'navigate' || type === 'voice+navigate') {
      const targetId = cell.action.targetBoardId;
      if (targetId) {
        this.boardId = targetId;
        this.loadBoard();
      }
    }
  }

  aacDeleteLast(): void {
    this.aacRuntime.deleteLast();
    this.aacPhrase = this.aacRuntime.phrase.map(p => this.phraseItemToCellPict(p));
  }

  aacClearPhrase(): void {
    this.aacRuntime.clearPhrase();
    this.aacPhrase = this.aacRuntime.phrase.map(p => this.phraseItemToCellPict(p));
  }

  aacSpeak(): void {
    this.aacRuntime.speakPhrase();
  }

  private phraseItemToCellPict(p: import('../../services/aac-runtime.service').AacPhraseItem): CellPictogram {
    return {
      source: 'arasaac', id: p.id, label: p.label, imageUrl: p.imageUrl,
      sound: p.sound, tags: [], description: '', wordType: 'misc',
      fitzgeraldEnabled: false, color: '',
    };
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
    const kw = keywords.join(' ').toLowerCase();
    if (/\b(yo|tú|él|ella|nosotros|ellos|vosotros|usted)\b/.test(kw)) return 'pronoun';
    if (/\b(comer|beber|dormir|jugar|ir|quiero|necesito|hacer)\b/.test(kw)) return 'verb';
    if (/\b(grande|pequeño|rojo|azul|caliente|frío|bonito|feliz)\b/.test(kw)) return 'descriptor';
    if (/\b(hola|gracias|por favor|sí|no|adiós|perdona)\b/.test(kw)) return 'social';
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

  // ── Imagen nueva (celda) ──────────────────────────────────────────────────────

  pickImage(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (await this.toastCtrl.create({
          message: 'La imagen supera 2 MB', duration: 2500, color: 'warning', position: 'top',
        })).present();
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

  // ── OBF / OBZ ────────────────────────────────────────────────────────────────

  async exportOBZ(): Promise<void> {
    if (!this.board) {
      (await this.toastCtrl.create({
        message: 'No hay tablero cargado para exportar.', duration: 2500, color: 'danger', position: 'top',
      })).present();
      return;
    }
    this.isSaving = true;
    try {
      const { boards, warnings } = await this.obfExportSvc.collectLinkedBoards(this.board);
      const { blob, boardCount } = await this.obfExportSvc.buildOBZPackage(this.board, boards);

      const safeName = this.obfExportSvc.makeSafeName(this.board.name);
      const blobUrl  = URL.createObjectURL(blob);
      const anchor   = document.createElement('a');
      anchor.href     = blobUrl;
      anchor.download = `${safeName}.obz`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);

      (await this.toastCtrl.create({
        message: `✓ Exportado como ${safeName}.obz · ${boardCount} tablero(s)`
          + (warnings.length ? ` · ${warnings.length} aviso(s)` : ''),
        duration: 3000, color: 'success', position: 'top',
      })).present();

      if (warnings.length > 0) {
        (await this.alertCtrl.create({
          header:  'Avisos de exportación OBZ',
          message: warnings.map((w) => `• ${w}`).join('\n'),
          buttons: ['Cerrar'],
        })).present();
      }
    } catch (err) {
      console.error('exportOBZ:', err);
      (await this.toastCtrl.create({
        message: 'Error al generar el paquete OBZ.', duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isSaving = false;
    }
  }

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
          (await this.toastCtrl.create({
            message: 'El archivo no contiene JSON válido.', duration: 2500, color: 'danger', position: 'top',
          })).present();
          return;
        }
        await this.processOBFImport(parsed as ObfDocumentOBZ);
      } catch (err) {
        console.error('importOBF error:', err);
        (await this.toastCtrl.create({
          message: 'Error al leer el archivo OBF.', duration: 2500, color: 'danger', position: 'top',
        })).present();
      }
    };
    input.click();
  }

  private async processOBFImport(doc: ObfDocumentOBZ): Promise<void> {
    if (doc.format && doc.format !== 'open-board-0.1') {
      (await this.toastCtrl.create({
        message: `Formato no reconocido: "${doc.format}". Solo se soporta open-board-0.1.`,
        duration: 3000, color: 'danger', position: 'top',
      })).present();
      return;
    }
    if (!Array.isArray(doc.buttons)) {
      (await this.toastCtrl.create({
        message: 'El OBF no contiene un array buttons[] válido.',
        duration: 2500, color: 'danger', position: 'top',
      })).present();
      return;
    }
    const grid = doc.grid;
    if (!grid || typeof grid.rows !== 'number' || typeof grid.columns !== 'number' || !Array.isArray(grid.order)) {
      (await this.toastCtrl.create({
        message: 'El OBF no tiene grid válido (rows, columns, order son obligatorios).',
        duration: 2500, color: 'danger', position: 'top',
      })).present();
      return;
    }

    const isCircularOBF =
      doc.ext_isaac_layout === 'circular' ||
      doc.buttons.some((b) => b.ext_isaac_role === 'center' || b.ext_isaac_role === 'outer');

    if (isCircularOBF) {
      (await this.toastCtrl.create({
        message: 'La importación OBF circular aún no está disponible. Solo se importan tableros de cuadrícula.',
        duration: 4000, color: 'warning', position: 'top',
      })).present();
      return;
    }

    if (!this.board) {
      (await this.toastCtrl.create({
        message: 'No hay tablero activo. Abre un tablero en el editor antes de importar.',
        duration: 2500, color: 'warning', position: 'top',
      })).present();
      return;
    }
    if (this.board.shape === 'circular') {
      (await this.toastCtrl.create({
        message: 'El tablero actual es circular. La importación OBF solo está disponible en tableros de cuadrícula.',
        duration: 3500, color: 'warning', position: 'top',
      })).present();
      return;
    }

    const warnings: string[] = [];
    const images: ObfImageOBZ[] = doc.images ?? [];

    if (images.some((img) => img.path && !img.data && !img.url)) {
      warnings.push('Algunas imágenes usan rutas de ZIP (.obz) y se importarán sin imagen.');
    }
    if (doc.buttons.some((b) => b.load_board)) {
      warnings.push('Hay enlaces a otros tableros (load_board) que no se resolverán en OBF individual.');
    }
    const specialActions = [
      ...new Set(
        doc.buttons
          .map((b) => b.action)
          .filter((a): a is string => !!a && a !== ':ext_isaac_disabled' && a.startsWith(':')),
      ),
    ];
    if (specialActions.length > 0) {
      warnings.push(`Acciones especiales ignoradas: ${specialActions.join(', ')}`);
    }

    const imgMap = new Map<string, string>();
    for (const img of images) {
      const imgId = String(img.id);
      if (img.data) { imgMap.set(imgId, img.data); }
      else if (img.url) { imgMap.set(imgId, img.url); }
      else if (img.path) { imgMap.set(imgId, ''); }
    }

    const btnMap = new Map<string, ObfButtonOBZ>();
    for (const btn of doc.buttons) {
      btnMap.set(String(btn.id), btn);
    }

    const metaByBtnId = new Map<string, Record<string, unknown> | null>();
    const metaFetches = doc.buttons
      .filter((btn) => !btn.background_color && btn.image_id !== undefined && btn.image_id !== null)
      .map(async (btn) => {
        const imgId   = String(btn.image_id);
        const imgUrl  = imgMap.get(imgId) ?? '';
        if (!imgUrl) return;
        const arasaacId = this.obzImportSvc.extractArasaacIdFromUrl(imgUrl);
        if (!arasaacId) return;
        const meta = await this.obzImportSvc.getLocalArasaacMetadata(arasaacId);
        metaByBtnId.set(String(btn.id), meta);
      });
    await Promise.all(metaFetches);

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
        if (!btn) { missingBtns.push(btnId); continue; }

        let imageUrl = '';
        if (btn.image_id !== undefined && btn.image_id !== null) {
          const imgId = String(btn.image_id);
          if (imgMap.has(imgId)) { imageUrl = imgMap.get(imgId) ?? ''; }
          else { missingImgs.push(imgId); }
        }

        const label = btn.label?.trim() || `Pictograma ${btnId}`;
        const sound = btn.vocalization?.trim() || label;

        let color: string;
        let wordType: WordType;
        let fitzgeraldEnabled: boolean;

        if (btn.background_color) {
          color             = this.obzImportSvc.normalizeCssColorToHex(btn.background_color);
          wordType          = 'misc';
          fitzgeraldEnabled = false;
        } else {
          const meta    = metaByBtnId.get(btnId) ?? null;
          const inferred = meta
            ? this.obzImportSvc.inferWordTypeFromLocalArasaacMetadata(meta, label)
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

        const pict: CellPictogram = {
          source: 'custom', id: btnId, label, imageUrl, sound,
          tags: [], description: '', wordType, fitzgeraldEnabled, color,
        };
        const action: CellAction = {
          type: this.obzImportSvc.resolveObzActionType(btn),
          targetBoardId: null,
        };
        cells.push({ row: r, col: c, pictogram: pict, action });
      }
    }

    if (missingBtns.length > 0) {
      warnings.push(`${missingBtns.length} celda(s) con button ID desconocido → importadas vacías.`);
    }
    if (missingImgs.length > 0) {
      warnings.push(`${missingImgs.length} referencia(s) image_id sin imagen → importadas sin imagen.`);
    }

    const importedName = doc.name?.trim() || 'Tablero importado';
    let confirmMsg = `Se reemplazará "${this.board.name}" por "${importedName}" `
      + `(${rows}×${columns}, ${cells.length} celda(s) con pictograma).`;
    if (warnings.length > 0) {
      confirmMsg += '\n\nAvisos:\n' + warnings.map((w) => `• ${w}`).join('\n');
    }

    const alert = await this.alertCtrl.create({
      header: 'Importar OBF',
      message: confirmMsg,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Importar', handler: () => { void this.applyOBFImport(importedName, rows, columns, cells); } },
      ],
    });
    await alert.present();
  }

  private async applyOBFImport(
    name: string, rows: number, columns: number, cells: BoardCell[],
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
      (await this.toastCtrl.create({
        message: `✓ OBF importado: "${name}" · ${cells.length} celda(s)`,
        duration: 2500, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar el tablero importado en el servidor.',
        duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isLoading = false;
    }
  }

  // ── OBZ Import ───────────────────────────────────────────────────────────────

  async importOBZ(): Promise<void> {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = '.obz,.zip,application/zip,application/octet-stream';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      let zip: JSZip;
      try { zip = await JSZip.loadAsync(file); }
      catch {
        (await this.toastCtrl.create({
          message: 'Error al leer el archivo OBZ. ¿Es un ZIP válido?',
          duration: 3000, color: 'danger', position: 'top',
        })).present();
        return;
      }

      // Usar el board guardado como fuente de verdad para usuarios asignados
      const effectiveAssignedUserIds: string[] =
        (this.board?.assignedUserIds ?? []).length
          ? (this.board!.assignedUserIds ?? []).map(String)
          : this.board?.userId
            ? [String(this.board.userId)]
            : [];
      const effectiveUserId = effectiveAssignedUserIds[0] ?? '';

      if (!effectiveUserId) {
        (await this.toastCtrl.create({
          message: 'No hay usuario asignado. Configura el tablero antes de importar.',
          duration: 3000, color: 'warning', position: 'top',
        })).present();
        return;
      }

      this.isLoading = true;
      try {
        const result = await this.obzImportSvc.importOBZ(zip, {
          existingRootBoardId: this.boardId,
          userId:              effectiveUserId,
          assignedUserIds:     effectiveAssignedUserIds,
          contextCreatorId:    this.contextCreatorId || undefined,
        });

        await this.loadBoard();
        this.selectedCell  = null;
        this.isEditingCell = false;
        this.pictForm      = this.emptyPictForm();
        this.actionForm    = { type: 'voice', targetBoardId: '' };

        (await this.toastCtrl.create({
          message: `✓ OBZ importado · ${result.entries.length} tablero(s)`
            + (result.warnings.length > 0 ? ` · ${result.warnings.length} aviso(s)` : ''),
          duration: 3500, color: 'success', position: 'top',
        })).present();

        if (result.warnings.length > 0) {
          (await this.alertCtrl.create({
            header:  'Avisos de importación OBZ',
            message: result.warnings.map(w => `• ${w}`).join('\n'),
            buttons: ['Cerrar'],
          })).present();
        }
      } catch (err) {
        console.error('importOBZ error:', err);
        (await this.toastCtrl.create({
          message: 'Error durante la importación OBZ.', duration: 3000, color: 'danger', position: 'top',
        })).present();
      } finally {
        this.isLoading = false;
      }
    };
    input.click();
  }

  async exportOBF(): Promise<void> {
    if (!this.board) {
      (await this.toastCtrl.create({
        message: 'No hay tablero cargado para exportar.', duration: 2500, color: 'danger', position: 'top',
      })).present();
      return;
    }
    try {
      const obf   = this.obfExportSvc.buildOBF(this.board, '', this.userBoards);
      const error = this.obfExportSvc.validateOBF(obf);
      if (error) {
        (await this.toastCtrl.create({
          message: `OBF inválido: ${error}`, duration: 3000, color: 'danger', position: 'top',
        })).present();
        return;
      }
      const json     = JSON.stringify(obf, null, 2);
      const blob     = new Blob([json], { type: 'application/json' });
      const blobUrl  = URL.createObjectURL(blob);
      const safeName = this.obfExportSvc.makeSafeName(this.board.name);
      const anchor   = document.createElement('a');
      anchor.href     = blobUrl;
      anchor.download = `${safeName}.obf`;
      anchor.click();
      URL.revokeObjectURL(blobUrl);
      (await this.toastCtrl.create({
        message: `✓ Exportado como ${safeName}.obf`, duration: 2500, color: 'success', position: 'top',
      })).present();
    } catch (err) {
      console.error('exportOBF:', err);
      (await this.toastCtrl.create({
        message: 'Error al generar el archivo OBF.', duration: 2500, color: 'danger', position: 'top',
      })).present();
    }
  }

  // ── Añadir al perfil ─────────────────────────────────────────────────────────

  async addToProfile(): Promise<void> {
    if (!this.board) return;

    const defName  = this.board.profileName  || this.board.name;
    const defDesc  = this.board.profileDescription || '';
    const defImage = this.board.profileImage || this.board.imageUrl || '';

    const alert = await this.alertCtrl.create({
      header:  'Añadir al perfil',
      message: 'Este tablero aparecerá en el perfil del usuario asignado.',
      inputs: [
        {
          name: 'profileName', type: 'text', value: defName,
          placeholder: 'Nombre visible', attributes: { maxlength: 60 },
        },
        {
          name: 'profileDescription', type: 'textarea', value: defDesc,
          placeholder: 'Descripción breve (opcional)', attributes: { maxlength: 200, rows: 2 },
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
                message: '✓ Tablero añadido al perfil del usuario',
                duration: 2500, color: 'success', position: 'top',
              })).present();
            } catch {
              (await this.toastCtrl.create({
                message: 'Error al actualizar el perfil.', duration: 2500, color: 'danger', position: 'top',
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
        message: 'Tablero eliminado del perfil', duration: 2000, color: 'medium', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al actualizar el perfil.', duration: 2000, color: 'danger', position: 'top',
      })).present();
    }
  }

  // ── Getters de estado ─────────────────────────────────────────────────────────

  /** true cuando el tablero está asignado a más de un usuario. */
  get isSharedBoard(): boolean {
    return (this.board?.assignedUserIds?.length ?? 1) > 1;
  }

  get canAddToProfile(): boolean {
    return (this.board?.boardRole ?? 'main') === 'main' && !!this.board?.userId;
  }

  get isInProfile(): boolean {
    return !!this.board?.visibleInProfile;
  }

  get isCircular(): boolean {
    return this.board?.shape === 'circular';
  }

  get hasSelectedCell(): boolean {
    return !!this.selectedCell;
  }

  get previewBoardName(): string {
    return this.board?.name ?? '';
  }

  /** Solo tableros del mismo shape que el actual (para el selector de navegación). */
  get sameShapeBoards(): Board[] {
    const shape = this.board?.shape ?? 'grid';
    return this.userBoards.filter((b) => (b.shape ?? 'grid') === shape);
  }

  // ── Helpers de formulario ─────────────────────────────────────────────────────

  get fitzgeraldColor(): string {
    if (!this.pictForm.fitzgeraldEnabled) return this.pictForm.color || '#f5f5f5';
    return FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5';
  }

  get fitzgeraldBgColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 20%, white)`;
  }

  get fitzgeraldBorderColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 55%, white)`;
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(url, this.sanitizer);
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  openBoard(boardId: string): void {
    if (!boardId) return;
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: {
        returnTo:    this.returnTo,
        creatorId:   this.contextCreatorId   || undefined,
        creatorName: this.contextCreatorName || undefined,
      },
    });
  }

  goBack(): void {
    this.router.navigate([this.returnTo], {
      queryParams: {
        creatorId:   this.contextCreatorId   || undefined,
        creatorName: this.contextCreatorName || undefined,
      },
    });
  }

  async navigateToCreateBoard(): Promise<void> {
    if (!this.selectedCell) {
      const t = await this.toastCtrl.create({
        message:  'Selecciona primero la celda que tendrá la acción de navegación.',
        duration: 2500, color: 'warning', position: 'top',
      });
      t.present();
      return;
    }

    this.router.navigate(['/board-builder-create'], {
      queryParams: {
        returnTo:          this.router.url,
        sourceBoardId:     this.boardId,
        assignedUserIds:   (this.board?.assignedUserIds ?? []).join(','),
        lockAssignedUsers: 'true',
        boardRole:         'secondary',
        lockBoardRole:     'true',
        shape:             this.board?.shape ?? 'grid',
        creatorId:         this.contextCreatorId   || undefined,
        creatorName:       this.contextCreatorName || undefined,
        linkBack:          'true',
        sourceCellRow:     this.selectedCell.row,
        sourceCellCol:     this.selectedCell.col,
        sourceActionType:  this.actionForm.type,
      },
    });
  }

  onActionTypeSelect(event: Event): void {
    this.actionForm.type = (event as CustomEvent<{ value: ActionType }>).detail.value;
  }

  onTargetBoardSelect(event: Event): void {
    this.actionForm.targetBoardId = (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  // ── Link-back ────────────────────────────────────────────────────────────────

  private async applyLinkedBoard(): Promise<void> {
    if (!this.pendingLinkBoardId || this.pendingLinkRow < 0 || this.pendingLinkCol < 0) return;
    if (!this.board) return;

    const row              = this.pendingLinkRow;
    const col              = this.pendingLinkCol;
    const newTargetBoardId = this.pendingLinkBoardId;
    const actionType       = (this.pendingLinkActionType as ActionType) || 'navigate';

    this.pendingLinkBoardId    = '';
    this.pendingLinkRow        = -1;
    this.pendingLinkCol        = -1;
    this.pendingLinkActionType = '';

    const existingPict = this.getCellData(row, col)?.pictogram ?? null;

    try {
      const res = await firstValueFrom(
        this.boardSvc.updateCell(this.boardId, {
          row, col,
          pictogram: existingPict,
          action: { type: actionType, targetBoardId: newTargetBoardId },
        }),
      );
      this.board = res.board;
      this.loadUserBoards(this.board.assignedUserIds ?? []);
      this.highlightedBoardId = newTargetBoardId;
      setTimeout(() => {
        document.getElementById('board-item-' + newTargetBoardId)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 250);
      setTimeout(() => {
        if (this.highlightedBoardId === newTargetBoardId) { this.highlightedBoardId = ''; }
      }, 5000);
      const t = await this.toastCtrl.create({
        message: '✓ Tablero creado y enlazado a la celda', duration: 2200, color: 'success', position: 'top',
      });
      t.present();
    } catch {
      const t = await this.toastCtrl.create({
        message: 'Error al enlazar el nuevo tablero a la celda.', duration: 3000, color: 'danger', position: 'top',
      });
      t.present();
    } finally {
      this.clearLinkParams();
    }
  }

  private clearLinkParams(): void {
    this.router.navigate([], {
      relativeTo:          this.route,
      queryParamsHandling: 'merge',
      queryParams: {
        linkCreatedBoard:          null,
        newlyCreatedTargetBoardId: null,
        sourceCellRow:             null,
        sourceCellCol:             null,
        sourceActionType:          null,
      },
      replaceUrl: true,
    });
  }

  // ── Circular preview helpers ─────────────────────────────────────────────────

  get circularCenterPict(): CellPictogram | null {
    return this.getCellPict(0, -1);
  }

  get isCenterShowingLastPhrase(): boolean {
    return !!this.getCellData(0, -1)?.action?.showLastPhrase;
  }

  get isCenterSelected(): boolean {
    return this.selectedCell?.row === 0 && this.selectedCell?.col === -1;
  }

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

  handleCircularPreviewClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    const type = cell.action?.type ?? 'voice';
    if (type === 'voice' || type === 'voice+navigate') {
      this.aacPhrase.push({ ...cell.pictogram });
    }

    if (cell.action?.aiGeneratedBoardTarget) {
      this.circularSimCenter = { ...cell.pictogram };
      this.circularSimMode = true;
      return;
    }

    if (type === 'navigate' || type === 'voice+navigate') {
      const targetId = cell.action.targetBoardId;
      if (targetId) {
        this.boardId = targetId;
        this.circularSimMode = false;
        this.circularSimCenter = null;
        this.loadBoard();
      }
    }
  }

  circularSimReset(): void {
    this.circularSimMode = false;
    this.circularSimCenter = null;
  }

  // ── Helpers internos ─────────────────────────────────────────────────────────

  private emptyPictForm(): PictForm {
    return {
      source: 'new', id: '', label: '', sound: '', imageUrl: '',
      tags: '', description: '', wordType: 'misc',
      fitzgeraldEnabled: true, color: '#f5f5f5',
    };
  }
}
