import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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
  reasons?: {
    frequency:    number;
    transition:   number;
    wordType:     number;
    boardContext: number;
    timeContext:  number;
    recency:      number;
  };
}

export interface PredictionRequest {
  userId:            string;
  boardId:           string;
  limit:             number;
  currentPhrase:     { label: string; wordType?: string }[];
  currentBoardRole:  string;
  currentBoardShape: string;
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
}
