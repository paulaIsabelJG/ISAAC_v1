import { Component, Input } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { CellPictogram } from '../../services/board.service';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';

/**
 * Átomo visual: contenido interno de una celda de pictograma.
 *
 * Renderiza SOLO el interior de la celda: image-wrap + img|placeholder + label
 * + badge opcional.  El div externo con clicks, DND y clases de estado queda
 * siempre en el padre (board-builder-editor, communicator…).
 *
 * Host display:contents → el elemento host es transparente al layout.
 * Sus hijos son grid-items directos del padre (.bbe-cell, .bbe-loc-cell…),
 * respetando grid-template-rows:1fr auto y los cqi del container del padre.
 *
 * Inputs:
 *   pict             – CellPictogram | null (null → muestra estado vacío)
 *   showDisabledBadge – true → badge "OFF" absoluto (solo grid editor)
 *   emptyType         – 'plus' (editor) | 'empty-div' (vista previa)
 */
@Component({
  selector: 'app-pict-cell-content',
  templateUrl: './pict-cell-content.component.html',
  styleUrls: ['./pict-cell-content.component.scss'],
  standalone: true,
  imports: [],
  host: { style: 'display: contents' },
})
export class PictCellContentComponent {

  /** Pictograma a renderizar; null muestra el estado vacío. */
  @Input() pict: CellPictogram | null = null;

  /**
   * Muestra el badge "OFF" superpuesto (posición absoluta).
   * Solo relevante en las celdas del grid editor con acción 'disabled'.
   */
  @Input() showDisabledBadge = false;

  /**
   * Tipo de indicador cuando pict es null.
   *   'plus'      → <span>+</span>         (editor: celda vacía clickable)
   *   'empty-div' → <div class="pcc-empty"> (preview: espacio reservado)
   */
  @Input() emptyType: 'plus' | 'empty-div' = 'plus';

  /** Recuerda el último imageUrl que falló al cargar, para no reintentar el mismo. */
  private failedImageUrl: string | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  /** URL segura para data-URIs base64; URL normal se devuelve sin modificar. */
  get safeImageUrl(): SafeUrl | string {
    return buildSafeUrlUtil(this.pict?.imageUrl, this.sanitizer);
  }

  /** true si hay imagen y no falló ya al cargar (fallback visual, no principal). */
  get showImage(): boolean {
    return !!this.pict?.imageUrl && this.pict.imageUrl !== this.failedImageUrl;
  }

  /** onerror del <img>: cae al placeholder en vez de mostrar el icono roto del navegador. */
  onImageError(): void {
    this.failedImageUrl = this.pict?.imageUrl ?? null;
  }
}
