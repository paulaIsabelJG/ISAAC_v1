import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { CellPictogram, ControlsConfig, DEFAULT_CONTROLS_CONFIG } from './board.service';
import { getCellBaseColor } from '../shared/utils/board-color.utils';

/** Evento emitido al navegar entre tableros. Incluye el pictograma que originó la navegación. */
export interface BoardNavEvent {
  boardId:    string;
  /** Pictograma que activó la navegación (undefined = sin contexto, null = explícitamente vacío). */
  sourcePict?: CellPictogram | null;
}

export type AacMode = 'edit' | 'preview' | 'communicator';

export interface AacPhraseItem {
  id:       string;
  label:    string;
  imageUrl: string;
  sound:    string;
  /** ID del tablero desde el que se pulsó el pictograma. Necesario para utterance buttons. */
  boardId?: string;
  /** Color efectivo del pictograma (Fitzgerald o manual, hex). Mostrado en la phrase-band y en OBL. */
  color?:   string;
  /** Categoría gramatical Fitzgerald. */
  wordType?: string;
  /** true si el pictograma usa la paleta Fitzgerald (el color se deriva de wordType). */
  fitzgeraldEnabled?: boolean;
  /** Acción original del pictograma en el tablero. Preservada para el pipeline IA. */
  action?: { type: string; targetBoardId?: string; targetSlotId?: number } | null;
}

/** Acción OBL estructurada (spec open-board-log-0.1). */
export interface OblAction {
  action:                string;          // ':open_board' | 'ext_isaac_set_slot' | ':back'
  destination_board_id?: string;
  ext_isaac_slot_id?:    number;
  ext_isaac_multi_board_id?: string;
}

export interface OblEvent {
  id:                   string;
  type:                 'button' | 'action' | 'utterance';
  timestamp:            string;
  label?:               string;
  vocalization?:        string;
  spoken?:              boolean;
  button_id?:           string;
  board_id?:            string;
  image_url?:           string;
  actions?:             OblAction[];
  color?:               string;
  wordType?:            string;
  action?:              string;
  destination_board_id?: string;
  text?:                string;
  buttons?:             Array<{ id: string; label: string; board_id: string }>;
  // extensión ISAAC: reformulación IA (solo en action 'ext_isaac_ai_reformulation')
  ext_isaac_original_text?:     string;
  ext_isaac_reformulated_text?: string;
  ext_isaac_ai_tokens?:         any[];
  /** Identificador estable de la frase en curso. Compartido por button, :speak, utterance y ext_isaac_ai_reformulation. */
  ext_isaac_phrase_id?:         string;
}

/**
 * Estado mínimo para deshacer la transición causada por un ítem de la frase
 * cuando el usuario pulsa "Borrar último".
 */
