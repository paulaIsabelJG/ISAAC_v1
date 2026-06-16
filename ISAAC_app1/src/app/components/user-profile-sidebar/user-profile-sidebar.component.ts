import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FullBackendUser } from '../../services/user.service';

export interface SidebarPermissions {
  canViewPersonalData: boolean;
  canViewStats:        boolean;
  canEditBoards:       boolean;
}

@Component({
  selector:    'app-user-profile-sidebar',
  templateUrl: './user-profile-sidebar.component.html',
  styleUrls:   ['./user-profile-sidebar.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class UserProfileSidebarComponent {
  @Input() user:        FullBackendUser | null  = null;
  @Input() avatarUrl:   SafeUrl | string        = '';
  @Input() fromLogin    = false;
  @Input() permissions: SidebarPermissions      = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };

  @Output() navSelect = new EventEmitter<string>();

  get initial(): string {
    return this.user?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  get displayName(): string {
    if (!this.user) return '';
    return [this.user.name, this.user.surname].filter(Boolean).join(' ');
  }
}
