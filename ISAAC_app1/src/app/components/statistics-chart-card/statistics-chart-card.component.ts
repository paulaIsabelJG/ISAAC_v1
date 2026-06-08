import { Component, Input } from '@angular/core';
import { CommonModule }      from '@angular/common';
import { IonicModule }       from '@ionic/angular';
import { NgxEchartsDirective } from 'ngx-echarts';
import type { EChartsOption }  from 'echarts';

@Component({
  selector:    'app-statistics-chart-card',
  templateUrl: './statistics-chart-card.component.html',
  styleUrls:   ['./statistics-chart-card.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule, NgxEchartsDirective],
})
export class StatisticsChartCardComponent {
  @Input() title        = '';
  @Input() subtitle     = '';
  @Input() options:       EChartsOption | null = null;
  @Input() loading        = false;
  @Input() height         = '260px';
  @Input() emptyMessage   = 'Sin datos para el período seleccionado.';

  private _echartsInstance: any = null;

  onChartInit(ec: any): void { this._echartsInstance = ec; }

  getDataUrl(): string | null {
    if (!this._echartsInstance) return null;
    try {
      return this._echartsInstance.getDataURL({
        type:            'png',
        pixelRatio:      2,
        backgroundColor: '#ffffff',
      });
    } catch { return null; }
  }
}
