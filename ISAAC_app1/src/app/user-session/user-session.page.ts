import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { UserService, FullBackendUser } from '../services/user.service';
import { BoardService, Board } from '../services/board.service';
import { LoadingErrorStateComponent } from '../shared/components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../shared/components/app-page-header/app-page-header.component';

// ─── Permisos resueltos para la vista ────────────────────────────────────────
interface ViewPermissions {
  canViewPersonalData: boolean;
  canViewStats:        boolean;
  canEditBoards:       boolean;
}

@Component({
  selector: 'app-user-session',
  templateUrl: './user-session.page.html',
  styleUrls:  ['./user-session.page.scss'],
  standalone: true,
  imports: [IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent],
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

  // ── Tableros asignados (boardRole=main, userId=this.userId) ──────────────────
  assignedBoards: Board[] = [];
  boardsLoading  = true;
  boardsError    = '';

  constructor(
    private route:        ActivatedRoute,
    private router:       Router,
    private authService:  AuthService,
    private userService:  UserService,
    private boardService: BoardService,
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
      this.loadBoards();
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

  private async loadBoards(): Promise<void> {
    this.boardsLoading = true;
    this.boardsError   = '';
    try {
      const res = await firstValueFrom(this.boardService.getAssignedBoards(this.userId));
      this.assignedBoards = res.boards;
    } catch {
      this.boardsError = 'No se pudieron cargar los tableros.';
    } finally {
      this.boardsLoading = false;
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
    return buildSafeUrlUtil(imageStr, this.sanitizer);
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

  /** Abre el board builder del usuario cuya sesión se está visualizando.
   *  creatorId = userId del perfil → el builder filtra por ese creador. */
  goToBoardBuilder(){
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/user-session/' + this.userId,
        creatorId:   this.userId,
        creatorName: this.targetUser?.name || '',
      },
    });
  }

  /**
   * Abre un tablero asignado SIEMPRE en modo comunicador activo.
   * Tanto si quien lo abre es el propio usuario final, como si es
   * organización / profesional / familiar: los tableros asignados
   * se visualizan en el comunicador, no en el editor.
   * El Board Builder se accede únicamente desde el botón "Tablero Builder".
   */
  openBoard(board: Board) {
    this.router.navigate(['/communicator', board._id], {
      queryParams: {
        userId:   this.userId,
        returnTo: '/user-session/' + this.userId,
      },
    });
  }
}
