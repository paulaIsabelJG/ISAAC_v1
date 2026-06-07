const User      = require('../models/User');
const Objective = require('../models/Objective');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Calcula el estado efectivo: 'expired' si está activo y ya venció */
function effectiveStatus(obj) {
  if (obj.status === 'active' && new Date(obj.endDate) < new Date()) return 'expired';
  return obj.status;
}

/** Serializa un objetivo añadiendo effectiveStatus y commentsCount (sin el array completo) */
function serialize(obj) {
  const plain = obj.toObject ? obj.toObject() : { ...obj };
  plain.effectiveStatus = effectiveStatus(plain);
  plain.commentsCount   = plain.comments?.length ?? 0;
  delete plain.comments;
  return plain;
}

/** Serializa un lean-object de lista (sin toObject) */
function serializeList(o) {
  const { comments, ...rest } = o;
  return { ...rest, effectiveStatus: effectiveStatus(o), commentsCount: comments?.length ?? 0 };
}

const POPULATE_COMMENT_CREATOR = {
  path:   'comments.createdBy',
  select: 'name surname type professionalType',
};

/**
 * Verifica que el usuario autenticado puede acceder a un objetivo.
 * Retorna { ok, objective, viewer } o { ok: false, status, error }.
 */
async function checkAccess(objectiveId, userId) {
  const [objective, viewer] = await Promise.all([
    Objective.findById(objectiveId),
    User.findById(userId).select('type professionalType centro'),
  ]);
  if (!objective) return { ok: false, status: 404, error: 'Objetivo no encontrado' };
  if (!viewer)    return { ok: false, status: 404, error: 'Usuario no encontrado' };

  let canAccess = false;
  if (viewer.type === 'teacher') {
    canAccess = objective.centro === viewer.centro;
  } else if (viewer.type === 'parent') {
    canAccess = objective.showToFamily &&
      objective.familyRecipientIds.some(id => id.toString() === userId);
  } else if (viewer.type === 'user') {
    canAccess = objective.showToFinalUser &&
      objective.assignedUserIds.some(id => id.toString() === userId);
  }
  if (!canAccess) return { ok: false, status: 403, error: 'Sin acceso a este objetivo' };
  return { ok: true, objective, viewer };
}

/**
 * Verifica si el viewer tiene permiso para ver/comentar en el hilo de targetUserId.
 *
 * Reglas:
 *   - El targetUserId debe estar en assignedUserIds del objetivo.
 *   - teacher (org/profesional): puede ver cualquier hilo del objetivo.
 *   - user (usuario final): solo su propio hilo.
 *   - parent: solo hilos de sus hijos (via childrenAccess).
 */
async function canViewTargetThread(objective, viewer, viewerId, targetUserId) {
  const isAssigned = objective.assignedUserIds.some(id => id.toString() === targetUserId);
  if (!isAssigned) return false;

  if (viewer.type === 'teacher') return true;

  if (viewer.type === 'user') return viewerId === targetUserId;

  if (viewer.type === 'parent') {
    const parent = await User.findById(viewerId).select('childrenAccess');
    if (!parent) return false;
    return (parent.childrenAccess ?? []).some(ca => ca.childId?.toString() === targetUserId);
  }

  return false;
}

const POPULATE_USERS   = { path: 'assignedUserIds',    select: 'name surname email image' };
const POPULATE_FAMILY  = { path: 'familyRecipientIds', select: 'name surname email' };
const POPULATE_CREATOR = { path: 'createdBy',          select: 'name surname email professionalType' };

