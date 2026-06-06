import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { AuthService, User } from '../../services/auth.service';
import { PictogramStateService } from '../../services/pictogram-state.service';

// Etiqueta legible por tipo de usuario (valor backend → texto UI)
const TYPE_LABELS: Record<string, string> = {
  teacher: 'Organización',
  parent:  'Familiar',
  user:    'Usuario final',
};

@Component({
  selector: 'app-user-placeholder',
  templateUrl: './user-placeholder.page.html',
  styleUrls: ['./user-placeholder.page.scss'],
  standalone: true,
  imports: [IonicModule],
})
export class UserPlaceholderPage implements OnInit {
  user: User | null = null;
  typeLabel = 'Usuario';

  constructor(
    private authService: AuthService,
    private router:      Router,
    private state:       PictogramStateService,
  ) {}

  ngOnInit() {
    this.user = this.authService.getCurrentUser();
    if (this.user?.type) {
      this.typeLabel = TYPE_LABELS[this.user.type] ?? this.user.type;
    }
  }

  goOwnPictograms() {
    this.state.userId       = null;
    this.state.returnTo     = '/user-placeholder';
    this.state.allowedUsers = null; // own-pictograms detecta rol 'parent' y carga los hijos
    this.router.navigate(['/own-pictograms-placeholder']);
  }

  goToObjectives() {
    this.router.navigate(['/objectives-list'], {
      queryParams: { role: 'family', returnTo: '/user-placeholder' },
    });
  }

  logout() { this.authService.logout(); }
}
