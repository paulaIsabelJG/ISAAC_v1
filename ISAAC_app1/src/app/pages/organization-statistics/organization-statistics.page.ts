import { Component, OnInit } from '@angular/core';
import { IonicModule }       from '@ionic/angular';
import { CommonModule }      from '@angular/common';
import { FormsModule }       from '@angular/forms';
import { Router }            from '@angular/router';
import { firstValueFrom }    from 'rxjs';
import type { EChartsOption } from 'echarts';

import { AuthService }       from '../../services/auth.service';
import { UserService, BackendUser } from '../../services/user.service';
import {
  AacStatisticsService,
  OrgSummary, OrgCharts, BoardStat, PhrasesPage,
  ReconstructedPhrase, StatsFilters, StatsScope, ChartPoint,
} from '../../services/aac-statistics.service';
import { StatisticsSummaryCardsComponent } from '../../components/statistics-summary-cards/statistics-summary-cards.component';
import { StatisticsChartCardComponent }    from '../../components/statistics-chart-card/statistics-chart-card.component';
import { PhraseLogCardComponent }          from '../../components/phrase-log-card/phrase-log-card.component';

export type DashSection = 'resumen' | 'tableros' | 'frases';

@Component({
  selector:    'app-organization-statistics',
  templateUrl: './organization-statistics.page.html',
  styleUrls:   ['./organization-statistics.page.scss'],
  standalone:  true,
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    StatisticsSummaryCardsComponent,
    StatisticsChartCardComponent,
    PhraseLogCardComponent,
  ],
})
export class OrganizationStatisticsPage implements OnInit {

  // ── Nombre de organización ────────────────────────────────────────────────
  orgName = '';

  // ── Sección activa del dashboard ─────────────────────────────────────────
  activeSection: DashSection = 'resumen';

  // ── Filtros ───────────────────────────────────────────────────────────────
  filterFrom  = '';
  filterTo    = '';
  filterScope: StatsScope = 'all';

  // ── Selector de usuario ───────────────────────────────────────────────────
  allFinalUsers:  BackendUser[] = [];
  selectedUserId = '';

  // ── Datos org ─────────────────────────────────────────────────────────────
  summary:       OrgSummary | null = null;
  charts:        OrgCharts  | null = null;
  boards:        BoardStat[]       = [];
  orgPhrases:    ReconstructedPhrase[] = [];
  orgTotalPhrases = 0;
  orgPage         = 1;
  readonly orgPageSize = 20;

  // ── Datos usuario seleccionado ────────────────────────────────────────────
  userPhrases:     ReconstructedPhrase[] = [];
  userTotalPhrases = 0;
  userPage         = 1;
  readonly userPageSize = 20;

  // ── Opciones ECharts (calculadas al cargar charts) ────────────────────────
  temporalChartOpts:    EChartsOption | null = null;
  topPictogramsOpts:    EChartsOption | null = null;
  actionDistOpts:       EChartsOption | null = null;
  userActivityOpts:     EChartsOption | null = null;
  topBoardsChartOpts:   EChartsOption | null = null;

  // ── Estado ────────────────────────────────────────────────────────────────
  loadingSummary = false;
  loadingCharts  = false;
  loadingBoards  = false;
  loadingPhrases = false;
  loadingUser    = false;
  errorMsg       = '';

  readonly scopeOptions: Array<{ value: StatsScope; label: string }> = [
    { value: 'all',           label: 'Toda la organización' },
    { value: 'users',         label: 'Usuarios finales'     },
    { value: 'professionals', label: 'Profesionales'        },
    { value: 'families',      label: 'Familiares'           },
  ];

  private readonly actionLabelMap: Record<string, string> = {
    ':speak':      'Hablar',
    ':backspace':  'Borrar',
    ':clear':      'Limpiar',
    ':open_board': 'Navegar',
    ':back':       'Atrás',
    ':home':       'Inicio',
  };

  constructor(
    private router:   Router,
    private authSvc:  AuthService,
    private userSvc:  UserService,
    private statsSvc: AacStatisticsService,
  ) {}

  ngOnInit(): void {
    this.orgName = this.authSvc.getCurrentUser()?.name || 'Organización';
    this.loadAll();
    this.loadUserList();
  }

  // ── Filtros ───────────────────────────────────────────────────────────────

  private filters(): StatsFilters {
    return {
      from:  this.filterFrom || undefined,
      to:    this.filterTo   || undefined,
      scope: this.filterScope,
    };
  }

  applyFilters(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loadSummary();
    this.loadCharts();
    this.loadBoardStats();
    this.loadOrgPhrases(1);
  }

  // ── Carga de datos ────────────────────────────────────────────────────────

