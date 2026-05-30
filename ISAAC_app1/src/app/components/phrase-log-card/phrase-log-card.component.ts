import { Component, Input } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { ReconstructedPhrase, PhraseInteraction } from '../../services/aac-statistics.service';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';
import { CellPictogram }  from '../../services/board.service';

@Component({
  selector:    'app-phrase-log-card',
  templateUrl: './phrase-log-card.component.html',
  styleUrls:   ['./phrase-log-card.component.scss'],
  standalone:  true,
  imports:     [CommonModule, PictCellContentComponent],
})
export class PhraseLogCardComponent {
  @Input() phrase!: ReconstructedPhrase;

  expanded = false;

  toggleExpanded(): void { this.expanded = !this.expanded; }

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
      fitzgeraldEnabled: !!(inter.color),
      color:             inter.color || '',
    };
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
