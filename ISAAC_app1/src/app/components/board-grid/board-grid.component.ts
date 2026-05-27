import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Board, BoardCell, CellPictogram } from '../../services/board.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import {
  getCellBgColor,
  getCellBorderColor,
  isCellDisabled,
} from '../../shared/utils/board-color.utils';
import { PictogramCellComponent, CellMode } from '../pictogram-cell/pictogram-cell.component';

/** Payload emitido junto a cada evento de celda (sin DragEvent para clicks simples). */
export interface CellCoord {
  row: number;
  col: number;
}

/** Payload emitido junto a los eventos de Drag & Drop. */
export interface CellDragPayload extends CellCoord {
  event: DragEvent;
}

/**
 * BoardGridComponent
 *
 * Renderiza un tablero de tipo "grid" (rejilla) de forma reutilizable.
 * Funciona en tres modos:
 *   - 'edit'          → celdas seleccionables, DnD, modo mover táctil
 *   - 'preview'       → celdas clickables (AAC), sin DnD
 *   - 'communicator'  → celdas clickables (AAC), sin DnD, sin card wrapper
 *
 * El componente NO gestiona estado: toda la lógica (qué celda está seleccionada,
 * cuál se arrastra, ejecutar el movimiento, etc.) permanece en la page.
 * Los eventos se propagan hacia arriba como @Output.
 *
 * Colores Fitzgerald: calculados internamente a partir de board-color.utils.
 * IA column: visible en edit/preview cuando board.predictorEnabled es true.
 *
 * Usado por: board-builder-editor.page (edit + preview), communicator.page.
 */
@Component({
  selector: 'app-board-grid',
  templateUrl: './board-grid.component.html',
  styleUrls: ['./board-grid.component.scss'],
  standalone: true,
  imports: [PictogramCellComponent],
  host: {
    '[class.bgc--edit]':         "mode === 'edit'",
    '[class.bgc--preview]':      "mode === 'preview'",
    '[class.bgc--communicator]': "mode === 'communicator'",
  },
})
export class BoardGridComponent {

  // ── Datos ────────────────────────────────────────────────────────────────
  @Input() board: Board | null = null;

  // ── Modo ─────────────────────────────────────────────────────────────────
  @Input() mode: CellMode = 'communicator';

  // ── Estado de interacción (gestionado por la page) ───────────────────────
  @Input() selectedCell: CellCoord | null = null;
  @Input() draggedCell:  CellCoord | null = null;
  @Input() dragOverCell: CellCoord | null = null;
  @Input() moveSrcCell:  CellCoord | null = null;

  // ── Eventos hacia la page ────────────────────────────────────────────────
  @Output() cellClick     = new EventEmitter<CellCoord>();
  @Output() cellDblClick  = new EventEmitter<CellCoord>();
  @Output() cellDragStart = new EventEmitter<CellDragPayload>();
  @Output() cellDragOver  = new EventEmitter<CellDragPayload>();
  @Output() cellDragLeave = new EventEmitter<CellDragPayload>();
  @Output() cellDrop      = new EventEmitter<CellDragPayload>();
  @Output() cellDragEnd   = new EventEmitter<void>();

  constructor(private boardLayoutSvc: BoardLayoutService) {}

  // ── Grid helpers ──────────────────────────────────────────────────────────

  get gridCells(): CellCoord[] {
    return this.boardLayoutSvc.gridCells(this.board);
  }

  getCellData(row: number, col: number): BoardCell | null {
    return this.boardLayoutSvc.getCellData(this.board, row, col);
  }

  getCellPict(row: number, col: number): CellPictogram | null {
    return this.boardLayoutSvc.getCellPict(this.board, row, col);
  }

  // ── Colores (delegados a utils) ───────────────────────────────────────────

  getCellBgColor(row: number, col: number): string {
    return getCellBgColor(this.getCellData(row, col));
  }

  getCellBorderColor(row: number, col: number): string {
    return getCellBorderColor(this.getCellData(row, col));
  }

  getCellIsDisabled(row: number, col: number): boolean {
    return isCellDisabled(this.getCellData(row, col));
  }

  // ── Estado de interacción (helpers para el template) ─────────────────────

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

  get isMoveMode(): boolean {
    return !!this.moveSrcCell;
  }

  // ── Columna Predictor IA ──────────────────────────────────────────────────

  /** La columna IA solo tiene sentido en edit/preview (nunca en communicator). */
  get iaColumnVisible(): boolean {
    return this.mode !== 'communicator' && !!this.board?.predictorEnabled;
  }

  get iaCells(): number[] {
    const rows = this.board?.iaRows ?? 5;
    const cols = this.board?.iaCols ?? 1;
    return Array.from({ length: rows * cols }, (_, i) => i);
  }

  // ── Style helpers para el template ───────────────────────────────────────

  get gridColsStyle(): string {
    return `repeat(${this.board?.columns ?? 4}, 1fr)`;
  }

  get gridRowsStyle(): string {
    return `repeat(${this.board?.rows ?? 3}, 1fr)`;
  }

  get iaColsStyle(): string {
    return `repeat(${this.board?.iaCols ?? 1}, 1fr)`;
  }

  // ── Manejadores de eventos: re-emiten con coordenadas ─────────────────────
  // Se usan directamente en el template para evitar lambdas inline.

  onCellClick(row: number, col: number): void {
    this.cellClick.emit({ row, col });
  }

  onCellDblClick(row: number, col: number): void {
    this.cellDblClick.emit({ row, col });
  }

  onCellDragStart(event: DragEvent, row: number, col: number): void {
    console.log('[DND grid dragstart]', row, col);
    this.cellDragStart.emit({ event, row, col });
  }

  onCellDragOver(event: DragEvent, row: number, col: number): void {
    console.log('[DND grid dragover]', row, col);
    this.cellDragOver.emit({ event, row, col });
  }

  onCellDragLeave(event: DragEvent, row: number, col: number): void {
    this.cellDragLeave.emit({ event, row, col });
  }

  onCellDrop(event: DragEvent, row: number, col: number): void {
    console.log('[DND grid drop]', row, col);
    this.cellDrop.emit({ event, row, col });
  }

  onCellDragEnd(): void {
    this.cellDragEnd.emit();
  }
}