  private async loadSummary(): Promise<void> {
    this.loadingSummary = true;
    this.errorMsg = '';
    try {
      this.summary = await firstValueFrom(this.statsSvc.getOrganizationSummary(this.filters()));
    } catch (e: any) {
      this.errorMsg = e?.error?.error || 'Error al cargar resumen.';
    } finally {
      this.loadingSummary = false;
    }
  }

  private async loadCharts(): Promise<void> {
    this.loadingCharts = true;
    try {
      this.charts = await firstValueFrom(this.statsSvc.getOrganizationCharts(this.filters()));
      this.buildAllChartOptions();
    } catch {
      this.temporalChartOpts  = null;
      this.topPictogramsOpts  = null;
      this.actionDistOpts     = null;
      this.userActivityOpts   = null;
      this.topBoardsChartOpts = null;
    } finally {
      this.loadingCharts = false;
    }
  }

  private async loadBoardStats(): Promise<void> {
    this.loadingBoards = true;
    try {
      const res = await firstValueFrom(this.statsSvc.getOrganizationBoards(this.filters()));
      this.boards = res.boards;
    } catch { this.boards = []; }
    finally { this.loadingBoards = false; }
  }

  async loadOrgPhrases(page: number): Promise<void> {
    this.loadingPhrases = true;
    this.orgPage = page;
    try {
      const res: PhrasesPage = await firstValueFrom(
        this.statsSvc.getOrganizationPhrases({ ...this.filters(), page, pageSize: this.orgPageSize })
      );
      this.orgPhrases      = res.phrases;
      this.orgTotalPhrases = res.totalCount;
    } catch { /* silencioso */ }
    finally { this.loadingPhrases = false; }
  }

  private async loadUserList(): Promise<void> {
    const user = this.authSvc.getCurrentUser();
    if (!user?.centro) return;
    try {
      const res = await firstValueFrom(this.userSvc.getUsersByCenter(user.centro));
      this.allFinalUsers = res.users.filter(u => u.type === 'user');
    } catch { /* silencioso */ }
  }

  async onUserSelected(): Promise<void> {
    if (!this.selectedUserId) {
      this.userPhrases      = [];
      this.userTotalPhrases = 0;
      return;
    }
    await this.loadUserPhrases(1);
  }

  async loadUserPhrases(page: number): Promise<void> {
    if (!this.selectedUserId) return;
    this.loadingUser = true;
    this.userPage = page;
    try {
      const res: PhrasesPage = await firstValueFrom(
        this.statsSvc.getUserPhrases(this.selectedUserId, { ...this.filters(), page, pageSize: this.userPageSize })
      );
      this.userPhrases      = res.phrases;
      this.userTotalPhrases = res.totalCount;
    } catch { /* silencioso */ }
    finally { this.loadingUser = false; }
  }

  // ── Paginación ────────────────────────────────────────────────────────────

  get orgTotalPages():  number { return Math.ceil(this.orgTotalPhrases  / this.orgPageSize)  || 1; }
  get userTotalPages(): number { return Math.ceil(this.userTotalPhrases / this.userPageSize) || 1; }

  onOrgPrevPage():  void { if (this.orgPage  > 1) this.loadOrgPhrases(this.orgPage  - 1); }
  onOrgNextPage():  void { if (this.orgPage  < this.orgTotalPages)  this.loadOrgPhrases(this.orgPage  + 1); }
  onUserPrevPage(): void { if (this.userPage > 1) this.loadUserPhrases(this.userPage - 1); }
  onUserNextPage(): void { if (this.userPage < this.userTotalPages) this.loadUserPhrases(this.userPage + 1); }

  // ── Helpers de vista ──────────────────────────────────────────────────────

  boardShapeLabel(b: BoardStat): string {
    if (b.boardRole === 'main')      return 'Principal';
    if (b.boardRole === 'secondary') return 'Secundario';
    if (b.shape === 'multi')         return 'Multitablero';
    if (b.shape === 'circular')      return 'Circular';
    return 'Cuadrícula';
  }

  get scopeLabel(): string {
    return this.scopeOptions.find(o => o.value === this.filterScope)?.label ?? 'Toda la organización';
  }

  get isLoading(): boolean {
    return this.loadingSummary || this.loadingCharts || this.loadingBoards || this.loadingPhrases;
  }

  // ── Navegación ────────────────────────────────────────────────────────────

  goBack(): void { this.router.navigate(['/organization-dashboard']); }

  // ── Constructores de opciones ECharts ────────────────────────────────────

  private buildAllChartOptions(): void {
    this.temporalChartOpts  = this.buildTemporalChart();
    this.topPictogramsOpts  = this.buildHBarChart(this.charts?.topPictograms, '#4a9eff');
    this.actionDistOpts     = this.buildDonutChart(this.charts?.actionDistribution);
    this.userActivityOpts   = this.buildVBarChart(this.charts?.userActivity, '#ff69b4');
    this.topBoardsChartOpts = this.buildHBarChart(this.charts?.topBoards, '#20c997');
  }

