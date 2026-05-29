const mongoose  = require('mongoose');
const BoardFolder = require('../models/BoardFolder');
const Board      = require('../models/Board');

const validateObjectId = (id) => !!id && mongoose.Types.ObjectId.isValid(id);

// ── GET /api/folders  — carpetas del usuario de sesión ────────────────────────
exports.getFolders = async (req, res) => {
  try {
    const folders = await BoardFolder.find({ createdBy: req.userId })
      .sort({ createdAt: 1 });
    res.json({ folders });
  } catch (err) {
    console.error('getFolders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── POST /api/folders  — crear carpeta ────────────────────────────────────────
exports.createFolder = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const folder = new BoardFolder({ name: name.trim(), createdBy: req.userId });
    await folder.save();
    res.status(201).json({ folder });
  } catch (err) {
    console.error('createFolder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── PUT /api/folders/:folderId  — renombrar carpeta ───────────────────────────
exports.renameFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!validateObjectId(folderId)) {
      return res.status(400).json({ error: 'Invalid folderId' });
    }
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const folder = await BoardFolder.findOne({ _id: folderId, createdBy: req.userId });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    folder.name = name.trim();
    await folder.save();
    res.json({ folder });
  } catch (err) {
    console.error('renameFolder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ── DELETE /api/folders/:folderId  — eliminar carpeta (tableros sin carpeta) ──
exports.deleteFolder = async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!validateObjectId(folderId)) {
      return res.status(400).json({ error: 'Invalid folderId' });
    }
    const folder = await BoardFolder.findOne({ _id: folderId, createdBy: req.userId });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Desasignar los tableros que estaban en esta carpeta
    await Board.updateMany({ folderId: folderId }, { $unset: { folderId: '' } });

    await folder.deleteOne();
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error('deleteFolder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
