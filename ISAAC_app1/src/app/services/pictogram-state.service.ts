import { Injectable } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';

// ─── Tipos de palabra (colores Fitzgerald) ────────────────────────────────────
export type WordType = 'verb' | 'pronoun' | 'noun' | 'descriptor' | 'social' | 'misc';

export interface FitzgeraldColor {
  type:  WordType;
  label: string;
  bg:    string;   // color de fondo
  text:  string;   // color del texto sobre ese fondo
  help:  string;   // texto descriptivo
}

export const FITZGERALD: FitzgeraldColor[] = [
  { type: 'verb',       label: 'Verbo / Acción',       bg: '#43a047', text: '#fff',     help: 'Acciones, movimientos, verbos' },
  { type: 'pronoun',    label: 'Pronombre / Persona',   bg: '#fdd835', text: '#3a3200', help: 'Personas y pronombres personales' },
  { type: 'noun',       label: 'Sustantivo',            bg: '#fb8c00', text: '#fff',     help: 'Objetos, lugares, sustantivos' },
  { type: 'descriptor', label: 'Descriptor / Adjetivo', bg: '#1e88e5', text: '#fff',     help: 'Cualidades, colores, adjetivos' },
  { type: 'social',     label: 'Social / Cortesía',     bg: '#8e24aa', text: '#fff',     help: 'Saludos, cortesía, afirmaciones' },
  { type: 'misc',       label: 'Miscelánea',            bg: '#eeeeee', text: '#444444', help: 'Sin categoría específica' },
];

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
