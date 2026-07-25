const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificacion-despues.shi",
);

const rutaRespaldo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "respaldo-antes-orden-combates.shi",
);

function ordenarCombates() {
  console.log("");
  console.log("==========================================");
  console.log("       PRUEBA DE ORDEN DE COMBATES");
  console.log("==========================================");
  console.log("");

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error("No se encontró planificacion-despues.shi.");
  }

  if (!fs.existsSync(rutaRespaldo)) {
    fs.copyFileSync(rutaArchivo, rutaRespaldo);
    console.log("✅ Respaldo creado.");
  } else {
    console.log("ℹ️ El respaldo ya existía.");
  }

  const db = new Database(rutaArchivo, {
    fileMustExist: true,
  });

  try {
    const antes = db.prepare(`
      SELECT
        category,
        number,
        blue,
        white,
        forcedtatami,
        forcednumber
      FROM matches
      WHERE
        (category = 10001 AND number = 1)
        OR
        (category = 10002 AND number = 1)
      ORDER BY category
    `).all();

    console.log("");
    console.log("Antes:");
    console.table(antes);

    const transaccion = db.transaction(() => {
      /*
       * Sub-18 -55, combate N.º 1:
       * será el primero del Tatami 2.
       */
      const primero = db.prepare(`
        UPDATE matches
        SET
          forcedtatami = 2,
          forcednumber = 1,
          comment = 0
        WHERE category = 10002
          AND number = 1
          AND deleted = 0
      `).run();

      /*
       * Sub-18 -50, combate N.º 1:
       * será el segundo del Tatami 2.
       */
      const segundo = db.prepare(`
        UPDATE matches
        SET
          forcedtatami = 2,
          forcednumber = 2,
          comment = 0
        WHERE category = 10001
          AND number = 1
          AND deleted = 0
      `).run();

      if (primero.changes !== 1) {
        throw new Error(
          `No se pudo modificar el combate 1 de Sub-18 -55. Filas modificadas: ${primero.changes}`,
        );
      }

      if (segundo.changes !== 1) {
        throw new Error(
          `No se pudo modificar el combate 1 de Sub-18 -50. Filas modificadas: ${segundo.changes}`,
        );
      }
    });

    transaccion();

    const despues = db.prepare(`
      SELECT
        category,
        number,
        blue,
        white,
        forcedtatami,
        forcednumber
      FROM matches
      WHERE
        (category = 10001 AND number = 1)
        OR
        (category = 10002 AND number = 1)
      ORDER BY forcednumber
    `).all();

    console.log("");
    console.log("Después:");
    console.table(despues);

    console.log("");
    console.log("✅ Orden guardado:");
    console.log("1.º Sub-18 -55, combate N.º 1");
    console.log("2.º Sub-18 -50, combate N.º 1");
    console.log("");
  } finally {
    db.close();
  }
}

try {
  ordenarCombates();
} catch (error) {
  console.error("");
  console.error("❌ Error:");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  process.exitCode = 1;
}
