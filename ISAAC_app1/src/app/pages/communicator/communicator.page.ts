import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ModalController }   from '@ionic/angular';
import { CommonModule }  from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { AacRuntimeService, AacPhraseItem } from '../../services/aac-runtime.service';
import { BoardService, Board, CellPictogram } from '../../services/board.service';
import { UserService, FullBackendUser } from '../../services/user.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { BoardGridComponent } from '../../components/board-grid/board-grid.component';
import { BoardCircularComponent } from '../../components/board-circular/board-circular.component';
import { MultiboardCommunicatorComponent } from '../../components/multiboard-communicator/multiboard-communicator.component';
import { AacControlsBarComponent } from '../../components/aac-controls-bar/aac-controls-bar.component';
import { AacCircularTopBarComponent } from '../../components/aac-circular-top-bar/aac-circular-top-bar.component';
import { AacCircularRightBarComponent } from '../../components/aac-circular-right-bar/aac-circular-right-bar.component';
import { IaPredictorColumnComponent } from '../../components/ia-predictor-column/ia-predictor-column.component';
import { DEFAULT_CIRCULAR_CONTROLS_CONFIG } from '../../services/board.service';
import { AiPhraseResultModalComponent } from '../../components/ai-phrase-result-modal/ai-phrase-result-modal.component';
import { AiReformulationResponse } from '../../services/ai-assistant.service';
import { AacPredictionService, PredictedPictogram } from '../../services/aac-prediction.service';

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
    AacCircularTopBarComponent,
    AacCircularRightBarComponent,
    IaPredictorColumnComponent,
  ],
})
export class CommunicatorPage implements OnInit, OnDestroy {
  userId   = '';
  returnTo = '/';

  targetUser: FullBackendUser | null = null;

  board:     Board | null = null;
  isLoading = true;
  loadError = '';

  /** true cuando el tablero raíz tiene autoPersonalize=true.
   *  Controla si se pasa userId a todos los boards de la sesión. */
  rootAutoPersonalize = false;

  /** true cuando el usuario autenticado ES el usuario final asignado. */
  canLog = false;
  /** true cuando el usuario tiene la opción de voz de controles activada. */
  voiceEnabled = false;

  predictions: PredictedPictogram[] = [];

  private navSub?:     Subscription;
  private rootSub?:    Subscription;
  private aiSub?:      Subscription;
  private phraseSub?:  Subscription;
  /** Mapa boardId → pictograma que originó la navegación hacia ese tablero. */
  private boardSourcePicts = new Map<string, CellPictogram | null>();
  /** Pictograma que originó la navegación al tablero actualmente visible. */
  navSourcePict: CellPictogram | null | undefined;

