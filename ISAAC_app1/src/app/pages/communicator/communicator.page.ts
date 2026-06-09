import { Component, OnInit, OnDestroy } from '@angular/core';
import { IonicModule, ModalController }   from '@ionic/angular';
import { CommonModule }  from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { AacRuntimeService, AacPhraseItem } from '../../services/aac-runtime.service';
import {
  BoardService, Board, BoardCell, CellPictogram, PredictivePictogram,
} from '../../services/board.service';
import { UserService, FullBackendUser } from '../../services/user.service';
import { BoardLayoutService } from '../../services/board-layout.service';
import { BoardGridComponent } from '../../components/board-grid/board-grid.component';
import { BoardCircularComponent } from '../../components/board-circular/board-circular.component';
import { MultiboardCommunicatorComponent } from '../../components/multiboard-communicator/multiboard-communicator.component';
import { AacControlsBarComponent } from '../../components/aac-controls-bar/aac-controls-bar.component';
import { AacCircularTopBarComponent } from '../../components/aac-circular-top-bar/aac-circular-top-bar.component';
import { AacCircularRightBarComponent } from '../../components/aac-circular-right-bar/aac-circular-right-bar.component';
import { IaPredictorColumnComponent } from '../../components/ia-predictor-column/ia-predictor-column.component';
import { DEFAULT_CIRCULAR_CONTROLS_CONFIG, ControlButtonId } from '../../services/board.service';
import { AiPhraseResultModalComponent } from '../../components/ai-phrase-result-modal/ai-phrase-result-modal.component';
import { AiReformulationResponse } from '../../services/ai-assistant.service';
import {
  AacPredictionService,
  CircularSuggestion,
  PredictedPictogram,
} from '../../services/aac-prediction.service';

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
  /** true cuando la sesión se inició en modo oculto (sin registro OBL). */
  privateMode = false;

  predictions: PredictedPictogram[] = [];

  private navSub?:     Subscription;
  private rootSub?:    Subscription;
  private aiSub?:      Subscription;
  private phraseSub?:  Subscription;
  /** Evita abrir un segundo modal IA si el usuario pulsa HABLAR mientras uno ya está abierto. */
  private aiModalActive = false;
  /** Mapa boardId → pictograma que originó la navegación hacia ese tablero. */
  private boardSourcePicts = new Map<string, CellPictogram | null>();
  /** Pictograma que originó la navegación al tablero actualmente visible. */
  navSourcePict: CellPictogram | null | undefined;

  // ── Circular predictivo inteligente ────────────────────────────────────────
  /** Índice de la categoría seleccionada (-1 = vista de categorías). */
  predActiveCatIdx: number = -1;
  /** Pictograma que aparece en el centro durante la vista de candidatos. */
  predCenterPict: CellPictogram | null = null;
  /** Lista completa de sugerencias devueltas por el predictor (hasta circularSuggestionsLimit). */
  allCircularSuggestions:    CircularSuggestion[] = [];
  /** Slice visible en la página actual (suggestionsPerPage elementos). */
  visibleCircularSuggestions: CircularSuggestion[] = [];
  /** Página activa de sugerencias (0-indexed). */
  predictionPage = 0;
  readonly suggestionsPerPage       = 8;
  readonly circularSuggestionsLimit = 24;
  /** true mientras se espera respuesta del predictor circular. */
  circularSuggestionsLoading = false;

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

    // Modo oculto: se pasa como navigation state (no se persiste, se limpia al salir).
    this.privateMode = !!(history.state as Record<string, unknown>)?.['privateMode'];

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
            vs.voiceMode,
            vs.customVoice?.status === 'ready',
            res.user._id,
            vs.catalogVoice?.voiceURI,
            vs.catalogVoice?.speechRate,
            vs.catalogVoice?.speechPitch,
            vs.catalogVoice?.speechVolume,
            res.user.gender ?? '',
          );
        }
      } catch { /* silencioso */ }
    }

    // Guardar OBL siempre que haya usuario final identificado, salvo modo oculto.
    this.canLog = !!this.userId && !this.privateMode;

    // Cargar raíz sin userId para leer el flag autoPersonalize del tablero.
    // Si está activo, recargar con userId para aplicar personalización en el raíz.
    // Esto evita personalizar tableros cuyo creador no activó la opción.
    this.rootAutoPersonalize = false;
    if (this.userId) {
      try {
        const rootMeta = await firstValueFrom(this.boardSvc.getBoardById(boardId));
        this.rootAutoPersonalize = !!rootMeta.board.autoPersonalize;
      } catch { /* si falla, se carga sin personalización */ }
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
      if (this.aiModalActive) {
        console.log('[AI] modal ya activo, ignorando phraseSpoken$');
        return;
      }
      void this.openAiModal(phrase, timestamp);
    });

    // "Borrar todo": recarga el tablero raíz sin pasar por el navSub.
    this.rootSub = this.aac.returnToRoot$.subscribe(rootBoardId => {
      this.navSourcePict = undefined;
      void this.loadBoard(rootBoardId).then(() => this.loadPredictions());
    });

    // Resolver contexto de ubicación (no bloquea el inicio de sesión)
    if (this.userId) {
      void this.resolveCurrentLocation();
    }

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
    this.predictions               = [];
    this.allCircularSuggestions    = [];
    this.visibleCircularSuggestions = [];
    this.predictionPage            = 0;
    this.circularSuggestionsLoading = false;
    this.privateMode = false;   // limpia el modo oculto al salir
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
      locationContext:   this.aac.locationContext,
    }).subscribe({
      next:  res  => { this.predictions = res.predictions; },
      error: ()   => { /* silencioso: el predictor no bloquea el comunicador */ },
    });
  }

  /**
   * Obtiene la posición actual del dispositivo y la resuelve contra los lugares
   * frecuentes del usuario. Actualiza el estado en AacRuntimeService.
   * Completamente silencioso si falla o si el usuario rechaza los permisos.
   */
  private async resolveCurrentLocation(): Promise<void> {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const ctx = await firstValueFrom(
            this.userSvc.resolveLocation(this.userId, pos.coords.latitude, pos.coords.longitude),
          );
          this.aac.locationContext = ctx.locationContext ?? 'general';
          this.aac.locationId      = ctx.locationId      ?? null;
          this.aac.locationName    = ctx.locationName    ?? null;
          // Relanzar predicciones con el nuevo contexto si el predictor está activo
          if (ctx.locationContext && ctx.locationContext !== 'general') {
            this.loadPredictions();
          }
        } catch { /* silencioso */ }
      },
      () => { /* permiso denegado o error de GPS: locationContext permanece 'general' */ },
      { timeout: 8000, maximumAge: 60000 },
    );
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
    this.aiModalActive = true;
    const genderMap: Record<string, 'male' | 'female' | 'neutral' | 'unknown'> = {
      male: 'male', female: 'female', other: 'neutral', prefer_not_to_say: 'unknown',
    };
    const userGender = genderMap[this.targetUser?.gender ?? ''] ?? 'unknown';

    const modal = await this.modalCtrl.create({
      component:      AiPhraseResultModalComponent,
      componentProps: { originalPhrase: phrase, speakTimestamp, userGender },
      cssClass:       'ai-result-modal',
      breakpoints:    [0, 0.85, 1],
      initialBreakpoint: 0.85,
    });
    await modal.present();

    try {
      // onDidDismiss: espera a que la animación de cierre termine antes de limpiar.
      // Cubre todos los cierres: aceptar, X, error-cerrar, swipe, token-navegar.
      const { data } = await modal.onDidDismiss<{
        clear:           boolean;
        result?:         AiReformulationResponse | null;
        speakTimestamp?: string;
      }>();

      console.log('[AI] modal cerrado —',
        'clear=' + !!(data?.clear),
        'phrase.length=' + phrase.length,
        'aac.phrase.length=' + this.aac.phrase.length);

      // Solo al aceptar: registrar evento OBL de reformulación IA.
      // La frase ya fue cerrada por :speak (t1); no se emite :clear.
      if (data?.clear && data.result) {
        const originalText = phrase.map(p => p.label).join(' ');
        const tokensForLog = (data.result.tokens ?? []).map(t => ({
          ...t,
          imageUrl: t.imageUrl?.startsWith('data:') ? '' : t.imageUrl,
        }));
        this.aac.logAiReformulationEvent(
          originalText,
          data.result.reformulatedText,
          data.speakTimestamp ?? speakTimestamp,
          tokensForLog,
        );
      }

      // Cierre definitivo de frase: limpia toda la frase, resetea navegación
      // y vuelve al tablero raíz (siempre, aunque ya estuviésemos en él).
      // La sesión OBL continúa; la siguiente frase se registra en la misma sesión.
      this.aac.finalizePhraseAfterAiPopup();
      this.boardSourcePicts.clear();
      this.navSourcePict = undefined;

      console.log('[AI] finalizePhraseAfterAiPopup completado —',
        'aac.phrase.length=' + this.aac.phrase.length);
    } finally {
      this.aiModalActive = false;
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
      this.board                      = res.board;

      // Migración en memoria: tableros circulares antiguos pueden no tener
      // botones añadidos al DEFAULT después de su creación (p.ej. reloadBoard).
      if (this.board.circularControlsConfig) {
        const cfg = this.board.circularControlsConfig;
        const defaultBtns: ControlButtonId[] = [
          ...(DEFAULT_CIRCULAR_CONTROLS_CONFIG.rightBar as ControlButtonId[]),
          ...(DEFAULT_CIRCULAR_CONTROLS_CONFIG.topBar.filter(i => i !== 'phraseBar') as ControlButtonId[]),
        ];
        const newRightBar      = [...cfg.rightBar];
        const newVisibleButtons = [...cfg.visibleButtons];
        let changed = false;
        for (const btn of defaultBtns) {
          if (!cfg.topBar.includes(btn) && !newRightBar.includes(btn)) {
            newRightBar.push(btn);
            if (DEFAULT_CIRCULAR_CONTROLS_CONFIG.visibleButtons.includes(btn)) {
              newVisibleButtons.push(btn);
            }
            changed = true;
          }
        }
        if (changed) {
          this.board = {
            ...this.board,
            circularControlsConfig: { ...cfg, rightBar: newRightBar, visibleButtons: newVisibleButtons },
          };
        }
      }

      this.predActiveCatIdx           = -1;
      this.predCenterPict             = null;
      this.allCircularSuggestions     = [];
      this.visibleCircularSuggestions = [];
      this.predictionPage             = 0;
      this.circularSuggestionsLoading = false;
      // Pre-calentar caché TTS personalizada con todas las etiquetas del tablero
      const labels = (res.board.cells ?? [])
        .map((c: any) => c.pictogram?.sound || c.pictogram?.label)
        .filter(Boolean);
      this.aac.prewarmCache(labels);
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
    // En modo predictivo con candidatos visibles: retroceder a vista de categorías
    if (this.isPredictiveCircular && this.predActiveCatIdx !== -1) {
      this.backToCircularCategories();
      return;
    }
    if (this.aac.boardStack.length > 0) {
      this.aac.goBack();
    } else {
      this.router.navigateByUrl(this.returnTo);
    }
  }

  // ── Circular predictivo: lógica de interacción ───────────────────────────

  /**
   * Gestiona el press en un slot del circular predictivo.
   * Vista de categorías: seleccionar categoría → llama al predictor y muestra candidatos.
   * Vista de candidatos: hablar/añadir el pictograma pulsado y registrar OBL con categoría.
   * Centro o location column: volver a vista de categorías.
   */
  onPredCellPress(row: number, col: number): void {
    if (!this.board?.predictiveCircularConfig) return;

    // Centro o columna de ubicación → volver a vista de categorías
    if (col !== 0) {
      this.backToCircularCategories();
      return;
    }

    const config = this.board.predictiveCircularConfig;
    const cats   = config.categories ?? [];

    if (this.predActiveCatIdx === -1) {
      // ── Vista de categorías: seleccionar la categoría del slot pulsado
      const cat = cats[row];
      if (!cat) return;
      this.predActiveCatIdx           = row;
      this.allCircularSuggestions     = [];
      this.visibleCircularSuggestions = [];
      this.predictionPage             = 0;
      this.predCenterPict             = {
        source:            cat.icon?.imageUrl ? 'arasaac' : 'new',
        id:                cat.icon?.arasaacId || cat.id,
        label:             cat.label || 'Categoría',
        sound:             cat.label || '',
        imageUrl:          cat.icon?.imageUrl || '',
        tags:              [],
        description:       '',
        wordType:          'misc',
        fitzgeraldEnabled: false,
        color:             cat.color || '#9c27b0',
      } as CellPictogram;

      // Solicitar sugerencias al predictor (no bloquea la UI, candidatos del logopeda como fallback)
      this.loadCircularSuggestions(cat.id);
    } else {
      // ── Vista de candidatos: hablar el candidato pulsado
      const cat = cats[this.predActiveCatIdx];
      const n   = Math.min(config.suggestionsPerCategory ?? 8, this.board.circleSlots ?? 8);

      // Usar sugerencias del predictor si están disponibles; si no, fallback a manualPictograms
      let pict: CircularSuggestion | null = null;
      if (this.allCircularSuggestions.length > 0) {
        pict = this.visibleCircularSuggestions[row] ?? null;
      } else {
        const mp = (cat.manualPictograms ?? []).slice(0, n)[row];
        if (mp) {
          pict = {
            label:         mp.label,
            imageUrl:      mp.imageUrl || '',
            color:         mp.color || '#f5f5f5',
            wordType:      mp.wordType || 'misc',
            action:        mp.action || { type: 'voice' },
            score:         0.5,
            source:        'manual',
            categoryId:    cat.id,
            categoryLabel: cat.label || '',
          };
        }
      }
      if (!pict) return;

      // Registrar OBL con category_id y category_label para que el predictor aprenda
      this.aac.logButtonEvent({
        label:          pict.label,
        vocalization:   pict.label,
        spoken:         true,
        button_id:      pict.label,
        board_id:       this.board!._id,
        image_url:      pict.imageUrl ?? '',
        actions:        [],
        color:          pict.color   ?? undefined,
        wordType:       pict.wordType ?? undefined,
        category_id:    pict.categoryId,
        category_label: pict.categoryLabel,
      });

      // Añadir a la frase y hablar
      this.aac.addToPhrase({
        id:                pict.label,
        label:             pict.label,
        imageUrl:          pict.imageUrl,
        sound:             pict.label,
        boardId:           this.board!._id,
        color:             pict.color,
        wordType:          pict.wordType,
        fitzgeraldEnabled: false,
      }, { type: 'none' });
      this.aac.speakText(pict.label, this.gender);

      // Recargar predictor con la nueva frase, manteniendo categoría activa
      this.predictionPage = 0;
      this.loadCircularSuggestions(cat.id);
    }
  }

  /** Llama al backend para obtener sugerencias predichas para la categoría dada. */
  private loadCircularSuggestions(categoryId: string): void {
    if (!this.userId || !this.board) return;
    this.circularSuggestionsLoading = true;
    this.predictionSvc.getCircularSuggestions({
      userId:          this.userId,
      boardId:         this.board._id,
      categoryId,
      limit:           this.circularSuggestionsLimit,
      currentPhrase:   this.aac.phrase.map(p => ({ label: p.label, wordType: p.wordType })),
      locationContext: this.aac.locationContext,
    }).subscribe({
      next: res => {
        this.allCircularSuggestions    = res.suggestions ?? [];
        this.predictionPage            = 0;
        this.updateVisibleCircularSuggestions();
        this.circularSuggestionsLoading = false;
      },
      error: () => {
        // Silencioso: si falla el predictor se muestran los candidatos del logopeda
        this.allCircularSuggestions    = [];
        this.visibleCircularSuggestions = [];
        this.circularSuggestionsLoading = false;
      },
    });
  }

  private updateVisibleCircularSuggestions(): void {
    const start = this.predictionPage * this.suggestionsPerPage;
    this.visibleCircularSuggestions = this.allCircularSuggestions.slice(start, start + this.suggestionsPerPage);
  }

  /** Avanza a la siguiente página de sugerencias (o vuelve a la primera si ya es la última). */
  showMoreCircularSuggestions(): void {
    if (this.predActiveCatIdx === -1 || this.allCircularSuggestions.length <= this.suggestionsPerPage) return;
    const maxPage = Math.ceil(this.allCircularSuggestions.length / this.suggestionsPerPage) - 1;
    this.predictionPage = this.predictionPage < maxPage ? this.predictionPage + 1 : 0;
    this.updateVisibleCircularSuggestions();
    // TODO: registrar evento OBL tipo 'action' (more_suggestions) cuando el servicio lo soporte
  }

  /** Recarga el tablero actual desde el backend (resetea navegación circular si procede). */
  onReloadBoard(): void {
    if (!this.board) return;
    this.backToCircularCategories();
    void this.loadBoard(this.board._id).then(() => this.loadPredictions());
  }

  /** Vuelve a la vista de categorías en el tablero circular predictivo. */
  backToCircularCategories(): void {
    this.predActiveCatIdx           = -1;
    this.predCenterPict             = null;
    this.allCircularSuggestions     = [];
    this.visibleCircularSuggestions = [];
    this.predictionPage             = 0;
    this.circularSuggestionsLoading = false;
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

  get isPredictiveCircular(): boolean {
    return !!(
      this.board?.shape === 'circular' &&
      this.board.isPredictiveCircular &&
      this.board.predictiveCircularConfig?.categories?.length
    );
  }

  /**
   * Board sintético para el tablero circular predictivo.
   * Vista categorías (predActiveCatIdx === -1): outer slots = iconos de categoría.
   * Vista candidatos (predActiveCatIdx >= 0): outer slots = candidatos de esa categoría.
   */
  get predDisplayBoard(): Board | null {
    if (!this.board || !this.isPredictiveCircular) return this.board;
    const config     = this.board.predictiveCircularConfig!;
    const cats       = config.categories;
    const nSlots     = this.board.circleSlots ?? 8;

    let syntheticCells: BoardCell[];

    if (this.predActiveCatIdx === -1) {
      // ── Vista de categorías
      syntheticCells = cats.slice(0, nSlots).map((cat, i) => ({
        row: i, col: 0,
        pictogram: {
          source:            (cat.icon?.imageUrl ? 'arasaac' : 'new') as 'arasaac' | 'new',
          id:                cat.icon?.arasaacId || cat.id,
          label:             cat.label || 'Categoría',
          sound:             cat.label || '',
          imageUrl:          cat.icon?.imageUrl || '',
          tags:              [],
          description:       '',
          wordType:          'misc' as const,
          fitzgeraldEnabled: false,
          color:             cat.color || '#9c27b0',
        },
        action: { type: 'voice' as const, targetBoardId: null },
      }));
    } else {
      // ── Vista de candidatos
      const cat         = cats[this.predActiveCatIdx];
      const nCandidates = Math.min(config.suggestionsPerCategory ?? 8, nSlots);

      // Usar sugerencias del predictor si ya llegaron; si no, mostrar manualPictograms como fallback
      if (this.visibleCircularSuggestions.length > 0) {
        syntheticCells = this.visibleCircularSuggestions.slice(0, nCandidates).map((s, i) => ({
          row: i, col: 0,
          pictogram: {
            source:            'arasaac' as const,
            id:                s.label,
            label:             s.label,
            sound:             s.label,
            imageUrl:          s.imageUrl,
            tags:              [],
            description:       '',
            wordType:          (s.wordType || 'misc') as CellPictogram['wordType'],
            fitzgeraldEnabled: false,
            color:             s.color || '#f5f5f5',
          },
          action: { type: 'voice' as const, targetBoardId: null },
        }));
      } else {
        const candidates = (cat.manualPictograms ?? []).slice(0, nCandidates);
        syntheticCells   = candidates.map((pict, i) => ({
          row: i, col: 0,
          pictogram: {
            source:            'arasaac' as const,
            id:                pict.arasaacId || '',
            label:             pict.label,
            sound:             pict.sound || pict.label,
            imageUrl:          pict.imageUrl,
            tags:              [],
            description:       '',
            wordType:          (pict.wordType || 'misc') as CellPictogram['wordType'],
            fitzgeraldEnabled: pict.fitzgeraldEnabled ?? true,
            color:             pict.color || '#f5f5f5',
          },
          action: { type: 'voice' as const, targetBoardId: null },
        }));
      }
    }

    // Conservar celdas no-slot (centro, columna ubicación)
    const takenRows = new Set(syntheticCells.map(c => c.row));
    const other     = (this.board.cells ?? []).filter(c => c.col !== 0 || !takenRows.has(c.row));
    return { ...this.board, cells: [...syntheticCells, ...other] };
  }

  get effectiveCircularConfig() {
    return this.board?.circularControlsConfig ?? DEFAULT_CIRCULAR_CONTROLS_CONFIG;
  }

  /** Muestra el botón "Más opciones" solo en tableros circulares predictivos con varias páginas. */
  get canShowMoreOptions(): boolean {
    return this.isPredictiveCircular &&
           this.predActiveCatIdx !== -1 &&
           this.allCircularSuggestions.length > this.suggestionsPerPage;
  }

  /** Muestra el botón "Categorías" cuando hay una categoría activa en el circular predictivo. */
  get canShowBackToCategories(): boolean {
    return this.isPredictiveCircular && this.predActiveCatIdx !== -1;
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
