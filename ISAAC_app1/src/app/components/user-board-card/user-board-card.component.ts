import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { Board } from '../../services/board.service';

@Component({
  selector:   'app-user-board-card',
  templateUrl: './user-board-card.component.html',
  styleUrls:   ['./user-board-card.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule],
  host:        { style: 'display: block' },
})
export class UserBoardCardComponent {
  @Input() board!: Board;
  @Input() showHold   = false;
  @Input() holdProgress = 0;

  constructor(private sanitizer: DomSanitizer) {}

  get safeImageUrl(): SafeUrl | string {
    return buildSafeUrlUtil(this.board?.imageUrl, this.sanitizer);
  }

  get relativeDate(): string {
    const raw = this.board?.updatedAt ?? this.board?.createdAt;
    if (!raw) return '';
    const diff = Math.floor((Date.now() - new Date(raw).getTime()) / 86_400_000);
    if (diff === 0)  return 'Hoy';
    if (diff === 1)  return 'Ayer';
    if (diff < 7)   return `Hace ${diff} días`;
    if (diff < 30)  return `Hace ${Math.floor(diff / 7)} sem.`;
    if (diff < 365) return `Hace ${Math.floor(diff / 30)} meses`;
    return `Hace ${Math.floor(diff / 365)} año${Math.floor(diff / 365) > 1 ? 's' : ''}`;
  }
}
