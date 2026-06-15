import { Component } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { AuthService, User } from '../../services/auth.service';
import { UserService, BackendUser } from '../../services/user.service';
import { OrganizationDashboardService, QuickSummary } from '../../services/organization-dashboard.service';
import { UserCardData } from '../../services/organization-users.service';
import { PictogramStateService } from '../../services/pictogram-state.service';
import { OrgSidebarComponent } from '../../components/org-sidebar/org-sidebar.component';

@Component({
  selector: 'app-organization-dashboard',
  templateUrl: './organization-dashboard.page.html',
  styleUrls: ['./organization-dashboard.page.scss'],
  standalone: true,
  imports: [IonicModule, OrgSidebarComponent],
})
export class OrganizationDashboardPage {

  user: User | null = null;
  orgAvatarUrl: SafeUrl | string = '';

  summary: QuickSummary = { totalFinalUsers: 0, totalProfessionals: 0, totalFamiliares: 0 };
  isLoading = false;
  loadError = '';

  constructor(
    private authService:     AuthService,
    private userService:     UserService,
    private dashService:     OrganizationDashboardService,
    private pictogramState:  PictogramStateService,
    private router:          Router,
    private sanitizer:       DomSanitizer,
  ) {}

  ionViewWillEnter(): void {
    this.user = this.authService.getCurrentUser();
    this.orgAvatarUrl = buildSafeUrlUtil(this.user?.image, this.sanitizer);
    this.loadSummaryData();
  }

  private loadSummaryData(): void {
    const centro = this.user?.centro;
    if (!centro) return;

    this.isLoading = true;
    this.userService.getUsersByCenter(centro).subscribe({
      next: (res) => {
        const myEmail     = this.user?.email;
        const finalUsers    = res.users.filter(u => u.type === 'user').map(u => this.toCard(u));
        const professionals = res.users.filter(u => u.type === 'teacher' && u.email !== myEmail).map(u => this.toCard(u));

        const finalUserIds = finalUsers.map(u => u._id);
        if (finalUserIds.length === 0) {
          this.summary   = this.dashService.buildSummary(finalUsers, professionals, []);
          this.isLoading = false;
          return;
        }

        this.userService.getFamiliesForUsers(finalUserIds).subscribe({
          next: (famRes) => {
            const familiares = famRes.families.map(u => this.toCard(u));
            this.summary     = this.dashService.buildSummary(finalUsers, professionals, familiares);
            this.isLoading   = false;
          },
          error: () => {
            this.summary   = this.dashService.buildSummary(finalUsers, professionals, []);
            this.isLoading = false;
          },
        });
      },
      error: () => {
        this.loadError = 'Error al cargar datos.';
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

  // ── Navegación ───────────────────────────────────────────────────────────────

  goToProfile():    void { this.router.navigate(['/organization-profile']); }
  goToAddUser():    void { this.router.navigate(['/user-final-form', 'new'], { queryParams: { returnTo: '/organization-dashboard' } }); }
  goToUsers():      void { this.router.navigate(['/organization-users']); }
  goToStatistics(): void { this.router.navigate(['/organization-statistics']); }

  goToAddProfessional(): void {
    this.router.navigate(['/add-user']);
  }

  goToAddFamiliar(): void {
    this.router.navigate(['/add-user'], { queryParams: { type: 'parent', returnTo: '/organization-dashboard' } });
  }

  goToAddPictogram(): void {
    this.pictogramState.userId       = null;
    this.pictogramState.returnTo     = '/organization-dashboard';
    this.pictogramState.allowedUsers = null;
    this.router.navigate(['/own-pictograms-placeholder']);
  }

  goToAssignProfessional(): void {
    this.pictogramState.userId       = null;
    this.pictogramState.returnTo     = '/organization-dashboard';
    this.pictogramState.allowedUsers = null;
    this.router.navigate(['/assigned-professionals-placeholder']);
  }

  goToObjectives(): void {
    this.router.navigate(['/objectives-list'], {
      queryParams: { returnTo: '/organization-dashboard' },
    });
  }

  goToBoardBuilder(): void {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/organization-dashboard',
        creatorId:   this.user?.id   || '',
        creatorName: this.user?.name || '',
      },
    });
  }

  goToUserSession(userId: string): void {
    this.router.navigate(['/user-session', userId]);
  }
}
