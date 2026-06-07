const mongoose = require('mongoose');
const User     = require('../models/User');
const { geocodeAddress, resolveLocationContext } = require('../services/locationService');

// GET /api/users/:userId/locations
exports.getLocations = async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('frequentLocations').lean();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ locations: user.frequentLocations ?? [] });
  } catch {
    return res.status(500).json({ error: 'Error al obtener lugares' });
  }
};

// POST /api/users/:userId/locations
exports.addLocation = async (req, res) => {
  try {
    const { name, address, photoUrl, radiusMeters, enabled } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const locId = new mongoose.Types.ObjectId();
    const loc = {
      _id:          locId,
      name:         name.trim(),
      address:      address?.trim() || null,
      photoUrl:     photoUrl?.trim() || null,
      lat:          null,
      lng:          null,
      radiusMeters: radiusMeters ?? 150,
      enabled:      enabled ?? true,
    };

    const updated = await User.findByIdAndUpdate(
      req.params.userId,
      { $push: { frequentLocations: loc } },
      { new: true, select: 'frequentLocations' },
    );
    if (!updated) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Geocodificar en background: no bloquea la respuesta
    if (loc.address) {
      geocodeAddress(loc.address)
        .then(coords => {
          if (!coords) return;
          return User.updateOne(
            { _id: req.params.userId, 'frequentLocations._id': locId },
            { $set: { 'frequentLocations.$.lat': coords.lat, 'frequentLocations.$.lng': coords.lng } },
          );
        })
        .catch(() => {});
    }

    const saved = updated.frequentLocations.id(locId);
    return res.status(201).json({ location: saved });
  } catch {
    return res.status(500).json({ error: 'Error al añadir lugar' });
  }
};

// PUT /api/users/:userId/locations/:locationId
exports.updateLocation = async (req, res) => {
  try {
    const { name, address, photoUrl, radiusMeters, enabled } = req.body;
    const { userId, locationId } = req.params;

    const set = {};
    if (name         != null) set['frequentLocations.$.name']         = name.trim();
    if (address      != null) set['frequentLocations.$.address']      = address.trim() || null;
    if (photoUrl     != null) set['frequentLocations.$.photoUrl']     = photoUrl.trim() || null;
    if (radiusMeters != null) set['frequentLocations.$.radiusMeters'] = radiusMeters;
    if (enabled      != null) set['frequentLocations.$.enabled']      = enabled;

    // Si la dirección cambió, resetear coords y disparar geocodificación
    if (address != null) {
      set['frequentLocations.$.lat'] = null;
      set['frequentLocations.$.lng'] = null;
      const trimmed = address.trim();
      if (trimmed) {
        geocodeAddress(trimmed)
          .then(coords => {
            if (!coords) return;
            return User.updateOne(
              { _id: userId, 'frequentLocations._id': locationId },
              { $set: { 'frequentLocations.$.lat': coords.lat, 'frequentLocations.$.lng': coords.lng } },
            );
          })
          .catch(() => {});
      }
    }

    const updated = await User.findOneAndUpdate(
      { _id: userId, 'frequentLocations._id': locationId },
      { $set: set },
      { new: true, select: 'frequentLocations' },
    );
    if (!updated) return res.status(404).json({ error: 'Lugar no encontrado' });

    const loc = updated.frequentLocations.id(locationId);
    return res.json({ location: loc });
  } catch {
    return res.status(500).json({ error: 'Error al actualizar lugar' });
  }
};

// DELETE /api/users/:userId/locations/:locationId
exports.deleteLocation = async (req, res) => {
  try {
    const { userId, locationId } = req.params;
    const updated = await User.findByIdAndUpdate(
      userId,
      { $pull: { frequentLocations: { _id: locationId } } },
      { new: true, select: 'frequentLocations' },
    );
    if (!updated) return res.status(404).json({ error: 'Usuario no encontrado' });
    return res.json({ message: 'Lugar eliminado' });
  } catch {
    return res.status(500).json({ error: 'Error al eliminar lugar' });
  }
};

// POST /api/users/:userId/locations/resolve
exports.resolveLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat == null || lng == null) {
      return res.json({ locationContext: 'general', locationId: null, locationName: null, distanceMeters: null });
    }
    const context = await resolveLocationContext({ userId: req.params.userId, lat, lng });
    return res.json(context);
  } catch {
    return res.status(500).json({ error: 'Error al resolver ubicación' });
  }
};