  private buildTemporalChart(): EChartsOption | null {
    const data    = this.charts?.interactionsByDay;
    const phrases = this.charts?.phrasesByDay;
    if (!data?.length) return null;

    const series: EChartsOption['series'] = [{
      name:      'Interacciones',
      type:      'line',
      smooth:    true,
      data:      data.map(d => d.value),
      areaStyle: { color: 'rgba(124,77,255,0.1)' },
      lineStyle: { color: '#7c4dff', width: 2.5 },
      itemStyle: { color: '#7c4dff' },
      symbol:    'circle',
      symbolSize: 5,
    }];

    if (phrases?.length) {
      // Alinear valores de frases con los días del eje X de interacciones
      const phraseMap = new Map(phrases.map(p => [p.label, p.value]));
      series.push({
        name:      'Frases',
        type:      'line',
        smooth:    true,
        data:      data.map(d => phraseMap.get(d.label) ?? 0),
        lineStyle: { color: '#20c997', width: 2 },
        itemStyle: { color: '#20c997' },
        symbol:    'circle',
        symbolSize: 4,
      });
    }

    const hasLegend = Array.isArray(series) && series.length > 1;

    return {
      tooltip: { trigger: 'axis' },
      legend:  hasLegend ? { top: 0, right: 4, textStyle: { fontSize: 10, color: '#4a3f55' } } : undefined,
      grid:    { top: hasLegend ? 28 : 12, right: 12, bottom: 44, left: 36 },
      xAxis:   {
        type:      'category',
        data:      data.map(d => d.label),
        axisLabel: { fontSize: 9, rotate: 35, color: '#8b7490' },
        axisLine:  { lineStyle: { color: '#f0d8ea' } },
        axisTick:  { show: false },
      },
      yAxis: {
        type:       'value',
        minInterval: 1,
        axisLabel:  { fontSize: 10, color: '#8b7490' },
        splitLine:  { lineStyle: { color: '#f5eff8' } },
      },
      series,
    };
  }

  private buildHBarChart(data: ChartPoint[] | undefined, color: string): EChartsOption | null {
    if (!data?.length) return null;
    const sorted = [...data].sort((a, b) => a.value - b.value);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid:    { top: 8, right: 44, bottom: 8, left: 8, containLabel: true },
      xAxis:   {
        type:       'value',
        minInterval: 1,
        axisLabel:  { fontSize: 10, color: '#8b7490' },
        splitLine:  { lineStyle: { color: '#f5eff8' } },
        axisLine:   { show: false },
      },
      yAxis: {
        type:      'category',
        data:      sorted.map(d => d.label),
        axisLabel: { fontSize: 10, color: '#4a3f55', width: 90, overflow: 'truncate' },
        axisLine:  { lineStyle: { color: '#f0d8ea' } },
        axisTick:  { show: false },
      },
      series: [{
        type:       'bar',
        data:       sorted.map(d => d.value),
        barMaxWidth: 18,
        itemStyle:  { color, borderRadius: [0, 4, 4, 0] },
        label:      { show: true, position: 'right', fontSize: 10, color: '#8b7490' },
      }],
    };
  }

  private buildDonutChart(data: ChartPoint[] | undefined): EChartsOption | null {
    if (!data?.length) return null;
    const palette = ['#7c4dff', '#4a9eff', '#ff8c42', '#ff69b4', '#20c997', '#b39ddb'];
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend:  {
        bottom:    4,
        type:      'scroll',
        textStyle: { fontSize: 10, color: '#4a3f55' },
        icon:      'circle',
      },
      series: [{
        type:   'pie',
        radius: ['38%', '64%'],
        center: ['50%', '44%'],
        data:   data.map((d, i) => ({
          name:      this.actionLabelMap[d.label] || d.label,
          value:     d.value,
          itemStyle: { color: palette[i % palette.length] },
        })),
        label:     { show: false },
        emphasis:  { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.1)' } },
      }],
    };
  }

  private buildVBarChart(data: ChartPoint[] | undefined, color: string): EChartsOption | null {
    if (!data?.length) return null;
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid:    { top: 12, right: 12, bottom: 56, left: 36 },
      xAxis:   {
        type:      'category',
        data:      data.map(d => d.label),
        axisLabel: { fontSize: 9, rotate: 30, color: '#4a3f55', width: 80, overflow: 'truncate' },
        axisLine:  { lineStyle: { color: '#f0d8ea' } },
        axisTick:  { show: false },
      },
      yAxis: {
        type:       'value',
        minInterval: 1,
        axisLabel:  { fontSize: 10, color: '#8b7490' },
        splitLine:  { lineStyle: { color: '#f5eff8' } },
      },
      series: [{
        type:       'bar',
        data:       data.map(d => d.value),
        barMaxWidth: 28,
        itemStyle:  { color, borderRadius: [4, 4, 0, 0] },
      }],
    };
  }
}
