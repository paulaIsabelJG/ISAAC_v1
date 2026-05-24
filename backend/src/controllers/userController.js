const mongoose = require('mongoose');
const User = require('../models/User');

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
    hijos: validatedHijos,
    parentId: validatedParentId,
    name: payload.name,
    email: payload.email,
    password: payload.password,
    gender: payload.gender,
    image: payload.image
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

    const users = await User.find({ centro }).select('-password');
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

    res.status(201).json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

const applyUserUpdates = (user, updates) => {
  if (updates.name !== undefined) user.name = updates.name;
  if (updates.email !== undefined) user.email = updates.email;
  if (updates.password !== undefined) user.password = updates.password;
  if (updates.type !== undefined) user.type = updates.type;
  if (updates.gender !== undefined) user.gender = updates.gender;
  if (updates.image !== undefined) user.image = updates.image;
  if (updates.centro !== undefined) user.centro = updates.centro;
  if (updates.hijos !== undefined) user.hijos = updates.hijos;
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
        canEditPersonalData: !!payload.selfPermissions?.canEditPersonalData,
        canEditBoards:       !!payload.selfPermissions?.canEditBoards,
        canViewStats:        !!payload.selfPermissions?.canViewStats,
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
      childId:            e.childId,
      canViewStats:       !!e.canViewStats,
      canEditBoards:      !!e.canEditBoards,
      canEditPersonalData: !!e.canEditPersonalData,
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
        const prof  = ap.professionalId;
        const parts = (prof.name || '').trim().split(/\s+/);
        return {
          professionalId:     prof._id.toString(),
          name:               parts[0] ?? '',
          surname:            parts.slice(1).join(' '),
          email:              prof.email,
          image:              prof.image || null,
          canViewStats:       ap.canViewStats,
          canEditBoards:      ap.canEditBoards,
          canEditPersonalData: ap.canEditPersonalData,
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
      professionalId:     ap.professionalId,
      canViewStats:       !!ap.canViewStats,
      canEditBoards:      !!ap.canEditBoards,
      canEditPersonalData: !!ap.canEditPersonalData,
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
