import { Injectable } from '@angular/core';
import { Board, BoardCell, CellPictogram } from './board.service';

/**
 * BoardLayoutService
 * Lógica reutilizable de layout de tablero: lookup de celdas y geometría circular.
 * Sin estado — todos los métodos son funciones puras sobre el Board recibido como parámetro.
 *
 * Usado por: board-builder-editor, communicator.
 */
@Injectable({ providedIn: 'root' })
export class BoardLayoutService {

  // ── Grid helpers ─────────────────────────────────────────────────────────────

  /** Lista ordenada de coordenadas {row, col} para un tablero grid estándar. */
  gridCells(board: Board | null): { row: number; col: number }[] {
    if (!board) return [];
    const cells: { row: number; col: number }[] = [];
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.columns; c++) {
        cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  /** Devuelve la BoardCell en (row, col), o null si no existe. */
  getCellData(board: Board | null, row: number, col: number): BoardCell | null {
    return board?.cells.find((c) => c.row === row && c.col === col) ?? null;
  }

  /** Devuelve el CellPictogram de la celda (row, col), o null si está vacía. */
  getCellPict(board: Board | null, row: number, col: number): CellPictogram | null {
    return this.getCellData(board, row, col)?.pictogram ?? null;
  }

  // ── Geometría circular ───────────────────────────────────────────────────────

  /**
   * Posición CSS (left %, top %) para la ranura exterior i de un total de n ranuras.
   * R = 44% → el centro del slot coincide con la línea del anillo (::before inset 6%).
   */
  circleSlotStyle(i: number, n: number): { left: string; top: string } {
    const angleDeg = (i / n) * 360 - 90;
    const angleRad = (angleDeg * Math.PI) / 180;
    const R = 44; // % desde el centro del canvas
    const left = 50 + R * Math.cos(angleRad);
    const top  = 50 + R * Math.sin(angleRad);
    return { left: `${left}%`, top: `${top}%` };
  }

  /**
   * Tamaño en px de cada slot exterior para N ranuras.
   * Cuerda a R=44% (ref. 400px canvas) = 2·176·sin(π/N). Límite 34–72 px.
   */
  circleSlotSize(N: number): string {
    const chord = 2 * 176 * Math.sin(Math.PI / N);
    const size  = Math.max(34, Math.min(72, Math.floor(chord * 0.78)));
    return `${size}px`;
  }
}
