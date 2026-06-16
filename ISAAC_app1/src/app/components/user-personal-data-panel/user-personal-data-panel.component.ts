import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { SafeUrl } from '@angular/platform-browser';
import { FullBackendUser } from '../../services/user.service';

@Component({
  selector:    'app-user-personal-data-panel',
  templateUrl: './user-personal-data-panel.component.html',
  styleUrls:   ['./user-personal-data-panel.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule],
})
export class UserPersonalDataPanelComponent {
  @Input() user:      FullBackendUser | null = null;
  @Input() userId     = '';
  @Input() avatarUrl: SafeUrl | string       = '';

  constructor(private router: Router) {}

  goToEdit(): void {
    this.router.navigate(['/user-final-form', this.userId], {
      queryParams: { returnTo: '/user-session/' + this.userId },
    });
  }

  get displayName(): string {
    if (!this.user) return '';
    return [this.user.name, this.user.surname].filter(Boolean).join(' ');
  }

  get initial(): string {
    return this.user?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  get age(): number | null {
    if (!this.user?.birthDate) return null;
    const diff = Date.now() - new Date(this.user.birthDate).getTime();
    return Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  }

  get formattedBirth(): string {
    if (!this.user?.birthDate) return '';
    return new Date(this.user.birthDate).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
  }

  get genderLabel(): string {
    const g = this.user?.gender;
    if (g === 'male')   return 'Masculino';
    if (g === 'female') return 'Femenino';
    return '';
  }
}
