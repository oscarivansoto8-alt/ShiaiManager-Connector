const path = require("path");
const Database = require("better-sqlite3");

// ============================================================
// ARCHIVO DE PRUEBA
// ============================================================

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function nombreCompetidor(competidor) {
  if (!competidor) {
    return "DESCONOCIDO";
  }

  const apellido = limpiar(competidor.last);
  const nombre = limpiar(competidor.first);
  const club = limpiar(competidor.club);

  const nombreCompleto =
    [nombre, apellido]
      .filter(Boolean)
      .join(" ");

  if (club) {
    return `${nombreCompleto} (${club})`;
  }

  return nombreCompleto || "SIN NOMBRE";
}

// ============================================================
// EJECUCIÓN
// ============================================================

function ejecutar() {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "          LEER COMBATES GENERADOS EN JUDOSHIAI"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(`Archivo: ${rutaArchivo}`);
  console.log("");

  // SOLO LECTURA
  const db = new Database(
    rutaArchivo,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    // --------------------------------------------------------
    // INFORMACIÓN DEL TORNEO
    // --------------------------------------------------------

    const infoFilas = db
      .prepare(`
        SELECT
          item,
          value
        FROM info
        WHERE item IN (
          'Competition',
          'Date',
          'NumTatamis'
        )
      `)
      .all();

    const info = {};

    for (const fila of infoFilas) {
      info[fila.item] = fila.value;
    }

    console.log(
      `Torneo: ${info.Competition || "Sin nombre"}`
    );

    console.log(
      `Fecha: ${info.Date || "-"}`
    );

    console.log(
      `Tatamis: ${info.NumTatamis || "-"}`
    );

    console.log("");

    // --------------------------------------------------------
    // CATEGORÍAS ACTIVAS
    // --------------------------------------------------------

    const categorias = db
      .prepare(`
        SELECT
          "index" AS id,
          TRIM(category) AS categoria,
          tatami,
          wishsys,
          system
        FROM categories
        WHERE
          (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
        ORDER BY
          tatami,
          category COLLATE NOCASE
      `)
      .all();

    const categoriasPorId =
      new Map();

    for (const categoria of categorias) {
      categoriasPorId.set(
        Number(categoria.id),
        categoria
      );
    }

    // --------------------------------------------------------
    // COMPETIDORES
    // --------------------------------------------------------

    const competidores = db
      .prepare(`
        SELECT
          "index" AS id,
          first,
          last,
          club,
          category
        FROM competitors
        WHERE
          (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
      `)
      .all();

    const competidoresPorId =
      new Map();

    for (const competidor of competidores) {
      competidoresPorId.set(
        Number(competidor.id),
        competidor
      );
    }

    // --------------------------------------------------------
    // COMBATES GENERADOS
    // --------------------------------------------------------

    const combates = db
      .prepare(`
        SELECT
          category,
          number,
          blue,
          white,
          forcedtatami,
          forcednumber
        FROM matches
        WHERE
          (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
        ORDER BY
          category,
          number
      `)
      .all();

    if (combates.length === 0) {
      console.log(
        "⚠️ No hay combates generados todavía."
      );

      console.log("");
      console.log(
        "Esto normalmente significa que todavía no se ha realizado ningún sorteo."
      );

      console.log("");
      return;
    }

    // --------------------------------------------------------
    // AGRUPAR POR CATEGORÍA
    // --------------------------------------------------------

    const grupos =
      new Map();

    for (const combate of combates) {
      const categoriaId =
        Number(
          combate.category
        );

      if (
        !grupos.has(
          categoriaId
        )
      ) {
        grupos.set(
          categoriaId,
          []
        );
      }

      grupos
        .get(categoriaId)
        .push(combate);
    }

    // --------------------------------------------------------
    // MOSTRAR RESULTADOS
    // --------------------------------------------------------

    let totalGeneral = 0;

    for (
      const [
        categoriaId,
        combatesCategoria,
      ] of grupos
    ) {
      const categoria =
        categoriasPorId.get(
          categoriaId
        );

      if (!categoria) {
        console.log(
          `⚠️ Categoría ID ${categoriaId} no encontrada.`
        );

        continue;
      }

      totalGeneral +=
        combatesCategoria.length;

      console.log(
        "============================================================"
      );

      console.log(
        `🥋 ${categoria.categoria}`
      );

      console.log(
        `Tatami asignado: ${
          Number(
            categoria.tatami
          ) > 0
            ? `T${categoria.tatami}`
            : "T0"
        }`
      );

      console.log(
        `Combates generados: ${combatesCategoria.length}`
      );

      console.log(
        "============================================================"
      );

      console.log("");

      const filasTabla = [];

      for (
        const combate
        of combatesCategoria
      ) {
        const azul =
          competidoresPorId.get(
            Number(
              combate.blue
            )
          );

        const blanco =
          competidoresPorId.get(
            Number(
              combate.white
            )
          );

        filasTabla.push({
          Combate:
            `#${combate.number}`,

          Blanco:
            nombreCompetidor(
              blanco
            ),

          Azul:
            nombreCompetidor(
              azul
            ),

          "Tatami categoría":
            Number(
              categoria.tatami
            ) > 0
              ? `T${categoria.tatami}`
              : "T0",

          "Tatami forzado":
            Number(
              combate.forcedtatami
            ) > 0
              ? `T${combate.forcedtatami}`
              : "-",

          "Orden forzado":
            Number(
              combate.forcednumber
            ) > 0
              ? combate.forcednumber
              : "-",
        });
      }

      console.table(
        filasTabla
      );

      console.log("");
    }

    // --------------------------------------------------------
    // RESUMEN POR TATAMI
    // --------------------------------------------------------

    const resumenTatamis =
      new Map();

    for (const combate of combates) {
      const categoria =
        categoriasPorId.get(
          Number(
            combate.category
          )
        );

      if (!categoria) {
        continue;
      }

      const tatami =
        Number(
          categoria.tatami
        ) || 0;

      if (
        !resumenTatamis.has(
          tatami
        )
      ) {
        resumenTatamis.set(
          tatami,
          {
            categorias:
              new Set(),
            combates: 0,
          }
        );
      }

      const resumen =
        resumenTatamis.get(
          tatami
        );

      resumen.categorias.add(
        categoria.categoria
      );

      resumen.combates += 1;
    }

    console.log(
      "============================================================"
    );

    console.log(
      "                 RESUMEN POR TATAMI"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    const tatamisOrdenados =
      [...resumenTatamis.keys()]
        .sort(
          (a, b) =>
            a - b
        );

    for (
      const tatami
      of tatamisOrdenados
    ) {
      const resumen =
        resumenTatamis.get(
          tatami
        );

      console.log(
        `🥋 ${
          tatami > 0
            ? `Tatami ${tatami}`
            : "Tatami 0"
        }: ${resumen.categorias.size} categoría(s) · ${resumen.combates} combate(s)`
      );

      for (
        const categoria
        of resumen.categorias
      ) {
        console.log(
          `   - ${categoria}`
        );
      }

      console.log("");
    }

    // --------------------------------------------------------
    // RESULTADO FINAL
    // --------------------------------------------------------

    console.log(
      "============================================================"
    );

    console.log(
      "                     RESULTADO"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.log(
      `✅ Total de combates generados: ${totalGeneral}`
    );

    console.log(
      `✅ Categorías con sorteo: ${grupos.size}`
    );

    console.log("");

    console.log(
      "🔒 MODO SOLO LECTURA"
    );

    console.log(
      "No se modificó el archivo .shi."
    );

    console.log(
      "No se modificó JudoShiai."
    );

    console.log(
      "No se modificó Supabase."
    );

    console.log("");
  } finally {
    db.close();
  }
}

try {
  ejecutar();
} catch (error) {
  console.error("");
  console.error(
    "❌ ERROR:"
  );

  console.error(
    error instanceof Error
      ? error.message
      : error
  );

  console.error("");

  process.exitCode = 1;
}