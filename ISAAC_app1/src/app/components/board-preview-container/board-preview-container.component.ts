import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  Board, CircularControlsConfig, DEFAULT_CIRCULAR_CONTROLS_CONFIG,
} from '../../services/board.service';
import { BoardGridComponent, CellCoord } from '../board-grid/board-grid.component';
import { BoardCircularComponent } from '../board-circular/board-circular.component';
import { AacControlsBarComponent } from '../aac-controls-bar/aac-controls-bar.component';
import { AacCircularTopBarComponent } from '../aac-circular-top-bar/aac-circular-top-bar.component';
import { AacCircularRightBarComponent } from '../aac-circular-right-bar/aac-circular-right-bar.component';

/**
 * BoardPreviewContainerComponent
 *
 * Contiene la barra AAC y el tablero en modo preview.
 * - Tableros grid: barra horizontal estándar arriba + tablero.
 * - Tableros circulares: barra compacta superior + (tablero | barra vertical derecha).
 */
@Component({
  selector:    'app-board-preview-container',
  templateUrl: './board-preview-container.component.html',
  styleUrls:   ['./board-preview-container.component.scss'],
  standalone:  true,
  imports: [
    BoardGridComponent,
    BoardCircularComponent,
    AacControlsBarComponent,
    AacCircularTopBarComponent,
    AacCircularRightBarComponent,
  ],
})
export class BoardPreviewContainerComponent {

  // ── Inputs del tablero ────────────────────────────────────────────────────

  @Input() board:                Board | null = null;
  @Input() isCircular                         = false;
  @Input() previewCenterPict:    any          = null;
  @Input() circularSimMode                    = false;
  @Input() isCenterShowingLastPhrase          = false;
  @Input() canGoBack                          = false;

  /**
   * Configuración de barras para tableros circulares.
   * Si no se pasa, se usa board?.circularControlsConfig o el DEFAULT.
   */
  @Input() circularControlsConfig?: CircularControlsConfig;

  // ── Outputs ────────────────────────────────────────────────────────────────

  @Output() cellClick   = new EventEmitter<CellCoord>();
  @Output() homeClick   = new EventEmitter<void>();
  @Output() backClick   = new EventEmitter<void>();

  // ── Config efectiva ────────────────────────────────────────────────────────

  get effectiveCircularConfig(): CircularControlsConfig {
    return this.circularControlsConfig
      ?? this.board?.circularControlsConfig
      ?? DEFAULT_CIRCULAR_CONTROLS_CONFIG;
  }
}
