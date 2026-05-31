import { Injectable } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { WordType } from '../shared/constants/fitzgerald';

// WordType, FitzgeraldColor, FITZGERALD_COLORS → shared/constants/fitzgerald.ts

// ─── Modelo de pictograma propio ──────────────────────────────────────────────
export interface OwnPictogram {
  id:           string;
  name:         string;
  wordType:     WordType;
  imageB64:     string;    // base64 original (para futura persistencia)
  safeImageUrl: SafeUrl;   // pre-sanitizado para uso directo en [src]
  description?: string;
}

// ─── Servicio singleton — persiste mientras viva la instancia ─────────────────
@Injectable({ providedIn: 'root' })
export class PictogramStateService {
  /**
   * userId del usuario final seleccionado/editado.
   * null → sin usuario seleccionado aún (muestra selector).
   * string → usuario cargado desde backend.
   */
  userId: string | null = null;

  /** Lista en memoria; usada cuando userId === null en flujo de creación */
  pictograms: OwnPictogram[] = [];

  /** Ruta a la que volver al presionar "Atrás" en los placeholders */
  returnTo = '/add-user';

  /**
   * Usuarios permitidos en el selector.
   * null → la página carga todos los usuarios del centro (rol org).
   * Array → lista predefinida (rol profesional con sus usuarios asignados).
   */
  allowedUsers: Array<{ id: string; name: string }> | null = null;
}
