const fs = require("fs");
const Database = require("better-sqlite3");

async function obtenerColaActiva({
  tatami,
  protocolVersion,
  httpUrl,
}) {
  if (protocolVersion !== 7) {
    throw new Error(
      "Esta prueba requiere JudoShiai Custom con protocolo 7."
    );
  }

  const respuesta = await fetch(httpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      op: "matches_all",
      pw: "",
      tatami,
    }),
  });

  if (!respuesta.ok) {
    throw new Error(
      "matches_all respondio HTTP " +
        respuesta.status
    );
  }

  const lista = await respuesta.json();

  if (!Array.isArray(lista)) {
    throw new Error(
      "matches_all no devolvio un array."
    );
  }

  return lista;
}

function buscarCombateShi(
  db,
  tatami,
  combate
) {
  const categoria = String(
    combate?.category || ""
  ).trim();

  const numeroCombate = Number(
    combate?.number || 0
  );

  if (
    !categoria ||
    !Number.isInteger(numeroCombate) ||
    numeroCombate <= 0
  ) {
    throw new Error(
      "Combate sin categoria/numero valido."
    );
  }

  const filas = db.prepare(`
    SELECT
      m.rowid AS rowid_match,
      m.forcedtatami,
      m.forcednumber,
      m.number AS numero_combate,
      TRIM(c.category) AS categoria,
      m.deleted
    FROM matches m
    JOIN categories c
      ON c."index" = m.category
    WHERE
      m.deleted = 0
      AND m.forcedtatami = ?
      AND TRIM(c.category) = ?
      AND m.number = ?
    ORDER BY m.rowid
  `).all(
    tatami,
    categoria,
    numeroCombate
  );

  if (filas.length !== 1) {
    throw new Error(
      "No se pudo identificar de forma unica " +
        categoria +
        " #" +
        numeroCombate +
        ". Coincidencias: " +
        filas.length
    );
  }

  return filas[0];
}

async function simularPropuestaOrden({
  tatami,
  posicionActual,
  posicionDestino,
  protocolVersion,
  httpUrl,
  shiPath,
}) {
  if (
    !Number.isInteger(tatami) ||
    tatami <= 0
  ) {
    throw new Error("Tatami invalido.");
  }

  if (
    !Number.isInteger(posicionActual) ||
    !Number.isInteger(posicionDestino)
  ) {
    throw new Error(
      "Las posiciones deben ser enteros."
    );
  }

  if (posicionActual < 3) {
    throw new Error(
      "Seguridad: no se pueden mover las posiciones 1 o 2."
    );
  }

  if (posicionDestino <= posicionActual) {
    throw new Error(
      "Por ahora solo se permiten movimientos hacia abajo."
    );
  }

  if (!shiPath) {
    throw new Error(
      "Falta JUDOSHIAI_SHI_PATH."
    );
  }

  if (!fs.existsSync(shiPath)) {
    throw new Error(
      "No existe el archivo configurado en JUDOSHIAI_SHI_PATH."
    );
  }

  if (
    !shiPath.toLowerCase().endsWith(".shi")
  ) {
    throw new Error(
      "JUDOSHIAI_SHI_PATH no apunta a un archivo .shi."
    );
  }

  const cola = await obtenerColaActiva({
    tatami,
    protocolVersion,
    httpUrl,
  });

  if (
    posicionActual > cola.length ||
    posicionDestino > cola.length
  ) {
    throw new Error(
      "El Tatami " +
        tatami +
        " tiene " +
        cola.length +
        " combates activos."
    );
  }

  const tramo = cola.slice(
    posicionActual - 1,
    posicionDestino
  );

  const db = new Database(
    shiPath,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    const filas = tramo.map(
      (combate) =>
        buscarCombateShi(
          db,
          tatami,
          combate
        )
    );

    const forced = filas.map(
      (fila) =>
        Number(fila.forcednumber)
    );

    if (
      forced.some(
        (numero) =>
          !Number.isInteger(numero) ||
          numero <= 0
      )
    ) {
      throw new Error(
        "Hay un forcednumber invalido."
      );
    }

    if (
      new Set(forced).size !== forced.length
    ) {
      throw new Error(
        "Hay forcednumber duplicados en el tramo."
      );
    }

    return filas.map(
      (fila, indice) => {
        const combate = tramo[indice];

        const forcedSimulado =
          indice === 0
            ? forced[forced.length - 1]
            : forced[indice - 1];

        const posicionSimulada =
          indice === 0
            ? posicionDestino
            : posicionActual +
              indice -
              1;

        const azul =
          (
            String(
              combate?.comp1?.last || ""
            ).trim() +
            " " +
            String(
              combate?.comp1?.first || ""
            ).trim()
          ).trim();

        const blanco =
          (
            String(
              combate?.comp2?.last || ""
            ).trim() +
            " " +
            String(
              combate?.comp2?.first || ""
            ).trim()
          ).trim();

        return {
          posicion_actual:
            posicionActual + indice,

          posicion_simulada:
            posicionSimulada,

          rowid_match:
            fila.rowid_match,

          categoria:
            fila.categoria,

          combate:
            fila.numero_combate,

          forcednumber_actual:
            fila.forcednumber,

          forcednumber_simulado:
            forcedSimulado,

          blanco,
          azul,
        };
      }
    );
  } finally {
    db.close();
  }
}

module.exports = {
  simularPropuestaOrden,
};
