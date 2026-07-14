import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { ReconstructedPhrase, PhraseInteraction } from '../../services/aac-statistics.service';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';
import { CellPictogram }  from '../../services/board.service';
import { getPictBgColor, getPictBorderColor } from '../../shared/utils/board-color.utils';

@Component({
  selector:    'app-phrase-log-card',
  templateUrl: './phrase-log-card.component.html',
  styleUrls:   ['./phrase-log-card.component.scss'],
  standalone:  true,
  imports:     [CommonModule, PictCellContentComponent],
})
export class PhraseLogCardComponent {
  @Input()  phrase!: ReconstructedPhrase;
  @Output() deleteClick = new EventEmitter<void>();
  @Output() comprehensionChange = new EventEmitter<number>();

  expanded = false;

  readonly comprehensionScores = [1, 2, 3, 4, 5];

  toggleExpanded(): void { this.expanded = !this.expanded; }

  onDeleteClick(event: MouseEvent): void {
    event.stopPropagation();
    this.deleteClick.emit();
  }

  onComprehensionClick(event: MouseEvent, score: number): void {
    event.stopPropagation();
    if (this.phrase.comprehensionScore === score) return;
    this.comprehensionChange.emit(score);
  }

  /** Convierte una interacción de pictograma en CellPictogram para pict-cell-content. */
  toCell(inter: PhraseInteraction): CellPictogram {
    return {
      source:            'arasaac',
      id:                inter.buttonId || '',
      label:             inter.label,
      imageUrl:          inter.imageUrl || '',
      sound:             inter.label,
      tags:              [],
      description:       '',
      wordType:          (inter.wordType || 'misc') as any,
      // inter.color ya almacena el hex efectivo (resuelto desde Fitzgerald o manual)
      // — no volvemos a activar fitzgeraldEnabled para evitar doble resolución.
      fitzgeraldEnabled: false,
      color:             inter.color || '',
    };
  }

  /** Fondo del pictograma: tinte 20% del color efectivo (igual que en el tablero). */
  pictBg(inter: PhraseInteraction): string {
    return getPictBgColor(this.toCell(inter));
  }

  /** Borde del pictograma: versión semisaturada del color efectivo. */
  pictBorder(inter: PhraseInteraction): string {
    return getPictBorderColor(this.toCell(inter));
  }

  /** Formatea ms en "Xm Ys" legible. */
  formatDuration(ms: number): string {
    if (!ms || ms < 0) return '< 1 s';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  /** Etiqueta corta para acciones del sistema. */
  actionLabel(inter: PhraseInteraction): string {
    const map: Record<string, string> = {
      ':backspace': '← borrar',
      ':clear':     '✕ limpiar',
      ':speak':     '🔊 hablar',
      ':back':      '← atrás',
      ':home':      '⌂ inicio',
    };
    return map[inter.actionType || ''] || inter.label || inter.actionType || '?';
  }
}
