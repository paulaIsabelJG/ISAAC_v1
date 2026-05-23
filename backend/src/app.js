const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const arasaacRoutes = require('./routes/arasaac');
const phrasesRoutes = require('./routes/phrases');
const userRoutes = require('./routes/users');

const app = express();

console.log('APP JS CARGADO - VERSION NUEVA');

app.use(cors());
app.use(express.json());

// Auth routes
app.use('/api/auth', authRoutes);

// ARASAAC routes
app.use('/api/arasaac', arasaacRoutes);

// User routes
app.use('/api/users', userRoutes);

// Phrase routes
app.use('/api/phrases', (req, res, next) => {
  console.log('PHRASES MOUNT HIT:', req.method, req.originalUrl);
  next();
});
app.use('/api/phrases', phrasesRoutes);

app.post('/api/phrases-direct', (req, res) => {
  console.log('DIRECT PHRASES ROUTE HIT');
  res.json({ ok: true, route: 'direct' });
});


//Añadido
app.get('/api/test-db', async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const state = mongoose.connection.readyState;
    return res.json({ ok: true, mongoState: state });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/ping', (req, res) => {
  console.log('PING HIT');
  res.status(200).json({
    ok: true,
    body: req.body
  });
});
module.exports = app;
