const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Archivo de prueba.
// Todavía no uses el archivo original del campeonato.
const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "shiai_20260720_191413 - copia.shi",
);

function escaparNombreTabla(nombre) {
  return `"${String(nombre).replaceAll('"', '""')}"`;
}

function revisarArchivoShiai() {
  console.log("");
  console.log("==========================================");
  console.log("       REVISIÓN DEL ARCHIVO JUDOSHIAI");
  console.log("==========================================");
  console.log("");
  console.log(`Archivo: ${rutaArchivo}`);
  console.log("");

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(
      "No se encontró el archivo .shi dentro de la carpeta pruebas.",
    );
  }

  // El archivo se abre estrictamente en modo de solo lectura.
  const db = new Database(rutaArchivo, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const tablas = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC
      `)
      .all();

    console.log("✅ Base de datos abierta correctamente.");
    console.log(`✅ Tablas encontradas: ${tablas.length}`);
    console.log("");

    for (const tabla of tablas) {
      const nombre = String(tabla.name);
      const nombreSeguro = escaparNombreTabla(nombre);

      const cantidad = db
        .prepare(`
          SELECT COUNT(*) AS total
          FROM ${nombreSeguro}
        `)
        .get();

      console.log(`📋 ${nombre}: ${cantidad.total} registros`);
    }

    console.log("");
    console.log("==========================================");
    console.log("       ESTRUCTURA DE TABLAS IMPORTANTES");
    console.log("==========================================");

    const tablasImportantes = [
      "info",
      "categories",
      "matches",
      "competitors",
      "catdef",
    ];

    const nombresDisponibles = new Set(
      tablas.map((tabla) => String(tabla.name)),
    );

    for (const nombreTabla of tablasImportantes) {
      if (!nombresDisponibles.has(nombreTabla)) {
        console.log("");
        console.log(`⚠️ No existe la tabla ${nombreTabla}`);
        continue;
      }

      console.log("");
      console.log(`🔹 Tabla: ${nombreTabla}`);

      const columnas = db
        .prepare(
          `PRAGMA table_info(${escaparNombreTabla(nombreTabla)})`,
        )
        .all();

      for (const columna of columnas) {
        console.log(
          `   - ${columna.name} (${columna.type || "sin tipo"})`,
        );
      }
    }

    // ===========================================================
    // INFORMACIÓN GENERAL DEL TORNEO
    // ===========================================================

    if (nombresDisponibles.has("info")) {
      console.log("");
      console.log("==========================================");
      console.log("       INFORMACIÓN GENERAL DEL TORNEO");
      console.log("==========================================");
      console.log("");

      const informacion = db
        .prepare(`
          SELECT item, value
          FROM info
          LIMIT 20
        `)
        .all();

      if (informacion.length === 0) {
        console.log("La tabla info está vacía.");
      } else {
        console.table(informacion);
      }
    }

    // ===========================================================
    // CATEGORÍAS
    // ===========================================================

    if (nombresDisponibles.has("categories")) {
      console.log("");
      console.log("==========================================");
      console.log("              CATEGORÍAS");
      console.log("==========================================");
      console.log("");

      const categorias = db
        .prepare(`
          SELECT
            "index",
            category,
            tatami,
            "group",
            system,
            "table",
            wishsys,
            deleted
          FROM categories
          ORDER BY "index"
        `)
        .all();

      if (categorias.length === 0) {
        console.log("La tabla categories está vacía.");
      } else {
        console.table(categorias);
      }
    }

    // ===========================================================
    // COMBATES
    // ===========================================================

    if (nombresDisponibles.has("matches")) {
      console.log("");
      console.log("==========================================");
      console.log("               MATCHES");
      console.log("==========================================");
      console.log("");

      const matches = db
        .prepare(`
          SELECT
            category,
            number,
            blue,
            white,
            forcedtatami,
            forcednumber,
            blue_score,
            white_score,
            time,
            date,
            deleted,
            legend
          FROM matches
          ORDER BY category, number
          LIMIT 100
        `)
        .all();

      if (matches.length === 0) {
        console.log("La tabla matches está vacía.");
      } else {
        console.table(matches);
      }
    }

    // ===========================================================
    // PRIMER COMBATE DE CADA CATEGORÍA
    // ===========================================================

    if (
      nombresDisponibles.has("matches") &&
      nombresDisponibles.has("categories")
    ) {
      console.log("");
      console.log("==========================================");
      console.log("      PRIMER COMBATE DE CADA CATEGORÍA");
      console.log("==========================================");
      console.log("");

      const primerosCombates = db
        .prepare(`
          SELECT
            c."index" AS categoria_index,
            c.category AS categoria_nombre,
            c.tatami AS categoria_tatami,
            m.number AS combate_numero,
            m.blue,
            m.white,
            m.forcedtatami,
            m.forcednumber,
            m.blue_score,
            m.white_score,
            m.deleted
          FROM categories AS c
          LEFT JOIN matches AS m
            ON m.category = c."index"
           AND m.number = (
             SELECT MIN(m2.number)
             FROM matches AS m2
             WHERE m2.category = c."index"
               AND m2.deleted = 0
           )
          WHERE c.deleted = 0
          ORDER BY c."index"
        `)
        .all();

      if (primerosCombates.length === 0) {
        console.log("No se encontraron primeros combates.");
      } else {
        console.table(primerosCombates);
      }
    }

    console.log("");
    console.log("✅ Prueba terminada correctamente.");
    console.log("✅ El archivo se abrió solamente en modo lectura.");
    console.log("✅ No se modificó ningún dato.");
    console.log("");
  } finally {
    db.close();
  }
}

try {
  revisarArchivoShiai();
} catch (error) {
  console.error("");
  console.error("❌ No se pudo revisar el archivo:");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  process.exitCode = 1;
}