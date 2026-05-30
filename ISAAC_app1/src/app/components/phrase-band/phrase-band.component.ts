import { Component, Input } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { AacPhraseItem }    from '../../services/aac-runtime.service';
import { CellPictogram }    from '../../services/board.service';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';

/**
 * PhraseBandComponent — tira de frase AAC, puramente presentacional.
 *
 * Delega el renderizado de cada item a PictCellContentComponent
 * para no duplicar la lógica de imagen+label.
 *
 * Tematización: CSS custom properties con fallback al tema editor.
 *   --pb-item-width  / --pb-item-height  controlan el tamaño de cada item.
 *   --pb-strip-bg    / --pb-strip-border  controlan el contenedor.
 *   --pb-item-border  borde de cada item.
 *   --pb-placeholder-color
 */
@Component({
  selector:    'app-phrase-band',
  templateUrl: './phrase-band.component.html',
  styleUrls:   ['./phrase-band.component.scss'],
  standalone:  true,
  imports:     [CommonModule, PictCellContentComponent],
})
export class PhraseBandComponent {
  @Input() items: AacPhraseItem[] = [];
  @Input() placeholder = 'Pulsa un pictograma…';

  toCell(item: AacPhraseItem): CellPictogram {
    return {
      source:            'arasaac',
      id:                item.id,
      label:             item.label,
      imageUrl:          item.imageUrl,
      sound:             item.sound,
      tags:              [],
      description:       '',
      wordType:          (item.wordType ?? 'misc') as any,
      fitzgeraldEnabled: false,
      color:             item.color ?? '',
    };
  }
}
