import { Component, Input, HostBinding } from '@angular/core';

/**
 * IaPredictorColumnComponent
 *
 * Columna visual del Predictor IA reutilizable en todos los contextos:
 *   - Tablero cuadrícula (editor/preview/communicator)
 *   - Multitablero (slot izquierdo)
 *
 * Las celdas se distribuyen en un grid de `rows × cols` que rellena
 * todo el espacio disponible gracias a grid-template-rows: repeat(N, 1fr).
 *
 * Inputs:
 *   rows       — número de filas de celdas IA (default 5)
 *   cols       — número de columnas de celdas IA (default 1)
 *   showHeader — muestra la cabecera "Predictor IA" (default false)
 *   embedded   — true: sin borde/fondo propio (el contenedor padre los provee)
 */
@Component({
  selector:    'app-ia-predictor-column',
  templateUrl: './ia-predictor-column.component.html',
  styleUrls:   ['./ia-predictor-column.component.scss'],
  standalone:  true,
})
export class IaPredictorColumnComponent {

  @Input() rows       = 5;
  @Input() cols       = 1;
  @Input() showHeader = false;
  /** Cuando es true el host no aplica borde/fondo: el contenedor padre los provee. */
  @Input() embedded   = false;

  @HostBinding('class.ipc--embedded') get isEmbedded() { return this.embedded; }

  get cells(): number[] {
    return Array.from({ length: this.rows * this.cols }, (_, i) => i);
  }

  /**
   * En modo embebido (slot de multitablero con ancho fijo): 1fr → rellena el slot.
   * En modo autónomo (columna junto al tablero): ancho natural fijo por celda.
   */
  get gridColsStyle(): string {
    return this.embedded
      ? `repeat(${this.cols}, 1fr)`
      : `repeat(${this.cols}, minmax(60px, 90px))`;
  }

  get gridRowsStyle(): string { return `repeat(${this.rows}, 1fr)`; }
}
