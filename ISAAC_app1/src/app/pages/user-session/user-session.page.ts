import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActionSheetController, IonicModule, ToastController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import type { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { UserService, FullBackendUser } from '../../services/user.service';
import { BoardService, Board } from '../../services/board.service';
import { TtsService } from '../../services/tts.service';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { ObfExportService } from '../../services/obf-export.service';
import { BoardPdfExportService } from '../../services/board-pdf-export.service';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import {
  UserProfileSidebarComponent,
  SidebarPermissions,
} from '../../components/user-profile-sidebar/user-profile-sidebar.component';
import { UserBoardCardComponent } from '../../components/user-board-card/user-board-card.component';

@Component({
  selector: 'app-user-session',
  templateUrl: './user-session.page.html',
  styleUrls:  ['./user-session.page.scss'],
  standalone: true,
  imports: [IonicModule, LoadingErrorStateComponent, UserProfileSidebarComponent, UserBoardCardComponent],
})
export class UserSessionPage implements OnInit, OnDestroy {

  userId     = '';
  targetUser: FullBackendUser | null = null;
  avatarUrl:  SafeUrl | string       = '';

  permissions: SidebarPermissions = {
    canViewPersonalData: false,
    canViewStats:        false,
    canEditBoards:       false,
  };

  isLoading = true;
  loadError = '';

  assignedBoards: Board[] = [];
  boardsLoading  = true;
  boardsError    = '';

  voiceLoadingBanner = false;
  voiceLoadingPct    = 0;
  private _voicePollInterval?: ReturnType<typeof setInterval>;

  holdBoardId   = '';
  holdProgress  = 0;
  isDownloading = false;
  private _holdInterval?: ReturnType<typeof setInterval>;
  private _holdStartX   = 0;
  private _holdStartY   = 0;
  private _suppressNextCardClick = false;

  constructor(
    private route:        ActivatedRoute,
    private router:       Router,
    private authService:  AuthService,
    private userService:  UserService,
    private boardService: BoardService,
    private sanitizer:    DomSanitizer,
    private ttsSvc:       TtsService,
    private aac:          AacRuntimeService,
    private obfExport:    ObfExportService,
    private pdfExport:    BoardPdfExportService,
    private actionSheet:  ActionSheetController,
    private toastCtrl:    ToastController,
    private http:         HttpClient,
  ) {}

  ngOnDestroy(): void { this._stopVoicePoll(); }

  ngOnInit(): void {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';
  }

  ionViewWillEnter(): void {
    if (this.userId) {
      void this.loadData();
      void this.loadBoards();
    }
  }

  // ── Carga ────────────────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.userService.getUserById(this.userId));
      this.targetUser = res.user;
      this.avatarUrl  = buildSafeUrlUtil(this.targetUser.image, this.sanitizer);
      const vs = this.targetUser.voiceSettings;
      this.ttsSvc.setFromVoiceSettings(
        this.fromLogin ? vs : null,
        this.fromLogin ? (this.targetUser.gender ?? '') : '',
      );
      const customReady = vs?.voiceMode === 'custom' && vs?.customVoice?.status === 'ready';
      this.aac.configureSoundSettings(
        vs?.soundEnabled ?? true, vs?.voiceMode ?? 'catalog', customReady, this.userId,
        vs?.catalogVoice?.voiceURI, vs?.catalogVoice?.speechRate,
        vs?.catalogVoice?.speechPitch, vs?.catalogVoice?.speechVolume,
        this.targetUser.gender ?? '',
      );
      if (customReady) {
        this.aac.prewarmCache(['salir', 'volver', 'mis objetivos', 'datos personales',
          'estadísticas', 'tablero builder', 'tablero']);
      }
      await this.computePermissions();
      this.checkVoiceCache();
    } catch (err: unknown) {
      const status = (err as HttpErrorResponse)?.status;
      this.loadError = status === 401 || status === 403
        ? 'Tu sesión ha caducado. Inicia sesión de nuevo.'
        : status === 404 ? 'El usuario no existe o ha sido eliminado.'
        : 'Error al cargar el usuario. Inténtalo de nuevo.';
    } finally {
      this.isLoading = false;
    }
  }

  private async loadBoards(): Promise<void> {
    this.boardsLoading = true;
    this.boardsError   = '';
    try {
      const res = await firstValueFrom(this.boardService.getAssignedBoards(this.userId));
      this.assignedBoards = res.boards;
      this.aac.prewarmCache(res.boards.map((b: Board) => b.name).filter(Boolean));
    } catch {
      this.boardsError = 'No se pudieron cargar los tableros.';
    } finally {
      this.boardsLoading = false;
    }
  }

  // ── Permisos ─────────────────────────────────────────────────────────────────

  private async computePermissions(): Promise<void> {
    const viewer = this.authService.getCurrentUser();
    if (!viewer || !this.targetUser) return;

    if (viewer.type === 'teacher') {
      const ap = (this.targetUser.assignedProfessionals ?? []).find(
        e => e.professionalId?.toString() === viewer.id
      );
      this.permissions = ap
        ? { canViewPersonalData: ap.canEditPersonalData, canViewStats: ap.canViewStats, canEditBoards: ap.canEditBoards }
        : { canViewPersonalData: true, canViewStats: true, canEditBoards: true };
      return;
    }

    if (viewer.type === 'user') {
      const sp = this.targetUser.selfPermissions;
      this.permissions = {
        canViewPersonalData: sp?.canEditPersonalData ?? false,
        canViewStats:        sp?.canViewStats        ?? false,
        canEditBoards:       sp?.canEditBoards       ?? false,
      };
      return;
    }

    if (viewer.type === 'parent') {
      try {
        const parentRes = await firstValueFrom(this.userService.getUserById(viewer.id));
        const entry = (parentRes.user.childrenAccess ?? []).find(
          ca => ca.childId?.toString() === this.userId
        );
        this.permissions = entry
          ? { canViewPersonalData: entry.canEditPersonalData, canViewStats: entry.canViewStats, canEditBoards: entry.canEditBoards }
          : { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
      } catch {
        this.permissions = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
      }
    }
  }

  // ── Getters ───────────────────────────────────────────────────────────────────

  get fromLogin(): boolean {
    return this.authService.getCurrentUser()?.type === 'user';
  }

  // ── Navegación desde sidebar ──────────────────────────────────────────────────

  onNavSelect(section: string): void {
    switch (section) {
      case 'personal':   this.goToPersonalData(); break;
      case 'stats':      this.goToStats();        break;
      case 'builder':    this.goToBoardBuilder();  break;
      case 'objectives': this.goToObjectives();    break;
      case 'back':       this.goBack();            break;
    }
  }

  goBack(): void {
    const viewer = this.authService.getCurrentUser();
    if (viewer?.type === 'user') {
      this.aac.speakText('salir');
      this.authService.logout();
    } else if (viewer?.type === 'teacher' && viewer.professionalType) {
      this.router.navigate(['/professional-session', viewer.id]);
    } else {
      this.router.navigate(['/organization-dashboard']);
    }
  }

  goToObjectives(): void {
    this.router.navigate(['/objectives-list'], {
      queryParams: { role: 'creator', userId: this.userId, returnTo: '/user-session/' + this.userId },
    });
  }

  goToPersonalData(): void {
    this.router.navigate(['/user-final-form', this.userId], {
      queryParams: { returnTo: '/user-session/' + this.userId },
    });
  }

  goToStats(): void {
    this.router.navigate(['/statistics-placeholder']);
  }

  goToBoardBuilder(): void {
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/user-session/' + this.userId,
        creatorId:   this.userId,
        creatorName: this.targetUser?.name || '',
      },
    });
  }

  // ── Tableros ──────────────────────────────────────────────────────────────────

  openBoard(board: Board): void {
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: { userId: logUserId, returnTo: '/user-session/' + this.userId },
    });
  }

  onBoardCardClick(board: Board): void {
    if (this._suppressNextCardClick) { this._suppressNextCardClick = false; return; }
    this.openBoard(board);
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
    if (this._holdInterval != null) { clearInterval(this._holdInterval); this._holdInterval = undefined; }
  }

  private async _showBoardOptions(board: Board): Promise<void> {
    const sheet = await this.actionSheet.create({
      header: board.name || 'Opciones del tablero',
      buttons: [
        { text: 'Entrar en modo oculto', icon: 'eye-off-outline',  handler: () => { this._openBoardHidden(board); } },
        { text: 'Descargar OBZ',         icon: 'archive-outline',   handler: () => { void this._downloadOBZ(board); } },
        { text: 'Descargar PDF',         icon: 'document-outline',  handler: () => { void this._downloadPDF(board); } },
        { text: 'Cancelar',              icon: 'close-outline',     role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private _openBoardHidden(board: Board): void {
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: { userId: logUserId, returnTo: '/user-session/' + this.userId },
      state: { privateMode: true },
    });
  }

  // ── Descargas ─────────────────────────────────────────────────────────────────

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

  // ── Voz: banner ───────────────────────────────────────────────────────────────

  private checkVoiceCache(): void {
    const vs = this.targetUser?.voiceSettings;
    if (vs?.voiceMode !== 'custom' || vs?.customVoice?.status !== 'ready') return;
    this._stopVoicePoll();
    const url = `${environment.apiUrl}/voice/${this.userId}/cache-status`;
    firstValueFrom(this.http.get(url)).then((status: any) => {
      if (!status?.ready || status.missingCount === 0) return;
      this.voiceLoadingPct    = status.coveragePct ?? 0;
      this.voiceLoadingBanner = true;
      this.http.post(`${environment.apiUrl}/voice/${this.userId}/prewarm`, {}).subscribe();
      this._voicePollInterval = setInterval(async () => {
        try {
          const s: any = await firstValueFrom(this.http.get(url));
          this.voiceLoadingPct = s?.coveragePct ?? this.voiceLoadingPct;
          if (!s?.ready || s.missingCount === 0) { this.voiceLoadingBanner = false; this._stopVoicePoll(); }
        } catch { /* ignorar */ }
      }, 12_000);
    }).catch(() => { /* ignorar */ });
  }

  private _stopVoicePoll(): void {
    if (this._voicePollInterval) { clearInterval(this._voicePollInterval); this._voicePollInterval = undefined; }
  }
}
