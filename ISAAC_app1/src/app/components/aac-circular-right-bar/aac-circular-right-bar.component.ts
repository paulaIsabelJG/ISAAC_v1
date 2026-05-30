import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, ChangeDetectorRef, HostBinding,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { AacRuntimeService, AacPhraseItem } from '../../services/aac-runtime.service';
import {
  CircularControlsConfig, ControlButtonId,
  DEFAULT_CIRCULAR_CONTROLS_CONFIG,
} from '../../services/board.service';

/**
 * AacCircularRightBarComponent
 *
 * Barra vertical derecha para tableros circulares, pensada para eye-tracking.
 * Por defecto: Atrás + Hablar + Borrar último + Limpiar.
 * Botones grandes, bien espaciados, layout vertical.
 */
@Component({
  selector:    'app-aac-circular-right-bar',
  templateUrl: './aac-circular-right-bar.component.html',
  styleUrls:   ['./aac-circular-right-bar.component.scss'],
  standalone:  true,
  imports:     [],
})
export class AacCircularRightBarComponent implements OnInit, OnDestroy {

  @HostBinding('class.acrb--comm')
  get isComm(): boolean { return this.mode === 'communicator'; }

  @Input() mode: 'preview' | 'communicator' = 'preview';
  @Input() voiceEnabled  = false;
  @Input() gender?: string;
  @Input() canGoBack     = false;

  @Input() set config(v: CircularControlsConfig | undefined | null) {
    this._config = v ?? null;
  }
  private _config: CircularControlsConfig | null = null;

  @Output() homeClick = new EventEmitter<void>();
  @Output() backClick = new EventEmitter<void>();

  phrase: AacPhraseItem[] = [];
  private phraseSub?: Subscription;

  constructor(
    private aac: AacRuntimeService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.phraseSub = this.aac.phraseChanged$.subscribe(items => {
      this.phrase = items;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void { this.phraseSub?.unsubscribe(); }

  get effectiveConfig(): CircularControlsConfig {
    return this._config ?? DEFAULT_CIRCULAR_CONTROLS_CONFIG;
  }

  get rightBarItems(): ControlButtonId[] {
    return this.effectiveConfig.rightBar;
  }

  isVisible(id: ControlButtonId): boolean {
    return this.effectiveConfig.visibleButtons.includes(id);
  }

  get hasPhrase(): boolean { return this.phrase.length > 0; }

  onHome(): void  { this.voiceAction('Inicio',        () => this.homeClick.emit()); }
  onBack(): void  { this.voiceAction('Atrás',         () => this.backClick.emit()); }
  onSpeak(): void { this.aac.speakPhrase(this.gender); }
  onErase(): void { this.voiceAction('Borrar último', () => this.aac.deleteLast()); }
  onClear(): void { this.voiceAction('Borrar todo',   () => this.aac.clearPhrase()); }

  private voiceAction(label: string, action: () => void): void {
    if (this.mode === 'preview' || (this.mode === 'communicator' && this.voiceEnabled)) {
      this.aac.speakText(label, this.gender);
    }
    action();
  }
}
