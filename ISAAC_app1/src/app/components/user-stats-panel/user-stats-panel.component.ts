import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FullBackendUser } from '../../services/user.service';

@Component({
  selector:    'app-user-stats-panel',
  templateUrl: './user-stats-panel.component.html',
  styleUrls:   ['./user-stats-panel.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class UserStatsPanelComponent {
  @Input() user:   FullBackendUser | null = null;
  @Input() userId  = '';
}
