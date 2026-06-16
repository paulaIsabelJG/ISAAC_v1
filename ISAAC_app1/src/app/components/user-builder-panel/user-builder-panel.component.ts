import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Board } from '../../services/board.service';

@Component({
  selector:    'app-user-builder-panel',
  templateUrl: './user-builder-panel.component.html',
  styleUrls:   ['./user-builder-panel.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class UserBuilderPanelComponent {
  @Input() userId   = '';
  @Input() userName = '';
  @Input() boards:  Board[] = [];

  constructor(private router: Router) {}

  get recentBoards(): Board[] {
    return [...this.boards]
      .sort((a, b) => {
        const da = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
        const db = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
        return db - da;
      })
      .slice(0, 3);
  }

  openBuilder(): void {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/user-session/' + this.userId,
        creatorId:   this.userId,
        creatorName: this.userName,
      },
    });
  }

  relativeDate(board: Board): string {
    const raw = board.updatedAt ?? board.createdAt;
    if (!raw) return '';
    const diff = Math.floor((Date.now() - new Date(raw).getTime()) / 86_400_000);
    if (diff === 0)  return 'Hoy';
    if (diff === 1)  return 'Ayer';
    if (diff < 7)   return `Hace ${diff} días`;
    if (diff < 30)  return `Hace ${Math.floor(diff / 7)} sem.`;
    return `Hace ${Math.floor(diff / 30)} meses`;
  }
}
