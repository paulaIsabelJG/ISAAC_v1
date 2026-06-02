const { createHash, randomUUID } = require('crypto');
const User    = require('../models/User');
const OblLog  = require('../models/OblLog');
const statsSvc = require('../services/aacStatisticsService');

// ── Helpers de permisos ───────────────────────────────────────────────────────

async function resolveAccessContext(authUserId) {
  const authUser = await User.findById(authUserId)
    .select('type professionalType centro')
    .lean();
  if (!authUser) return null;

  if (authUser.type === 'teacher' && !authUser.professionalType) {
    return { centro: authUser.centro, isOrg: true, isProfessional: false };
  }

  if (authUser.type === 'teacher' && authUser.professionalType) {
    const assignedUsers = await User.find({
      'assignedProfessionals.professionalId': authUserId,
    }).select('_id').lean();
    return {
      centro:          authUser.centro,
      isOrg:           false,
      isProfessional:  true,
      assignedUserIds: assignedUsers.map(u => u._id.toString()),
    };
  }

  return null;
}

function parseFilters(query) {
  return {
    from:     query.from     || null,
    to:       query.to       || null,
    scope:    query.scope    || 'all',   // 'all' | 'users' | 'professionals' | 'families'
    page:     parseInt(query.page, 10)     || 1,
    pageSize: parseInt(query.pageSize, 10) || 20,
  };
}

// ── Controllers ───────────────────────────────────────────────────────────────

