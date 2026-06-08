const express = require('express');
const cors = require('cors');
const authRoutes   = require('./routes/auth');
const arasaacRoutes = require('./routes/arasaac');
const phrasesRoutes = require('./routes/phrases');
const userRoutes   = require('./routes/users');
const placesRoutes = require('./routes/places');
const boardRoutes  = require('./routes/boards');
const folderRoutes = require('./routes/folders');
const oblRoutes         = require('./routes/obl');
const aacStatisticsRoutes = require('./routes/aacStatistics');
const aiRoutes            = require('./routes/ai');
const aacPredictionRoutes = require('./routes/aacPrediction');
const voiceRoutes         = require('./routes/voice');
const objectiveRoutes     = require('./routes/objectives');

const app = express();

// Orígenes permitidos: desarrollo local + URL de producción del frontend (Render).
// FRONTEND_URL se configura en las variables de entorno de Render.
// Si no está definida en producción, solo se permite localhost (más seguro).
const ALLOWED_ORIGINS = [
  'http://localhost:8100',
  'http://localhost:4200',
  'http://localhost:4000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Permitir peticiones sin origin (herramientas, mobile nativo, curl)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '15mb' })); // 15 MB: las muestras de audio en base64 pueden superar 10 MB

// Auth routes
app.use('/api/auth', authRoutes);

// ARASAAC routes
app.use('/api/arasaac', arasaacRoutes);

// User routes
app.use('/api/users', userRoutes);

// Board routes
app.use('/api/boards',  boardRoutes);
app.use('/api/folders', folderRoutes);

// OBL routes
app.use('/api/obl', oblRoutes);

// AAC Statistics routes
app.use('/api/aac-statistics', aacStatisticsRoutes);

// Phrase routes
app.use('/api/phrases', phrasesRoutes);

// AI (reformulación de frases AAC con OpenAI)
app.use('/api/ai', aiRoutes);

// Predictor IA (scoring por pesos sobre historial OBL)
app.use('/api/aac-prediction', aacPredictionRoutes);

// Places / geocoding routes
app.use('/api/places', placesRoutes);

// Voz personalizada (muestra + OpenVoice + caché TTS)
app.use('/api/voice', voiceRoutes);

// Objetivos terapéuticos
app.use('/api/objectives', objectiveRoutes);

module.exports = app;
