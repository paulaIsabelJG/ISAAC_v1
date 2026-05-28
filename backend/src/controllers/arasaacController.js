const arasaacService     = require('../services/arasaacService');
const ArasaacPictogram   = require('../models/ArasaacPictogram');

const buildImageUrl = (id) => `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;

const normalizeKeywords = (keywordsInput) => {
  if (!Array.isArray(keywordsInput)) {
    return [];
  }

  return keywordsInput
    .map((keyword) => {
      if (typeof keyword === 'string') {
        return keyword;
      }
      if (keyword && typeof keyword === 'object') {
        return keyword.keyword || keyword.name || keyword.text || '';
      }
      return '';
    })
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
};

const simplifyPictogram = (raw) => {
  const keywords = normalizeKeywords(raw.keywords);
  const id = raw.id || raw._id || raw.idPictogram || raw._idPictogram;
  const label = keywords.length > 0 ? keywords[0] : raw.name || '';

  return {
    id,
    label,
    keywords,
    imageUrl: id ? buildImageUrl(id) : null,
    source: 'arasaac'
  };
};

exports.search = async (req, res) => {
  try {
    const { query, lang = 'es' } = req.query;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await arasaacService.searchPictograms(query, lang || 'es');
    if (!Array.isArray(results) || results.length === 0) {
      return res.json([]);
    }

    const simplified = results.map(simplifyPictogram);
    return res.json(simplified);
  } catch (error) {
    console.error('ARASAAC search error:', error.message || error);

    if (error.response && error.response.status === 404) {
      return res.json([]);
    }

    return res.status(500).json({ error: 'Unable to search ARASAAC pictograms' });
  }
};

// ── GET /api/arasaac/local/:id  — consulta la BD local sin llamar a ARASAAC ──
exports.getLocalPictogram = async (req, res) => {
  try {
    const numId = parseInt(req.params.id, 10);
    if (isNaN(numId)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const doc = await ArasaacPictogram.findOne({ arasaacId: numId }).lean();
    console.log('[ARASAAC local lookup]', req.params.id, doc?.arasaacId, doc?.keywords?.[0]);
    if (!doc) {
      return res.status(404).json({ error: 'Pictogram not found in local DB' });
    }
    return res.json({
      arasaacId:  doc.arasaacId,
      label:      doc.label,
      keywords:   doc.keywords   ?? [],
      categories: doc.categories ?? [],
      tags:       doc.tags       ?? [],
      imageUrl:   doc.imageUrl   ?? buildImageUrl(doc.arasaacId),
    });
  } catch (err) {
    console.error('getLocalPictogram error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// ── GET /api/arasaac/pictogram/:id  — consulta la API externa ARASAAC ─────────
exports.getPictogram = async (req, res) => {
  try {
    const { id } = req.params;
    const lang = req.query.lang || 'es';

    if (!id) {
      return res.status(400).json({ error: 'Pictogram id is required' });
    }

    const rawPictogram = await arasaacService.getPictogramById(id, lang);
    const simplified = simplifyPictogram(rawPictogram);

    return res.json(simplified);
  } catch (error) {
    console.error('ARASAAC pictogram error:', error.message || error);

    if (error.response && error.response.status === 404) {
      return res.status(404).json({ error: 'Pictogram not found' });
    }

    return res.status(500).json({ error: 'Unable to retrieve ARASAAC pictogram' });
  }
};
