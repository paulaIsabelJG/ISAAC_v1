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

    // Solo tableros PUBLICADOS (visibleInProfile===true) asignados a este usuario.
    // Un tablero publicado es el que el profesional/org activó con "Publicar".
    // Incluye 'main' y 'multi'; excluye secundarios y no publicados.
    const boards = await Board.find({
      $and: [
        { $or: [{ boardRole: 'main' }, { boardRole: 'multi' }, { boardRole: { $exists: false } }] },
        { $or: [{ assignedUserIds: userId }, { userId: userId }] },
        { visibleInProfile: true },
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

    // userId opcional para personalización en tiempo de carga (no modifica DB)
    const contextUserId = req.query.userId && validateObjectId(String(req.query.userId))
      ? String(req.query.userId)
      : null;

    const board = await Board.findById(boardId).lean();
    console.log('[GET board by id]', boardId, board?._id?.toString(), board?.name,
      contextUserId ? `userId=${contextUserId}` : '');
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }

    // ── Personalización dinámica en memoria ───────────────────────────────────
    // El comunicador controla si pasa userId basándose en el flag del tablero raíz.
    // Aquí solo comprobamos que haya userId — no verificamos autoPersonalize de
    // este tablero concreto, porque los sub-tableros y slots no lo tienen seteado.
    // El editor nunca pasa userId, así que siempre ve el original.
    if (contextUserId) {
      const User = require('../models/User');
      const user = await User.findById(contextUserId).select('customPictograms').lean();
      const pictoMap = new Map();
      for (const p of (user?.customPictograms ?? [])) {
        pictoMap.set(p.label.toLowerCase().trim(), p);
      }
      console.debug('[getBoardById] personalización dinámica', {
        boardId, userId: contextUserId,
        customPictogramas: pictoMap.size,
        labelsDisponibles: [...pictoMap.keys()],
      });

      if (pictoMap.size > 0) {
        let replaced = 0;
        const personalizedCells = (board.cells ?? []).map(cell => {
          if (!cell.pictogram) return cell;
          const key   = cell.pictogram.label.toLowerCase().trim();
          const match = pictoMap.get(key);
          if (match) {
            replaced++;
            console.debug('[getBoardById] match', { boardId, label: key, userId: contextUserId });
            return {
              ...cell,
              pictogram: { ...cell.pictogram, imageUrl: match.imageUrl, source: 'custom', id: String(match.id) },
            };
          }
          return cell;
        });
        if (replaced > 0) {
          return res.json({ board: { ...board, cells: personalizedCells } });
        }
      }
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
      autoPersonalize,    // personalización automática de pictogramas al cargar por usuario
      contextCreatorId,   // opcional: ID del creador de contexto (builder que se está editando)
      assignedUserIds,    // nuevo: array de IDs de usuarios asignados (1-N)
      slotCount,          // multitablero: número de huecos (2 | 3 | 4)
      multiBoardSlots,    // multitablero: [{slotId, boardId}]
    } = req.body;

    // Resolver lista efectiva de usuarios asignados.
    // Si viene assignedUserIds válido: úsarlo. Si no, caer en userId.
    let effectiveAssignedUserIds = [];
    if (Array.isArray(assignedUserIds) && assignedUserIds.length > 0) {
      effectiveAssignedUserIds = assignedUserIds.filter(validateObjectId);
    }
    // Primer usuario = userId efectivo (campo legacy)
    const effectiveUserId = effectiveAssignedUserIds[0] || userId;

    // Los tableros secundarios pueden crearse sin usuario asignado (lo heredarán al enlazarse).
    const isSecondary = boardRole === 'secondary';
    if (!name || (!effectiveUserId && !isSecondary)) {
      return res.status(400).json({ error: 'name and userId are required' });
    }
    if (effectiveUserId && !validateObjectId(effectiveUserId)) {
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

    // ── boardRole: aceptar 'secondary' y 'multi' del body ────────────────────
    const finalBoardRole =
      boardRole === 'secondary' ? 'secondary' :
      boardRole === 'multi'     ? 'multi'     : 'main';
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
      userId:                effectiveUserId || undefined,
      assignedUserIds:       effectiveAssignedUserIds,
      shape:                 shape                 || 'grid',
      rows:                  rows                  || 3,
      columns:               columns               || 4,
      circleSlots:           circleSlots           || 8,
      locationColumnEnabled: !!locationColumnEnabled,
      locationColumnSlots:   locationColumnSlots   || 6,
      predictorEnabled:      !!predictorEnabled,
      aiRewriteEnabled:      !!aiRewriteEnabled,
      autoPersonalize:       !!autoPersonalize,
      iaRows:                iaRows                || 5,
      iaCols:                iaCols                || 1,
      boardRole:             finalBoardRole,
      // Multitablero: inicializar huecos si es multi (por shape o por boardRole legacy)
      ...((finalBoardRole === 'multi' || shape === 'multi') ? {
        slotCount:       slotCount || 2,
        multiBoardSlots: Array.isArray(multiBoardSlots) ? multiBoardSlots : [],
      } : {}),
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
      autoPersonalize,  // personalización automática al publicar
      assignedUserIds,  // nuevo: array de usuarios asignados (1-N)
      slotCount, multiBoardSlots, multiBoardLayout, // multitablero
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
    if (slotCount             !== undefined) board.slotCount             = slotCount;
    if (multiBoardSlots       !== undefined && Array.isArray(multiBoardSlots)) {
      board.multiBoardSlots = multiBoardSlots;
      board.markModified('multiBoardSlots');
    }
    if (multiBoardLayout !== undefined && multiBoardLayout !== null) {
      board.multiBoardLayout = {
        widths:  Array.isArray(multiBoardLayout.widths)  ? multiBoardLayout.widths  : [],
        heights: Array.isArray(multiBoardLayout.heights) ? multiBoardLayout.heights : [],
      };
      board.markModified('multiBoardLayout');
    }
    if (autoPersonalize       !== undefined) board.autoPersonalize       = !!autoPersonalize;
    if (visibleInProfile      !== undefined) board.visibleInProfile      = !!visibleInProfile;
    if (profileName           !== undefined) board.profileName           = profileName;
    if (profileImage          !== undefined) board.profileImage          = profileImage;
    if (profileDescription    !== undefined) board.profileDescription    = profileDescription;
    if (cells                 !== undefined) {
      board.cells = cells;
      board.markModified('cells');
    }

    await board.save();

    // Propagar asignación a tableros de slots (solo si viene assignedUserIds y es multi)
    if (
      assignedUserIds !== undefined &&
      (board.shape === 'multi' || board.boardRole === 'multi') &&
      Array.isArray(board.multiBoardSlots) && board.multiBoardSlots.length > 0
    ) {
      const slotBoardIds = board.multiBoardSlots
        .map(s => s.boardId)
        .filter(id => id != null);

      if (slotBoardIds.length > 0) {
        await Board.updateMany(
          { _id: { $in: slotBoardIds } },
          { $set: { assignedUserIds: board.assignedUserIds, userId: board.userId ?? null } }
        );
      }
    }

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
        board.cells.splice(idx, 1, cellData);
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

// ── Helper: BFS — recopila todos los tableros alcanzables desde un raíz ───────
// Sigue: multiBoardSlots[].boardId y cells[].action.targetBoardId
// Devuelve Map<String(id), Board> con todos los tableros del grafo.
async function collectBoardGraph(root) {
  const allBoards = new Map();  // String(id) -> Board document
  const visited   = new Set();  // ids ya procesados
  const queue     = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    const cid = String(current._id);
    if (visited.has(cid)) continue;
    visited.add(cid);
    allBoards.set(cid, current);

    // Seguir referencias de slots (multiBoardSlots[].boardId)
    for (const slot of current.multiBoardSlots ?? []) {
      if (!slot.boardId) continue;
      const tid = String(slot.boardId);
      if (visited.has(tid)) continue;
      try {
        const linked = await Board.findById(tid);
        if (linked) queue.push(linked);
        else         visited.add(tid);  // tablero eliminado, ignorar
      } catch { visited.add(tid); }
    }

    // Seguir referencias de celdas (action.targetBoardId)
    for (const cell of current.cells ?? []) {
      const rawTarget = cell.action?.targetBoardId;
      if (!rawTarget) continue;
      const tid = String(rawTarget);
      if (visited.has(tid)) continue;
      try {
        const linked = await Board.findById(tid);
        if (linked) queue.push(linked);
        else         visited.add(tid);
      } catch { visited.add(tid); }
    }
  }

  return allBoards;
}

// ── Helper: duplicado profundo de un multitablero y todo su grafo ─────────────
// Crea copias de todos los tableros alcanzables, remapea todas las referencias
// internas y devuelve la copia del tablero raíz.
async function deepDuplicateMultiBoard(root, effectiveCreatorId, sessionUserId, newRootName) {
  // 1. Recopilar grafo completo via BFS
  const graphBoards = await collectBoardGraph(root);

  // 2. Generar nuevo ObjectId para cada tablero del grafo
  const idMap = new Map();   // String(oldId) -> new ObjectId
  for (const oldId of graphBoards.keys()) {
    idMap.set(oldId, new mongoose.Types.ObjectId());
  }

  const rootId = String(root._id);

  // 3. Construir documentos de copia con referencias internas remapeadas
  const docs = [];
  for (const [oldId, board] of graphBoards) {
    const obj   = board.toObject();
    const newId = idMap.get(oldId);

    // Remap multiBoardSlots: oldBoardId -> newBoardId
    const newSlots = (obj.multiBoardSlots ?? []).map(s => ({
      slotId:  s.slotId,
      boardId: s.boardId
        ? (idMap.get(String(s.boardId)) ?? null)
        : null,
    }));

    // Remap cells[].action.targetBoardId: solo si está en el grafo
    const newCells = (obj.cells ?? []).map(cell => {
      if (!cell.action?.targetBoardId) return cell;
      const oldTarget = String(cell.action.targetBoardId);
      const newTarget = idMap.has(oldTarget)
        ? idMap.get(oldTarget)
        : cell.action.targetBoardId;   // referencia externa: mantener apuntando al original
      return {
        row:       cell.row,
        col:       cell.col,
        pictogram: cell.pictogram,
        action:    { ...cell.action, targetBoardId: newTarget },
      };
    });

    docs.push({
      _id:                   newId,
      name:                  oldId === rootId ? newRootName : obj.name,
      imageUrl:              obj.imageUrl              || '',
      creatorId:             sessionUserId,             // legacy = sesión actual
      createdBy:             effectiveCreatorId,
      creatorName:           obj.creatorName            || '',
      userId:                obj.userId,
      assignedUserIds:       Array.isArray(obj.assignedUserIds) && obj.assignedUserIds.length > 0
                               ? obj.assignedUserIds
                               : (obj.userId ? [obj.userId] : []),
      shape:                 obj.shape,
      rows:                  obj.rows,
      columns:               obj.columns,
      circleSlots:           obj.circleSlots,
      locationColumnEnabled: obj.locationColumnEnabled,
      locationColumnSlots:   obj.locationColumnSlots,
      predictorEnabled:      obj.predictorEnabled,
      aiRewriteEnabled:      obj.aiRewriteEnabled,
      iaRows:                obj.iaRows,
      iaCols:                obj.iaCols,
      boardRole:             obj.boardRole,
      slotCount:             obj.slotCount,
      multiBoardSlots:       newSlots,
      multiBoardLayout:      obj.multiBoardLayout
        ? { widths: [...(obj.multiBoardLayout.widths ?? [])], heights: [...(obj.multiBoardLayout.heights ?? [])] }
        : undefined,
      controlsConfig:        obj.controlsConfig,
      cells:                 newCells,
      // NO copiados: visibleInProfile, profileName, profileImage, profileDescription
    });
  }

  // 4. Inserción masiva de todas las copias
  await Board.insertMany(docs);

  // 5. Devolver la copia del tablero raíz
  return Board.findById(idMap.get(rootId));
}

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

    // ── Calcular nombre raíz: "{base} (copia)" / "{base} (copia 2)" etc. ─────
    const baseName  = original.name.replace(/ \(copia(?: \d+)?\)$/, '').trim();
    const safeBase  = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const copyRegex = new RegExp(`^${safeBase} \\(copia(?: (\\d+))?\\)$`);

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

    // ── Multitablero: duplicado profundo del grafo completo ───────────────────
    const isMulti = original.boardRole === 'multi' || original.shape === 'multi';

    if (isMulti) {
      const board = await deepDuplicateMultiBoard(
        original,
        String(effectiveCreatorId),
        String(req.userId),
        newName,
      );

      console.log('[duplicateBoard][multi]', {
        originalId:  boardId,
        duplicateId: board?._id,
        name:        board?.name,
        requestedBy: req.userId,
      });

      return res.status(201).json({ board });
    }

    // ── Tablero normal: duplicado superficial (sin cambios) ───────────────────
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
      cells:                 originalObj.cells,
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

// ── PATCH /api/boards/:boardId/slots  — actualiza las asignaciones de huecos ───
// Body: { slots: [{ slotId: number, boardId: string|null }] }
exports.updateBoardSlots = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }

    const board = await Board.findById(boardId);
    if (!board) {
      return res.status(404).json({ error: 'Board not found' });
    }
    if (board.boardRole !== 'multi' && board.shape !== 'multi') {
      return res.status(400).json({ error: 'Board is not a multitablero' });
    }

    const { slots } = req.body;
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots must be an array' });
    }

    // Validar que los boardId referenciados existen (si no son null)
    for (const slot of slots) {
      if (slot.boardId && !validateObjectId(String(slot.boardId))) {
        return res.status(400).json({ error: `Invalid boardId in slot ${slot.slotId}` });
      }
    }

    board.multiBoardSlots = slots.map((s) => ({
      slotId:  s.slotId,
      boardId: s.boardId || null,
    }));
    board.markModified('multiBoardSlots');

    await board.save();

    // Propagar assignedUserIds del multitablero a los slot boards asignados.
    // Si el multitablero tiene usuarios, cada slot board (y sus sub-tableros
    // navegables sin asignar) hereda esos usuarios de forma recursiva.
    const multiIds = (board.assignedUserIds ?? []).map(String).filter(Boolean);
    const multiUserId = board.userId ? String(board.userId) : null;
    const effectiveMultiIds = multiIds.length > 0
      ? multiIds
      : (multiUserId ? [multiUserId] : []);

    if (effectiveMultiIds.length > 0) {
      const NAV_TYPES = new Set(['navigate', 'voice+navigate', 'setSlot', 'voice+setSlot']);
      for (const slot of board.multiBoardSlots) {
        if (!slot.boardId || !validateObjectId(String(slot.boardId))) continue;
        // BFS desde este slot board: propaga usuarios a tableros sin asignar
        const visited = new Set();
        const queue   = [String(slot.boardId)];
        while (queue.length > 0) {
          const id = queue.shift();
          if (visited.has(id)) continue;
          visited.add(id);
          const sb = await Board.findById(id).lean();
          if (!sb) continue;
          const sbIds = (sb.assignedUserIds ?? []).map(String).filter(Boolean);
          if (sbIds.length === 0) {
            const $setSlot = { assignedUserIds: effectiveMultiIds, userId: effectiveMultiIds[0] };
            // Propagar autoPersonalize del multitablero si el slot no lo tiene ya activo
            if (board.autoPersonalize && !sb.autoPersonalize) {
              $setSlot.autoPersonalize = true;
            }
            await Board.updateOne({ _id: sb._id }, { $set: $setSlot });
          }
          for (const cell of (sb.cells ?? [])) {
            const tId = cell.action?.targetBoardId;
            if (tId && NAV_TYPES.has(cell.action?.type) && validateObjectId(String(tId)) && !visited.has(String(tId))) {
              queue.push(String(tId));
            }
          }
        }
      }
    }

    res.json({ board });
  } catch (err) {
    console.error('updateBoardSlots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// ── PUT /api/boards/:boardId/favorite  — toggle favorito ─────────────────────
exports.toggleFavorite = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    const board = await Board.findById(boardId);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    const { isFavorite } = req.body;
    board.isFavorite = !!isFavorite;
    await board.save();
    res.json({ board });
  } catch (err) {
    console.error('toggleFavorite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PATCH /api/boards/:boardId/folder  — asignar/mover tablero a carpeta ─────
exports.assignFolder = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    const board = await Board.findById(boardId);
    if (!board) return res.status(404).json({ error: 'Board not found' });

    const { folderId } = req.body;
    // null o string válido
    if (folderId && !validateObjectId(folderId)) {
      return res.status(400).json({ error: 'Invalid folderId' });
    }
    board.folderId = folderId || null;
    await board.save();
    res.json({ board });
  } catch (err) {
    console.error('assignFolder error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

// ── POST /api/boards/:boardId/apply-personalization ──────────────────────────
// Vista previa de la personalización: BFS desde boardId, cuenta cuántos
// pictogramas coincidirían con los personales de cada usuario asignado.
// NO modifica la DB — la sustitución real ocurre en getBoardById en tiempo de carga.
// Sigue: cells[].action.targetBoardId (navigate/setSlot) Y multiBoardSlots[].boardId
exports.applyPersonalization = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }

    const NAV_TYPES = new Set(['navigate', 'voice+navigate', 'setSlot', 'voice+setSlot']);
    const User = require('../models/User');

    // ── Helpers ───────────────────────────────────────────────────────────────

    const userPictCache = new Map();
    const getUserPicts = async (userId) => {
      const key = String(userId);
      if (userPictCache.has(key)) return userPictCache.get(key);
      const user = await User.findById(userId).select('customPictograms').lean();
      const byLabel = new Map();
      for (const p of (user?.customPictograms ?? [])) {
        byLabel.set(p.label.toLowerCase().trim(), p);
      }
      userPictCache.set(key, byLabel);
      return byLabel;
    };

    const effectiveIds = (board) => {
      const ids = (board.assignedUserIds ?? []).map(String).filter(Boolean);
      if (ids.length > 0) return ids;
      return board.userId ? [String(board.userId)] : [];
    };

    // ── Cargar tablero raíz ───────────────────────────────────────────────────
    const rootBoard = await Board.findById(boardId).lean();
    if (!rootBoard) {
      return res.status(404).json({ error: 'Board not found' });
    }

    const rootIds = effectiveIds(rootBoard);
    if (rootIds.length === 0) {
      console.debug('[applyPersonalization] sin usuarios asignados en raíz', boardId);
      return res.json({ boardsProcessed: 0, cellsReplaced: 0, reason: 'no_users' });
    }

    console.debug('[applyPersonalization] root', { boardId, rootIds,
      boardRole: rootBoard.boardRole, multiBoardSlots: (rootBoard.multiBoardSlots ?? []).length });

    // ── Verificar pictogramas de cada usuario ─────────────────────────────────
    let totalUserPicts = 0;
    for (const uid of rootIds) {
      const picts = await getUserPicts(uid);
      console.debug('[applyPersonalization] usuario', uid, 'pictogramas propios:', picts.size,
        'labels:', [...picts.keys()]);
      totalUserPicts += picts.size;
    }
    if (totalUserPicts === 0) {
      return res.json({ boardsProcessed: 0, cellsReplaced: 0, reason: 'no_pictograms' });
    }

    // ── BFS: recorre cells + multiBoardSlots (no modifica DB) ─────────────────
    const visited         = new Set();
    const queue           = [boardId];
    let   boardsProcessed = 0;
    let   cellsReplaced   = 0;

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const board = await Board.findById(id).lean();
      if (!board) continue;
      boardsProcessed++;

      const ownIds = effectiveIds(board).length > 0 ? effectiveIds(board) : rootIds;

      console.debug('[applyPersonalization] tablero', id, board.name,
        'role:', board.boardRole, 'slots:', (board.multiBoardSlots ?? []).length,
        'cells:', board.cells?.length, 'usuarios:', ownIds);

      // Construir mapa unificado para este tablero (por-tablero, no global)
      // La sustitución real la hace getBoardById por usuario — aquí solo contamos
      for (const uid of ownIds) {
        const pictoMap = await getUserPicts(uid);
        for (const cell of (board.cells ?? [])) {
          if (!cell.pictogram) continue;
          const key = cell.pictogram.label.toLowerCase().trim();
          if (pictoMap.has(key)) {
            cellsReplaced++;
            console.debug('[applyPersonalization] match', { boardId: id, label: key, userId: uid });
          }
        }
      }

      // Encolar destinos de navegación por acciones de celdas
      for (const cell of (board.cells ?? [])) {
        const tId = cell.action?.targetBoardId;
        if (tId && NAV_TYPES.has(cell.action?.type) && validateObjectId(String(tId)) && !visited.has(String(tId))) {
          queue.push(String(tId));
        }
      }

      // Encolar tableros de slots (multitablero)
      for (const slot of (board.multiBoardSlots ?? [])) {
        const sId = slot.boardId ? String(slot.boardId) : null;
        if (sId && validateObjectId(sId) && !visited.has(sId)) {
          console.debug('[applyPersonalization] encolar slot', sId);
          queue.push(sId);
        }
      }
    }

    console.debug('[applyPersonalization] resultado', { boardsProcessed, cellsReplaced });
    res.json({ boardsProcessed, cellsReplaced, reason: cellsReplaced > 0 ? 'ok' : 'no_matches' });
  } catch (err) {
    console.error('applyPersonalization error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/boards/:boardId/inherit-users ───────────────────────────────────
// Propaga assignedUserIds de forma recursiva a todos los tableros secundarios
// sin asignar conectados desde :boardId. Si alguno ya tiene IDs distintos → 409.
exports.inheritAssignedUsers = async (req, res) => {
  try {
    const { boardId } = req.params;
    const { assignedUserIds } = req.body;

    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    if (!Array.isArray(assignedUserIds) || assignedUserIds.length === 0) {
      return res.status(400).json({ error: 'assignedUserIds required' });
    }
    const newIds = assignedUserIds.map(String);

    const visited  = new Set();
    const queue    = [boardId];
    const toUpdate = [];
    const conflicts = [];

    while (queue.length > 0) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);

      const board = await Board.findById(id).lean();
      if (!board) continue;

      const existing = (board.assignedUserIds ?? []).map(String);
      if (existing.length > 0) {
        const same =
          existing.length === newIds.length &&
          newIds.every(uid => existing.includes(uid));
        if (!same) {
          conflicts.push({ boardId: String(board._id), name: board.name, assignedUserIds: existing });
        }
        // No profundizar más en tableros con contexto propio
        continue;
      }

      toUpdate.push(String(board._id));

      for (const cell of (board.cells ?? [])) {
        const targetId = cell.action?.targetBoardId;
        if (targetId && validateObjectId(String(targetId)) && !visited.has(String(targetId))) {
          queue.push(String(targetId));
        }
      }
    }

    if (conflicts.length > 0) {
      return res.status(409).json({ conflicts, updated: [] });
    }

    if (toUpdate.length > 0) {
      await Board.updateMany(
        { _id: { $in: toUpdate } },
        { $set: { assignedUserIds: newIds, userId: newIds[0] } },
      );
    }

    res.json({ updated: toUpdate, conflicts: [] });
  } catch (err) {
    console.error('inheritAssignedUsers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
