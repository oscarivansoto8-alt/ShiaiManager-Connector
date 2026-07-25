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
  "planificacion-despues-respaldo.shi",
);

const nombreCategoria = "sub 18 -50";
const nuevoTatami = 2;

function moverCategoria() {
  console.log("");
  console.log("==========================================");
  console.log("      MOVER CATEGORÍA DE TATAMI");
  console.log("==========================================");
  console.log("");

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error("No se encontró planificacion-despues.shi");
  }

  if (!fs.existsSync(rutaRespaldo)) {
    fs.copyFileSync(rutaArchivo, rutaRespaldo);
    console.log("? Respaldo creado.");
  }

  const db = new Database(rutaArchivo);

  try {
    const categoria = db.prepare(`
      SELECT "index", category, tatami
      FROM categories
      WHERE lower(trim(category)) = lower(trim(?))
      LIMIT 1
    `).get(nombreCategoria);

    if (!categoria) {
      throw new Error("Categoría no encontrada.");
    }

    console.log("Antes:");
    console.table([categoria]);

    const tx = db.transaction(() => {

      db.prepare(`
        UPDATE categories
        SET tatami=?
        WHERE "index"=?
      `).run(nuevoTatami, categoria.index);

      db.prepare(`
        UPDATE matches
        SET
          forcedtatami=0,
          forcednumber=0,
          comment=0
        WHERE (category & 65535)=?
      `).run(categoria.index);

    });

    tx();

    const despues = db.prepare(`
      SELECT "index", category, tatami
      FROM categories
      WHERE "index"=?
    `).get(categoria.index);

    console.log("");
    console.log("Después:");
    console.table([despues]);

    console.log("");
    console.log("? Categoría movida correctamente.");
  }
  finally {
    db.close();
  }
}

moverCategoria();
