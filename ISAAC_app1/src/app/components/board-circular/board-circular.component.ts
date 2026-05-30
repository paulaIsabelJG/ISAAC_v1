import { Component, EventEmitter, HostBinding, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { Board, CellPictogram } from '../../services/board.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import {
  getCellBgColor,
  getCellBorderColor,
  getPictBgColor,
  getPictBorderColor,
  isCellDisabled,
} from '../../shared/utils/board-color.utils';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';
import { CellMode } from '../pictogram-cell/pictogram-cell.component';
import { CellCoord, CellDragPayload } from '../board-grid/board-grid.component';

/**
 * BoardCircularComponent
 *
 * Renderiza un tablero de tipo "circular" de forma reutilizable.
 * Misma arquitectura que BoardGridComponent: sin estado propio,
 * toda la lógica permanece en la page.
 *
 * Modos:
 *   'edit'         → slots con DnD, selección, modo mover táctil
 *   'preview'      → slots clickables con simMode y estados especiales del centro
 *   'communicator' → slots clickables para AAC, sin DnD
 *
 * Entradas especiales para preview:
 *   centerPict      — override del pictograma del centro (simCenter, lastPhrase, etc.)
 *                     undefined = usar el pictograma del board; null = vacío explícito
 *   simMode         — true cuando hay simulación IA activa
 *   isCenterWaiting — true cuando showLastPhrase está activado y la frase está vacía
 *
 * Usado por: board-builder-editor.page (edit + preview), communicator.page.
 */
@Component({
  selector: 'app-board-circular',
  templateUrl: './board-circular.component.html',
  styleUrls: ['./board-circular.component.scss'],
  standalone: true,
  imports: [PictCellContentComponent],
  host: {
    '[class.bcc--edit]':         "mode === 'edit'",
    '[class.bcc--preview]':      "mode === 'preview'",
    '[class.bcc--communicator]': "mode === 'communicator'",
  },
})
export class BoardCircularComponent implements OnChanges {

  // ── Datos ────────────────────────────────────────────────────────────────
  @Input() board: Board | null = null;

  // ── Modo ─────────────────────────────────────────────────────────────────
  @Input() mode: CellMode = 'communicator';

  /**
   * Activa el layout de dos barras (superior + derecha) para tableros circulares.
   * Cuando true, el canvas usa container queries en lugar de la fórmula dvh/dvw.
   */
  @HostBinding('class.bcc--circular-layout')
  @Input() circularLayout = false;

  // ── Estado de interacción (solo edit) ────────────────────────────────────
  @Input() selectedCell: CellCoord | null = null;
  @Input() draggedCell:  CellCoord | null = null;
  @Input() dragOverCell: CellCoord | null = null;
  @Input() moveSrcCell:  CellCoord | null = null;

  // ── Estado especial preview / communicator ───────────────────────────────
  /** Override del pictograma del centro; undefined = leer del board. */
  @Input() centerPict: CellPictogram | null | undefined = undefined;
  /** true cuando hay simulación IA activa (preview). */
  @Input() simMode = false;
  /** true cuando showLastPhrase activo y frase vacía (icono de espera). */
  @Input() isCenterWaiting = false;
  /** true en tableros circulares secundarios: el centro es automático, no editable. */
  @Input() centerLocked = false;

  /** Activa la animación de entrada del centro al recibir un centerPict nuevo. */
  centerAnimating = false;
  private animTimer?: ReturnType<typeof setTimeout>;

  // ── Eventos hacia la page ────────────────────────────────────────────────
  @Output() cellClick     = new EventEmitter<CellCoord>();
  @Output() cellDblClick  = new EventEmitter<CellCoord>();
  @Output() cellDragStart = new EventEmitter<CellDragPayload>();
  @Output() cellDragOver  = new EventEmitter<CellDragPayload>();
  @Output() cellDragLeave = new EventEmitter<CellDragPayload>();
  @Output() cellDrop      = new EventEmitter<CellDragPayload>();
  @Output() cellDragEnd   = new EventEmitter<void>();

  constructor(private layoutSvc: BoardLayoutService) {}

  ngOnChanges(changes: SimpleChanges): void {
    const cp = changes['centerPict'];
    if (cp && cp.currentValue != null && cp.currentValue !== cp.previousValue) {
      clearTimeout(this.animTimer);
      this.centerAnimating = false;
      this.animTimer = setTimeout(() => {
        this.centerAnimating = true;
        this.animTimer = setTimeout(() => { this.centerAnimating = false; }, 500);
      }, 16);
    }
  }

  // ── Geometría ─────────────────────────────────────────────────────────────

  /** Índices 0..n-1 de los slots exteriores. */
  get outerSlots(): number[] {
    const n = this.board?.circleSlots ?? 8;
    return Array.from({ length: n }, (_, i) => i);
  }

