const mongoose = require('mongoose');
const User  = require('../models/User');
const Board = require('../models/Board');

// ─── Helpers: personalización automática de tableros ─────────────────────────

/**
 * BFS desde tableros raíz siguiendo cell.action.targetBoardId y multiBoardSlots.boardId.
 * Devuelve todos los tableros accesibles (raíz + subtableros).
 */
async function collectBoardsBFS(rootBoards) {
  const visited = new Map();
  const queue   = [...rootBoards];
  for (const b of rootBoards) visited.set(String(b._id), b);

  while (queue.length > 0) {
    const board = queue.shift();
    const linkedIds = [
      ...(board.cells         ?? []).map(c => c.action?.targetBoardId),
      ...(board.multiBoardSlots ?? []).map(s => s.boardId),
    ].filter(id => id && !visited.has(String(id)));

    if (linkedIds.length === 0) continue;

    const subBoards = await Board.find({ _id: { $in: linkedIds } })
      .select('_id cells multiBoardSlots').lean();

    for (const sub of subBoards) {
      visited.set(String(sub._id), sub);
      queue.push(sub);
    }
  }
  return [...visited.values()];
}

/**
 * Para cada tablero de la lista, sustituye en sus celdas la imageUrl de los
 * pictogramas cuyos label coincidan (case-insensitive) con algún customPictogram.
 * Modifica la BD si hay cambios.
 */
async function applyPictoMapToBoards(boards, pictoMap) {
  if (pictoMap.size === 0) return;
  for (const board of boards) {
    const cells = board.cells ?? [];
    let changed = false;
    const updatedCells = cells.map(cell => {
      if (!cell.pictogram?.label) return cell;
      const match = pictoMap.get(cell.pictogram.label.toLowerCase().trim());
      if (!match) return cell;
      changed = true;
      return { ...cell, pictogram: { ...cell.pictogram, imageUrl: match.imageUrl, source: 'custom', id: String(match.id ?? '') } };
    });
    if (changed) {
      await Board.findByIdAndUpdate(board._id, { $set: { cells: updatedCells } });
    }
  }
}

/**
 * Aplica los customPictograms del usuario a todos sus tableros con autoPersonalize=true
 * (raíz + subtableros por BFS). Se ejecuta en background; no bloquea la respuesta HTTP.
 */
async function applyCustomPictogramsToUserBoards(userId, customPictograms) {
  if (!customPictograms?.length) return;

  const pictoMap = new Map();
  for (const p of customPictograms) {
    if (p.label && p.imageUrl) pictoMap.set(p.label.toLowerCase().trim(), p);
  }
  if (pictoMap.size === 0) return;

  const rootBoards = await Board.find({
    autoPersonalize: true,
    $or: [{ assignedUserIds: userId }, { userId }],
  }).select('_id cells multiBoardSlots').lean();

  if (rootBoards.length === 0) return;

  const allBoards = await collectBoardsBFS(rootBoards);
  await applyPictoMapToBoards(allBoards, pictoMap);
  console.log(`[autoPersonalize] userId=${userId}: personalización aplicada en ${allBoards.length} tableros`);
}

/**
 * Asigna el "Multitablero común" al nuevo usuario (si existe) y aplica
 * la personalización si el usuario ya tiene pictogramas propios.
 */
