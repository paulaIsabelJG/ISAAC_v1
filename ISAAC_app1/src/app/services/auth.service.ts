import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom, tap } from 'rxjs';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

// ─── Modelos ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  type: 'teacher' | 'parent' | 'user';
  gender?: string;
  image?: string;
  centro?: string;
  professionalType?: string | null;
  latitude?:  number | null;
  longitude?: number | null;
  city?:      string | null;
  country?:   string | null;
  createdAt?: string;
}

export interface AddressSuggestion {
  formattedAddress: string;
  lat: number;
  lng: number;
  city: string | null;
  country: string | null;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  type: 'teacher' | 'parent' | 'user';
  gender?: string;
  image?: string;
  centro?: string;
  professionalType?: string;
}

export interface LoginPayload {
  email:    string;
  password: string;
  deviceId?: string;
}

export interface LoginResponse {
  message:      string;
  accessToken:  string;
  refreshToken: string;
  user:         User;
}

export interface RegisterResponse {
  message: string;
  user:    User;
}

export interface UpdateMePayload {
  name?: string;
  email?: string;
  image?: string;
  centro?: string;
  gender?: string;
  password?: string;
  latitude?:  number | null;
  longitude?: number | null;
  city?:      string | null;
  country?:   string | null;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly USER_KEY    = 'isaac_user';
  private readonly TOKEN_KEY   = 'isaac_refresh_token';
  private readonly DEVICE_KEY  = 'isaac_device_id';

  private readonly apiUrl    = `${environment.apiUrl}/auth`;
  private readonly placesUrl = `${environment.apiUrl}/places`;

  /** Estado reactivo del usuario autenticado */
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  // ── Tokens en memoria ─────────────────────────────────────────────────────
  // accessToken: dura 2h, se regenera con refreshToken cuando caduca.
  // refreshToken: llega del backend, se guarda en Keychain/Keystore por BiometricAuthService.
  //   Se mantiene aquí en memoria para que el interceptor pueda usarlo sin pedir biometría
  //   de nuevo durante la misma sesión.
  private accessTokenValue  = '';
  private refreshTokenValue = '';

  // Mutex: si varias peticiones fallan con 401 a la vez, solo se hace un refresh.
  private refreshPromise: Promise<string> | null = null;

  constructor(private http: HttpClient, private router: Router) {
    this.loadCurrentUser();
  }

  // ─── Sesión ─────────────────────────────────────────────────────────────────

  loadCurrentUser(): void {
    const stored = localStorage.getItem(this.USER_KEY);
    if (stored) {
      try { this.currentUserSubject.next(JSON.parse(stored)); }
      catch { this.clearSession(); return; }
    }
    // Restaurar el refreshToken persistido para que el interceptor pueda
    // renovar el accessToken sin pedir login tras un recarga de página.
    const storedRefresh = localStorage.getItem(this.TOKEN_KEY);
    if (storedRefresh) { this.refreshTokenValue = storedRefresh; }
  }

  /** Guarda los tokens en memoria y el perfil de usuario en localStorage. */
  saveSession(accessToken: string, refreshToken: string, user: User): void {
    this.accessTokenValue  = accessToken;
    this.refreshTokenValue = refreshToken;
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    localStorage.setItem(this.TOKEN_KEY, refreshToken);
    this.currentUserSubject.next(user);
  }

  clearSession(): void {
    this.accessTokenValue  = '';
    this.refreshTokenValue = '';
    localStorage.removeItem(this.USER_KEY);
    localStorage.removeItem(this.TOKEN_KEY);
    this.currentUserSubject.next(null);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  getToken(): string | null {
    return this.accessTokenValue || null;
  }

  getRefreshToken(): string | null {
    return this.refreshTokenValue || null;
  }

  isLoggedIn(): boolean {
    return !!this.accessTokenValue;
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getDeviceId(): string {
    let id = localStorage.getItem(this.DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(this.DEVICE_KEY, id);
    }
    return id;
  }

  getRedirectRoute(user: User): string {
    if (user.type === 'teacher') {
      return user.professionalType
        ? `/professional-session/${user.id}`
        : '/organization-dashboard';
    }
    if (user.type === 'user') return `/user-session/${user.id}`;
    return '/user-placeholder';
  }

  // ─── Renovación de token ────────────────────────────────────────────────────

  /**
   * Solicita un nuevo accessToken usando el refreshToken en memoria.
   * Usa un mutex para que peticiones concurrentes compartan el mismo refresh.
   */
  refreshAccessToken(): Promise<string> {
    if (!this.refreshPromise) {
      this.refreshPromise = this._doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async _doRefresh(): Promise<string> {
    if (!this.refreshTokenValue) throw new Error('No refresh token en memoria');
    const res = await firstValueFrom(
      this.http.post<{ accessToken: string; user: User }>(
        `${this.apiUrl}/refresh`,
        { refreshToken: this.refreshTokenValue },
      ),
    );
    this.accessTokenValue = res.accessToken;
    if (res.user) {
      localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
      this.currentUserSubject.next(res.user);
    }
    return res.accessToken;
  }

  /**
   * Inicio de sesión biométrico: usa un refreshToken recuperado de Keychain/Keystore
   * para obtener un nuevo accessToken sin pedir contraseña.
   */
  async loginWithRefreshToken(refreshToken: string): Promise<User> {
    const res = await firstValueFrom(
      this.http.post<{ accessToken: string; user: User }>(
        `${this.apiUrl}/refresh`,
        { refreshToken },
      ),
    );
    this.accessTokenValue  = res.accessToken;
    this.refreshTokenValue = refreshToken;
    localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
    this.currentUserSubject.next(res.user);
    return res.user;
  }

  // ─── Endpoints ───────────────────────────────────────────────────────────────

  login(payload: LoginPayload): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/login`, {
        ...payload,
        deviceId: this.getDeviceId(),
      })
      .pipe(tap(res => this.saveSession(res.accessToken, res.refreshToken, res.user)));
  }

  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/register`, payload);
  }

  updateMe(data: UpdateMePayload): Observable<{ message: string; user: User }> {
    return this.http
      .put<{ message: string; user: User }>(`${this.apiUrl}/me`, data)
      .pipe(
        tap(res => {
          localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
          this.currentUserSubject.next(res.user);
        }),
      );
  }

  logout(): void {
    if (this.refreshTokenValue) {
      this.http
        .post(`${this.apiUrl}/logout`, { refreshToken: this.refreshTokenValue })
        .subscribe();
    }
    this.clearSession();
    this.router.navigate(['/login']);
  }

  // ─── Geocodificación ─────────────────────────────────────────────────────────

  getPlaceSuggestions(q: string): Observable<{ suggestions: AddressSuggestion[] }> {
    return this.http.get<{ suggestions: AddressSuggestion[] }>(
      `${this.placesUrl}/autocomplete`,
      { params: { q } },
    );
  }
}
