import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { AuthService } from '../../services/auth.service';
import { BackendPictogram } from '../../services/user.service';
import {
  Board,
  BoardCell,
  CellPictogram,
  CellAction,
  ActionType,
} from '../../services/board.service';
import { WordType, FITZGERALD, WORD_TYPE_LABELS } from '../../shared/constants/fitzgerald';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';

// ─── Tipos locales ─────────────────────────────────────────────────────────────

interface ArasaacResult {
  id: string | number;
  label: string;
  imageUrl: string;
  keywords: string[];
}

interface PictForm {
  source: 'arasaac' | 'custom' | 'new';
  id: string;
  label: string;
  sound: string;
  imageUrl: string;
  tags: string;        // coma-separado en UI, array al emitir
  description: string;
  wordType: WordType;
  fitzgeraldEnabled: boolean;
  color: string;
}

interface ActionForm {
  type: ActionType;
  targetBoardId: string;
  targetSlotId: number;
}

// ─── Payloads exportados ───────────────────────────────────────────────────────

/** Payload emitido por saveCellRequest. La page llama a boardSvc.updateCell(). */
export interface CellPanelSavePayload {
  pictogram: CellPictogram;
  action: CellAction;
}

/** Payload emitido por createBoardAndLink. La page hace router.navigate(). */
export interface CellPanelCreateBoardPayload {
  actionType: ActionType;
}

/**
 * BoardCellPanelComponent
 *
 * Columna derecha del editor de tableros: muestra el formulario de edición
 * del pictograma de la celda seleccionada.
 *
 * Filosofía:
 *  - El panel gestiona todo el estado local del formulario (pictForm, actionForm,
 *    tabs, búsqueda ARASAAC, imagen nueva).
 *  - La page proporciona el estado global via @Input y reacciona a los @Output.
 *  - ngOnChanges dispara la sincronización cuando cambia selectedCell.
 *
 * La page se encarga de: API calls, toasts/alerts de guardado/eliminación,
 * navegación, side-effects post-guardado (ej: guardar en librería personal).
 */
