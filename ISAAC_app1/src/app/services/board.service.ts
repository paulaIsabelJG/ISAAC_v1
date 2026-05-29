import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { WordType } from '../shared/constants/fitzgerald';

// ─── Tipos de datos ───────────────────────────────────────────────────────────

export type BoardShape  = 'grid' | 'circular' | 'multi';
export type ActionType  = 'voice' | 'navigate' | 'voice+navigate' | 'disabled' | 'setSlot' | 'voice+setSlot' | 'speakAndBack';

// ─── Configuración de la barra de controles AAC ───────────────────────────────

export type ControlButtonId = 'home' | 'back' | 'speak' | 'deleteLast' | 'clearAll';
export type ControlsBarItem = ControlButtonId | 'phraseBar';

export interface ControlsConfig {
  /** Botones visibles (phraseBar no se incluye aquí, siempre visible). */
  visibleButtons: ControlButtonId[];
  /** Orden de los elementos: botones + phraseBar. phraseBar siempre presente. */
  order: ControlsBarItem[];
}

export const DEFAULT_CONTROLS_CONFIG: ControlsConfig = {
  visibleButtons: ['home', 'back', 'speak', 'deleteLast', 'clearAll'],
  order:          ['home', 'back', 'speak', 'phraseBar', 'deleteLast', 'clearAll'],
};
export type PictSource  = 'arasaac' | 'custom' | 'new';

// WordType, FITZGERALD, FITZGERALD_COLORS y WORD_TYPE_LABELS → shared/constants/fitzgerald.ts

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CellPictogram {
  source:            PictSource;
  id:                string;
  label:             string;
  imageUrl:          string;
  sound:             string;
  tags:              string[];
  description:       string;
  wordType:          WordType;
  fitzgeraldEnabled: boolean;
  color:             string;
}

export interface CellAction {
  type:                   ActionType;
  targetBoardId:          string | null;
  aiGeneratedBoardTarget?: boolean;
  showLastPhrase?:         boolean;
  /** Solo para setSlot / voice+setSlot: hueco del multitablero a cambiar (1-based). */
  targetSlotId?:           number | null;
}

export interface BoardCell {
  row:       number;
  col:       number;
  pictogram: CellPictogram | null;
  action:    CellAction;
}

export interface MultiBoardSlot {
  slotId:  number;
  boardId: string | null;
}

export interface Board {
  _id:                   string;
  name:                  string;
  imageUrl?:             string;
  creatorId:             string;   // campo legacy
  createdBy?:            string;   // ID del creador de contexto (fijado por backend)
  creatorName?:          string;   // nombre visible del creador, solo para UI
  userId:                string;
  shape:                 BoardShape;
  rows:                  number;
  columns:               number;
  circleSlots:           number;
  locationColumnEnabled: boolean;
  locationColumnSlots:   number;
  predictorEnabled:      boolean;
  aiRewriteEnabled:      boolean;
  iaRows:                number;
  iaCols:                number;
  cells:                 BoardCell[];
  createdAt?:            string;
  // Usuarios asignados (1-N). assignedUserIds es el nuevo campo; userId es legacy.
  assignedUserIds?:    string[];
  // Rol y perfil
  boardRole?:          'main' | 'secondary' | 'multi';
  visibleInProfile?:   boolean;
  profileName?:        string;
  profileImage?:       string;
  profileDescription?: string;
  // Multitablero
  slotCount?:          2 | 3 | 4;
  multiBoardSlots?:    MultiBoardSlot[];
  multiBoardLayout?:   { widths: number[]; heights: number[] };
  // Configuración de la barra AAC (solo en tableros principales)
  controlsConfig?:     ControlsConfig;
  // Carpeta a la que pertenece el tablero (opcional)
  folderId?:           string | null;
  isFavorite?:         boolean;
}

export interface CreateBoardPayload {
  name:                   string;
  imageUrl?:              string;
  userId:                 string;
  shape:                  BoardShape;
  rows?:                  number;
  columns?:               number;
  circleSlots?:           number;
  locationColumnEnabled?: boolean;
  locationColumnSlots?:   number;
  predictorEnabled?:      boolean;
  aiRewriteEnabled?:      boolean;
  iaRows?:                number;
  iaCols?:                number;
  boardRole?:             'main' | 'secondary' | 'multi';
  /** Usuarios asignados al tablero (1-N). userId = primer elemento (legacy). */
  assignedUserIds?:       string[];
  /** ID del creador de contexto (builder que se está editando).
   *  El backend valida permisos y lo usa como createdBy si procede. */
  contextCreatorId?:      string;
  // Multitablero
  slotCount?:             2 | 3 | 4;
  multiBoardSlots?:       MultiBoardSlot[];
  multiBoardLayout?:      { widths: number[]; heights: number[] };
  controlsConfig?:        ControlsConfig;
}

