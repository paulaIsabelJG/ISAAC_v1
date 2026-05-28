import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
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
  /** Solo presente en teachers creados por una organización (profesionales). */
  professionalType?: string | null;
  latitude?:  number | null;
  longitude?: number | null;
  city?:      string | null;
  country?:   string | null;
  createdAt?: string;
}

/** Sugerencia devuelta por /api/places/autocomplete */
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
  email: string;
  password: string;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: User;
}

export interface RegisterResponse {
  message: string;
  user: User;
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
  private readonly TOKEN_KEY = 'isaac_token';
  private readonly USER_KEY  = 'isaac_user';

  private apiUrl    = `${environment.apiUrl}/auth`;
  private placesUrl = `${environment.apiUrl}/places`;

  /** Estado reactivo del usuario autenticado */
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    // Restaurar sesión desde localStorage al iniciar la app
    this.loadCurrentUser();
  }

  // ─── Persistencia de sesión ─────────────────────────────────────────────────

  /** Restaura usuario desde localStorage (llamado en constructor) */
  loadCurrentUser(): void {
    const stored = localStorage.getItem(this.USER_KEY);
    if (stored) {
      try {
        this.currentUserSubject.next(JSON.parse(stored));
      } catch {
        this.clearSession();
      }
    }
  }

  /** Persiste token + usuario y actualiza el BehaviorSubject */
  saveSession(token: string, user: User): void {
    localStorage.setItem(this.TOKEN_KEY, token);
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    this.currentUserSubject.next(user);
  }

  /** Elimina la sesión de localStorage y resetea el estado */
  clearSession(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUserSubject.next(null);
  }

  // ─── Getters ────────────────────────────────────────────────────────────────

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  /**
   * Devuelve la ruta a la que redirigir según el tipo de usuario:
   *   teacher + professionalType → /professional-session/:id  (profesional creado por una org)
   *   teacher sin professionalType → /organization-dashboard  (cuenta de organización)
   *   user   → /user-session/:id
   *   parent → /user-placeholder
   */
  getRedirectRoute(user: User): string {
    if (user.type === 'teacher') {
      return user.professionalType
        ? `/professional-session/${user.id}`
        : '/organization-dashboard';
    }
    if (user.type === 'user') {
      return `/user-session/${user.id}`;
    }
    return '/user-placeholder';
  }

  // ─── Endpoints de autenticación ─────────────────────────────────────────────

  login(payload: LoginPayload): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/login`, payload)
      .pipe(tap((res) => this.saveSession(res.token, res.user)));
  }

  register(payload: RegisterPayload): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/register`, payload);
  }

  updateMe(data: UpdateMePayload): Observable<{ message: string; user: User }> {
    return this.http
      .put<{ message: string; user: User }>(`${this.apiUrl}/me`, data)
      .pipe(
        tap((res) => {
          // Actualiza el estado reactivo conservando el token
          const token = this.getToken()!;
          this.saveSession(token, res.user);
        })
      );
  }

  logout(): void {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  // ─── Geocodificación ────────────────────────────────────────────────────────

  /** Devuelve sugerencias de dirección desde nuestro proxy backend → Nominatim */
  getPlaceSuggestions(q: string): Observable<{ suggestions: AddressSuggestion[] }> {
    return this.http.get<{ suggestions: AddressSuggestion[] }>(
      `${this.placesUrl}/autocomplete`,
      { params: { q } }
    );
  }
}