@Component({
  selector: 'app-board-cell-panel',
  templateUrl: './board-cell-panel.component.html',
  styleUrls: ['./board-cell-panel.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class BoardCellPanelComponent implements OnChanges {

  // ── Inputs ─────────────────────────────────────────────────────────────────
  /**
   * Celda actualmente seleccionada.
   * La page crea siempre un nuevo objeto { row, col } en onCellClick →
   * la referencia cambia → ngOnChanges dispara → formulario sincronizado.
   */
  @Input() selectedCell:      { row: number; col: number } | null = null;
  /** Datos actuales de la celda seleccionada (pictograma + acción), o null. */
  @Input() cellData:          BoardCell | null = null;
  /** true cuando la celda ya tiene un pictograma guardado. */
  @Input() isEditingCell:     boolean = false;
  /** true mientras se procesa el guardado de celda. */
  @Input() isSaving:          boolean = false;
  /**
   * Si no está vacío, los pictogramas personales están bloqueados.
   * El valor es el mensaje explicativo que se mostrará al usuario.
   */
  @Input() personalPictsBlockedReason: string = '';
  /** true cuando el tablero es de tipo circular. */
  @Input() isCircular:        boolean = false;
  /** true cuando la celda seleccionada es la celda central del circulares. */
  @Input() isCenterSelected:  boolean = false;
  /** Tableros del usuario contexto disponibles como destino de navegación. */
  @Input() sameShapeBoards:   Board[] = [];
  /** Tableros secundarios sin usuarios asignados (heredarán assignedUserIds al enlazarse). */
  @Input() boardsUnassigned:  Board[] = [];
  /** Evita bug de ion-select: solo renderiza el selector cuando los datos están listos. */
  @Input() boardsReady:       boolean = false;
  /** Pictogramas personales del usuario asignado al tablero. */
  @Input() personalPicts:     BackendPictogram[] = [];
  /** true mientras se cargan los pictogramas personales. */
  @Input() personalLoading:   boolean = false;

  // ── Outputs ────────────────────────────────────────────────────────────────
  /** La page recibe el payload y llama a boardSvc.updateCell(). */
  @Output() saveCellRequest    = new EventEmitter<CellPanelSavePayload>();
  /** La page lanza el alert de confirmación y llama a boardSvc.updateCell(null). */
  @Output() removeCellRequest  = new EventEmitter<void>();
  /** La page hace router.navigate a /board-builder-create con los queryParams de contexto. */
  @Output() createBoardAndLink = new EventEmitter<CellPanelCreateBoardPayload>();

  // ── Estado local: tab ───────────────────────────────────────────────────────
  rightMode: 'arasaac' | 'personal' | 'new' = 'arasaac';

  // ── Estado local: formulario pictograma ────────────────────────────────────
  pictForm: PictForm = this.emptyPictForm();

  // ── Estado local: formulario acción ───────────────────────────────────────
  actionForm: ActionForm = { type: 'voice', targetBoardId: '', targetSlotId: 1 };
  actionFormAiTarget       = false;
  actionFormShowLastPhrase = false;

  // ── Estado local: imagen nueva ─────────────────────────────────────────────
  newImgB64: string | null = null;
  newImgUrl: SafeUrl | null = null;

  // ── Estado local: búsqueda ARASAAC ─────────────────────────────────────────
  arasaacQuery    = '';
  arasaacResults: ArasaacResult[] = [];
  arasaacSearching = false;
  private _arasaacDeb: ReturnType<typeof setTimeout> | null = null;

  // ── Constantes expuestas al template ───────────────────────────────────────
  readonly FITZGERALD      = FITZGERALD;
  readonly wordTypeLabels  = WORD_TYPE_LABELS;
  readonly wordTypes: WordType[] = [
    'verb', 'pronoun', 'noun', 'descriptor', 'social', 'misc',
  ];
  readonly actionTypes: { value: ActionType; label: string }[] = [
    { value: 'voice',          label: 'Voz' },
    { value: 'speakAndBack',   label: 'Voz + volver al tablero anterior' },
    { value: 'navigate',       label: 'Navegar a otro tablero' },
    { value: 'voice+navigate', label: 'Voz + Navegar a otro tablero' },
    { value: 'setSlot',        label: 'Cambiar hueco del multitablero' },
    { value: 'voice+setSlot',  label: 'Voz + Cambiar hueco' },
    { value: 'disabled',       label: 'Desactivado' },
  ];

  constructor(
    private sanitizer: DomSanitizer,
    private toastCtrl: ToastController,
    private authSvc:   AuthService,
  ) {}

  // ── ngOnChanges ────────────────────────────────────────────────────────────

  ngOnChanges(changes: SimpleChanges): void {
    // Cuando la celda seleccionada cambia (nueva referencia en cada click):
    if (changes['selectedCell']) {
      if (!this.selectedCell) {
        this.resetForm();
      } else if (this.cellData?.pictogram) {
        this.loadCellIntoForm(this.cellData);
      } else {
        // Celda vacía seleccionada
        this.resetForm();
      }
    }
  }

  private resetForm(): void {
    this.pictForm                = this.emptyPictForm();
    this.actionForm              = { type: 'voice', targetBoardId: '', targetSlotId: 1 };
    this.actionFormAiTarget      = false;
    this.actionFormShowLastPhrase = false;
    this.newImgB64               = null;
    this.newImgUrl               = null;
  }

  private loadCellIntoForm(cell: BoardCell): void {
    const p = cell.pictogram!;
    this.pictForm = {
      source:             p.source,
      id:                 p.id,
      label:              p.label,
      sound:              p.sound,
      imageUrl:           p.imageUrl,
      tags:               (p.tags ?? []).join(', '),
      description:        p.description,
      wordType:           p.wordType as WordType,
      fitzgeraldEnabled:  p.fitzgeraldEnabled,
      color:              p.color,
    };
    this.actionForm = {
      type:          cell.action?.type         ?? 'voice',
      targetBoardId: cell.action?.targetBoardId ?? '',
      targetSlotId:  cell.action?.targetSlotId  ?? 1,
    };
    this.actionFormAiTarget      = !!cell.action?.aiGeneratedBoardTarget;
    this.actionFormShowLastPhrase = !!cell.action?.showLastPhrase;

    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Getters computados ─────────────────────────────────────────────────────

  get hasSelectedCell(): boolean {
    return !!this.selectedCell;
  }

  get fitzgeraldColor(): string {
    if (!this.pictForm.fitzgeraldEnabled) return this.pictForm.color || '#f5f5f5';
    return FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5';
  }

  get fitzgeraldBgColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 20%, white)`;
  }

  get fitzgeraldBorderColor(): string {
    return `color-mix(in srgb, ${this.fitzgeraldColor} 55%, white)`;
  }

  buildSafeUrl(url?: string | null): SafeUrl | string {
    return buildSafeUrlUtil(url, this.sanitizer);
  }

  // ── ARASAAC search ─────────────────────────────────────────────────────────

  onArasaacInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.arasaacQuery = val;
    if (this._arasaacDeb) clearTimeout(this._arasaacDeb);
    if (!val.trim() || val.length < 2) {
      this.arasaacResults = [];
      return;
    }
    this._arasaacDeb = setTimeout(() => this.searchArasaac(val.trim()), 400);
  }

  private async searchArasaac(q: string): Promise<void> {
    this.arasaacSearching = true;
    try {
      const res = await fetch(
        `http://localhost:4000/api/arasaac/search?query=${encodeURIComponent(q)}&lang=es`,
        { headers: { Authorization: `Bearer ${this.authSvc.getToken()}` } },
      );
      const data: ArasaacResult[] = await res.json();
      this.arasaacResults = Array.isArray(data) ? data.slice(0, 24) : [];
    } catch {
      this.arasaacResults = [];
    } finally {
      this.arasaacSearching = false;
    }
  }

  selectArasaacResult(r: ArasaacResult): void {
    const wordType = this.inferWordType(r.keywords);
    this.pictForm = {
      source:            'arasaac',
      id:                r.id?.toString() ?? '',
      label:             r.label,
      sound:             r.label,
      imageUrl:          r.imageUrl,
      tags:              r.keywords.join(', '),
      description:       '',
      wordType,
      fitzgeraldEnabled: true,
      color:             FITZGERALD[wordType],
    };
    this.newImgB64 = null;
    this.newImgUrl = null;
  }

  private inferWordType(keywords: string[]): WordType {
    const kw = keywords.join(' ').toLowerCase();
    if (/\b(yo|tú|él|ella|nosotros|ellos|vosotros|usted)\b/.test(kw))        return 'pronoun';
    if (/\b(comer|beber|dormir|jugar|ir|quiero|necesito|hacer)\b/.test(kw))  return 'verb';
    if (/\b(grande|pequeño|rojo|azul|caliente|frío|bonito|feliz)\b/.test(kw)) return 'descriptor';
    if (/\b(hola|gracias|por favor|sí|no|adiós|perdona)\b/.test(kw))         return 'social';
    return 'misc';
  }

  // ── Pictogramas personales ─────────────────────────────────────────────────

  selectPersonalPict(p: BackendPictogram): void {
    this.pictForm = {
      source:            'custom',
      id:                p.id,
      label:             p.label,
      sound:             p.label,
      imageUrl:          p.imageUrl,
      tags:              '',
      description:       p.description ?? '',
      wordType:          (p.wordType ?? 'misc') as WordType,
      fitzgeraldEnabled: true,
      color:             FITZGERALD[(p.wordType ?? 'misc') as WordType] ?? '#f5f5f5',
    };
    if (p.imageUrl?.startsWith('data:')) {
      this.newImgB64 = p.imageUrl;
      this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(p.imageUrl);
    } else {
      this.newImgB64 = null;
      this.newImgUrl = null;
    }
  }

  // ── Imagen nueva ───────────────────────────────────────────────────────────

  pickImage(): void {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (await this.toastCtrl.create({
          message:  'La imagen supera 2 MB',
          duration: 2500, color: 'warning', position: 'top',
        })).present();
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const b64 = ev.target!.result as string;
        this.newImgB64 = b64;
        this.newImgUrl = this.sanitizer.bypassSecurityTrustUrl(b64);
        this.pictForm.imageUrl = b64;
        this.pictForm.source   = 'new';
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  // ── Formulario de acción ───────────────────────────────────────────────────

  onActionTypeSelect(event: Event): void {
    this.actionForm.type = (event as CustomEvent<{ value: ActionType }>).detail.value;
  }

  onTargetBoardSelect(event: Event): void {
    this.actionForm.targetBoardId =
      (event as CustomEvent<{ value: string }>).detail.value ?? '';
  }

  // ── Emits hacia la page ────────────────────────────────────────────────────

  async onSaveCell(): Promise<void> {
    if (!this.pictForm.label.trim()) {
      const toast = await this.toastCtrl.create({
        message:  'La etiqueta del pictograma no puede estar vacía',
        duration: 2500,
        color:    'warning',
        position: 'top',
      });
      await toast.present();
      return;
    }

    const pict: CellPictogram = {
      source:            this.pictForm.source,
      id:                this.pictForm.id,
      label:             this.pictForm.label.trim(),
      imageUrl:          this.pictForm.imageUrl,
      sound:             this.pictForm.sound || this.pictForm.label.trim(),
      tags:              this.pictForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      description:       this.pictForm.description,
      wordType:          this.pictForm.wordType,
      fitzgeraldEnabled: this.pictForm.fitzgeraldEnabled,
      color:             this.pictForm.fitzgeraldEnabled
                           ? (FITZGERALD[this.pictForm.wordType] ?? '#f5f5f5')
                           : this.pictForm.color,
    };

    const isCenterCell = this.selectedCell?.row === 0 && this.selectedCell?.col === -1;
    const isSlotAction = this.actionForm.type === 'setSlot' || this.actionForm.type === 'voice+setSlot';
    const action: CellAction = {
      type:                   this.actionForm.type,
      targetBoardId:          this.actionForm.targetBoardId || null,
      aiGeneratedBoardTarget: this.isCircular ? this.actionFormAiTarget : false,
      showLastPhrase:         this.isCircular && isCenterCell
                                ? this.actionFormShowLastPhrase
                                : false,
      targetSlotId:           isSlotAction ? (this.actionForm.targetSlotId || 1) : null,
    };

    this.saveCellRequest.emit({ pictogram: pict, action });
  }

  onRemoveCell(): void {
    this.removeCellRequest.emit();
  }

  onCreateBoardAndLink(): void {
    this.createBoardAndLink.emit({ actionType: this.actionForm.type });
  }

  // ── Helpers privados ───────────────────────────────────────────────────────

  private emptyPictForm(): PictForm {
    return {
      source: 'new', id: '', label: '', sound: '', imageUrl: '',
      tags: '', description: '', wordType: 'misc',
      fitzgeraldEnabled: true, color: '#f5f5f5',
    };
  }
}
