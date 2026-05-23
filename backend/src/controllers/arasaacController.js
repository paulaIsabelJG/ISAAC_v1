const arasaacService = require('../services/arasaacService');

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
