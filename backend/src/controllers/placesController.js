const https = require('https');

/**
 * GET /api/places/autocomplete?q=...
 * Proxy hacia Nominatim (OpenStreetMap). Gratuito, sin API key.
 * Devuelve máx. 5 sugerencias con dirección, coordenadas, ciudad y país.
 */
exports.autocomplete = (req, res) => {
  const q = (req.query.q || '').trim();

  if (!q || q.length < 3) {
    return res.json({ suggestions: [] });
  }

  const apiUrl =
    'https://nominatim.openstreetmap.org/search' +
    `?q=${encodeURIComponent(q)}` +
    '&format=json&limit=5&addressdetails=1&accept-language=es';

  const options = {
    headers: {
      'User-Agent': 'ISAAC-App/1.0 (TFG educativo)',
      Accept: 'application/json',
    },
  };

  https
    .get(apiUrl, options, (apiRes) => {
      let raw = '';
      apiRes.on('data', (chunk) => { raw += chunk; });
      apiRes.on('end', () => {
        try {
          const results = JSON.parse(raw);
          const suggestions = results.slice(0, 5).map((r) => ({
            formattedAddress: r.display_name,
            lat: parseFloat(r.lat),
            lng: parseFloat(r.lon),
            city:
              r.address?.city ||
              r.address?.town ||
              r.address?.village ||
              r.address?.municipality ||
              null,
            country: r.address?.country || null,
          }));
          res.json({ suggestions });
        } catch (err) {
          console.error('Places parse error:', err);
          res.status(500).json({ error: 'Error parsing geocoding response' });
        }
      });
    })
    .on('error', (err) => {
      console.error('Places fetch error:', err);
      res.status(500).json({ error: 'Error contacting geocoding service' });
    });
};
