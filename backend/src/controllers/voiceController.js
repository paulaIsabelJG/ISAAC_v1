const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const axios  = require('axios');
const User          = require('../models/User');
const TtsAudioCache = require('../models/TtsAudioCache');

const PYTHON_URL      = process.env.PYTHON_VOICE_URL || 'http://localhost:8000';
const UPLOADS_DIR     = path.join(__dirname, '../../uploads');
const SAMPLES_DIR     = path.join(UPLOADS_DIR, 'voice-samples');
const TTS_CACHE_DIR   = path.join(UPLOADS_DIR, 'tts-cache');

// Crear directorios en arranque
[UPLOADS_DIR, SAMPLES_DIR, TTS_CACHE_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── POST /api/voice/:userId/sample ────────────────────────────────────────────
exports.uploadVoiceSample = async (req, res) => {
  try {
    const { userId } = req.params;
    const { audioDataUrl, consentAccepted, consentText } = req.body;

    if (!audioDataUrl || typeof audioDataUrl !== 'string') {
      return res.status(400).json({ error: 'audioDataUrl es obligatorio' });
    }
    if (!consentAccepted) {
      return res.status(400).json({ error: 'Se requiere aceptar el consentimiento' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Parsear data URL: data:<mime>;base64,<datos>
    const match = audioDataUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return res.status(400).json({ error: 'Formato de audio inválido' });

    const [, mimeType, b64] = match;
    const audioBuffer = Buffer.from(b64, 'base64');

    // Validar tamaño (máx 10 MB)
    if (audioBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'La muestra de audio supera 10 MB' });
    }

    const ext = mimeType.includes('ogg') ? '.ogg'
              : mimeType.includes('mp4') ? '.mp4'
              : '.webm';

    const userDir    = path.join(SAMPLES_DIR, userId);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

    const samplePath = path.join(userDir, `sample${ext}`);
    fs.writeFileSync(samplePath, audioBuffer);

    if (!user.voiceSettings) user.voiceSettings = {};
    user.voiceSettings.customVoice = {
      enabled:            true,
      provider:           'openvoice',
      status:             'sample_uploaded',
      referenceAudioPath: samplePath,
      speakerProfilePath: user.voiceSettings.customVoice?.speakerProfilePath ?? null,
      consentAccepted:    true,
      consentAcceptedAt:  new Date(),
      consentText:        typeof consentText === 'string' ? consentText : 'Consentimiento aceptado',
      sampleUploadedAt:   new Date(),
      voiceCreatedAt:     null,
      lastError:          null,
    };
    user.markModified('voiceSettings');
    await user.save();

    res.json({ message: 'Muestra subida correctamente', status: 'sample_uploaded' });
  } catch (err) {
    console.error('uploadVoiceSample error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── POST /api/voice/:userId/create ────────────────────────────────────────────
exports.createVoice = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (!cv?.referenceAudioPath) {
      return res.status(400).json({ error: 'No hay muestra de audio. Súbela primero.' });
    }
    if (!cv.consentAccepted) {
      return res.status(400).json({ error: 'No se ha aceptado el consentimiento' });
    }
    if (!fs.existsSync(cv.referenceAudioPath)) {
      return res.status(400).json({ error: 'El archivo de muestra no existe en el servidor' });
    }

    user.voiceSettings.customVoice.status = 'processing';
    user.markModified('voiceSettings');
    await user.save();

    // Respuesta inmediata; Python procesa en segundo plano
    res.json({ message: 'Procesando voz personalizada', status: 'processing' });

    // Llamada asíncrona a Python (no bloquea la respuesta HTTP)
    setImmediate(async () => {
      try {
        // Verificar accesibilidad del servicio antes de la llamada larga
        await axios.get(`${PYTHON_URL}/health`, { timeout: 5_000 });

        const response = await axios.post(`${PYTHON_URL}/voice/create`, {
          userId,
          referenceAudioPath: cv.referenceAudioPath,
        }, { timeout: 180_000 });

        const fresh = await User.findById(userId);
        if (!fresh) return;

        fresh.voiceSettings.customVoice.status             = 'ready';
        fresh.voiceSettings.customVoice.speakerProfilePath = response.data.speakerProfilePath;
        fresh.voiceSettings.customVoice.voiceCreatedAt     = new Date();
        fresh.voiceSettings.customVoice.lastError          = null;
        fresh.voiceSettings.voiceMode                      = 'custom';
        fresh.markModified('voiceSettings');
        await fresh.save();

        // Preregeneración deshabilitada: en CPU tarda varios minutos por frase
        // y satura el servicio impidiendo síntesis en tiempo real.

      } catch (err) {
        // Extraer el mensaje más descriptivo posible del error
        const pythonDetail = err.response?.data?.detail;
        const isConnectionError = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET';
        const errorMsg = isConnectionError
          ? 'El servicio de síntesis de voz no está disponible. Contacta con el administrador.'
          : (pythonDetail || err.message || 'Error desconocido al procesar la voz');

        console.error('createVoice Python error:', err.code || '', err.message);
        const fresh = await User.findById(userId);
        if (fresh) {
          fresh.voiceSettings.customVoice.status    = 'error';
          fresh.voiceSettings.customVoice.lastError = errorMsg;
          fresh.markModified('voiceSettings');
          await fresh.save();
        }
      }
    });

  } catch (err) {
    console.error('createVoice error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── GET /api/voice/:userId/status ─────────────────────────────────────────────
exports.getVoiceStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('voiceSettings');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ voiceSettings: user.voiceSettings ?? {} });
  } catch (err) {
    console.error('getVoiceStatus error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ── DELETE /api/voice/:userId/custom ─────────────────────────────────────────
exports.deleteCustomVoice = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (cv?.referenceAudioPath && fs.existsSync(cv.referenceAudioPath)) {
      fs.unlinkSync(cv.referenceAudioPath);
    }

    // Limpiar caché de audio personalizado
    const cacheEntries = await TtsAudioCache.find({ userId, voiceMode: 'custom' });
    for (const entry of cacheEntries) {
      if (fs.existsSync(entry.audioPath)) fs.unlinkSync(entry.audioPath);
    }
    await TtsAudioCache.deleteMany({ userId, voiceMode: 'custom' });

    if (!user.voiceSettings) user.voiceSettings = {};
    user.voiceSettings.voiceMode    = 'catalog';
    user.voiceSettings.customVoice  = {
      enabled: false, provider: 'openvoice', status: 'disabled',
      referenceAudioPath: null, speakerProfilePath: null,
      consentAccepted: false, consentAcceptedAt: null,
      consentText: null, sampleUploadedAt: null,
      voiceCreatedAt: null, lastError: null,
    };
    await user.save();

    res.json({ message: 'Voz personalizada eliminada', status: 'disabled' });
  } catch (err) {
    console.error('deleteCustomVoice error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ── POST /api/voice/tts/speak ─────────────────────────────────────────────────
exports.customSpeak = async (req, res) => {
  try {
    const { userId, text } = req.body;
    if (!userId || !text?.trim()) {
      return res.status(400).json({ error: 'userId y text son obligatorios' });
    }

    const user = await User.findById(userId).select('voiceSettings');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (cv?.status !== 'ready') {
      return res.status(400).json({
        error: 'La voz personalizada no está lista',
        status: cv?.status ?? 'disabled',
      });
    }

    const version   = cv.voiceCreatedAt ? new Date(cv.voiceCreatedAt).getTime() : 0;
    const textHash  = crypto.createHash('sha256')
      .update(`${userId}:${text.trim()}:${version}`)
      .digest('hex');

    // Buscar en caché
    const cached = await TtsAudioCache.findOne({ userId, textHash, voiceMode: 'custom' });
    if (cached && fs.existsSync(cached.audioPath)) {
      cached.lastUsedAt = new Date();
      await cached.save();
      return res.sendFile(path.resolve(cached.audioPath));
    }

    // Generar vía Python
    const pyRes = await axios.post(`${PYTHON_URL}/voice/synthesize`, {
      userId,
      text: text.trim(),
      speakerProfilePath: cv.speakerProfilePath,
    }, { responseType: 'arraybuffer', timeout: 180_000 }); // 3 min — CPU synthesis es lento

    const userCacheDir = path.join(TTS_CACHE_DIR, userId);
    if (!fs.existsSync(userCacheDir)) fs.mkdirSync(userCacheDir, { recursive: true });
    const audioPath = path.join(userCacheDir, `${textHash}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(pyRes.data));

    await TtsAudioCache.findOneAndUpdate(
      { userId, textHash, voiceMode: 'custom' },
      { userId, textHash, text: text.trim(), voiceMode: 'custom', voiceProvider: 'openvoice', audioPath, lastUsedAt: new Date() },
      { upsert: true, new: true }
    );

    res.sendFile(path.resolve(audioPath));

  } catch (err) {
    console.error('customSpeak error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message || 'Error al generar audio' });
  }
};

// ── Pregenerar frases frecuentes en segundo plano ─────────────────────────────
const FREQUENT_PHRASES = [
  'Sí', 'No', 'Hola', 'Gracias', 'Tengo hambre', 'Tengo sed',
  'Quiero ir al baño', 'Necesito ayuda', 'Me duele',
];

async function pregenerateFrequentPhrases(userId, speakerProfilePath) {
  for (const phrase of FREQUENT_PHRASES) {
    try {
      const textHash = crypto.createHash('sha256')
        .update(`${userId}:${phrase}:pregenerated`)
        .digest('hex');

      const existing = await TtsAudioCache.findOne({ userId, textHash, voiceMode: 'custom' });
      if (existing && fs.existsSync(existing.audioPath)) continue;

      const pyRes = await axios.post(`${PYTHON_URL}/voice/synthesize`, {
        userId, text: phrase, speakerProfilePath,
      }, { responseType: 'arraybuffer', timeout: 180_000 }); // 3 min — CPU synthesis es lento

      const userCacheDir = path.join(TTS_CACHE_DIR, userId);
      if (!fs.existsSync(userCacheDir)) fs.mkdirSync(userCacheDir, { recursive: true });
      const audioPath = path.join(userCacheDir, `${textHash}.wav`);
      fs.writeFileSync(audioPath, Buffer.from(pyRes.data));

      await TtsAudioCache.findOneAndUpdate(
        { userId, textHash, voiceMode: 'custom' },
        { userId, textHash, text: phrase, voiceMode: 'custom', voiceProvider: 'openvoice', audioPath, lastUsedAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.warn(`Pregenerate frase "${phrase}" fallida:`, err.message);
    }
  }
}
