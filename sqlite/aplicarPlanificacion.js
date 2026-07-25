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
  "respaldo-antes-aplicar-planificacion.shi",
);

/*
  Esta es una planificación de prueba.

  Cada categoría indica:
  - index: identificador de la categoría en JudoShiai
  - tatami: tatami al que pertenece
  - orden: orden general de los combates de esa categoría
*/
const planificacion = [
  {
    index: 10007,
    tatami: 1,
    orden: 1,
  },
  {
    index: 10006,
    tatami: 1,
    orden: 2,
  },
  {
    index: 10002,
    tatami: 2,
    orden: 1,
  },
  {
    index: 10001,
    tatami: 2,
    orden: 2,
  },
  {
    index: 10004,
    tatami: 3,
    orden: 1,
  },
];

function validarPlanificacion(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("La planificación está vacía.");
  }

  const categoriasUsadas = new Set();

  for (const item of items) {
    if (!Number.isInteger(item.index) || item.index <= 0) {
      throw new Error(`Índice de categoría inválido: ${item.index}`);
    }

    if (!Number.isInteger(item.tatami) || item.tatami < 1) {
      throw new Error(
        `Tatami inválido para la categoría ${item.index}: ${item.tatami}`,
      );
    }

    if (!Number.isInteger(item.orden) || item.orden < 1) {
      throw new Error(
        `Orden inválido para la categoría ${item.index}: ${item.orden}`,
      );
    }

    if (categoriasUsadas.has(item.index)) {
      throw new Error(
        `La categoría ${item.index} aparece repetida en la planificación.`,
      );
    }

    categoriasUsadas.add(item.index);
  }
}

function aplicarPlanificacion() {
  console.log("");
  console.log("==========================================");
  console.log("       APLICAR PLANIFICACIÓN COMPLETA");
  console.log("==========================================");
  console.log("");

  validarPlanificacion(planificacion);

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error("No se encontró planificacion-despues.shi.");
  }

  if (!fs.existsSync(rutaRespaldo)) {
    fs.copyFileSync(rutaArchivo, rutaRespaldo);
    console.log("✅ Respaldo creado.");
  } else {
    console.log("ℹ️ El respaldo ya existe y no fue reemplazado.");
  }

  const db = new Database(rutaArchivo, {
    fileMustExist: true,
  });

  try {
    const categoriasSolicitadas = planificacion.map(
      (item) => item.index,
    );

    const marcadores = categoriasSolicitadas
      .map(() => "?")
      .join(", ");

    const categoriasEncontradas = db
      .prepare(`
        SELECT
          "index",
          category,
          tatami,
          "group",
          deleted
        FROM categories
        WHERE "index" IN (${marcadores})
      `)
      .all(...categoriasSolicitadas);

    if (
      categoriasEncontradas.length !==
      categoriasSolicitadas.length
    ) {
      const encontradas = new Set(
        categoriasEncontradas.map((categoria) => categoria.index),
      );

      const faltantes = categoriasSolicitadas.filter(
        (index) => !encontradas.has(index),
      );

      throw new Error(
        `No se encontraron estas categorías: ${faltantes.join(", ")}`,
      );
    }

    const actualizarCategoria = db.prepare(`
      UPDATE categories
      SET
        tatami = ?,
        "group" = ?
      WHERE "index" = ?
        AND deleted = 0
    `);

    const limpiarCombatesCategoria = db.prepare(`
      UPDATE matches
      SET
        forcedtatami = 0,
        forcednumber = 0,
        comment = 0
      WHERE (category & 65535) = ?
        AND deleted = 0
    `);

    const obtenerCombatesCategoria = db.prepare(`
      SELECT
        category,
        number
      FROM matches
      WHERE (category & 65535) = ?
        AND deleted = 0
        AND blue_points = 0
        AND white_points = 0
      ORDER BY number ASC
    `);

    const ordenarCombate = db.prepare(`
      UPDATE matches
      SET
        forcedtatami = ?,
        forcednumber = ?,
        comment = 0
      WHERE category = ?
        AND number = ?
        AND deleted = 0
    `);

    const transaccion = db.transaction(() => {
      /*
       * Primero limpiamos órdenes manuales anteriores.
       */
      for (const item of planificacion) {
        limpiarCombatesCategoria.run(item.index);
      }

      /*
       * Luego actualizamos el tatami y grupo de cada categoría.
       * Usamos el orden como grupo para mantener el orden general.
       */
      for (const item of planificacion) {
        const resultado = actualizarCategoria.run(
          item.tatami,
          item.orden,
          item.index,
        );

        if (resultado.changes !== 1) {
          throw new Error(
            `No se pudo actualizar la categoría ${item.index}.`,
          );
        }
      }

      /*
       * Finalmente ordenamos todos los combates.
       * El contador se reinicia para cada tatami.
       */
      const contadoresPorTatami = new Map();

      const planificacionOrdenada = [...planificacion].sort(
        (a, b) =>
          a.tatami - b.tatami ||
          a.orden - b.orden,
      );

      for (const item of planificacionOrdenada) {
        const combates = obtenerCombatesCategoria.all(item.index);

        let posicion =
          contadoresPorTatami.get(item.tatami) ?? 1;

        for (const combate of combates) {
          ordenarCombate.run(
            item.tatami,
            posicion,
            combate.category,
            combate.number,
          );

          posicion++;
        }

        contadoresPorTatami.set(item.tatami, posicion);
      }
    });

    transaccion();

    console.log("");
    console.log("Planificación aplicada:");
    console.table(
      planificacion
        .slice()
        .sort(
          (a, b) =>
            a.tatami - b.tatami ||
            a.orden - b.orden,
        ),
    );

    const comprobacion = db
      .prepare(`
        SELECT
          c."index",
          c.category,
          c.tatami,
          c."group",
          COUNT(m.number) AS combates_ordenados,
          MIN(
            CASE
              WHEN m.forcednumber > 0
              THEN m.forcednumber
            END
          ) AS primera_posicion,
          MAX(m.forcednumber) AS ultima_posicion
        FROM categories AS c
        LEFT JOIN matches AS m
          ON (m.category & 65535) = c."index"
         AND m.deleted = 0
        WHERE c."index" IN (${marcadores})
        GROUP BY
          c."index",
          c.category,
          c.tatami,
          c."group"
        ORDER BY
          c.tatami,
          c."group"
      `)
      .all(...categoriasSolicitadas);

    console.log("");
    console.log("Comprobación:");
    console.table(comprobacion);

    console.log("");
    console.log("✅ Planificación aplicada correctamente.");
    console.log("✅ Categorías distribuidas por tatami.");
    console.log("✅ Combates ordenados mediante forcednumber.");
    console.log("✅ Se conservaron competidores y resultados.");
    console.log("");
  } finally {
    db.close();
  }
}

try {
  aplicarPlanificacion();
} catch (error) {
  console.error("");
  console.error("❌ No se pudo aplicar la planificación:");
  console.error(error instanceof Error ? error.message : error);
  console.error("");
  process.exitCode = 1;
}
