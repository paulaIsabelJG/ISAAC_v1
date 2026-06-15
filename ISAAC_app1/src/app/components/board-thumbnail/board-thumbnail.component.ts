import {
  Component,
  Input,
  OnChanges,
  AfterViewInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef,
  HostBinding,
} from '@angular/core';
import { NgStyle } from '@angular/common';
import { Board, BoardCell } from '../../services/board.service';

/**
 * Máximo de filas/columnas en la miniatura.
 * Tableros más grandes se reducen por muestreo uniforme (downsample).
 */
const MAX_GRID = 6;

export interface ThumbCell {
  bg:       string;
  imageUrl: string | null;
}

@Component({
  selector:        'app-board-thumbnail',
  templateUrl:     './board-thumbnail.component.html',
  styleUrls:       ['./board-thumbnail.component.scss'],
  standalone:       true,
  imports:         [NgStyle],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardThumbnailComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() board!: Board;
  /**
   * 'sm' → icono compacto en filas del listado (solo colores, sin imágenes)
   * 'lg' → preview grande en Recientes (colores + imágenes de pictogramas)
   */
  @Input() size: 'sm' | 'lg' = 'sm';

  @HostBinding('class.size-lg') get isLg(): boolean { return this.size === 'lg'; }

  grid:      ThumbCell[][] = [];
  rows      = 0;
  cols      = 0;
  isEmpty   = true;
  isVisible = false;

  private mounted  = false;
  private observer?: IntersectionObserver;

  constructor(
    private el:  ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(): void {
    this.computeGrid();
    if (this.mounted && !this.isEmpty && !this.isVisible) {
      // Board pasó de vacío a tener contenido mientras el componente ya estaba montado
      this.setupVisibility();
    }
  }

  ngAfterViewInit(): void {
    this.mounted = true;
    this.setupVisibility();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  // ── Lógica de visibilidad lazy ──────────────────────────────────────────────

  private setupVisibility(): void {
    // Fallbacks SVG (circular, multi, vacío): siempre visibles — son solo SVG
    if (this.isEmpty) {
      this.isVisible = true;
      this.cdr.markForCheck();
      return;
    }

    // Elemento ya cerca del viewport al montar → renderizar de inmediato
    const rect = this.el.nativeElement.getBoundingClientRect();
    if (rect.top < (window.innerHeight ?? 900) + 200) {
      this.isVisible = true;
      this.cdr.markForCheck();
      return;
    }

    // Fuera del viewport: crear IntersectionObserver para renderizar al entrar
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this.isVisible = true;
          this.cdr.markForCheck();
          this.observer?.disconnect();
          this.observer = undefined;
        }
      },
      { rootMargin: '200px 0px' }, // pre-carga 200 px antes de aparecer en pantalla
    );
    this.observer.observe(this.el.nativeElement);
  }

  // ── Cálculo de la grid ──────────────────────────────────────────────────────

  private computeGrid(): void {
    const b = this.board;
    if (!b || b.shape !== 'grid') {
      this.isEmpty = true;
      this.grid    = [];
      return;
    }

    const srcRows = b.rows    ?? 0;
    const srcCols = b.columns ?? 0;
    if (srcRows === 0 || srcCols === 0) {
      this.isEmpty = true;
      this.grid    = [];
      return;
    }

    // Tablero vacío (sin ningún pictograma): mostrar icono fallback
    const cells = b.cells ?? [];
    if (!cells.some(c => c.pictogram !== null)) {
      this.isEmpty = true;
      this.grid    = [];
      return;
    }

    // Downsample: reducir al máximo MAX_GRID×MAX_GRID con muestreo uniforme
    this.rows = Math.min(srcRows, MAX_GRID);
    this.cols = Math.min(srcCols, MAX_GRID);

    // Mapa O(cells) para búsqueda por posición sin bucles anidados
    const map = new Map<string, BoardCell>();
    for (const c of cells) map.set(`${c.row},${c.col}`, c);

    // Factores de escala: mapean coordenada de salida → coordenada fuente
    const rScale = (srcRows - 1) / Math.max(this.rows - 1, 1);
    const cScale = (srcCols - 1) / Math.max(this.cols - 1, 1);

    this.isEmpty = false;
    this.grid = Array.from({ length: this.rows }, (_, r) => {
      const srcR = Math.round(r * rScale);
      return Array.from({ length: this.cols }, (_, c) => {
        const srcC = Math.round(c * cScale);
        const cell = map.get(`${srcR},${srcC}`);
        return {
          bg:       cell?.pictogram?.color    ?? '#efefef',
          imageUrl: cell?.pictogram?.imageUrl ?? null,
        };
      });
    });
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  /** Imágenes solo en tamaño grande; en sm las celdas son demasiado pequeñas */
  get showImages(): boolean { return this.size === 'lg'; }

  get gridStyle(): Record<string, string> {
    return {
      '--thumb-cols': String(this.cols),
      '--thumb-rows': String(this.rows),
    };
  }
}
