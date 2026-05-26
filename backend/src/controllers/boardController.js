const mongoose = require('mongoose');
const Board = require('../models/Board');
const User  = require('../models/User');

const validateObjectId = (id) => !!id && mongoose.Types.ObjectId.isValid(id);

// ── GET /api/boards/my  — tableros donde yo soy creador ───────────────────────
exports.getMyBoards = async (req, res) => {
  try {
    // Resolver tipo del usuario para logs y fallback
    const currentUser = await User.findById(req.userId).select('type').lean();
    const userType = currentUser?.type ?? 'unknown';

    // Consulta principal: tableros donde createdBy == yo
    // Fallback legacy: tableros sin createdBy donde creatorId == yo
    // (datos creados antes de añadir el campo createdBy)
    const query = {
      $or: [
        { createdBy: req.userId },
        { createdBy: { $exists: false }, creatorId: req.userId },
      ],
    };

    console.log('[getMyBoards]', {
      currentUser: req.userId,
      type:        userType,
      query,
    });

    const boards = await Board.find(query)
      .sort({ createdAt: -1 })
      .select('-cells');

    res.json({ boards });
  } catch (err) {
    console.error('getMyBoards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/boards/builder/:creatorId  — tableros de un builder concreto ─────
// Permisos:
//   - req.userId === creatorId                  → siempre permitido (mi propio builder)
//   - req.userId es teacher/parent del mismo centro → permitido
//   - cualquier otro caso                       → 403
exports.getBoardsByCreator = async (req, res) => {
  try {
    const { creatorId } = req.params;
    if (!validateObjectId(creatorId)) {
      return res.status(400).json({ error: 'Invalid creatorId' });
    }

    // ── Control de acceso ────────────────────────────────────────────────────
    if (String(req.userId) !== String(creatorId)) {
      const [sessionUser, creatorUser] = await Promise.all([
        User.findById(req.userId).select('type centro').lean(),
        User.findById(creatorId).select('centro').lean(),
      ]);

      const sameCenter =
        sessionUser?.centro &&
        creatorUser?.centro &&
        String(sessionUser.centro) === String(creatorUser.centro);

      const canAccess =
        (sessionUser?.type === 'teacher' || sessionUser?.type === 'parent') &&
        sameCenter;

      if (!canAccess) {
        console.warn('[getBoardsByCreator] 403', {
          requestedBy: req.userId,
          creatorId,
          sessionType: sessionUser?.type,
          sessionCentro: sessionUser?.centro,
          creatorCentro: creatorUser?.centro,
        });
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // ── Consulta con fallback legacy ──────────────────────────────────────────
    const query = {
      $or: [
        { createdBy: creatorId },
        { createdBy: { $exists: false }, creatorId: creatorId },
      ],
    };

    console.log('[getBoardsByCreator]', {
      creatorId,
      requestedBy: req.userId,
    });

    const boards = await Board.find(query)
      .sort({ createdAt: -1 })
      .select('-cells');

    res.json({ boards });
  } catch (err) {
    console.error('getBoardsByCreator error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/boards/assigned/:userId  — tableros principal asignados a un usuario
// Permisos:
//   - req.userId === userId                       → el propio usuario
//   - req.userId es teacher/parent del mismo centro → permitido
//   - cualquier otro caso                         → 403
exports.getAssignedBoards = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    // ── Control de acceso ────────────────────────────────────────────────────
    if (String(req.userId) !== String(userId)) {
      const [sessionUser, targetUser] = await Promise.all([
        User.findById(req.userId).select('type centro').lean(),
        User.findById(userId).select('centro').lean(),
      ]);

      const sameCenter =
        sessionUser?.centro &&
        targetUser?.centro &&
        String(sessionUser.centro) === String(targetUser.centro);

      const canAccess =
        (sessionUser?.type === 'teacher' || sessionUser?.type === 'parent') &&
        sameCenter;

      if (!canAccess) {
        console.warn('[getAssignedBoards] 403', {
          requestedBy:   req.userId,
          targetUserId:  userId,
          sessionType:   sessionUser?.type,
          sessionCentro: sessionUser?.centro,
          targetCentro:  targetUser?.centro,
        });
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // Sólo tableros principales asignados a este usuario.
    // Fallback boardRole: docs sin campo → se tratan como 'main'.
    // Soporte dual: nuevo campo assignedUserIds (array) + legacy userId.
    const boards = await Board.find({
      $and: [
        { $or: [{ boardRole: 'main' }, { boardRole: { $exists: false } }] },
        { $or: [{ assignedUserIds: userId }, { userId: userId }] },
      ],
    })
      .sort({ createdAt: -1 })
      .select('-cells');

    console.log('[getAssignedBoards]', {
      userId,
      requestedBy: req.userId,
      count: boards.length,
    });

    res.json({ boards });
  } catch (err) {
    console.error('getAssignedBoards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/boards/user/:userId  — tableros asignados a un usuario ───────────
exports.getBoardsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    const boards = await Board.find({ userId })
      .sort({ createdAt: -1 })
      .select('-cells');
    res.json({ boards });
  } catch (err) {
    console.error('getBoardsByUser error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/boards/available-targets?assignedUserIds=id1,id2,…  ─────────────
// Devuelve tableros disponibles como destino de navegación para un conjunto de
// usuarios asignados. Usado por el editor para rellenar el selector "Tablero destino".
//   - 1 usuario:  boards donde assignedUserIds incluye ese ID OR userId === ID (legacy)
//   - N usuarios: boards donde assignedUserIds $all ids
exports.getAvailableTargets = async (req, res) => {
  try {
    const { assignedUserIds: queryParam } = req.query;
    if (!queryParam) {
      return res.json({ boards: [] });
    }

    const ids = String(queryParam)
      .split(',')
      .map((s) => s.trim())
      .filter(validateObjectId);

    if (ids.length === 0) {
      return res.json({ boards: [] });
    }

    let query;
    if (ids.length === 1) {
      // Un solo usuario: nueva forma O legacy userId
      query = {
        $or: [
          { assignedUserIds: ids[0] },
          { userId: ids[0] },
        ],
      };
    } else {
      // Varios usuarios: el tablero debe estar asignado a TODOS ellos
      query = { assignedUserIds: { $all: ids } };
    }

    const boards = await Board.find(query)
      .sort({ createdAt: -1 })
      .select('-cells');

    res.json({ boards });
  } catch (err) {
    console.error('getAvailableTargets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/boards/:boardId ───────────────────────────────────────────────────
exports.getBoardById = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    const board = await Board.findById(boardId);
    console.log('[GET board by id]', boardId, board?._id?.toString(), board?.name);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    res.json({ board });
  } catch (err) {
    console.error('getBoardById error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/boards ──────────────────────────────────────────────────────────
exports.createBoard = async (req, res) => {
  try {
    const {
      name, userId, shape, rows, columns, circleSlots,
      locationColumnEnabled, locationColumnSlots,
      predictorEnabled, aiRewriteEnabled, iaRows, iaCols, imageUrl,
      boardRole,
      contextCreatorId,   // opcional: ID del creador de contexto (builder que se está editando)
      assignedUserIds,    // nuevo: array de IDs de usuarios asignados (1-N)
    } = req.body;

    // Resolver lista efectiva de usuarios asignados.
    // Si viene assignedUserIds válido: úsarlo. Si no, caer en userId.
    let effectiveAssignedUserIds = [];
    if (Array.isArray(assignedUserIds) && assignedUserIds.length > 0) {
      effectiveAssignedUserIds = assignedUserIds.filter(validateObjectId);
    }
    // Primer usuario = userId efectivo (campo legacy)
    const effectiveUserId = effectiveAssignedUserIds[0] || userId;

    if (!name || !effectiveUserId) {
      return res.status(400).json({ error: 'name and userId are required' });
    }
    if (!validateObjectId(effectiveUserId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }
    // Si sólo se envió userId sin assignedUserIds, usarlo como primer elemento
    if (effectiveAssignedUserIds.length === 0 && validateObjectId(userId)) {
      effectiveAssignedUserIds = [userId];
    }

    // ── Resolver creador efectivo ─────────────────────────────────────────────
    // Si viene contextCreatorId válido y el usuario de sesión tiene permisos
    // (mismo centro, tipo teacher o parent), se usa contextCreatorId como createdBy.
    // En cualquier otro caso se usa el usuario de sesión.
    let effectiveCreatorId = String(req.userId);

    if (contextCreatorId && validateObjectId(contextCreatorId) &&
        String(contextCreatorId) !== String(req.userId)) {
      const [sessionUser, ctxUser] = await Promise.all([
        User.findById(req.userId).select('type centro').lean(),
        User.findById(contextCreatorId).select('centro').lean(),
      ]);

      const sameCenter =
        sessionUser?.centro &&
        ctxUser?.centro &&
        String(sessionUser.centro) === String(ctxUser.centro);

      const canDelegate =
        (sessionUser?.type === 'teacher' || sessionUser?.type === 'parent') &&
        sameCenter;

      if (canDelegate) {
        effectiveCreatorId = String(contextCreatorId);
      } else {
        console.warn('[createBoard] contextCreatorId ignorado (sin permisos)', {
          sessionUser: req.userId,
          contextCreatorId,
          sessionType:   sessionUser?.type,
          sessionCentro: sessionUser?.centro,
          ctxCentro:     ctxUser?.centro,
        });
      }
    }

    // Resolver nombre del creador efectivo (denormalizado para UI)
    const creatorDoc  = await User.findById(effectiveCreatorId).select('name type').lean();
    const creatorName = creatorDoc?.name ?? '';

    // ── boardRole: aceptar 'secondary' del body; nunca forzar 'main' sin motivo ──
    const finalBoardRole = boardRole === 'secondary' ? 'secondary' : 'main';
    console.log('[backend createBoard boardRole]', {
      bodyBoardRole:  boardRole,
      finalBoardRole,
      name,
    });
    console.log('[createBoard]', {
      name,
      userIdAssigned:    userId,
      effectiveCreatorId,
      creatorName,
      creatorType:       creatorDoc?.type ?? 'unknown',
      sessionUser:       req.userId,
    });

    const board = new Board({
      name:                  name.trim(),
      imageUrl:              imageUrl              || '',
      creatorId:             req.userId,           // campo legacy = sesión real
      createdBy:             effectiveCreatorId,   // creador de contexto (builder)
      creatorName,
      userId:                effectiveUserId,
      assignedUserIds:       effectiveAssignedUserIds,
      shape:                 shape                 || 'grid',
      rows:                  rows                  || 3,
      columns:               columns               || 4,
      circleSlots:           circleSlots           || 8,
      locationColumnEnabled: !!locationColumnEnabled,
      locationColumnSlots:   locationColumnSlots   || 6,
      predictorEnabled:      !!predictorEnabled,
      aiRewriteEnabled:      !!aiRewriteEnabled,
      iaRows:                iaRows                || 5,
      iaCols:                iaCols                || 1,
      boardRole:             finalBoardRole,
      cells: [],
    });

    await board.save();
    res.status(201).json({ board });
  } catch (err) {
    console.error('createBoard error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ── PUT /api/boards/:boardId  — actualiza metadatos y/o celdas completas ──────
exports.updateBoard = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }

    const board = await Board.findById(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // NOTA: createdBy NO se acepta desde el body — el creador es inmutable una vez fijado
    const {
      name, imageUrl, userId, rows, columns, circleSlots,
      locationColumnEnabled, locationColumnSlots,
      predictorEnabled, aiRewriteEnabled, iaRows, iaCols, cells,
      boardRole, visibleInProfile, profileName, profileImage, profileDescription,
      assignedUserIds,  // nuevo: array de usuarios asignados (1-N)
    } = req.body;
    // (Si el body incluyese createdBy, se descarta silenciosamente al no desestructurarlo)

    if (name                  !== undefined) board.name                  = name.trim();
    if (imageUrl              !== undefined) board.imageUrl              = imageUrl;
    // assignedUserIds y userId se sincronizan: assignedUserIds tiene precedencia
    if (assignedUserIds !== undefined && Array.isArray(assignedUserIds)) {
      const validIds = assignedUserIds.filter(validateObjectId);
      board.assignedUserIds = validIds;
      // Sincronizar userId con el primer elemento del array
      if (validIds.length > 0) board.userId = validIds[0];
    } else if (userId !== undefined) {
      board.userId = userId;
      // Si no vienen assignedUserIds pero sí userId, asegura que el array contenga al menos ese ID
      if (!board.assignedUserIds || board.assignedUserIds.length === 0) {
        board.assignedUserIds = [userId];
      }
    }
    if (rows                  !== undefined) board.rows                  = rows;
    if (columns               !== undefined) board.columns               = columns;
    if (circleSlots           !== undefined) board.circleSlots           = circleSlots;
    if (locationColumnEnabled !== undefined) board.locationColumnEnabled = !!locationColumnEnabled;
    if (locationColumnSlots   !== undefined) board.locationColumnSlots   = locationColumnSlots;
    if (predictorEnabled      !== undefined) board.predictorEnabled      = !!predictorEnabled;
    if (aiRewriteEnabled      !== undefined) board.aiRewriteEnabled      = !!aiRewriteEnabled;
    if (iaRows                !== undefined) board.iaRows                = iaRows;
    if (iaCols                !== undefined) board.iaCols                = iaCols;
    if (boardRole             !== undefined) board.boardRole             = boardRole;
    if (visibleInProfile      !== undefined) board.visibleInProfile      = !!visibleInProfile;
    if (profileName           !== undefined) board.profileName           = profileName;
    if (profileImage          !== undefined) board.profileImage          = profileImage;
    if (profileDescription    !== undefined) board.profileDescription    = profileDescription;
    if (cells                 !== undefined) {
      board.cells = cells;
      board.markModified('cells');
    }

    await board.save();
    res.json({ board });
  } catch (err) {
    console.error('updateBoard error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ── PATCH /api/boards/:boardId/cell  — crea/actualiza/elimina una celda ───────
exports.updateCell = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }

    const board = await Board.findById(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const { row, col, pictogram, action } = req.body;
    if (row === undefined || col === undefined) {
      return res.status(400).json({ error: 'row and col are required' });
    }

    const idx = board.cells.findIndex((c) => c.row === row && c.col === col);

    if (pictogram === null || pictogram === undefined && idx >= 0) {
      // Eliminar celda si pictogram es null explícito
      if (pictogram === null && idx >= 0) {
        board.cells.splice(idx, 1);
      }
    } else if (pictogram) {
      const cellData = {
        row,
        col,
        pictogram,
        action: action || { type: 'voice', targetBoardId: null },
      };
      if (idx >= 0) {
        board.cells[idx] = cellData;
      } else {
        board.cells.push(cellData);
      }
    }

    board.markModified('cells');
    await board.save();
    res.json({ board });
  } catch (err) {
    console.error('updateCell error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ── POST /api/boards/:boardId/duplicate ───────────────────────────────────────
exports.duplicateBoard = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }

    const original = await Board.findById(boardId);
    if (!original) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // ── Control de acceso ────────────────────────────────────────────────────
    // El creador efectivo del tablero original (campo nuevo o legacy)
    const effectiveCreatorId = original.createdBy || original.creatorId;

    if (String(req.userId) !== String(effectiveCreatorId)) {
      const [sessionUser, creatorUser] = await Promise.all([
        User.findById(req.userId).select('type centro').lean(),
        User.findById(effectiveCreatorId).select('centro').lean(),
      ]);
      const sameCenter =
        sessionUser?.centro && creatorUser?.centro &&
        String(sessionUser.centro) === String(creatorUser.centro);
      const canAccess =
        (sessionUser?.type === 'teacher' || sessionUser?.type === 'parent') && sameCenter;
      if (!canAccess) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    // ── Calcular nombre: "{base} (copia)" / "{base} (copia 2)" etc. ──────────
    // Eliminar sufijo existente de copia para obtener el nombre base
    const baseName  = original.name.replace(/ \(copia(?: \d+)?\)$/, '').trim();
    const safeBase  = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const copyRegex = new RegExp(`^${safeBase} \\(copia(?: (\\d+))?\\)$`);

    // Buscar tableros del mismo contexto con nombre similar
    const siblings = await Board.find({
      $or: [
        { createdBy: effectiveCreatorId },
        { createdBy: { $exists: false }, creatorId: effectiveCreatorId },
      ],
      name: { $regex: safeBase },
    }).select('name').lean();

    let maxNum = 0;
    for (const b of siblings) {
      const m = b.name.match(copyRegex);
      if (m) {
        const n = m[1] ? parseInt(m[1], 10) : 1;
        if (n > maxNum) maxNum = n;
      }
    }
    const copyNum = maxNum + 1;
    const newName  = copyNum === 1 ? `${baseName} (copia)` : `${baseName} (copia ${copyNum})`;

    // ── Crear copia ───────────────────────────────────────────────────────────
    // Extraer cells como objetos planos para evitar compartir referencias
    const originalObj = original.toObject();

    const duplicate = new Board({
      name:                  newName,
      imageUrl:              originalObj.imageUrl              || '',
      creatorId:             req.userId,                        // legacy = sesión actual
      createdBy:             effectiveCreatorId,                // mismo contexto que el original
      creatorName:           originalObj.creatorName           || '',
      userId:                originalObj.userId,
      assignedUserIds:       originalObj.assignedUserIds       || (originalObj.userId ? [originalObj.userId] : []),
      shape:                 originalObj.shape,
      rows:                  originalObj.rows,
      columns:               originalObj.columns,
      circleSlots:           originalObj.circleSlots,
      locationColumnEnabled: originalObj.locationColumnEnabled,
      locationColumnSlots:   originalObj.locationColumnSlots,
      predictorEnabled:      originalObj.predictorEnabled,
      aiRewriteEnabled:      originalObj.aiRewriteEnabled,
      iaRows:                originalObj.iaRows,
      iaCols:                originalObj.iaCols,
      boardRole:             originalObj.boardRole,
      cells:                 originalObj.cells,                 // plain objects, Mongoose los valida
      // NO copiados: _id, createdAt, updatedAt,
      //              visibleInProfile, profileName, profileImage, profileDescription
    });

    await duplicate.save();

    console.log('[duplicateBoard]', {
      originalId:  boardId,
      duplicateId: duplicate._id,
      name:        newName,
      requestedBy: req.userId,
    });

    res.status(201).json({ board: duplicate });
  } catch (err) {
    console.error('duplicateBoard error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ── DELETE /api/boards/:boardId ───────────────────────────────────────────────
exports.deleteBoard = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    const board = await Board.findByIdAndDelete(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    res.json({ message: 'Board deleted successfully' });
  } catch (err) {
    console.error('deleteBoard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
