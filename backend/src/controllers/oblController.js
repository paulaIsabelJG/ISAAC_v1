const OblLog = require('../models/OblLog');
const { randomUUID } = require('crypto');

// POST /api/obl  — start session
exports.startSession = async (req, res) => {
  try {
    const { userId, started } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const sessionId = randomUUID();
    const log = new OblLog({
      userId,
      sessionId,
      started: started || new Date().toISOString(),
      events:  [],
    });
    await log.save();
    console.log('[OBL] session started', sessionId, 'user:', userId);
    res.status(201).json({ sessionId });
  } catch (err) {
    console.error('[OBL] startSession error', err);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/obl/:sessionId/events  — append events
exports.appendEvents = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events[] required' });
    }
    const log = await OblLog.findOne({ sessionId });
    if (!log) return res.status(404).json({ error: 'Session not found' });
    log.events.push(...events);
    await log.save();
    res.json({ appended: events.length });
  } catch (err) {
    console.error('[OBL] appendEvents error', err);
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/obl/:sessionId/end  — end session
exports.endSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { ended, events } = req.body;
    const log = await OblLog.findOne({ sessionId });
    if (!log) return res.status(404).json({ error: 'Session not found' });
    log.ended = ended || new Date().toISOString();
    if (Array.isArray(events) && events.length > 0) {
      log.events.push(...events);
    }
    await log.save();
    console.log('[OBL] session ended', sessionId, 'events:', log.events.length);
    res.json({ ok: true, events: log.events.length });
  } catch (err) {
    console.error('[OBL] endSession error', err);
    res.status(500).json({ error: err.message });
  }
};

// GET /api/obl/user/:userId  — list sessions for user (last 20)
exports.getSessionsByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const logs = await OblLog.find({ userId }).sort({ started: -1 }).limit(20).lean();
    res.json({ sessions: logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
