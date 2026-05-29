const express = require('express');
const router  = express.Router();
const boardController = require('../controllers/boardController');
const authMiddleware  = require('../middleware/authMiddleware');

router.use(authMiddleware);

// Rutas específicas antes de /:boardId para evitar colisiones
router.get('/my',                    boardController.getMyBoards);
router.get('/builder/:creatorId',    boardController.getBoardsByCreator);
router.get('/assigned/:userId',      boardController.getAssignedBoards);
router.get('/user/:userId',          boardController.getBoardsByUser);
router.get('/available-targets',     boardController.getAvailableTargets);

// CRUD por boardId
router.get   ('/:boardId',            boardController.getBoardById);
router.post  ('/',                    boardController.createBoard);
router.post  ('/:boardId/duplicate',  boardController.duplicateBoard);
router.put   ('/:boardId',            boardController.updateBoard);
router.patch ('/:boardId/cell',        boardController.updateCell);
router.patch ('/:boardId/slots',        boardController.updateBoardSlots);
router.patch ('/:boardId/folder',        boardController.assignFolder);
router.put   ('/:boardId/favorite',     boardController.toggleFavorite);
router.delete('/:boardId',            boardController.deleteBoard);

module.exports = router;
