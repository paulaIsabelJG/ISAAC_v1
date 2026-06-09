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
import { AppPageHeaderComponent } from '../../components/app-page-header/app-page-header.component';
import { BoardMiniCardComponent } from '../../components/board-mini-card/board-mini-card.component';

// ─── Permisos resueltos para la vista ────────────────────────────────────────
interface ViewPermissions {
  canViewPersonalData: boolean;
  canViewStats:        boolean;
  canEditBoards:       boolean;
}

@Component({
  selector: 'app-user-session',
  templateUrl: './user-session.page.html',
  styleUrls:  ['./user-session.page.scss'],
  standalone: true,
  imports: [IonicModule, LoadingErrorStateComponent, AppPageHeaderComponent, BoardMiniCardComponent],
})
export class UserSessionPage implements OnInit, OnDestroy {

  userId     = '';
  targetUser: FullBackendUser | null = null;
  avatarUrl:  SafeUrl | string       = '';

  permissions: ViewPermissions = {
    canViewPersonalData: false,
    canViewStats:        false,
    canEditBoards:       false,
  };

  isLoading = true;
  loadError = '';

  // ── Tableros asignados (boardRole=main, userId=this.userId) ──────────────────
  assignedBoards: Board[] = [];
  boardsLoading  = true;
  boardsError    = '';

  // ── Banner de carga de voz personalizada ────────────────────────────────────
  voiceLoadingBanner = false;
  voiceLoadingPct    = 0;
  private _voicePollInterval?: ReturnType<typeof setInterval>;

  // ── Pulsación larga en tarjeta de tablero ────────────────────────────────────
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

  ngOnDestroy(): void {
    this._stopVoicePoll();
  }

  ngOnInit() {
    this.userId = this.route.snapshot.paramMap.get('userId') ?? '';
  }

