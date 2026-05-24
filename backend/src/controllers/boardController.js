const mongoose = require('mongoose');
const Board = require('../models/Board');

const validateObjectId = (id) => !!id && mongoose.Types.ObjectId.isValid(id);

// ── GET /api/boards/my  — tableros donde yo soy creador ───────────────────────
exports.getMyBoards = async (req, res) => {
  try {
    const boards = await Board.find({ creatorId: req.userId })
      .sort({ createdAt: -1 })
      .select('-cells');
    res.json({ boards });
  } catch (err) {
    console.error('getMyBoards error:', err);
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

// ── GET /api/boards/:boardId ───────────────────────────────────────────────────
exports.getBoardById = async (req, res) => {
  try {
    const { boardId } = req.params;
    if (!validateObjectId(boardId)) {
      return res.status(400).json({ error: 'Invalid boardId' });
    }
    const board = await Board.findById(boardId);
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
    const { name, userId, shape, rows, columns, circleSlots, predictorEnabled, aiRewriteEnabled, iaRows, iaCols, imageUrl } = req.body;

    if (!name || !userId) {
      return res.status(400).json({ error: 'name and userId are required' });
    }
    if (!validateObjectId(userId)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const board = new Board({
      name:             name.trim(),
      imageUrl:         imageUrl         || '',
      creatorId:        req.userId,
      userId,
      shape:            shape            || 'grid',
      rows:             rows             || 3,
      columns:          columns          || 4,
      circleSlots:      circleSlots      || 8,
      predictorEnabled: !!predictorEnabled,
      aiRewriteEnabled: !!aiRewriteEnabled,
      iaRows:           iaRows           || 5,
      iaCols:           iaCols           || 1,
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

    const { name, imageUrl, userId, rows, columns, predictorEnabled, aiRewriteEnabled, iaRows, iaCols, cells } = req.body;

    if (name             !== undefined) board.name             = name.trim();
    if (imageUrl         !== undefined) board.imageUrl         = imageUrl;
    if (userId           !== undefined) board.userId           = userId;
    if (rows             !== undefined) board.rows             = rows;
    if (columns          !== undefined) board.columns          = columns;
    if (predictorEnabled !== undefined) board.predictorEnabled = !!predictorEnabled;
    if (aiRewriteEnabled !== undefined) board.aiRewriteEnabled = !!aiRewriteEnabled;
    if (iaRows           !== undefined) board.iaRows           = iaRows;
    if (iaCols           !== undefined) board.iaCols           = iaCols;
    if (cells            !== undefined) {
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
