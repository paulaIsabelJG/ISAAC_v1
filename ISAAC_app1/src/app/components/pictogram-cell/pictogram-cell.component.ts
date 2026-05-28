import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
} from '@angular/core';
import { CellPictogram } from '../../services/board.service';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';

export type CellMode = 'edit' | 'preview' | 'communicator';

/**
 * PictogramCellComponent
 *
 * Wrapper completo de una celda de pictograma.
 * Encapsula: layout visual, colores, DnD, selección y delegación
 * al átomo interior PictCellContentComponent.
 *
 * El host element ES la celda visual (CSS Grid 1fr/auto para imagen + label).
 * Sin div wrapper extra: PictCellContentComponent usa display:contents
 * y sus hijos son grid-items directos de este host.
 *
 * Usado por: BoardGridComponent (grid) — y en el futuro BoardCircularComponent.
 */
@Component({
  selector: 'app-pictogram-cell',
  templateUrl: './pictogram-cell.component.html',
  styleUrls: ['./pictogram-cell.component.scss'],
  standalone: true,
  imports: [PictCellContentComponent],
  host: {
    // ── Estado visual ────────────────────────────────────────────────────────
    '[class.pgc--selected]':   'isSelected',
    '[class.pgc--dragging]':   'isDragging',
    '[class.pgc--dragover]':   'isDragOver',
    '[class.pgc--move-src]':   'isMoveSrc',
    '[class.pgc--move-dst]':   'isMoveMode && !isMoveSrc',
    '[class.pgc--disabled]':   'isDisabled',
    '[class.pgc--filled]':     '!!pict',
    // ── Modo (controla hover, DnD, emptyType) ────────────────────────────────
    '[class.pgc--edit]':       "mode === 'edit'",
    '[class.pgc--preview]':    "mode === 'preview'",
    '[class.pgc--comm]':       "mode === 'communicator'",
    // ── Colores dinámicos (Fitzgerald / manual) ──────────────────────────────
    '[style.background]':      'bgColor',
    '[style.border-color]':    'borderColor',
    // ── DnD: solo cuando la celda tiene pictograma y estamos en edit ─────────
    '[attr.draggable]':        'isDraggable ? "true" : null',
  },
})
export class PictogramCellComponent {
  // ── Datos de la celda ────────────────────────────────────────────────────
  @Input() pict: CellPictogram | null = null;

  // ── Modo de renderizado ──────────────────────────────────────────────────
  @Input() mode: CellMode = 'communicator';

  // ── Estado de interacción (vienen del padre) ─────────────────────────────
  @Input() isSelected = false;
  @Input() isDragging = false;
  @Input() isDragOver = false;
  @Input() isMoveSrc  = false;
  /** true cuando hay una celda origen pendiente de destino (modo mover táctil) */
  @Input() isMoveMode = false;
  @Input() isDisabled = false;

  // ── Colores (pre-calculados por BoardGridComponent) ──────────────────────
  @Input() bgColor     = '#ffffff';
  @Input() borderColor = '#ffb6c1';

  // ── Eventos hacia el padre ───────────────────────────────────────────────
  @Output() cellClick    = new EventEmitter<void>();
  @Output() cellDblClick = new EventEmitter<void>();
  @Output() dragStart    = new EventEmitter<DragEvent>();
  @Output() dragOver     = new EventEmitter<DragEvent>();
  @Output() dragLeave    = new EventEmitter<DragEvent>();
  /** Renombrado de 'drop' a 'pgcDrop' para evitar conflicto con el native DOM
   *  event 'drop' (mismo nombre, todo minúsculas), que provocaba recursión
   *  infinita: Angular suscribía el @HostListener('drop') al EventEmitter. */
  @Output() pgcDrop      = new EventEmitter<DragEvent>();
  @Output() dragEnd      = new EventEmitter<void>();

  /** La celda es arrastrable solo en edit con pictograma. */
  get isDraggable(): boolean {
    return this.mode === 'edit' && !!this.pict;
  }

  /**
   * Estado vacío:
   *   edit → '+' (celda vacía clickable)
   *   preview / communicator → espacio reservado invisible
   */
  get emptyType(): 'plus' | 'empty-div' {
    return this.mode === 'edit' ? 'plus' : 'empty-div';
  }

  /**
   * Badge "OFF" solo en edit (en preview/communicator la celda
   * deshabilitada ya se ve por opacity del CSS).
   */
  get showDisabledBadge(): boolean {
    return this.isDisabled && this.mode === 'edit';
  }

  // ── Eventos del DOM ──────────────────────────────────────────────────────

  @HostListener('click')
  _onClick(): void {
    this.cellClick.emit();
  }

  @HostListener('dblclick')
  _onDblClick(): void {
    this.cellDblClick.emit();
  }

  @HostListener('dragstart', ['$event'])
  _onDragStart(event: DragEvent): void {
    if (!this.isDraggable) return;
    event.dataTransfer?.setData('text/plain', '');
    event.dataTransfer!.effectAllowed = 'move';
    this.dragStart.emit(event);
  }

  @HostListener('dragover', ['$event'])
  _onDragOver(event: DragEvent): void {
    if (this.mode !== 'edit') return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    this.dragOver.emit(event);
  }

  @HostListener('dragleave', ['$event'])
  _onDragLeave(event: DragEvent): void {
    // Guardia: ignorar si el puntero se movió a un hijo (imagen, label).
    // event.currentTarget solo es válido aquí, durante la propagación del evento.
    const target  = event.currentTarget as HTMLElement;
    const related = event.relatedTarget  as Node | null;
    if (related && target.contains(related)) return;
    this.dragLeave.emit(event);
  }

  @HostListener('drop', ['$event'])
  _onDrop(event: DragEvent): void {
    event.preventDefault();
    if (this.mode !== 'edit') return;
    this.pgcDrop.emit(event);
  }

  @HostListener('dragend')
  _onDragEnd(): void {
    this.dragEnd.emit();
  }
}
