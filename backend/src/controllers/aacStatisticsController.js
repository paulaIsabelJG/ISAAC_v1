const User    = require('../models/User');
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
