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

import {
  Board,
  ControlsConfig, ControlButtonId, ControlsBarItem,
  DEFAULT_CONTROLS_CONFIG,
} from '../../services/board.service';
import { BackendUser } from '../../services/user.service';
import { buildSafeUrl as buildSafeUrlUtil } from '../../shared/utils/image.utils';

// ─── Contrato de configuración ────────────────────────────────────────────────
// Exportado para que la page pueda tiparlo sin duplicar la definición.
export interface BoardSidebarConfig {
  name: string;
  imageB64: string | null;
  rows: number;
  cols: number;
  predictor: boolean;
  aiRewrite: boolean;
  iaRows: number;
  iaCols: number;
  boardRole: 'main' | 'secondary' | 'multi';
  circleSlots: number;
  locationEnabled: boolean;
  locationSlots: number;
  assignedUserIds: string[];
  /** Configuración de la barra AAC (solo relevante en tableros principales). */
  controlsConfig?: ControlsConfig;
}

/**
 * BoardSidebarLeftComponent
 *
 * Columna izquierda del editor de tableros. Contiene:
 *  - Panel de CONFIGURACIÓN del tablero (nombre, imagen, usuarios, dimensiones,
 *    tipo, toggles de IA, botón "Guardar configuración").
 *  - Panel de TABLEROS DEL USUARIO (lista de tableros del mismo centro para
 *    navegar entre ellos directamente desde el editor).
 *
 * Gestiona su propio estado local de formulario (copias de cada campo cfg*).
 * En ngOnChanges sincroniza esos locales desde el @Input config cuando la
 * referencia del objeto cambia (p.ej. tras un guardado exitoso en la page).
 *
 * NO hace llamadas a la API — delega al editor page via @Output saveConfig.
 * NO tiene lógica de DnD, runtime AAC ni navegación entre tableros de la app.
 */
@Component({
  selector: 'app-board-sidebar-left',
  templateUrl: './board-sidebar-left.component.html',
  styleUrls: ['./board-sidebar-left.component.scss'],
  standalone: true,
  imports: [IonicModule, FormsModule],
})
export class BoardSidebarLeftComponent implements OnChanges {

  // ── Inputs ─────────────────────────────────────────────────────────────────
  /** Configuración actual sincronizada desde el tablero guardado en backend. */
  @Input() config!: BoardSidebarConfig;
  /** Si el tablero activo es de tipo circular (cambia qué campos se muestran). */
  @Input() isCircular = false;
  /** Usuarios del centro para el selector multi-asignación. */
  @Input() centerUsers: BackendUser[] = [];
  /** Todos los tableros del usuario asignado (la page mantiene la lista). */
  @Input() userBoards: Board[] = [];
  /** true mientras la lista de tableros se está cargando. */
  @Input() userBoardsLoading = false;
  /** ID del tablero recién creado, resaltado ~5 s en la lista. */
  @Input() highlightedBoardId = '';
  /** true mientras la page está procesando el guardado de configuración. */
  @Input() isSaving = false;
  /** true si el tablero es un multitablero (muestra sección de huecos). */
  @Input() isMultiBoard = false;
  /** Info de cada slot del multitablero para la sección de configuración. */
  @Input() multiSlots: Array<{ slotId: number; boardId: string | null; name: string }> = [];

  // ── Outputs ────────────────────────────────────────────────────────────────
  /** Emite el payload del formulario cuando el usuario pulsa "Guardar config". */
  @Output() saveConfig = new EventEmitter<BoardSidebarConfig>();
  /** Emite el boardId del tablero que el usuario quiere abrir en el editor. */
  @Output() openBoard = new EventEmitter<string>();
  /** Emite el slotId para seleccionar/asignar tablero a ese hueco (desde sidebar). */
  @Output() selectSlot = new EventEmitter<number>();
  /** Emite en tiempo real cuando el usuario modifica la config de la barra AAC. */
  @Output() controlsConfigChange = new EventEmitter<ControlsConfig>();

  // ── Getters ────────────────────────────────────────────────────────────────

