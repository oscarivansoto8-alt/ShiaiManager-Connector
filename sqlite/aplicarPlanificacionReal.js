const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

/**
 * Aplica una planificación a un archivo de JudoShiai.
 *
 * @param {object} opciones
 * @param {string} opciones.rutaArchivo Ruta completa del archivo .shi.
 * @param {Array<{index:number, tatami:number, orden:number}>} opciones.planificacion
 * @param {boolean} [opciones.crearRespaldo=true]
 * @returns {{categoriasActualizadas:number, combatesOrdenados:number, respaldo:string|null}}
 */
function aplicarPlanificacion({
  rutaArchivo,
  planificacion,
  crearRespaldo = true,
}) {
  validarEntrada(rutaArchivo, planificacion);

  const rutaAbsoluta = path.resolve(rutaArchivo);

  if (!fs.existsSync(rutaAbsoluta)) {
    throw new Error(`No se encontró el archivo .shi: ${rutaAbsoluta}`);
  }

  let rutaRespaldo = null;

  if (crearRespaldo) {
    rutaRespaldo = crearRespaldoSeguro(rutaAbsoluta);
  }

  const db = new Database(rutaAbsoluta, {
    fileMustExist: true,
  });

  try {
    const indices = planificacion.map((item) => item.index);
    const marcadores = indices.map(() => "?").join(", ");

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
          AND deleted = 0
      `)
      .all(...indices);

    if (categoriasEncontradas.length !== indices.length) {
      const encontradas = new Set(
        categoriasEncontradas.map((categoria) => categoria.index),
      );

      const faltantes = indices.filter(
        (indice) => !encontradas.has(indice),
      );

      throw new Error(
        `No se encontraron estas categorías activas: ${faltantes.join(", ")}`,
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

    const limpiarOrdenPendiente = db.prepare(`
      UPDATE matches
      SET
        forcedtatami = 0,
        forcednumber = 0,
        comment = 0
      WHERE (category & 65535) = ?
        AND deleted = 0
        AND blue_score = 0
        AND white_score = 0
        AND blue_points = 0
        AND white_points = 0
    `);

    const obtenerCombatesPendientes = db.prepare(`
      SELECT
        category,
        number
      FROM matches
      WHERE (category & 65535) = ?
        AND deleted = 0
        AND blue_score = 0
        AND white_score = 0
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
        AND blue_score = 0
        AND white_score = 0
        AND blue_points = 0
        AND white_points = 0
    `);

    let categoriasActualizadas = 0;
    let combatesOrdenados = 0;

    const ejecutarCambios = db.transaction(() => {
      for (const item of planificacion) {
        limpiarOrdenPendiente.run(item.index);
      }

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

        categoriasActualizadas += resultado.changes;
      }

      const ordenada = [...planificacion].sort(
        (a, b) =>
          a.tatami - b.tatami ||
          a.orden - b.orden ||
          a.index - b.index,
      );

      const siguientePosicionPorTatami = new Map();

      for (const item of ordenada) {
        const combates = obtenerCombatesPendientes.all(item.index);

        let posicion =
          siguientePosicionPorTatami.get(item.tatami) ?? 1;

        for (const combate of combates) {
          const resultado = ordenarCombate.run(
            item.tatami,
            posicion,
            combate.category,
            combate.number,
          );

          combatesOrdenados += resultado.changes;
          posicion += 1;
        }

        siguientePosicionPorTatami.set(item.tatami, posicion);
      }
    });

    ejecutarCambios();

    return {
      categoriasActualizadas,
      combatesOrdenados,
      respaldo: rutaRespaldo,
    };
  } catch (error) {
    if (rutaRespaldo && fs.existsSync(rutaRespaldo)) {
      console.error(`Existe un respaldo de seguridad en: ${rutaRespaldo}`);
    }

    throw error;
  } finally {
    db.close();
  }
}

function validarEntrada(rutaArchivo, planificacion) {
  if (typeof rutaArchivo !== "string" || !rutaArchivo.trim()) {
    throw new Error("La ruta del archivo .shi es obligatoria.");
  }

  if (!Array.isArray(planificacion) || planificacion.length === 0) {
    throw new Error("La planificación está vacía.");
  }

  const categoriasUsadas = new Set();
  const posicionesPorTatami = new Set();

  for (const item of planificacion) {
    if (!item || typeof item !== "object") {
      throw new Error("Existe un elemento inválido en la planificación.");
    }

    if (!Number.isInteger(item.index) || item.index <= 0) {
      throw new Error(`Índice de categoría inválido: ${item.index}`);
    }

    if (!Number.isInteger(item.tatami) || item.tatami < 1) {
      throw new Error(
        `Tatami inválido en la categoría ${item.index}: ${item.tatami}`,
      );
    }

    if (!Number.isInteger(item.orden) || item.orden < 1) {
      throw new Error(
        `Orden inválido en la categoría ${item.index}: ${item.orden}`,
      );
    }

    if (categoriasUsadas.has(item.index)) {
      throw new Error(
        `La categoría ${item.index} aparece repetida.`,
      );
    }

    const clavePosicion = `${item.tatami}:${item.orden}`;

    if (posicionesPorTatami.has(clavePosicion)) {
      throw new Error(
        `El Tatami ${item.tatami} tiene repetido el orden ${item.orden}.`,
      );
    }

    categoriasUsadas.add(item.index);
    posicionesPorTatami.add(clavePosicion);
  }
}

function crearRespaldoSeguro(rutaArchivo) {
  const carpeta = path.dirname(rutaArchivo);
  const extension = path.extname(rutaArchivo);
  const nombreBase = path.basename(rutaArchivo, extension);

  const fecha = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  const rutaRespaldo = path.join(
    carpeta,
    `${nombreBase}-respaldo-${fecha}${extension}`,
  );

  fs.copyFileSync(rutaArchivo, rutaRespaldo);

  return rutaRespaldo;
}

module.exports = {
  aplicarPlanificacion,
};
