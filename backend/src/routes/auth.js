const express = require('express');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.post('/register', authController.register);
router.post('/login',    authController.login);
router.post('/refresh',  authController.refresh);
router.post('/logout',   authController.logout);

// Protected routes
router.get('/me',    authMiddleware, authController.getMe);
router.put('/me',    authMiddleware, authController.updateMe);
router.delete('/me', authMiddleware, authController.deleteMe);

module.exports = router;
