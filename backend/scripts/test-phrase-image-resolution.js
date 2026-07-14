/**
 * Comprobación manual (sin DB, sin framework de test) de la corrección de
 * imágenes de pictogramas propios en Estadísticas > Frases.
 *
 * Ejecutar: node backend/scripts/test-phrase-image-resolution.js
 *
 * Cubre:
 *   1. Pictograma ARASAAC con URL absoluta   → se conserva tal cual.
 *   2. Pictograma propio con imagen recuperable vía join por buttonId.
 *   3. Pictograma sin imagen (ni event.image_url ni match)  → queda null, sin romper.
 *   4. Frase antigua (sin ext_isaac_phrase_id, fallback phraseId) → no rompe la reconstrucción.
 */
const assert = require('assert');
const { reconstructPhrases } = require('../src/services/phraseReconstructionService');
const { _mergeCustomPictogramImages: mergeCustomPictogramImages } = require('../src/services/aacStatisticsService');

function makeEvent(overrides) {
  return {
    id: overrides.id || `ev-${Math.random().toString(36).slice(2)}`,
    type: 'button',
    timestamp: overrides.timestamp,
    label: overrides.label,
    spoken: true,
    button_id: overrides.button_id,
    board_id: 'board-1',
    ...overrides,
  };
}

// ── Caso 1+2+3: sesión "nueva" (con ext_isaac_phrase_id) ─────────────────────
const userId = 'user-1';
const sessionId = 'session-new';
const phraseUuid = 'phrase-uuid-1';

const newSession = {
  sessionId,
  userId,
  started: '2026-01-01T10:00:00.000Z',
  ended:   '2026-01-01T10:00:05.000Z',
  events: [
    makeEvent({
      timestamp: '2026-01-01T10:00:01.000Z',
      label: 'Hola',
      button_id: 'arasaac-1',
      image_url: 'https://static.arasaac.org/pictograms/2427/2427_500.png', // absoluta → se guarda en el evento
      ext_isaac_phrase_id: phraseUuid,
    }),
    makeEvent({
      timestamp: '2026-01-01T10:00:02.000Z',
      label: 'Mamá',
      button_id: 'custom-1',
      // sin image_url: logButtonEvent la omite porque era un data-URI base64
      ext_isaac_phrase_id: phraseUuid,
    }),
    makeEvent({
      timestamp: '2026-01-01T10:00:03.000Z',
      label: 'Sin imagen',
      button_id: 'no-image-1',
      // sin image_url y sin custom pictogram asociado
      ext_isaac_phrase_id: phraseUuid,
    }),
    {
      id: 'ev-speak', type: 'action', action: ':speak',
      timestamp: '2026-01-01T10:00:04.000Z',
      ext_isaac_phrase_id: phraseUuid,
    },
  ],
};

const [phrase] = reconstructPhrases(newSession);
assert.ok(phrase, 'la frase debería reconstruirse');
assert.strictEqual(phrase.phraseId, `${sessionId}_${phraseUuid}`, 'phraseId debe usar el UUID estable, no el texto');

const mapByUser = new Map([
  [userId, new Map([['custom-1', 'data:image/png;base64,AAAAFAKE=']])],
]);
mergeCustomPictogramImages([phrase], mapByUser);

const arasaacInter = phrase.interactions.find(i => i.buttonId === 'arasaac-1');
const customInter  = phrase.interactions.find(i => i.buttonId === 'custom-1');
const emptyInter   = phrase.interactions.find(i => i.buttonId === 'no-image-1');

// 1. ARASAAC: URL absoluta intacta
assert.strictEqual(arasaacInter.imageUrl, 'https://static.arasaac.org/pictograms/2427/2427_500.png');

// 2. Propio: recuperado desde customPictograms por buttonId
assert.strictEqual(customInter.imageUrl, 'data:image/png;base64,AAAAFAKE=');

// 3. Sin imagen y sin match: se queda null, no lanza error
assert.strictEqual(emptyInter.imageUrl, null);

console.log('✓ Caso 1 (ARASAAC absoluta), 2 (propio recuperado) y 3 (sin imagen) OK');

// ── Caso 4: frase antigua, sin ext_isaac_phrase_id (logs previos a esta extensión) ──
const oldSessionId = 'session-old';
const oldSession = {
  sessionId: oldSessionId,
  userId,
  started: '2025-01-01T09:00:00.000Z',
  ended:   '2025-01-01T09:00:03.000Z',
  events: [
    makeEvent({
      timestamp: '2025-01-01T09:00:01.000Z',
      label: 'Hola vieja',
      button_id: 'custom-old-1',
      // sin ext_isaac_phrase_id: log anterior a la extensión
    }),
    { id: 'ev-speak-old', type: 'action', action: ':speak', timestamp: '2025-01-01T09:00:02.000Z' },
  ],
};

const [oldPhrase] = reconstructPhrases(oldSession);
assert.ok(oldPhrase, 'la frase antigua debería reconstruirse igualmente');
assert.strictEqual(
  oldPhrase.phraseId,
  `${oldSessionId}_${new Date(oldSession.started).getTime()}`,
  'sin ext_isaac_phrase_id debe usar el fallback sessionId_startMs'
);

// El merge no debe lanzar aunque no haya customPictogram para este usuario/id
assert.doesNotThrow(() => mergeCustomPictogramImages([oldPhrase], new Map()));
assert.strictEqual(oldPhrase.interactions.find(i => i.buttonId === 'custom-old-1').imageUrl, null);

console.log('✓ Caso 4 (frase antigua sin ext_isaac_phrase_id) OK — no se rompe la reconstrucción');

console.log('\nTodas las comprobaciones pasaron.');
