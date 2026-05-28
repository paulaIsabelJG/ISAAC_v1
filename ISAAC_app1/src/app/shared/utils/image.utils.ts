import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

/**
 * Convierte una URL de imagen a SafeUrl si es un data-URI (base64),
 * o la devuelve tal cual si es una URL normal.
 * Retorna cadena vacía si la entrada es nula, undefined o vacía.
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
  if (!url) return '';
  if (url.startsWith('data:')) return sanitizer.bypassSecurityTrustUrl(url);
  return url;
}
