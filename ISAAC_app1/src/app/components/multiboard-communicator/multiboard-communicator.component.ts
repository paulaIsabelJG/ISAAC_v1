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
import { Board, BoardCell } from '../../services/board.service';
import { BoardService } from '../../services/board.service';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { BoardGridComponent } from '../board-grid/board-grid.component';
import { LoadingErrorStateComponent } from '../loading-error-state/loading-error-state.component';
import { IaPredictorColumnComponent } from '../ia-predictor-column/ia-predictor-column.component';

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

  slotStates: SlotState[] = [];

  private slotSub?: Subscription;

  constructor(
    private boardSvc:       BoardService,
    private aac:            AacRuntimeService,
    private boardLayoutSvc: BoardLayoutService,
  ) {}

  ngOnInit(): void {
    this.slotSub = this.aac.slotChanged$.subscribe(({ slotId, boardId }) => {
      this.setSlotBoard(slotId, boardId);
    });
  }

  ngOnDestroy(): void {
    this.slotSub?.unsubscribe();
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

    const action = cell.action;
    const type   = action?.type ?? 'voice';

    // Voz
    if (type === 'voice' || type === 'voice+navigate' || type === 'voice+setSlot') {
      this.aac.addToPhrase({
        id:       cell.pictogram.id,
        label:    cell.pictogram.label,
        imageUrl: cell.pictogram.imageUrl,
        sound:    cell.pictogram.sound || cell.pictogram.label,
      });
      this.aac.speakText(cell.pictogram.sound || cell.pictogram.label, this.gender);
      this.aac.logButtonEvent({
        label:        cell.pictogram.label,
        vocalization: cell.pictogram.sound || cell.pictogram.label,
        spoken:       true,
        button_id:    cell.pictogram.id,
        board_id:     state.board._id,
        image_url:    cell.pictogram.imageUrl,
        actions:      [{ action: '+speak' }],
      });
    }

    // Navegación intra-slot
    if ((type === 'navigate' || type === 'voice+navigate') && action?.targetBoardId) {
      state.boardStack.push(state.boardId!);
      state.boardId = action.targetBoardId;
      void this.loadSlotBoard(state);
      return;
    }

    // setSlot: el AacRuntimeService ya emite slotChanged$ en handlePictogramPress,
    // pero aquí lo manejamos directamente porque no pasamos por handlePictogramPress
    if ((type === 'setSlot' || type === 'voice+setSlot') &&
        action?.targetSlotId != null && action?.targetBoardId) {
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

  get showPredictor(): boolean {
    return this.aac.predictorEnabled;
  }

  get predictorIaRows(): number { return this.aac.iaRows; }
  get predictorIaCols(): number { return this.aac.iaCols; }

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
