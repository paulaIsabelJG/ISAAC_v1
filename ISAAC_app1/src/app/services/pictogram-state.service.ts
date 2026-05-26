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
   * null → modo memoria (usuario aún no guardado en backend).
   * string → modo backend (pictogramas se cargan y persisten contra la API).
   */
  userId: string | null = null;

  /** Lista en memoria; usada cuando userId === null */
  pictograms: OwnPictogram[] = [];
}
