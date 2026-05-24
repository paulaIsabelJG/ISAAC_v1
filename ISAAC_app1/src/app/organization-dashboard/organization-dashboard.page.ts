import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AuthService, User } from '../services/auth.service';

// ─── Estructura de tarjeta de usuario (placeholder hasta API real) ─────────────
export interface UserCardData {
  name:    string;
  surname: string;
  email:   string;
  image?:  string;
  type:    'user' | 'parent' | 'teacher';
}

@Component({
  selector: 'app-organization-dashboard',
  templateUrl: './organization-dashboard.page.html',
  styleUrls: ['./organization-dashboard.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class OrganizationDashboardPage implements OnInit {

  user: User | null = null;
  orgAvatarUrl: SafeUrl | string = '';

  // ── Buscadores ──────────────────────────────────────────────────────────────
  searchFinalUsers    = '';
  searchProfessionals = '';

  // ── Datos placeholder (estructura real para cuando llegue el backend) ────────
  readonly finalUsers: UserCardData[] = [
    { name: 'María',   surname: 'García López',     email: 'maria@ejemplo.com',   type: 'user' },
    { name: 'Luis',    surname: 'Martínez Ruiz',    email: 'luis@ejemplo.com',    type: 'user' },
    { name: 'Ana',     surname: 'López Fernández',  email: 'ana@ejemplo.com',     type: 'user' },
    { name: 'Carlos',  surname: 'Rodríguez Pérez',  email: 'carlos@ejemplo.com',  type: 'user' },
    { name: 'Sofía',   surname: 'Hernández Gil',    email: 'sofia@ejemplo.com',   type: 'user' },
    { name: 'Javier',  surname: 'Sánchez Torres',   email: 'javier@ejemplo.com',  type: 'user' },
    { name: 'Paula',   surname: 'Díaz Serrano',     email: 'paula@ejemplo.com',   type: 'user' },
    { name: 'Miguel',  surname: 'Flores Vega',      email: 'miguel@ejemplo.com',  type: 'user' },
    { name: 'Elena',   surname: 'Castro Moreno',    email: 'elena.u@ejemplo.com', type: 'user' },
    { name: 'David',   surname: 'Ruiz Delgado',     email: 'david@ejemplo.com',   type: 'user' },
    { name: 'Laura',   surname: 'Navarro Cruz',     email: 'laura@ejemplo.com',   type: 'user' },
    { name: 'Tomás',   surname: 'Jiménez Alba',     email: 'tomas@ejemplo.com',   type: 'user' },
  ];

  readonly professionals: UserCardData[] = [
    { name: 'Elena',   surname: 'Ramírez Vega',    email: 'elena@centro.com',   type: 'parent' },
    { name: 'Pedro',   surname: 'González Cruz',   email: 'pedro@centro.com',   type: 'parent' },
    { name: 'Carmen',  surname: 'Flores Mora',     email: 'carmen@centro.com',  type: 'parent' },
    { name: 'Roberto', surname: 'Díaz Guerrero',   email: 'roberto@centro.com', type: 'parent' },
    { name: 'Lucía',   surname: 'Ortega Fuentes',  email: 'lucia@centro.com',   type: 'parent' },
    { name: 'Ignacio', surname: 'Ramos Soler',     email: 'ignacio@centro.com', type: 'parent' },
  ];

  constructor(
    private authService: AuthService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.refreshUser();
  }

  /**
   * ionViewWillEnter — llamado por IonicRouteStrategy CADA VEZ que
   * la página se hace visible, incluso si el componente estaba en caché.
   * Esto garantiza que el dashboard muestre datos actualizados tras editar el perfil.
   */
  ionViewWillEnter() {
    this.refreshUser();
  }

  private refreshUser(): void {
    this.user = this.authService.getCurrentUser();
    this.orgAvatarUrl = this.buildSafeUrl(this.user?.image);
  }

  /**
   * Devuelve SafeUrl para imágenes base64 (data:) o la URL directamente.
   * Necesario porque Angular bloquea data: URLs en [src] sin bypassSecurityTrustUrl.
   */
  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    if (!imageStr) return '';
    if (imageStr.startsWith('data:')) {
      return this.sanitizer.bypassSecurityTrustUrl(imageStr);
    }
    return imageStr;
  }

  // ── Getters filtrados ────────────────────────────────────────────────────────

  get filteredFinalUsers(): UserCardData[] {
    const q = this.searchFinalUsers.trim().toLowerCase();
    if (!q) return this.finalUsers;
    return this.finalUsers.filter((u) =>
      `${u.name} ${u.surname}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  get filteredProfessionals(): UserCardData[] {
    const q = this.searchProfessionals.trim().toLowerCase();
    if (!q) return this.professionals;
    return this.professionals.filter((u) =>
      `${u.name} ${u.surname}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  // ── Handlers buscador ────────────────────────────────────────────────────────

  onSearchFinalUsers(event: Event): void {
    this.searchFinalUsers = (event as CustomEvent<{ value: string }>).detail?.value ?? '';
  }

  onSearchProfessionals(event: Event): void {
    this.searchProfessionals = (event as CustomEvent<{ value: string }>).detail?.value ?? '';
  }

  /** Inicial del nombre para el avatar sin foto */
  getInitial(user: UserCardData): string {
    return user.name.charAt(0).toUpperCase();
  }

  // ── Navegación ───────────────────────────────────────────────────────────────

  goToProfile()      { this.router.navigate(['/organization-profile']); }
  goToAddUser()      { this.router.navigate(['/add-user']);             }
  goToBoardBuilder() { this.router.navigate(['/board-builder']);        }
  logout()           { this.authService.logout();                       }
}
