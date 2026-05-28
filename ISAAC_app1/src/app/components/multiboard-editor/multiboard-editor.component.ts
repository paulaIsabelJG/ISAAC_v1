import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Board } from '../../services/board.service';

export interface SlotBoardInfo {
  slotId:   number;
  boardId:  string | null;
  name:     string;
}

/**
 * Vista del editor cuando el tablero es de tipo 'multi'.
 * Muestra N huecos en el layout correcto (2 / 3 / 4) y permite:
 *   - Seleccionar un hueco para asignarle un tablero
 *   - Navegar al editor del tablero asignado
 *   - Desasignar un tablero de un hueco
 */
@Component({
  selector:    'app-multiboard-editor',
  templateUrl: './multiboard-editor.component.html',
  styleUrls:   ['./multiboard-editor.component.scss'],
  standalone:  true,
  imports:     [IonicModule, NgClass],
})
export class MultiboardEditorComponent implements OnChanges {

  /** Tablero maestro (boardRole === 'multi') con su configuración de huecos. */
  @Input() board: Board | null = null;

  /** Tableros disponibles para asignar a los huecos (solo main). */
  @Input() availableBoards: Board[] = [];

  /** ID del hueco actualmente seleccionado (para resaltarlo). */
  @Input() selectedSlotId: number | null = null;

  /** Emite el slotId cuando el usuario pulsa un hueco vacío o ya asignado. */
  @Output() slotSelected = new EventEmitter<number>();

  /** Emite cuando el usuario pulsa "Editar" en un hueco asignado. */
  @Output() editSlotBoard = new EventEmitter<string>();

  /** Emite el slotId cuando el usuario pulsa "×" para desasignar. */
  @Output() slotCleared = new EventEmitter<number>();

  slots: SlotBoardInfo[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['board'] || changes['availableBoards']) {
      this.buildSlots();
    }
  }

  private buildSlots(): void {
    if (!this.board) { this.slots = []; return; }
    const count  = this.board.slotCount ?? 2;
    const config = this.board.multiBoardSlots ?? [];

    this.slots = Array.from({ length: count }, (_, i) => {
      const slotId  = i + 1;
      const entry   = config.find((s) => s.slotId === slotId);
      const boardId = entry?.boardId ?? null;
      const name    = boardId
        ? (this.availableBoards.find((b) => b._id === boardId)?.name ?? 'Tablero desconocido')
        : '';
      return { slotId, boardId, name };
    });
  }

  onSlotClick(slotId: number): void {
    this.slotSelected.emit(slotId);
  }

  onEditBoard(boardId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.editSlotBoard.emit(boardId);
  }

  onClearSlot(slotId: number, event: MouseEvent): void {
    event.stopPropagation();
    this.slotCleared.emit(slotId);
  }

  isSelected(slotId: number): boolean {
    return this.selectedSlotId === slotId;
  }

  get layoutClass(): string {
    const count = this.board?.slotCount ?? 2;
    return `mbe-layout--${count}`;
  }
}
