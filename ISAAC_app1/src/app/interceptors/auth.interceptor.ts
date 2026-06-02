import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Interceptor funcional que:
 *  1. Añade el header Authorization: Bearer <token> a todas las peticiones.
 *  2. Captura respuestas 401/403: limpia la sesión y redirige a /login?expired=true.
 *
 * Lee localStorage directamente (sin inyectar AuthService) para evitar la
 * dependencia circular: AuthService → HttpClient → Interceptor → AuthService.
 * Por el mismo motivo, la limpieza de sesión también se hace sobre localStorage,
 * sin llamar a AuthService.logout() (el BehaviorSubject se sincronizará la próxima
 * vez que AuthService.loadCurrentUser() se ejecute, al volver a la app).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token  = localStorage.getItem('isaac_token');

  // Clonar la petición añadiendo el header solo si hay token
  const authReq = token
    ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 || err.status === 403) {
        // Sesión caducada o no autorizada: limpiar y redirigir
        localStorage.removeItem('isaac_token');
        localStorage.removeItem('isaac_user');
        router.navigate(['/login'], {
          queryParams: { expired: 'true' },
          replaceUrl:  true,
        });
      }
      // Reemitir el error para que los componentes puedan manejarlo si quieren
      return throwError(() => err);
    }),
  );
};
