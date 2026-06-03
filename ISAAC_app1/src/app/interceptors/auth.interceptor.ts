import { HttpInterceptorFn, HttpErrorResponse, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { NEVER, from, switchMap, catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function goToLogin(router: Router, authSvc: AuthService): typeof NEVER {
  authSvc.clearSession();
  router.navigate(['/login'], { queryParams: { expired: 'true' }, replaceUrl: true });
  return NEVER;
}

function retryWithNewToken(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authSvc: AuthService,
  router: Router,
) {
  return from(authSvc.refreshAccessToken()).pipe(
    switchMap(newToken => {
      const retried = req.clone({
        headers: req.headers.set('Authorization', `Bearer ${newToken}`),
      });
      return next(retried);
    }),
    catchError(() => goToLogin(router, authSvc)),
  );
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authSvc = inject(AuthService);
  const router  = inject(Router);

  // Las rutas de auth son públicas y no necesitan token ni retry.
  if (/\/auth\/(login|register|refresh|logout)/.test(req.url)) {
    return next(req);
  }

  const token = authSvc.getToken();

  // Sin token en memoria pero hay refreshToken → renovar proactivamente (p. ej. tras recarga de página).
  if (!token && authSvc.getRefreshToken()) {
    return retryWithNewToken(req, next, authSvc, router);
  }

  // Token caducado antes de enviar → intentar refresh primero.
  if (token && isTokenExpired(token)) {
    return retryWithNewToken(req, next, authSvc, router);
  }

  const authReq = token
    ? req.clone({ headers: req.headers.set('Authorization', `Bearer ${token}`) })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      // 401: accessToken rechazado por el servidor → intentar refresh una sola vez.
      if (err.status === 401) {
        return retryWithNewToken(req, next, authSvc, router);
      }
      return throwError(() => err);
    }),
  );
};
