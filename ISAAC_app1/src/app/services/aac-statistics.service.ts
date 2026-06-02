import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ─── Tipos de respuesta ───────────────────────────────────────────────────────

export interface OrgSummary {
  totalFinalUsers:          number;
  totalProfessionals:       number;
  totalParents:             number;
  totalSessions:            number;
  totalInteractions:        number;
  totalPhrases:             number;
  avgInteractionsPerPhrase: number;
  avgSessionDurationMs:     number;
  avgSessionDurationLabel:  string;
}

export interface RoleStat {
  role:              'user' | 'professional' | 'parent';
  totalUsers:        number;
  totalSessions:     number;
  totalInteractions: number;
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface OrgCharts {
  topPictograms:      ChartPoint[];
  topBoards:          ChartPoint[];
  actionDistribution: ChartPoint[];
  interactionsByDay:  ChartPoint[];
  phrasesByDay:       ChartPoint[];
  userActivity:       ChartPoint[];
}

export interface BoardStat {
  boardId:      string;
  name?:        string;
  shape?:       string | null;
  boardRole?:   string | null;
  interactions: number;
  phrases:      number;
  voiceActions: number;
  navActions:   number;
}

export interface PhraseInteraction {
  type:                'button' | 'action';
  label:               string;
  imageUrl?:           string | null;
  boardId?:            string | null;
  buttonId?:           string | null;
  timestamp:           string;
  activeInFinalPhrase: boolean;
  removedByAction?:    'backspace' | 'clear' | null;
  isSystemAction?:     boolean;
  actionType?:         string;
  spoken?:             boolean;
  /** Color Fitzgerald del pictograma (hex). Null si no fue guardado en el evento OBL. */
  color?:              string | null;
  wordType?:           string | null;
}

export interface ReconstructedPhrase {
  phraseId:     string;
  sessionId:    string;
  userId:       string;
  userName:     string;
  finalText:    string;
  startedAt:    string;
  endedAt:      string;
  durationMs:   number;
  interactions: PhraseInteraction[];
  /** Texto reformulado por IA. Presente solo si el usuario aceptó la sugerencia IA. */
  aiReformulatedText?: string | null;
}

export interface PhrasesPage {
  phrases:    ReconstructedPhrase[];
  totalCount: number;
  page:       number;
  pageSize:   number;
}

export interface UserStats {
  user: { _id: string; name: string; email: string; type: string };
  totalSessions:            number;
  totalInteractions:        number;
  totalPhrases:             number;
  avgInteractionsPerPhrase: number;
  avgSessionDurationMs:     number;
  avgSessionDurationLabel:  string;
  topPictograms:            Array<{ label: string; imageUrl: string | null; count: number }>;
  topBoards:                Array<{ boardId: string; count: number }>;
  actionDistribution:       { voice: number; navigate: number; setSlot: number; other: number };
  interactionsByDay:        Array<{ date: string; count: number }>;
}

/** Ámbito de las estadísticas (qué tipo de usuarios incluir). */
export type StatsScope = 'all' | 'users' | 'professionals' | 'families';

export interface StatsFilters {
  from?:     string;
  to?:       string;
  scope?:    StatsScope;
  page?:     number;
  pageSize?: number;
}

export interface OblaExportParams {
  dateFilter:    'all' | 'today' | '7days' | '30days' | 'custom';
  dateFrom?:     string;
  dateTo?:       string;
  boardId?:      string;
  exportScope:   'userType' | 'family' | 'user';
  userType?:     'user' | 'professional' | 'parent';
  familyUserId?: string;
  userId?:       string;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class AacStatisticsService {

  private readonly base = `${environment.apiUrl}/aac-statistics`;

  constructor(private http: HttpClient) {}

  private params(filters?: StatsFilters): HttpParams {
    let p = new HttpParams();
    if (filters?.from)     p = p.set('from',     filters.from);
    if (filters?.to)       p = p.set('to',       filters.to);
    if (filters?.scope && filters.scope !== 'all')
                           p = p.set('scope',    filters.scope);
    if (filters?.page)     p = p.set('page',     String(filters.page));
    if (filters?.pageSize) p = p.set('pageSize', String(filters.pageSize));
    return p;
  }

  getOrganizationSummary(filters?: StatsFilters): Observable<OrgSummary> {
    return this.http.get<OrgSummary>(
      `${this.base}/organization/summary`, { params: this.params(filters) }
    );
  }

  getStatsByUserType(filters?: StatsFilters): Observable<{ byRole: RoleStat[] }> {
    return this.http.get<{ byRole: RoleStat[] }>(
      `${this.base}/organization/by-role`, { params: this.params(filters) }
    );
  }

  getOrganizationCharts(filters?: StatsFilters): Observable<OrgCharts> {
    return this.http.get<OrgCharts>(
      `${this.base}/organization/charts`, { params: this.params(filters) }
    );
  }

  getOrganizationBoards(filters?: StatsFilters): Observable<{ boards: BoardStat[] }> {
    return this.http.get<{ boards: BoardStat[] }>(
      `${this.base}/organization/boards`, { params: this.params(filters) }
    );
  }

  getOrganizationPhrases(filters?: StatsFilters): Observable<PhrasesPage> {
    return this.http.get<PhrasesPage>(
      `${this.base}/organization/phrases`, { params: this.params(filters) }
    );
  }

  getUserStatistics(userId: string, filters?: StatsFilters): Observable<UserStats> {
    return this.http.get<UserStats>(
      `${this.base}/users/${encodeURIComponent(userId)}/summary`,
      { params: this.params(filters) }
    );
  }

  getUserPhrases(userId: string, filters?: StatsFilters): Observable<PhrasesPage> {
    return this.http.get<PhrasesPage>(
      `${this.base}/users/${encodeURIComponent(userId)}/phrases`,
      { params: this.params(filters) }
    );
  }

  deletePhrase(phraseId: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(
      `${this.base}/phrases/${encodeURIComponent(phraseId)}`
    );
  }

  exportObla(params: OblaExportParams): Observable<Blob> {
    return this.http.post(
      `${this.base}/export/obla`,
      params,
      { responseType: 'blob' }
    );
  }
}
