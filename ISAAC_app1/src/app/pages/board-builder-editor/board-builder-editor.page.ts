import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { NgClass } from '@angular/common';
import { IonicModule, ToastController, AlertController } from '@ionic/angular';
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
import { WordType, FITZGERALD } from '../../shared/constants/fitzgerald';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { ObfExportService } from '../../services/obf-export.service';
import { BoardPdfExportService } from '../../services/board-pdf-export.service';
import {
  ObzImportService,
  ObfButtonOBZ,
  ObfDocumentOBZ,
  ObfImageOBZ,
} from '../../services/obz-import.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { BoardGridComponent } from '../../components/board-grid/board-grid.component';
import { BoardCircularComponent } from '../../components/board-circular/board-circular.component';
import { BoardPreviewContainerComponent } from '../../components/board-preview-container/board-preview-container.component';
import {
  BoardSidebarLeftComponent,
  BoardSidebarConfig,
} from '../../components/board-sidebar-left/board-sidebar-left.component';
import { BoardEditorToolbarComponent } from '../../components/board-editor-toolbar/board-editor-toolbar.component';
import {
  BoardCellPanelComponent,
  CellPanelSavePayload,
  CellPanelCreateBoardPayload,
} from '../../components/board-cell-panel/board-cell-panel.component';
import { MultiboardEditorComponent } from '../../components/multiboard-editor/multiboard-editor.component';
import { MultiboardCommunicatorComponent } from '../../components/multiboard-communicator/multiboard-communicator.component';
import { AacControlsBarComponent } from '../../components/aac-controls-bar/aac-controls-bar.component';
import { IaPredictorColumnComponent } from '../../components/ia-predictor-column/ia-predictor-column.component';

