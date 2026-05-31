import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface BackendUser {
  _id:     string;
  name:    string;
  email:   string;
  type:    'teacher' | 'parent' | 'user';
  image?:  string | null;
  centro?: string | null;
  gender?: string | null;   // usado para info básica en tabla de familiar
}

/** Permisos propios del usuario final (lo que puede ver al loguearse como él mismo) */
export interface SelfPermissions {
  canEditPersonalData:    boolean;
  canEditBoards:          boolean;
  canViewStats:           boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
}

/** Usuario completo devuelto por GET /api/users/:userId */
export interface FullBackendUser {
  _id:     string;
  name:    string;
  email:   string;
  type:    'teacher' | 'parent' | 'user';
  image?:  string | null;
  centro?: string | null;
  gender?: string | null;
  age?:    number | null;
  selfPermissions?: SelfPermissions;
  assignedProfessionals?: Array<{
    professionalId:         string;
    canViewStats:           boolean;
    canEditBoards:          boolean;
    canEditPersonalData:    boolean;
    canAddPictograms:       boolean;
    canAssignProfessionals: boolean;
    canAssignFamilies:      boolean;
    canViewAssignedBoards:  boolean;
  }>;
  childrenAccess?: Array<{
    childId:                string;
    canViewStats:           boolean;
    canEditBoards:          boolean;
    canEditPersonalData:    boolean;
    canAddPictograms:       boolean;
    canAssignProfessionals: boolean;
    canAssignFamilies:      boolean;
    canViewAssignedBoards:  boolean;
  }>;
}

/** Payload para actualizar datos personales de un usuario final */
export interface UpdateUserPayload {
  name?:             string;
  email?:            string;
  password?:         string;
  gender?:           string;
  age?:              number | null;
  image?:            string | null;
  selfPermissions?:  SelfPermissions;
}

// ─── childrenAccess ───────────────────────────────────────────────────────────

/** Entrada que se envía al PUT children-access */
export interface ChildrenAccessEntry {
  childId:                string;
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
}

export interface BackendPictogram {
  _id?:         string;
  id:           string;
  label:        string;
  imageUrl:     string;
  wordType?:    string;
  description?: string;
  createdAt?:   string;
}

export type AddPictogramPayload = {
  id:           string;
  label:        string;
  imageUrl:     string;
  wordType?:    string;
  description?: string;
};

// ─── Profesionales asignados ──────────────────────────────────────────────────

/** Entrada que devuelve el GET (profesional populado + permisos) */
export interface AssignedProfessionalEntry {
  professionalId:         string;
  name:                   string;
  surname:                string;
  email:                  string;
  image?:                 string | null;
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
}

/** Entrada que envía el PUT (solo ids + permisos) */
export interface AssignedProfessionalPayload {
  professionalId:         string;
  canViewStats:           boolean;
  canEditBoards:          boolean;
  canEditPersonalData:    boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
}

/** Usuario final asignado a un profesional (devuelto por GET /:professionalId/assigned-users) */
export interface AssignedUserEntry {
  userId:                 string;
  name:                   string;
  surname:                string;
  email:                  string;
  image?:                 string | null;
  canEditPersonalData:    boolean;
  canEditBoards:          boolean;
  canViewStats:           boolean;
  canAddPictograms:       boolean;
  canAssignProfessionals: boolean;
  canAssignFamilies:      boolean;
  canViewAssignedBoards:  boolean;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly url = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  // ── Usuario por ID ───────────────────────────────────────────────────────────

  /** GET /api/users/:userId  —  devuelve el usuario completo con assignedProfessionals y childrenAccess */
  getUserById(userId: string): Observable<{ user: FullBackendUser }> {
    return this.http.get<{ user: FullBackendUser }>(
      `${this.url}/${encodeURIComponent(userId)}`
    );
  }

  /** PATCH /api/users/:userId  —  actualiza datos personales del usuario final */
  updateUserById(
    userId:  string,
    payload: UpdateUserPayload
  ): Observable<{ user: FullBackendUser }> {
    return this.http.patch<{ user: FullBackendUser }>(
      `${this.url}/${encodeURIComponent(userId)}`,
      payload
    );
  }

  // ── Usuarios por centro ──────────────────────────────────────────────────────
  getUsersByCenter(centro: string): Observable<{ users: BackendUser[] }> {
    return this.http.get<{ users: BackendUser[] }>(
      `${this.url}/centro/${encodeURIComponent(centro)}`
    );
  }

  // ── Pictogramas personalizados de un usuario ─────────────────────────────────

  /** GET /api/users/:userId/pictograms */
  getPictogramsByUserId(userId: string): Observable<{ pictograms: BackendPictogram[] }> {
    return this.http.get<{ pictograms: BackendPictogram[] }>(
      `${this.url}/${encodeURIComponent(userId)}/pictograms`
    );
  }

  /** POST /api/users/:userId/pictograms */
  addPictogramToUser(
    userId:  string,
    payload: AddPictogramPayload
  ): Observable<{ message: string; pictogram: BackendPictogram }> {
    return this.http.post<{ message: string; pictogram: BackendPictogram }>(
      `${this.url}/${encodeURIComponent(userId)}/pictograms`,
      payload
    );
  }

  /** DELETE /api/users/:userId/pictograms/:pictogramId */
  deletePictogramFromUser(
    userId:       string,
    pictogramId:  string
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.url}/${encodeURIComponent(userId)}/pictograms/${encodeURIComponent(pictogramId)}`
    );
  }

  // ── childrenAccess ─────────────────────────────────────────────────────────

  /** PUT /api/users/:parentId/children-access */
  updateChildrenAccess(
    parentId: string,
    entries:  ChildrenAccessEntry[]
  ): Observable<{ message: string; count: number }> {
    return this.http.put<{ message: string; count: number }>(
      `${this.url}/${encodeURIComponent(parentId)}/children-access`,
      { childrenAccess: entries }
    );
  }

  // ── Profesionales asignados ────────────────────────────────────────────────

  /** GET /api/users/:userId/assigned-professionals */
  getAssignedProfessionals(
    userId: string
  ): Observable<{ assignedProfessionals: AssignedProfessionalEntry[] }> {
    return this.http.get<{ assignedProfessionals: AssignedProfessionalEntry[] }>(
      `${this.url}/${encodeURIComponent(userId)}/assigned-professionals`
    );
  }

  /** GET /api/users/:professionalId/assigned-users */
  getAssignedUsers(
    professionalId: string
  ): Observable<{ users: AssignedUserEntry[] }> {
    return this.http.get<{ users: AssignedUserEntry[] }>(
      `${this.url}/${encodeURIComponent(professionalId)}/assigned-users`
    );
  }

  /** PUT /api/users/:userId/assigned-professionals */
  updateAssignedProfessionals(
    userId:      string,
    assignments: AssignedProfessionalPayload[]
  ): Observable<{ message: string; count: number }> {
    return this.http.put<{ message: string; count: number }>(
      `${this.url}/${encodeURIComponent(userId)}/assigned-professionals`,
      { assignedProfessionals: assignments }
    );
  }
}
