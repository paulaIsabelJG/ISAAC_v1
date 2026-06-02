import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { firstValueFrom, Subscription } from 'rxjs';
import { Board, BoardCell, CellPictogram } from '../../services/board.service';
import { BoardService } from '../../services/board.service';
import { AacRuntimeService, OblAction, UndoEntry } from '../../services/aac-runtime.service';
import { getCellBaseColor } from '../../shared/utils/board-color.utils';
import { BoardLayoutService } from '../../services/board-layout.service';
import { BoardGridComponent } from '../board-grid/board-grid.component';
import { LoadingErrorStateComponent } from '../loading-error-state/loading-error-state.component';
import { IaPredictorColumnComponent } from '../ia-predictor-column/ia-predictor-column.component';
import { AacPredictionService, PredictedPictogram } from '../../services/aac-prediction.service';

interface SlotState {
  slotId:      number;
  boardId:     string | null;
  board:       Board | null;
  isLoading:   boolean;
  loadError:   string;
  boardStack:  string[];  // pila de navegación intra-slot
}

/**
 * Comunicador de multitablero.
 * Recibe el tablero maestro (boardRole='multi') y renderiza cada slot con su
 * propio BoardGridComponent. Gestiona navegación intra-slot y acciones setSlot.
 * La barra AAC (frase, voz, borrar, inicio) está en el communicator padre.
 */
@Component({
  selector:    'app-multiboard-communicator',
  templateUrl: './multiboard-communicator.component.html',
  styleUrls:   ['./multiboard-communicator.component.scss'],
  standalone:  true,
  imports:     [IonicModule, NgClass, BoardGridComponent, LoadingErrorStateComponent, IaPredictorColumnComponent],
})
export class MultiboardCommunicatorComponent implements OnInit, OnDestroy, OnChanges {

  @Input() masterBoard: Board | null = null;
  @Input() gender?: string;
  /** ID del usuario final de la sesión — se pasa a getBoardById para personalización dinámica. */
  @Input() contextUserId = '';

  slotStates:  SlotState[]         = [];
  predictions: PredictedPictogram[] = [];

  private slotSub?:         Subscription;
  private phraseSub?:       Subscription;
  private restoreSlotSub?:  Subscription;
  private undoSlotNavSub?:  Subscription;

  constructor(
    private boardSvc:       BoardService,
    private aac:            AacRuntimeService,
    private boardLayoutSvc: BoardLayoutService,
    private predictionSvc:  AacPredictionService,
  ) {}

  ngOnInit(): void {
    this.slotSub = this.aac.slotChanged$.subscribe(({ slotId, boardId }) => {
      this.setSlotBoard(slotId, boardId);
    });
    // BehaviorSubject emite inmediatamente → carga inicial de predicciones incluida
    this.phraseSub = this.aac.phraseChanged$.subscribe(() => {
      this.loadPredictions();
    });
    // Borrar último: restaurar el board de un slot al estado previo al cambio.
    this.restoreSlotSub = this.aac.restoreSlot$.subscribe(({ slotId, boardId }) => {
      const st = this.slotStates.find(s => s.slotId === slotId);
      if (!st) return;
      st.boardStack = [];
      st.boardId    = boardId;
      if (boardId) { void this.loadSlotBoard(st); }
      else         { st.board = null; }
    });
    // Borrar último: deshacer la navegación intra-slot (voice+navigate dentro de un slot).
    this.undoSlotNavSub = this.aac.undoSlotNavigate$.subscribe(({ slotId }) => {
      const st = this.slotStates.find(s => s.slotId === slotId);
      if (st && st.boardStack.length > 0) { this.goBackInSlot(st); }
    });
  }

