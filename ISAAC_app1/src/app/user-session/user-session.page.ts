import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService, FullBackendUser } from '../services/user.service';

// ─── Permisos resueltos para la vista ────────────────────────────────────────
interface ViewPermissions {
  canViewPersonalData: boolean;
  canViewStats:        boolean;
  canEditBoards:       boolean;
}

// ─── Tarjeta de tablero placeholder ──────────────────────────────────────────
interface BoardCard {
  id:    string;
  label: string;
  image: string;
}

const BOARD_PLACEHOLDERS: BoardCard[] = [
  { id: 'basic-grid',  label: 'Básico cuadrado', image: 'assets/user-session/board-basic-grid.png'  },
  { id: 'basic-round', label: 'Básico redondo',  image: 'assets/user-session/board-basic-round.png' },
  { id: 'food',        label: 'Comida',           image: 'assets/user-session/board-food.png'        },
  { id: 'studies',     label: 'Estudios',         image: 'assets/user-session/board-studies.png'     },
];

@Component({
  selector: 'app-user-session',
  templateUrl: './user-session.page.html',
  styleUrls:  ['./user-session.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class UserSessionPage implements OnInit {

  userId     = '';
  targetUser: FullBackendUser | null = null;
  avatarUrl:  SafeUrl | string       = '';

  permissions: ViewPermissions = {
    canViewPersonalData: false,
    canViewStats:        false,
    canEditBoards:       false,
  };

  isLoading = true;
  loadError = '';

  boards: BoardCard[] = BOARD_PLACEHOLDERS;

  constructor(
    private route:        ActivatedRoute,
    private router:       Router,
    private authService:  AuthService,
    private userService:  UserService,
    private sanitizer:    DomSanitizer,
  ) {}

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';
  }

  /**
   * ionViewWillEnter garantiza recarga si se vuelve desde datos personales
   * sin destruir el componente.
   */
  ionViewWillEnter() {
    if (this.userId) {
      this.loadData();
    }
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';

    try {
      const res = await firstValueFrom(this.userService.getUserById(this.userId));
      this.targetUser = res.user;
      this.avatarUrl  = this.buildSafeUrl(this.targetUser.image);
      await this.computePermissions();
    } catch {
      this.loadError = 'Error al cargar el usuario. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Cálculo de permisos ─────────────────────────────────────────────────────

  /**
   * Reglas:
   *   teacher → si está en assignedProfessionals usa sus permisos;
   *             si NO está, es la organización → todo visible.
   *   user    → si es el propio usuario: solo Datos personales.
   *   parent  → busca en su propia childrenAccess (carga su usuario).
   */
  private async computePermissions(): Promise<void> {
    const viewer = this.authService.getCurrentUser();
    if (!viewer || !this.targetUser) return;

    if (viewer.type === 'teacher') {
      const ap = (this.targetUser.assignedProfessionals ?? []).find(
        (e) => e.professionalId?.toString() === viewer.id
      );
      if (ap) {
        // Profesional asignado: usa sus permisos
        this.permissions = {
          canViewPersonalData: ap.canEditPersonalData,
          canViewStats:        ap.canViewStats,
          canEditBoards:       ap.canEditBoards,
        };
      } else {
        // Organización: acceso total
        this.permissions = { canViewPersonalData: true, canViewStats: true, canEditBoards: true };
      }
      return;
    }

    if (viewer.type === 'user') {
      // Usuario final: permisos según selfPermissions guardados en su propio perfil.
      // Si no existe el campo (usuarios antiguos o sin permisos), todo false.
      const sp = this.targetUser?.selfPermissions;
      this.permissions = {
        canViewPersonalData: sp?.canEditPersonalData ?? false,
        canViewStats:        sp?.canViewStats        ?? false,
        canEditBoards:       sp?.canEditBoards       ?? false,
      };
      return;
    }

    if (viewer.type === 'parent') {
      try {
        // Cargar childrenAccess del familiar logueado
        const parentRes = await firstValueFrom(this.userService.getUserById(viewer.id));
        const entry = (parentRes.user.childrenAccess ?? []).find(
          (ca) => ca.childId?.toString() === this.userId
        );
        if (entry) {
          this.permissions = {
            canViewPersonalData: entry.canEditPersonalData,
            canViewStats:        entry.canViewStats,
            canEditBoards:       entry.canEditBoards,
          };
        } else {
          // Sin entrada → solo lista de tableros (sin controles)
          this.permissions = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
        }
      } catch {
        this.permissions = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
      }
    }
  }

  // ── Header mode ─────────────────────────────────────────────────────────────

  /**
   * True cuando el viewer es el propio usuario final (type='user').
   * Eso significa que llegó directamente desde login → mostramos cabecera ISAAC + Salir.
   * Un teacher/org que navega desde el dashboard tendrá false → mostramos ← Volver.
   */
  get fromLogin(): boolean {
    return this.authService.getCurrentUser()?.type === 'user';
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    if (!imageStr) return '';
    if (imageStr.startsWith('data:')) {
      return this.sanitizer.bypassSecurityTrustUrl(imageStr);
    }
    return imageStr;
  }

  getInitial(): string {
    return this.targetUser?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  getDisplayName(): string {
    if (!this.targetUser) return '';
    const parts = this.targetUser.name.trim().split(/\s+/);
    return parts[0] ?? this.targetUser.name;
  }

  getDisplaySurname(): string {
    if (!this.targetUser) return '';
    const parts = this.targetUser.name.trim().split(/\s+/);
    return parts.slice(1).join(' ');
  }

  // ── Navegación ───────────────────────────────────────────────────────────────

  goBack() {
    const viewer = this.authService.getCurrentUser();
    if (viewer?.type === 'user') {
      // El usuario final está en su propia pantalla de inicio → salir = logout
      this.authService.logout();
    } else {
      this.router.navigate(['/organization-dashboard']);
    }
  }
  goToPersonalData(){ this.router.navigate(['/user-final-form', this.userId]); }
  goToStats()       { this.router.navigate(['/statistics-placeholder']); }
  /** Pasa el userId como returnTo para que board-builder sepa dónde volver */
  goToBoardBuilder(){ this.router.navigate(['/board-builder'], { queryParams: { returnTo: '/user-session/' + this.userId } }); }
}
