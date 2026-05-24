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

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly url = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

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
}