// ── POST /api/objectives ──────────────────────────────────────────────────────
exports.createObjective = async (req, res) => {
  try {
    const {
      title, description,
      assignedUserIds, familyRecipientIds,
      startDate, endDate,
      showToFinalUser, showToFamily,
    } = req.body;

    if (!title?.trim())
      return res.status(400).json({ error: 'El título es obligatorio' });
    if (!assignedUserIds?.length)
      return res.status(400).json({ error: 'Debe asignar al menos un usuario final' });
    if (!startDate || !endDate)
      return res.status(400).json({ error: 'Las fechas de inicio y fin son obligatorias' });
    if (new Date(endDate) <= new Date(startDate))
      return res.status(400).json({ error: 'La fecha de fin debe ser posterior a la de inicio' });
    if (showToFamily && !familyRecipientIds?.length)
      return res.status(400).json({ error: 'Si se avisa a familiares, selecciona al menos uno' });

    const creator = await User.findById(req.userId).select('type professionalType centro');
    if (!creator) return res.status(404).json({ error: 'Usuario no encontrado' });

    const createdByRole = (creator.type === 'teacher' && creator.professionalType)
      ? 'professional'
      : 'organization';

    const objective = new Objective({
      title:              title.trim(),
      description:        description?.trim() ?? '',
      assignedUserIds,
      familyRecipientIds: showToFamily ? (familyRecipientIds ?? []) : [],
      startDate:          new Date(startDate),
      endDate:            new Date(endDate),
      showToFinalUser:    !!showToFinalUser,
      showToFamily:       !!showToFamily,
      createdBy:          req.userId,
      createdByRole,
      centro:             creator.centro,
    });

    await objective.save();

    const populated = await Objective.findById(objective._id)
      .populate(POPULATE_USERS)
      .populate(POPULATE_FAMILY)
      .populate(POPULATE_CREATOR);

    res.status(201).json({ objective: serialize(populated) });
  } catch (err) {
    console.error('createObjective error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/objectives ───────────────────────────────────────────────────────
exports.getObjectives = async (req, res) => {
  try {
    const viewer = await User.findById(req.userId).select('type professionalType centro');
    if (!viewer) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { status: filterStatus, userId: filterUserId } = req.query;

    let query = {};

    if (viewer.type === 'teacher') {
      // Profesional: solo ve los suyos. Org: todos los de su centro.
      query.centro = viewer.centro;
      if (viewer.professionalType) query.createdBy = req.userId;
    } else if (viewer.type === 'parent') {
      query.familyRecipientIds = req.userId;
      query.showToFamily = true;
    } else if (viewer.type === 'user') {
      query.assignedUserIds = req.userId;
      query.showToFinalUser = true;
    }

    // Filtros adicionales
    if (filterUserId) {
      query.assignedUserIds = filterUserId;
    }

    // Filtro por estado (expired se calcula sobre active+fecha)
    if (filterStatus && filterStatus !== 'all') {
      if (filterStatus === 'expired') {
        query.status  = 'active';
        query.endDate = { $lt: new Date() };
      } else if (filterStatus === 'active') {
        query.status  = 'active';
        query.endDate = { $gte: new Date() };
      } else {
        query.status = filterStatus;
      }
    }

    const objectives = await Objective.find(query)
      .populate(POPULATE_USERS)
      .populate(POPULATE_FAMILY)
      .populate(POPULATE_CREATOR)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ objectives: objectives.map(serializeList) });
  } catch (err) {
    console.error('getObjectives error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/objectives/family ────────────────────────────────────────────────
// Objetivos visibles para el familiar autenticado
exports.getFamilyObjectives = async (req, res) => {
  try {
    const viewer = await User.findById(req.userId).select('type childrenAccess');
    if (viewer?.type !== 'parent') {
      return res.status(403).json({ error: 'Solo familiares pueden acceder a este endpoint' });
    }

    // IDs de hijos accesibles para este familiar
    const accessibleChildIds = new Set(
      (viewer.childrenAccess ?? []).map(ca => ca.childId?.toString()).filter(Boolean)
    );

    const objectives = await Objective.find({
      familyRecipientIds: req.userId,
      showToFamily:       true,
    })
      .populate(POPULATE_USERS)
      .populate(POPULATE_CREATOR)
      .sort({ createdAt: -1 })
      .lean();

    // Serializar contando solo comentarios de hilos accesibles para este familiar
    const serialized = objectives.map(o => {
      const { comments, ...rest } = o;
      const commentsCount = (comments ?? []).filter(
        c => accessibleChildIds.has(c.targetUserId?.toString())
      ).length;
      return { ...rest, effectiveStatus: effectiveStatus(o), commentsCount };
    });

    res.json({ objectives: serialized });
  } catch (err) {
    console.error('getFamilyObjectives error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/objectives/user/:userId ──────────────────────────────────────────
// Objetivos de un usuario final concreto
exports.getUserObjectives = async (req, res) => {
  try {
    const { userId } = req.params;
    const viewer = await User.findById(req.userId).select('type');

    let query = { assignedUserIds: userId };

    // Usuario final: solo puede ver los suyos con showToFinalUser activo
    if (viewer?.type === 'user') {
      if (req.userId !== userId) return res.status(403).json({ error: 'Sin acceso' });
      query.showToFinalUser = true;
    }

    const objectives = await Objective.find(query)
      .populate(POPULATE_USERS)
      .populate(POPULATE_FAMILY)
      .populate(POPULATE_CREATOR)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ objectives: objectives.map(serializeList) });
  } catch (err) {
    console.error('getUserObjectives error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/objectives/:id ───────────────────────────────────────────────────
exports.getObjectiveById = async (req, res) => {
  try {
    const objective = await Objective.findById(req.params.id)
      .populate(POPULATE_USERS)
      .populate(POPULATE_FAMILY)
      .populate(POPULATE_CREATOR);

    if (!objective) return res.status(404).json({ error: 'Objetivo no encontrado' });

    const viewer = await User.findById(req.userId).select('type professionalType centro');

    const canAccess =
      (viewer.type === 'teacher' && objective.centro === viewer.centro) ||
      (viewer.type === 'parent' &&
        objective.showToFamily &&
        objective.familyRecipientIds.some(f => f._id.toString() === req.userId)) ||
      (viewer.type === 'user' &&
        objective.showToFinalUser &&
        objective.assignedUserIds.some(u => u._id.toString() === req.userId));

    if (!canAccess) return res.status(403).json({ error: 'Sin acceso a este objetivo' });

    res.json({ objective: serialize(objective) });
  } catch (err) {
    console.error('getObjectiveById error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── PUT /api/objectives/:id ───────────────────────────────────────────────────
exports.updateObjective = async (req, res) => {
  try {
    const objective = await Objective.findById(req.params.id);
    if (!objective) return res.status(404).json({ error: 'Objetivo no encontrado' });

    if (objective.createdBy.toString() !== req.userId)
      return res.status(403).json({ error: 'Solo puedes editar objetivos que hayas creado tú' });
    if (objective.status === 'cancelled')
      return res.status(400).json({ error: 'No se puede editar un objetivo cancelado' });

    const {
      title, description,
      assignedUserIds, familyRecipientIds,
      startDate, endDate,
      showToFinalUser, showToFamily,
    } = req.body;

    if (title !== undefined)            objective.title       = title.trim();
    if (description !== undefined)      objective.description = description.trim();
    if (assignedUserIds !== undefined)  objective.assignedUserIds = assignedUserIds;
    if (startDate !== undefined)        objective.startDate   = new Date(startDate);
    if (endDate !== undefined)          objective.endDate     = new Date(endDate);
    if (showToFinalUser !== undefined)  objective.showToFinalUser = !!showToFinalUser;
    if (showToFamily !== undefined)     objective.showToFamily    = !!showToFamily;
    if (familyRecipientIds !== undefined) {
      objective.familyRecipientIds = objective.showToFamily ? familyRecipientIds : [];
    }

    if (objective.endDate <= objective.startDate)
      return res.status(400).json({ error: 'La fecha de fin debe ser posterior a la de inicio' });

    await objective.save();

    const populated = await Objective.findById(objective._id)
      .populate(POPULATE_USERS)
      .populate(POPULATE_FAMILY)
      .populate(POPULATE_CREATOR);

    res.json({ objective: serialize(populated) });
  } catch (err) {
    console.error('updateObjective error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── PATCH /api/objectives/:id/status ─────────────────────────────────────────
exports.updateObjectiveStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const VALID = ['active', 'completed', 'cancelled'];
    if (!VALID.includes(status))
      return res.status(400).json({ error: 'Estado no válido. Use: active, completed, cancelled' });

    const objective = await Objective.findById(req.params.id);
    if (!objective) return res.status(404).json({ error: 'Objetivo no encontrado' });

    if (objective.createdBy.toString() !== req.userId)
      return res.status(403).json({ error: 'Solo puedes cambiar el estado de objetivos que hayas creado tú' });

    objective.status = status;
    await objective.save();

    res.json({ objective: serialize(objective) });
  } catch (err) {
    console.error('updateObjectiveStatus error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/objectives/:id/comments?targetUserId=xxx ────────────────────────
// Devuelve el hilo de comentarios de un usuario final concreto en el objetivo.
exports.getObjectiveComments = async (req, res) => {
  try {
    const { targetUserId } = req.query;
    if (!targetUserId)
      return res.status(400).json({ error: 'targetUserId es obligatorio' });

    const { ok, objective, viewer, status, error } = await checkAccess(req.params.id, req.userId);
    if (!ok) return res.status(status).json({ error });

    const allowed = await canViewTargetThread(objective, viewer, req.userId, targetUserId);
    if (!allowed)
      return res.status(403).json({ error: 'Sin acceso a este hilo de comentarios' });

    const doc = await Objective.findById(req.params.id)
      .select('comments')
      .populate(POPULATE_COMMENT_CREATOR);

    const thread = (doc.comments ?? []).filter(
      c => c.targetUserId?.toString() === targetUserId
    );

    res.json({ comments: thread });
  } catch (err) {
    console.error('getObjectiveComments error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── POST /api/objectives/:id/comments ────────────────────────────────────────
// body: { text, targetUserId }
exports.addObjectiveComment = async (req, res) => {
  try {
    const { text, targetUserId } = req.body;
    if (!targetUserId)
      return res.status(400).json({ error: 'targetUserId es obligatorio' });

    const { ok, objective, viewer, status, error } = await checkAccess(req.params.id, req.userId);
    if (!ok) return res.status(status).json({ error });

    const allowed = await canViewTargetThread(objective, viewer, req.userId, targetUserId);
    if (!allowed)
      return res.status(403).json({ error: 'Sin permiso para comentar en este hilo' });

    if (!text?.trim())
      return res.status(400).json({ error: 'El comentario no puede estar vacío' });
    if (text.trim().length > 1000)
      return res.status(400).json({ error: 'El comentario no puede superar 1000 caracteres' });

    objective.comments.push({ text: text.trim(), createdBy: req.userId, targetUserId });
    await objective.save();

    const updated = await Objective.findById(req.params.id)
      .select('comments')
      .populate(POPULATE_COMMENT_CREATOR);

    const newComment = updated.comments[updated.comments.length - 1];
    const threadCount = updated.comments.filter(
      c => c.targetUserId?.toString() === targetUserId
    ).length;

    res.status(201).json({ comment: newComment, commentsCount: updated.comments.length, threadCount });
  } catch (err) {
    console.error('addObjectiveComment error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── PUT /api/objectives/:id/comments/:commentId ───────────────────────────────
exports.updateObjectiveComment = async (req, res) => {
  try {
    const { ok, objective, status, error } = await checkAccess(req.params.id, req.userId);
    if (!ok) return res.status(status).json({ error });

    const comment = objective.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });
    if (comment.createdBy.toString() !== req.userId)
      return res.status(403).json({ error: 'Solo puedes editar tus propios comentarios' });

    const { text } = req.body;
    if (!text?.trim())
      return res.status(400).json({ error: 'El comentario no puede estar vacío' });
    if (text.trim().length > 1000)
      return res.status(400).json({ error: 'El comentario no puede superar 1000 caracteres' });

    comment.text = text.trim();
    await objective.save();

    const updated = await Objective.findById(req.params.id)
      .select('comments')
      .populate(POPULATE_COMMENT_CREATOR);

    res.json({ comment: updated.comments.id(req.params.commentId) });
  } catch (err) {
    console.error('updateObjectiveComment error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── DELETE /api/objectives/:id/comments/:commentId ────────────────────────────
exports.deleteObjectiveComment = async (req, res) => {
  try {
    const { ok, objective, viewer, status, error } = await checkAccess(req.params.id, req.userId);
    if (!ok) return res.status(status).json({ error });

    const comment = objective.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    const isAuthor   = comment.createdBy.toString() === req.userId;
    const isOrgAdmin = viewer.type === 'teacher' && !viewer.professionalType &&
      objective.centro === viewer.centro;

    if (!isAuthor && !isOrgAdmin)
      return res.status(403).json({ error: 'Sin permiso para eliminar este comentario' });

    comment.deleteOne();
    await objective.save();

    res.json({ message: 'Comentario eliminado', commentsCount: objective.comments.length });
  } catch (err) {
    console.error('deleteObjectiveComment error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};