exports.getOrganizationSummary = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg) return res.status(403).json({ error: 'Acceso denegado. Solo organizaciones.' });
    if (!ctx.centro)        return res.status(400).json({ error: 'La organización no tiene centro asignado.' });

    const { from, to, scope } = parseFilters(req.query);
    const data = await statsSvc.getOrganizationSummary({ centro: ctx.centro, excludeId: req.userId, from, to, scope });
    res.json(data);
  } catch (err) {
    console.error('[Stats] getOrganizationSummary error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getStatsByUserType = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg) return res.status(403).json({ error: 'Acceso denegado.' });

    const { from, to } = parseFilters(req.query);
    const data = await statsSvc.getStatsByUserType({ centro: ctx.centro, excludeId: req.userId, from, to });
    res.json({ byRole: data });
  } catch (err) {
    console.error('[Stats] getStatsByUserType error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getOrganizationCharts = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg) return res.status(403).json({ error: 'Acceso denegado.' });

    const { from, to, scope } = parseFilters(req.query);
    const data = await statsSvc.getOrganizationCharts({ centro: ctx.centro, excludeId: req.userId, from, to, scope });
    res.json(data);
  } catch (err) {
    console.error('[Stats] getOrganizationCharts error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getOrganizationBoards = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg) return res.status(403).json({ error: 'Acceso denegado.' });

    const { from, to, scope } = parseFilters(req.query);
    const data = await statsSvc.getOrganizationBoards({ centro: ctx.centro, excludeId: req.userId, from, to, scope });
    res.json({ boards: data });
  } catch (err) {
    console.error('[Stats] getOrganizationBoards error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getUserStatistics = async (req, res) => {
  try {
    const { userId } = req.params;
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx) return res.status(403).json({ error: 'Acceso denegado.' });

    if (ctx.isProfessional && !ctx.assignedUserIds.includes(userId)) {
      return res.status(403).json({ error: 'Usuario no asignado a este profesional.' });
    }
    if (ctx.isOrg) {
      const target = await User.findById(userId).select('centro').lean();
      if (!target || target.centro !== ctx.centro) {
        return res.status(403).json({ error: 'El usuario no pertenece a esta organización.' });
      }
    }

    const { from, to } = parseFilters(req.query);
    const data = await statsSvc.getUserStatistics({ userId, from, to });
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(data);
  } catch (err) {
    console.error('[Stats] getUserStatistics error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getOrganizationPhrases = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg) return res.status(403).json({ error: 'Acceso denegado.' });

    const { from, to, page, pageSize, scope } = parseFilters(req.query);
    const data = await statsSvc.getOrganizationPhrases({
      centro: ctx.centro, excludeId: req.userId, from, to, page, pageSize, scope,
    });
    res.json(data);
  } catch (err) {
    console.error('[Stats] getOrganizationPhrases error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deletePhrase = async (req, res) => {
  try {
    const { phraseId } = req.params;
    // phraseId = sessionId_startMs (sessionId es UUID sin guiones bajos)
    const underscoreIdx = phraseId.indexOf('_');
    if (underscoreIdx === -1) return res.status(400).json({ error: 'Formato de phraseId inválido.' });
    const sessionId = phraseId.slice(0, underscoreIdx);

    const ctx = await resolveAccessContext(req.userId);
    if (!ctx) return res.status(403).json({ error: 'Acceso denegado.' });

    const session = await OblLog.findOne({ sessionId }).select('userId').lean();
    if (!session) return res.status(404).json({ error: 'Frase no encontrada.' });

    const sessionUser = await User.findById(session.userId).select('centro').lean();
    if (!sessionUser) return res.status(404).json({ error: 'Usuario no encontrado.' });

    if (ctx.isProfessional && !ctx.assignedUserIds.includes(session.userId.toString())) {
      return res.status(403).json({ error: 'No tienes acceso a este usuario.' });
    }
    if (ctx.isOrg && sessionUser.centro !== ctx.centro) {
      return res.status(403).json({ error: 'El usuario no pertenece a tu organización.' });
    }

    await OblLog.updateOne({ sessionId }, { $addToSet: { deletedPhraseKeys: phraseId } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Stats] deletePhrase error', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getUserPhrases = async (req, res) => {
  try {
    const { userId } = req.params;
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx) return res.status(403).json({ error: 'Acceso denegado.' });

    if (ctx.isProfessional && !ctx.assignedUserIds.includes(userId)) {
      return res.status(403).json({ error: 'Usuario no asignado a este profesional.' });
    }
    if (ctx.isOrg) {
      const target = await User.findById(userId).select('centro').lean();
      if (!target || target.centro !== ctx.centro) {
        return res.status(403).json({ error: 'El usuario no pertenece a esta organización.' });
      }
    }

    const { from, to, page, pageSize } = parseFilters(req.query);
    const data = await statsSvc.getUserPhrases({ userId, from, to, page, pageSize });
    res.json(data);
  } catch (err) {
    console.error('[Stats] getUserPhrases error', err);
    res.status(500).json({ error: err.message });
  }
};

// ── Exportación OBLA ──────────────────────────────────────────────────────────

exports.exportObla = async (req, res) => {
  try {
    const ctx = await resolveAccessContext(req.userId);
    if (!ctx || !ctx.isOrg)
      return res.status(403).json({ error: 'Acceso denegado. Solo organizaciones.' });
    if (!ctx.centro)
      return res.status(400).json({ error: 'La organización no tiene centro asignado.' });

    const {
      dateFilter: df = 'all',
      dateFrom,
      dateTo,
      boardId,
      exportScope  = 'userType',
      userType     = 'user',
      familyUserId,
      userId: targetUserId,
    } = req.body;

    // ── Rango de fechas ──────────────────────────────────────────────────────
    let from = null, to = null;
    const now = new Date();
    if (df === 'today') {
      const s = new Date(now); s.setHours(0, 0, 0, 0);
      const e = new Date(now); e.setHours(23, 59, 59, 999);
      from = s.toISOString(); to = e.toISOString();
    } else if (df === '7days') {
      const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString();
    } else if (df === '30days') {
      const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString();
    } else if (df === 'custom') {
      from = dateFrom || null; to = dateTo || null;
    }

    // ── Usuarios objetivo ────────────────────────────────────────────────────
    let targetUsers = [];

    if (exportScope === 'userType') {
      const q = { centro: ctx.centro };
      if      (userType === 'user')         { q.type = 'user'; }
      else if (userType === 'professional') { q.type = 'teacher'; q.professionalType = { $ne: null }; }
      else if (userType === 'parent')       { q.type = 'parent'; }
      targetUsers = await User.find(q).select('_id type').lean();
    } else if (exportScope === 'family') {
      if (!familyUserId) return res.status(400).json({ error: 'Falta familyUserId.' });
      const fu = await User.findOne({ _id: familyUserId, centro: ctx.centro, type: 'user' }).lean();
      if (!fu) return res.status(404).json({ error: 'Usuario no encontrado.' });
      const parents = await User.find({ hijos: fu._id }).select('_id type').lean();
      targetUsers = [fu, ...parents];
    } else if (exportScope === 'user') {
      if (!targetUserId) return res.status(400).json({ error: 'Falta userId.' });
      const u = await User.findOne({ _id: targetUserId, centro: ctx.centro }).lean();
      if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
      targetUsers = [u];
    }

    const userIds = targetUsers.map(u => u._id);

    // ── Sesiones ─────────────────────────────────────────────────────────────
    const sessionQ = { userId: { $in: userIds } };
    if (from || to) {
      sessionQ.started = {};
      if (from) sessionQ.started.$gte = from;
      if (to)   sessionQ.started.$lte = to;
    }
    let sessions = await OblLog.find(sessionQ).lean();

    if (boardId) {
      sessions = sessions.filter(s =>
        (s.events || []).some(e => e.type === 'button' && e.board_id === boardId)
      );
    }

    sessions.sort((a, b) => {
      if (!a.started) return 1;
      if (!b.started) return -1;
      return new Date(a.started) - new Date(b.started);
    });

    // ── Anonimización estable dentro de la exportación ───────────────────────
    const salt = randomUUID();
    const anon = id =>
      id ? createHash('sha256').update(salt + String(id)).digest('hex').slice(0, 16) : 'unknown';

    // ── Construcción OBLA ────────────────────────────────────────────────────
    const oblaSessions = sessions.map(session => {
      const sessionEvents = [...(session.events || [])]
        .filter(e => e.type === 'button' || e.type === 'utterance')
        .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0))
        .map(e => {
          if (e.type === 'button') {
            const ev = {
              type:      'button',
              timestamp: e.timestamp,
              label:     e.label || '',
              button_id: anon(e.button_id),
              board_id:  anon(e.board_id),
              spoken:    !!e.spoken,
            };
            const navActions = (e.actions || []).filter(a => a.action === ':open_board');
            if (navActions.length) {
              ev.actions = navActions.map(a => ({
                action:               ':open_board',
                destination_board_id: anon(a.destination_board_id),
              }));
            }
            return ev;
          }
          return {
            type:      'utterance',
            timestamp: e.timestamp,
            text:      e.text || '',
            buttons:   (e.buttons || []).map(b => anon(b)),
          };
        });

      return {
        id:             anon(session.sessionId),
        type:           'log',
        started:        session.started || null,
        ended:          session.ended   || null,
        user_id:        anon(session.userId),
        anonymizations: ['id_pseudonymization', 'name_masking', 'url_stripping', 'extras_removed'],
        events:         sessionEvents,
      };
    });

    const obla = {
      format:     'open-board-log-0.1',
      anonymized: true,
      source:     'ISAAC',
      locale:     'es',
      user_id:    oblaSessions.length === 1 ? oblaSessions[0].user_id : 'multi-user',
      sessions:   oblaSessions,
    };

    const date    = new Date().toISOString().split('T')[0];
    const orgSlug = ctx.centro.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="estadisticas-${orgSlug}-${date}.obla"`);
    return res.json(obla);

  } catch (err) {
    console.error('[Stats] exportObla error', err);
    res.status(500).json({ error: err.message });
  }
};
