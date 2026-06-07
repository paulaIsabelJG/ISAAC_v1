const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const axios  = require('axios');
const User          = require('../models/User');
const Board         = require('../models/Board');
const TtsAudioCache = require('../models/TtsAudioCache');

const PYTHON_URL       = process.env.PYTHON_VOICE_URL  || 'http://localhost:8000';
const VOICE_ENABLED    = process.env.VOICE_ENABLED     !== 'false'; // true por defecto
const VOICE_TIMEOUT_MS = parseInt(process.env.VOICE_TIMEOUT_MS || '180000', 10);

const UPLOADS_DIR   = path.join(__dirname, '../../uploads');
const SAMPLES_DIR   = path.join(UPLOADS_DIR, 'voice-samples');
const TTS_CACHE_DIR = path.join(UPLOADS_DIR, 'tts-cache');

// Crear directorios en arranque (sincrónico, rápido)
[UPLOADS_DIR, SAMPLES_DIR, TTS_CACHE_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Etiquetas de navegación fijas que siempre se pre-calientan
const NAV_LABELS = [
  'salir', 'volver', 'mis objetivos', 'datos personales',
  'estadísticas', 'tablero builder', 'tablero',
];

/**
 * Sintetiza un texto con la voz del usuario y lo guarda en caché.
 * No hace nada si ya existe en caché. Devuelve true si se generó, false si ya existía.
 */
async function synthesizeAndCache(userId, text, speakerProfilePath, version) {
  const normalised = text.trim().toLowerCase();
  if (!normalised) return false;

  const textHash = crypto.createHash('sha256')
    .update(`${userId}:${normalised}:${version}`)
    .digest('hex');

  const existing = await TtsAudioCache.findOne({ userId, textHash, voiceMode: 'custom' });
  if (existing && fs.existsSync(existing.audioPath)) return false;

  const pyRes = await axios.post(`${PYTHON_URL}/voice/synthesize`, {
    userId,
    text: normalised,
    speakerProfilePath,
  }, { responseType: 'arraybuffer', timeout: VOICE_TIMEOUT_MS });

  const userCacheDir = path.join(TTS_CACHE_DIR, userId);
  if (!fs.existsSync(userCacheDir)) fs.mkdirSync(userCacheDir, { recursive: true });
  const audioPath = path.join(userCacheDir, `${textHash}.wav`);
  fs.writeFileSync(audioPath, Buffer.from(pyRes.data));

  await TtsAudioCache.findOneAndUpdate(
    { userId, textHash, voiceMode: 'custom' },
    { userId, textHash, text: normalised, voiceMode: 'custom', voiceProvider: 'openvoice',
      audioPath, lastUsedAt: new Date() },
    { upsert: true, new: true },
  );
  return true;
}

/**
 * Recorre en BFS todos los tableros accesibles para un usuario:
 * - tableros principales/multi asignados
 * - subtableros secundarios enlazados por action.targetBoardId (recursivo)
 * Devuelve array de objetos { name, cells } con toda la información de cada tablero.
 */
async function collectAllBoardsForUser(userId) {
  // Tableros raíz asignados (main + multi). Seleccionamos también multiBoardSlots
  // para poder seguir los tableros enlazados en multitableros.
  const rootBoards = await Board.find({
    $and: [
      { $or: [{ boardRole: 'main' }, { boardRole: 'multi' }, { boardRole: { $exists: false } }] },
      { $or: [{ assignedUserIds: userId }, { userId }] },
      { visibleInProfile: true },
    ],
  }).select('name cells multiBoardSlots').lean();

  const visited = new Map(); // boardId → board
  const queue   = [...rootBoards];

  for (const b of rootBoards) visited.set(String(b._id), b);

  while (queue.length > 0) {
    const board = queue.shift();

    // Recoger IDs enlazados: navegación por celda Y slots de multitablero
    const linkedIds = [
      ...(board.cells ?? []).map(c => c.action?.targetBoardId),
      ...(board.multiBoardSlots ?? []).map(s => s.boardId),
    ].filter(id => id && !visited.has(String(id)));

    if (linkedIds.length === 0) continue;

    const subBoards = await Board.find({ _id: { $in: linkedIds } })
      .select('name cells multiBoardSlots').lean();

    for (const sub of subBoards) {
      visited.set(String(sub._id), sub);
      queue.push(sub);
    }
  }

  return [...visited.values()];
}

/**
 * Pre-calienta la caché TTS del usuario: sintetiza todas las etiquetas de sus
 * tableros asignados + subtableros enlazados + etiquetas de navegación fijas.
 * Se ejecuta en segundo plano tras crear la voz; los errores individuales no
 * abortan el proceso.
 */
async function prewarmUserVoiceCache(userId, speakerProfilePath, voiceCreatedAt) {
  const version = voiceCreatedAt ? new Date(voiceCreatedAt).getTime() : 0;

  // 1. Recoger etiquetas de TODOS los tableros (principales + subtableros)
  let boardLabels = [];
  let boardCount  = 0;
  try {
    const boards = await collectAllBoardsForUser(userId);
    boardCount = boards.length;
    for (const board of boards) {
      if (board.name) boardLabels.push(board.name);
      for (const cell of board.cells ?? []) {
        const lbl = cell.pictogram?.sound || cell.pictogram?.label;
        if (lbl) boardLabels.push(lbl);
      }
    }
  } catch (err) {
    console.warn('[prewarm] Error al leer tableros:', err.message);
  }

  // 2. Combinar con etiquetas de navegación fijas y deduplicar
  const all = [...new Set(
    [...NAV_LABELS, ...boardLabels]
      .map(l => l?.trim().toLowerCase())
      .filter(Boolean),
  )];

  console.log(`[prewarm] Iniciando pre-calentado para userId=${userId}: ${all.length} etiquetas en ${boardCount} tableros (principales + subtableros)`);

  let ok = 0, skip = 0, fail = 0;
  for (const label of all) {
    try {
      const generated = await synthesizeAndCache(userId, label, speakerProfilePath, version);
      generated ? ok++ : skip++;
    } catch (err) {
      fail++;
      console.warn(`[prewarm] Error sintetizando "${label}":`, err.message);
    }
  }
  console.log(`[prewarm] Completado — generados:${ok} ya existían:${skip} errores:${fail}`);
}

// ── Helpers de aislamiento ────────────────────────────────────────────────────

/**
 * Respuesta estándar cuando el servicio de voz está desactivado o no alcanzable.
 * Devuelve 503 para que el frontend pueda mostrarlo como mensaje controlado.
 */
function voiceUnavailable(res) {
  return res.status(503).json({
    success: false,
    message: 'El servicio de voz no está disponible en este momento.',
  });
}

/**
 * Manejo unificado de errores de red/timeout al llamar al servicio Python.
 * Devuelve 503, 504 o 500 según el tipo de error, NUNCA propaga un crash.
 */
function handleVoiceCallError(err, res) {
  if (res.headersSent) return;
  const code = err.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
    console.warn('[voice] Servicio Python no alcanzable:', PYTHON_URL);
    return res.status(503).json({
      success: false,
      message: 'El servicio de voz no está disponible en este momento.',
    });
  }
  if (code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
    console.warn('[voice] Timeout al llamar al servicio Python.');
    return res.status(504).json({
      success: false,
      message: 'El servicio de voz tardó demasiado. Inténtalo de nuevo más tarde.',
    });
  }
  const detail = err?.response?.data?.detail;
  console.error('[voice] Error inesperado:', err.code || '', err.message);
  return res.status(500).json({
    success: false,
    message: detail || err.message || 'Error interno al procesar la voz.',
  });
}