export interface UndoEntry {
  /** 'none' = sin transición; 'navigate' = navegación global de tablero;
   *  'slotNavigate' = navegación intra-slot en multitablero;
   *  'setSlot' = cambio de tablero asignado a un hueco. */
  type: 'none' | 'navigate' | 'slotNavigate' | 'setSlot';
  /** Para 'navigate': board desde el que se navegó (se restaura al hacer undo). */
  prevBoardId?: string;
  /** Para 'slotNavigate' y 'setSlot': slotId del hueco afectado. */
  slotId?: number;
  /** Para 'setSlot': board que tenía ese slot antes del cambio. */
  prevSlotBoardId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AacRuntimeService {
  private readonly apiUrl = environment.apiUrl;

  // ── State ─────────────────────────────────────────────────────────────────
  mode:       AacMode = 'edit';
  userId      = '';
  sessionId   = '';
  rootBoardId = '';

  phrase:      AacPhraseItem[] = [];
  boardStack:  string[]        = [];

  /** true cuando debemos persistir eventos OBL (communicator + usuario final real). */
  canLog = false;

  /** Configuración de la barra AAC cargada del tablero raíz. */
  controlsConfig: ControlsConfig = { ...DEFAULT_CONTROLS_CONFIG };

  /** Configuración del Predictor IA y Corrector IA cargados del tablero raíz. */
  predictorEnabled  = false;

  // ── Configuración de voz del usuario final ────────────────────────────────
  /** true → cualquier pictograma (con cualquier acción) emite audio al pulsarse. */
  soundEnabled        = false;
  /** voiceURI de la voz elegida por el usuario. Vacío = selección automática por género. */
  configuredVoiceURI  = '';
  configuredRate      = 0.9;
  configuredPitch     = 1.0;
  configuredVolume    = 1.0;
  /** Género del usuario — usado como fallback cuando no hay voiceURI configurada. */
  configuredGender    = '';
  /** true cuando el usuario tiene voz personalizada lista y debe usarse en la sesión. */
  customVoiceReady   = false;
  /** userId necesario para llamar a /api/voice/tts/speak. */
  customVoiceUserId  = '';
  private customAudio: HTMLAudioElement | null = null;
  iaRows            = 5;
  iaCols            = 1;
  aiRewriteEnabled  = false;

  private _currentBoardId = '';
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  readonly boardNavigated$    = new Subject<BoardNavEvent>();
  readonly phraseChanged$     = new BehaviorSubject<AacPhraseItem[]>([]);
  readonly slotChanged$       = new Subject<{ slotId: number; boardId: string }>();
  /** Emite cuando borrar-último necesita restaurar un slot a su board anterior. */
  readonly restoreSlot$       = new Subject<{ slotId: number; boardId: string | null }>();
  /** Emite cuando borrar-último necesita deshacer la navegación intra-slot. */
  readonly undoSlotNavigate$  = new Subject<{ slotId: number }>();

  /** Pila de deshacer paralela a `phrase`: cada entrada describe qué restaurar
   *  si el usuario elimina el ítem correspondiente con "Borrar último". */
  private undoStack: UndoEntry[] = [];

  get currentBoardId(): string { return this._currentBoardId; }

  /** Emite la frase y el timestamp t1 de HABLAR cuando el usuario pulsa HABLAR en modo
   *  comunicador con aiRewriteEnabled activo. El timestamp t1 se usa para el evento OBL
   *  de reformulación IA (el tiempo debe ser el de HABLAR, no el de aceptar el modal). */
  readonly phraseSpoken$ = new Subject<{ phrase: AacPhraseItem[]; timestamp: string }>();

  /**
   * Emite el rootBoardId cuando el usuario pulsa "Borrar todo" y hay que volver
   * al tablero raíz. Usa un Subject dedicado en lugar de boardNavigated$ para
   * evitar efectos secundarios sobre navSourcePict / boardSourcePicts.
   * El comunicador y el editor en preview escuchan este Subject por separado.
   */
  readonly returnToRoot$ = new Subject<string>();

  private pendingEvents: OblEvent[] = [];
  private sessionStarted = '';
  /** UUID estable que identifica la frase en curso. Se genera al añadir el primer pictograma
   *  de cada frase y se comparte en todos sus eventos OBL (button, :speak, utterance, AI). */
  private currentPhraseId = '';

  constructor(private http: HttpClient) {}

  // ── Session lifecycle ─────────────────────────────────────────────────────

  /**
   * @param userId       ID del usuario final (vacío en preview/edit).
   * @param rootBoardId  Tablero raíz de la sesión.
   * @param mode         'edit' | 'preview' | 'communicator'.
   * @param canLog       true solo cuando el usuario autenticado ES el usuario final
   *                     y debemos guardar interacciones OBL.
   */
  async startSession(
    userId: string,
    rootBoardId: string,
    mode: AacMode,
    canLog = false,
    controlsConfig?: ControlsConfig,
    predictorEnabled = false,
    iaRows = 5,
    iaCols = 1,
    aiRewriteEnabled = false,
  ): Promise<void> {
    this.mode        = mode;
    this.userId      = userId;
    this.rootBoardId = rootBoardId;
    this._currentBoardId = rootBoardId;
    this.boardStack  = [];
    this.phrase      = [];
    this.undoStack   = [];
    this.pendingEvents    = [];
    this.currentPhraseId  = '';
    this.canLog           = mode === 'communicator' && canLog;
    this.controlsConfig  = controlsConfig ?? { ...DEFAULT_CONTROLS_CONFIG };
    this.predictorEnabled = predictorEnabled;
    this.iaRows           = iaRows;
    this.iaCols           = iaCols;
    this.aiRewriteEnabled = aiRewriteEnabled;
    this.sessionStarted = new Date().toISOString();
    this.phraseChanged$.next([]);

    if (this.canLog && userId) {
      try {
        const res: any = await firstValueFrom(
          this.http.post(`${this.apiUrl}/obl`, { userId, started: this.sessionStarted }),
        );
        this.sessionId = res.sessionId;
        console.log('[AAC] OBL session started', this.sessionId);
      } catch (e) {
        console.warn('[AAC] OBL startSession failed', e);
      }
    } else {
      this.sessionId = 'preview-' + Date.now();
    }
  }

  async endSession(): Promise<void> {
    if (!this.canLog || !this.sessionId) return;
    try {
      await firstValueFrom(
        this.http.patch(`${this.apiUrl}/obl/${this.sessionId}/end`, {
          ended:  new Date().toISOString(),
          events: this.pendingEvents,
        }),
      );
      this.pendingEvents = [];
      console.log('[AAC] OBL session ended', this.sessionId);
    } catch (e) {
      console.warn('[AAC] OBL endSession failed', e);
    }
  }

  reset(): void {
    this.mode       = 'edit';
    this.userId     = '';
    this.sessionId  = '';
    this.canLog     = false;
    this.phrase     = [];
    this.undoStack  = [];
    this.boardStack = [];
    this.pendingEvents    = [];
    this.predictorEnabled = false;
    this.iaRows           = 5;
    this.iaCols           = 1;
    this.aiRewriteEnabled = false;
    this.soundEnabled       = false;
    this.configuredVoiceURI = '';
    this.configuredRate     = 0.9;
    this.configuredPitch    = 1.0;
    this.configuredVolume   = 1.0;
    this.configuredGender   = '';
    this.customVoiceReady   = false;
    this.customVoiceUserId  = '';
    if (this.speakTimer !== null) { clearTimeout(this.speakTimer); this.speakTimer = null; }
    this.stopCustomAudio();
    window.speechSynthesis?.cancel();
    this.phraseChanged$.next([]);
  }

  // ── Phrase ────────────────────────────────────────────────────────────────

  /**
   * Añade un ítem a la frase. El parámetro `undo` describe qué estado
   * debe restaurarse si el usuario pulsa "Borrar último" sobre este ítem.
   */
  addToPhrase(item: AacPhraseItem, undo: UndoEntry = { type: 'none' }): void {
    if (this.phrase.length === 0) {
      this.currentPhraseId = this.uuid();
    }
    this.phrase.push(item);
    this.undoStack.push(undo);
    this.phraseChanged$.next([...this.phrase]);
  }

  /**
   * Elimina el último ítem de la frase y, si ese ítem causó una transición
   * de tablero o de slot, la deshace.
   */
  deleteLast(): void {
    if (this.phrase.length === 0) return;
    this.phrase.pop();
    const undo = this.undoStack.pop() ?? { type: 'none' };
    this.phraseChanged$.next([...this.phrase]);
    this.logActionEvent(':backspace');

    if (undo.type === 'navigate' && undo.prevBoardId) {
      // Deshacer la navegación global: limpiar la pila hasta el punto de partida.
      const idx = this.boardStack.lastIndexOf(undo.prevBoardId);
      if (idx >= 0) {
        this.boardStack.splice(idx);
      } else {
        this.boardStack = [];
      }
      this._currentBoardId = undo.prevBoardId;
      this.boardNavigated$.next({ boardId: undo.prevBoardId });
    } else if (undo.type === 'slotNavigate' && undo.slotId != null) {
      this.undoSlotNavigate$.next({ slotId: undo.slotId });
    } else if (undo.type === 'setSlot' && undo.slotId != null) {
      this.restoreSlot$.next({ slotId: undo.slotId, boardId: undo.prevSlotBoardId ?? null });
    }
  }

  clearPhrase(): void {
    this.phrase    = [];
    this.undoStack = [];
    this.phraseChanged$.next([]);
    this.logActionEvent(':clear');
  }

  /**
   * Limpia la frase sin registrar evento OBL.
   * Usar cuando la frase ya fue cerrada/consumida por un :speak anterior
   * (p.ej. tras aceptar la reformulación IA) para evitar que un :clear
   * con timestamp tardío desplace el phraseStart del reconstructor.
   */
  clearPhraseSilent(): void {
    this.phrase    = [];
    this.undoStack = [];
    this.phraseChanged$.next([]);
  }

  /**
   * Igual que clearPhraseSilent pero además vuelve al tablero raíz.
   * Usar al cerrar el modal IA (tanto al aceptar como al cancelar): la frase ya
   * fue cerrada por :speak, no se emite :clear, y el tablero vuelve al inicio
   * listo para una frase nueva dentro de la misma sesión OBL.
   */
  clearPhraseSilentAndGoRoot(): void {
    this.phrase    = [];
    this.undoStack = [];
    this.phraseChanged$.next([]);
    this.boardStack = [];
    if (this.rootBoardId && this._currentBoardId !== this.rootBoardId) {
      this._currentBoardId = this.rootBoardId;
      this.returnToRoot$.next(this.rootBoardId);
    }
  }

  /**
   * Cierre definitivo de frase tras el popup IA.
   * Llamar desde TODOS los cierres del modal (aceptar, cancelar, swipe, error).
   *
   * - No emite :clear (la frase ya fue cerrada por :speak).
   * - Siempre emite returnToRoot$ (incluso si ya estábamos en raíz) para que
   *   el multitablero recargue y resetee los stacks de slots.
   * - No cierra sesión OBL ni borra eventos ya registrados.
   */
  finalizePhraseAfterAiPopup(): void {
    console.log('[AAC] finalizePhraseAfterAiPopup — antes:',
      'phrase.length=' + this.phrase.length,
      'boardStack.length=' + this.boardStack.length);

    this.phrase          = [];
    this.undoStack       = [];
    this.currentPhraseId = '';
    this.phraseChanged$.next([]);
    this.boardStack = [];
    if (this.rootBoardId) {
      this._currentBoardId = this.rootBoardId;
      this.returnToRoot$.next(this.rootBoardId);
    }

    console.log('[AAC] finalizePhraseAfterAiPopup — después:',
      'phrase.length=' + this.phrase.length);
  }

  /**
   * Limpia la frase y vuelve al tablero raíz de la sesión.
   * NO emite boardNavigated$ (canal de navegación del usuario) para evitar
   * efectos secundarios sobre navSourcePict/boardSourcePicts. En su lugar
   * emite returnToRoot$ que los suscriptores manejan de forma explícita.
   * No cierra sesión OBL, no resetea userId ni configuración de tablero.
   */
  clearPhraseAndGoRoot(): void {
    this.phrase    = [];
    this.undoStack = [];
    this.phraseChanged$.next([]);
    this.logActionEvent(':clear');
    this.boardStack = [];
    if (this.rootBoardId && this._currentBoardId !== this.rootBoardId) {
      this._currentBoardId = this.rootBoardId;
      this.returnToRoot$.next(this.rootBoardId);
    }
  }

  // ── Configurar voz del usuario final ─────────────────────────────────────

  /**
   * Aplica la configuración de voz guardada en el perfil del usuario final.
   * Llamar tras startSession() desde CommunicatorPage.
   */
  configureSoundSettings(
    soundEnabled:  boolean,
    voiceMode?:    'catalog' | 'custom',
    customReady?:  boolean,
    customUserId?: string,
    voiceURI?:     string,
    rate?:         number,
    pitch?:        number,
    volume?:       number,
    gender?:       string,
  ): void {
    this.soundEnabled       = soundEnabled;
    this.customVoiceReady   = voiceMode === 'custom' && customReady === true;
    this.customVoiceUserId  = this.customVoiceReady ? (customUserId ?? '') : '';
    this.configuredVoiceURI = voiceURI ?? '';
    this.configuredRate     = rate     ?? 0.9;
    this.configuredPitch    = pitch    ?? 1.0;
    this.configuredVolume   = volume   ?? 1.0;
    this.configuredGender   = gender   ?? '';
  }

  // ── Reproducción de voz personalizada (OpenVoice) ─────────────────────────

  private speakCustomVoice(text: string, onEnd?: () => void): void {
    this.stopCustomAudio();
    this.http.post(
      `${this.apiUrl}/voice/tts/speak`,
      { userId: this.customVoiceUserId, text },
      { responseType: 'blob' },
    ).subscribe({
      next: (blob: Blob) => {
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.volume  = this.configuredVolume;
        audio.onended = () => { URL.revokeObjectURL(url); onEnd?.(); };
        audio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
        this.customAudio = audio;
        audio.play().catch(() => { onEnd?.(); });
      },
      error: () => { onEnd?.(); },
    });
  }

  private stopCustomAudio(): void {
    if (this.customAudio) {
      this.customAudio.pause();
      this.customAudio = null;
    }
  }

  // ── Pictogram press ───────────────────────────────────────────────────────

  handlePictogramPress(cell: { pictogram: any; action: any }, boardId: string): void {
    const { pictogram, action } = cell;
    if (!pictogram) return;
    if (action?.type === 'disabled') return;

    const type: string = action?.type ?? 'voice';
    // Color efectivo: Fitzgerald (derivado de wordType) o manual.
    // getCellBaseColor devuelve el hex real que se muestra en el tablero.
    const effectiveColor = getCellBaseColor(pictogram as CellPictogram) ?? '';
    const item: AacPhraseItem = {
      id:                pictogram.id       ?? '',
      label:             pictogram.label    ?? '',
      imageUrl:          pictogram.imageUrl ?? '',
      sound:             pictogram.sound    ?? pictogram.label ?? '',
      boardId:           boardId,
      color:             effectiveColor,
      wordType:          pictogram.wordType ?? 'misc',
      fitzgeraldEnabled: !!(pictogram.fitzgeraldEnabled),
      action:            action ? { type: action.type, targetBoardId: action.targetBoardId ?? undefined, targetSlotId: action.targetSlotId ?? undefined } : null,
    };

    const spoken       = type === 'voice' || type === 'voice+navigate' || type === 'voice+setSlot';
    const navigates    = type === 'navigate' || type === 'voice+navigate';
    const setsSlot     = type === 'setSlot'  || type === 'voice+setSlot';
    const speakAndBack = type === 'speakAndBack';

    if (spoken) {
      // Para voice+navigate: registrar el board actual ANTES de navegar,
      // para que deleteLast() pueda restaurarlo si se borra este ítem.
      const undo: UndoEntry = navigates
        ? { type: 'navigate', prevBoardId: this._currentBoardId }
        : { type: 'none' };
      this.addToPhrase(item, undo);
      this.speakText(item.sound || item.label);
    }

    // speakAndBack: reproduce el pictograma y luego vuelve al tablero anterior.
    // La vuelta se produce al terminar el speech para respetar el orden.
    if (speakAndBack) {
      this.addToPhrase(item); // undo = 'none': el back ya sucedió vía speech
      this.speakTextAndThen(item.sound || item.label, undefined, () => this.goBack());
    }

    // soundEnabled: hablar en CUALQUIER pulsación (incluye navigate, setSlot, etc.)
    // Solo cuando la acción no sea ya "hablada" por los bloques anteriores.
    if (this.soundEnabled && !spoken && !speakAndBack) {
      this.speakText(item.sound || item.label);
    }

    // Registrar evento button ANTES de navegar/hablar/modificar frase
    const oblActions: OblAction[] = [];
    if (speakAndBack)           oblActions.push({ action: ':back' });
    if (navigates && action?.targetBoardId)
                                oblActions.push({ action: ':open_board', destination_board_id: action.targetBoardId });
    if (setsSlot && action?.targetBoardId)
                                oblActions.push({ action: 'ext_isaac_set_slot', ext_isaac_slot_id: action?.targetSlotId ?? undefined, destination_board_id: action.targetBoardId });

    this.logButtonEvent({
      label:        item.label,
      vocalization: item.sound || item.label,
      spoken,
      button_id:    pictogram.id ?? '',
      board_id:     boardId,
      image_url:    item.imageUrl,
      actions:      oblActions,
      color:        item.color    || undefined,
      wordType:     item.wordType || undefined,
    });

    if (navigates && action?.targetBoardId) {
      this.navigateToBoard(action.targetBoardId, pictogram as CellPictogram);
    }

    if (setsSlot && action?.targetSlotId != null && action?.targetBoardId) {
      this.slotChanged$.next({ slotId: action.targetSlotId, boardId: action.targetBoardId });
      this.logActionEvent(`:setSlot(${action.targetSlotId},${action.targetBoardId})`);
    }
  }

  // ── Board navigation ──────────────────────────────────────────────────────

  navigateToBoard(boardId: string, sourcePict?: CellPictogram | null): void {
    this.boardStack.push(this._currentBoardId);
    this._currentBoardId = boardId;
    this.boardNavigated$.next({ boardId, sourcePict });
    this.logActionEvent(':open_board', boardId);
  }

  goBack(): void {
    if (this.boardStack.length > 0) {
      const prev = this.boardStack.pop()!;
      this._currentBoardId = prev;
      this.boardNavigated$.next({ boardId: prev });
    }
    this.logActionEvent(':back');
  }

  /** @deprecated Usar homeClick output del componente para navegar a user-session. */
  goHome(): void {
    this._currentBoardId = this.rootBoardId;
    this.boardStack = [];
    this.boardNavigated$.next({ boardId: this.rootBoardId });
    this.logActionEvent(':home');
  }

  // ── Voice synthesis ───────────────────────────────────────────────────────

  /** Normaliza el texto para TTS: convierte a minúsculas para que el motor
   *  no interprete palabras en mayúsculas (NO, SÍ, VEN…) como siglas. */
  private normalizeTtsText(text: string): string {
    return text.trim().toLowerCase();
  }

  speakText(text: string, gender?: string): void {
    if (!text?.trim()) return;

    // Cancelar reproducción previa
    if (this.speakTimer !== null) { clearTimeout(this.speakTimer); this.speakTimer = null; }
    this.stopCustomAudio();
    window.speechSynthesis?.cancel();

    if (this.customVoiceReady && this.customVoiceUserId) {
      this.speakCustomVoice(text);
      return;
    }

    if (!window.speechSynthesis) { console.warn('[AAC] speechSynthesis not available'); return; }

    const utterance  = new SpeechSynthesisUtterance(this.normalizeTtsText(text));
    utterance.lang   = 'es-ES';
    utterance.rate   = this.configuredRate;
    utterance.pitch  = this.configuredPitch;
    utterance.volume = this.configuredVolume;

    const doSpeak = () => {
      this.speakTimer = null;
      const voices = window.speechSynthesis.getVoices();
      let voiceSet  = false;

      if (this.configuredVoiceURI) {
        const match = voices.find(v => v.voiceURI === this.configuredVoiceURI);
        if (match) { utterance.voice = match; utterance.lang = match.lang; voiceSet = true; }
      }

      if (!voiceSet) {
        const effectiveGender = gender || this.configuredGender;
        const esES    = voices.filter(v => v.lang === 'es-ES');
        const spanish = voices.filter(v => v.lang.startsWith('es'));
        if (!effectiveGender || effectiveGender === 'prefer_not_to_say' || effectiveGender === 'other') {
          utterance.voice = esES[0] ?? spanish[0] ?? voices[0] ?? null;
        } else if (effectiveGender === 'male') {
          utterance.voice =
            esES.find(v => /male|jorge|juan|carlos|enrique|pablo/i.test(v.name)) ??
            spanish.find(v => /male|jorge|juan|carlos|enrique|pablo/i.test(v.name)) ??
            esES[0] ?? spanish[0] ?? voices[0] ?? null;
        } else if (effectiveGender === 'female') {
          utterance.voice =
            esES.find(v => /female|monica|mónica|paulina|conchita|lucia|lucía|maria/i.test(v.name)) ??
            spanish.find(v => /female|monica|mónica|paulina|conchita|lucia|lucía|maria/i.test(v.name)) ??
            esES[0] ?? spanish[0] ?? voices[0] ?? null;
        }
      }

      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      // Delay de 50 ms tras cancel: evita el bug de Chrome donde cancel+speak
      // en la misma microtarea silencia o recorta el audio al inicio.
      // El timer es cancelable: una pulsación nueva descarta la pendiente.
      this.speakTimer = setTimeout(doSpeak, 50);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak(); // ya es asíncrono, no necesita delay adicional
      };
    }
  }

