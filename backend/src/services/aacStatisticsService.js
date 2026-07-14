const OblLog = require('../models/OblLog');
const User   = require('../models/User');
const Board  = require('../models/Board');
const PhraseComprehensionScore = require('../models/PhraseComprehensionScore');
const phraseReconstruction = require('./phraseReconstructionService');

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateFilter(from, to) {
  const f = {};
  if (from) f.$gte = from;
  if (to)   f.$lte = to;
  return Object.keys(f).length ? f : null;
}

/**
 * Fusiona la valoración de comprensión (colección aparte, no forma parte del OBL)
 * en cada frase reconstruida, usando el mismo phraseId estable como clave de unión.
 */
async function attachComprehensionScores(phrases) {
  if (!phrases.length) return;
  const keys = phrases.map(p => p.phraseId);
  const scores = await PhraseComprehensionScore.find({ phraseKey: { $in: keys } }).lean();
  const scoreMap = {};
  for (const s of scores) scoreMap[s.phraseKey] = s;
  for (const p of phrases) {
    const s = scoreMap[p.phraseId];
    p.comprehensionScore       = s?.comprehensionScore ?? null;
    p.comprehensionEvaluatorId = s?.comprehensionEvaluatorId?.toString() ?? null;
    p.comprehensionEvaluatedAt = s?.comprehensionEvaluatedAt ?? null;
  }
}

/**
 * Rellena imageUrl en interacciones 'button' cuyo evento OBL no guardó imagen.
 *
 * Causa: logButtonEvent (aac-runtime.service.ts) omite deliberadamente image_url
 * cuando es un data-URI base64 — así son SIEMPRE los pictogramas propios
 * (User.customPictograms[].imageUrl), para no inflar los documentos OblLog con
 * el binario en cada pulsación. Los pictogramas de ARASAAC no se ven afectados
 * porque su imageUrl es una URL https absoluta, que sí se guarda en el evento.
 *
 * Recuperamos la imagen en lectura (sin tocar el OBL) uniendo por buttonId, que
 * ya guarda pictogram.id — el mismo id con el que getBoardById personaliza el
 * tablero (ver boardController.js), así que es una clave de unión estable.
 */
/**
 * Lógica de unión pura (sin Mongoose) — testeable sin base de datos.
 * customPictogramsByUserId: Map<userId string, Map<pictogramId string, imageUrl string>>
 */
function mergeCustomPictogramImages(phrases, customPictogramsByUserId) {
  for (const phrase of phrases) {
    const pictoMap = customPictogramsByUserId.get(String(phrase.userId));
    if (!pictoMap || !pictoMap.size) continue;
    for (const inter of phrase.interactions) {
      if (inter.type === 'button' && !inter.imageUrl && inter.buttonId) {
        const match = pictoMap.get(String(inter.buttonId));
        if (match) inter.imageUrl = match;
      }
    }
  }
}

async function attachCustomPictogramImages(phrases) {
  if (!phrases.length) return;
  const userIds = [...new Set(phrases.map(p => p.userId).filter(Boolean))];
  if (!userIds.length) return;

  const users = await User.find({ _id: { $in: userIds } }).select('customPictograms').lean();
  const mapByUser = new Map();
  for (const u of users) {
    const m = new Map();
    for (const cp of (u.customPictograms || [])) m.set(String(cp.id), cp.imageUrl);
    mapByUser.set(String(u._id), m);
  }

  mergeCustomPictogramImages(phrases, mapByUser);
}

