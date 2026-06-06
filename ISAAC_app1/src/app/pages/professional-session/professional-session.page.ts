import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService, FullBackendUser, AssignedUserEntry } from '../../services/user.service';
import { PictogramStateService } from '../../services/pictogram-state.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';

@Component({
  selector: 'app-professional-session',
  templateUrl: './professional-session.page.html',
  styleUrls:  ['./professional-session.page.scss'],
  standalone: true,
  imports: [IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent],
})
export class ProfessionalSessionPage implements OnInit {

  professionalId = '';
  professional: FullBackendUser | null = null;
  avatarUrl: SafeUrl | string = '';

  isLoading = true;
  loadError = '';

  assignedUsers: AssignedUserEntry[] = [];
  usersLoading = true;
  usersError   = '';

  constructor(
    private route:       ActivatedRoute,
    private router:      Router,
    private authService: AuthService,
    private userService: UserService,
    private sanitizer:   DomSanitizer,
    private state:       PictogramStateService,
  ) {}

  ngOnInit() {
    this.professionalId = this.route.snapshot.paramMap.get('professionalId') ?? '';
  }

  ionViewWillEnter() {
    if (this.professionalId) {
      this.loadProfessional();
      this.loadAssignedUsers();
    }
  }

  // ── Carga ─────────────────────────────────────────────────────────────────────

  private async loadProfessional(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.userService.getUserById(this.professionalId));
      this.professional = res.user;
      this.avatarUrl    = this.buildSafeUrl(this.professional.image);
    } catch {
      this.loadError = 'Error al cargar el profesional. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadAssignedUsers(): Promise<void> {
    this.usersLoading = true;
    this.usersError   = '';
    try {
      const res = await firstValueFrom(this.userService.getAssignedUsers(this.professionalId));
      this.assignedUsers = res.users;
    } catch {
      this.usersError = 'No se pudieron cargar los usuarios asignados.';
    } finally {
      this.usersLoading = false;
    }
  }

  // ── Header mode ───────────────────────────────────────────────────────────────

  /** True cuando el profesional está viendo su propia sesión (vino desde login). */
  get fromLogin(): boolean {
    return this.authService.getCurrentUser()?.id === this.professionalId;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  getInitial(): string {
    return this.professional?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  getInitialUser(user: AssignedUserEntry): string {
    return user.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  getDisplayName(): string {
    if (!this.professional) return '';
    const parts = this.professional.name.trim().split(/\s+/);
    return parts[0] ?? this.professional.name;
  }

  getDisplaySurname(): string {
    if (!this.professional) return '';
    const parts = this.professional.name.trim().split(/\s+/);
    return parts.slice(1).join(' ');
  }

  getProfessionalTypeLabel(): string {
    // professionalType no está en FullBackendUser, pero sí en el raw object
    return (this.professional as any)?.professionalType ?? '';
  }

  // ── Navegación ────────────────────────────────────────────────────────────────

  goBack() {
    if (this.fromLogin) {
      this.authService.logout();
    } else {
      this.router.navigate(['/organization-dashboard']);
    }
  }

  goToBoardBuilder() {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/professional-session/' + this.professionalId,
        creatorId:   this.professionalId,
        creatorName: this.professional?.name || '',
      },
    });
  }

  goToObjectives() {
    this.router.navigate(['/objectives-list'], {
      queryParams: { returnTo: '/professional-session/' + this.professionalId },
    });
  }

  goToUserSession(userId: string) {
    this.router.navigate(['/user-session', userId]);
  }

  goOwnPictograms() {
    this.state.userId       = null;
    this.state.returnTo     = '/professional-session/' + this.professionalId;
    this.state.allowedUsers = this.assignedUsers.map((u) => ({
      id:   u.userId,
      name: [u.name, u.surname].filter(Boolean).join(' '),
    }));
    this.router.navigate(['/own-pictograms-placeholder']);
  }
}