  /** true si la columna de ubicación está habilitada. */
  get locationColumnVisible(): boolean {
    return !!this.board?.locationColumnEnabled;
  }

  /** Índices 0..n-1 de la columna de ubicación. */
  get locationSlots(): number[] {
    if (!this.locationColumnVisible) return [];
    const n = this.board?.locationColumnSlots ?? 6;
    return Array.from({ length: n }, (_, i) => i);
  }

  /** Posición CSS (left/top %) del slot exterior i. */
  getSlotStyle(i: number): { left: string; top: string } {
    return this.layoutSvc.circleSlotStyle(i, this.board?.circleSlots ?? 8);
  }

  /** Tamaño en px de cada slot exterior. */
  get slotSizePx(): string {
    return this.layoutSvc.circleSlotSize(this.board?.circleSlots ?? 8);
  }

  // ── Datos de celda ────────────────────────────────────────────────────────

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.layoutSvc.getCellPict(this.board, row, col);
  }

  getCellBg(row: number, col: number): string {
    return getCellBgColor(this.layoutSvc.getCellData(this.board, row, col));
  }

  getCellBorder(row: number, col: number): string {
    return getCellBorderColor(this.layoutSvc.getCellData(this.board, row, col));
  }

  isDisabled(row: number, col: number): boolean {
    return isCellDisabled(this.layoutSvc.getCellData(this.board, row, col));
  }

  /** Pictograma del centro: usa override si está definido, si no lee del board. */
  get effectiveCenterPict(): CellPictogram | null {
    return this.centerPict !== undefined
      ? this.centerPict
      : this.getCellPict(0, -1);
  }

  /** Fondo del centro en preview/communicator: color del pictograma efectivo. */
  get effectiveCenterBg(): string {
    const p = this.effectiveCenterPict;
    return p ? getPictBgColor(p) : this.getCellBg(0, -1);
  }

  /** Borde del centro en preview/communicator: color del pictograma efectivo. */
  get effectiveCenterBorder(): string {
    const p = this.effectiveCenterPict;
    return p ? getPictBorderColor(p) : this.getCellBorder(0, -1);
  }

  // ── Tamaño del canvas según modo ──────────────────────────────────────────

  get canvasWidth(): string {
    switch (this.mode) {
      case 'preview':      return 'min(calc(100dvh - 200px), calc(100dvw - 60px), 520px)';
      case 'communicator': return 'min(calc(100dvh - 160px), calc(100dvw - 32px), 560px)';
      default:             return 'min(calc(100dvh - 140px), 480px)'; // edit
    }
  }

  // ── Helpers de estado ─────────────────────────────────────────────────────

  isSelected(row: number, col: number): boolean {
    return this.selectedCell?.row === row && this.selectedCell?.col === col;
  }

  isDragging(row: number, col: number): boolean {
    return this.draggedCell?.row === row && this.draggedCell?.col === col;
  }

  isDragOver(row: number, col: number): boolean {
    return this.dragOverCell?.row === row && this.dragOverCell?.col === col;
  }

  isMoveSrc(row: number, col: number): boolean {
    return this.moveSrcCell?.row === row && this.moveSrcCell?.col === col;
  }

  get isMoveMode(): boolean { return !!this.moveSrcCell; }

  get emptyType(): 'plus' | 'empty-div' {
    return this.mode === 'edit' ? 'plus' : 'empty-div';
  }

  // ── Manejadores de eventos (re-emiten hacia la page) ──────────────────────

  onSlotClick(row: number, col: number): void {
    this.cellClick.emit({ row, col });
  }

  onSlotDblClick(row: number, col: number): void {
    if (this.mode !== 'edit') return;
    this.cellDblClick.emit({ row, col });
  }

  onSlotDragStart(event: DragEvent, row: number, col: number): void {
    if (this.mode !== 'edit') return;
    event.dataTransfer?.setData('text/plain', '');
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.cellDragStart.emit({ event, row, col });
  }

  onSlotDragOver(event: DragEvent, row: number, col: number): void {
    if (this.mode !== 'edit') return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    this.cellDragOver.emit({ event, row, col });
  }

  onSlotDragLeave(event: DragEvent, row: number, col: number): void {
    if (this.mode !== 'edit') return;
    // Guardia: ignorar si el puntero se movió a un hijo (imagen, label).
    const target  = event.currentTarget as HTMLElement | null;
    const related = event.relatedTarget  as Node | null;
    if (target && related && target.contains(related)) return;
    this.cellDragLeave.emit({ event, row, col });
  }

  onSlotDrop(event: DragEvent, row: number, col: number): void {
    if (this.mode !== 'edit') return;
    event.preventDefault();
    this.cellDrop.emit({ event, row, col });
  }

  onSlotDragEnd(): void {
    if (this.mode !== 'edit') return;
    this.cellDragEnd.emit();
  }
}
