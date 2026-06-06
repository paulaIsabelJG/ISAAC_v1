import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ObjectiveStatus = 'active' | 'completed' | 'cancelled';
export type ObjectiveEffectiveStatus = ObjectiveStatus | 'expired';
export type CreatedByRole = 'organization' | 'professional';

export interface ObjectiveUser {
  _id:     string;
  name:    string;
  surname?: string;
  email:   string;
  image?:  string | null;
}

export interface Objective {
  _id:                string;
  title:              string;
  description:        string;
  assignedUserIds:    ObjectiveUser[];
  familyRecipientIds: ObjectiveUser[];
  startDate:          string;   // ISO
  endDate:            string;   // ISO
  status:             ObjectiveStatus;
  effectiveStatus:    ObjectiveEffectiveStatus;
  showToFinalUser:    boolean;
  showToFamily:       boolean;
  createdBy:          ObjectiveUser & { professionalType?: string | null };
  createdByRole:      CreatedByRole;
  centro?:            string;
  commentsCount:      number;
  createdAt:          string;
  updatedAt:          string;
}

export interface CreateObjectivePayload {
  title:              string;
  description?:       string;
  assignedUserIds:    string[];
  familyRecipientIds?: string[];
  startDate:          string;
  endDate:            string;
  showToFinalUser:    boolean;
  showToFamily:       boolean;
}

export interface UpdateObjectivePayload extends Partial<CreateObjectivePayload> {}

export interface GetObjectivesParams {
  status?:  string;
  userId?:  string;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ObjectiveService {

  private readonly api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // POST /api/objectives
  createObjective(payload: CreateObjectivePayload): Observable<{ objective: Objective }> {
    return this.http.post<{ objective: Objective }>(`${this.api}/objectives`, payload);
  }

  // GET /api/objectives  — lista filtrada según rol del usuario autenticado
  getObjectives(params: GetObjectivesParams = {}): Observable<{ objectives: Objective[] }> {
    let p = new HttpParams();
    if (params.status) p = p.set('status', params.status);
    if (params.userId) p = p.set('userId', params.userId);
    return this.http.get<{ objectives: Objective[] }>(`${this.api}/objectives`, { params: p });
  }

  // GET /api/objectives/family  — objetivos visibles para el familiar autenticado
  getFamilyObjectives(): Observable<{ objectives: Objective[] }> {
    return this.http.get<{ objectives: Objective[] }>(`${this.api}/objectives/family`);
  }

  // GET /api/objectives/user/:userId  — objetivos de un usuario final
  getUserObjectives(userId: string): Observable<{ objectives: Objective[] }> {
    return this.http.get<{ objectives: Objective[] }>(`${this.api}/objectives/user/${userId}`);
  }

  // GET /api/objectives/:id
  getObjectiveById(id: string): Observable<{ objective: Objective }> {
    return this.http.get<{ objective: Objective }>(`${this.api}/objectives/${id}`);
  }

  // PUT /api/objectives/:id
  updateObjective(id: string, payload: UpdateObjectivePayload): Observable<{ objective: Objective }> {
    return this.http.put<{ objective: Objective }>(`${this.api}/objectives/${id}`, payload);
  }

  // PATCH /api/objectives/:id/status
  updateObjectiveStatus(id: string, status: ObjectiveStatus): Observable<{ objective: Objective }> {
    return this.http.patch<{ objective: Objective }>(`${this.api}/objectives/${id}/status`, { status });
  }

  // GET /api/users/families-for-users?userIds=id1,id2
  getFamiliesForUsers(userIds: string[]): Observable<{ families: ObjectiveUser[] }> {
    const params = new HttpParams().set('userIds', userIds.join(','));
    return this.http.get<{ families: ObjectiveUser[] }>(`${this.api}/users/families-for-users`, { params });
  }

  // ── Helpers de UI ──────────────────────────────────────────────────────────

  statusLabel(status: ObjectiveEffectiveStatus): string {
    const labels: Record<ObjectiveEffectiveStatus, string> = {
      active:    'Activo',
      expired:   'Vencido',
      completed: 'Completado',
      cancelled: 'Cancelado',
    };
    return labels[status] ?? status;
  }

  statusColor(status: ObjectiveEffectiveStatus): string {
    const colors: Record<ObjectiveEffectiveStatus, string> = {
      active:    'success',
      expired:   'warning',
      completed: 'primary',
      cancelled: 'medium',
    };
    return colors[status] ?? 'medium';
  }
}
