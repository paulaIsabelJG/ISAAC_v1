const express = require('express');
const cors = require('cors');
const authRoutes   = require('./routes/auth');
const arasaacRoutes = require('./routes/arasaac');
const phrasesRoutes = require('./routes/phrases');
const userRoutes   = require('./routes/users');
const placesRoutes = require('./routes/places');
const boardRoutes  = require('./routes/boards');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Auth routes
app.use('/api/auth', authRoutes);

// ARASAAC routes
app.use('/api/arasaac', arasaacRoutes);

// User routes
app.use('/api/users', userRoutes);

// Board routes
app.use('/api/boards', boardRoutes);

// Phrase routes
app.use('/api/phrases', phrasesRoutes);

// Places / geocoding routes
app.use('/api/places', placesRoutes);

module.exports = app;
