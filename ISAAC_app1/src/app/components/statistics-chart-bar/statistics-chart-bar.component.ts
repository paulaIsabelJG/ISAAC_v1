import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule }  from '@angular/common';
import { ChartPoint }    from '../../services/aac-statistics.service';

/**
 * Gráfica de barras horizontales implementada en CSS puro.
 * No requiere ninguna librería externa.
 *
 * Se estructura para ser fácilmente sustituida por Chart.js o similar
 * cuando se quiera, ya que los datos entran como ChartPoint[].
 */
@Component({
  selector:    'app-statistics-chart-bar',
  templateUrl: './statistics-chart-bar.component.html',
  styleUrls:   ['./statistics-chart-bar.component.scss'],
  standalone:  true,
  imports:     [CommonModule],
})
export class StatisticsChartBarComponent implements OnChanges {
  @Input() title     = '';
  @Input() data:    ChartPoint[] = [];
  @Input() color    = '#7c4dff';
  @Input() maxItems = 10;
  @Input() emptyText = 'Sin datos todavía';

  displayData: Array<ChartPoint & { pct: number }> = [];

  ngOnChanges(): void {
    const sliced = (this.data || []).slice(0, this.maxItems);
    const max    = sliced.reduce((m, d) => Math.max(m, d.value), 0);
    this.displayData = sliced.map(d => ({
      ...d,
      pct: max > 0 ? Math.round((d.value / max) * 100) : 0,
    }));
  }
}
