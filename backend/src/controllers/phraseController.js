const mongoose = require('mongoose');
const Phrase = require('../models/Phrase');

const ALLOWED_SOURCES = ['arasaac', 'custom'];
const ALLOWED_ACTIONS = ['add', 'remove', 'restart'];

const validatePictograms = (pictograms) => {
  if (!Array.isArray(pictograms)) return false;
  return pictograms.every((pictogram) => {
    return pictogram
      && typeof pictogram.id === 'number'
      && typeof pictogram.source === 'string'
      && ALLOWED_SOURCES.includes(pictogram.source);
  });
};

const validateInteractions = (interactions) => {
  if (!Array.isArray(interactions)) return false;
  return interactions.every((interaction) => {
    if (!interaction || typeof interaction.action !== 'string') {
      return false;
    }
    if (!ALLOWED_ACTIONS.includes(interaction.action)) {
      return false;
    }
    if (interaction.pictogramId !== undefined && typeof interaction.pictogramId !== 'number') {
      return false;
    }
    if (interaction.timestamp !== undefined && isNaN(new Date(interaction.timestamp).getTime())) {
      return false;
    }
    return true;
  });
};

exports.createPhrase = async (req, res) => {
  try {
    const { pictograms, interactions, finalText } = req.body;

    if (!finalText || typeof finalText !== 'string') {
      return res.status(400).json({ error: 'finalText is required and must be a string' });
    }

    if (pictograms !== undefined && !validatePictograms(pictograms)) {
      return res.status(400).json({ error: 'Invalid pictograms format or values' });
    }

    if (interactions !== undefined && !validateInteractions(interactions)) {
      return res.status(400).json({ error: 'Invalid interactions format or values' });
    }

    const phrase = new Phrase({
      userId: req.userId,
      pictograms: pictograms || [],
      interactions: interactions || [],
      finalText
    });

    await phrase.save();

    res.status(201).json({ message: 'Phrase created successfully', phrase });
  } catch (error) {
    console.error('Create phrase error:', error);
    res.status(500).json({ error: 'Internal server error while creating phrase' });
  }
};

exports.getPhrases = async (req, res) => {
  try {
    const phrases = await Phrase.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.status(200).json({ phrases });
  } catch (error) {
    console.error('Get phrases error:', error);
    res.status(500).json({ error: 'Internal server error while retrieving phrases' });
  }
};

exports.getPhraseById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid phrase id' });
    }

    const phrase = await Phrase.findOne({ _id: id, userId: req.userId });
    if (!phrase) {
      return res.status(404).json({ error: 'Phrase not found' });
    }

    res.status(200).json({ phrase });
  } catch (error) {
    console.error('Get phrase by id error:', error);
    res.status(500).json({ error: 'Internal server error while retrieving phrase' });
  }
};

exports.getPhrasesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const phrases = await Phrase.find({ userId }).sort({ createdAt: -1 });
    res.status(200).json({ phrases });
  } catch (error) {
    console.error('Get phrases by user id error:', error);
    res.status(500).json({ error: 'Internal server error while retrieving phrases' });
  }
};
