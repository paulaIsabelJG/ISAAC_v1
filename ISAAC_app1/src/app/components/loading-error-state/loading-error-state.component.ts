import { Component, Input } from '@angular/core';
import { IonicModule } from '@ionic/angular';

/**
 * LoadingErrorStateComponent
 * Muestra un spinner de carga o un mensaje de error centrado.
 * Si ninguno aplica, no renderiza nada.
 *
 * Usado en: user-personal-data, user-final-form, user-session,
 *           board-builder, board-builder-editor,
 *           own-pictograms-placeholder, assigned-professionals-placeholder.
 */
@Component({
  selector:    'app-loading-error-state',
  templateUrl: './loading-error-state.component.html',
  styleUrls:   ['./loading-error-state.component.scss'],
  standalone:  true,
  imports:     [IonicModule],
  host: {
    '[style.padding]': 'padding',
  },
})
export class LoadingErrorStateComponent {
  /** Muestra el spinner cuando es true. */
  @Input() loading = false;

  /** Muestra el icono de error + texto cuando no está vacío. */
  @Input() error = '';

  /**
   * Color del spinner (Ionic color token).
   * 'primary' = azul · 'secondary' = morado/violet
   */
  @Input() spinnerColor: 'primary' | 'secondary' = 'primary';

  /**
   * Texto opcional bajo el spinner (ej. "Cargando pictogramas…").
   * Si está vacío, solo se muestra el spinner.
   */
  @Input() loadingText = '';

  /**
   * Padding del bloque. Permite que cada página preserve su espaciado original.
   * Default 60px 20px coincide con la mayoría de páginas.
   */
  @Input() padding = '60px 20px';
}
