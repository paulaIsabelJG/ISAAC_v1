import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Sugerencia del predictor circular inteligente. */
export interface CircularSuggestion {
  label:         string;
  imageUrl:      string;
  color:         string;
  wordType:      string;
  action?:       { type: string; targetBoardId?: string; targetSlotId?: number } | null;
  score:         number;
  source:        'manual' | 'board';
  categoryId:    string;
  categoryLabel: string;
  reasons?: {
    frequency:       number;
    transition:      number;
    wordType:        number;
    categoryContext: number;
    timeContext:     number;
    locationContext: number;
    recency:         number;
  };
}

export interface CircularPredictionRequest {
  userId:          string;
  boardId:         string;
  categoryId:      string;
  limit?:          number;
  currentPhrase?:  { label: string; wordType?: string }[];
  locationContext?: string;
}

/** Pictograma sugerido por el Predictor IA. */
export interface PredictedPictogram {
  label:    string;
  imageUrl: string;
  /** Color hex efectivo resuelto desde la celda real del tablero. */
  color:    string;
  wordType: string;
  /** Puntuación normalizada [0, 1]. Mayor = más probable. */
  score:    number;
  /** Acción original de la celda en el tablero (navigate, setSlot, voice…).
   *  Permite que al pulsar la sugerencia se ejecute el mismo comportamiento
   *  que al pulsar el pictograma directamente en el tablero. */
  action?:  { type: string; targetBoardId?: string; targetSlotId?: number } | null;
  /** En multitablero: slotId del hueco donde vive este pictograma (calculado en frontend). */
  sourceSlotId?: number | null;
  reasons?: {
    frequency:       number;
    transition:      number;
    wordType:        number;
    boardContext:    number;
    timeContext:     number;
    locationContext: number;
    recency:         number;
  };
}

export interface PredictionRequest {
  userId:            string;
  boardId:           string;
  limit:             number;
  currentPhrase:     { label: string; wordType?: string }[];
  currentBoardRole:  string;
  currentBoardShape: string;
  locationContext?:  string;
}

@Injectable({ providedIn: 'root' })
export class AacPredictionService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /** Solicita predicciones al backend basadas en historial OBL del usuario. */
  getSuggestions(req: PredictionRequest): Observable<{ predictions: PredictedPictogram[] }> {
    return this.http.post<{ predictions: PredictedPictogram[] }>(
      `${this.apiUrl}/aac-prediction/suggest`,
      req,
    );
  }

  /** Solicita sugerencias para una categoría del tablero circular predictivo. */
  getCircularSuggestions(req: CircularPredictionRequest): Observable<{ suggestions: CircularSuggestion[] }> {
    return this.http.post<{ suggestions: CircularSuggestion[] }>(
      `${this.apiUrl}/aac-prediction/circular`,
      req,
    );
  }
}
