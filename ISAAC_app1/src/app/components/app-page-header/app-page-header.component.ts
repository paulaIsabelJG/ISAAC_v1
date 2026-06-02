import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';

/**
 * Cabecera de página reutilizable.
 *
 * Uso básico:
 *   <app-page-header title="TÍTULO" backHref="/ruta" (backClick)="goBack()">
 *   </app-page-header>
 *
 * Con acciones al final (proyección de contenido):
 *   <app-page-header title="TÍTULO" backHref="/ruta" (backClick)="goBack()">
 *     <ion-buttons slot="end">
 *       <button ...>Acción</button>
 *     </ion-buttons>
 *   </app-page-header>
 *
 * Sin botón volver:
 *   <app-page-header title="TÍTULO" [showBack]="false">
 *   </app-page-header>
 *
 * Tematización (CSS custom properties en la page SCSS):
 *   app-page-header {
 *     --aph-bg:           #20c997;
 *     --aph-border:       transparent;
 *     --aph-shadow:       0 2px 12px rgba(32,201,151,0.28);
 *     --aph-toolbar-color: #ffffff;
 *     --aph-back-color:   #ffffff;
 *     --aph-title-color:  #ffffff;
 *     --aph-title-size:   17px;
 *     --aph-title-ls:     0.5px;
 *   }
 */
@Component({
  selector:    'app-page-header',
  templateUrl: './app-page-header.component.html',
  styleUrls:   ['./app-page-header.component.scss'],
  standalone:  true,
  imports:     [IonicModule],
})
export class AppPageHeaderComponent {
  /** Texto que aparece como título centrado. */
  @Input() title     = '';

  /** Muestra el botón ← Volver. Por defecto true. */
  @Input() showBack  = true;

  /** defaultHref del ion-back-button (fallback de navegación). */
  @Input() backHref  = '';

  /** Texto junto a la flecha del botón volver. */
  @Input() backText  = 'Volver';

  /** Se emite cuando el usuario pulsa el botón volver. */
  @Output() backClick = new EventEmitter<void>();

  onBackClick(_event: Event): void {
    this.backClick.emit();
  }
}
