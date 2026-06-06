import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { AuthService, User } from '../../services/auth.service';
import { UserService, BackendUser } from '../../services/user.service';

// ─── Estructura de tarjeta de usuario ────────────────────────────────────────
export interface UserCardData {
  _id:     string;          // necesario para navegar a /user-session/:userId
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

  // ── Datos reales desde backend ────────────────────────────────────────────
  allFinalUsers:    UserCardData[] = [];
  allProfessionals: UserCardData[] = [];
  isLoading = false;
  loadError = '';

  constructor(
    private authService: AuthService,
    private userService: UserService,
    private router: Router,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    this.refreshUser();
  }

  /**
   * ionViewWillEnter — se ejecuta cada vez que la página se hace visible,
   * incluso si el componente estaba en caché. Garantiza datos frescos
   * al volver desde /add-user o cualquier otra ruta.
   */
  ionViewWillEnter() {
    this.refreshUser();
    this.loadUsers();
  }

  private refreshUser(): void {
    this.user = this.authService.getCurrentUser();
    this.orgAvatarUrl = this.buildSafeUrl(this.user?.image);
  }

  /** Carga usuarios del centro desde el backend */
  private loadUsers(): void {
    const centro = this.user?.centro;

    if (!centro) {
      this.loadError = 'No se encontró el centro asociado a esta cuenta.';
      return;
    }

    this.isLoading = true;
    this.loadError = '';

    this.userService.getUsersByCenter(centro).subscribe({
      next: (res) => {
        const myEmail = this.user?.email;

        // Tipos considerados "usuario final" (robusto ante variantes futuras)
        const isFinalUser    = (t: string) => t === 'user'    || t === 'final_user';
        // Tipos considerados "profesional" (robusto ante variantes futuras)
        const isProfessional = (t: string) => t === 'teacher' || t === 'professional';

        this.allFinalUsers = res.users
          .filter(u => isFinalUser(u.type))
          .map(u => this.toCard(u));

        // Excluimos al propio admin/org de la lista de profesionales
        this.allProfessionals = res.users
          .filter(u => isProfessional(u.type) && u.email !== myEmail)
          .map(u => this.toCard(u));

        this.isLoading = false;
      },
      error: () => {
        this.loadError = 'Error al cargar usuarios. Inténtalo de nuevo.';
        this.isLoading = false;
      },
    });
  }

  private toCard(u: BackendUser): UserCardData {
    return {
      _id:     u._id,
      name:    u.name,
      surname: u.surname ?? '',
      email:   u.email,
      image:   u.image ?? undefined,
      type:    u.type,
    };
  }

  /**
   * Devuelve SafeUrl para imágenes base64 (data:) o la URL directamente.
   */
  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  // ── Getters filtrados ────────────────────────────────────────────────────────

  get filteredFinalUsers(): UserCardData[] {
    const q = this.searchFinalUsers.trim().toLowerCase();
    if (!q) return this.allFinalUsers;
    return this.allFinalUsers.filter((u) =>
      `${u.name} ${u.surname}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }

  get filteredProfessionals(): UserCardData[] {
    const q = this.searchProfessionals.trim().toLowerCase();
    if (!q) return this.allProfessionals;
    return this.allProfessionals.filter((u) =>
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

  /** Abre el board builder del propio usuario de sesión (la organización) */
  goToStatistics()   { this.router.navigate(['/organization-statistics']); }

  goToObjectives() {
    this.router.navigate(['/objectives-list'], {
      queryParams: { returnTo: '/organization-dashboard' },
    });
  }

  goToBoardBuilder() {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/organization-dashboard',
        creatorId:   this.user?.id   || '',
        creatorName: this.user?.name || '',
      },
    });
  }

  logout() { this.authService.logout(); }

  /** Abre la sesión/perfil de un usuario final */
  goToUserSession(userId: string) {
    this.router.navigate(['/user-session', userId]);
  }

  /** Abre la sesión/perfil de un profesional */
  goToProfessionalSession(professionalId: string) {
    this.router.navigate(['/professional-session', professionalId]);
  }
}
