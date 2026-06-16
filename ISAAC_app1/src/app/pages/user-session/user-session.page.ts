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
import {
  UserService,
  FullBackendUser,
  ChildrenAccessEntry,
  AssignedProfessionalPayload,
} from '../../services/user.service';
import { BoardService, Board } from '../../services/board.service';
import { TtsService } from '../../services/tts.service';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { ObfExportService } from '../../services/obf-export.service';
import { BoardPdfExportService } from '../../services/board-pdf-export.service';
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';
import { LoadingErrorStateComponent } from '../../components/loading-error-state/loading-error-state.component';
import {
  UserProfileSidebarComponent,
  SidebarPermissions,
} from '../../components/user-profile-sidebar/user-profile-sidebar.component';
import { UserBoardCardComponent } from '../../components/user-board-card/user-board-card.component';

interface FamilyRow {
  parentId:               string;
  name:                   string;
  surname:                string;
  email:                  string;
  image?:                 string | null;
  fullChildrenAccess:     ChildrenAccessEntry[];
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
  saving:                 boolean;
  saved:                  boolean;
}

interface ProfRow {
  professionalId:         string;
  name:                   string;
  surname:                string;
  email:                  string;
  image?:                 string | null;
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
  saving:                 boolean;
  saved:                  boolean;
}

