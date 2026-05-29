/**
 * board-color.utils.ts
 *
 * Funciones puras de color para celdas de tablero (Fitzgerald + manual).
 * Sin estado, sin dependencias de servicio.
 * Usadas por: PictogramCellComponent, BoardGridComponent,
 *             board-builder-editor (legacy — mientras no se migre).
 */

import { BoardCell, CellPictogram } from '../../services/board.service';
import { FITZGERALD, WordType } from '../constants/fitzgerald';

/** true si la acción de la celda es 'disabled' */
export function isCellDisabled(cell: BoardCell | null): boolean {
  return cell?.action?.type === 'disabled';
}

/** Color base (Fitzgerald o manual) de un pictograma. null si no hay pictograma. */
function getCellBaseColor(pict: CellPictogram | null): string | null {
  if (!pict) return null;
  return pict.fitzgeraldEnabled
    ? (FITZGERALD[pict.wordType as WordType] ?? '#f5f5f5')
    : pict.color || '#f5f5f5';
}

/**
 * Fondo de la celda:
 * - Deshabilitada → gris claro
 * - Sin pictograma → blanco
 * - Con pictograma → tinte muy claro del color base (20% + blanco)
 */
export function getCellBgColor(cell: BoardCell | null): string {
  if (isCellDisabled(cell)) return '#eeeeee';
  const base = getCellBaseColor(cell?.pictogram ?? null);
  if (!base) return '#ffffff';
  return `color-mix(in srgb, ${base} 20%, white)`;
}

/**
 * Borde de la celda:
 * - Deshabilitada → gris medio
 * - Sin pictograma → rosa por defecto
 * - Blanco puro → gris visible
 * - Con pictograma → versión semisaturada del color base (55% + blanco)
 */
export function getCellBorderColor(cell: BoardCell | null): string {
  if (isCellDisabled(cell)) return '#bdbdbd';
  const base = getCellBaseColor(cell?.pictogram ?? null);
  if (!base) return '#ffb6c1';                                    // rosa por defecto (celda vacía)
  if (base === '#ffffff' || base === '#f5f5f5') return '#cccccc'; // misc / near-white → borde gris visible
  return `color-mix(in srgb, ${base} 55%, white)`;
}
