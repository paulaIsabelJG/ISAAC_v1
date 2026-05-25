/**
 * backfillBoardCreatedBy.js
 *
 * Rellena los campos `createdBy` y `creatorName` en los tableros que aún no los tienen,
 * copiando el valor de `creatorId` (campo legacy) como `createdBy`
 * y resolviendo el nombre del usuario desde la colección User como `creatorName`.
 *
 * Uso:
 *   MONGO_URI="mongodb+srv://..." node backend/scripts/backfillBoardCreatedBy.js
 *
 * Si MONGO_URI no está en el entorno, intenta leerla de backend/.env.
 *
 * Flags opcionales:
 *   --dry-run   Solo informa cuántos documentos se actualizarían, sin tocar la BD.
 *   --verbose   Imprime el _id de cada tablero modificado.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Cargar .env si no hay MONGO_URI en el entorno ────────────────────────────
if (!process.env.MONGO_URI) {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log('[backfill] .env cargado desde', envPath);
  }
}

const mongoose = require('mongoose');

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('[backfill] ERROR: MONGO_URI no definida. Pásala como variable de entorno o añádela a backend/.env');
    process.exit(1);
  }

  console.log('[backfill] Conectando a MongoDB…');
  await mongoose.connect(uri);
  console.log('[backfill] Conectado.');

  const Board = mongoose.model(
    'Board',
    new mongoose.Schema({
      creatorId:   mongoose.Schema.Types.ObjectId,
      createdBy:   mongoose.Schema.Types.ObjectId,
      creatorName: String,
    }, { strict: false }),
  );

  const User = mongoose.model(
    'User',
    new mongoose.Schema({ name: String }, { strict: false }),
  );

  // Tableros sin createdBy pero CON creatorId
  const filter = {
    createdBy: { $exists: false },
    creatorId: { $exists: true, $ne: null },
  };

  const total = await Board.countDocuments(filter);
  console.log(`[backfill] Tableros pendientes de backfill: ${total}`);

  if (total === 0) {
    console.log('[backfill] Nada que actualizar. Saliendo.');
    await mongoose.disconnect();
    return;
  }

  if (DRY_RUN) {
    console.log('[backfill] --dry-run activo: no se modificará ningún documento.');
    if (VERBOSE) {
      const docs = await Board.find(filter, { _id: 1, creatorId: 1 }).lean();
      docs.forEach(d => console.log(`  _id=${d._id}  creatorId=${d.creatorId}`));
    }
    await mongoose.disconnect();
    return;
  }

  // Construir mapa userId → name para evitar consultas repetidas
  const creatorIds = await Board.distinct('creatorId', filter);
  const users      = await User.find({ _id: { $in: creatorIds } }, { name: 1 }).lean();
  const nameMap    = new Map(users.map(u => [String(u._id), u.name ?? '']));

  console.log(`[backfill] Usuarios resueltos: ${nameMap.size}`);

  // Procesar en lotes
  const BATCH = 200;
  let updated = 0;
  const cursor = Board.find(filter, { _id: 1, creatorId: 1 }).lean().cursor();

  let batch = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) {
      updated += await flushBatch(Board, batch, nameMap, VERBOSE);
      batch = [];
    }
  }
  if (batch.length) {
    updated += await flushBatch(Board, batch, nameMap, VERBOSE);
  }

  console.log(`[backfill] ✅ Actualizados ${updated} de ${total} tableros.`);
  await mongoose.disconnect();
}

async function flushBatch(Board, docs, nameMap, verbose) {
  const ops = docs.map(doc => ({
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: {
          createdBy:   doc.creatorId,
          creatorName: nameMap.get(String(doc.creatorId)) ?? '',
        },
      },
    },
  }));

  const result = await Board.bulkWrite(ops, { ordered: false });
  if (verbose) {
    docs.forEach(d => console.log(
      `  backfilled _id=${d._id}  createdBy=${d.creatorId}  creatorName="${nameMap.get(String(d.creatorId)) ?? ''}"`
    ));
  }
  return result.modifiedCount;
}

main().catch(err => {
  console.error('[backfill] ERROR fatal:', err);
  process.exit(1);
});