// ── GET /api/voice/health ─────────────────────────────────────────────────────
exports.getVoiceHealth = async (req, res) => {
  if (!VOICE_ENABLED) {
    return res.json({ enabled: false, reachable: false, modelsReady: false });
  }
  try {
    const result = await axios.get(`${PYTHON_URL}/health`, { timeout: 5_000 });
    res.json({ enabled: true, reachable: true, ...result.data });
  } catch {
    res.json({ enabled: true, reachable: false, modelsReady: false });
  }
};

// ── POST /api/voice/:userId/sample ────────────────────────────────────────────
exports.uploadVoiceSample = async (req, res) => {
  if (!VOICE_ENABLED) return voiceUnavailable(res);
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
    console.error('[voice] uploadVoiceSample error:', err);
    res.status(500).json({ error: err.message || 'Error interno' });
  }
};

// ── POST /api/voice/:userId/create ────────────────────────────────────────────
exports.createVoice = async (req, res) => {
  if (!VOICE_ENABLED) return voiceUnavailable(res);
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

    // Llamada asíncrona a Python — no bloquea la respuesta HTTP ni el event loop
    setImmediate(async () => {
      try {
        // Verificar que el servicio esté vivo antes de la llamada larga
        await axios.get(`${PYTHON_URL}/health`, { timeout: 5_000 });

        // La creación de perfil puede tardar varios minutos en CPU — timeout largo
        const response = await axios.post(`${PYTHON_URL}/voice/create`, {
          userId,
          referenceAudioPath: cv.referenceAudioPath,
        }, { timeout: 180_000 });

        const fresh = await User.findById(userId);
        if (!fresh) return;

        const voiceCreatedAt = new Date();
        fresh.voiceSettings.customVoice.status             = 'ready';
        fresh.voiceSettings.customVoice.speakerProfilePath = response.data.speakerProfilePath;
        fresh.voiceSettings.customVoice.voiceCreatedAt     = voiceCreatedAt;
        fresh.voiceSettings.customVoice.lastError          = null;
        fresh.voiceSettings.voiceMode                      = 'custom';
        fresh.markModified('voiceSettings');
        await fresh.save();

        // Pre-calentar caché en background (no bloquea ni lanza errores críticos)
        prewarmUserVoiceCache(userId, response.data.speakerProfilePath, voiceCreatedAt)
          .catch(err => console.warn('[prewarm] Error general:', err.message));

      } catch (err) {
        const pythonDetail       = err.response?.data?.detail;
        const isConnectionError  = err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'
                                || err.code === 'ECONNRESET';
        const isTimeout          = err.code === 'ETIMEDOUT' || err.message?.includes('timeout');

        const errorMsg = isConnectionError
          ? 'El servicio de síntesis de voz no está disponible. Contacta con el administrador.'
          : isTimeout
          ? 'El procesamiento tardó demasiado. Inténtalo de nuevo.'
          : (pythonDetail || err.message || 'Error desconocido al procesar la voz');

        console.error('[voice] createVoice Python error:', err.code || '', err.message);

        const fresh = await User.findById(userId).catch(() => null);
        if (fresh) {
          fresh.voiceSettings.customVoice.status    = 'error';
          fresh.voiceSettings.customVoice.lastError = errorMsg;
          fresh.markModified('voiceSettings');
          await fresh.save().catch(() => {});
        }
      }
    });

  } catch (err) {
    console.error('[voice] createVoice error:', err);
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
    console.error('[voice] getVoiceStatus error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ── DELETE /api/voice/:userId/custom ─────────────────────────────────────────
exports.deleteCustomVoice = async (req, res) => {
  if (!VOICE_ENABLED) return voiceUnavailable(res);
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (cv?.referenceAudioPath && fs.existsSync(cv.referenceAudioPath)) {
      fs.unlinkSync(cv.referenceAudioPath);
    }

    const cacheEntries = await TtsAudioCache.find({ userId, voiceMode: 'custom' });
    for (const entry of cacheEntries) {
      if (fs.existsSync(entry.audioPath)) fs.unlinkSync(entry.audioPath);
    }
    await TtsAudioCache.deleteMany({ userId, voiceMode: 'custom' });

    if (!user.voiceSettings) user.voiceSettings = {};
    user.voiceSettings.voiceMode   = 'catalog';
    user.voiceSettings.customVoice = {
      enabled: false, provider: 'openvoice', status: 'disabled',
      referenceAudioPath: null, speakerProfilePath: null,
      consentAccepted: false, consentAcceptedAt: null,
      consentText: null, sampleUploadedAt: null,
      voiceCreatedAt: null, lastError: null,
    };
    await user.save();

    res.json({ message: 'Voz personalizada eliminada', status: 'disabled' });
  } catch (err) {
    console.error('[voice] deleteCustomVoice error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ── POST /api/voice/tts/speak ─────────────────────────────────────────────────
exports.customSpeak = async (req, res) => {
  if (!VOICE_ENABLED) return voiceUnavailable(res);
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

    const version  = cv.voiceCreatedAt ? new Date(cv.voiceCreatedAt).getTime() : 0;
    const textHash = crypto.createHash('sha256')
      .update(`${userId}:${text.trim().toLowerCase()}:${version}`)
      .digest('hex');

    // Buscar en caché
    const cached = await TtsAudioCache.findOne({ userId, textHash, voiceMode: 'custom' });
    if (cached && fs.existsSync(cached.audioPath)) {
      cached.lastUsedAt = new Date();
      await cached.save();
      return res.sendFile(path.resolve(cached.audioPath));
    }

    // No está en caché: sintetizar y guardar
    await synthesizeAndCache(userId, text, cv.speakerProfilePath, version);

    const audioPath = path.join(TTS_CACHE_DIR, userId, `${textHash}.wav`);
    res.sendFile(path.resolve(audioPath));

  } catch (err) {
    handleVoiceCallError(err, res);
  }
};

// ── Startup: reanudar prewarms interrumpidos ──────────────────────────────────
/**
 * Llamado al arrancar el servidor. Busca usuarios con voz personalizada lista
 * y lanza su prewarm en background. Como synthesizeAndCache salta labels ya
 * cacheados, solo sintetiza lo que falta — es idempotente y seguro de relanzar.
 */
exports.resumeIncompletePrewarms = async function () {
  try {
    const users = await User.find({
      'voiceSettings.voiceMode':            'custom',
      'voiceSettings.customVoice.status':   'ready',
      'voiceSettings.customVoice.speakerProfilePath': { $exists: true, $ne: null },
    }).select('_id voiceSettings').lean();

    if (users.length === 0) return;
    console.log(`[startup-prewarm] ${users.length} usuario(s) con voz personalizada — verificando caché...`);

    for (const user of users) {
      const cv     = user.voiceSettings.customVoice;
      const userId = String(user._id);
      // Lanzar en background sin bloquear el bucle
      prewarmUserVoiceCache(userId, cv.speakerProfilePath, cv.voiceCreatedAt)
        .catch(err => console.warn(`[startup-prewarm] Error userId=${userId}:`, err.message));
    }
  } catch (err) {
    console.warn('[startup-prewarm] Error al relanzar prewarms:', err.message);
  }
};

// ── POST /api/voice/:userId/prewarm ──────────────────────────────────────────
exports.triggerPrewarm = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('voiceSettings');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (cv?.status !== 'ready' || !cv.speakerProfilePath) {
      return res.status(400).json({ error: 'La voz personalizada no está lista' });
    }

    // Lanza en background sin bloquear la respuesta
    prewarmUserVoiceCache(userId, cv.speakerProfilePath, cv.voiceCreatedAt)
      .catch(err => console.warn('[prewarm] triggerPrewarm error:', err.message));

    res.json({ started: true });
  } catch (err) {
    console.error('[voice] triggerPrewarm error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};

// ── GET /api/voice/:userId/cache-status ───────────────────────────────────────
exports.getCacheStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('voiceSettings');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const cv = user.voiceSettings?.customVoice;
    if (cv?.status !== 'ready') {
      return res.json({ ready: false, message: 'La voz personalizada no está lista' });
    }

    const version = cv.voiceCreatedAt ? new Date(cv.voiceCreatedAt).getTime() : 0;

    // Recoger todas las etiquetas esperadas
    let boardCount = 0;
    let expectedLabels = [...NAV_LABELS];
    try {
      const boards = await collectAllBoardsForUser(userId);
      boardCount = boards.length;
      for (const board of boards) {
        if (board.name) expectedLabels.push(board.name);
        for (const cell of board.cells ?? []) {
          const lbl = cell.pictogram?.sound || cell.pictogram?.label;
          if (lbl) expectedLabels.push(lbl);
        }
      }
    } catch {}

    const unique = [...new Set(expectedLabels.map(l => l?.trim().toLowerCase()).filter(Boolean))];

    // Verificar qué hay en caché
    const missing = [];
    const cached  = [];
    for (const label of unique) {
      const textHash = crypto.createHash('sha256')
        .update(`${userId}:${label}:${version}`)
        .digest('hex');
      const entry = await TtsAudioCache.findOne({ userId, textHash, voiceMode: 'custom' }).lean();
      if (entry && fs.existsSync(entry.audioPath)) {
        cached.push(label);
      } else {
        missing.push(label);
      }
    }

    res.json({
      ready:         true,
      boardCount,
      totalLabels:   unique.length,
      cachedCount:   cached.length,
      missingCount:  missing.length,
      coveragePct:   unique.length > 0 ? Math.round(cached.length / unique.length * 100) : 100,
      missing,
    });
  } catch (err) {
    console.error('[voice] getCacheStatus error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
};
