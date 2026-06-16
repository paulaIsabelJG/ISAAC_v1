import { Component, Input, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ActionSheetController, ToastController } from '@ionic/angular';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Board } from '../../services/board.service';
import { ObfExportService } from '../../services/obf-export.service';
import { BoardPdfExportService } from '../../services/board-pdf-export.service';
import { UserBoardCardComponent } from '../user-board-card/user-board-card.component';

@Component({
  selector:    'app-user-boards-panel',
  templateUrl: './user-boards-panel.component.html',
  styleUrls:   ['./user-boards-panel.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule, UserBoardCardComponent],
})
export class UserBoardsPanelComponent implements OnDestroy {
  @Input() boards:       Board[] = [];
  @Input() loading       = false;
  @Input() error         = '';
  @Input() userId        = '';
  @Input() userName      = '';
  @Input() canEditBoards = false;

  holdBoardId  = '';
  holdProgress = 0;
  isDownloading = false;

  private _holdInterval?: ReturnType<typeof setInterval>;
  private _holdStartX   = 0;
  private _holdStartY   = 0;
  private _suppressNextCardClick = false;

  constructor(
    private router:       Router,
    private authService:  AuthService,
    private obfExport:    ObfExportService,
    private pdfExport:    BoardPdfExportService,
    private actionSheet:  ActionSheetController,
    private toastCtrl:    ToastController,
  ) {}

  ngOnDestroy(): void { this._clearHoldTimer(); }

  // ── Navegación ───────────────────────────────────────────────────────────────

  goToCreate(): void {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/user-session/' + this.userId,
        creatorId:   this.userId,
        creatorName: this.userName,
      },
    });
  }

  onBoardCardClick(board: Board): void {
    if (this._suppressNextCardClick) {
      this._suppressNextCardClick = false;
      return;
    }
    this._openBoard(board);
  }

  private _openBoard(board: Board): void {
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: { userId: logUserId, returnTo: '/user-session/' + this.userId },
    });
  }

  private _openBoardHidden(board: Board): void {
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: { userId: logUserId, returnTo: '/user-session/' + this.userId },
      state: { privateMode: true },
    });
  }

  // ── Pulsación larga ───────────────────────────────────────────────────────────

  startHold(event: PointerEvent, board: Board): void {
    this._holdStartX  = event.clientX;
    this._holdStartY  = event.clientY;
    this.holdBoardId  = board._id;
    this.holdProgress = 0;

    const DURATION_MS = 2000;
    const TICK_MS     = 50;
    const totalTicks  = DURATION_MS / TICK_MS;
    let   tick        = 0;

    this._holdInterval = setInterval(() => {
      tick++;
      this.holdProgress = Math.round((tick / totalTicks) * 100);
      if (tick >= totalTicks) {
        this._clearHoldTimer();
        this.holdBoardId            = '';
        this.holdProgress           = 0;
        this._suppressNextCardClick = true;
        void this._showBoardOptions(board);
      }
    }, TICK_MS);
  }

  onHoldPointerMove(event: PointerEvent): void {
    if (!this.holdBoardId) return;
    const dx = event.clientX - this._holdStartX;
    const dy = event.clientY - this._holdStartY;
    if (Math.sqrt(dx * dx + dy * dy) > 15) this.cancelHold();
  }

  cancelHold(): void {
    this._clearHoldTimer();
    this.holdBoardId  = '';
    this.holdProgress = 0;
  }

  private _clearHoldTimer(): void {
    if (this._holdInterval != null) {
      clearInterval(this._holdInterval);
      this._holdInterval = undefined;
    }
  }

  // ── Menú de opciones ──────────────────────────────────────────────────────────

  private async _showBoardOptions(board: Board): Promise<void> {
    const sheet = await this.actionSheet.create({
      header: board.name || 'Opciones del tablero',
      buttons: [
        { text: 'Entrar en modo oculto', icon: 'eye-off-outline',   handler: () => { this._openBoardHidden(board); } },
        { text: 'Descargar OBZ',         icon: 'archive-outline',    handler: () => { void this._downloadOBZ(board); } },
        { text: 'Descargar PDF',         icon: 'document-outline',   handler: () => { void this._downloadPDF(board); } },
        { text: 'Cancelar',              icon: 'close-outline',      role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  // ── Descargas ──────────────────────────────────────────────────────────────────

  private async _downloadOBZ(board: Board): Promise<void> {
    this.isDownloading = true;
    try {
      const { boards, warnings } = await this.obfExport.collectLinkedBoards(board);
      if (warnings.length) console.warn('[OBZ]', warnings);
      const { blob } = await this.obfExport.buildOBZPackage(board, boards);
      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'), { href: url, download: `${this._safeName(board.name)}.obz` });
      a.click();
      URL.revokeObjectURL(url);
      await this._toast('Tablero descargado como OBZ ✓', 'success');
    } catch {
      await this._toast('Error al generar el OBZ.', 'danger');
    } finally {
      this.isDownloading = false;
    }
  }

  private async _downloadPDF(board: Board): Promise<void> {
    this.isDownloading = true;
    try {
      await this.pdfExport.exportToPdf(board);
      await this._toast('Tablero descargado como PDF ✓', 'success');
    } catch {
      await this._toast('Error al generar el PDF.', 'danger');
    } finally {
      this.isDownloading = false;
    }
  }

  private async _toast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await t.present();
  }

  private _safeName(name: string): string {
    return name.replace(/[^\w\-áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_') || 'tablero';
  }
}