async function assignCommonBoardToNewUser(userId, customPictograms) {
  try {
    // Búsqueda case-insensitive para tolerar variaciones de mayúsculas/tildes
    const commonBoard = await Board.findOne({ name: /^multitablero\s+com[uú]n$/i });
    console.log('[assignCommonBoard] Buscando "Multitablero común"... encontrado:', commonBoard
      ? `id=${commonBoard._id} | boardRole=${commonBoard.boardRole} | visibleInProfile=${commonBoard.visibleInProfile}`
      : 'NO ENCONTRADO');
    if (!commonBoard) {
      // Listar tableros existentes para diagnóstico
      const allBoards = await Board.find({}).select('name boardRole visibleInProfile').lean();
      console.warn('[assignCommonBoard] Tableros en BD:', allBoards.map(b => b.name));
      return;
    }
    let dirty = false;
    const alreadyAssigned = commonBoard.assignedUserIds.some(id => String(id) === String(userId));
    if (!alreadyAssigned) {
      commonBoard.assignedUserIds.push(userId);
      if (!commonBoard.userId) commonBoard.userId = userId;
      dirty = true;
    }
    // Garantizar que el tablero esté publicado (visibleInProfile=true) para que
    // aparezca en la lista de tableros asignados del usuario
    if (!commonBoard.visibleInProfile) {
      commonBoard.visibleInProfile = true;
      dirty = true;
    }
    if (dirty) await commonBoard.save();
    console.log(`[createUser] "Multitablero común" asignado a userId=${userId}`);

    if (customPictograms?.length > 0) {
      await applyCustomPictogramsToUserBoards(userId, customPictograms);
    }
  } catch (err) {
    console.warn('[createUser] Error al asignar Multitablero común:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const sanitizeUser = (user) => {
  if (!user) return null;
  const sanitized = user.toObject ? user.toObject() : { ...user };
  delete sanitized.password;
  return sanitized;
};

const validateObjectId = (id) => !!id && mongoose.Types.ObjectId.isValid(id);

const ensureParentExists = async (parentId) => {
  if (!validateObjectId(parentId)) {
    throw new Error('ParentId must be a valid ObjectId');
  }

  const parent = await User.findById(parentId);
  if (!parent || parent.type !== 'parent') {
    throw new Error('ParentId must reference a parent user');
  }
  return parent;
};

const validateHijos = async (hijos) => {
  if (!Array.isArray(hijos)) {
    throw new Error('Hijos must be an array of ObjectIds');
  }

  const ids = hijos.map((id) => id.toString());
  for (const hijoId of ids) {
    if (!validateObjectId(hijoId)) {
      throw new Error('All hijos must be valid ObjectIds');
    }
  }

  const users = await User.find({ _id: { $in: ids } });
  if (users.length !== ids.length) {
    throw new Error('One or more hijos do not exist');
  }

  for (const hijo of users) {
    if (hijo.type !== 'user') {
      throw new Error('Hijos must be users');
    }
  }

  return users.map((user) => user._id);
};

const validateUserPayload = async (payload, existingUser = null, isCreate = false) => {
  const allowedTypes = ['teacher', 'parent', 'user'];
  const allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say'];

  const type = payload.type || existingUser?.type || 'user';
  const centro = payload.centro !== undefined ? payload.centro : existingUser?.centro;
  const hijos = payload.hijos !== undefined ? payload.hijos : existingUser?.hijos;
  const parentId = payload.parentId !== undefined ? payload.parentId : existingUser?.parentId;

  if (isCreate) {
    if (!payload.name || !payload.email || !payload.password) {
      throw new Error('name, email, and password are required');
    }
  }

  if (payload.type && !allowedTypes.includes(payload.type)) {
    throw new Error('Invalid user type. Must be: teacher, parent, or user');
  }

  if (payload.gender && !allowedGenders.includes(payload.gender)) {
    throw new Error('Invalid gender. Must be: male, female, other, or prefer_not_to_say');
  }

  if (type === 'teacher') {
    if (!centro) {
      throw new Error('Centro is required for teacher users');
    }
    if (payload.parentId) {
      throw new Error('Teachers cannot have parentId');
    }
    if (payload.hijos && payload.hijos.length > 0) {
      throw new Error('Teachers cannot have hijos');
    }
  }

  if (type === 'user') {
    if (!centro) {
      throw new Error('Centro is required for user users');
    }
    if (payload.hijos && payload.hijos.length > 0) {
      throw new Error('Users cannot have hijos');
    }
  }

  if (type === 'parent') {
    if (payload.parentId) {
      throw new Error('Parents cannot have parentId');
    }
  }

  let validatedHijos;
  if (payload.hijos !== undefined) {
    validatedHijos = await validateHijos(payload.hijos);
  }

  let validatedParentId;
  if (payload.parentId !== undefined) {
    if (payload.parentId) {
      const parent = await ensureParentExists(payload.parentId);
      validatedParentId = parent._id;
    } else {
      validatedParentId = null;
    }
  }

  return {
    type,
    centro,
    hijos:    validatedHijos,
    parentId: validatedParentId,
    name:     payload.name,
    surname:  payload.surname,
    email:    payload.email,
    password: payload.password,
    gender:   payload.gender,
    image:    payload.image,
    birthDate: payload.birthDate !== undefined ? (payload.birthDate || null) : undefined,
    address:   payload.address  !== undefined ? (payload.address  || null) : undefined,
  };
};

const removeChildFromParent = async (childId, parentId) => {
  if (!parentId) return;

  const parent = await User.findById(parentId);
  if (!parent) return;

  parent.hijos = parent.hijos.filter((hijoId) => hijoId.toString() !== childId.toString());
  await parent.save();
};

const addChildToParent = async (childId, parentId) => {
  if (!parentId) return;

  const parent = await ensureParentExists(parentId);
  const childString = childId.toString();
  if (!parent.hijos.some((hijoId) => hijoId.toString() === childString)) {
    parent.hijos.push(childId);
    await parent.save();
  }
};

const syncParentChildrenRelationship = async (parentId, newChildrenIds = [], previousChildrenIds = []) => {
  const newSet = new Set((newChildrenIds || []).map((id) => id.toString()));
  const prevSet = new Set((previousChildrenIds || []).map((id) => id.toString()));

  const removed = [...prevSet].filter((id) => !newSet.has(id));
  const added = [...newSet].filter((id) => !prevSet.has(id));

  for (const childId of removed) {
    const child = await User.findById(childId);
    if (child && child.parentId && child.parentId.toString() === parentId.toString()) {
      child.parentId = null;
      await child.save();
    }
  }

  for (const childId of added) {
    const child = await User.findById(childId);
    if (child) {
      child.parentId = parentId;
      await child.save();
    }
  }
};

const syncChildParentRelationship = async (childId, newParentId, previousParentId) => {
  const newParentString = newParentId ? newParentId.toString() : null;
  const previousParentString = previousParentId ? previousParentId.toString() : null;

  if (previousParentString && previousParentString !== newParentString) {
    await removeChildFromParent(childId, previousParentId);
  }

  if (newParentString && newParentString !== previousParentString) {
    await addChildToParent(childId, newParentId);
  }
};

const synchronizeRelationships = async (user, previousState = {}) => {
  const previousType = previousState.type;
  const currentType = user.type;

  if (previousType === 'parent' && currentType !== 'parent') {
    await syncParentChildrenRelationship(user._id, [], previousState.hijos || []);
  }

  if (previousType === 'user' && currentType !== 'user') {
    await removeChildFromParent(user._id, previousState.parentId);
  }

  if (currentType === 'parent') {
    await syncParentChildrenRelationship(user._id, user.hijos || [], previousState.hijos || []);
  }

  if (currentType === 'user') {
    await syncChildParentRelationship(user._id, user.parentId, previousState.parentId);
  }
};

exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId).select('-password').populate('hijos parentId');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('Get user by id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getUsersByCenter = async (req, res) => {
  try {
    const { centro } = req.params;
    if (!centro) {
      return res.status(400).json({ error: 'Centro is required' });
    }

    // Seleccionar solo los campos mínimos necesarios para UI.
    // Excluir customPictograms (array potencialmente grande) y datos sensibles.
    const users = await User.find({ centro })
      .select('_id name surname email type image centro gender')
      .lean();
    res.json({ users });
  } catch (error) {
    console.error('Get users by center error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getChildrenByParentId = async (req, res) => {
  try {
    const { parentId } = req.params;
    if (!validateObjectId(parentId)) {
      return res.status(400).json({ error: 'Invalid parent id' });
    }

    const parent = await User.findById(parentId);
    if (!parent || parent.type !== 'parent') {
      return res.status(404).json({ error: 'Parent not found' });
    }

    const childrenByParentId = await User.find({ parentId }).select('-password');
    const childrenByHijos = parent.hijos && parent.hijos.length > 0
      ? await User.find({ _id: { $in: parent.hijos } }).select('-password')
      : [];

    const childrenMap = new Map();
    [...childrenByParentId, ...childrenByHijos].forEach((child) => {
      childrenMap.set(child._id.toString(), child);
    });

    res.json({ children: Array.from(childrenMap.values()) });
  } catch (error) {
    console.error('Get children by parent id error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.createUser = async (req, res) => {
  try {
    const payload = req.body;
    const normalized = await validateUserPayload(payload, null, true);

    const existingUser = await User.findOne({ email: normalized.email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already taken by another user' });
    }

    const user = new User({
      name: normalized.name,
      email: normalized.email,
      password: normalized.password,
      type: normalized.type,
      gender: normalized.gender,
      image: normalized.image,
      centro: normalized.centro || null,
      hijos: normalized.hijos || [],
      parentId: normalized.parentId || null
    });

    await user.save();

    if (user.type === 'user' && user.parentId) {
      await addChildToParent(user._id, user.parentId);
    }

    if (user.type === 'parent' && user.hijos.length > 0) {
      await syncParentChildrenRelationship(user._id, user.hijos, []);
    }

    // Asignar el "Multitablero común" siempre, antes de responder
    if (user.type === 'user') {
      await assignCommonBoardToNewUser(String(user._id), user.customPictograms ?? []);
    }

    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

const applyUserUpdates = (user, updates) => {
  if (updates.name    !== undefined)  user.name    = updates.name;
  if (updates.surname !== undefined)  user.surname = updates.surname;
  if (updates.email   !== undefined)  user.email   = updates.email;
  if (updates.password !== undefined) user.password = updates.password;
  if (updates.type !== undefined)     user.type     = updates.type;
  if (updates.gender !== undefined)   user.gender   = updates.gender;
  if (updates.birthDate !== undefined)  user.birthDate = updates.birthDate;
  if (updates.address   !== undefined)  user.address   = updates.address;
  if (updates.image   !== undefined)  user.image   = updates.image;
  if (updates.centro  !== undefined)  user.centro  = updates.centro;
  if (updates.hijos !== undefined)    user.hijos    = updates.hijos;
  if (updates.parentId !== undefined) user.parentId = updates.parentId;
};

const updateUserInternal = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const previousState = {
      type: user.type,
      parentId: user.parentId ? user.parentId.toString() : null,
      hijos: Array.isArray(user.hijos) ? user.hijos.map((h) => h.toString()) : []
    };

    const payload = req.body;
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update' });
    }

    console.log('[PATCH user] address recibida:', payload.address);

    const normalized = await validateUserPayload(payload, user, false);

    if (payload.email && payload.email !== user.email) {
      const existingUser = await User.findOne({ email: payload.email });
      if (existingUser && existingUser._id.toString() !== userId) {
        return res.status(400).json({ error: 'Email already taken by another user' });
      }
    }

    applyUserUpdates(user, normalized);

    // selfPermissions: se maneja fuera de validateUserPayload (campo propio de usuario final)
    if (payload.selfPermissions !== undefined) {
      user.selfPermissions = {
        canEditPersonalData:    !!payload.selfPermissions?.canEditPersonalData,
        canEditBoards:          !!payload.selfPermissions?.canEditBoards,
        canViewStats:           !!payload.selfPermissions?.canViewStats,
        canAddPictograms:       !!payload.selfPermissions?.canAddPictograms,
        canAssignProfessionals: !!payload.selfPermissions?.canAssignProfessionals,
        canAssignFamilies:      !!payload.selfPermissions?.canAssignFamilies,
      };
    }

    // voiceSettings: configuración de síntesis de voz del usuario final
    if (payload.voiceSettings !== undefined) {
      const vs = payload.voiceSettings;
      if (!user.voiceSettings) user.voiceSettings = {};
      if (typeof vs.soundEnabled === 'boolean') user.voiceSettings.soundEnabled = vs.soundEnabled;
      if (vs.voiceMode === 'catalog' || vs.voiceMode === 'custom') user.voiceSettings.voiceMode = vs.voiceMode;
      if (vs.catalogVoice != null) {
        const cv = vs.catalogVoice;
        user.voiceSettings.catalogVoice = {
          voiceName:    typeof cv.voiceName    === 'string' ? cv.voiceName    : null,
          voiceLang:    typeof cv.voiceLang    === 'string' ? cv.voiceLang    : null,
          voiceURI:     typeof cv.voiceURI     === 'string' ? cv.voiceURI     : null,
          speechRate:   typeof cv.speechRate   === 'number' ? cv.speechRate   : 0.9,
          speechPitch:  typeof cv.speechPitch  === 'number' ? cv.speechPitch  : 1.0,
          speechVolume: typeof cv.speechVolume === 'number' ? cv.speechVolume : 1.0,
        };
      }
    }

    // Retrocompatibilidad: payload antiguo con ttsConfig → se mapea a catalogVoice
    if (payload.ttsConfig !== undefined && payload.voiceSettings === undefined) {
      const t = payload.ttsConfig;
      if (!user.voiceSettings) user.voiceSettings = {};
      user.voiceSettings.soundEnabled = typeof t.soundEnabled === 'boolean' ? t.soundEnabled : false;
      user.voiceSettings.voiceMode    = 'catalog';
      user.voiceSettings.catalogVoice = {
        voiceName:    typeof t.voiceName    === 'string' ? t.voiceName    : null,
        voiceLang:    typeof t.voiceLang    === 'string' ? t.voiceLang    : null,
        voiceURI:     typeof t.voiceURI     === 'string' ? t.voiceURI     : null,
        speechRate:   typeof t.speechRate   === 'number' ? t.speechRate   : 0.9,
        speechPitch:  typeof t.speechPitch  === 'number' ? t.speechPitch  : 1.0,
        speechVolume: typeof t.speechVolume === 'number' ? t.speechVolume : 1.0,
      };
    }

    await user.save();

    await synchronizeRelationships(user, previousState);

    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

exports.updateUserById = updateUserInternal;
exports.patchUserById = updateUserInternal;

exports.deleteUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.type === 'user' && user.parentId) {
      await removeChildFromParent(user._id, user.parentId);
    }

    if (user.type === 'parent' && user.hijos && user.hijos.length > 0) {
      await syncParentChildrenRelationship(user._id, [], user.hijos);
    }

    await User.findByIdAndDelete(userId);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getCustomPictogramsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId).select('customPictograms');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ pictograms: user.customPictograms });
  } catch (error) {
    console.error('Get user pictograms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addCustomPictogramToUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const { id, label, imageUrl, wordType, description } = req.body;

    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (!id || !label || !imageUrl) {
      return res.status(400).json({ error: 'id, label, and imageUrl are required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.customPictograms.push({
      id,
      label,
      imageUrl,
      wordType:    wordType    || 'misc',
      description: description || '',
      createdAt: new Date()
    });

    await user.save();

    // Aplicar en background la personalización en tableros con autoPersonalize
    applyCustomPictogramsToUserBoards(userId, user.customPictograms)
      .catch(err => console.warn('[addPictogram] Error en autoPersonalize:', err.message));

    res.status(201).json({
      message: 'Custom pictogram added successfully',
      pictogram: user.customPictograms[user.customPictograms.length - 1]
    });
  } catch (error) {
    console.error('Add user pictogram error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteCustomPictogramByUserId = async (req, res) => {
  try {
    const { userId, pictogramId } = req.params;

    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedPictogramId = isNaN(Number(pictogramId)) ? pictogramId : Number(pictogramId);
    const pictogramIndex = user.customPictograms.findIndex((p) => p.id === normalizedPictogramId || p.id?.toString() === pictogramId.toString());
    if (pictogramIndex === -1) {
      return res.status(404).json({ error: 'Pictogram not found' });
    }

    user.customPictograms.splice(pictogramIndex, 1);
    await user.save();

    res.json({ message: 'Custom pictogram deleted successfully' });
  } catch (error) {
    console.error('Delete user pictogram error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ─── childrenAccess: familiar → usuarios finales a cargo ─────────────────────

/**
 * PUT /api/users/:parentId/children-access
 * Reemplaza la lista completa de childrenAccess para un familiar (type='parent').
 * Mantiene compatibilidad con hijos[] y parentId en los hijos.
 * Body: { childrenAccess: [{ childId, canViewStats, canEditBoards, canEditPersonalData }] }
 */
exports.updateChildrenAccess = async (req, res) => {
  try {
    const { parentId }       = req.params;
    const { childrenAccess } = req.body;

    if (!validateObjectId(parentId)) {
      return res.status(400).json({ error: 'Invalid parentId' });
    }
    if (!Array.isArray(childrenAccess)) {
      return res.status(400).json({ error: 'childrenAccess must be an array' });
    }

    const parent = await User.findById(parentId);
    if (!parent) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    if (parent.type !== 'parent') {
      return res.status(400).json({ error: 'User is not of type parent' });
    }

    // Validar que todos los childId son usuarios reales de tipo user
    const newChildIds = [];
    for (const entry of childrenAccess) {
      if (!validateObjectId(entry.childId)) {
        return res.status(400).json({ error: `Invalid childId: ${entry.childId}` });
      }
      const child = await User.findById(entry.childId).select('type');
      if (!child) {
        return res.status(404).json({ error: `Child not found: ${entry.childId}` });
      }
      if (child.type !== 'user') {
        return res.status(400).json({
          error: `User ${entry.childId} is not a final user (type must be 'user')`
        });
      }
      newChildIds.push(entry.childId.toString());
    }

    // Capturar hijos anteriores para detectar cambios
    const previousHijoIds = (parent.hijos || []).map((id) => id.toString());

    // Actualizar childrenAccess y hijos[] en el familiar (compatibilidad)
    parent.childrenAccess = childrenAccess.map((e) => ({
      childId:               e.childId,
      canViewStats:          !!e.canViewStats,
      canEditBoards:         !!e.canEditBoards,
      canEditPersonalData:   !!e.canEditPersonalData,
      canAddPictograms:      !!e.canAddPictograms,
      canAssignProfessionals: !!e.canAssignProfessionals,
      canAssignFamilies:     !!e.canAssignFamilies,
      canViewAssignedBoards: !!e.canViewAssignedBoards,
    }));
    parent.hijos = newChildIds;

    await parent.save();

    // Actualizar parentId en hijos añadidos (compatibilidad)
    const added   = newChildIds.filter((id) => !previousHijoIds.includes(id));
    const removed = previousHijoIds.filter((id) => !newChildIds.includes(id));

    for (const childId of added) {
      await User.findByIdAndUpdate(childId, { $set: { parentId } });
    }
    // Retirar parentId solo si apuntaba a este familiar
    for (const childId of removed) {
      await User.findOneAndUpdate(
        { _id: childId, parentId: parentId },
        { $set: { parentId: null } }
      );
    }

    res.json({
      message: 'Children access updated successfully',
      count:   parent.childrenAccess.length,
    });
  } catch (error) {
    console.error('Update children access error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

// ─── Profesionales asignados ──────────────────────────────────────────────────

/**
 * GET /api/users/:userId/assigned-professionals
 * Devuelve los profesionales asignados a un usuario final, populados con sus datos.
 */
exports.getAssignedProfessionals = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(userId)
      .select('assignedProfessionals')
      .populate('assignedProfessionals.professionalId', 'name email image');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = (user.assignedProfessionals || [])
      .filter((ap) => !!ap.professionalId)
      .map((ap) => {
        const prof    = ap.professionalId;
        const rawName = (prof.name || '').trim();
        return {
          professionalId:         prof._id.toString(),
          name:    prof.surname !== undefined ? rawName : (rawName.split(/\s+/)[0] ?? ''),
          surname: prof.surname !== undefined ? (prof.surname ?? '') : rawName.split(/\s+/).slice(1).join(' '),
          email:                  prof.email,
          image:                  prof.image || null,
          canViewStats:           ap.canViewStats,
          canEditBoards:          ap.canEditBoards,
          canEditPersonalData:    ap.canEditPersonalData,
          canAddPictograms:       ap.canAddPictograms       ?? false,
          canAssignProfessionals: ap.canAssignProfessionals ?? false,
          canAssignFamilies:      ap.canAssignFamilies      ?? false,
          canViewAssignedBoards:  ap.canViewAssignedBoards  ?? false,
        };
      });

    res.json({ assignedProfessionals: result });
  } catch (error) {
    console.error('Get assigned professionals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * PUT /api/users/:userId/assigned-professionals
 * Reemplaza la lista completa de profesionales asignados al usuario final.
 * Body: { assignedProfessionals: [{ professionalId, canViewStats, canEditBoards, canEditPersonalData }] }
 */
exports.updateAssignedProfessionals = async (req, res) => {
  try {
    const { userId }             = req.params;
    const { assignedProfessionals } = req.body;

    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    if (!Array.isArray(assignedProfessionals)) {
      return res.status(400).json({ error: 'assignedProfessionals must be an array' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Validar que todos los professionalId existen y son type=teacher
    for (const ap of assignedProfessionals) {
      if (!validateObjectId(ap.professionalId)) {
        return res.status(400).json({ error: `Invalid professionalId: ${ap.professionalId}` });
      }
      const prof = await User.findById(ap.professionalId).select('type');
      if (!prof) {
        return res.status(404).json({ error: `Professional not found: ${ap.professionalId}` });
      }
      if (prof.type !== 'teacher') {
        return res.status(400).json({
          error: `User ${ap.professionalId} is not a professional (type must be 'teacher')`
        });
      }
    }

    // Reemplazar lista completa
    user.assignedProfessionals = assignedProfessionals.map((ap) => ({
      professionalId:         ap.professionalId,
      canViewStats:           !!ap.canViewStats,
      canEditBoards:          !!ap.canEditBoards,
      canEditPersonalData:    !!ap.canEditPersonalData,
      canAddPictograms:       !!ap.canAddPictograms,
      canAssignProfessionals: !!ap.canAssignProfessionals,
      canAssignFamilies:      !!ap.canAssignFamilies,
      canViewAssignedBoards:  !!ap.canViewAssignedBoards,
    }));

    await user.save();

    res.json({
      message: 'Assigned professionals updated successfully',
      count:   user.assignedProfessionals.length,
    });
  } catch (error) {
    console.error('Update assigned professionals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/users/:professionalId/assigned-users
 * Devuelve todos los usuarios finales (type='user') que tienen este profesional
 * en su array assignedProfessionals, junto a los permisos asignados.
 */
exports.getAssignedUsers = async (req, res) => {
  try {
    const { professionalId } = req.params;
    if (!validateObjectId(professionalId)) {
      return res.status(400).json({ error: 'Invalid professionalId' });
    }

    const users = await User.find({
      type: 'user',
      'assignedProfessionals.professionalId': professionalId,
    }).select('name surname email image assignedProfessionals').lean();

    const result = users.map((user) => {
      const ap = (user.assignedProfessionals || []).find(
        (e) => e.professionalId?.toString() === professionalId
      );
      const rawName = (user.name || '').trim();
      return {
        userId:                 user._id.toString(),
        name:    user.surname !== undefined ? rawName : (rawName.split(/\s+/)[0] ?? ''),
        surname: user.surname !== undefined ? (user.surname ?? '') : rawName.split(/\s+/).slice(1).join(' '),
        email:                  user.email,
        image:                  user.image || null,
        canEditPersonalData:    ap?.canEditPersonalData    ?? false,
        canEditBoards:          ap?.canEditBoards           ?? false,
        canViewStats:           ap?.canViewStats            ?? false,
        canAddPictograms:       ap?.canAddPictograms        ?? false,
        canAssignProfessionals: ap?.canAssignProfessionals  ?? false,
        canAssignFamilies:      ap?.canAssignFamilies       ?? false,
        canViewAssignedBoards:  ap?.canViewAssignedBoards   ?? false,
      };
    });

    res.json({ users: result });
  } catch (error) {
    console.error('Get assigned users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.addCustomPictogram = async (req, res) => {
  try {
    const { label, imageUrl } = req.body;
    const userId = req.userId;

    if (!label || !imageUrl) {
      return res.status(400).json({ error: 'Label and imageUrl are required' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const id = user.generatePictogramId();
    user.customPictograms.push({
      id,
      label,
      imageUrl,
      createdAt: new Date()
    });

    await user.save();

    // Aplicar en background la personalización en tableros con autoPersonalize
    applyCustomPictogramsToUserBoards(String(user._id), user.customPictograms)
      .catch(err => console.warn('[addPictogram] Error en autoPersonalize:', err.message));

    res.status(201).json({
      message: 'Custom pictogram added successfully',
      pictogram: user.customPictograms[user.customPictograms.length - 1]
    });
  } catch (error) {
    console.error('Add custom pictogram error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.getCustomPictograms = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ pictograms: user.customPictograms });
  } catch (error) {
    console.error('Get custom pictograms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.deleteCustomPictogram = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const normalizedPictogramId = isNaN(Number(id)) ? id : Number(id);
    const pictogramIndex = user.customPictograms.findIndex(
      (p) => p.id === normalizedPictogramId || p.id?.toString() === id.toString()
    );
    if (pictogramIndex === -1) {
      return res.status(404).json({ error: 'Pictogram not found' });
    }

    user.customPictograms.splice(pictogramIndex, 1);
    await user.save();

    res.json({ message: 'Custom pictogram deleted successfully' });
  } catch (error) {
    console.error('Delete custom pictogram error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/users/families-for-users?userIds=id1,id2 ─────────────────────────
// Devuelve familiares (type='parent') vinculados a los usuarios finales indicados.
// Usado en el formulario de objetivos para mostrar qué familiares avisar.
exports.getFamiliesForUsers = async (req, res) => {
  try {
    const { userIds } = req.query;
    if (!userIds) return res.json({ families: [] });

    const ids = userIds.split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length) return res.json({ families: [] });

    const families = await User.find({
      type: 'parent',
      'childrenAccess.childId': { $in: ids },
    }).select('name surname email image').lean();

    res.json({ families });
  } catch (err) {
    console.error('getFamiliesForUsers error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};
