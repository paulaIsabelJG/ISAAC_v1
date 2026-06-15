import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

export type SidebarItem = 'home' | 'users' | 'boards' | 'stats' | 'objectives' | 'profile';

@Component({
  selector: 'app-org-sidebar',
  templateUrl: './org-sidebar.component.html',
  styleUrls: ['./org-sidebar.component.scss'],
  standalone: true,
  imports: [],
})
export class OrgSidebarComponent {
  @Input() activeItem: SidebarItem = 'home';

  constructor(
    private router:      Router,
    private authService: AuthService,
  ) {}

  goHome():       void { this.router.navigate(['/organization-dashboard']); }
  goUsers():      void { this.router.navigate(['/organization-users']); }
  goBoards():     void { this.router.navigate(['/board-builder']); }
  goStats():      void { this.router.navigate(['/organization-statistics']); }
  goObjectives(): void {
    this.router.navigate(['/objectives-list'], {
      queryParams: { returnTo: '/organization-dashboard' },
    });
  }
  goProfile(): void { this.router.navigate(['/organization-profile']); }
  logout():    void { this.authService.logout(); }
}
