import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { VoiceSettings } from './user.service';

export interface VoiceHealthStatus {
  enabled:     boolean;
  reachable:   boolean;
  modelsReady?: boolean;
  device?:     string;
}

@Injectable({ providedIn: 'root' })
export class VoiceService {

  private readonly api = `${environment.apiUrl}/voice`;

  constructor(private http: HttpClient) {}

  // ── Health ────────────────────────────────────────────────────────────────

  /**
   * Comprueba si el servicio de voz está disponible.
   * Nunca lanza error: devuelve { enabled:false, reachable:false } en caso de fallo.
   */
  checkHealth(): Observable<VoiceHealthStatus> {
    return this.http.get<VoiceHealthStatus>(`${this.api}/health`).pipe(
      catchError(() => of({ enabled: false, reachable: false }))
    );
  }

  // ── Muestra y creación ────────────────────────────────────────────────────

  uploadSample(
    userId:          string,
    audioDataUrl:    string,
    consentAccepted: boolean,
    consentText:     string
  ): Observable<{ message: string; status: string }> {
    return this.http
      .post<{ message: string; status: string }>(
        `${this.api}/${encodeURIComponent(userId)}/sample`,
        { audioDataUrl, consentAccepted, consentText }
      )
      .pipe(catchError(err => throwError(() => this.parseError(err))));
  }

  createVoice(userId: string): Observable<{ message: string; status: string }> {
    return this.http
      .post<{ message: string; status: string }>(
        `${this.api}/${encodeURIComponent(userId)}/create`,
        {}
      )
      .pipe(catchError(err => throwError(() => this.parseError(err))));
  }

  // ── Estado ────────────────────────────────────────────────────────────────

  getStatus(userId: string): Observable<{ voiceSettings: VoiceSettings }> {
    return this.http
      .get<{ voiceSettings: VoiceSettings }>(
        `${this.api}/${encodeURIComponent(userId)}/status`
      )
      .pipe(catchError(err => throwError(() => this.parseError(err))));
  }

  // ── Borrar voz personalizada ──────────────────────────────────────────────

  deleteCustomVoice(userId: string): Observable<{ message: string; status: string }> {
    return this.http
      .delete<{ message: string; status: string }>(
        `${this.api}/${encodeURIComponent(userId)}/custom`
      )
      .pipe(catchError(err => throwError(() => this.parseError(err))));
  }

  // ── Síntesis TTS ──────────────────────────────────────────────────────────

  /**
   * Genera audio WAV con la voz personalizada del usuario.
   * Si el servicio no está disponible devuelve un error con mensaje legible.
   */
  generateAudio(userId: string, text: string): Observable<Blob> {
    return this.http
      .post(`${this.api}/tts/speak`, { userId, text }, { responseType: 'blob' })
      .pipe(catchError(err => throwError(() => this.parseError(err))));
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private parseError(err: any): string {
    if (err?.status === 503 || err?.status === 0) {
      return 'El servicio de voz no está disponible en este momento.';
    }
    if (err?.status === 504) {
      return 'El servicio de voz tardó demasiado. Inténtalo de nuevo más tarde.';
    }
    return (
      err?.error?.message ??
      err?.error?.error   ??
      err?.message        ??
      'Error en el servicio de voz.'
    );
  }
}
