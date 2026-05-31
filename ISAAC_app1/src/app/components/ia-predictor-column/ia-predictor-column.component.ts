import { Component, Input, Output, EventEmitter, HostBinding } from '@angular/core';
import { PredictedPictogram } from '../../services/aac-prediction.service';

/**
 * IaPredictorColumnComponent
 *
 * Columna visual del Predictor IA reutilizable en todos los contextos:
 *   - Tablero cuadrícula (editor/preview/communicator)
 *   - Multitablero (slot izquierdo)
 *
 * Inputs:
 *   rows        — número de filas de celdas IA (default 5)
 *   cols        — número de columnas de celdas IA (default 1)
 *   showHeader  — muestra la cabecera "Predictor IA" (default false)
 *   embedded    — true: sin borde/fondo propio (el contenedor padre los provee)
 *   predictions — array de pictogramas predichos; las celdas sobrantes muestran placeholder
 *
 * Outputs:
 *   cellPress   — emite el PredictedPictogram cuando el usuario pulsa una celda activa
 */
@Component({
  selector:    'app-ia-predictor-column',
  templateUrl: './ia-predictor-column.component.html',
  styleUrls:   ['./ia-predictor-column.component.scss'],
  standalone:  true,
})
export class IaPredictorColumnComponent {

  @Input() rows        = 5;
  @Input() cols        = 1;
  @Input() showHeader  = false;
  @Input() embedded    = false;
  @Input() predictions: PredictedPictogram[] = [];

  @Output() cellPress = new EventEmitter<PredictedPictogram>();

  @HostBinding('class.ipc--embedded') get isEmbedded() { return this.embedded; }

  get cells(): number[] {
    return Array.from({ length: this.rows * this.cols }, (_, i) => i);
  }

  get gridColsStyle(): string { return `repeat(${this.cols}, 1fr)`; }
  get gridRowsStyle():  string { return `repeat(${this.rows}, 1fr)`; }

  onCellClick(pict: PredictedPictogram): void {
    this.cellPress.emit(pict);
  }

  /** Fondo de celda activa — replica getPictBgColor() de board-color.utils.ts. */
  cellBg(color: string): string {
    if (!color) return '#ffffff';
    return `color-mix(in srgb, ${color} 20%, white)`;
  }

  /** Borde de celda activa — replica getPictBorderColor() de board-color.utils.ts. */
  cellBorder(color: string): string {
    if (!color) return '#ffb6c1';
    if (color === '#ffffff' || color === '#f5f5f5') return '#cccccc';
    return `color-mix(in srgb, ${color} 55%, white)`;
  }
}