  /** Habla el texto y, al terminar (o tras timeout), ejecuta la callback. */
  speakTextAndThen(text: string, gender?: string, onEnd?: () => void): void {
    if (!text?.trim()) { onEnd?.(); return; }

    this.stopCustomAudio();
    window.speechSynthesis?.cancel();

    if (this.customVoiceReady && this.customVoiceUserId) {
      this.speakCustomVoice(text, onEnd);
      return;
    }

    if (!window.speechSynthesis) { onEnd?.(); return; }
    const utterance  = new SpeechSynthesisUtterance(this.normalizeTtsText(text));
    utterance.lang   = 'es-ES';
    utterance.rate   = this.configuredRate;
    utterance.pitch  = this.configuredPitch;
    utterance.volume = this.configuredVolume;

    let fired = false;
    const done = () => { if (!fired) { fired = true; onEnd?.(); } };

    utterance.onend   = done;
    utterance.onerror = done;
    // Fallback por si el evento onend no llega (algunos navegadores/motores lo omiten)
    const wordCount = text.trim().split(/\s+/).length;
    setTimeout(done, Math.max(1500, wordCount * 500));

    const doSpeak = () => {
      const voices          = window.speechSynthesis.getVoices();
      const effectiveGender = gender || this.configuredGender;
      let voiceSet          = false;

      if (this.configuredVoiceURI) {
        const match = voices.find(v => v.voiceURI === this.configuredVoiceURI);
        if (match) { utterance.voice = match; utterance.lang = match.lang; voiceSet = true; }
      }

      if (!voiceSet) {
        const esES    = voices.filter(v => v.lang === 'es-ES');
        const spanish = voices.filter(v => v.lang.startsWith('es'));
        if (effectiveGender === 'female') {
          utterance.voice =
            esES.find(v => /female|monica|mónica|paulina|conchita|lucia|lucía|maria/i.test(v.name)) ??
            spanish.find(v => /female|monica|mónica|paulina|conchita|lucia|lucía|maria/i.test(v.name)) ??
            esES[0] ?? spanish[0] ?? voices[0] ?? null;
        } else if (effectiveGender === 'male') {
          utterance.voice =
            esES.find(v => /male|jorge|juan|carlos|enrique|pablo/i.test(v.name)) ??
            spanish.find(v => /male|jorge|juan|carlos|enrique|pablo/i.test(v.name)) ??
            esES[0] ?? spanish[0] ?? voices[0] ?? null;
        } else {
          utterance.voice = esES[0] ?? spanish[0] ?? voices[0] ?? null;
        }
      }

      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      setTimeout(doSpeak, 50);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        doSpeak();
      };
    }
  }

  speakPhrase(gender?: string): void {
    if (this.phrase.length === 0) return;
    const text = this.phrase.map(p => p.sound || p.label).join(' ');
    this.speakText(text, gender);
    this.logActionEvent(':speak');
    this.logUtteranceEvent(text, this.phrase.map(p => ({
      id:       p.id,
      label:    p.label,
      board_id: p.boardId ?? '',
    })));
    // Si el tablero tiene IA de reescritura activa, notificar para abrir el modal.
    // Se emite también el timestamp t1 para que el evento OBL de IA use el tiempo de HABLAR.
    if (this.aiRewriteEnabled && this.mode === 'communicator') {
      this.phraseSpoken$.next({ phrase: [...this.phrase], timestamp: new Date().toISOString() });
    }
  }

  // ── OBL Logging ───────────────────────────────────────────────────────────

  logButtonEvent(data: {
    label: string; vocalization: string; spoken: boolean;
    button_id: string; board_id: string; image_url: string; actions: OblAction[];
    color?: string; wordType?: string;
  }): void {
    const { image_url, ...rest } = data;
    const ev: OblEvent = {
      id:        this.uuid(),
      type:      'button',
      timestamp: new Date().toISOString(),
      ...rest,
    };
    if (image_url && !image_url.startsWith('data:')) {
      ev.image_url = image_url;
    }
    this.pushEvent(ev);
  }

  logActionEvent(action: string, destinationBoardId?: string): void {
    this.pushEvent({
      id:                   this.uuid(),
      type:                 'action',
      timestamp:            new Date().toISOString(),
      action,
      destination_board_id: destinationBoardId,
    });
  }

  logUtteranceEvent(text: string, buttons: Array<{ id: string; label: string; board_id: string }>): void {
    this.pushEvent({
      id:        this.uuid(),
      type:      'utterance',
      timestamp: new Date().toISOString(),
      text,
      buttons,
    });
  }

  /**
   * Registra en OBL la reformulación IA de una frase.
   * Debe llamarse solo cuando el usuario acepta (OK) en el modal, nunca al pulsar ESCUCHAR.
   *
   * @param originalText     Texto original (labels de la frase del usuario).
   * @param reformulatedText Texto reformulado por la IA.
   * @param speakTimestamp   Timestamp ISO del momento en que el usuario pulsó HABLAR (t1).
   *                         Se usa como timestamp del evento para que el tiempo de la
   *                         reformulación coincida con el de la frase original, no con OK.
   * @param tokens           Tokens resueltos (pictogramas) de la respuesta IA.
   */
  logAiReformulationEvent(
    originalText:     string,
    reformulatedText: string,
    speakTimestamp:   string,
    tokens:           any[] = [],
  ): void {
    this.pushEvent({
      id:                           this.uuid(),
      type:                         'action',
      timestamp:                    speakTimestamp,
      action:                       'ext_isaac_ai_reformulation',
      text:                         reformulatedText,
      ext_isaac_original_text:      originalText,
      ext_isaac_reformulated_text:  reformulatedText,
      ext_isaac_ai_tokens:          tokens,
    });
  }

  private pushEvent(ev: OblEvent): void {
    if (!this.canLog) return; // preview/edit o usuario no final → solo consola
    if (this.currentPhraseId) ev.ext_isaac_phrase_id = this.currentPhraseId;
    console.log('[OBL]', ev.type, ev.action ?? ev.label ?? ev.text ?? '');
    this.pendingEvents.push(ev);
    if (this.pendingEvents.length >= 10) {
      this.flushEvents();
    }
  }

  private flushEvents(): void {
    if (!this.sessionId || this.pendingEvents.length === 0) return;
    const toSend = [...this.pendingEvents];
    this.pendingEvents = [];
    this.http.post(`${this.apiUrl}/obl/${this.sessionId}/events`, { events: toSend })
      .subscribe({
        error: (e) => {
          console.warn('[OBL] flush failed, re-queuing', e);
          this.pendingEvents.unshift(...toSend);
        },
      });
  }

  private uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}