  constructor(
    private route:          ActivatedRoute,
    private router:         Router,
    private aac:            AacRuntimeService,
    private boardSvc:       BoardService,
    private userSvc:        UserService,
    private boardLayoutSvc: BoardLayoutService,
    private modalCtrl:      ModalController,
    private predictionSvc:  AacPredictionService,
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
        // Aplicar configuración de voz del usuario al servicio AAC
        const vs = res.user.voiceSettings;
        if (vs) {
          this.aac.configureSoundSettings(
            vs.soundEnabled,
            vs.catalogVoice?.voiceURI,
            vs.catalogVoice?.speechRate,
            vs.catalogVoice?.speechPitch,
            vs.catalogVoice?.speechVolume,
            res.user.gender ?? '',
          );
        }
      } catch { /* silencioso */ }
    }

    // Guardar OBL siempre que haya un usuario final identificado.
    // El userId del log es el del usuario final (query param), no el del autenticado.
    // Permite que teacher/org supervise y los eventos se asocien al usuario final.
    this.canLog = !!this.userId;

    // Cargar raíz sin userId para leer el flag autoPersonalize del tablero.
    // Si está activo, recargar con userId para aplicar personalización en el raíz.
    // Esto evita personalizar tableros cuyo creador no activó la opción.
    this.rootAutoPersonalize = false;
    if (this.userId) {
      const rootMeta = await firstValueFrom(this.boardSvc.getBoardById(boardId));
      this.rootAutoPersonalize = !!rootMeta.board.autoPersonalize;
    }
    // controlsConfig se carga en loadBoard → está disponible después de este await
    await this.loadBoard(boardId);

    await this.aac.startSession(
      this.userId, boardId, 'communicator', this.canLog,
      this.board?.controlsConfig,
      !!this.board?.predictorEnabled,
      this.board?.iaRows ?? 5,
      this.board?.iaCols ?? 1,
      !!this.board?.aiRewriteEnabled,
    );

    // Suscripción a navegación de tableros (navigate actions, speakAndBack, etc.)
    this.navSub = this.aac.boardNavigated$.subscribe(({ boardId, sourcePict }) => {
      if (sourcePict !== undefined) {
        this.boardSourcePicts.set(boardId, sourcePict ?? null);
      }
      this.navSourcePict = this.boardSourcePicts.get(boardId);
      void this.loadBoard(boardId).then(() => this.loadPredictions());
    });

    // Suscripción al módulo IA: se activa cuando aiRewriteEnabled y el usuario pulsa HABLAR.
    // t1 (speakTimestamp) se pasa al modal para que el evento OBL de IA use el tiempo de HABLAR.
    this.aiSub = this.aac.phraseSpoken$.subscribe(({ phrase, timestamp }) => {
      void this.openAiModal(phrase, timestamp);
    });

    // "Borrar todo": recarga el tablero raíz sin pasar por el navSub.
    this.rootSub = this.aac.returnToRoot$.subscribe(rootBoardId => {
      this.navSourcePict = undefined;
      void this.loadBoard(rootBoardId).then(() => this.loadPredictions());
    });

    // Predictor IA: refrescar predicciones cada vez que cambia la frase.
    // BehaviorSubject emite inmediatamente al suscribirse → carga inicial incluida.
    this.phraseSub = this.aac.phraseChanged$.subscribe(() => {
      this.loadPredictions();
    });
  }

  async ionViewWillLeave() {
    await this.aac.endSession();
    this.navSub?.unsubscribe();
    this.rootSub?.unsubscribe();
    this.aiSub?.unsubscribe();
    this.phraseSub?.unsubscribe();
    this.boardSourcePicts.clear();
    this.navSourcePict = undefined;
    this.predictions = [];
  }

  // ── Predictor IA ──────────────────────────────────────────────────────────

  /** Solicita predicciones al backend. No lanza error si falla (el predictor no bloquea). */
  loadPredictions(): void {
    if (!this.showPredictor || !this.userId || !this.board) return;
    const limit = this.aac.iaRows * this.aac.iaCols;
    this.predictionSvc.getSuggestions({
      userId:            this.userId,
      boardId:           this.board._id,
      limit,
      currentPhrase:     this.aac.phrase.map(p => ({ label: p.label, wordType: p.wordType })),
      currentBoardRole:  this.board.boardRole  ?? 'main',
      currentBoardShape: this.board.shape ?? 'grid',
    }).subscribe({
      next:  res  => { this.predictions = res.predictions; },
      error: ()   => { /* silencioso: el predictor no bloquea el comunicador */ },
    });
  }

  /** Pulsar un pictograma del predictor: actúa como acción de voz y registra OBL. */
  onPredictorCellPress(pict: PredictedPictogram): void {
    this.aac.handlePictogramPress(
      {
        pictogram: {
          id:                pict.label,
          label:             pict.label,
          imageUrl:          pict.imageUrl,
          sound:             pict.label,
          color:             pict.color,   // color resuelto desde la celda real del tablero
          wordType:          pict.wordType,
          fitzgeraldEnabled: false,
        },
        // Usar la acción original del tablero: navigate, setSlot, voice+navigate…
        // Si el backend no devolvió acción (picto antiguo en OBL), se asume 'voice'.
        action: pict.action ?? { type: 'voice' },
      },
      this.board!._id,
    );
  }

  // ── Módulo IA ─────────────────────────────────────────────────────────────

  private async openAiModal(phrase: AacPhraseItem[], speakTimestamp: string): Promise<void> {
    const modal = await this.modalCtrl.create({
      component:      AiPhraseResultModalComponent,
      componentProps: { originalPhrase: phrase, speakTimestamp },
      cssClass:       'ai-result-modal',
      breakpoints:    [0, 0.85, 1],
      initialBreakpoint: 0.85,
    });
    await modal.present();
    const { data } = await modal.onWillDismiss<{
      clear:           boolean;
      result?:         AiReformulationResponse | null;
      speakTimestamp?: string;
    }>();
    if (data?.clear) {
      // Registrar evento OBL de IA solo al aceptar (nunca al pulsar ESCUCHAR).
      // Usa speakTimestamp (t1) para que el tiempo del evento sea el de HABLAR, no el de OK.
      if (data.result) {
        const originalText = phrase.map(p => p.label).join(' ');
        this.aac.logAiReformulationEvent(
          originalText,
          data.result.reformulatedText,
          data.speakTimestamp ?? speakTimestamp,
          data.result.tokens ?? [],
        );
      }
      // clearPhraseSilent: la frase ya fue cerrada por :speak en t1.
      // No registrar :clear para no desplazar phraseStart al momento de OK.
      this.aac.clearPhraseSilent();
    }
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
      // Pasar userId solo cuando el tablero raíz tiene autoPersonalize activo.
      const uid = (this.rootAutoPersonalize && this.userId) ? this.userId : undefined;
      const res = await firstValueFrom(this.boardSvc.getBoardById(boardId, uid));
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
    this.boardSourcePicts.clear();
    this.navSourcePict = undefined;
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

  get isCircularBoard(): boolean {
    return this.board?.shape === 'circular';
  }

  get isSecondaryCircular(): boolean {
    return this.board?.shape === 'circular' && this.board?.boardRole === 'secondary';
  }

  get effectiveCircularConfig() {
    return this.board?.circularControlsConfig ?? DEFAULT_CIRCULAR_CONTROLS_CONFIG;
  }

  get canGoBack(): boolean {
    return this.aac.boardStack.length > 0;
  }

  get gender(): string | undefined {
    return this.targetUser?.gender ?? undefined;
  }

  // ── Predictor IA (heredado del tablero raíz) ──────────────────────────────

  get showPredictor(): boolean {
    return this.aac.predictorEnabled && !this.isMultiBoard;
  }

  get predictorIaRows(): number { return this.aac.iaRows; }
  get predictorIaCols(): number { return this.aac.iaCols; }
}
