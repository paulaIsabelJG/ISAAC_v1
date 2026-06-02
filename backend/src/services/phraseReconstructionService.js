
/**
 * Reconstruye frases completas a partir de los eventos OBL de una sesión.
 *
 * Estrategia de cierre de frase:
 *   1. Evento type:'utterance'  → cierre natural (el servicio ya lo registra al hablar).
 *   2. Acción ':speak'          → cierre por botón "Hablar" (fallback si no hay utterance).
 *   3. Acción ':clear'          → cierra la frase actual y reinicia el buffer.
 *   4. Fin de sesión (ended)    → cierra cualquier buffer pendiente como frase parcial.
 *
 * Backspace (':backspace'): marca el último item activo del buffer como inactivo.
 * El item desactivado permanece en la secuencia de interacciones para mostrar el
 * recorrido completo al usuario (activeInFinalPhrase: false, removedByAction: 'backspace').
 *
 * @param {object} session  — documento OblLog (con events[] y started/ended).
 * @returns {Array}         — array de frases reconstruidas.
 */
exports.reconstructPhrases = function reconstructPhrases(session) {
  const phrases = [];
  const deletedKeys = new Set(session.deletedPhraseKeys || []);
  const events = (session.events || [])
    .slice()
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Buffer de items de la frase en curso.
  // Cada item: { event, activeInFinalPhrase, removedByAction, isSystemAction }
  let buffer = [];
  let phraseStart = session.started || (events[0]?.timestamp ?? new Date().toISOString());

  function closePhrase(endTimestamp, overrideFinalText) {
    const activeItems = buffer.filter(b => b.activeInFinalPhrase && !b.isSystemAction);
    if (activeItems.length === 0) {
      buffer = [];
      phraseStart = endTimestamp;
      return;
    }

    const finalText = overrideFinalText != null
      ? overrideFinalText
      : activeItems.map(b => b.event.label || '').filter(Boolean).join(' ');

    if (!finalText.trim()) {
      buffer = [];
      phraseStart = endTimestamp;
      return;
    }

    const interactions = buffer.map(b => {
      const base = {
        type:                b.event.type,
        label:               b.event.label || '',
        timestamp:           b.event.timestamp,
        activeInFinalPhrase: b.activeInFinalPhrase,
        isSystemAction:      !!b.isSystemAction,
      };

      if (b.event.type === 'button') {
        base.imageUrl   = b.event.image_url  || null;
        base.boardId    = b.event.board_id   || null;
        base.buttonId   = b.event.button_id  || null;
        base.spoken     = b.event.spoken;
        base.color      = b.event.color      || null;
        base.wordType   = b.event.wordType   || null;
        if (b.removedByAction) base.removedByAction = b.removedByAction;
      } else if (b.event.type === 'action') {
        base.actionType = b.event.action;
      }

      return base;
    });

    const startMs  = new Date(phraseStart).getTime();
    const endMs    = new Date(endTimestamp).getTime();
    const phraseKey = `${session.sessionId}_${startMs}`;

    if (deletedKeys.has(phraseKey)) {
      buffer = [];
      phraseStart = endTimestamp;
      return;
    }

    phrases.push({
      phraseId:     phraseKey,
      sessionId:    session.sessionId,
      userId:       session.userId?.toString() || '',
      finalText:    finalText.trim(),
      startedAt:    phraseStart,
      endedAt:      endTimestamp,
      durationMs:   Math.max(0, endMs - startMs),
      interactions,
    });

    buffer = [];
    phraseStart = endTimestamp;
  }

  for (const ev of events) {
    if (ev.type === 'button') {
      // Solo los botones "hablados" contribuyen a la frase.
      // Los de tipo navigate/setSlot se registran pero no añaden texto.
      if (ev.spoken) {
        buffer.push({ event: ev, activeInFinalPhrase: true, removedByAction: null, isSystemAction: false });
      }
      // navigate/setSlot sin voz: añadir como contexto inactivo
      else {
        buffer.push({ event: ev, activeInFinalPhrase: false, removedByAction: null, isSystemAction: false });
      }
    } else if (ev.type === 'action') {
      switch (ev.action) {
        case ':backspace': {
          // Buscar el último item activo (no de sistema) y marcarlo como borrado.
          const lastActive = [...buffer].reverse().find(b => b.activeInFinalPhrase && !b.isSystemAction);
          if (lastActive) {
            lastActive.activeInFinalPhrase = false;
            lastActive.removedByAction = 'backspace';
          }
          buffer.push({ event: { ...ev, label: 'borrar último' }, activeInFinalPhrase: false, isSystemAction: true });
          break;
        }
        case ':clear': {
          // Marcar todos los activos como borrados por clear.
          buffer.forEach(b => {
            if (b.activeInFinalPhrase && !b.isSystemAction) {
              b.activeInFinalPhrase = false;
              b.removedByAction = 'clear';
            }
          });
          buffer.push({ event: { ...ev, label: 'limpiar frase' }, activeInFinalPhrase: false, isSystemAction: true });
          closePhrase(ev.timestamp, null); // cierre por clear (si había algo activo ya está marcado)
          break;
        }
        case ':speak': {
          // Cierre natural: el usuario pulsó "Hablar".
          const activeItems = buffer.filter(b => b.activeInFinalPhrase && !b.isSystemAction);
          const text = activeItems.map(b => b.event.label || '').join(' ');
          buffer.push({ event: { ...ev, label: 'hablar' }, activeInFinalPhrase: false, isSystemAction: true });
          closePhrase(ev.timestamp, text.trim() || null);
          break;
        }
        case 'ext_isaac_ai_reformulation': {
          // Reformulación IA aceptada por el usuario.
          // Se adjunta a la última frase cerrada (cuyo :speak tuvo el mismo timestamp t1).
          // NO se añade al buffer para no crear una frase nueva ni alterar el recuento.
          if (phrases.length > 0) {
            phrases[phrases.length - 1].aiReformulatedText = ev.ext_isaac_reformulated_text || ev.text || null;
          }
          break;
        }
        // home/:back/:open_board/etc. → solo registrar como contexto, no cierran frase
        default:
          buffer.push({ event: ev, activeInFinalPhrase: false, isSystemAction: true });
      }
    } else if (ev.type === 'utterance') {
      // Cierre más fiable: el servicio ya computó el texto final.
      buffer.push({ event: ev, activeInFinalPhrase: false, isSystemAction: true });
      closePhrase(ev.timestamp, ev.text || null);
    }
  }

  // Buffer pendiente al final de la sesión → frase parcial.
  const hasActive = buffer.some(b => b.activeInFinalPhrase && !b.isSystemAction);
  if (hasActive) {
    closePhrase(session.ended || new Date().toISOString(), null);
  }

  return phrases;
};
