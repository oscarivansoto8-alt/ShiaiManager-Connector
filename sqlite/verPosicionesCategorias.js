const path = require("path");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const db = new Database(rutaArchivo, {
  readonly: true,
  fileMustExist: true,
});

try {
  const categorias = db
    .prepare(`
      SELECT
        "index" AS id,
        TRIM(category) AS categoria,
        numcomp,
        pos1,
        pos2,
        pos3,
        pos4,
        pos5,
        pos6,
        pos7,
        pos8,
        wishsys,
        tatami
      FROM categories
      WHERE "index" BETWEEN 10031 AND 10040
      ORDER BY "index"
    `)
    .all();

  console.log("");
  console.log("==========================================");
  console.log("      POSICIONES DE LAS CATEGORÍAS");
  console.log("==========================================");
  console.log("");

  console.table(categorias);

  console.log("");
  console.log("✅ Archivo leído solamente en modo lectura.");
  console.log("✅ No se modificó ningún dato.");
  console.log("");
} finally {
  db.close();
}