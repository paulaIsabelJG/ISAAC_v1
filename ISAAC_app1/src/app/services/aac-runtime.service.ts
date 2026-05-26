import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

// Re-use types from board.service (imported inline to avoid circular)
export type AacMode = 'edit' | 'preview' | 'communicator';

export interface AacPhraseItem {
  id:       string;
  label:    string;
  imageUrl: string;
  sound:    string;
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

  private _currentBoardId = '';
  readonly boardNavigated$ = new Subject<string>();
  readonly phraseChanged$  = new BehaviorSubject<AacPhraseItem[]>([]);

  get currentBoardId(): string { return this._currentBoardId; }

  private pendingEvents: OblEvent[] = [];
  private sessionStarted = '';

  constructor(private http: HttpClient) {}

  // ── Session lifecycle ─────────────────────────────────────────────────────

  async startSession(userId: string, rootBoardId: string, mode: AacMode): Promise<void> {
    this.mode        = mode;
    this.userId      = userId;
    this.rootBoardId = rootBoardId;
    this._currentBoardId = rootBoardId;
    this.boardStack  = [];
    this.phrase      = [];
    this.pendingEvents = [];
    this.sessionStarted = new Date().toISOString();
    this.phraseChanged$.next([]);

    if (mode === 'communicator' && userId) {
      try {
        const res: any = await this.http
          .post(`${this.apiUrl}/obl`, { userId, started: this.sessionStarted })
          .toPromise();
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
    if (this.mode !== 'communicator' || !this.sessionId) return;
    try {
      await this.http.patch(`${this.apiUrl}/obl/${this.sessionId}/end`, {
        ended:  new Date().toISOString(),
        events: this.pendingEvents,
      }).toPromise();
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
    this.phrase     = [];
    this.boardStack = [];
    this.pendingEvents = [];
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
      id:       pictogram.id ?? '',
      label:    pictogram.label ?? '',
      imageUrl: pictogram.imageUrl ?? '',
      sound:    pictogram.sound   ?? pictogram.label ?? '',
    };

    const spoken = type === 'voice' || type === 'voice+navigate';
    const navigates = type === 'navigate' || type === 'voice+navigate';

    // 1. Voice
    if (spoken) {
      this.addToPhrase(item);
      this.speakText(item.sound || item.label);
    }

    // 2. Navigate
    if (navigates && action?.targetBoardId) {
      this.navigateToBoard(action.targetBoardId);
    }

    // 3. Log button event
    const actions: string[] = [];
    if (spoken) actions.push('+speak');
    if (navigates) actions.push(`:open_board(${action?.targetBoardId ?? ''})`);

    this.logButtonEvent({
      label:         item.label,
      vocalization:  item.sound || item.label,
      spoken,
      button_id:     pictogram.id ?? '',
      board_id:      boardId,
      image_url:     item.imageUrl,
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

  goHome(): void {
    this._currentBoardId = this.rootBoardId;
    this.boardStack = [];
    this.boardNavigated$.next(this.rootBoardId);
    this.logActionEvent(':home');
  }

  // ── Voice synthesis ───────────────────────────────────────────────────────

  speakText(text: string, gender?: string): void {
    if (!text?.trim()) return;
    if (!window.speechSynthesis) { console.warn('[AAC] speechSynthesis not available'); return; }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = 'es-ES';
    utterance.rate = 0.9;
    utterance.pitch = 1;

    const assignVoice = () => {
      const voices = window.speechSynthesis.getVoices();
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
      // Voices may load asynchronously on first call
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        assignVoice();
      };
    }

    console.log('[AAC] speak:', text, '| gender:', gender ?? 'none');
  }

  speakPhrase(gender?: string): void {
    if (this.phrase.length === 0) return;
    const text = this.phrase.map(p => p.label).join(' ');
    this.speakText(text, gender);
    this.logActionEvent(':speak');
    // Log utterance
    this.logUtteranceEvent(text, this.phrase.map(p => p.id));
  }

  // ── OBL Logging ───────────────────────────────────────────────────────────

  logButtonEvent(data: {
    label: string; vocalization: string; spoken: boolean;
    button_id: string; board_id: string; image_url: string; actions: string[];
  }): void {
    const ev: OblEvent = {
      id:           this.uuid(),
      type:         'button',
      timestamp:    new Date().toISOString(),
      ...data,
    };
    console.log('[OBL button]', ev.label, '| board:', ev.board_id);
    this.pushEvent(ev);
  }

  logActionEvent(action: string, destinationBoardId?: string): void {
    const ev: OblEvent = {
      id:                   this.uuid(),
      type:                 'action',
      timestamp:            new Date().toISOString(),
      action,
      destination_board_id: destinationBoardId,
    };
    console.log('[OBL action]', action);
    this.pushEvent(ev);
  }

  logUtteranceEvent(text: string, buttonIds: string[]): void {
    const ev: OblEvent = {
      id:        this.uuid(),
      type:      'utterance',
      timestamp: new Date().toISOString(),
      text,
      buttons:   buttonIds,
    };
    console.log('[OBL utterance]', text);
    this.pushEvent(ev);
  }

  private pushEvent(ev: OblEvent): void {
    if (this.mode !== 'communicator') {
      // Preview/edit: solo consola, no persistir
      return;
    }
    this.pendingEvents.push(ev);
    // Flush every 10 events to avoid losing data
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
        }
      });
  }

  private uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}
