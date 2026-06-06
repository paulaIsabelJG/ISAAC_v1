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

// Familiares (type='parent') vinculados a uno o varios usuarios finales
// Query param: userIds=id1,id2,...
router.get('/families-for-users', userController.getFamiliesForUsers);

// Hijos de un padre
router.get('/:parentId/children', userController.getChildrenByParentId);

// Rutas de pictogramas de otro usuario (antes de /:userId genérico)
router.get('/:userId/pictograms', userController.getCustomPictogramsByUserId);
router.post('/:userId/pictograms', userController.addCustomPictogramToUserById);
router.delete('/:userId/pictograms/:pictogramId', userController.deleteCustomPictogramByUserId);

// childrenAccess del familiar (antes de /:userId genérico)
router.put('/:parentId/children-access', userController.updateChildrenAccess);

// Rutas de profesionales asignados (antes de /:userId genérico)
router.get('/:userId/assigned-professionals', userController.getAssignedProfessionals);
router.put('/:userId/assigned-professionals', userController.updateAssignedProfessionals);

// Usuarios finales asignados a un profesional (antes de /:userId genérico)
router.get('/:professionalId/assigned-users', userController.getAssignedUsers);

// CRUD de usuario por ID (al final para evitar conflictos con rutas con sufijo)
router.put('/:userId', userController.updateUserById);
router.patch('/:userId', userController.patchUserById);
router.delete('/:userId', userController.deleteUserById);
router.get('/:userId', userController.getUserById);

module.exports = router;
