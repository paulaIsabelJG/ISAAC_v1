/**
 * Fuente de verdad única para el sistema de colores Fitzgerald de ISAAC.
 *
 * Exporta dos formas complementarias:
 *   - FITZGERALD          — Record<WordType, string>  — color de fondo para celdas de tablero
 *   - FITZGERALD_COLORS   — FitzgeraldColor[]         — paleta completa (bg + text + help) para selectores UI
 *
 * Nota: los valores bg de FITZGERALD_COLORS difieren ligeramente de FITZGERALD
 * (p.ej. verb: '#43a047' vs '#4caf50'). Se preservan para no alterar el
 * aspecto visual existente; pendiente unificar en una futura fase.
 */

// ─── Tipo de palabra ──────────────────────────────────────────────────────────

export type WordType = 'verb' | 'pronoun' | 'noun' | 'descriptor' | 'social' | 'misc';

// ─── Etiquetas legibles ───────────────────────────────────────────────────────

export const WORD_TYPE_LABELS: Record<WordType, string> = {
  verb:       'Verbo / acción',
  pronoun:    'Pronombre / persona',
  noun:       'Sustantivo',
  descriptor: 'Descriptor / adjetivo',
  social:     'Social / cortesía',
  misc:       'Miscelánea',
};

// ─── Colores de celda de tablero ──────────────────────────────────────────────
// Usados para colorear bordes/fondos de celdas en board-builder y board-builder-editor.

export const FITZGERALD: Record<WordType, string> = {
  verb:       '#4caf50',
  pronoun:    '#ffd700',
  noun:       '#ff9800',
  descriptor: '#2196f3',
  social:     '#9c27b0',
  misc:       '#f5f5f5',
};

// ─── Paleta completa (bg + text + label + help) ───────────────────────────────
// Usada en el selector de pictogramas propios (own-pictograms-placeholder).

export interface FitzgeraldColor {
  type:  WordType;
  label: string;
  bg:    string;   // color de fondo del chip/badge
  text:  string;   // color del texto sobre ese fondo
  help:  string;   // descripción corta para ayuda contextual
}

export const FITZGERALD_COLORS: FitzgeraldColor[] = [
  { type: 'verb',       label: 'Verbo / Acción',       bg: '#43a047', text: '#fff',     help: 'Acciones, movimientos, verbos' },
  { type: 'pronoun',    label: 'Pronombre / Persona',   bg: '#fdd835', text: '#3a3200', help: 'Personas y pronombres personales' },
  { type: 'noun',       label: 'Sustantivo',            bg: '#fb8c00', text: '#fff',     help: 'Objetos, lugares, sustantivos' },
  { type: 'descriptor', label: 'Descriptor / Adjetivo', bg: '#1e88e5', text: '#fff',     help: 'Cualidades, colores, adjetivos' },
  { type: 'social',     label: 'Social / Cortesía',     bg: '#8e24aa', text: '#fff',     help: 'Saludos, cortesía, afirmaciones' },
  { type: 'misc',       label: 'Miscelánea',            bg: '#eeeeee', text: '#444444', help: 'Sin categoría específica' },
];
