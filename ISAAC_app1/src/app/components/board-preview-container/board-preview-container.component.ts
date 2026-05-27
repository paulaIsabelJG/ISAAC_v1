import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Board, CellPictogram } from '../../services/board.service';
import { BoardGridComponent, CellCoord } from '../board-grid/board-grid.component';
import { BoardCircularComponent } from '../board-circular/board-circular.component';
import { PhraseBandComponent } from '../phrase-band/phrase-band.component';

/**
 * BoardPreviewContainerComponent
 *
 * Contiene toda la vista previa del editor de tableros:
 *   - Barra AAC  (botones + PhraseBandComponent)
 *   - Tablero en modo preview  (BoardGridComponent o BoardCircularComponent)
 *
 * Filosofía:
 *   - Puramente presentacional: no tiene lógica AAC ni de navegación propia.
 *   - La page proporciona el estado via @Input y reacciona a los @Output.
 *   - speakRequest / deleteLastRequest / clearPhraseRequest → la page delega
 *     en AacRuntimeService; cellClick → la page decide cómo procesar el tap.
 */
@Component({
  selector:    'app-board-preview-container',
  templateUrl: './board-preview-container.component.html',
  styleUrls:   ['./board-preview-container.component.scss'],
  standalone:  true,
  imports: [
    BoardGridComponent,
    BoardCircularComponent,
    PhraseBandComponent,
  ],
})
export class BoardPreviewContainerComponent {

  // ── Inputs ─────────────────────────────────────────────────────────────────

  /** Tablero a renderizar en preview. */
  @Input() board: Board | null = null;

  /** Frase AAC acumulada (la page la actualiza tras cada tap). */
  @Input() aacPhrase: CellPictogram[] = [];

  /** true cuando el tablero es de tipo circular. */
  @Input() isCircular = false;

  // ── Inputs circulares ─────────────────────────────────────────────────────

  /** Pictograma que muestra la celda central en modo preview/sim. */
  @Input() previewCenterPict: CellPictogram | null = null;

  /** true cuando la simulación IA está activa (picto AI en el centro). */
  @Input() circularSimMode = false;

  /**
   * true cuando la celda central tiene showLastPhrase=true:
   * muestra el último pictograma de la frase en lugar del pictograma fijo.
   */
  @Input() isCenterShowingLastPhrase = false;

  // ── Outputs ────────────────────────────────────────────────────────────────

  /**
   * Emitido cuando el usuario toca una celda del tablero.
   * La page llama a handlePreviewCellClick / handleCircularPreviewClick.
   */
  @Output() cellClick          = new EventEmitter<CellCoord>();

  /** Emitido al pulsar el botón altavoz. La page llama a aacRuntime.speakPhrase(). */
  @Output() speakRequest       = new EventEmitter<void>();

  /** Emitido al pulsar ← (borrar último). La page llama a aacRuntime.deleteLast(). */
  @Output() deleteLastRequest  = new EventEmitter<void>();

  /** Emitido al pulsar 🏠 o 🗑 (limpiar frase). La page llama a aacRuntime.clearPhrase(). */
  @Output() clearPhraseRequest = new EventEmitter<void>();
}
