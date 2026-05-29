import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface BoardFolder {
  _id:       string;
  name:      string;
  createdBy: string;
  createdAt?: string;
}

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly url = `${environment.apiUrl}/folders`;

  constructor(private http: HttpClient) {}

  getFolders(): Observable<{ folders: BoardFolder[] }> {
    return this.http.get<{ folders: BoardFolder[] }>(this.url);
  }

  createFolder(name: string): Observable<{ folder: BoardFolder }> {
    return this.http.post<{ folder: BoardFolder }>(this.url, { name });
  }

  renameFolder(folderId: string, name: string): Observable<{ folder: BoardFolder }> {
    return this.http.put<{ folder: BoardFolder }>(
      `${this.url}/${encodeURIComponent(folderId)}`, { name },
    );
  }

  deleteFolder(folderId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.url}/${encodeURIComponent(folderId)}`,
    );
  }
}