function msToMinSec(ms) {
  if (!ms || ms < 0) return '0 s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

// ── IDs de usuarios del centro filtrados por scope ────────────────────────────

/**
 * Devuelve usuarios del centro según ámbito.
 * @param {string} centro
 * @param {string|null} excludeId  — ID del admin/org que se excluye
 * @param {string} scope  — 'all' | 'users' | 'professionals' | 'families'
 */
async function getUsersForCenter(centro, excludeId, scope = 'all') {
  const query = { centro };

  if (scope === 'users') {
    query.type = 'user';
  } else if (scope === 'professionals') {
    query.type = 'teacher';
    query.professionalType = { $ne: null };
  } else if (scope === 'families') {
    query.type = 'parent';
  }
  // 'all' → sin filtro de tipo

  const users = await User.find(query).select('_id name email type professionalType').lean();
  return users.filter(u => u._id.toString() !== excludeId?.toString());
}

// ── Consulta base de sesiones ─────────────────────────────────────────────────

async function getSessions(userIds, from, to) {
  const query = { userId: { $in: userIds } };
  const df = dateFilter(from, to);
  if (df) query.started = df;
  return OblLog.find(query).lean();
}

// ── Exports ───────────────────────────────────────────────────────────────────

exports.getOrganizationSummary = async ({ centro, excludeId, from, to, scope = 'all' }) => {
  const users = await getUsersForCenter(centro, excludeId, scope);
  const userIds = users.map(u => u._id);

  const finalUsers    = users.filter(u => u.type === 'user');
  const professionals = users.filter(u => u.type === 'teacher' && u.professionalType);
  const parents       = users.filter(u => u.type === 'parent');

  const sessions = await getSessions(userIds, from, to);

  const totalSessions     = sessions.length;
  const allEvents         = sessions.flatMap(s => s.events || []);
  const totalInteractions = allEvents.filter(e => e.type === 'button').length;

  const completedSessions = sessions.filter(s => s.started && s.ended);
  const avgSessionDurationMs = completedSessions.length
    ? Math.round(completedSessions.reduce((sum, s) =>
        sum + (new Date(s.ended) - new Date(s.started)), 0
      ) / completedSessions.length)
    : 0;

  let totalPhrases = 0;
  let totalPhraseButtons = 0;
  for (const session of sessions) {
    const phrases = phraseReconstruction.reconstructPhrases(session);
    totalPhrases += phrases.length;
    totalPhraseButtons += phrases.reduce(
      (sum, p) => sum + p.interactions.filter(i => i.activeInFinalPhrase && !i.isSystemAction).length, 0
    );
  }

  return {
    totalFinalUsers:          finalUsers.length,
    totalProfessionals:       professionals.length,
    totalParents:             parents.length,
    totalSessions,
    totalInteractions,
    totalPhrases,
    avgInteractionsPerPhrase: totalPhrases > 0
      ? Math.round((totalPhraseButtons / totalPhrases) * 10) / 10
      : 0,
    avgSessionDurationMs,
    avgSessionDurationLabel:  msToMinSec(avgSessionDurationMs),
  };
};

exports.getStatsByUserType = async ({ centro, excludeId, from, to }) => {
  const users = await getUsersForCenter(centro, excludeId, 'all');

  const groups = {
    user:         users.filter(u => u.type === 'user'),
    professional: users.filter(u => u.type === 'teacher' && u.professionalType),
    parent:       users.filter(u => u.type === 'parent'),
  };

  const result = [];
  for (const [role, roleUsers] of Object.entries(groups)) {
    const ids = roleUsers.map(u => u._id);
    if (ids.length === 0) {
      result.push({ role, totalUsers: 0, totalSessions: 0, totalInteractions: 0 });
      continue;
    }
    const sessions = await getSessions(ids, from, to);
    const interactions = sessions.flatMap(s => s.events || []).filter(e => e.type === 'button').length;
    result.push({ role, totalUsers: ids.length, totalSessions: sessions.length, totalInteractions: interactions });
  }

  return result;
};

exports.getUserStatistics = async ({ userId, from, to }) => {
  const user = await User.findById(userId).select('name email type professionalType centro').lean();
  if (!user) return null;

  const sessions     = await getSessions([userId], from, to);
  const allEvents    = sessions.flatMap(s => s.events || []);
  const buttonEvents = allEvents.filter(e => e.type === 'button');

  const pictCount = {};
  for (const ev of buttonEvents) {
    const key = ev.button_id || ev.label || 'desconocido';
    if (!pictCount[key]) pictCount[key] = { label: ev.label || key, imageUrl: ev.image_url || null, count: 0 };
    pictCount[key].count++;
  }
  const topPictograms = Object.values(pictCount).sort((a, b) => b.count - a.count).slice(0, 10);

  const boardCount = {};
  for (const ev of buttonEvents) {
    const key = ev.board_id || 'desconocido';
    if (!boardCount[key]) boardCount[key] = { boardId: key, count: 0 };
    boardCount[key].count++;
  }
  const topBoards = Object.values(boardCount).sort((a, b) => b.count - a.count).slice(0, 10);

  const actionDist = { voice: 0, navigate: 0, setSlot: 0, other: 0 };
  for (const ev of buttonEvents) {
    const actionsArr = ev.actions || [];
    if (actionsArr.some(a => a.action === '+speak'))             actionDist.voice++;
    else if (actionsArr.some(a => a.action === ':open_board'))   actionDist.navigate++;
    else if (actionsArr.some(a => a.action === 'ext_isaac_set_slot')) actionDist.setSlot++;
    else                                                          actionDist.other++;
  }

  const byDay = {};
  for (const ev of buttonEvents) {
    const day = ev.timestamp?.slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
  }
  const interactionsByDay = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const allPhrases = sessions.flatMap(s => phraseReconstruction.reconstructPhrases(s));

  const completedSessions = sessions.filter(s => s.started && s.ended);
  const avgSessionDurationMs = completedSessions.length
    ? Math.round(completedSessions.reduce((sum, s) =>
        sum + (new Date(s.ended) - new Date(s.started)), 0
      ) / completedSessions.length)
    : 0;

  return {
    user: { _id: userId, name: user.name, email: user.email, type: user.type },
    totalSessions:           sessions.length,
    totalInteractions:       buttonEvents.length,
    totalPhrases:            allPhrases.length,
    avgInteractionsPerPhrase: allPhrases.length
      ? Math.round(allPhrases.reduce((sum, p) =>
          sum + p.interactions.filter(i => i.activeInFinalPhrase && !i.isSystemAction).length, 0
        ) / allPhrases.length * 10) / 10
      : 0,
    avgSessionDurationMs,
    avgSessionDurationLabel: msToMinSec(avgSessionDurationMs),
    topPictograms,
    topBoards,
    actionDistribution:  actionDist,
    interactionsByDay,
  };
};

exports.getOrganizationPhrases = async ({ centro, excludeId, from, to, page = 1, pageSize = 20, scope = 'all' }) => {
  const users   = await getUsersForCenter(centro, excludeId, scope);
  const userIds = users.map(u => u._id);
  const sessions = await getSessions(userIds, from, to);

  const userMap = {};
  for (const u of users) userMap[u._id.toString()] = u.name;

  const allPhrases = sessions.flatMap(s => {
    const phrases = phraseReconstruction.reconstructPhrases(s);
    return phrases.map(p => ({ ...p, userName: userMap[p.userId] || p.userId }));
  }).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const total  = allPhrases.length;
  const offset = (page - 1) * pageSize;
  const paged  = allPhrases.slice(offset, offset + pageSize);

  await attachCustomPictogramImages(paged);
  await attachComprehensionScores(paged);

  return { phrases: paged, totalCount: total, page, pageSize };
};

exports.getUserPhrases = async ({ userId, from, to, page = 1, pageSize = 20 }) => {
  const user = await User.findById(userId).select('name').lean();
  const sessions = await getSessions([userId], from, to);

  const allPhrases = sessions
    .flatMap(s => phraseReconstruction.reconstructPhrases(s))
    .map(p => ({ ...p, userName: user?.name || userId }))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  const total  = allPhrases.length;
  const offset = (page - 1) * pageSize;
  const paged  = allPhrases.slice(offset, offset + pageSize);

  await attachCustomPictogramImages(paged);
  await attachComprehensionScores(paged);

  return { phrases: paged, totalCount: total, page, pageSize };
};

exports.getOrganizationCharts = async ({ centro, excludeId, from, to, scope = 'all' }) => {
  const users    = await getUsersForCenter(centro, excludeId, scope);
  const userIds  = users.map(u => u._id);
  const sessions = await getSessions(userIds, from, to);

  const allEvents    = sessions.flatMap(s => s.events || []);
  const buttonEvents = allEvents.filter(e => e.type === 'button');
  const actionEvents = allEvents.filter(e => e.type === 'action');

  const pictCount = {};
  for (const ev of buttonEvents) {
    const key = ev.label || ev.button_id || 'desconocido';
    pictCount[key] = (pictCount[key] || 0) + 1;
  }
  const topPictograms = Object.entries(pictCount)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  const boardCount = {};
  for (const ev of buttonEvents) {
    const key = ev.board_id || 'desconocido';
    boardCount[key] = (boardCount[key] || 0) + 1;
  }
  const rawTopBoards = Object.entries(boardCount)
    .sort(([, a], [, b]) => b - a).slice(0, 10);

  // Enriquecer IDs de tablero con nombres reales
  const boardIds = rawTopBoards.map(([id]) => id).filter(id => id !== 'desconocido');
  const boardNames = {};
  if (boardIds.length > 0) {
    const boards = await Board.find({ _id: { $in: boardIds } }).select('_id name').lean();
    for (const b of boards) boardNames[b._id.toString()] = b.name;
  }
  const topBoards = rawTopBoards.map(([id, value]) => ({
    label: boardNames[id] || id,
    value,
  }));

  const actionDist = { ':speak': 0, ':backspace': 0, ':clear': 0, ':open_board': 0, ':back': 0, ':home': 0 };
  for (const ev of actionEvents) {
    if (ev.action in actionDist) actionDist[ev.action]++;
  }
  const actionDistribution = Object.entries(actionDist)
    .map(([label, value]) => ({ label, value }))
    .filter(d => d.value > 0);

  const byDay = {};
  for (const ev of buttonEvents) {
    const day = ev.timestamp?.slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
  }
  const interactionsByDay = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-30)
    .map(([date, count]) => ({ label: date, value: count }));

  const userMap = {};
  for (const u of users) userMap[u._id.toString()] = u.name;
  const sessionsByUser = {};
  for (const s of sessions) {
    const uid = s.userId?.toString();
    if (!uid) continue;
    if (!sessionsByUser[uid]) sessionsByUser[uid] = { label: userMap[uid] || uid, value: 0 };
    sessionsByUser[uid].value += (s.events || []).filter(e => e.type === 'button').length;
  }
  const userActivity = Object.values(sessionsByUser).sort((a, b) => b.value - a.value).slice(0, 10);

  // Frases por día (para segunda serie del gráfico temporal)
  const phrasesByDayMap = {};
  for (const session of sessions) {
    const phrases = phraseReconstruction.reconstructPhrases(session);
    for (const phrase of phrases) {
      const day = phrase.startedAt?.slice(0, 10);
      if (day) phrasesByDayMap[day] = (phrasesByDayMap[day] || 0) + 1;
    }
  }
  const phrasesByDay = Object.entries(phrasesByDayMap)
    .sort(([a], [b]) => a.localeCompare(b)).slice(-30)
    .map(([date, count]) => ({ label: date, value: count }));

  return { topPictograms, topBoards, actionDistribution, interactionsByDay, phrasesByDay, userActivity };
};

