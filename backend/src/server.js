require('dotenv').config();

const app       = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 4000;

connectDB();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Reanudar prewarms interrumpidos (p.ej. tras reinicio de nodemon).
  // Espera 5 s para que MongoDB esté disponible antes de hacer queries.
  setTimeout(() => {
    const { resumeIncompletePrewarms } = require('./controllers/voiceController');
    resumeIncompletePrewarms()
      .catch(err => console.warn('[startup] Error en resumeIncompletePrewarms:', err.message));
  }, 5_000);
});