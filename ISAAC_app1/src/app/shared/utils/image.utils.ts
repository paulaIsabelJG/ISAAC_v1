import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { environment } from '../../../environments/environment';

// environment.apiUrl ya incluye el sufijo '/api' (p.ej. 'https://host/api').
// Los archivos estáticos (si los hubiera) cuelgan del origen, no de '/api'.
const API_ORIGIN = environment.apiUrl.replace(/\/api\/?$/, '');

/**
 * Normaliza cualquier referencia de imagen de pictograma a una URL utilizable
 * directamente en [src]. Punto único de esta lógica — no concatenar rutas
 * en plantillas ni en otros componentes.
 *
 * - Absolutas (http/https), data-URI o blob-URI → se devuelven sin modificar
 *   (cubre ARASAAC y los pictogramas propios, que se guardan como base64).
 * - Ruta relativa (p.ej. '/uploads/x.png')       → se resuelve contra el
 *   origen del backend, sin duplicar '/api'.
 * - null/undefined/''                            → null (sin imagen).
 */
export function resolvePictogramImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (
    value.startsWith('http://')  ||
    value.startsWith('https://') ||
    value.startsWith('data:')    ||
    value.startsWith('blob:')
  ) {
    return value;
  }
  return `${API_ORIGIN}${value.startsWith('/') ? '' : '/'}${value}`;
}

/**
 * Convierte una URL de imagen (ya normalizada) a SafeUrl si es un data-URI (base64),
 * o la devuelve tal cual si es una URL normal.
 * Retorna cadena vacía si la entrada es nula, undefined, vacía o irresoluble.
 *
 * Uso en componentes:
 *   buildSafeUrl(url?: string | null): SafeUrl | string {
 *     return buildSafeUrl(url, this.sanitizer);
 *   }
 */
export function buildSafeUrl(
  url: string | null | undefined,
  sanitizer: DomSanitizer,
): SafeUrl | string {
  const resolved = resolvePictogramImageUrl(url);
  if (!resolved) return '';
  if (resolved.startsWith('data:')) return sanitizer.bypassSecurityTrustUrl(resolved);
  return resolved;
}
