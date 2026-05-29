import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ControlsConfig, DEFAULT_CONTROLS_CONFIG } from './board.service';

export type AacMode = 'edit' | 'preview' | 'communicator';

export interface AacPhraseItem {
  id:       string;
  label:    string;
  imageUrl: string;
  sound:    string;
  /** Color Fitzgerald del pictograma (hex). Mostrado en la phrase-band. */
  color?:   string;
  /** Categoría gramatical Fitzgerald. */
  wordType?: string;
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
  actions?:             string[];
  action?:              string;
  destination_board_id?: string;
  text?:                string;
  buttons?:             string[];
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
  readonly boardNavigated$ = new Subject<string>();
  readonly phraseChanged$  = new BehaviorSubject<AacPhraseItem[]>([]);
  readonly slotChanged$    = new Subject<{ slotId: number; boardId: string }>();

  get currentBoardId(): string { return this._currentBoardId; }

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

  // ── Pictogram press ───────────────────────────────────────────────────────

  handlePictogramPress(cell: { pictogram: any; action: any }, boardId: string): void {
    const { pictogram, action } = cell;
    if (!pictogram) return;
    if (action?.type === 'disabled') return;

    const type: string = action?.type ?? 'voice';
    const item: AacPhraseItem = {
      id:       pictogram.id       ?? '',
      label:    pictogram.label    ?? '',
      imageUrl: pictogram.imageUrl ?? '',
      sound:    pictogram.sound    ?? pictogram.label ?? '',
      color:    pictogram.color    ?? '',
      wordType: pictogram.wordType ?? 'misc',
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
      this.navigateToBoard(action.targetBoardId);
    }

    if (setsSlot && action?.targetSlotId != null && action?.targetBoardId) {
      this.slotChanged$.next({ slotId: action.targetSlotId, boardId: action.targetBoardId });
      this.logActionEvent(`:setSlot(${action.targetSlotId},${action.targetBoardId})`);
    }

    const actions: string[] = [];
    if (spoken)       actions.push('+speak');
    if (speakAndBack) actions.push('+speak', ':back');
    if (navigates)    actions.push(`:open_board(${action?.targetBoardId ?? ''})`);
    if (setsSlot)     actions.push(`:setSlot(${action?.targetSlotId ?? ''},${action?.targetBoardId ?? ''})`);

    this.logButtonEvent({
      label:        item.label,
      vocalization: item.sound || item.label,
      spoken,
      button_id:    pictogram.id ?? '',
      board_id:     boardId,
      image_url:    item.imageUrl,
      actions,
    });
  }

  // ── Board navigation ──────────────────────────────────────────────────────

  navigateToBoard(boardId: string): void {
    this.boardStack.push(this._currentBoardId);
    this._currentBoardId = boardId;
    this.boardNavigated$.next(boardId);
    this.logActionEvent(':open_board', boardId);
  }

  goBack(): void {
    if (this.boardStack.length > 0) {
      const prev = this.boardStack.pop()!;
      this._currentBoardId = prev;
      this.boardNavigated$.next(prev);
    }
    this.logActionEvent(':back');
  }

  /** @deprecated Usar homeClick output del componente para navegar a user-session. */
  goHome(): void {
    this._currentBoardId = this.rootBoardId;
    this.boardStack = [];
    this.boardNavigated$.next(this.rootBoardId);
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
  }

  // ── OBL Logging ───────────────────────────────────────────────────────────

  logButtonEvent(data: {
    label: string; vocalization: string; spoken: boolean;
    button_id: string; board_id: string; image_url: string; actions: string[];
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
