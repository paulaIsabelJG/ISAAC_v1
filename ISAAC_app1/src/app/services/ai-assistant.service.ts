import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AacPhraseItem } from './aac-runtime.service';

/** Token resuelto devuelto por el backend tras pasar por el pipeline
 *  original → ARASAAC local → texto puro. */
export interface AiResolvedToken {
  text:              string;
  source:            'original' | 'arasaac' | 'text';
  originalLabel:     string | null;
  imageUrl:          string;
  color:             string;
  wordType:          string;
  fitzgeraldEnabled: boolean;
}

export interface AiReformulationResponse {
  originalText:     string;
  reformulatedText: string;
  tokens:           AiResolvedToken[];
  confidence:       number | null;
  notes:            string[];
}

@Injectable({ providedIn: 'root' })
export class AiAssistantService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Envía la frase al backend para reformulación con IA y resolución de pictogramas.
   *
   * PRIVACIDAD: solo se transmiten etiquetas, categorías e imágenes de los pictogramas.
   * No se envían datos personales del usuario al servicio externo.
   */
  reformulatePhrase(phrase: AacPhraseItem[], locale = 'es'): Observable<AiReformulationResponse> {
    const text = phrase.map(p => p.label).join(' ');
    return this.http.post<AiReformulationResponse>(
      `${this.apiUrl}/ai/reformulate-phrase`,
      {
        text,
        locale,
        // Se envían imageUrl/color/wordType para que el backend pueda reutilizarlos
        // al resolver los tokens sin volver a buscar en ARASAAC.
        tokens: phrase.map(p => ({
          label:             p.label,
          imageUrl:          p.imageUrl,
          color:             p.color             ?? '',
          wordType:          p.wordType          ?? 'misc',
          fitzgeraldEnabled: p.fitzgeraldEnabled ?? false,
        })),
      },
    );
  }
}