@Component({
  selector: 'app-board-builder-editor',
  templateUrl: './board-builder-editor.page.html',
  styleUrls: ['./board-builder-editor.page.scss'],
  standalone: true,
  imports: [
    IonicModule,
    NgClass,
    LoadingErrorStateComponent,
    BoardGridComponent,
    BoardCircularComponent,
    BoardPreviewContainerComponent,
    BoardSidebarLeftComponent,
    BoardEditorToolbarComponent,
    BoardCellPanelComponent,
    MultiboardEditorComponent,
    MultiboardCommunicatorComponent,
    AacControlsBarComponent,
    IaPredictorColumnComponent,
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
  /** Suscripción a boardNavigated$ activa en modo preview (gestiona Back y navigate). */
  private previewNavSub?: Subscription;

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
    locationSlots: 6, assignedUserIds: [], autoPersonalize: false,
  };
  /** Configuración de la barra AAC del tablero actual (solo main). */
  get currentControlsConfig() { return this.board?.controlsConfig; }

  /** Config en tiempo real desde el sidebar (antes de guardar). */
  previewControlsConfig: import('../../services/board.service').ControlsConfig | undefined;
  /** true = la preview de la barra AAC está colapsada en el editor. */
  controlsBarPreviewCollapsed = false;

  onControlsConfigChange(cfg: import('../../services/board.service').ControlsConfig): void {
    this.previewControlsConfig = cfg;
  }
  /** true mientras se procesa el guardado de configuración del tablero. */
  sidebarSaving = false;

  // ── Vista previa ─────────────────────────────────────────────────────────────
  previewMode = false;

  // ── Celda seleccionada ───────────────────────────────────────────────────────
  /** Posición de la celda activa. Siempre nuevo objeto → ngOnChanges en el panel. */
  selectedCell: { row: number; col: number } | null = null;
  /** Datos actuales de la celda (pictograma + acción), pasados al panel. */
  cellData:     BoardCell | null = null;
  isEditingCell = false;

  // ── Drag and drop ────────────────────────────────────────────────────────────
  draggedCell:  { row: number; col: number } | null = null;
  dragOverCell: { row: number; col: number } | null = null;

  // ── Modo mover táctil ─────────────────────────────────────────────────────────
  moveSrcCell: { row: number; col: number } | null = null;

  // ── Simulación circular en preview ───────────────────────────────────────────
  circularSimMode = false;
  circularSimCenter: CellPictogram | null = null;

  // ── Datos del sidebar y panel de celda ───────────────────────────────────────
  userBoards: Board[] = [];
  allCreatorBoards: Board[] = [];
  userBoardsLoading = false;
  boardsReady = false;
  highlightedBoardId = '';

  centerUsers: BackendUser[] = [];

  // ── Estado del multitablero ──────────────────────────────────────────────────
  /** ID del hueco seleccionado en el editor multi (1-based). */
  selectedSlotId: number | null = null;
  /** Tableros disponibles para asignar a huecos (solo boardRole=main). */
  mainBoards: Board[] = [];
  /** Modo del panel derecho en el editor multi. */
  multiPanelMode: 'pictogram' | 'tablero' = 'pictogram';

  /** Boards cargados para cada slot: Map<slotId → {board, isLoading}>. */
  slotBoardData = new Map<number, { board: Board | null; isLoading: boolean }>();
  /** Slot al que pertenece la celda actualmente seleccionada (null = tablero maestro). */
  activeCellSlotId: number | null = null;
  /** Board ID del slot activo para guardar celdas (puede diferir de this.boardId). */
  activeCellBoardId = '';

  // Pictogramas personales (cargados aquí, pasados como @Input al panel)
  personalPicts: BackendPictogram[] = [];
  personalLoading = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authSvc: AuthService,
    private userSvc: UserService,
    private boardSvc: BoardService,
    private toastCtrl: ToastController,
    private alertCtrl: AlertController,
    private aacRuntime: AacRuntimeService,
    private obfExportSvc: ObfExportService,
    private obzImportSvc: ObzImportService,
    private boardLayoutSvc: BoardLayoutService,
    private boardPdfExportSvc: BoardPdfExportService,
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
    this.previewNavSub?.unsubscribe();
    document.removeEventListener('pointermove', this._boundColMove);
    document.removeEventListener('pointerup',   this._boundColUp);
    document.removeEventListener('pointermove', this._boundRowMove);
    document.removeEventListener('pointerup',   this._boundRowUp);
  }

  ionViewWillEnter() {
    this.updateBoardAspectRatio();
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
      if (this.isMultiBoard) {
        this.slotBoardData.clear();
        this.activeCellSlotId  = null;
        this.activeCellBoardId = '';
        this.editingProportions = false;
        this.initProportions();
        this.loadMainBoards();
        void this.loadSlotBoards();
      }
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
      autoPersonalize: b.autoPersonalize ?? false,
      controlsConfig: b.controlsConfig
        ? { visibleButtons: [...b.controlsConfig.visibleButtons], order: [...b.controlsConfig.order] }
        : undefined,
    };
  }

  private async loadUserBoards(assignedUserIds: string[]): Promise<void> {
    this.userBoardsLoading = true;
    this.boardsReady = false;
    const creatorId = this.contextCreatorId || this.authSvc.getCurrentUser()?.id || '';
    try {
      const [targetsRes, creatorRes] = await Promise.all([
        assignedUserIds.length > 0
          ? firstValueFrom(this.boardSvc.getAvailableTargets(assignedUserIds))
          : Promise.resolve({ boards: [] as Board[] }),
        creatorId
          ? firstValueFrom(this.boardSvc.getBoardsByCreator(creatorId))
          : Promise.resolve({ boards: [] as Board[] }),
      ]);
      this.userBoards       = targetsRes.boards.filter(b => b._id !== this.boardId);
      this.allCreatorBoards = creatorRes.boards;
    } catch {
      /* silencioso */
    } finally {
      this.userBoardsLoading = false;
      this.boardsReady = true;
    }
  }

  private async loadPersonalPicts(userId: string): Promise<void> {
    if (!userId || this.isSharedBoard) {
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

    // En modo multitablero, operar sobre el board del slot activo
    const activeBoard = (this.isMultiBoard && this.activeCellSlotId != null)
      ? this.getSlotBoard(this.activeCellSlotId)
      : this.board;
    if (!activeBoard) return;

    const targetBoardId = (this.isMultiBoard && this.activeCellBoardId)
      ? this.activeCellBoardId
      : this.boardId;

    const srcCellData = this.boardLayoutSvc.getCellData(activeBoard, srcRow, srcCol);
    const dstCellData = this.boardLayoutSvc.getCellData(activeBoard, dstRow, dstCol);
    if (!srcCellData?.pictogram) return;

    const srcPict   = srcCellData.pictogram;
    const srcAction = srcCellData.action   ?? { type: 'voice' as ActionType, targetBoardId: null };
    const dstPict   = dstCellData?.pictogram ?? null;
    const dstAction = dstCellData?.action   ?? { type: 'voice' as ActionType, targetBoardId: null };

    const newCells: BoardCell[] = activeBoard.cells.filter(
      (c) => !(c.row === srcRow && c.col === srcCol) &&
             !(c.row === dstRow && c.col === dstCol),
    );
    newCells.push({ row: dstRow, col: dstCol, pictogram: srcPict, action: srcAction });
    if (dstPict) {
      newCells.push({ row: srcRow, col: srcCol, pictogram: dstPict, action: dstAction });
    }

    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(targetBoardId, { cells: newCells }),
      );
      if (this.isMultiBoard && this.activeCellSlotId != null) {
        this.slotBoardData.set(this.activeCellSlotId, { board: res.board, isLoading: false });
      } else {
        this.board = res.board;
      }
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
      if (this.isMultiBoard && this.activeCellSlotId != null && this.activeCellBoardId) {
        await this.loadSlotBoard(this.activeCellSlotId, this.activeCellBoardId);
      } else {
        await this.loadBoard();
      }
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

    // Siempre nuevo objeto → ngOnChanges del panel detecta el cambio
    this.selectedCell = { row, col };
    const existing    = this.getCellData(row, col);
    this.cellData     = existing;
    this.isEditingCell = !!existing?.pictogram;
  }

  // ── Guardar/eliminar celda (delegado desde BoardCellPanelComponent) ───────────

  /**
   * El panel construye el payload (CellPictogram + CellAction) y lo emite.
   * La page valida la coherencia de shapes, ejecuta el side-effect de librería
   * personal si corresponde, y llama a boardSvc.updateCell().
   */
  async onSaveCellRequest(payload: CellPanelSavePayload): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    // En modo multitablero, guardar en el board del slot activo
    const targetBoardId = (this.isMultiBoard && this.activeCellBoardId)
      ? this.activeCellBoardId
      : this.boardId;

    // Validar coherencia de shapes para acciones de navegación
    if (
      (payload.action.type === 'navigate' || payload.action.type === 'voice+navigate') &&
      payload.action.targetBoardId
    ) {
      const target = this.userBoards.find(b => b._id === payload.action.targetBoardId)
                  ?? this.allCreatorBoards.find(b => b._id === payload.action.targetBoardId);
      if (target && (target.shape ?? 'grid') !== (this.board.shape ?? 'grid')) {
        (await this.toastCtrl.create({
          message:  'No se pueden enlazar tableros de distinto tipo.',
          duration: 2800, color: 'danger', position: 'top',
        })).present();
        return;
      }
    }

    // Si el destino es un secundario sin usuarios asignados y el tablero actual tiene
    // assignedUserIds, propagar recursivamente antes de guardar la celda.
    const isNavOrSlot =
      payload.action.type === 'navigate'       || payload.action.type === 'voice+navigate' ||
      payload.action.type === 'setSlot'        || payload.action.type === 'voice+setSlot';
    if (
      isNavOrSlot &&
      payload.action.targetBoardId &&
      (this.board.assignedUserIds?.length ?? 0) > 0 &&
      this.boardsUnassigned.some(b => b._id === payload.action.targetBoardId)
    ) {
      try {
        const inheritRes = await firstValueFrom(
          this.boardSvc.inheritAssignedUsers(
            payload.action.targetBoardId,
            this.board.assignedUserIds!,
          ),
        );
        if (inheritRes.conflicts?.length > 0) {
          const names = inheritRes.conflicts.map(c => `• ${c.name}`).join('\n');
          (await this.alertCtrl.create({
            header:  'Conflicto de usuarios',
            message: `Algunos tableros conectados ya tienen usuarios distintos asignados y no pueden heredar el contexto actual:\n\n${names}`,
            buttons: ['Aceptar'],
          })).present();
          return;
        }
        // Recargar tableros para reflejar los cambios de assignedUserIds
        void this.loadUserBoards(this.board.assignedUserIds!);
      } catch {
        (await this.toastCtrl.create({
          message:  'Error al asignar usuarios a los tableros secundarios.',
          duration: 2500, color: 'danger', position: 'top',
        })).present();
        return;
      }
    }

    // Side-effect: guardar imagen nueva en la librería personal del usuario
    if (payload.pictogram.source === 'new' && !this.isSharedBoard) {
      try {
        const addPayload: AddPictogramPayload = {
          id:          'bb-' + Date.now(),
          label:       payload.pictogram.label,
          imageUrl:    payload.pictogram.imageUrl,
          wordType:    payload.pictogram.wordType,
          description: payload.pictogram.description,
        };
        await firstValueFrom(this.userSvc.addPictogramToUser(this.board.userId, addPayload));
        this.loadPersonalPicts(this.board.userId);
      } catch {
        /* no crítico */
      }
    }

    const wasEditing = this.isEditingCell;
    this.isSaving = true;
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateCell(targetBoardId, {
          row:       this.selectedCell.row,
          col:       this.selectedCell.col,
          pictogram: payload.pictogram,
          action:    payload.action,
        }),
      );
      // En multi, actualizar el board del slot; en normal, actualizar this.board
      if (this.isMultiBoard && this.activeCellSlotId != null) {
        this.slotBoardData.set(this.activeCellSlotId, { board: res.board, isLoading: false });
      } else {
        this.board = res.board;
      }
      this.isEditingCell = true;
      // Actualizar cellData para que el panel refleje los datos guardados
      this.cellData = this.getCellData(this.selectedCell.row, this.selectedCell.col);
      (await this.toastCtrl.create({
        message:  wasEditing ? '✓ Pictograma actualizado' : '✓ Pictograma añadido',
        duration: 1800, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message:  'Error al guardar el pictograma.',
        duration: 2500, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.isSaving = false;
    }
  }

  /** Recibe el evento del panel, lanza alert de confirmación y llama a la API. */
  async onRemoveCellRequest(): Promise<void> {
    if (!this.selectedCell || !this.board) return;
    const removeBoardId = (this.isMultiBoard && this.activeCellBoardId)
      ? this.activeCellBoardId : this.boardId;
    const alert = await this.alertCtrl.create({
      header:  'Eliminar pictograma',
      message: '¿Quieres vaciar esta celda?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            try {
              const res = await firstValueFrom(
                this.boardSvc.updateCell(removeBoardId, {
                  row:       this.selectedCell!.row,
                  col:       this.selectedCell!.col,
                  pictogram: null,
                }),
              );
              if (this.isMultiBoard && this.activeCellSlotId != null) {
                this.slotBoardData.set(this.activeCellSlotId, { board: res.board, isLoading: false });
              } else {
                this.board = res.board;
              }
              this.isEditingCell = false;
              this.cellData      = null;
            } catch {
              (await this.toastCtrl.create({
                message:  'Error al eliminar.',
                duration: 2000, color: 'danger', position: 'top',
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
      // Para multitablero: no modificar rows/columns/cells del tablero maestro.
      // Sus celdas viven en los tableros hijo y su grid 1×1 no debe filtrarse.
      const isMulti      = this.isMultiBoard;
      const isLegacyMulti = this.board.boardRole === 'multi'; // boards viejos: boardRole=multi

      const remainingCells = isMulti
        ? this.board.cells
        : this.isCircular
          ? this.board.cells
          : this.board.cells.filter((c) => c.row < payload.rows && c.col < payload.cols);

      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, {
          name:                  payload.name,
          imageUrl:              payload.imageB64 ?? '',
          userId:                payload.assignedUserIds[0] || undefined,
          assignedUserIds:       payload.assignedUserIds,
          predictorEnabled:      payload.predictor,
          aiRewriteEnabled:      payload.aiRewrite,
          iaRows:                payload.iaRows,
          iaCols:                payload.iaCols,
          autoPersonalize:       payload.autoPersonalize,
          cells:                 remainingCells,
          // boardRole: los boards legados (boardRole=multi) no lo modificamos;
          // los nuevos multi (shape=multi) y los normales sí admiten cambio.
          ...(!isLegacyMulti && { boardRole: payload.boardRole }),
          // controlsConfig: solo para tableros principales
          ...(payload.boardRole === 'main' && payload.controlsConfig
            ? { controlsConfig: payload.controlsConfig } : {}),
          // Dimensiones solo para tableros normales (no multi):
          ...(!isMulti && {
            rows:                  payload.rows,
            columns:               payload.cols,
            circleSlots:           payload.circleSlots,
            locationColumnEnabled: payload.locationEnabled,
            locationColumnSlots:   payload.locationSlots,
          }),
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
      this.selectedCell = null;
      this.moveSrcCell  = null;
      this.circularSimMode = false;
      this.circularSimCenter = null;
      void this.aacRuntime.startSession(
        '', this.boardId, 'preview', false,
        this.board?.controlsConfig,
        !!this.board?.predictorEnabled,
        this.board?.iaRows ?? 5,
        this.board?.iaCols ?? 1,
        !!this.board?.aiRewriteEnabled,
      );

      // Suscripción a boardNavigated$ para gestionar Back y navigate en preview.
      // Funciona tanto en tablero normal como en multitablero.
      this.previewNavSub = this.aacRuntime.boardNavigated$.subscribe((newBoardId) => {
        this.boardId = newBoardId;
        this.circularSimMode   = false;
        this.circularSimCenter = null;
        void this.loadBoard();
      });
    } else {
      this.previewNavSub?.unsubscribe();
      this.previewNavSub = undefined;
      this.aacRuntime.reset();
    }
  }

  // ── Handlers para la barra AAC en preview ─────────────────────────────────

  onPreviewHome(): void {
    this.togglePreview(); // salir del modo preview
  }

  onPreviewBack(): void {
    if (this.aacRuntime.boardStack.length > 0) {
      this.aacRuntime.goBack(); // emite boardNavigated$ → previewNavSub carga el tablero
    }
  }

  get canGoBackInPreview(): boolean {
    return this.aacRuntime.boardStack.length > 0;
  }

  // ── Clicks en celdas durante preview ──────────────────────────────────────

  private handlePreviewCellClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    // El servicio gestiona voz, frase y navigate (emite boardNavigated$).
    // La navegación real la hace previewNavSub.
    this.aacRuntime.handlePictogramPress(cell, this.boardId);
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

  async exportPdf(): Promise<void> {
    if (!this.board) {
      (await this.toastCtrl.create({
        message: 'No hay tablero cargado para exportar.', duration: 2500, color: 'danger', position: 'top',
      })).present();
      return;
    }
    this.isSaving = true;
    try {
      await this.boardPdfExportSvc.exportToPdf(this.board);
      (await this.toastCtrl.create({
        message: `✓ PDF generado: ${this.board.name}`,
        duration: 2500, color: 'success', position: 'top',
      })).present();
    } catch (err) {
      console.error('exportPdf:', err);
      (await this.toastCtrl.create({
        message: 'Error al generar el PDF.', duration: 2500, color: 'danger', position: 'top',
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
            ? this.obzImportSvc.inferWordTypeFromLocalArasaacMetadata(meta)
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
      this.selectedCell  = null;
      this.cellData      = null;
      this.isEditingCell = false;
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
        this.cellData      = null;
        this.isEditingCell = false;

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
              const currentAssignedIds = (this.board!.assignedUserIds ?? [])
                .map(String).filter(Boolean);
              const res = await firstValueFrom(
                this.boardSvc.updateBoard(this.boardId, {
                  visibleInProfile:   true,
                  profileName:        data.profileName?.trim() || this.board!.name,
                  profileDescription: data.profileDescription?.trim() || '',
                  profileImage:       defImage,
                  // Garantiza que assignedUserIds esté correcto en el momento de publicar
                  ...(currentAssignedIds.length > 0 && {
                    assignedUserIds: currentAssignedIds,
                    userId:          currentAssignedIds[0],
                  }),
                }),
              );
              this.board = res.board;
              // Personalización automática: comprueba cuántos pictogramas coincidirán
              // La sustitución real ocurre en tiempo de carga (por usuario, no en DB)
              if (this.board.autoPersonalize) {
                try {
                  const pRes = await firstValueFrom(
                    this.boardSvc.applyPersonalization(this.boardId),
                  );
                  let msg: string;
                  if (pRes.reason === 'no_pictograms') {
                    msg = '✓ Publicado · El usuario aún no tiene pictogramas personales. Añádelos desde su perfil para activar la personalización.';
                  } else if (pRes.cellsReplaced === 0) {
                    msg = '✓ Publicado · Sin coincidencias: ningún label del tablero coincide con los pictogramas personales del usuario.';
                  } else {
                    msg = `✓ Publicado · ${pRes.cellsReplaced} pictograma(s) se personalizarán automáticamente en ${pRes.boardsProcessed} tablero(s)`;
                  }
                  (await this.toastCtrl.create({
                    message: msg,
                    duration: 4000,
                    color: pRes.cellsReplaced > 0 ? 'success' : 'warning',
                    position: 'top',
                  })).present();
                } catch {
                  (await this.toastCtrl.create({
                    message: '✓ Publicado · Error al verificar personalización automática.',
                    duration: 3000, color: 'warning', position: 'top',
                  })).present();
                }
              } else {
                (await this.toastCtrl.create({
                  message: '✓ Tablero añadido al perfil del usuario',
                  duration: 2500, color: 'success', position: 'top',
                })).present();
              }
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

  // ── Getters y métodos del multitablero ───────────────────────────────────────

  // ── Aspect ratio del comunicador real ────────────────────────────────────────
  /** Ratio W/H del área de tablero en el comunicador (para la preview del editor). */
  boardAspectRatio = 'auto';

  @HostListener('window:resize')
  onWindowResize(): void { this.updateBoardAspectRatio(); }

  private updateBoardAspectRatio(): void {
    // Ratio del área de tablero en el comunicador/preview: vw / (vh - toolbar - AACbar)
    // 56px = toolbar Ionic, 80px = min-height barra AAC (acb-root).
    const w = window.innerWidth;
    const h = window.innerHeight - 136;
    this.boardAspectRatio = h > 0 ? `${w} / ${h}` : 'auto';
  }

  get isMultiBoard(): boolean {
    // shape==='multi' para boards nuevos; boardRole==='multi' para boards legados.
    return this.board?.shape === 'multi' || this.board?.boardRole === 'multi';
  }

  /** Muestra el slot predictor en el editor de multitablero. */
  get showMultiPredictor(): boolean {
    return this.isMultiBoard && !!this.board?.predictorEnabled;
  }

  get multiPredictorIaRows(): number { return this.board?.iaRows ?? 5; }
  get multiPredictorIaCols(): number { return this.board?.iaCols ?? 1; }

  /** Ancho proporcional del slot predictor en el editor multitablero (6.5% por columna). */
  get multiPredictorSlotWidth(): string {
    return `${this.multiPredictorIaCols * 6.5}%`;
  }

  /** Tableros main disponibles para asignar a slots (excluye el propio multitablero). */
  get slotsAvailableBoards(): Board[] {
    return this.mainBoards.filter((b) => b._id !== this.boardId);
  }

  // ── Proporciones de los huecos ────────────────────────────────────────────────

  /** Anchos actuales de columnas (%), suma = 100. */
  slotWidths:  number[] = [];
  /** Altos actuales de filas (%), suma = 100. Solo usado para 4 huecos. */
  slotHeights: number[] = [];
  /** true = modo "Editar proporciones" visible (controles táctiles/sliders). */
  editingProportions = false;
  /** true mientras se guarda el layout. */
  savingLayout = false;

  /** Estado local para editar el tamaño del minitablero actualmente activo. */
  slotGridRows        = 3;
  slotGridCols        = 4;
  slotGridCircleSlots = 8;
  savingSlotGrid      = false;

  private readonly MIN_PCT = 15;    // mínimo % por slot
  private resizingCol: number | null = null;
  private resizingRow: number | null = null;
  private resizeStartX = 0;
  private resizeStartY = 0;
  private resizeContainerW = 0;
  private resizeContainerH = 0;
  private resizeWidthsSnap:  number[] = [];
  private resizeHeightsSnap: number[] = [];

  // Referencias bound para poder pasar removeEventListener el mismo puntero de función
  private readonly _boundColMove = (e: PointerEvent) => this.onColHandleMove(e);
  private readonly _boundColUp   = (e: PointerEvent) => this.onColHandleUp(e);
  private readonly _boundRowMove = (e: PointerEvent) => this.onRowHandleMove(e);
  private readonly _boundRowUp   = (e: PointerEvent) => this.onRowHandleUp(e);

  private initProportions(): void {
    const count = this.board?.slotCount ?? 2;
    const saved  = this.board?.multiBoardLayout;

    if (count === 4) {
      this.slotWidths  = this.normalizeArr(saved?.widths,  2);
      this.slotHeights = this.normalizeArr(saved?.heights, 2);
    } else {
      this.slotWidths  = this.normalizeArr(saved?.widths, count);
      this.slotHeights = [100];
    }
  }

  private normalizeArr(arr: number[] | undefined, n: number): number[] {
    if (arr && arr.length === n && arr.every(v => v > 0)) {
      const total = arr.reduce((a, b) => a + b, 0);
      return arr.map(v => Math.round(v / total * 100));
    }
    const each = Math.floor(100 / n);
    const result = Array<number>(n).fill(each);
    result[n - 1] = 100 - each * (n - 1);
    return result;
  }

  /** CSS flex values para las columnas de un slot (pasado como [style.flex]). */
  slotFlexCol(slotId: number): number {
    // slotId 1-based; columna: (slotId-1) % cols
    const cols = this.board?.slotCount === 4 ? 2 : (this.board?.slotCount ?? 2);
    const col  = (slotId - 1) % cols;
    return this.slotWidths[col] ?? 1;
  }

  /** CSS flex values para las filas (pasado como [style.flex]). */
  slotFlexRow(rowIdx: number): number {
    return this.slotHeights[rowIdx] ?? 1;
  }

  /** Número de filas del layout. */
  get rowCount(): number {
    return this.board?.slotCount === 4 ? 2 : 1;
  }

  /** Número de columnas del layout. */
  get colCount(): number {
    return this.board?.slotCount === 4 ? 2 : (this.board?.slotCount ?? 2);
  }

  /** slotIds agrupados por fila [[1,2],[3,4]] o [[1,2]] etc. */
  get slotsByRow(): number[][] {
    const count = this.board?.slotCount ?? 2;
    if (count === 4) return [[1, 2], [3, 4]];
    return [Array.from({ length: count }, (_, i) => i + 1)];
  }

  // ── Resize handles — desktop (pointer events) ─────────────────────────────

  onColHandleDown(event: PointerEvent, handleIdx: number): void {
    event.preventDefault();
    this.resizingCol      = handleIdx;
    this.resizeStartX     = event.clientX;
    this.resizeWidthsSnap = [...this.slotWidths];
    const container = (event.target as HTMLElement).closest('.bbe-multi-row') as HTMLElement;
    this.resizeContainerW = container?.offsetWidth ?? 800;
    document.addEventListener('pointermove', this._boundColMove);
    document.addEventListener('pointerup',   this._boundColUp);
  }

  onColHandleMove(event: PointerEvent): void {
    if (this.resizingCol == null) return;
    const dx   = event.clientX - this.resizeStartX;
    const dpct = (dx / this.resizeContainerW) * 100;
    const idx  = this.resizingCol;
    const a    = Math.max(this.MIN_PCT, Math.min(100 - this.MIN_PCT, this.resizeWidthsSnap[idx]     + dpct));
    const b    = Math.max(this.MIN_PCT, Math.min(100 - this.MIN_PCT, this.resizeWidthsSnap[idx + 1] - dpct));
    const newWidths = [...this.resizeWidthsSnap];
    newWidths[idx]     = Math.round(a);
    newWidths[idx + 1] = Math.round(b);
    this.slotWidths = newWidths;
  }

  onColHandleUp(_event: PointerEvent): void {
    if (this.resizingCol == null) return;
    this.resizingCol = null;
    document.removeEventListener('pointermove', this._boundColMove);
    document.removeEventListener('pointerup',   this._boundColUp);
    void this.saveLayout();
  }

  onRowHandleDown(event: PointerEvent): void {
    event.preventDefault();
    this.resizingRow      = 0;
    this.resizeStartY     = event.clientY;
    this.resizeHeightsSnap = [...this.slotHeights];
    const container = (event.target as HTMLElement).closest('.bbe-multi-grids') as HTMLElement;
    this.resizeContainerH = container?.offsetHeight ?? 600;
    document.addEventListener('pointermove', this._boundRowMove);
    document.addEventListener('pointerup',   this._boundRowUp);
  }

  onRowHandleMove(event: PointerEvent): void {
    if (this.resizingRow == null) return;
    const dy   = event.clientY - this.resizeStartY;
    const dpct = (dy / this.resizeContainerH) * 100;
    const a    = Math.max(this.MIN_PCT, Math.min(100 - this.MIN_PCT, this.resizeHeightsSnap[0] + dpct));
    const b    = 100 - a;
    if (b < this.MIN_PCT) return;
    this.slotHeights = [Math.round(a), Math.round(b)];
  }

  onRowHandleUp(_event: PointerEvent): void {
    if (this.resizingRow == null) return;
    this.resizingRow = null;
    document.removeEventListener('pointermove', this._boundRowMove);
    document.removeEventListener('pointerup',   this._boundRowUp);
    void this.saveLayout();
  }

  // ── Proporciones: modo táctil (sliders) ──────────────────────────────────

  toggleEditingProportions(): void {
    this.editingProportions = !this.editingProportions;
  }

  onWidthSlider(event: Event, colIdx: number): void {
    const val  = (event as CustomEvent<{ value: number }>).detail.value;
    const diff = val - this.slotWidths[colIdx];
    if (this.slotWidths.length === 2) {
      const other = Math.max(this.MIN_PCT, this.slotWidths[1 - colIdx] - diff);
      this.slotWidths = colIdx === 0
        ? [100 - other, other]
        : [other, 100 - other];
    } else if (this.slotWidths.length === 3) {
      // Distribuye el exceso/defecto entre los demás
      const newW  = Math.max(this.MIN_PCT, Math.min(100 - 2 * this.MIN_PCT, val));
      const rem   = 100 - newW;
      const others = [0, 1, 2].filter(i => i !== colIdx);
      const sumOthers = others.reduce((s, i) => s + this.slotWidths[i], 0) || 1;
      const w = [...this.slotWidths];
      w[colIdx] = newW;
      others.forEach(i => {
        w[i] = Math.max(this.MIN_PCT, Math.round(rem * this.slotWidths[i] / sumOthers));
      });
      w[others[1]] = 100 - w[colIdx] - w[others[0]];
      this.slotWidths = w;
    }
  }

  onHeightSlider(event: Event, rowIdx: number): void {
    const val  = (event as CustomEvent<{ value: number }>).detail.value;
    const clamped = Math.max(this.MIN_PCT, Math.min(100 - this.MIN_PCT, val));
    this.slotHeights = rowIdx === 0
      ? [clamped, 100 - clamped]
      : [100 - clamped, clamped];
  }

  resetProportions(): void {
    this.initProportions();
    void this.saveLayout();
  }

  private async saveLayout(): Promise<void> {
    if (!this.board) return;
    this.savingLayout = true;
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoard(this.boardId, {
          multiBoardLayout: {
            widths:  [...this.slotWidths],
            heights: [...this.slotHeights],
          },
        })
      );
      this.board = res.board;
    } catch { /* silencioso */ } finally {
      this.savingLayout = false;
    }
  }

  async saveAndCloseProportions(): Promise<void> {
    await this.saveLayout();
    this.editingProportions = false;
  }

  // ── Tamaño de cuadrícula del minitablero activo ───────────────────────────────

  async saveSlotGridSize(): Promise<void> {
    if (this.activeCellSlotId == null) return;
    const boardId = this.getSlotBoardId(this.activeCellSlotId);
    if (!boardId) return;
    const board = this.getSlotBoard(this.activeCellSlotId);
    if (!board) return;

    if (board.shape !== 'circular') {
      const willLoseCells = board.cells.some(
        c => c.pictogram && (c.row >= this.slotGridRows || c.col >= this.slotGridCols),
      );
      if (willLoseCells) {
        const alert = await this.alertCtrl.create({
          header:  'Perderás pictogramas',
          message: 'Reducir el tamaño eliminará algunos pictogramas. ¿Continuar?',
          buttons: [
            { text: 'Cancelar', role: 'cancel' },
            { text: 'Continuar', handler: () => { void this.doSaveSlotGridSize(); } },
          ],
        });
        await alert.present();
        return;
      }
    }
    await this.doSaveSlotGridSize();
  }

  private async doSaveSlotGridSize(): Promise<void> {
    if (this.activeCellSlotId == null) return;
    const boardId = this.getSlotBoardId(this.activeCellSlotId);
    if (!boardId) return;
    const board = this.getSlotBoard(this.activeCellSlotId);
    if (!board) return;

    const isCircular = board.shape === 'circular';
    const update = isCircular
      ? { circleSlots: this.slotGridCircleSlots }
      : {
          rows:    this.slotGridRows,
          columns: this.slotGridCols,
          cells:   board.cells.filter(c => c.row < this.slotGridRows && c.col < this.slotGridCols),
        };

    this.savingSlotGrid = true;
    try {
      const res = await firstValueFrom(this.boardSvc.updateBoard(boardId, update));
      this.slotBoardData.set(this.activeCellSlotId!, { board: res.board, isLoading: false });
      (await this.toastCtrl.create({
        message: '✓ Tamaño actualizado', duration: 1600, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar el tamaño.', duration: 2200, color: 'danger', position: 'top',
      })).present();
    } finally {
      this.savingSlotGrid = false;
    }
  }

  /** Info de slots para el sidebar left (slotId, boardId, name). */
  get sidebarMultiSlots(): Array<{ slotId: number; boardId: string | null; name: string }> {
    return this.slotIds.map((slotId) => ({
      slotId,
      boardId: this.getSlotBoardId(slotId),
      name:    this.getSlotTitle(slotId),
    }));
  }

  onSlotSelected(slotId: number): void {
    this.selectedSlotId = slotId;
    this.multiPanelMode = 'tablero';
  }

  async onSlotBoardAssign(boardId: string): Promise<void> {
    if (!this.board || this.selectedSlotId == null) return;

    const currentSlots = [...(this.board.multiBoardSlots ?? [])];
    const idx = currentSlots.findIndex((s) => s.slotId === this.selectedSlotId);
    if (idx >= 0) {
      currentSlots[idx] = { slotId: this.selectedSlotId, boardId };
    } else {
      currentSlots.push({ slotId: this.selectedSlotId!, boardId });
    }

    await this.saveSlots(currentSlots);
    this.selectedSlotId = null;
  }

  async onSlotCleared(slotId: number): Promise<void> {
    if (!this.board) return;
    const currentSlots = (this.board.multiBoardSlots ?? [])
      .map((s) => s.slotId === slotId ? { slotId, boardId: null } : s);
    await this.saveSlots(currentSlots);
    if (this.selectedSlotId === slotId) this.selectedSlotId = null;
  }

  private async saveSlots(slots: Array<{ slotId: number; boardId: string | null }>): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.boardSvc.updateBoardSlots(this.boardId, slots)
      );
      this.board = res.board;
      // Recargar boards de slots que cambiaron
      for (const slot of slots) {
        if (slot.boardId) {
          await this.loadSlotBoard(slot.slotId, slot.boardId);
        } else {
          this.slotBoardData.delete(slot.slotId);
        }
      }
      (await this.toastCtrl.create({
        message: '✓ Huecos guardados', duration: 1600, color: 'success', position: 'top',
      })).present();
    } catch {
      (await this.toastCtrl.create({
        message: 'Error al guardar los huecos.', duration: 2200, color: 'danger', position: 'top',
      })).present();
    }
  }

  onEditSlotBoard(boardId: string): void {
    this.router.navigate(['/board-builder-editor', boardId], {
      queryParams: {
        returnTo:    `/board-builder-editor/${this.boardId}`,
        creatorId:   this.contextCreatorId   || undefined,
        creatorName: this.contextCreatorName || undefined,
      },
    });
  }

  private async loadMainBoards(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.boardSvc.getBoardsByCreator(this.contextCreatorId || this.authSvc.getCurrentUser()?.id || '')
      );
      this.mainBoards = res.boards.filter(
        (b) => (b.boardRole === 'main' || !b.boardRole) && b.shape !== 'multi',
      );
    } catch { /* silencioso */ }
  }

  // ── Carga de boards por slot ──────────────────────────────────────────────────

  /** Carga los boards asignados a cada slot del multitablero. */
  async loadSlotBoards(): Promise<void> {
    if (!this.board?.multiBoardSlots) return;
    for (const slot of this.board.multiBoardSlots) {
      if (slot.boardId) {
        await this.loadSlotBoard(slot.slotId, slot.boardId);
      }
    }
  }

  private async loadSlotBoard(slotId: number, boardId: string): Promise<void> {
    this.slotBoardData.set(slotId, { board: null, isLoading: true });
    try {
      const res = await firstValueFrom(this.boardSvc.getBoardById(boardId));
      this.slotBoardData.set(slotId, { board: res.board, isLoading: false });
    } catch {
      this.slotBoardData.set(slotId, { board: null, isLoading: false });
    }
  }

  /** Devuelve el board cargado para un slot, o null si no está asignado/cargado. */
  getSlotBoard(slotId: number): Board | null {
    return this.slotBoardData.get(slotId)?.board ?? null;
  }

  isSlotLoading(slotId: number): boolean {
    return this.slotBoardData.get(slotId)?.isLoading ?? false;
  }

  getSlotBoardId(slotId: number): string | null {
    const entry = this.board?.multiBoardSlots?.find((s) => s.slotId === slotId);
    return entry?.boardId ?? null;
  }

  getSlotTitle(slotId: number): string {
    const board = this.getSlotBoard(slotId);
    return board ? board.name : `Hueco ${slotId}`;
  }

  get slotIds(): number[] {
    const count = this.board?.slotCount ?? 2;
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  // ── Celda activa en modo multitablero ─────────────────────────────────────────

  /** Click en una celda de un slot del multitablero. */
  onMultiSlotCellClick(slotId: number, row: number, col: number): void {
    this.activeCellSlotId  = slotId;
    this.activeCellBoardId = this.getSlotBoardId(slotId) ?? '';
    const slotBoard        = this.getSlotBoard(slotId);

    // Sincronizar estado local del editor de tamaño
    if (slotBoard) {
      this.slotGridRows        = slotBoard.rows;
      this.slotGridCols        = slotBoard.columns;
      this.slotGridCircleSlots = slotBoard.circleSlots ?? 8;
    }

    // Modo mover táctil: si hay celda origen, ejecutar el movimiento
    if (this.moveSrcCell) {
      const src = { ...this.moveSrcCell };
      this.moveSrcCell = null;
      if (src.row !== row || src.col !== col) {
        void this.executeCellMove(src.row, src.col, row, col);
      }
      return;
    }

    this.selectedCell  = { row, col };
    const existing     = slotBoard
      ? this.boardLayoutSvc.getCellData(slotBoard, row, col)
      : null;
    this.cellData      = existing;
    this.isEditingCell = !!existing?.pictogram;
    this.multiPanelMode = 'pictogram';

    // Preview en tiempo real de acciones setSlot:
    // si la celda seleccionada tiene configurado cambiar el tablero de otro hueco,
    // reflejarlo visualmente en la zona central (solo en el editor, sin guardar en DB).
    const action = existing?.action;
    if (
      (action?.type === 'setSlot' || action?.type === 'voice+setSlot') &&
      action.targetSlotId != null &&
      action.targetBoardId
    ) {
      void this.loadSlotBoard(action.targetSlotId, action.targetBoardId);
    }
  }

  // ── Drag & drop y modo mover en minitableros ─────────────────────────────────

  /** Doble clic en celda de un slot: activa modo mover táctil para ese slot. */
  async onMultiSlotCellDblClick(slotId: number, row: number, col: number): Promise<void> {
    if (this.previewMode) return;
    this.activeCellSlotId  = slotId;
    this.activeCellBoardId = this.getSlotBoardId(slotId) ?? '';
    const slotBoard = this.getSlotBoard(slotId);
    if (!slotBoard) return;

    const getPict = (r: number, c: number) => this.boardLayoutSvc.getCellPict(slotBoard, r, c);

    if (this.moveSrcCell) {
      if (this.moveSrcCell.row === row && this.moveSrcCell.col === col) {
        this.moveSrcCell = null;
        return;
      }
      if (getPict(row, col)) {
        this.moveSrcCell = { row, col };
        (await this.toastCtrl.create({
          message: `Toca destino para mover "${getPict(row, col)!.label}". Doble toque aquí para cancelar.`,
          duration: 3000, color: 'dark', position: 'bottom',
        })).present();
      }
      return;
    }

    const pict = getPict(row, col);
    if (!pict) return;
    this.moveSrcCell  = { row, col };
    this.selectedCell = null;
    (await this.toastCtrl.create({
      message: `Toca una celda destino para mover "${pict.label}". Doble toque para cancelar.`,
      duration: 3000, color: 'dark', position: 'bottom',
    })).present();
  }

  onMultiSlotCellDragStart(slotId: number, event: DragEvent, row: number, col: number): void {
    this.activeCellSlotId  = slotId;
    this.activeCellBoardId = this.getSlotBoardId(slotId) ?? '';
    this.onCellDragStart(event, row, col);
  }

  onMultiSlotCellDragOver(_slotId: number, event: DragEvent, row: number, col: number): void {
    this.onCellDragOver(event, row, col);
  }

  onMultiSlotCellDragLeave(_slotId: number, event: DragEvent, row: number, col: number): void {
    this.onCellDragLeave(event, row, col);
  }

  onMultiSlotCellDrop(slotId: number, event: DragEvent, row: number, col: number): void {
    this.activeCellSlotId  = slotId;
    this.activeCellBoardId = this.getSlotBoardId(slotId) ?? '';
    this.onCellDrop(event, row, col);
  }

  /** ¿La celda en (row,col) de este slot está seleccionada? */
  isSlotCellSelected(slotId: number, row: number, col: number): boolean {
    return this.activeCellSlotId === slotId &&
           this.selectedCell?.row === row &&
           this.selectedCell?.col === col;
  }

  selectedCellForSlot(slotId: number): { row: number; col: number } | null {
    return this.activeCellSlotId === slotId ? this.selectedCell : null;
  }

  onMultiPanelModeChange(event: Event): void {
    const val = (event as CustomEvent<{ value: string }>).detail.value;
    this.multiPanelMode = val === 'pictogram' ? 'pictogram' : 'tablero';
  }

  // ── Getters de estado ─────────────────────────────────────────────────────────

  /** true cuando el tablero está asignado a más de un usuario. */
  get isSharedBoard(): boolean {
    return (this.board?.assignedUserIds?.length ?? 0) > 1;
  }

  /**
   * Razón por la que los pictogramas personales están bloqueados.
   * Cadena vacía = permitidos.
   */
  get personalPictsBlockedReason(): string {
    const ids  = this.board?.assignedUserIds ?? [];
    const role = this.board?.boardRole ?? 'main';
    if (role === 'secondary' && ids.length === 0) {
      return 'Para utilizar pictogramas personales en este tablero secundario, primero debes enlazarlo desde un tablero principal. Al enlazarlo, heredará el usuario asignado.';
    }
    if (ids.length > 1) {
      return 'Los pictogramas personales no están disponibles en tableros asignados a varios usuarios.';
    }
    return '';
  }

  get canAddToProfile(): boolean {
    // Permitir publicar en tableros principales y multi (legacy boardRole='multi' incluido).
    // Solo los secundarios (boardRole='secondary') no se publican directamente.
    const role = this.board?.boardRole ?? 'main';
    return role !== 'secondary' && !!this.board?.userId;
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

  /** Shape activo para filtrar tableros destino (usa el slot activo en multi). */
  private get _targetShape(): string {
    if (this.isMultiBoard && this.activeCellSlotId != null) {
      return this.getSlotBoard(this.activeCellSlotId)?.shape ?? 'grid';
    }
    return this.board?.shape ?? 'grid';
  }

  /** Tableros del mismo usuario contexto, creados por el creador del contexto actual,
   *  filtrando por shape y respetando la regla main→secondary. */
  get boardsSameUser(): Board[] {
    const creatorId = this.contextCreatorId || this.authSvc.getCurrentUser()?.id || '';
    const shape = this._targetShape;
    const byShape = this.userBoards.filter(b =>
      (b.shape ?? 'grid') === shape &&
      b.shape !== 'multi' &&
      (!creatorId || b.createdBy === creatorId || b.creatorId === creatorId),
    );
    const currentRole = this.board?.boardRole ?? 'main';
    if (currentRole === 'main') {
      return byShape.filter(b => b.boardRole === 'secondary');
    }
    return byShape;
  }

  /** Tableros secundarios sin usuarios asignados, del creador del contexto actual,
   *  del mismo shape. Son candidatos a heredar assignedUserIds al enlazarse. */
  get boardsUnassigned(): Board[] {
    const creatorId = this.contextCreatorId || this.authSvc.getCurrentUser()?.id || '';
    const shape = this._targetShape;
    return this.allCreatorBoards.filter(b =>
      b._id !== this.boardId &&
      b.boardRole === 'secondary' &&
      (!b.assignedUserIds || b.assignedUserIds.length === 0) &&
      (b.shape ?? 'grid') === shape &&
      b.shape !== 'multi' &&
      (!creatorId || b.createdBy === creatorId || b.creatorId === creatorId),
    );
  }

  /** Unión de ambos grupos; se usa para validación de shape en onSaveCellRequest. */
  get sameShapeBoards(): Board[] {
    return [...this.boardsSameUser, ...this.boardsUnassigned];
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

  /**
   * Recibe el payload del panel (actionType elegido) y navega a /board-builder-create.
   * La page añade todos los queryParams de contexto que solo ella conoce.
   */
  navigateToCreateBoard(payload: CellPanelCreateBoardPayload): void {
    if (!this.selectedCell) return; // el botón solo es visible con celda seleccionada

    this.router.navigate(['/board-builder-create'], {
      queryParams: {
        returnTo:          this.router.url,
        sourceBoardId:     this.boardId,
        assignedUserIds:   (this.board?.assignedUserIds ?? []).join(','),
        lockAssignedUsers: 'true',
        boardRole:         'secondary',
        lockBoardRole:     'true',
        shape:             this.board?.shape ?? 'grid',
        creatorId:         this.contextCreatorId  || undefined,
        creatorName:       this.contextCreatorName || undefined,
        linkBack:          'true',
        sourceCellRow:     this.selectedCell.row,
        sourceCellCol:     this.selectedCell.col,
        sourceActionType:  payload.actionType,
      },
    });
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
      const arr = this.aacRuntime.phrase;
      const last = arr.length > 0 ? arr[arr.length - 1] : null;
      if (!last) return null;
      return {
        source: 'arasaac', id: last.id, label: last.label,
        imageUrl: last.imageUrl, sound: last.sound,
        tags: [], description: '', wordType: (last.wordType ?? 'misc') as any,
        fitzgeraldEnabled: false, color: last.color ?? '',
      };
    }
    return this.circularCenterPict;
  }

  handleCircularPreviewClick(row: number, col: number): void {
    const cell = this.getCellData(row, col);
    if (!cell?.pictogram) return;
    if (cell.action?.type === 'disabled') return;

    // Simulación visual IA: muestra pictograma en el centro sin navegar
    if (cell.action?.aiGeneratedBoardTarget) {
      this.circularSimCenter = { ...cell.pictogram };
      this.circularSimMode = true;
      const type = cell.action?.type ?? 'voice';
      if (type === 'voice' || type === 'voice+navigate') {
        this.aacRuntime.addToPhrase({
          id: cell.pictogram.id, label: cell.pictogram.label,
          imageUrl: cell.pictogram.imageUrl, sound: cell.pictogram.sound ?? cell.pictogram.label,
          color: cell.pictogram.color, wordType: cell.pictogram.wordType,
        });
        this.aacRuntime.speakText(cell.pictogram.sound || cell.pictogram.label);
      }
      return;
    }

    // Caso normal: el servicio gestiona voz, frase y navigate vía boardNavigated$
    this.aacRuntime.handlePictogramPress(cell, this.boardId);
  }

  circularSimReset(): void {
    this.circularSimMode = false;
    this.circularSimCenter = null;
  }

}
