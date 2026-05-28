import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Board } from '../../services/board.service';
import { BoardGridComponent, CellCoord } from '../board-grid/board-grid.component';
import { BoardCircularComponent } from '../board-circular/board-circular.component';
import { AacControlsBarComponent } from '../aac-controls-bar/aac-controls-bar.component';

/**
 * BoardPreviewContainerComponent
 *
 * Contiene la barra AAC (AacControlsBarComponent) y el tablero en modo preview.
 * Puramente presentacional respecto al tablero; la barra AAC se gestiona
 * internamente via AacRuntimeService (inyectado por AacControlsBarComponent).
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

  // ── Outputs ────────────────────────────────────────────────────────────────

  @Output() cellClick   = new EventEmitter<CellCoord>();
  @Output() homeClick   = new EventEmitter<void>();
  @Output() backClick   = new EventEmitter<void>();
}
