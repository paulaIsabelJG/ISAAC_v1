import { Component, OnInit } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { AuthService, User } from '../../services/auth.service';

// Etiqueta legible por tipo de usuario (valor backend → texto UI)
const TYPE_LABELS: Record<string, string> = {
  teacher: 'Organización',
  parent:  'Profesional / Familiar',
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
  user: User | null   = null;
  typeLabel = 'Usuario';

  constructor(private authService: AuthService) {}

  ngOnInit() {
    this.user = this.authService.getCurrentUser();
    if (this.user?.type) {
      this.typeLabel = TYPE_LABELS[this.user.type] ?? this.user.type;
    }
  }

  logout() { this.authService.logout(); }
}
