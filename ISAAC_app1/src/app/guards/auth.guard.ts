import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Decodifica el payload del JWT sin verificar la firma.
 * Sirve únicamente para inspeccionar el campo `exp` en el cliente antes de
 * hacer cualquier petición HTTP, evitando cargar rutas con token ya caducado.
 * La verificación real (con firma) siempre ocurre en el backend.
 */
function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true; // Token malformado → tratar como expirado
  }
}

/**
 * Guard funcional — protege las rutas privadas.
 *  - Sin token          → /login  (sin mensaje de expiración)
 *  - Token expirado     → /login?expired=true  (muestra banner)
 *  - Token válido       → deja pasar
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router      = inject(Router);

  const token = localStorage.getItem('isaac_token');

  if (!token) {
    return router.createUrlTree(['/login']);
  }

  if (isTokenExpired(token)) {
    // Limpia localStorage + BehaviorSubject antes de redirigir
    authService.clearSession();
    return router.createUrlTree(['/login'], { queryParams: { expired: 'true' } });
  }

  return true;
};