/**
 * Estadísticas agrupadas por tablero (para la sección "Tableros" del dashboard).
 * Devuelve los tableros más usados enriquecidos con nombre, shape y contadores.
 */
exports.getOrganizationBoards = async ({ centro, excludeId, from, to, scope = 'all' }) => {
  const users    = await getUsersForCenter(centro, excludeId, scope);
  const userIds  = users.map(u => u._id);
  const sessions = await getSessions(userIds, from, to);

  const allEvents    = sessions.flatMap(s => s.events || []);
  const buttonEvents = allEvents.filter(e => e.type === 'button');
  const actionEvents = allEvents.filter(e => e.type === 'action');

  // Agrupar interacciones por board_id
  const boardMap = {};
  for (const ev of buttonEvents) {
    const bid = ev.board_id || 'desconocido';
    if (!boardMap[bid]) {
      boardMap[bid] = {
        boardId:       bid,
        interactions:  0,
        phrases:       0,
        voiceActions:  0,
        navActions:    0,
        backspaces:    0,
        clears:        0,
        speaks:        0,
      };
    }
    boardMap[bid].interactions++;

    const acts = ev.actions || [];
    if (acts.some(a => a.action === '+speak'))             boardMap[bid].voiceActions++;
    else if (acts.some(a => a.action === ':open_board'))   boardMap[bid].navActions++;
  }

  // Contabilizar acciones de sistema por sesión
  for (const ev of actionEvents) {
    // Las acciones de sistema no tienen board_id directo; usamos el último board activo
    // Es una aproximación suficiente para estadísticas.
    if (ev.action === ':backspace') {
      // No podemos asociar a un tablero específico sin más contexto; ignorar en breakdown de tablero
    }
  }

  // Contar frases por tablero (usando boardId del primer button de la frase)
  for (const session of sessions) {
    const phrases = phraseReconstruction.reconstructPhrases(session);
    for (const phrase of phrases) {
      const firstBoard = phrase.interactions.find(i => !i.isSystemAction && i.boardId)?.boardId;
      if (firstBoard && boardMap[firstBoard]) {
        boardMap[firstBoard].phrases++;
      }
    }
  }

  // Enriquecer con datos del Board
  const boardIds = Object.keys(boardMap).filter(id => id !== 'desconocido');
  if (boardIds.length > 0) {
    const boards = await Board.find({ _id: { $in: boardIds } })
      .select('_id name shape boardRole')
      .lean();
    for (const b of boards) {
      const bid = b._id.toString();
      if (boardMap[bid]) {
        boardMap[bid].name      = b.name;
        boardMap[bid].shape     = b.shape     || null;
        boardMap[bid].boardRole = b.boardRole || null;
      }
    }
  }

  return Object.values(boardMap)
    .sort((a, b) => b.interactions - a.interactions)
    .slice(0, 20);
};

// Expuesto solo para pruebas (lógica pura, sin Mongoose — ver scripts/test-phrase-image-resolution.js)
exports._mergeCustomPictogramImages = mergeCustomPictogramImages;
