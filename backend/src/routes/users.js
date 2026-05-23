const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');

// Public routes (for admin/external services)
router.get('/centro/:centro', userController.getUsersByCenter);
router.get('/:parentId/children', userController.getChildrenByParentId);

// All protected routes
router.use(authMiddleware);

// Current-user pictogram routes remain unchanged
router.post('/pictograms', userController.addCustomPictogram);
router.get('/pictograms', userController.getCustomPictograms);
router.delete('/pictograms/:id', userController.deleteCustomPictogram);

// Target-user pictogram routes
router.get('/:userId/pictograms', userController.getCustomPictogramsByUserId);
router.post('/:userId/pictograms', userController.addCustomPictogramToUserById);
router.delete('/:userId/pictograms/:pictogramId', userController.deleteCustomPictogramByUserId);

// Target-user CRUD routes (after pictogram routes to avoid conflicts)
router.put('/:userId', userController.updateUserById);
router.patch('/:userId', userController.patchUserById);
router.delete('/:userId', userController.deleteUserById);
router.get('/:userId', userController.getUserById);

module.exports = router;