  /** Tableros visibles en el perfil del usuario (publicados). */
  get publishedBoards(): Board[] {
    return this.userBoards.filter((b) => b.visibleInProfile);
  }

  // ── Estado interno del formulario ──────────────────────────────────────────
  // Copias locales de cada campo; ngModel las enlaza directamente.
  localName = '';
  localImageB64: string | null = null;
  localRows = 3;
  localCols = 4;
  localPredictor = false;
  localAiRewrite = false;
  localIaRows = 5;
  localIaCols = 1;
  localBoardRole: 'main' | 'secondary' | 'multi' = 'main';
  localCircleSlots = 8;
  localLocationEnabled = false;
  localLocationSlots = 6;
  localAssignedUserIds: string[] = [];

  // ── Estado local: configuración de la barra AAC ────────────────────────────
  localControlsConfig: ControlsConfig = { ...DEFAULT_CONTROLS_CONFIG };

  /** Metadatos de cada elemento (botones + phraseBar). */
  readonly allItemsMeta: Partial<Record<ControlsBarItem, { label: string; icon: string; canHide: boolean }>> = {
    home:       { label: 'Inicio',          icon: 'home-outline',         canHide: true  },
    back:       { label: 'Atrás',           icon: 'arrow-back-outline',   canHide: true  },
    speak:      { label: 'Altavoz',         icon: 'volume-high-outline',  canHide: true  },
    phraseBar:  { label: 'Barra de frase',  icon: 'reorder-four-outline', canHide: false },
    deleteLast: { label: 'Borrar último',   icon: 'backspace-outline',    canHide: true  },
    clearAll:   { label: 'Limpiar todo',    icon: 'trash-outline',        canHide: true  },
  };

  constructor(
    private toastCtrl: ToastController,
    private sanitizer: DomSanitizer,
  ) {}

  // ── Computed ───────────────────────────────────────────────────────────────

  /** true cuando el tablero está asignado a más de un usuario. */
  get isSharedBoard(): boolean {
    return this.localAssignedUserIds.length > 1;
  }

  /** Nombres de los usuarios actualmente asignados (para mostrar en tableros secundarios). */
  get assignedUserNames(): string[] {
    return this.localAssignedUserIds
      .map(id => this.centerUsers.find(u => u._id === id)?.name || id);
  }

  /** Tableros grid del usuario (para la sección "Cuadrícula" de la lista). */
  get gridBoards(): Board[] {
    return this.userBoards.filter((b) => (b.shape ?? 'grid') === 'grid');
  }

  /** Tableros circulares del usuario. */
  get circularBoards(): Board[] {
    return this.userBoards.filter((b) => b.shape === 'circular');
  }

