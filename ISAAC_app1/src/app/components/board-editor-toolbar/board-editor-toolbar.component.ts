import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';

/**
 * BoardEditorToolbarComponent
 *
 * Cabecera (ion-header) del editor de tableros.
 * Gestiona dos estados visuales:
 *   - Modo edición  → botón volver + nombre del tablero + acciones (perfil, exportar, preview)
 *   - Modo preview  → botón "← Editar" + título "VISTA PREVIA"
 *
 * Es puramente presentacional: no llama a ningún servicio ni router.
 * Toda la lógica vive en la page, que recibe los @Output y actúa.
 *
 * Patrón de uso:
 *   <app-board-editor-toolbar
 *     [previewMode]="previewMode"
 *     [boardName]="board?.name ?? ''"
 *     [canAddToProfile]="canAddToProfile"
 *     [isInProfile]="isInProfile"
 *     (togglePreview)="togglePreview()"
 *     (goBack)="goBack()"
 *     (exportOBZ)="exportOBZ()"
 *     (addToProfile)="addToProfile()"
 *     (removeFromProfile)="removeFromProfile()">
 *   </app-board-editor-toolbar>
 */
@Component({
  selector: 'app-board-editor-toolbar',
  templateUrl: './board-editor-toolbar.component.html',
  styleUrls: ['./board-editor-toolbar.component.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class BoardEditorToolbarComponent {
  // ── Inputs ─────────────────────────────────────────────────────────────────
  /** true cuando el editor está en modo vista previa. */
  @Input() previewMode = false;
  /** Nombre del tablero que se muestra en el título. */
  @Input() boardName = '';
  /** Mostrar el botón "Añadir al perfil" (solo tableros principales con usuario). */
  @Input() canAddToProfile = false;
  /** true cuando el tablero ya está visible en el perfil del usuario. */
  @Input() isInProfile = false;

  // ── Outputs ────────────────────────────────────────────────────────────────
  /** Alterna entre modo edición y modo vista previa. */
  @Output() togglePreview    = new EventEmitter<void>();
  /** Navega hacia atrás al board-builder (con contexto). */
  @Output() goBack           = new EventEmitter<void>();
  /** Lanza la exportación OBZ del tablero activo. */
  @Output() exportOBZ        = new EventEmitter<void>();
  /** Lanza la exportación PDF del tablero activo. */
  @Output() exportPdf        = new EventEmitter<void>();

  onDownloadOBZ(): void { this.exportOBZ.emit(); }
  onDownloadPdf(): void { this.exportPdf.emit(); }

  /** Añade el tablero al perfil del usuario asignado. */
  @Output() addToProfile     = new EventEmitter<void>();
  /** Quita el tablero del perfil del usuario asignado. */
  @Output() removeFromProfile = new EventEmitter<void>();

  // ── Handlers internos ──────────────────────────────────────────────────────

  /**
   * ion-back-button emite un click que Ionic intercepta para navegar hacia atrás.
   * stopImmediatePropagation() cancela esa navegación automática y cede el control
   * a la page (que usa goBack() con queryParams de contexto).
   */
  onBackClick(event: Event): void {
    event.stopImmediatePropagation();
    this.goBack.emit();
  }

  onProfileToggle(): void {
    if (this.isInProfile) {
      this.removeFromProfile.emit();
    } else {
      this.addToProfile.emit();
    }
  }
}
