const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// Rutas de pictogramas del usuario autenticado (deben ir antes de /:userId)
router.post('/pictograms', userController.addCustomPictogram);
router.get('/pictograms', userController.getCustomPictograms);
router.delete('/pictograms/:id', userController.deleteCustomPictogram);

// Listados de usuarios
router.get('/centro/:centro', userController.getUsersByCenter);

// Hijos de un padre
router.get('/:parentId/children', userController.getChildrenByParentId);

// Rutas de pictogramas de otro usuario (antes de /:userId genérico)
router.get('/:userId/pictograms', userController.getCustomPictogramsByUserId);
router.post('/:userId/pictograms', userController.addCustomPictogramToUserById);
router.delete('/:userId/pictograms/:pictogramId', userController.deleteCustomPictogramByUserId);

// CRUD de usuario por ID (al final para evitar conflictos con rutas con sufijo)
router.put('/:userId', userController.updateUserById);
router.patch('/:userId', userController.patchUserById);
router.delete('/:userId', userController.deleteUserById);
router.get('/:userId', userController.getUserById);

module.exports = router;
