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

app.use(cors());
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
