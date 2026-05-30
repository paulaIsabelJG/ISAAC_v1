import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, ChangeDetectorRef, HostBinding,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { AacRuntimeService, AacPhraseItem } from '../../services/aac-runtime.service';
import {
  ControlsConfig, ControlButtonId, ControlsBarItem,
  DEFAULT_CONTROLS_CONFIG,
} from '../../services/board.service';
import { PhraseBandComponent } from '../phrase-band/phrase-band.component';

@Component({
  selector:    'app-aac-controls-bar',
  templateUrl: './aac-controls-bar.component.html',
  styleUrls:   ['./aac-controls-bar.component.scss'],
  standalone:  true,
  imports:     [PhraseBandComponent],
})
export class AacControlsBarComponent implements OnInit, OnDestroy {

  // ── Inputs ─────────────────────────────────────────────────────────────────

  @HostBinding('class.acb--comm')
  get isComm(): boolean { return this.mode === 'communicator'; }

  @Input() mode: 'preview' | 'communicator' = 'preview';
  @Input() voiceEnabled  = false;
  @Input() gender?: string;
  @Input() canGoBack     = false;

  /**
   * Configuración de la barra (orden y visibilidad de botones).
   * Si no se proporciona, se usa la configuración del servicio AAC (sesión activa)
   * o el DEFAULT_CONTROLS_CONFIG como último recurso.
   */
  @Input() set controlsConfig(v: ControlsConfig | undefined | null) {
    this._controlsConfig = v ?? null;
  }
  private _controlsConfig: ControlsConfig | null = null;

  // ── Outputs ────────────────────────────────────────────────────────────────

  @Output() homeClick = new EventEmitter<void>();
  @Output() backClick = new EventEmitter<void>();

  // ── Estado interno ─────────────────────────────────────────────────────────

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

  ngOnDestroy(): void {
    this.phraseSub?.unsubscribe();
  }

  // ── Configuración efectiva ─────────────────────────────────────────────────

  get effectiveConfig(): ControlsConfig {
    return this._controlsConfig ?? this.aac.controlsConfig ?? DEFAULT_CONTROLS_CONFIG;
  }

  get orderedItems(): ControlsBarItem[] {
    const cfg = this.effectiveConfig;
    // Garantizar que phraseBar siempre existe en order
    if (!cfg.order.includes('phraseBar')) {
      return [...cfg.order, 'phraseBar'];
    }
    return cfg.order;
  }

  isVisible(id: ControlButtonId): boolean {
    return this.effectiveConfig.visibleButtons.includes(id);
  }

  isPhraseBar(item: ControlsBarItem): item is 'phraseBar' {
    return item === 'phraseBar';
  }

  isButton(item: ControlsBarItem): item is ControlButtonId {
    return item !== 'phraseBar';
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  onHome(): void {
    this.voiceAction('Inicio', () => this.homeClick.emit());
  }

  onBack(): void {
    this.voiceAction('Atrás', () => this.backClick.emit());
  }

  onSpeak(): void {
    this.aac.speakPhrase(this.gender);
  }

  onErase(): void {
    this.voiceAction('Borrar último', () => this.aac.deleteLast());
  }

  onClear(): void {
    this.voiceAction('Borrar todo', () => this.aac.clearPhrase());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  get hasPhrase(): boolean { return this.phrase.length > 0; }

  private voiceAction(label: string, action: () => void): void {
    if (this.mode === 'preview' || (this.mode === 'communicator' && this.voiceEnabled)) {
      this.aac.speakText(label, this.gender);
    }
    action();
  }
}
