const OblLog = require('../models/OblLog');
const Board  = require('../models/Board');
const User   = require('../models/User');

// ── Constantes ────────────────────────────────────────────────────────────────

const WEIGHTS = {
  frequency:       0.22,
  transition:      0.32,
  wordType:        0.13,
  boardContext:    0.09,
  timeContext:     0.08,
  locationContext: 0.11,
  recency:         0.05,
};

// Colores Fitzgerald (fuente de verdad: fitzgerald.ts del frontend)
const FITZGERALD = {
  verb:       '#4caf50',
  pronoun:    '#ffd700',
  noun:       '#ff9800',
  descriptor: '#2196f3',
  social:     '#9c27b0',
  misc:       '#f5f5f5',
};

/** Resuelve el color efectivo de un pictograma igual que getCellBaseColor() del frontend. */
function resolveColor(oblColor, wordType, fitzgeraldEnabled) {
  if (fitzgeraldEnabled) return FITZGERALD[wordType] || '#f5f5f5';
  // Si OBL guardó el color (ya sea manual o Fitzgerald previamente resuelto), usarlo.
  // Si no, usar el Fitzgerald del wordType como mejor aproximación posible.
  return oblColor || FITZGERALD[wordType] || '#f5f5f5';
}

// Tipos de palabra esperados después de cada tipo
const WORD_TYPE_AFTER = {
  pronoun:    ['verb', 'misc'],
  verb:       ['noun', 'descriptor', 'misc'],
  descriptor: ['noun'],
  noun:       ['verb', 'misc', 'noun', 'social'],
  social:     ['verb', 'noun', 'misc'],
  misc:       ['verb', 'noun', 'misc'],
  place:      ['verb', 'misc'],
  time:       ['verb', 'misc'],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTimeBlock(isoTs) {
  try {
    const h = new Date(isoTs).getHours();
    if (h >= 6  && h < 12) return 'morning';
    if (h >= 12 && h < 15) return 'noon';
    if (h >= 15 && h < 20) return 'afternoon';
    return 'night';
  } catch {
    return 'morning';
  }
}

function norm(val, max) {
  return max > 0 ? Math.min(val / max, 1) : 0;
}

function round3(n) { return Math.round(n * 1000) / 1000; }
function round2(n) { return Math.round(n * 100)  / 100;  }

// ── Árbol de tableros ─────────────────────────────────────────────────────────

const MAX_BOARD_TREE = 30; // máximo de tableros que se recorren en el BFS

// Tipos de acción que producen voz (el pictograma se añade a la frase y se habla).
// Las acciones puramente de navegación (navigate, setSlot, disabled) no se predicen.
const VOICE_ACTION_TYPES = new Set(['voice', 'voice+navigate', 'voice+setSlot', 'speakAndBack']);

/**
 * Intercala pictogramas de distintos tableros en round-robin para que el fallback
 * no muestre siempre los pictos del primer subtablero visitado.
 * Input:  [[pict, pict, …], [pict, …], …]  (un sub-array por tablero, en orden BFS)
 * Output: [board0[0], board1[0], board2[0], board0[1], board1[1], …]
 */
function interleavePicts(byBoard) {
  const result = [];
  const maxLen = byBoard.reduce((m, b) => Math.max(m, b.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const picts of byBoard) {
      if (i < picts.length) result.push(picts[i]);
    }
  }
  return result;
}

/**
 * BFS desde rootBoardId siguiendo:
 *   navigate, voice+navigate        → tableros destino de navegación directa
 *   setSlot, voice+setSlot          → tableros que se cargan en un slot
 *   multiBoardSlots[].boardId       → tableros asignados a slots de multitablero
 * Devuelve:
 *   validLabels  — Set<labelLower>  todos los pictos con acción de voz en el árbol
 *   fallbackPicts — Array intercalado entre tableros (round-robin BFS)
 *   boardCellMap — Map<labelLower, {label,imageUrl,color,wordType,action}>
 *
 * Si userId está presente, aplica customPictograms del usuario sobre imageUrl
 * (misma lógica que getBoardById usa en tiempo de carga).
 */
async function traverseBoardTree(rootBoardId, userId = null) {
  const visited        = new Set();
  const queue          = [String(rootBoardId)];
  const validLabels    = new Set();
  const seenLabels     = new Set();
  // Map<labelLower, { label, imageUrl, color, wordType, action }>
  // Primer tablero en BFS (raíz) tiene prioridad si hay duplicados de label.
  const boardCellMap   = new Map();
  // Un sub-array por tablero visitado, para construir el fallback round-robin.
  const fallbackByBoard = [];

  while (queue.length > 0 && visited.size < MAX_BOARD_TREE) {
    const bId = queue.shift();
    if (visited.has(bId)) continue;
    visited.add(bId);

    let board;
    try {
      board = await Board.findById(bId).select('cells multiBoardSlots').lean();
    } catch { continue; }
    if (!board) continue;

    // Celdas en orden row/col para prioridad natural dentro de cada tablero
    const sorted = [...(board.cells || [])].sort((a, b) =>
      a.row !== b.row ? a.row - b.row : a.col - b.col
    );

    const boardPicts = [];  // pictos de este tablero para el round-robin del fallback

    for (const cell of sorted) {
      const p          = cell.pictogram;
      const actionType = cell.action?.type ?? 'voice';

      // Solo son candidatos los pictos cuya acción incluye voz.
      if (p?.label && VOICE_ACTION_TYPES.has(actionType)) {
        const lbl   = p.label.toLowerCase();
        const wt    = p.wordType || 'misc';
        const color = resolveColor(p.color, wt, !!p.fitzgeraldEnabled);
        const cellAction = {
          type:          actionType,
          targetBoardId: cell.action?.targetBoardId ? String(cell.action.targetBoardId) : undefined,
          targetSlotId:  cell.action?.targetSlotId ?? undefined,
        };

        validLabels.add(lbl);

        if (!boardCellMap.has(lbl)) {
          boardCellMap.set(lbl, { label: p.label, imageUrl: p.imageUrl || '', color, wordType: wt, action: cellAction });
        }

        if (!seenLabels.has(p.label)) {
          seenLabels.add(p.label);
          boardPicts.push({ label: p.label, imageUrl: p.imageUrl || '', color, wordType: wt, action: cellAction });
        }
      }

      // Seguir cualquier enlace de navegación hacia otro tablero, aunque la celda
      // no tenga voz: el tablero destino puede contener pictos con voz.
      // Incluye setSlot/voice+setSlot: cargan un subtablero en un slot de multitablero.
      const act = cell.action;
      if (act?.targetBoardId && (
        act.type === 'navigate'       ||
        act.type === 'voice+navigate' ||
        act.type === 'setSlot'        ||
        act.type === 'voice+setSlot'
      )) {
        const tid = String(act.targetBoardId);
        if (!visited.has(tid)) queue.push(tid);
      }
    }

    if (boardPicts.length > 0) fallbackByBoard.push(boardPicts);

    // Slots de multitablero: cada slot apunta a un tablero independiente
    for (const slot of (board.multiBoardSlots || [])) {
      if (slot.boardId) {
        const sid = String(slot.boardId);
        if (!visited.has(sid)) queue.push(sid);
      }
    }
  }

  // ── Personalización de usuario ───────────────────────────────────────────────
  // Si el usuario tiene un pictograma propio con el mismo label que uno del árbol,
  // sustituir imageUrl (misma lógica que getBoardById aplica en carga dinámica).
  if (userId) {
    try {
      const user = await User.findById(userId).select('customPictograms').lean();
      const cpMap = new Map();
      for (const cp of (user?.customPictograms ?? [])) {
        cpMap.set(cp.label.toLowerCase().trim(), cp.imageUrl);
      }
      if (cpMap.size > 0) {
        // boardCellMap: actualizar imageUrl in-place
        for (const [key, entry] of boardCellMap) {
          const customUrl = cpMap.get(key.trim());
          if (customUrl) entry.imageUrl = customUrl;
        }
        // fallbackByBoard: actualizar también para que el fallback refleje lo mismo
        for (const boardPicts of fallbackByBoard) {
          for (const fp of boardPicts) {
            const key = fp.label.toLowerCase().trim();
            const customUrl = cpMap.get(key);
            if (customUrl) fp.imageUrl = customUrl;
          }
        }
      }
    } catch { /* silencioso: la personalización no bloquea el predictor */ }
  }

  // Fallback intercalado: un picto de cada tablero por turno → evita mostrar
  // siempre los pictos del primer subtablero visitado (p. ej. siempre "personas").
  const fallbackPicts = interleavePicts(fallbackByBoard);

  return { validLabels, fallbackPicts, boardCellMap };
}

// ── Servicio principal ────────────────────────────────────────────────────────

/**
 * Devuelve hasta `limit` pictogramas ordenados por probabilidad de uso para un
 * usuario y contexto de frase dados.
 *
 * Algoritmo de pesos:
 *   score = frecuencia*0.25 + transición*0.35 + tipoSintáctico*0.15
 *         + contextoTablero*0.10 + bloqueHorario*0.10 + recencia*0.05
 */
exports.getSuggestions = async ({
  userId,
  boardId,
  limit,
  currentPhrase = [],
  currentBoardRole,
  currentBoardShape,
  locationContext = 'general',
}) => {
  // ── Árbol de tableros: labels válidos + pictogramas de fallback ─────────────
  // El predictor solo puede sugerir pictogramas que existen en el tablero actual
  // y en todos los tableros alcanzables mediante navegación desde él.
  const { validLabels, fallbackPicts, boardCellMap } = await traverseBoardTree(boardId, userId);

  // Cargar últimas 100 sesiones para mantener el cálculo acotado
  const sessions = await OblLog
    .find({ userId })
    .sort({ started: -1 })
    .limit(100)
    .lean();

  const allButtonEvents = sessions
    .flatMap(s => s.events || [])
    .filter(e => e.type === 'button' && e.label);

  // ── Sin historial → usar pictogramas del árbol de tableros con score 0.5 ──
  if (allButtonEvents.length === 0) {
    // fallbackPicts ya incluye { label, imageUrl, color, wordType, action } del tablero real.
    return fallbackPicts.slice(0, limit).map(p => ({
      label:    p.label,
      imageUrl: p.imageUrl,
      color:    p.color,
      wordType: p.wordType,
      action:   p.action,
      score:    0.5,
      reasons:  { frequency: 0, transition: 0, wordType: 0, boardContext: 0, timeContext: 0, locationContext: 0, recency: 0 },
    }));
  }

  // ── Construir mapas a partir de eventos OBL ───────────────────────────────

  // freqMap[label]                  → nº total de pulsaciones
  // pictData[label]                 → { imageUrl, color, wordType } del último evento visto
  // recencyMap[label]               → puntuación de recencia (1 / log2(rank+2)), solo primera aparición
  // timeMap[`block|label`]          → nº de pulsaciones en ese bloque horario
  // boardMap[`bId|label`]           → nº de pulsaciones en ese tablero
  // locationMap[`context|label`]    → nº de pulsaciones en ese contexto de ubicación
  const freqMap     = {};
  const pictData    = {};
  const recencyMap  = {};
  const timeMap     = {};
  const boardMap    = {};
  const locationMap = {};

  // Ordenar desc por timestamp para asignar rango de recencia
  const sortedDesc = [...allButtonEvents].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  sortedDesc.forEach((e, idx) => {
    // Normalizar a minúsculas para que las claves de todos los maps sean consistentes
    // con validLabels y boardCellMap (que también usan lowercase).
    const lbl = (e.label || '').toLowerCase();
    freqMap[lbl] = (freqMap[lbl] || 0) + 1;

    // Datos del pictograma del OBL: usados como fallback si boardCellMap no tiene el label.
    if (!pictData[lbl]) {
      const wt = e.wordType || 'misc';
      pictData[lbl] = {
        imageUrl: e.image_url || '',
        color:    resolveColor(e.color, wt, false),
        wordType: wt,
      };
    }

    // Recencia: puntuación mayor para los primeros en la lista (más recientes)
    if (recencyMap[lbl] === undefined) {
      recencyMap[lbl] = 1 / Math.log2(idx + 2);
    }

    const block = getTimeBlock(e.timestamp);
    timeMap[`${block}|${lbl}`] = (timeMap[`${block}|${lbl}`] || 0) + 1;

    if (e.board_id) {
      boardMap[`${e.board_id}|${lbl}`] = (boardMap[`${e.board_id}|${lbl}`] || 0) + 1;
    }

    const evLocCtx = (e.location_context || '').trim() || 'general';
    const locKey   = `${evLocCtx}|${lbl}`;
    locationMap[locKey] = (locationMap[locKey] || 0) + 1;
  });

  // transitionMap[`from|to`] → nº de veces que `to` siguió a `from` en una sesión
  const transitionMap = {};
  for (const session of sessions) {
    const btns = (session.events || []).filter(e => e.type === 'button' && e.label);
    for (let i = 0; i < btns.length - 1; i++) {
      const key = `${(btns[i].label || '').toLowerCase()}|${(btns[i + 1].label || '').toLowerCase()}`;
      transitionMap[key] = (transitionMap[key] || 0) + 1;
    }
  }

  // ── Contexto actual ───────────────────────────────────────────────────────

  const currentBlock = getTimeBlock(new Date().toISOString());
  const lastItem     = currentPhrase.length > 0 ? currentPhrase[currentPhrase.length - 1] : null;
  const lastLabel    = lastItem?.label?.toLowerCase() ?? null;
  const lastWordType = lastItem?.wordType ?? null;

  // Pre-computar totales para normalización
  const maxFreq    = Math.max(...Object.values(freqMap), 1);
  const maxRecency = Math.max(...Object.values(recencyMap), 1);

  const transFromTotal = lastLabel
    ? Object.entries(transitionMap)
        .filter(([k]) => k.startsWith(`${lastLabel}|`))
        .reduce((s, [, v]) => s + v, 0)
    : 0;

  const timeTotalForBlock = Object.entries(timeMap)
    .filter(([k]) => k.startsWith(`${currentBlock}|`))
    .reduce((s, [, v]) => s + v, 0);

  const boardTotal = Object.entries(boardMap)
    .filter(([k]) => k.startsWith(`${boardId}|`))
    .reduce((s, [, v]) => s + v, 0);

  // Normalización de locationContext: solo tiene sentido si hay datos del contexto actual.
  // Si locationContext es 'general' o no hay histórico en ese contexto, locationScore = 0.
  const normLocCtx = (locationContext || 'general').trim();
  const locationTotal = normLocCtx !== 'general'
    ? Object.entries(locationMap)
        .filter(([k]) => k.startsWith(`${normLocCtx}|`))
        .reduce((s, [, v]) => s + v, 0)
    : 0;

  const expectedTypes = lastWordType ? (WORD_TYPE_AFTER[lastWordType] || []) : [];

  // Set de etiquetas ya presentes en la frase actual (insensible a mayúsculas).
  // Los pictogramas de esta lista reciben una penalización fuerte: es muy improbable
  // que el usuario vuelva a pulsar la misma palabra dentro de la misma frase.
  const phraseSet = new Set((currentPhrase || []).map(p => (p.label || '').toLowerCase()));

  // ── Puntuar cada candidato ────────────────────────────────────────────────

  // Candidatos: TODOS los pictos del árbol de tableros con acción de voz (validLabels).
  // El historial OBL determina la puntuación, NO el conjunto elegible:
  //   - Pictos pulsados antes  → scores OBL > 0 → aparecen primero.
  //   - Pictos nunca pulsados  → scores OBL = 0 → aparecen si no hay suficientes candidatos
  //                              con historial para llenar los N slots del predictor.
  // validLabels ya usa lowercase; los maps OBL también usan lowercase desde el bucle anterior.
  const candidates = [...validLabels];

  const scored = candidates.map(lbl => {
    // lbl es siempre lowercase (viene de validLabels).
    // boardCellMap es la fuente de verdad para imagen, color y acción.
    // pictData del OBL se usa como fallback si boardCellMap no tuviera el label.
    const boardCell = boardCellMap.get(lbl);
    const oblData   = pictData[lbl] || {};

    const freqScore = norm(freqMap[lbl] || 0, maxFreq);

    const transKey   = lastLabel ? `${lastLabel}|${lbl}` : null;
    const transScore = transFromTotal > 0 && transKey
      ? norm(transitionMap[transKey] || 0, transFromTotal)
      : 0;

    // wordType: usar el del tablero si está disponible; sino el del OBL
    const resolvedWordType = boardCell?.wordType || oblData.wordType || 'misc';
    const wordTypeScore = expectedTypes.length > 0 && expectedTypes.includes(resolvedWordType) ? 1 : 0;

    const boardScore = boardTotal > 0
      ? norm(boardMap[`${boardId}|${lbl}`] || 0, boardTotal)
      : 0;

    const timeScore = timeTotalForBlock > 0
      ? norm(timeMap[`${currentBlock}|${lbl}`] || 0, timeTotalForBlock)
      : 0;

    const recencyScore = norm(recencyMap[lbl] || 0, maxRecency);

    const locationScore = locationTotal > 0
      ? norm(locationMap[`${normLocCtx}|${lbl}`] || 0, locationTotal)
      : 0;

    const raw =
      freqScore      * WEIGHTS.frequency       +
      transScore     * WEIGHTS.transition      +
      wordTypeScore  * WEIGHTS.wordType        +
      boardScore     * WEIGHTS.boardContext    +
      timeScore      * WEIGHTS.timeContext     +
      locationScore  * WEIGHTS.locationContext +
      recencyScore   * WEIGHTS.recency;

    // Penalizar fuertemente pictogramas ya pulsados en la frase actual.
    // Factor 0.05 → aparecen al fondo del ranking y fuera del top-N habitual.
    const inPhrase = phraseSet.has(lbl.toLowerCase());
    const total    = inPhrase ? raw * 0.05 : raw;

    return {
      // Datos visuales y de comportamiento: fuente de verdad = tablero actual.
      label:    boardCell?.label    || lbl,
      imageUrl: boardCell?.imageUrl || oblData.imageUrl || '',
      color:    boardCell?.color    || oblData.color    || '#f5f5f5',
      wordType: resolvedWordType,
      action:   boardCell?.action   || null,
      score:    round3(total),
      reasons: {
        frequency:       round2(freqScore),
        transition:      round2(transScore),
        wordType:        wordTypeScore,
        boardContext:    round2(boardScore),
        timeContext:     round2(timeScore),
        locationContext: round2(locationScore),
        recency:         round2(recencyScore),
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
};

// ── Predictor circular inteligente ────────────────────────────────────────────

const CIRCULAR_WEIGHTS = {
  frequency:       0.18,
  transition:      0.30,
  wordType:        0.12,
  categoryContext: 0.15,
  timeContext:     0.08,
  locationContext: 0.12,
  recency:         0.05,
};

/** Clave normalizada para mapas internos. No elimina tildes para no confundir "sí"/"si". */
function keyLabel(s) {
  return (s || '').toLowerCase().trim();
}

/**
 * Extrae candidatos de una categoría predictiva.
 * sourceType 'manual'  → manualPictograms del propio config.
 * sourceType 'board'   → traverseBoardTree sobre sourceBoardId (reutiliza el BFS del predictor normal).
 */
async function extractCircularCandidates(category, userId) {
  const src = category.sourceType || 'manual';

  if (src === 'manual') {
    return {
      candidates: (category.manualPictograms || []).map(p => ({
        label:             p.label || '',
        imageUrl:          p.imageUrl || '',
        color:             p.color || '#f5f5f5',
        wordType:          p.wordType || 'misc',
        action:            p.action || { type: 'voice' },
        fitzgeraldEnabled: !!p.fitzgeraldEnabled,
      })),
      source: 'manual',
    };
  }

  // sourceType === 'board'
  if (!category.sourceBoardId) return { candidates: [], source: 'board' };

  const { fallbackPicts } = await traverseBoardTree(category.sourceBoardId, userId);
  return {
    candidates: fallbackPicts.map(p => ({
      label:             p.label,
      imageUrl:          p.imageUrl,
      color:             p.color,
      wordType:          p.wordType,
      action:            p.action,
      fitzgeraldEnabled: false,
    })),
    source: 'board',
  };
}

/**
 * Devuelve hasta `limit` sugerencias ordenadas por probabilidad para la categoría
 * dada de un tablero circular predictivo.
 *
 * Pesos: frecuencia 0.18 · transición 0.30 · tipo gramatical 0.12 ·
 *        categoría 0.15 · hora 0.08 · ubicación 0.12 · recencia 0.05
 */
exports.getCircularSuggestions = async ({
  userId,
  boardId,
  categoryId,
  limit           = 8,
  currentPhrase   = [],
  locationContext = 'general',
}) => {
  // ── Cargar tablero y encontrar la categoría ─────────────────────────────
  const board = await Board
    .findById(boardId)
    .select('predictiveCircularConfig')
    .lean();

  if (!board?.predictiveCircularConfig) {
    throw new Error('El tablero no tiene configuración predictiva circular');
  }

  const cats = board.predictiveCircularConfig.categories || [];
  const category = cats.find(c => c.id === categoryId);
  if (!category) return [];

  const categoryLabel = category.label || '';
  const { candidates, source } = await extractCircularCandidates(category, userId);
  if (candidates.length === 0) return [];

  // ── Cargar sesiones OBL ─────────────────────────────────────────────────
  const sessions = await OblLog
    .find({ userId })
    .sort({ started: -1 })
    .limit(100)
    .lean();

  const allButtonEvents = sessions
    .flatMap(s => s.events || [])
    .filter(e => e.type === 'button' && e.label);

  // ── Sin historial → fallback ordenado con score neutro ─────────────────
  if (allButtonEvents.length === 0) {
    return candidates.slice(0, limit).map(p => ({
      ...p,
      score: 0.5,
      source,
      categoryId,
      categoryLabel,
      reasons: {
        frequency: 0, transition: 0, wordType: 0,
        categoryContext: 1, timeContext: 0, locationContext: 0, recency: 0,
      },
    }));
  }

  // ── Construir mapas desde eventos OBL ──────────────────────────────────
  const freqMap     = {};
  const recencyMap  = {};
  const timeMap     = {};
  const locationMap = {};
  // categoryMap[`catId|label`] → nº de veces pulsado en esa categoría circular
  const categoryMap = {};

  // Ordenar desc por timestamp para asignar rango de recencia
  const sortedDesc = [...allButtonEvents].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  sortedDesc.forEach((e, idx) => {
    const lbl = keyLabel(e.label);
    freqMap[lbl] = (freqMap[lbl] || 0) + 1;

    if (recencyMap[lbl] === undefined) {
      recencyMap[lbl] = 1 / Math.log2(idx + 2);
    }

    const block = getTimeBlock(e.timestamp);
    timeMap[`${block}|${lbl}`] = (timeMap[`${block}|${lbl}`] || 0) + 1;

    const evLocCtx = (e.location_context || '').trim() || 'general';
    locationMap[`${evLocCtx}|${lbl}`] = (locationMap[`${evLocCtx}|${lbl}`] || 0) + 1;

    if (e.category_id) {
      categoryMap[`${e.category_id}|${lbl}`] = (categoryMap[`${e.category_id}|${lbl}`] || 0) + 1;
    }
  });

  // transitionMap[`from|to`] → nº de veces que `to` siguió a `from`
  const transitionMap = {};
  for (const session of sessions) {
    const btns = (session.events || []).filter(e => e.type === 'button' && e.label);
    for (let i = 0; i < btns.length - 1; i++) {
      const key = `${keyLabel(btns[i].label)}|${keyLabel(btns[i + 1].label)}`;
      transitionMap[key] = (transitionMap[key] || 0) + 1;
    }
  }

  // ── Contexto actual ─────────────────────────────────────────────────────
  const currentBlock  = getTimeBlock(new Date().toISOString());
  const lastItem      = currentPhrase.length > 0 ? currentPhrase[currentPhrase.length - 1] : null;
  const lastLabel     = lastItem?.label ? keyLabel(lastItem.label) : null;
  const lastWordType  = lastItem?.wordType ?? null;
  const normLocCtx    = (locationContext || 'general').trim();

  const maxFreq    = Math.max(...Object.values(freqMap), 1);
  const maxRecency = Math.max(...Object.values(recencyMap), 1);

  const transFromTotal = lastLabel
    ? Object.entries(transitionMap)
        .filter(([k]) => k.startsWith(`${lastLabel}|`))
        .reduce((s, [, v]) => s + v, 0)
    : 0;

  const timeTotalForBlock = Object.entries(timeMap)
    .filter(([k]) => k.startsWith(`${currentBlock}|`))
    .reduce((s, [, v]) => s + v, 0);

  const locationTotal = normLocCtx !== 'general'
    ? Object.entries(locationMap)
        .filter(([k]) => k.startsWith(`${normLocCtx}|`))
        .reduce((s, [, v]) => s + v, 0)
    : 0;

  // Total de eventos registrados en esta categoría
  const categoryTotal = Object.entries(categoryMap)
    .filter(([k]) => k.startsWith(`${categoryId}|`))
    .reduce((s, [, v]) => s + v, 0);

  const expectedTypes = lastWordType ? (WORD_TYPE_AFTER[lastWordType] || []) : [];
  const phraseSet = new Set((currentPhrase || []).map(p => keyLabel(p.label || '')));

  // ── Puntuar cada candidato ──────────────────────────────────────────────
  const scored = candidates.map(candidate => {
    const lbl = keyLabel(candidate.label);

    const freqScore = norm(freqMap[lbl] || 0, maxFreq);

    const transKey   = lastLabel ? `${lastLabel}|${lbl}` : null;
    const transScore = transFromTotal > 0 && transKey
      ? norm(transitionMap[transKey] || 0, transFromTotal)
      : 0;

    const wordTypeScore = expectedTypes.length > 0 && expectedTypes.includes(candidate.wordType) ? 1 : 0;

    // categoryScore: histórico si existen datos de esta categoría; 0.5 si no hay todavía.
    // Un 0.5 uniforme no favorece ni penaliza a ningún candidato en ausencia de datos.
    const categoryScore = categoryTotal > 0
      ? norm(categoryMap[`${categoryId}|${lbl}`] || 0, categoryTotal)
      : 0.5;

    const timeScore = timeTotalForBlock > 0
      ? norm(timeMap[`${currentBlock}|${lbl}`] || 0, timeTotalForBlock)
      : 0;

    const locationScore = locationTotal > 0
      ? norm(locationMap[`${normLocCtx}|${lbl}`] || 0, locationTotal)
      : 0;

    const recencyScore = norm(recencyMap[lbl] || 0, maxRecency);

    const raw =
      freqScore      * CIRCULAR_WEIGHTS.frequency       +
      transScore     * CIRCULAR_WEIGHTS.transition      +
      wordTypeScore  * CIRCULAR_WEIGHTS.wordType        +
      categoryScore  * CIRCULAR_WEIGHTS.categoryContext +
      timeScore      * CIRCULAR_WEIGHTS.timeContext     +
      locationScore  * CIRCULAR_WEIGHTS.locationContext +
      recencyScore   * CIRCULAR_WEIGHTS.recency;

    // Penalización fuerte si el candidato ya está en la frase actual
    const inPhrase = phraseSet.has(lbl);
    const total    = inPhrase ? raw * 0.05 : raw;

    return {
      label:         candidate.label,
      imageUrl:      candidate.imageUrl,
      color:         candidate.color,
      wordType:      candidate.wordType,
      action:        candidate.action,
      score:         round3(total),
      source,
      categoryId,
      categoryLabel,
      reasons: {
        frequency:       round2(freqScore),
        transition:      round2(transScore),
        wordType:        wordTypeScore,
        categoryContext: round2(categoryScore),
        timeContext:     round2(timeScore),
        locationContext: round2(locationScore),
        recency:         round2(recencyScore),
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
};