export interface UpdateBoardPayload {
  name?:                  string;
  imageUrl?:              string;
  userId?:                string;
  assignedUserIds?:       string[];
  rows?:                  number;
  columns?:               number;
  circleSlots?:           number;
  locationColumnEnabled?: boolean;
  locationColumnSlots?:   number;
  predictorEnabled?:      boolean;
  aiRewriteEnabled?:      boolean;
  iaRows?:                number;
  iaCols?:                number;
  cells?:                 BoardCell[];
  boardRole?:             'main' | 'secondary' | 'multi';
  visibleInProfile?:      boolean;
  profileName?:           string;
  profileImage?:          string;
  profileDescription?:    string;
  // Multitablero
  slotCount?:             2 | 3 | 4;
  multiBoardSlots?:       MultiBoardSlot[];
  multiBoardLayout?:      { widths: number[]; heights: number[] };
  controlsConfig?:        ControlsConfig;
}

export interface UpdateCellPayload {
  row:       number;
  col:       number;
  pictogram: CellPictogram | null;
  action?:   CellAction;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class BoardService {
  private readonly url = `${environment.apiUrl}/boards`;

  constructor(private http: HttpClient) {}

  /** GET /api/boards/my — tableros creados por el usuario de sesión (legacy) */
  getMyBoards(): Observable<{ boards: Board[] }> {
    return this.http.get<{ boards: Board[] }>(`${this.url}/my`);
  }

  /** GET /api/boards/builder/:creatorId — tableros del builder de un creador concreto */
  getBoardsByCreator(creatorId: string): Observable<{ boards: Board[] }> {
    return this.http.get<{ boards: Board[] }>(
      `${this.url}/builder/${encodeURIComponent(creatorId)}`
    );
  }

  /** GET /api/boards/assigned/:userId — tableros principales asignados (userId) a un usuario */
  getAssignedBoards(userId: string): Observable<{ boards: Board[] }> {
    return this.http.get<{ boards: Board[] }>(
      `${this.url}/assigned/${encodeURIComponent(userId)}`
    );
  }

  /** GET /api/boards/available-targets?assignedUserIds=id1,id2,…
   *  Tableros disponibles como destino de navegación para un conjunto de usuarios asignados.
   *  - 1 usuario: boards con assignedUserIds ∋ userId OR legacy userId
   *  - N usuarios: boards con assignedUserIds ⊇ todos los IDs
   */
  getAvailableTargets(assignedUserIds: string[]): Observable<{ boards: Board[] }> {
    const param = assignedUserIds.map(encodeURIComponent).join(',');
    return this.http.get<{ boards: Board[] }>(
      `${this.url}/available-targets?assignedUserIds=${param}`
    );
  }

  /** GET /api/boards/user/:userId — tableros asignados a un usuario */
  getBoardsByUser(userId: string): Observable<{ boards: Board[] }> {
    return this.http.get<{ boards: Board[] }>(
      `${this.url}/user/${encodeURIComponent(userId)}`
    );
  }

  /** GET /api/boards/:boardId — tablero completo con celdas */
  getBoardById(boardId: string): Observable<{ board: Board }> {
    return this.http.get<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}`
    );
  }

  /** POST /api/boards — crear tablero */
  createBoard(payload: CreateBoardPayload): Observable<{ board: Board }> {
    return this.http.post<{ board: Board }>(this.url, payload);
  }

  /** PUT /api/boards/:boardId — actualizar metadatos y/o celdas */
  updateBoard(boardId: string, payload: UpdateBoardPayload): Observable<{ board: Board }> {
    return this.http.put<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}`,
      payload
    );
  }

  /** PATCH /api/boards/:boardId/cell — actualizar/crear/eliminar una celda */
  updateCell(boardId: string, payload: UpdateCellPayload): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}/cell`,
      payload
    );
  }

  /** PATCH /api/boards/:boardId/slots — actualiza asignaciones de huecos de un multitablero */
  updateBoardSlots(
    boardId: string,
    slots: MultiBoardSlot[]
  ): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}/slots`,
      { slots }
    );
  }

  /** POST /api/boards/:boardId/duplicate — duplicar tablero */
  duplicateBoard(boardId: string): Observable<{ board: Board }> {
    return this.http.post<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}/duplicate`,
      {}
    );
  }

  /** DELETE /api/boards/:boardId — eliminar tablero */
  deleteBoard(boardId: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(
      `${this.url}/${encodeURIComponent(boardId)}`
    );
  }

  /** PATCH /api/boards/:boardId/folder — asignar tablero a carpeta (null = sin carpeta) */
  assignFolder(boardId: string, folderId: string | null): Observable<{ board: Board }> {
    return this.http.patch<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}/folder`,
      { folderId },
    );
  }

  /** PUT /api/boards/:boardId/favorite — marcar/desmarcar como favorito */
  toggleFavorite(boardId: string, isFavorite: boolean): Observable<{ board: Board }> {
    return this.http.put<{ board: Board }>(
      `${this.url}/${encodeURIComponent(boardId)}/favorite`,
      { isFavorite },
    );
  }
}
