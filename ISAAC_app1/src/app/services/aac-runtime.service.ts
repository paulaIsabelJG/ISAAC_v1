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
  action:                string;          // ':open_board' | 'ext_isaac_set_slot' | '+speak' | ':back'
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
  buttons?:             string[];
  // extensión ISAAC: reformulación IA (solo en action 'ext_isaac_ai_reformulation')
  ext_isaac_original_text?:     string;
  ext_isaac_reformulated_text?: string;
  ext_isaac_ai_tokens?:         any[];
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
  iaRows            = 5;
  iaCols            = 1;
  aiRewriteEnabled  = false;

  private _currentBoardId = '';
  readonly boardNavigated$ = new Subject<BoardNavEvent>();
  readonly phraseChanged$  = new BehaviorSubject<AacPhraseItem[]>([]);
  readonly slotChanged$    = new Subject<{ slotId: number; boardId: string }>();

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
    this.pendingEvents = [];
    this.canLog         = mode === 'communicator' && canLog;
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
    this.boardStack = [];
    this.pendingEvents    = [];
    this.predictorEnabled = false;
    this.iaRows           = 5;
    this.iaCols           = 1;
    this.aiRewriteEnabled = false;
    this.phraseChanged$.next([]);
  }

  // ── Phrase ────────────────────────────────────────────────────────────────

  addToPhrase(item: AacPhraseItem): void {
    this.phrase.push(item);
    this.phraseChanged$.next([...this.phrase]);
  }

  deleteLast(): void {
    this.phrase.pop();
    this.phraseChanged$.next([...this.phrase]);
    this.logActionEvent(':backspace');
  }

  clearPhrase(): void {
    this.phrase = [];
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
    this.phrase = [];
    this.phraseChanged$.next([]);
  }

  /**
   * Limpia la frase y vuelve al tablero raíz de la sesión.
   * NO emite boardNavigated$ (canal de navegación del usuario) para evitar
   * efectos secundarios sobre navSourcePict/boardSourcePicts. En su lugar
   * emite returnToRoot$ que los suscriptores manejan de forma explícita.
   * No cierra sesión OBL, no resetea userId ni configuración de tablero.
   */
  clearPhraseAndGoRoot(): void {
    this.phrase = [];
    this.phraseChanged$.next([]);
    this.logActionEvent(':clear');
    this.boardStack = [];
    if (this.rootBoardId && this._currentBoardId !== this.rootBoardId) {
      this._currentBoardId = this.rootBoardId;
      this.returnToRoot$.next(this.rootBoardId);
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
      this.addToPhrase(item);
      this.speakText(item.sound || item.label);
    }

    // speakAndBack: reproduce el pictograma y luego vuelve al tablero anterior.
    // La vuelta se produce al terminar el speech para respetar el orden.
    if (speakAndBack) {
      this.addToPhrase(item);
      this.speakTextAndThen(item.sound || item.label, undefined, () => this.goBack());
    }

    if (navigates && action?.targetBoardId) {
      this.navigateToBoard(action.targetBoardId, pictogram as CellPictogram);
    }

    if (setsSlot && action?.targetSlotId != null && action?.targetBoardId) {
      this.slotChanged$.next({ slotId: action.targetSlotId, boardId: action.targetBoardId });
      this.logActionEvent(`:setSlot(${action.targetSlotId},${action.targetBoardId})`);
    }

    const oblActions: OblAction[] = [];
    if (spoken || speakAndBack) oblActions.push({ action: '+speak' });
    if (speakAndBack)           oblActions.push({ action: ':back' });
    if (navigates)              oblActions.push({ action: ':open_board', destination_board_id: action?.targetBoardId ?? undefined });
    if (setsSlot)               oblActions.push({ action: 'ext_isaac_set_slot', ext_isaac_slot_id: action?.targetSlotId ?? undefined, destination_board_id: action?.targetBoardId ?? undefined });

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
    if (!window.speechSynthesis) { console.warn('[AAC] speechSynthesis not available'); return; }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(this.normalizeTtsText(text));
    utterance.lang  = 'es-ES';
    utterance.rate  = 0.9;
    utterance.pitch = 1;

    const assignVoice = () => {
      const voices  = window.speechSynthesis.getVoices();
      const spanish = voices.filter(v => v.lang.startsWith('es'));
      const all     = voices;

      if (!gender || gender === 'prefer_not_to_say' || gender === 'other') {
        utterance.voice = spanish[0] ?? all[0] ?? null;
      } else if (gender === 'male') {
        utterance.voice =
          spanish.find(v => /male|jorge|juan|carlos|enrique|pablo/i.test(v.name)) ??
          all.find(v => /male|jorge|juan|carlos/i.test(v.name)) ??
          spanish[0] ?? all[0] ?? null;
      } else if (gender === 'female') {
        utterance.voice =
          spanish.find(v => /female|monica|mónica|paulina|conchita|lucia|lucía|maria/i.test(v.name)) ??
          all.find(v => /female|monica|mónica|paulina/i.test(v.name)) ??
          spanish[0] ?? all[0] ?? null;
      }
      window.speechSynthesis.speak(utterance);
    };

    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      assignVoice();
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        assignVoice();
      };
    }
  }

  /** Habla el texto y, al terminar (o tras timeout), ejecuta la callback. */
  speakTextAndThen(text: string, _gender?: string, onEnd?: () => void): void {
    if (!text?.trim()) { onEnd?.(); return; }
    if (!window.speechSynthesis) { onEnd?.(); return; }

    window.speechSynthesis.cancel();
    const utterance  = new SpeechSynthesisUtterance(this.normalizeTtsText(text));
    utterance.lang   = 'es-ES';
    utterance.rate   = 0.9;
    utterance.pitch  = 1;

    let fired = false;
    const done = () => { if (!fired) { fired = true; onEnd?.(); } };

    utterance.onend   = done;
    utterance.onerror = done;
    // Fallback por si el evento onend no llega (algunos navegadores/motores lo omiten)
    const wordCount = text.trim().split(/\s+/).length;
    setTimeout(done, Math.max(1500, wordCount * 500));

    const assignVoice = () => {
      const voices  = window.speechSynthesis.getVoices();
      const spanish = voices.filter(v => v.lang.startsWith('es'));
      utterance.voice = spanish[0] ?? voices[0] ?? null;
      window.speechSynthesis.speak(utterance);
    };
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { assignVoice(); }
    else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        assignVoice();
      };
    }
  }

  speakPhrase(gender?: string): void {
    if (this.phrase.length === 0) return;
    const text = this.phrase.map(p => p.sound || p.label).join(' ');
    this.speakText(text, gender);
    this.logActionEvent(':speak');
    this.logUtteranceEvent(text, this.phrase.map(p => p.id));
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
    this.pushEvent({
      id:        this.uuid(),
      type:      'button',
      timestamp: new Date().toISOString(),
      ...data,
    });
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

  logUtteranceEvent(text: string, buttonIds: string[]): void {
    this.pushEvent({
      id:        this.uuid(),
      type:      'utterance',
      timestamp: new Date().toISOString(),
      text,
      buttons:   buttonIds,
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
