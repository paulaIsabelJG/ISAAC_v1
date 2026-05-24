const express = require('express');
const router  = express.Router();
const boardController = require('../controllers/boardController');
const authMiddleware  = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Rutas específicas antes de /:boardId para evitar colisiones
router.get('/my',           boardController.getMyBoards);
router.get('/user/:userId', boardController.getBoardsByUser);

// CRUD por boardId
router.get   ('/:boardId',       boardController.getBoardById);
router.post  ('/',               boardController.createBoard);
router.put   ('/:boardId',       boardController.updateBoard);
router.patch ('/:boardId/cell',  boardController.updateCell);
router.delete('/:boardId',       boardController.deleteBoard);

module.exports = router;
