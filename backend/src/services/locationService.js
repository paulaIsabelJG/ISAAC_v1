const User = require('../models/User');

// ── Haversine ─────────────────────────────────────────────────────────────────

/**
 * Distancia en metros entre dos puntos geográficos (fórmula de Haversine).
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R    = 6371000; // radio terrestre en metros
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Geocodificación ───────────────────────────────────────────────────────────

/**
 * Convierte una dirección textual en coordenadas { lat, lng }.
 * Usa Nominatim (OpenStreetMap) — gratuito, sin clave API.
 * Para cambiar de proveedor (Google, Mapbox…) solo hay que reescribir esta función.
 *
 * @param {string} address
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
async function geocodeAddress(address) {
  if (!address?.trim()) return null;

  const encoded = encodeURIComponent(address.trim());
  const url     = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent':      'ISAAC-AAC-App/1.0',
      'Accept-Language': 'es',
    },
  });

  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

// ── Resolución de contexto ────────────────────────────────────────────────────

const GENERAL = { locationContext: 'general', locationId: null, locationName: null, distanceMeters: null };

/**
 * Dado el userId y la posición actual (lat/lng), determina cuál de los
 * lugares frecuentes del usuario está más cercano dentro de su radio.
 *
 * @param {{ userId: string, lat: number, lng: number }} params
 * @returns {Promise<{ locationContext, locationId, locationName, distanceMeters }>}
 */
async function resolveLocationContext({ userId, lat, lng }) {
  if (!userId || lat == null || lng == null) return GENERAL;

  let user;
  try {
    user = await User.findById(userId).select('frequentLocations').lean();
  } catch {
    return GENERAL;
  }

  const locations = (user?.frequentLocations ?? []).filter(
    l => l.enabled && l.lat != null && l.lng != null,
  );

  if (locations.length === 0) return GENERAL;

  let best     = null;
  let bestDist = Infinity;

  for (const loc of locations) {
    const dist   = haversineMeters(lat, lng, loc.lat, loc.lng);
    const radius = loc.radiusMeters ?? 150;
    if (dist <= radius && dist < bestDist) {
      best     = loc;
      bestDist = dist;
    }
  }

  if (!best) return GENERAL;

  return {
    locationContext: best.name,
    locationId:      String(best._id),
    locationName:    best.name,
    distanceMeters:  Math.round(bestDist),
  };
}

module.exports = { geocodeAddress, resolveLocationContext };
