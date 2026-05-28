import { Component, Input } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AacPhraseItem }    from '../../services/aac-runtime.service';
import { buildSafeUrl }     from '../../shared/utils/image.utils';

/**
 * PhraseBandComponent — tira de frase AAC, puramente presentacional.
 *
 * Inputs:
 *   items       — AacPhraseItem[] (la frase actual)
 *   placeholder — texto vacío (opcional, hay valor por defecto)
 *
 * Sin Outputs. Toda la lógica (speak, delete, nav) queda en la página.
 *
 * Tematización: CSS custom properties con fallback al tema editor (gris).
 * Para el tema communicator, la página establece las variables en el elemento host.
 */
@Component({
  selector:    'app-phrase-band',
  templateUrl: './phrase-band.component.html',
  styleUrls:   ['./phrase-band.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class PhraseBandComponent {
  @Input() items: AacPhraseItem[] = [];
  @Input() placeholder = 'Pulsa un pictograma…';

  constructor(private sanitizer: DomSanitizer) {}

  buildUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrl(url, this.sanitizer);
  }
}