  /**
   * ionViewWillEnter garantiza recarga si se vuelve desde datos personales
   * sin destruir el componente.
   */
  ionViewWillEnter() {
    console.log('[UserSession] ionViewWillEnter — userId:', this.userId);
    if (this.userId) {
      this.loadData();
      this.loadBoards();
    } else {
      console.warn('[UserSession] userId vacío, no se carga nada');
    }
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  private async loadData(): Promise<void> {
    console.log('[UserSession] loadData() start');
    this.isLoading = true;
    this.loadError = '';

    try {
      const res = await firstValueFrom(this.userService.getUserById(this.userId));
      this.targetUser = res.user;
      this.avatarUrl  = this.buildSafeUrl(this.targetUser.image);
      console.log('[UserSession] targetUser cargado — voiceMode:', this.targetUser?.voiceSettings?.voiceMode, '| customVoice status:', this.targetUser?.voiceSettings?.customVoice?.status);
      // Configurar TTS con los ajustes del usuario objetivo (siempre, no solo fromLogin)
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
        this.aac.prewarmCache([
          'salir', 'volver', 'mis objetivos', 'datos personales',
          'estadísticas', 'tablero builder', 'tablero',
        ]);
      }
      await this.computePermissions();
      // Verificar cobertura de caché (no bloquea la carga)
      console.log('[UserSession] Llamando a checkVoiceCache()');
      this.checkVoiceCache();
    } catch (err: unknown) {
      const status = (err as HttpErrorResponse)?.status;
      if (status === 401 || status === 403) {
        // El interceptor ya habrá redirigido a /login?expired=true,
        // pero por si el componente aún está activo mostramos un mensaje claro.
        this.loadError = 'Tu sesión ha caducado. Inicia sesión de nuevo.';
      } else if (status === 404) {
        this.loadError = 'El usuario no existe o ha sido eliminado.';
      } else if (status === 500) {
        this.loadError = 'Error en el servidor. Inténtalo más tarde.';
      } else {
        this.loadError = 'Error al cargar el usuario. Inténtalo de nuevo.';
      }
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

  // ── Cálculo de permisos ─────────────────────────────────────────────────────

  /**
   * Reglas:
   *   teacher → si está en assignedProfessionals usa sus permisos;
   *             si NO está, es la organización → todo visible.
   *   user    → si es el propio usuario: solo Datos personales.
   *   parent  → busca en su propia childrenAccess (carga su usuario).
   */
  private async computePermissions(): Promise<void> {
    const viewer = this.authService.getCurrentUser();
    if (!viewer || !this.targetUser) return;

    if (viewer.type === 'teacher') {
      const ap = (this.targetUser.assignedProfessionals ?? []).find(
        (e) => e.professionalId?.toString() === viewer.id
      );
      if (ap) {
        // Profesional asignado: usa sus permisos
        this.permissions = {
          canViewPersonalData: ap.canEditPersonalData,
          canViewStats:        ap.canViewStats,
          canEditBoards:       ap.canEditBoards,
        };
      } else {
        // Organización: acceso total
        this.permissions = { canViewPersonalData: true, canViewStats: true, canEditBoards: true };
      }
      return;
    }

    if (viewer.type === 'user') {
      // Usuario final: permisos según selfPermissions guardados en su propio perfil.
      // Si no existe el campo (usuarios antiguos o sin permisos), todo false.
      const sp = this.targetUser?.selfPermissions;
      this.permissions = {
        canViewPersonalData: sp?.canEditPersonalData ?? false,
        canViewStats:        sp?.canViewStats        ?? false,
        canEditBoards:       sp?.canEditBoards       ?? false,
      };
      return;
    }

    if (viewer.type === 'parent') {
      try {
        // Cargar childrenAccess del familiar logueado
        const parentRes = await firstValueFrom(this.userService.getUserById(viewer.id));
        const entry = (parentRes.user.childrenAccess ?? []).find(
          (ca) => ca.childId?.toString() === this.userId
        );
        if (entry) {
          this.permissions = {
            canViewPersonalData: entry.canEditPersonalData,
            canViewStats:        entry.canViewStats,
            canEditBoards:       entry.canEditBoards,
          };
        } else {
          // Sin entrada → solo lista de tableros (sin controles)
          this.permissions = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
        }
      } catch {
        this.permissions = { canViewPersonalData: false, canViewStats: false, canEditBoards: false };
      }
    }
  }

  // ── Header mode ─────────────────────────────────────────────────────────────

  /**
   * True cuando el viewer es el propio usuario final (type='user').
   * Eso significa que llegó directamente desde login → mostramos cabecera ISAAC + Salir.
   * Un teacher/org que navega desde el dashboard tendrá false → mostramos ← Volver.
   */
  get fromLogin(): boolean {
    return this.authService.getCurrentUser()?.type === 'user';
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  buildSafeUrl(imageStr?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(imageStr, this.sanitizer);
  }

  getInitial(): string {
    return this.targetUser?.name?.charAt(0)?.toUpperCase() ?? '?';
  }

  getDisplayName(): string {
    return this.targetUser?.name ?? '';
  }

  getDisplaySurname(): string {
    return this.targetUser?.surname ?? '';
  }

  // ── Voz: banner de pre-calentado de caché ────────────────────────────────────

  private async checkVoiceCache(): Promise<void> {
    const vs = this.targetUser?.voiceSettings;
    console.log('[checkVoiceCache] voiceMode:', vs?.voiceMode, '| status:', vs?.customVoice?.status);
    if (vs?.voiceMode !== 'custom' || vs?.customVoice?.status !== 'ready') {
      console.log('[checkVoiceCache] Saliendo: voz no lista o no es custom');
      return;
    }

    // Limpiar poll anterior (si se entra/sale varias veces sin destruir el componente)
    this._stopVoicePoll();

    try {
      const url = `${environment.apiUrl}/voice/${this.userId}/cache-status`;
      console.log('[checkVoiceCache] Llamando a:', url);
      const status: any = await firstValueFrom(this.http.get(url));
      console.log('[checkVoiceCache] Respuesta cache-status:', status);

      if (!status?.ready || status.missingCount === 0) {
        console.log('[checkVoiceCache] Caché completa o voz no lista, no se muestra banner');
        return;
      }

      this.voiceLoadingPct    = status.coveragePct ?? 0;
      this.voiceLoadingBanner = true;
      console.log('[checkVoiceCache] Banner activado —', status.missingCount, 'labels pendientes de', status.totalLabels);

      // Lanzar prewarm en el backend
      this.http.post(`${environment.apiUrl}/voice/${this.userId}/prewarm`, {}).subscribe({
        next: () => console.log('[checkVoiceCache] Prewarm lanzado'),
        error: (e) => console.warn('[checkVoiceCache] Error al lanzar prewarm:', e.status),
      });

      // Polling cada 12 s hasta cobertura completa
      this._voicePollInterval = setInterval(async () => {
        try {
          const s: any = await firstValueFrom(
            this.http.get(`${environment.apiUrl}/voice/${this.userId}/cache-status`)
          );
          this.voiceLoadingPct = s?.coveragePct ?? this.voiceLoadingPct;
          console.log('[checkVoiceCache] Poll:', s?.cachedCount, '/', s?.totalLabels, '—', s?.coveragePct + '%');
          if (!s?.ready || s.missingCount === 0) {
            this.voiceLoadingBanner = false;
            this._stopVoicePoll();
            console.log('[checkVoiceCache] Caché completa, banner ocultado');
          }
        } catch { /* ignorar errores transitorios */ }
      }, 12_000);

    } catch (err: any) {
      console.warn('[checkVoiceCache] Error al llamar cache-status:', err?.status, err?.message);
    }
  }

  private _stopVoicePoll(): void {
    if (this._voicePollInterval) {
      clearInterval(this._voicePollInterval);
      this._voicePollInterval = undefined;
    }
  }

  // ── Voz ──────────────────────────────────────────────────────────────────────

  private speakNav(text: string): void {
    if (this.aac.customVoiceReady) {
      this.aac.speakText(text);
    } else {
      this.ttsSvc.speakIfEnabled(text);
    }
  }

  // ── Navegación ───────────────────────────────────────────────────────────────

  goBack() {
    const viewer = this.authService.getCurrentUser();
    if (viewer?.type === 'user') {
      this.speakNav('salir');
      this.authService.logout();
    } else if (viewer?.type === 'teacher' && viewer.professionalType) {
      this.speakNav('volver');
      this.router.navigate(['/professional-session', viewer.id]);
    } else {
      this.speakNav('volver');
      this.router.navigate(['/organization-dashboard']);
    }
  }

  goToObjectives() {
    this.speakNav('mis objetivos');
    this.router.navigate(['/objectives-list'], {
      queryParams: { role: 'user', userId: this.userId, returnTo: '/user-session/' + this.userId },
    });
  }

  goToPersonalData() {
    this.speakNav('datos personales');
    this.router.navigate(['/user-final-form', this.userId]);
  }

  goToStats() {
    this.speakNav('estadísticas');
    this.router.navigate(['/statistics-placeholder']);
  }

  /** Abre el board builder del usuario cuya sesión se está visualizando.
   *  creatorId = userId del perfil → el builder filtra por ese creador. */
  goToBoardBuilder() {
    this.speakNav('tablero builder');
    this.router.navigate(['/board-builder'], {
      queryParams: {
        returnTo:    '/user-session/' + this.userId,
        creatorId:   this.userId,
        creatorName: this.targetUser?.name || '',
      },
    });
  }

  /**
   * Abre un tablero asignado SIEMPRE en modo comunicador activo.
   * Tanto si quien lo abre es el propio usuario final, como si es
   * organización / profesional / familiar: los tableros asignados
   * se visualizan en el comunicador, no en el editor.
   * El Board Builder se accede únicamente desde el botón "Tablero Builder".
   */
  openBoard(board: Board): void {
    this.speakNav(board.name || 'tablero');
    // Usar el ID del usuario autenticado para el registro OBL:
    // si es el usuario final él mismo → mismo ID; si es org/profesional → su propio ID.
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: {
        userId:   logUserId,
        returnTo: '/user-session/' + this.userId,
      },
    });
  }

  /** Intercepta el cardClick de board-mini-card. Si viene de una pulsación
   *  larga ya gestionada, descarta el clic; si no, abre el tablero normal. */
  onBoardCardClick(board: Board): void {
    if (this._suppressNextCardClick) {
      this._suppressNextCardClick = false;
      return;
    }
    this.openBoard(board);
  }

  // ── Pulsación larga: detección y cancelación ─────────────────────────────────

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
        this.holdBoardId              = '';
        this.holdProgress             = 0;
        this._suppressNextCardClick   = true;
        void this._showBoardOptions(board);
      }
    }, TICK_MS);
  }

  onHoldPointerMove(event: PointerEvent): void {
    if (!this.holdBoardId) return;
    const dx = event.clientX - this._holdStartX;
    const dy = event.clientY - this._holdStartY;
    if (Math.sqrt(dx * dx + dy * dy) > 15) {
      this.cancelHold();
    }
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

  // ── Menú de opciones del tablero (descarga + modo oculto) ───────────────────

  private async _showBoardOptions(board: Board): Promise<void> {
    const sheet = await this.actionSheet.create({
      header:  board.name || 'Opciones del tablero',
      buttons: [
        {
          text:    'Entrar en modo oculto',
          icon:    'eye-off-outline',
          handler: () => { this.openBoardHidden(board); },
        },
        {
          text:    'Descargar OBZ',
          icon:    'archive-outline',
          handler: () => { void this._downloadOBZ(board); },
        },
        {
          text:    'Descargar PDF',
          icon:    'document-outline',
          handler: () => { void this._downloadPDF(board); },
        },
        {
          text: 'Cancelar',
          icon: 'close-outline',
          role: 'cancel',
        },
      ],
    });
    await sheet.present();
  }

  // ── Modo oculto ───────────────────────────────────────────────────────────────

  openBoardHidden(board: Board): void {
    this.speakNav(board.name || 'tablero');
    const logUserId = this.authService.getCurrentUser()?.id ?? this.userId;
    this.router.navigate(['/communicator', board._id], {
      queryParams: {
        userId:   logUserId,
        returnTo: '/user-session/' + this.userId,
      },
      state: { privateMode: true },
    });
  }

  // ── Descargas ─────────────────────────────────────────────────────────────────

  private async _downloadOBZ(board: Board): Promise<void> {
    this.isDownloading = true;
    try {
      const { boards, warnings } = await this.obfExport.collectLinkedBoards(board);
      if (warnings.length) console.warn('[OBZ export]', warnings);
      const { blob } = await this.obfExport.buildOBZPackage(board, boards);
      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'), { href: url, download: `${this._safeName(board.name)}.obz` });
      a.click();
      URL.revokeObjectURL(url);
      await this._showToast('Tablero descargado como OBZ ✓', 'success');
    } catch {
      await this._showToast('Error al generar el OBZ. Inténtalo de nuevo.', 'danger');
    } finally {
      this.isDownloading = false;
    }
  }

  private async _downloadPDF(board: Board): Promise<void> {
    this.isDownloading = true;
    try {
      await this.pdfExport.exportToPdf(board);
      await this._showToast('Tablero descargado como PDF ✓', 'success');
    } catch {
      await this._showToast('Error al generar el PDF. Inténtalo de nuevo.', 'danger');
    } finally {
      this.isDownloading = false;
    }
  }

  private async _showToast(message: string, color: 'success' | 'danger'): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2500, color, position: 'top' });
    await t.present();
  }

  private _safeName(name: string): string {
    return name.replace(/[^\w\-áéíóúÁÉÍÓÚñÑ ]/g, '').trim().replace(/\s+/g, '_') || 'tablero';
  }
}
