import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { AacRuntimeService, AacPhraseItem } from '../../services/aac-runtime.service';
import { AiAssistantService, AiReformulationResponse, AiResolvedToken } from '../../services/ai-assistant.service';
import { PictCellContentComponent } from '../pict-cell-content/pict-cell-content.component';
import { CellPictogram } from '../../services/board.service';
import { getPictBgColor, getPictBorderColor } from '../../shared/utils/board-color.utils';

@Component({
  selector:    'app-ai-phrase-result-modal',
  templateUrl: './ai-phrase-result-modal.component.html',
  styleUrls:   ['./ai-phrase-result-modal.component.scss'],
  standalone:  true,
  imports:     [CommonModule, IonicModule, PictCellContentComponent],
})
export class AiPhraseResultModalComponent implements OnInit {

  @Input() originalPhrase: AacPhraseItem[] = [];
  /** Timestamp ISO del momento en que el usuario pulsó HABLAR (t1).
   *  Se pasa al communicator al aceptar para usarlo como timestamp del evento OBL. */
  @Input() speakTimestamp = '';

  loading = true;
  error:  string | null = null;
  result: AiReformulationResponse | null = null;

  constructor(
    private modalCtrl:   ModalController,
    private aac:         AacRuntimeService,
    private aiAssistant: AiAssistantService,
  ) {}

  ngOnInit(): void {
    void this.loadReformulation();
  }

  get originalText(): string {
    return this.originalPhrase.map(p => p.label).join(' ');
  }

  // ── Carga ──────────────────────────────────────────────────────────────────

  private async loadReformulation(): Promise<void> {
    this.loading = true;
    this.error   = null;
    try {
      this.result = await firstValueFrom(
        this.aiAssistant.reformulatePhrase(this.originalPhrase),
      );
    } catch (err: any) {
      this.error = err?.error?.error ?? err?.message ?? 'No se pudo conectar con el servicio de IA.';
    } finally {
      this.loading = false;
    }
  }

  // ── Pictogramas ────────────────────────────────────────────────────────────

  /** Convierte un token resuelto en CellPictogram para pict-cell-content. */
  toCell(token: AiResolvedToken): CellPictogram {
    return {
      source:            'arasaac',
      id:                token.originalLabel ?? token.text,
      label:             this.cleanLabel(token.text),
      imageUrl:          token.imageUrl,
      sound:             this.cleanLabel(token.text),
      tags:              [],
      description:       '',
      wordType:          (token.wordType || 'misc') as any,
      fitzgeraldEnabled: token.fitzgeraldEnabled,
      color:             token.color,
    };
  }

  tokenBg(token: AiResolvedToken): string {
    return getPictBgColor(this.toCell(token));
  }

  tokenBorder(token: AiResolvedToken): string {
    return getPictBorderColor(this.toCell(token));
  }

  /** Quita puntuación final para mostrar el label limpio dentro de la celda. */
  cleanLabel(text: string): string {
    return text.replace(/[.,;:!?¡¿]+$/, '');
  }

  // ── Interacción con tokens individuales ────────────────────────────────────

  /**
   * Click en un token del resultado IA.
   * - Habla el texto del token.
   * - Si el original tenía action=navigate → navega y cierra el modal.
   * - Si el original tenía action=setSlot  → cambia el slot y cierra el modal.
   * - Otros tipos de action (voice, speakAndBack) → solo habla.
   */
  onTokenPress(token: AiResolvedToken): void {
    const action = token.action;
    const type   = action?.type ?? 'voice';

    // Siempre hablar el label visible
    if (!action || type === 'voice' || type === 'voice+navigate' || type === 'voice+setSlot' || type === 'speakAndBack') {
      this.aac.speakText(this.cleanLabel(token.text));
    }

    if ((type === 'navigate' || type === 'voice+navigate') && action?.targetBoardId) {
      this.aac.navigateToBoard(action.targetBoardId);
      void this.modalCtrl.dismiss({ clear: false });
      return;
    }

    if ((type === 'setSlot' || type === 'voice+setSlot') && action?.targetSlotId != null && action?.targetBoardId) {
      this.aac.slotChanged$.next({ slotId: action.targetSlotId, boardId: action.targetBoardId });
      void this.modalCtrl.dismiss({ clear: false });
      return;
    }
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  speakReformulated(): void {
    if (!this.result) return;
    this.aac.speakText(this.result.reformulatedText);
  }

  accept(): void {
    // Incluye result y speakTimestamp para que el communicator registre el evento OBL IA.
    void this.modalCtrl.dismiss({ clear: true, result: this.result, speakTimestamp: this.speakTimestamp });
  }

  closeWithoutClear(): void {
    void this.modalCtrl.dismiss({ clear: false });
  }
}
