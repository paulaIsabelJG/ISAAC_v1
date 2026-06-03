/**
 * Migración: limpiar usuarios y configuración de tableros secundarios.
 *
 * Los tableros secundarios no deben tener usuarios asignados ni
 * configuración propia de comunicación (predictor, corrector IA, etc.).
 *
 * INSTRUCCIONES:
 *   1. Hacer backup de la colección boards antes de ejecutar.
 *   2. Verificar qué se va a modificar con el find de comprobación.
 *   3. Ejecutar el updateMany.
 *
 * En mongosh:
 *   load("scripts/migrate-secondary-boards.js")
 *   migrateSecondaryBoards()
 *
 * O ejecutar directamente las sentencias en mongosh.
 */

// ── 1. COMPROBACIÓN previa ────────────────────────────────────────────────────
//
// db.boards.find(
//   { boardRole: "secondary" },
//   { name: 1, assignedUserIds: 1, userId: 1,
//     predictorEnabled: 1, aiRewriteEnabled: 1, autoPersonalize: 1 }
// ).pretty()

// ── 2. MIGRACIÓN ──────────────────────────────────────────────────────────────
//
// db.boards.updateMany(
//   { boardRole: "secondary" },
//   {
//     $set: {
//       assignedUserIds:       [],
//       userId:                null,
//       predictorEnabled:      false,
//       aiRewriteEnabled:      false,
//       autoPersonalize:       false,
//       locationColumnEnabled: false
//     },
//     $unset: {
//       controlsConfig: ""
//     }
//   }
// )

async function migrateSecondaryBoards() {
  const mongoose = require('mongoose');
  require('dotenv').config();

  await mongoose.connect(process.env.MONGO_URI);
  const Board = require('../src/models/Board');

  // Comprobación previa
  const preview = await Board.find(
    { boardRole: 'secondary' },
    { name: 1, assignedUserIds: 1, userId: 1,
      predictorEnabled: 1, aiRewriteEnabled: 1, autoPersonalize: 1 }
  ).lean();
  console.log(`\n=== Tableros secundarios a migrar: ${preview.length} ===`);
  for (const b of preview) {
    console.log(`  ${b._id}  "${b.name}"  users=${JSON.stringify(b.assignedUserIds)}  predictor=${b.predictorEnabled}  aiRewrite=${b.aiRewriteEnabled}  autoPers=${b.autoPersonalize}`);
  }

  if (preview.length === 0) {
    console.log('Nada que migrar.');
    await mongoose.disconnect();
    return;
  }

  const result = await Board.updateMany(
    { boardRole: 'secondary' },
    {
      $set: {
        assignedUserIds:       [],
        userId:                null,
        predictorEnabled:      false,
        aiRewriteEnabled:      false,
        autoPersonalize:       false,
        locationColumnEnabled: false,
      },
      $unset: { controlsConfig: '' },
    }
  );

  console.log(`\nModificados: ${result.modifiedCount} / ${result.matchedCount}`);
  await mongoose.disconnect();
}

migrateSecondaryBoards().catch(console.error);
