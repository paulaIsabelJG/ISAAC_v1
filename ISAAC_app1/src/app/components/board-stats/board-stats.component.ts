import {
  Component, Input, OnChanges, SimpleChanges,
  ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { IonicModule }  from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import {
  AacStatisticsService, BoardStat, StatsFilters,
} from '../../services/aac-statistics.service';

function calcRate(b: BoardStat): number {
  return b.interactions > 0 ? Math.round(b.phrases / b.interactions * 100) : 0;
}

function calcBadge(rate: number): { label: string; color: 'success' | 'warning' | 'danger' } {
  if (rate >= 40) return { label: 'Efectivo',         color: 'success' };
  if (rate >= 1)  return { label: 'Poco efectivo',    color: 'warning' };
  return               { label: 'Sin comunicación', color: 'danger'  };
}

function calcInsight(b: BoardStat): { type: 'ok' | 'warn' | 'alert'; text: string } {
  const rate   = b.interactions > 0 ? b.phrases   / b.interactions : 0;
  const navPct = b.interactions > 0 ? b.navActions / b.interactions : 0;
  if (rate >= 0.4) return {
    type: 'ok',
    text: `Alta efectividad: ${Math.round(rate * 100)}% de las visitas generan una frase. El uso de voz es especialmente alto, señal de autonomía comunicativa.`,
  };
  if (b.interactions === 0) return {
    type: 'alert',
    text: 'Este tablero no ha recibido ninguna interacción en el período seleccionado.',
  };
  if (b.phrases === 0 && b.voiceActions === 0 && navPct > 0.7) return {
    type: 'warn',
    text: 'Tablero de tránsito: casi todo el uso es navegación hacia otros tableros. Normal si es un menú intermedio, pero si se espera comunicación directa aquí, revisar el contenido.',
  };
  if (b.phrases === 0) return {
    type: 'alert',
    text: 'Ninguna interacción ha derivado en frase ni voz. Puede estar infrautilizado o ser difícil de encontrar desde otros tableros.',
  };
  return {
    type: 'warn',
    text: `Uso moderado con baja efectividad (${Math.round(rate * 100)}%). Con mucha navegación, el usuario puede no encontrar fácilmente lo que busca.`,
  };
}

@Component({
  selector:    'app-board-stats',
  templateUrl: './board-stats.component.html',
  styleUrls:   ['./board-stats.component.scss'],
  standalone:  true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, IonicModule],
})
export class BoardStatsComponent implements OnChanges {
  @Input() filters: StatsFilters = {};

  boards:        BoardStat[]    = [];
  selectedBoard: BoardStat | null = null;
  loading    = false;
  error      = false;
  searchTerm = '';

  get filteredBoards(): BoardStat[] {
    const term = this.searchTerm.toLowerCase().trim();
    if (!term) return this.boards;
    return this.boards.filter(b =>
      (b.name   ?? '').toLowerCase().includes(term) ||
      b.boardId.toLowerCase().includes(term)
    );
  }

  onSearch(): void {
    if (this.selectedBoard && !this.filteredBoards.some(b => b.boardId === this.selectedBoard!.boardId)) {
      this.selectedBoard = this.filteredBoards[0] ?? null;
    }
    this.cdr.markForCheck();
  }

  constructor(
    private statsSvc: AacStatisticsService,
    private cdr:      ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['filters']) {
      void this.reload();
    }
  }

  async reload(): Promise<void> {
    this.loading = true;
    this.error   = false;
    this.cdr.markForCheck();
    try {
      const res = await firstValueFrom(this.statsSvc.getOrganizationBoards(this.filters));
      this.boards        = res.boards;
      this.selectedBoard = this.boards[0] ?? null;
    } catch {
      this.error  = true;
      this.boards = [];
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  selectBoard(b: BoardStat): void {
    this.selectedBoard = b;
    this.cdr.markForCheck();
  }

  getRate(b: BoardStat):  number  { return calcRate(b); }
  getBadge(b: BoardStat)          { return calcBadge(calcRate(b)); }
  getInsight(b: BoardStat)        { return calcInsight(b); }

  boardShapeLabel(b: BoardStat): string {
    if (b.boardRole === 'main')      return 'Principal';
    if (b.boardRole === 'secondary') return 'Secundario';
    if (b.shape === 'multi')         return 'Multitablero';
    if (b.shape === 'circular')      return 'Circular';
    return 'Cuadrícula';
  }

  insightIcon(type: 'ok' | 'warn' | 'alert'): string {
    if (type === 'ok')    return 'checkmark-circle-outline';
    if (type === 'warn')  return 'alert-circle-outline';
    return 'close-circle-outline';
  }

  // ── Getters de detalle ────────────────────────────────────────────────────

  get detailRate(): number {
    return this.selectedBoard ? calcRate(this.selectedBoard) : 0;
  }

  get detailBadge() {
    return calcBadge(this.detailRate);
  }

  get phrasesPct(): number {
    const b = this.selectedBoard;
    if (!b || b.interactions === 0) return 0;
    return Math.round(b.phrases / b.interactions * 100);
  }

  get voicePct(): number {
    const b = this.selectedBoard;
    if (!b || b.interactions === 0) return 0;
    return Math.round(b.voiceActions / b.interactions * 100);
  }

  get navPct(): number {
    const b = this.selectedBoard;
    if (!b || b.interactions === 0) return 0;
    return Math.round(b.navActions / b.interactions * 100);
  }

  get otherPct(): number {
    return Math.max(0, 100 - this.phrasesPct - this.navPct);
  }
}
