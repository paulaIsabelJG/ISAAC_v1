import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Interceptor funcional — añade el header Authorization: Bearer <token>
 * a todas las peticiones salientes si existe un token en localStorage.
 *
 * Lee directamente de localStorage (sin inyectar AuthService)
 * para evitar dependencia circular:
 *   AuthService → HttpClient → Interceptor → AuthService
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('isaac_token');

  if (token) {
    const authReq = req.clone({
      headers: req.headers.set('Authorization', `Bearer ${token}`)
    });
    return next(authReq);
  }

  return next(req);
};
