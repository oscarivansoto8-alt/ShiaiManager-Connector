const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "shiai_20260720_191413 - copia.shi",
);

const rutaRespaldo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "shiai_20260720_191413 - respaldo-antes-nombre.shi",
);

function actualizarNombreCompetencia() {
  console.log("");
  console.log("==========================================");
  console.log("     ACTUALIZAR NOMBRE DE COMPETENCIA");
  console.log("==========================================");
  console.log("");

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error("No se encontró el archivo .shi de prueba.");
  }

  if (!fs.existsSync(rutaRespaldo)) {
    fs.copyFileSync(rutaArchivo, rutaRespaldo);
    console.log("✅ Respaldo creado:");
    console.log(rutaRespaldo);
    console.log("");
  } else {
    console.log("ℹ️ El respaldo ya existía y no fue reemplazado.");
    console.log("");
  }

  const db = new Database(rutaArchivo, {
    fileMustExist: true,
  });

  try {
    const anterior = db
      .prepare(`
        SELECT value
        FROM info
        WHERE item = 'Competition'
        LIMIT 1
      `)
      .get();

    console.log(
      `Nombre anterior: ${anterior?.value || "(vacío)"}`,
    );

    const nuevoNombre = "Plataforma Judo";

    const resultado = db
      .prepare(`
        UPDATE info
        SET value = ?
        WHERE item = 'Competition'
      `)
      .run(nuevoNombre);

    if (resultado.changes !== 1) {
      throw new Error(
        `Se esperaba modificar 1 fila, pero se modificaron ${resultado.changes}.`,
      );
    }

    const actualizado = db
      .prepare(`
        SELECT value
        FROM info
        WHERE item = 'Competition'
        LIMIT 1
      `)
      .get();

    console.log(`Nombre nuevo: ${actualizado?.value || "(vacío)"}`);
    console.log("");
    console.log("✅ Nombre actualizado correctamente.");
    console.log("✅ El archivo original de prueba fue modificado.");
    console.log("✅ Existe un respaldo antes del cambio.");
    console.log("");
  } finally {
    db.close();
  }
}

try {
  actualizarNombreCompetencia();
} catch (error) {
  console.error("");
  console.error("❌ No se pudo actualizar el nombre:");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  process.exitCode = 1;
}