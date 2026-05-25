#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');
const axios = require('axios');
const ArasaacPictogram = require('../src/models/ArasaacPictogram');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ MongoDB connected');
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

const fetchArasaacPictograms = async () => {
  try {
    console.log('📥 Fetching ARASAAC pictograms...');
    const response = await axios.get(
      'https://api.arasaac.org/api/pictograms/all/es',
      { timeout: 60000 }
    );
    return response.data || [];
  } catch (error) {
    console.error('✗ Failed to fetch pictograms:', error.message);
    throw error;
  }
};

const buildImageUrl = (id) => {
  return `https://static.arasaac.org/pictograms/${id}/${id}_500.png`;
};

/**
 * Normaliza el array de keywords de ARASAAC preservando el campo `type` numérico.
 * Devuelve objetos { keyword: string, type: number | null }.
 * ARASAAC type map: 1=noun/misc, 2=noun, 3=verb, 4=descriptor/adjective.
 */
const normalizeKeywords = (keywordsInput) => {
  if (!Array.isArray(keywordsInput)) return [];

  return keywordsInput
    .map((k) => {
      if (typeof k === 'string') {
        const trimmed = k.trim();
        return trimmed ? { keyword: trimmed, type: null } : null;
      }
      if (k && typeof k === 'object' && k.keyword) {
        const trimmed = String(k.keyword).trim();
        return trimmed
          ? { keyword: trimmed, type: typeof k.type === 'number' ? k.type : null }
          : null;
      }
      return null;
    })
    .filter((k) => k !== null);
};

const normalizeCategories = (categoriesInput) => {
  if (!Array.isArray(categoriesInput)) {
    return [];
  }

  return categoriesInput
    .map((cat) => {
      if (typeof cat === 'string') {
        return cat.trim();
      }
      if (cat && typeof cat === 'object' && cat.name) {
        return cat.name.trim();
      }
      return '';
    })
    .filter((cat) => cat.length > 0);
};

const syncPictograms = async (pictograms) => {
  let inserted = 0;
  let updated = 0;
  let failed = 0;

  console.log(`\n⚙️  Syncing ${pictograms.length} pictograms...`);

  for (let i = 0; i < pictograms.length; i++) {
    try {
      const pic = pictograms[i];
      const id = pic.id || pic._id;

      if (!id) {
        console.warn(`⚠️  Skipping pictogram without id`);
        failed++;
        continue;
      }

      const keywords = normalizeKeywords(pic.keywords || []);
      const label = keywords.length > 0 ? keywords[0].keyword : `Pictogram ${id}`;
      const categories = normalizeCategories(pic.categories || []);
      const tags = Array.isArray(pic.tags) ? pic.tags : [];

      const pictogramData = {
        arasaacId: id,
        label,
        keywords,
        imageUrl: buildImageUrl(id),
        categories,
        tags,
        lastUpdated: new Date(),
        lastSyncedAt: new Date()
      };

      const result = await ArasaacPictogram.updateOne(
        { arasaacId: id },
        pictogramData,
        { upsert: true }
      );

      if (result.upsertedId) {
        inserted++;
      } else if (result.modifiedCount > 0) {
        updated++;
      }

      if ((i + 1) % 1000 === 0) {
        console.log(`  Progress: ${i + 1}/${pictograms.length}`);
      }
    } catch (error) {
      console.error(`✗ Error syncing pictogram:`, error.message);
      failed++;
    }
  }

  return { inserted, updated, failed };
};

const main = async () => {
  try {
    console.log('🚀 Starting ARASAAC Catalog Sync...\n');

    await connectDB();

    const pictograms = await fetchArasaacPictograms();
    console.log(`✓ Received ${pictograms.length} pictograms from ARASAAC API`);

    const { inserted, updated, failed } = await syncPictograms(pictograms);

    console.log('\n📊 Sync Summary:');
    console.log(`  Total processed: ${pictograms.length}`);
    console.log(`  ✓ Inserted: ${inserted}`);
    console.log(`  ✓ Updated: ${updated}`);
    console.log(`  ✗ Failed: ${failed}`);

    await mongoose.connection.close();
    console.log('\n✓ Database connection closed');
    console.log('✓ Sync completed successfully!');
  } catch (error) {
    console.error('✗ Sync failed:', error.message);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  }
};

main();
