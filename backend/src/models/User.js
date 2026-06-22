const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  surname: {
    type: String,
    default: ''
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['teacher', 'parent', 'user'],
    default: 'user',
    required: true
  },
  // Solo para teachers creados por una organización (profesionales).
  // Las cuentas de organización no tienen este campo.
  professionalType: {
    type: String,
    default: null
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'prefer_not_to_say'],
    default: 'prefer_not_to_say'
  },
  birthDate: {
    type: Date,
    default: null
  },
  image: {
    type: String,
    default: null
  },
  centro: {
    type: String,
    default: null
  },
  // Dirección (texto tal como la escribió el usuario / seleccionó del autocompletado)
  address:   { type: String, default: null },
  // Geolocalización (se rellena desde el autocompletado de direcciones)
  latitude:  { type: Number, default: null },
  longitude: { type: Number, default: null },
  city:      { type: String, default: null },
  country:   { type: String, default: null },
  hijos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Relación familiar → usuarios finales a cargo, con permisos por relación
  childrenAccess: [{
    childId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true
    },
    canViewStats:           { type: Boolean, default: false },
    canEditBoards:          { type: Boolean, default: false },
    canEditPersonalData:    { type: Boolean, default: false },
    canAddPictograms:       { type: Boolean, default: false },
    canAssignProfessionals: { type: Boolean, default: false },
    canAssignFamilies:      { type: Boolean, default: false },
    canViewAssignedBoards:  { type: Boolean, default: false },
  }],
  // Permisos propios del usuario final (qué puede ver cuando se loguea como él mismo)
  selfPermissions: {
    canEditPersonalData:    { type: Boolean, default: false },
    canEditBoards:          { type: Boolean, default: false },
    canViewStats:           { type: Boolean, default: false },
    canAddPictograms:       { type: Boolean, default: false },
    canAssignProfessionals: { type: Boolean, default: false },
    canAssignFamilies:      { type: Boolean, default: false },
    canManageObjectives:    { type: Boolean, default: false },
  },
  assignedProfessionals: [{
    professionalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true
    },
    canViewStats:           { type: Boolean, default: false },
    canEditBoards:          { type: Boolean, default: false },
    canEditPersonalData:    { type: Boolean, default: false },
    canAddPictograms:       { type: Boolean, default: false },
    canAssignProfessionals: { type: Boolean, default: false },
    canAssignFamilies:      { type: Boolean, default: false },
    canViewAssignedBoards:  { type: Boolean, default: false },
  }],
  // Configuración de síntesis de voz — solo relevante para usuarios finales
  voiceSettings: {
    soundEnabled: { type: Boolean, default: false },
    voiceMode:    { type: String, enum: ['catalog', 'custom'], default: 'catalog' },
    catalogVoice: {
      voiceName:    { type: String, default: null },
      voiceLang:    { type: String, default: null },
      voiceURI:     { type: String, default: null },
      speechRate:   { type: Number, default: 0.9 },
      speechPitch:  { type: Number, default: 1.0 },
      speechVolume: { type: Number, default: 1.0 },
    },
    customVoice: {
      enabled:            { type: Boolean, default: false },
      provider:           { type: String, enum: ['openvoice'], default: 'openvoice' },
      status:             { type: String, enum: ['disabled', 'sample_uploaded', 'processing', 'ready', 'error'], default: 'disabled' },
      referenceAudioPath: { type: String, default: null },
      speakerProfilePath: { type: String, default: null },
      consentAccepted:    { type: Boolean, default: false },
      consentAcceptedAt:  { type: Date,    default: null },
      consentText:        { type: String,  default: null },
      sampleUploadedAt:   { type: Date,    default: null },
      voiceCreatedAt:     { type: Date,    default: null },
      lastError:          { type: String,  default: null },
    },
  },
  // Lugares frecuentes (opcional). Se usan para context-awareness por ubicación en el predictor.
  frequentLocations: [{
    name:         { type: String, required: true },
    address:      { type: String, default: null },
    photoUrl:     { type: String, default: null },
    lat:          { type: Number, default: null },
    lng:          { type: Number, default: null },
    radiusMeters: { type: Number, default: 150 },
    enabled:      { type: Boolean, default: true },
  }],
  customPictograms: [{
    id: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true
    },
    imageUrl: {
      type: String,
      required: true
    },
    wordType: {
      type: String,
      default: 'misc'
    },
    description: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
userSchema.index({ centro: 1 }); // For querying teachers by center
userSchema.index({ parentId: 1 }); // For querying children by parent
userSchema.index({ type: 1 }); // For querying by user type

// Pre-save hook to hash password if modified
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Pre-save hook for validation
userSchema.pre('save', async function () {
  // Initialize arrays if not present
  if (!Array.isArray(this.hijos)) {
    this.hijos = [];
  }

  // Validate centro requirements
  if ((this.type === 'teacher' || this.type === 'user') && !this.centro) {
    throw new Error(`Centro is required for ${this.type}s`);
  }

  // Prevent inconsistent states
  if (this.type === 'teacher' && (this.hijos.length > 0 || this.parentId)) {
    throw new Error('Teachers cannot have hijos or parentId');
  }

  if (this.type === 'parent' && this.parentId) {
    throw new Error('Parents cannot have parentId');
  }

  if (this.type === 'user' && this.hijos.length > 0) {
    throw new Error('Users cannot have hijos');
  }

  // Consistency checks for relationships
  if (this.hijos.length > 0) {
    // Ensure all hijos are users
    const hijosUsers = await mongoose.model('User').find({ _id: { $in: this.hijos } });
    for (const hijo of hijosUsers) {
      if (hijo.type !== 'user') {
        throw new Error('Hijos must be users');
      }
    }
  }

  if (this.parentId) {
    // Ensure parent is a parent type
    const parent = await mongoose.model('User').findById(this.parentId);
    if (!parent || parent.type !== 'parent') {
      throw new Error('ParentId must reference a parent user');
    }
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function (plainPassword) {
  return bcrypt.compare(plainPassword, this.password);
};

// Method to generate unique pictogram ID
userSchema.methods.generatePictogramId = function () {
  return randomUUID();
};

module.exports = mongoose.model('User', userSchema);