  ngOnDestroy(): void {
    this.slotSub?.unsubscribe();
    this.phraseSub?.unsubscribe();
    this.restoreSlotSub?.unsubscribe();
    this.undoSlotNavSub?.unsubscribe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['masterBoard'] && this.masterBoard) {
      this.initSlots();
    }
  }

  // ── Inicialización ────────────────────────────────────────────────────────────

  private initSlots(): void {
    const count = this.masterBoard!.slotCount ?? 2;
    const slots = this.masterBoard!.multiBoardSlots ?? [];

    this.slotStates = Array.from({ length: count }, (_, i) => {
      const slotId  = i + 1;
      const entry   = slots.find((s) => s.slotId === slotId);
      return {
        slotId,
        boardId:    entry?.boardId ?? null,
        board:      null,
        isLoading:  false,
        loadError:  '',
        boardStack: [],
      };
    });

    for (const state of this.slotStates) {
      if (state.boardId) {
        void this.loadSlotBoard(state);
      }
    }
  }

  private async loadSlotBoard(state: SlotState): Promise<void> {
    if (!state.boardId) return;
    state.isLoading = true;
    state.loadError = '';
    try {
      const res   = await firstValueFrom(this.boardSvc.getBoardById(state.boardId, this.contextUserId || undefined));
      state.board = res.board;
    } catch {
      state.loadError = 'No se pudo cargar el tablero.';
    } finally {
      state.isLoading = false;
    }
  }

  // ── Acción setSlot ────────────────────────────────────────────────────────────

  setSlotBoard(slotId: number, boardId: string): void {
    const state = this.slotStates.find((s) => s.slotId === slotId);
    if (!state) return;
    state.boardStack = [];  // resetear pila al cambiar de tablero
    state.boardId    = boardId;
    void this.loadSlotBoard(state);
  }

  // ── Pulsación de celda ────────────────────────────────────────────────────────

  onCellPress(state: SlotState, row: number, col: number): void {
    const cell = this.getCellData(state.board, row, col);
    if (!cell?.pictogram) return;
    if (!state.board) return;

    const action    = cell.action;
    const type      = action?.type ?? 'voice';
    const spoken    = type === 'voice' || type === 'voice+navigate' || type === 'voice+setSlot';
    const navigates = type === 'navigate' || type === 'voice+navigate';
    const setsSlot  = type === 'setSlot'  || type === 'voice+setSlot';

    // ── Frase + voz ───────────────────────────────────────────────────────────
    if (spoken) {
      let undo: UndoEntry;
      if (type === 'voice+navigate') {
        undo = { type: 'slotNavigate', slotId: state.slotId };
      } else if (type === 'voice+setSlot' && action?.targetSlotId != null) {
        const targetSt = this.slotStates.find(s => s.slotId === action.targetSlotId);
        undo = { type: 'setSlot', slotId: action.targetSlotId, prevSlotBoardId: targetSt?.boardId ?? null };
      } else {
        undo = { type: 'none' };
      }
      this.aac.addToPhrase({
        id:                cell.pictogram.id,
        label:             cell.pictogram.label,
        imageUrl:          cell.pictogram.imageUrl,
        sound:             cell.pictogram.sound || cell.pictogram.label,
        boardId:           state.board._id,
        color:             getCellBaseColor(cell.pictogram as CellPictogram) ?? '',
        wordType:          cell.pictogram.wordType  ?? 'misc',
        fitzgeraldEnabled: !!(cell.pictogram.fitzgeraldEnabled),
      }, undo);
      this.aac.speakText(cell.pictogram.sound || cell.pictogram.label, this.gender);
    }

    // soundEnabled: hablar en CUALQUIER pulsación (incluye navigate, setSlot, etc.)
    if (this.aac.soundEnabled && !spoken) {
      this.aac.speakText(cell.pictogram.sound || cell.pictogram.label, this.gender);
    }

    // ── OBL: registrar TODAS las pulsaciones en modo comunicador ─────────────
    const oblActions: OblAction[] = [];
    if (navigates && action?.targetBoardId)
                                   oblActions.push({ action: ':open_board', destination_board_id: action.targetBoardId });
    if (setsSlot && action?.targetBoardId)
                                   oblActions.push({ action: 'ext_isaac_set_slot', ext_isaac_slot_id: action?.targetSlotId ?? undefined, destination_board_id: action.targetBoardId });

    this.aac.logButtonEvent({
      label:        cell.pictogram.label,
      vocalization: cell.pictogram.sound || cell.pictogram.label,
      spoken,
      button_id:    cell.pictogram.id,
      board_id:     state.board._id,
      image_url:    cell.pictogram.imageUrl,
      actions:      oblActions,
      color:        getCellBaseColor(cell.pictogram as CellPictogram) ?? undefined,
      wordType:     cell.pictogram.wordType ?? 'misc',
    });

    // ── Navegación intra-slot ─────────────────────────────────────────────────
    if (navigates && action?.targetBoardId) {
      state.boardStack.push(state.boardId!);
      state.boardId = action.targetBoardId;
      void this.loadSlotBoard(state);
      return;
    }

    // ── setSlot ───────────────────────────────────────────────────────────────
    if (setsSlot && action?.targetSlotId != null && action?.targetBoardId) {
      this.setSlotBoard(action.targetSlotId, action.targetBoardId);
    }
  }

  // ── Navegación intra-slot (volver) ────────────────────────────────────────────

  goBackInSlot(state: SlotState): void {
    if (state.boardStack.length === 0) return;
    const prev   = state.boardStack.pop()!;
    state.boardId = prev;
    void this.loadSlotBoard(state);
  }

  canGoBackInSlot(state: SlotState): boolean {
    return state.boardStack.length > 0;
  }

  // ── Predictor IA (heredado del tablero raíz vía AacRuntimeService) ───────────

  get showPredictor(): boolean { return this.aac.predictorEnabled; }
  get predictorIaRows(): number { return this.aac.iaRows; }
  get predictorIaCols(): number { return this.aac.iaCols; }

  loadPredictions(): void {
    if (!this.showPredictor || !this.aac.userId || !this.masterBoard) return;
    const limit = this.aac.iaRows * this.aac.iaCols;
    this.predictionSvc.getSuggestions({
      userId:            this.aac.userId,
      boardId:           this.masterBoard._id,
      limit,
      currentPhrase:     this.aac.phrase.map(p => ({ label: p.label, wordType: p.wordType })),
      currentBoardRole:  'multi',
      currentBoardShape: 'multi',
    }).subscribe({
      next:  res => { this.predictions = this.enrichWithSlotId(res.predictions); },
      error: ()  => { /* silencioso */ },
    });
  }

  /**
   * Para predicciones con acción navigate/voice+navigate, busca en qué slot vive
   * actualmente el pictograma (por label + targetBoardId) y añade sourceSlotId.
   * Esto permite que al pulsarlo en la barra IA, la navegación ocurra dentro del
   * slot correcto en lugar de disparar una navegación global.
   */
  private enrichWithSlotId(predictions: PredictedPictogram[]): PredictedPictogram[] {
    return predictions.map(pict => {
      const type = pict.action?.type ?? 'voice';
      if (type !== 'navigate' && type !== 'voice+navigate') return pict;

      for (const state of this.slotStates) {
        if (!state.board) continue;
        const match = state.board.cells.find(c =>
          c.pictogram?.label === pict.label &&
          c.action?.targetBoardId === pict.action?.targetBoardId,
        );
        if (match) return { ...pict, sourceSlotId: state.slotId };
      }
      return pict;
    });
  }

  onPredictorCellPress(pict: PredictedPictogram): void {
    const action    = pict.action ?? { type: 'voice' };
    const type      = action.type ?? 'voice';
    const speaks    = type === 'voice' || type === 'voice+navigate' || type === 'voice+setSlot';
    const navigates = type === 'navigate' || type === 'voice+navigate';
    const setsSlot  = type === 'setSlot'  || type === 'voice+setSlot';

    // Board de origen: el slot que contiene el pictograma, o el masterBoard
    const sourceSt   = pict.sourceSlotId != null
      ? this.slotStates.find(s => s.slotId === pict.sourceSlotId)
      : null;
    const sourceBoardId = sourceSt?.board?._id ?? this.masterBoard?._id ?? '';

    // Registrar evento button ANTES de cualquier otra acción
    const oblActions: OblAction[] = [];
    if (navigates && action.targetBoardId)
      oblActions.push({ action: ':open_board', destination_board_id: action.targetBoardId });
    if (setsSlot && action.targetBoardId)
      oblActions.push({ action: 'ext_isaac_set_slot', ext_isaac_slot_id: action.targetSlotId ?? undefined, destination_board_id: action.targetBoardId });

    this.aac.logButtonEvent({
      label:        pict.label,
      vocalization: pict.label,
      spoken:       speaks,
      button_id:    pict.label,
      board_id:     sourceBoardId,
      image_url:    pict.imageUrl ?? '',
      actions:      oblActions,
      color:        pict.color    ?? undefined,
      wordType:     pict.wordType ?? undefined,
    });

    // — Voz: añadir a frase y hablar (con undo apropiado) —
    if (speaks) {
      let undo: UndoEntry;
      if (type === 'voice+navigate' && pict.sourceSlotId != null) {
        undo = { type: 'slotNavigate', slotId: pict.sourceSlotId };
      } else if (type === 'voice+setSlot' && action.targetSlotId != null) {
        const targetSt = this.slotStates.find(s => s.slotId === action.targetSlotId);
        undo = { type: 'setSlot', slotId: action.targetSlotId, prevSlotBoardId: targetSt?.boardId ?? null };
      } else {
        undo = { type: 'none' };
      }
      this.aac.addToPhrase({
        id:                pict.label,
        label:             pict.label,
        imageUrl:          pict.imageUrl,
        sound:             pict.label,
        boardId:           sourceBoardId,
        color:             pict.color,
        wordType:          pict.wordType,
        fitzgeraldEnabled: false,
      }, undo);
      this.aac.speakText(pict.label, this.gender);
    }

    // soundEnabled: hablar en CUALQUIER pulsación aunque no sea acción de voz
    if (this.aac.soundEnabled && !speaks) {
      this.aac.speakText(pict.label, this.gender);
    }

    // — Navegación intra-slot: afecta solo al slot de origen del pictograma —
    if (navigates && action.targetBoardId) {
      const slotId = pict.sourceSlotId ?? this.slotStates[0]?.slotId;
      const state  = this.slotStates.find(s => s.slotId === slotId);
      if (state) {
        state.boardStack.push(state.boardId!);
        state.boardId = action.targetBoardId;
        void this.loadSlotBoard(state);
      }
      return;
    }

    // — Cambio de slot: igual que al pulsar en el tablero —
    if (setsSlot && action.targetSlotId != null && action.targetBoardId) {
      this.setSlotBoard(action.targetSlotId, action.targetBoardId);
    }
  }

  // ── Layout ────────────────────────────────────────────────────────────────────

  get layoutClass(): string {
    return `mbc-layout--${this.masterBoard?.slotCount ?? 2}`;
  }

  /** Posición visual de la columna IA leída del tablero maestro. */
  get iaPosition(): string {
    return this.masterBoard?.multiBoardIaPosition ?? 'left';
  }

  /**
   * Índice de columna (0-based) ANTES del cual se inserta el predictor.
   * 'left'=0, 'between-1-2'=1, 'between-2-3'=2, 'right'=cols.
   */
  private get predictorInsertAfterSlot(): number {
    const slotN = this.slotStates.length || (this.masterBoard?.slotCount ?? 2);
    const cols  = slotN === 4 ? 2 : slotN;
    const pos   = this.iaPosition;
    if (pos === 'right')        return cols;
    if (pos === 'between-1-2') return 1;
    if (pos === 'between-2-3') return 2;
    return 0; // left
  }

  /** CSS grid-template-columns: inserta la columna predictor en la posición correcta. */
  get gridTemplateColumns(): string {
    // Usar slotStates.length como fuente de verdad: evita errores si slotCount está
    // indefinido en tableros legacy o recién migrados.
    const slotN = this.slotStates.length || (this.masterBoard?.slotCount ?? 2);
    const cols  = slotN === 4 ? 2 : slotN;
    const widths = this.masterBoard?.multiBoardLayout?.widths;

    const slotCols: string[] = (widths && widths.length === cols && widths.every(v => v > 0))
      ? widths.map(w => w + 'fr')
      : Array(cols).fill('1fr');

    if (!this.showPredictor) return slotCols.join(' ');

    const predictorCol = `${this.aac.iaCols * 6.5}%`;
    const result = [...slotCols];
    result.splice(this.predictorInsertAfterSlot, 0, predictorCol);
    return result.join(' ');
  }

  /** CSS grid-template-rows calculado a partir de multiBoardLayout.heights (solo 4 huecos). */
  get gridTemplateRows(): string {
    if ((this.masterBoard?.slotCount ?? 2) !== 4) return '1fr';
    const heights = this.masterBoard?.multiBoardLayout?.heights;
    if (heights && heights.length === 2 && heights.every(v => v > 0)) {
      return heights.map(h => h + 'fr').join(' ');
    }
    return 'repeat(2, 1fr)';
  }

  /** Columna CSS Grid del predictor (1-based). */
  get predictorGridColumn(): number {
    return this.predictorInsertAfterSlot + 1;
  }

  /** Filas CSS Grid del predictor (span 2 en layout 4 huecos). */
  get predictorGridRow(): string {
    return (this.masterBoard?.slotCount ?? 2) === 4 ? '1 / span 2' : '1';
  }

  /** Columna CSS Grid de un slot (1-based), desplazada según posición del predictor. */
  getSlotGridColumn(slotId: number): number {
    const slotN = this.slotStates.length || (this.masterBoard?.slotCount ?? 2);
    if (slotN === 4) {
      const naturalCol = ((slotId - 1) % 2) + 1;
      if (!this.showPredictor) return naturalCol;
      return this.iaPosition === 'left' ? naturalCol + 1 : naturalCol;
    }
    if (!this.showPredictor) return slotId;
    const insertAfter = this.predictorInsertAfterSlot;
    return slotId > insertAfter ? slotId + 1 : slotId;
  }

  /** Fila CSS Grid de un slot (solo relevante para 4 huecos). */
  getSlotGridRow(slotId: number): number {
    const slotN = this.slotStates.length || (this.masterBoard?.slotCount ?? 2);
    if (slotN !== 4) return 1;
    return slotId <= 2 ? 1 : 2;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getCellData(board: Board | null, row: number, col: number): BoardCell | null {
    return this.boardLayoutSvc.getCellData(board, row, col);
  }
}