@Component({
  selector: 'app-user-session',
  templateUrl: './user-session.page.html',
  styleUrls:  ['./user-session.page.scss'],
  standalone: true,
  imports: [IonicModule, AppPageHeaderComponent, LoadingErrorStateComponent, UserProfileSidebarComponent, UserBoardCardComponent],
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

  // ── Sección activa ────────────────────────────────────────────────────────────
  activeSection: 'boards' | 'family' | 'professionals' = 'boards';

  // ── Familiares ────────────────────────────────────────────────────────────────
  families:        FamilyRow[] = [];
  familiesLoading  = false;
  familiesError    = '';
  familiesLoaded   = false;

  // ── Profesionales ─────────────────────────────────────────────────────────────
  professionals:        ProfRow[] = [];
  professionalsLoading  = false;
  professionalsError    = '';
  professionalsLoaded   = false;

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
    this.activeSection       = 'boards';
    this.familiesLoaded      = false;
    this.professionalsLoaded = false;
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
      case 'boards':        this.activeSection = 'boards';                    break;
      case 'personal':      this.goToPersonalData();                          break;
      case 'stats':         this.goToStats();                                 break;
      case 'builder':       this.goToBoardBuilder();                          break;
      case 'objectives':    this.goToObjectives();                            break;
      case 'family':        void this.goToFamilySection();                    break;
      case 'professionals': void this.goToProfessionalsSection();             break;
      case 'back':          this.goBack();                                    break;
    }
  }

  goBackToBoards(): void {
    this.activeSection = 'boards';
  }

  async goToFamilySection(): Promise<void> {
    this.activeSection = 'family';
    if (!this.familiesLoaded) {
      await this.loadFamilies();
    }
  }

  async goToProfessionalsSection(): Promise<void> {
    this.activeSection = 'professionals';
    if (!this.professionalsLoaded) {
      await this.loadProfessionals();
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
      queryParams: {
        role:     'creator',
        userId:   this.userId,
        userName: this.targetUser?.name || '',
        returnTo: '/user-session/' + this.userId,
      },
    });
  }

  goToPersonalData(): void {
    this.router.navigate(['/user-final-form', this.userId], {
      queryParams: { returnTo: '/user-session/' + this.userId },
    });
  }

  goToStats(): void {
    this.router.navigate(['/organization-statistics'], {
      queryParams: {
        userId:   this.userId,
        userName: this.targetUser?.name || '',
        returnTo: '/user-session/' + this.userId,
      },
    });
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

  // ── Familiares y Profesionales ────────────────────────────────────────────────

  private async loadFamilies(): Promise<void> {
    this.familiesLoading = true;
    this.familiesError   = '';
    try {
      const res = await firstValueFrom(this.userService.getFamiliesForUsers([this.userId]));
      const results = await Promise.allSettled(
        res.families.map(async (parent) => {
          const full  = await firstValueFrom(this.userService.getUserById(parent._id));
          const entry = full.user.childrenAccess?.find(
            e => e.childId?.toString() === this.userId
          );
          return {
            parentId:               parent._id,
            name:                   parent.name,
            surname:                parent.surname ?? '',
            email:                  parent.email,
            image:                  parent.image ?? null,
            fullChildrenAccess:     (full.user.childrenAccess ?? []) as ChildrenAccessEntry[],
            canViewStats:           entry?.canViewStats           ?? false,
            canEditBoards:          entry?.canEditBoards          ?? false,
            canEditPersonalData:    entry?.canEditPersonalData    ?? false,
            canAddPictograms:       entry?.canAddPictograms       ?? false,
            canAssignProfessionals: entry?.canAssignProfessionals ?? false,
            canAssignFamilies:      entry?.canAssignFamilies      ?? false,
            canViewAssignedBoards:  entry?.canViewAssignedBoards  ?? false,
            saving:                 false,
            saved:                  false,
          } as FamilyRow;
        })
      );
      this.families      = results
        .filter((r): r is PromiseFulfilledResult<FamilyRow> => r.status === 'fulfilled')
        .map(r => r.value);
      this.familiesLoaded = true;
    } catch {
      this.familiesError = 'Error al cargar los familiares.';
    } finally {
      this.familiesLoading = false;
    }
  }

  private async loadProfessionals(): Promise<void> {
    this.professionalsLoading = true;
    this.professionalsError   = '';
    try {
      const res = await firstValueFrom(this.userService.getAssignedProfessionals(this.userId));
      this.professionals = res.assignedProfessionals.map(p => ({
        ...p,
        saving: false,
        saved:  false,
      }));
      this.professionalsLoaded = true;
    } catch {
      this.professionalsError = 'Error al cargar los profesionales.';
    } finally {
      this.professionalsLoading = false;
    }
  }

  async saveFamilyRow(row: FamilyRow): Promise<void> {
    row.saving = true;
    try {
      const idx = row.fullChildrenAccess.findIndex(
        e => e.childId?.toString() === this.userId
      );
      const newEntry: ChildrenAccessEntry = {
        childId:                this.userId,
        canViewStats:           row.canViewStats,
        canEditBoards:          row.canEditBoards,
        canEditPersonalData:    row.canEditPersonalData,
        canAddPictograms:       row.canAddPictograms,
        canAssignProfessionals: row.canAssignProfessionals,
        canAssignFamilies:      row.canAssignFamilies,
        canViewAssignedBoards:  row.canViewAssignedBoards,
      };
      const updated = [...row.fullChildrenAccess];
      if (idx >= 0) updated[idx] = newEntry;
      else updated.push(newEntry);
      await firstValueFrom(this.userService.updateChildrenAccess(row.parentId, updated));
      row.fullChildrenAccess = updated;
      row.saved = true;
      setTimeout(() => { row.saved = false; }, 2500);
    } catch {
      await this._toast('Error al guardar permisos del familiar.', 'danger');
    } finally {
      row.saving = false;
    }
  }

  async saveProfRow(row: ProfRow): Promise<void> {
    row.saving = true;
    try {
      const payload: AssignedProfessionalPayload[] = this.professionals.map(p => ({
        professionalId:         p.professionalId,
        canViewStats:           p.canViewStats,
        canEditBoards:          p.canEditBoards,
        canEditPersonalData:    p.canEditPersonalData,
        canAddPictograms:       p.canAddPictograms,
        canAssignProfessionals: p.canAssignProfessionals,
        canAssignFamilies:      p.canAssignFamilies,
        canViewAssignedBoards:  p.canViewAssignedBoards,
      }));
      await firstValueFrom(this.userService.updateAssignedProfessionals(this.userId, payload));
      row.saved = true;
      setTimeout(() => { row.saved = false; }, 2500);
    } catch {
      await this._toast('Error al guardar permisos del profesional.', 'danger');
    } finally {
      row.saving = false;
    }
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
