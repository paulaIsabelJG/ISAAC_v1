const express        = require('express');
const router         = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const vc             = require('../controllers/voiceController');

// Health check — no requiere JWT (para que el frontend pueda comprobar disponibilidad)
router.get('/health', vc.getVoiceHealth);

// Todos los endpoints protegidos requieren JWT válido
router.use(authMiddleware);

// Muestra de voz de referencia
router.post('/:userId/sample',  vc.uploadVoiceSample);
// Crear perfil de voz (llama al microservicio Python)
router.post('/:userId/create',  vc.createVoice);
// Consultar estado
router.get('/:userId/status',   vc.getVoiceStatus);
// Eliminar voz personalizada
router.delete('/:userId/custom', vc.deleteCustomVoice);
// TTS con voz personalizada (devuelve audio WAV)
router.post('/tts/speak',       vc.customSpeak);
// Lanzar pre-calentado explícito (p.ej. nuevos tableros asignados)
router.post('/:userId/prewarm',     vc.triggerPrewarm);
// Diagnóstico: cobertura de caché
router.get('/:userId/cache-status', vc.getCacheStatus);

module.exports = router;
