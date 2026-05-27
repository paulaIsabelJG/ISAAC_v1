import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../utils/image.utils';
import { Board } from '../../../services/board.service';

/**
 * Tarjeta visual minimalista para un tablero.
 *
 * Muestra: imagen de portada (o icono SVG por defecto) + nombre.
 * No contiene lógica de selección, edición ni eliminación.
 *
 * Uso:
 *   <app-board-mini-card [board]="board" (cardClick)="openBoard($event)">
 *   </app-board-mini-card>
 */
@Component({
  selector:    'app-board-mini-card',
  templateUrl: './board-mini-card.component.html',
  styleUrls:   ['./board-mini-card.component.scss'],
  standalone:  true,
  imports:     [],
  host:        { style: 'display: block' },
})
export class BoardMiniCardComponent {
  /** El tablero a mostrar. */
  @Input() board!: Board;

  /** Emite el tablero cuando el usuario pulsa la tarjeta. */
  @Output() cardClick = new EventEmitter<Board>();

  constructor(private sanitizer: DomSanitizer) {}

  /** URL segura de la imagen de portada (vacía si no hay imagen). */
  get safeImageUrl(): SafeUrl | string {
    return buildSafeUrlUtil(this.board?.imageUrl, this.sanitizer);
  }
}
