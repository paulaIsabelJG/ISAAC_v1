import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface BackendUser {
  _id:      string;
  name:     string;
  surname?: string;
  email:    string;
  type:    'teacher' | 'parent' | 'user';
  image?:  string | null;
  centro?: string | null;
  gender?: string | null;
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
  _id:      string;
  name:     string;
  /** Apellidos almacenados como campo separado. undefined = usuario legacy (sin migrar). */
  surname?: string;
  email:    string;
  type:    'teacher' | 'parent' | 'user';
  image?:  string | null;
  centro?: string | null;
  gender?:  string | null;
  age?:     number | null;
  address?: string | null;
  selfPermissions?:  SelfPermissions;
  voiceSettings?:    VoiceSettings;
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

/** @deprecated Usar VoiceSettings. Mantenido para retrocompatibilidad. */
export interface TtsConfig {
  soundEnabled:  boolean;
  voiceName:     string;
  voiceLang:     string;
  voiceURI:      string;
  speechRate?:   number;
  speechPitch?:  number;
  speechVolume?: number;
}

// ─── Voice Settings (nuevo esquema) ──────────────────────────────────────────

export interface CatalogVoice {
  voiceName?:    string;
  voiceLang?:    string;
  voiceURI?:     string;
  speechRate?:   number;
  speechPitch?:  number;
  speechVolume?: number;
}

export interface CustomVoiceInfo {
  enabled:             boolean;
  provider:            'openvoice';
  status:              'disabled' | 'sample_uploaded' | 'processing' | 'ready' | 'error';
  referenceAudioPath?: string | null;
  speakerProfilePath?: string | null;
  consentAccepted:     boolean;
  consentAcceptedAt?:  string | null;
  sampleUploadedAt?:   string | null;
  voiceCreatedAt?:     string | null;
  lastError?:          string | null;
}

export interface VoiceSettings {
  soundEnabled: boolean;
  voiceMode:    'catalog' | 'custom';
  catalogVoice?: CatalogVoice;
  customVoice?:  CustomVoiceInfo;
}

/** Payload para actualizar datos personales de un usuario final */
export interface UpdateUserPayload {
  name?:             string;
  surname?:          string;
  email?:            string;
  password?:         string;
  gender?:           string;
  age?:              number | null;
  address?:          string | null;
  image?:            string | null;
  selfPermissions?:  SelfPermissions;
  voiceSettings?:    VoiceSettings;
  /** @deprecated usar voiceSettings */
  ttsConfig?:        TtsConfig;
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
  private readonly url      = `${environment.apiUrl}/users`;
  private readonly voiceUrl = `${environment.apiUrl}/voice`;

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

  // ── Voz personalizada ──────────────────────────────────────────────────────
  // @deprecated Usa VoiceService (voice.service.ts) para llamadas de voz.
  // Estos métodos se mantienen por compatibilidad con código existente.

  /** @deprecated Usa VoiceService.uploadSample() */
  uploadVoiceSample(
    userId:          string,
    audioDataUrl:    string,
    consentAccepted: boolean,
    consentText:     string
  ): Observable<{ message: string; status: string }> {
    return this.http.post<{ message: string; status: string }>(
      `${this.voiceUrl}/${encodeURIComponent(userId)}/sample`,
      { audioDataUrl, consentAccepted, consentText }
    );
  }

  /** @deprecated Usa VoiceService.createVoice() */
  createVoice(userId: string): Observable<{ message: string; status: string }> {
    return this.http.post<{ message: string; status: string }>(
      `${this.voiceUrl}/${encodeURIComponent(userId)}/create`,
      {}
    );
  }

  /** @deprecated Usa VoiceService.getStatus() */
  getVoiceStatus(userId: string): Observable<{ voiceSettings: VoiceSettings }> {
    return this.http.get<{ voiceSettings: VoiceSettings }>(
      `${this.voiceUrl}/${encodeURIComponent(userId)}/status`
    );
  }

  /** @deprecated Usa VoiceService.deleteCustomVoice() */
  deleteCustomVoice(userId: string): Observable<{ message: string; status: string }> {
    return this.http.delete<{ message: string; status: string }>(
      `${this.voiceUrl}/${encodeURIComponent(userId)}/custom`
    );
  }

  /** @deprecated Usa VoiceService.generateAudio() */
  speakCustom(userId: string, text: string): Observable<Blob> {
    return this.http.post(
      `${this.voiceUrl}/tts/speak`,
      { userId, text },
      { responseType: 'blob' }
    );
  }
}
