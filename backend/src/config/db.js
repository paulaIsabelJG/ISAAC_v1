const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize:               10,   // conexiones concurrentes máximas (default: 5)
      minPoolSize:               2,    // mantiene 2 conexiones calientes
      serverSelectionTimeoutMS:  10000,
      socketTimeoutMS:           45000,
    });
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;