  /** URL segura de la imagen de portada local (data: o https:). */
  get safeImageUrl(): SafeUrl | string {
    return buildSafeUrlUtil(this.localImageB64, this.sanitizer);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Sincroniza el formulario local cuando la referencia de config cambia.
   * La page crea un nuevo objeto tras cada guardado exitoso, lo que
   * dispara este hook y resetea el formulario con los valores del backend.
   */
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['config'] && this.config) {
      this.syncFromConfig();
    }
  }

  private syncFromConfig(): void {
    this.localName             = this.config.name;
    this.localImageB64         = this.config.imageB64;
    this.localRows             = this.config.rows;
    this.localCols             = this.config.cols;
    this.localPredictor        = this.config.predictor;
    this.localAiRewrite        = this.config.aiRewrite;
    this.localIaRows           = this.config.iaRows;
    this.localIaCols           = this.config.iaCols;
    this.localBoardRole        = this.config.boardRole;
    this.localCircleSlots      = this.config.circleSlots;
    this.localLocationEnabled  = this.config.locationEnabled;
    this.localLocationSlots    = this.config.locationSlots;
    this.localAssignedUserIds  = [...this.config.assignedUserIds];
    this.localControlsConfig   = this.config.controlsConfig
      ? { visibleButtons: [...this.config.controlsConfig.visibleButtons], order: [...this.config.controlsConfig.order] }
      : { ...DEFAULT_CONTROLS_CONFIG };
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  /** Emite el payload del formulario hacia la page para que haga el API call. */
  onSaveClick(): void {
    const isSecondary = this.localBoardRole === 'secondary';
    this.saveConfig.emit({
      name:             this.localName,
      imageB64:         this.localImageB64,
      rows:             this.localRows,
      cols:             this.localCols,
      predictor:        isSecondary ? false : this.localPredictor,
      aiRewrite:        isSecondary ? false : this.localAiRewrite,
      iaRows:           isSecondary ? 5     : this.localIaRows,
      iaCols:           isSecondary ? 1     : this.localIaCols,
      boardRole:        this.localBoardRole,
      circleSlots:      this.localCircleSlots,
      locationEnabled:  this.localLocationEnabled,
      locationSlots:    this.localLocationSlots,
      assignedUserIds:  this.localAssignedUserIds,
      controlsConfig:   this.localBoardRole === 'main'
        ? { ...this.localControlsConfig }
        : undefined,
    });
  }

  // ── Configuración de la barra AAC ─────────────────────────────────────────

  // ── Configuración de la barra AAC ─────────────────────────────────────────

  /** Lista de ítems en el orden actual, con metadatos y estado de visibilidad. */
  get orderedItemsMeta(): Array<{
    id: ControlsBarItem; label: string; icon: string; canHide: boolean; visible: boolean;
  }> {
    return this.localControlsConfig.order.map(id => {
      const meta = this.allItemsMeta[id as ControlsBarItem] ?? { label: id, icon: 'ellipse-outline', canHide: true };
      return {
        id: id as ControlsBarItem,
        label:   meta.label,
        icon:    meta.icon,
        canHide: meta.canHide,
        visible: id === 'phraseBar' || this.localControlsConfig.visibleButtons.includes(id as ControlButtonId),
      };
    });
  }

  /** Alterna la visibilidad de un botón y reorganiza la lista. */
  toggleItemVisibility(id: ControlButtonId): void {
    const isVisible = this.localControlsConfig.visibleButtons.includes(id);

    if (isVisible) {
      // Ocultar: quitar de visibleButtons y mover al final del order
      this.localControlsConfig.visibleButtons =
        this.localControlsConfig.visibleButtons.filter(b => b !== id);
      const newOrder = this.localControlsConfig.order.filter(i => i !== id);
      newOrder.push(id);
      this.localControlsConfig.order = newOrder;
    } else {
      // Mostrar: añadir a visibleButtons y mover antes del primer oculto
      const newVis = [...this.localControlsConfig.visibleButtons, id];
      this.localControlsConfig.visibleButtons = newVis;
      const withoutItem = this.localControlsConfig.order.filter(i => i !== id);
      const firstHiddenIdx = withoutItem.findIndex(
        i => i !== 'phraseBar' && !newVis.includes(i as ControlButtonId),
      );
      if (firstHiddenIdx >= 0) {
        withoutItem.splice(firstHiddenIdx, 0, id);
      } else {
        withoutItem.push(id);
      }
      this.localControlsConfig.order = withoutItem;
    }
    this.emitControlsConfig();
  }

  /** Reordena usando los índices from/to del evento ion-reorder-group. */
  onControlsReorder(event: CustomEvent): void {
    const { from, to } = (event as any).detail;
    const order = [...this.localControlsConfig.order];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    this.localControlsConfig.order = order;
    (event as any).detail.complete(false);
    this.emitControlsConfig();
  }

  private emitControlsConfig(): void {
    this.controlsConfigChange.emit({
      visibleButtons: [...this.localControlsConfig.visibleButtons],
      order:          [...this.localControlsConfig.order],
    });
  }

  onOpenBoard(boardId: string): void {
    this.openBoard.emit(boardId);
  }

  // ── Imagen de portada ─────────────────────────────────────────────────────

  pickBoardImage(): void {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/gif,image/webp';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        (await this.toastCtrl.create({
          message:  'La imagen supera 2 MB',
          duration: 2500,
          color:    'warning',
          position: 'top',
        })).present();
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.localImageB64 = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  removeBoardImage(): void {
    this.localImageB64 = null;
  }
}
