import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule }   from '@ionic/angular';
import { CommonModule }  from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { AacRuntimeService } from '../../services/aac-runtime.service';
import { BoardService, Board } from '../../services/board.service';
import { UserService, FullBackendUser } from '../../services/user.service';
import { AuthService } from '../../services/auth.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { BoardGridComponent } from '../../components/board-grid/board-grid.component';
import { BoardCircularComponent } from '../../components/board-circular/board-circular.component';
import { MultiboardCommunicatorComponent } from '../../components/multiboard-communicator/multiboard-communicator.component';
import { AacControlsBarComponent } from '../../components/aac-controls-bar/aac-controls-bar.component';

@Component({
  selector: 'app-communicator',
  templateUrl: './communicator.page.html',
  styleUrls:  ['./communicator.page.scss'],
  standalone: true,
  imports: [
    IonicModule,
    CommonModule,
    BoardGridComponent,
    BoardCircularComponent,
    MultiboardCommunicatorComponent,
    AacControlsBarComponent,
  ],
})
export class CommunicatorPage implements OnInit, OnDestroy {
  userId   = '';
  returnTo = '/';

  targetUser: FullBackendUser | null = null;

  board:     Board | null = null;
  isLoading = true;
  loadError = '';

  /** true cuando el usuario autenticado ES el usuario final asignado. */
  canLog = false;
  /** true cuando el usuario tiene la opción de voz de controles activada. */
  voiceEnabled = false;

  private navSub?: Subscription;

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private aac:            AacRuntimeService,
    private boardSvc:       BoardService,
    private userSvc:        UserService,
    private authSvc:        AuthService,
    private boardLayoutSvc: BoardLayoutService,
  ) {}

  ngOnInit() {
    this.userId   = this.route.snapshot.queryParamMap.get('userId') ?? '';
    this.returnTo = this.route.snapshot.queryParamMap.get('returnTo')
      ?? (this.userId ? '/user-session/' + this.userId : '/');
  }

  async ionViewWillEnter() {
    const boardId = this.route.snapshot.paramMap.get('boardId') ?? '';

    // Cargar perfil del usuario final (para voz y configuración)
    if (this.userId) {
      try {
        const res = await firstValueFrom(this.userSvc.getUserById(this.userId));
        this.targetUser = res.user;
        // Comprobar si el usuario tiene TTS de controles activado
        this.voiceEnabled = !!(res.user as any)?.voiceControlsEnabled;
      } catch { /* silencioso */ }
    }

    // Determinar si debemos guardar OBL:
    // solo cuando el autenticado ES el usuario final (no teacher/parent/professional)
    const authUser = this.authSvc.getCurrentUser();
    this.canLog = authUser?.type === 'user' && authUser?.id === this.userId;

    // controlsConfig se carga en loadBoard → está disponible después de este await
    await this.loadBoard(boardId);

    await this.aac.startSession(
      this.userId, boardId, 'communicator', this.canLog,
      this.board?.controlsConfig,
    );

    // Suscripción a navegación de tableros (navigate actions, speakAndBack, etc.)
    this.navSub = this.aac.boardNavigated$.subscribe((newBoardId) => {
      void this.loadBoard(newBoardId);
    });
  }

  async ionViewWillLeave() {
    await this.aac.endSession();
    this.navSub?.unsubscribe();
  }

  ngOnDestroy() {
    this.navSub?.unsubscribe();
  }

  // ── Board loading ─────────────────────────────────────────────────────────

  async loadBoard(boardId: string): Promise<void> {
    if (!boardId) return;
    this.isLoading = true;
    this.loadError = '';
    try {
      const res = await firstValueFrom(this.boardSvc.getBoardById(boardId));
      this.board = res.board;
    } catch {
      this.loadError = 'No se pudo cargar el tablero.';
    } finally {
      this.isLoading = false;
    }
  }

  // ── Cell press ────────────────────────────────────────────────────────────

  onCellPress(row: number, col: number): void {
    const cell = this.boardLayoutSvc.getCellData(this.board, row, col);
    if (!cell?.pictogram) return;
    this.aac.handlePictogramPress(cell, this.board!._id);
  }

  // ── Navegación AAC ────────────────────────────────────────────────────────

  /** Home: salir del comunicador y volver a la pantalla principal del usuario. */
  onHome(): void {
    this.router.navigateByUrl(this.returnTo);
  }

  /** Back: volver al tablero anterior en el historial de navegación. */
  onBack(): void {
    if (this.aac.boardStack.length > 0) {
      this.aac.goBack();
    } else {
      this.router.navigateByUrl(this.returnTo);
    }
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get isMultiBoard(): boolean {
    return this.board?.shape === 'multi' || this.board?.boardRole === 'multi';
  }

  get canGoBack(): boolean {
    return this.aac.boardStack.length > 0;
  }

  get gender(): string | undefined {
    return this.targetUser?.gender ?? undefined;
  }
}
