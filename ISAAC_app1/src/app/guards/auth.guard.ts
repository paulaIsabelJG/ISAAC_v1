import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Protege las rutas privadas.
 * Solo comprueba si hay un accessToken en memoria.
 * Si no lo hay, redirige a /login (que puede mostrar biometría o formulario).
 * La renovación automática del token expirado la gestiona el interceptor HTTP.
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router      = inject(Router);

  // Considera la sesión activa si hay accessToken o refreshToken (y perfil de usuario).
  // El interceptor renovará el accessToken automáticamente en la primera petición.
  return (authService.isLoggedIn() || (!!authService.getRefreshToken() && !!authService.getCurrentUser()))
    ? true
    : router.createUrlTree(['/login']);
};
