import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ObjectiveComment } from '../models/objective-comment.model';

@Injectable({ providedIn: 'root' })
export class ObjectiveCommentsService {

  private readonly api = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /** Devuelve el hilo de comentarios de un usuario final concreto en el objetivo. */
  getObjectiveComments(objectiveId: string, targetUserId: string): Observable<{ comments: ObjectiveComment[] }> {
    const params = new HttpParams().set('targetUserId', targetUserId);
    return this.http.get<{ comments: ObjectiveComment[] }>(
      `${this.api}/objectives/${objectiveId}/comments`, { params }
    );
  }

  /** Añade un comentario al hilo del usuario final indicado. */
  addObjectiveComment(
    objectiveId:  string,
    targetUserId: string,
    text:         string,
  ): Observable<{ comment: ObjectiveComment; commentsCount: number; threadCount: number }> {
    return this.http.post<{ comment: ObjectiveComment; commentsCount: number; threadCount: number }>(
      `${this.api}/objectives/${objectiveId}/comments`,
      { targetUserId, text },
    );
  }

  updateObjectiveComment(
    objectiveId: string,
    commentId: string,
    text: string,
  ): Observable<{ comment: ObjectiveComment }> {
    return this.http.put<{ comment: ObjectiveComment }>(
      `${this.api}/objectives/${objectiveId}/comments/${commentId}`,
      { text },
    );
  }

  deleteObjectiveComment(
    objectiveId: string,
    commentId: string,
  ): Observable<{ message: string; commentsCount: number }> {
    return this.http.delete<{ message: string; commentsCount: number }>(
      `${this.api}/objectives/${objectiveId}/comments/${commentId}`
    );
  }
}
