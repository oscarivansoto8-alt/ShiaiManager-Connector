const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
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

function judoshiaiEstaAbierto() {
  try {
    const salida = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "(Get-Process judoshiai -ErrorAction SilentlyContinue | Measure-Object).Count",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
      }
    ).trim();

    return Number(salida) > 0;
  } catch {
    /*
     * Si no podemos comprobarlo,
     * fallamos de forma segura.
     */
    return true;
  }
}

function validarPropuestaParaEscritura(
  propuesta,
  shiPath
) {
  if (!propuesta) {
    throw new Error(
      "No existe una propuesta."
    );
  }

  if (
    !Array.isArray(propuesta.cambios) ||
    propuesta.cambios.length < 2
  ) {
    throw new Error(
      "La propuesta no contiene cambios validos."
    );
  }

  if (
    !Number.isInteger(propuesta.tatami) ||
    propuesta.tatami <= 0
  ) {
    throw new Error(
      "Tatami invalido."
    );
  }

  if (
    !Number.isInteger(
      propuesta.posicionActual
    ) ||
    propuesta.posicionActual < 3
  ) {
    throw new Error(
      "Seguridad: no se pueden mover las posiciones 1 o 2."
    );
  }

  if (
    !Number.isInteger(
      propuesta.posicionDestino
    ) ||
    propuesta.posicionDestino <=
      propuesta.posicionActual
  ) {
    throw new Error(
      "Destino invalido."
    );
  }

  if (
    propuesta.cambios.length !==
    propuesta.posicionDestino -
      propuesta.posicionActual +
      1
  ) {
    throw new Error(
      "La cantidad de combates no coincide con el movimiento."
    );
  }

  if (
    !Number.isFinite(propuesta.creadaEn) ||
    Date.now() - propuesta.creadaEn >
      10 * 60 * 1000
  ) {
    throw new Error(
      "La propuesta expiro. Vuelve a simularla con P."
    );
  }

  if (!shiPath) {
    throw new Error(
      "Falta JUDOSHIAI_SHI_PATH."
    );
  }

  if (!fs.existsSync(shiPath)) {
    throw new Error(
      "No existe el archivo .shi configurado."
    );
  }

  const rutaReal = path.resolve(shiPath);

  const rutaSimulada = path.resolve(
    propuesta.shiPath || ""
  );

  if (rutaReal !== rutaSimulada) {
    throw new Error(
      "El archivo .shi cambio desde la simulacion."
    );
  }

  /*
   * Protección temporal:
   * SOLO esta copia de laboratorio.
   */
  if (
    path.basename(rutaReal).toLowerCase() !==
    "prueba-simulador-orden.shi"
  ) {
    throw new Error(
      "SEGURIDAD: por ahora solo se permite escribir en prueba-simulador-orden.shi."
    );
  }

  const rowids = propuesta.cambios.map(
    (cambio) =>
      Number(cambio.rowid_match)
  );

  if (
    rowids.some(
      (valor) =>
        !Number.isInteger(valor) ||
        valor <= 0
    ) ||
    new Set(rowids).size !==
      rowids.length
  ) {
    throw new Error(
      "Los rowid de la propuesta no son validos."
    );
  }

  const actuales = propuesta.cambios.map(
    (cambio) =>
      Number(
        cambio.forcednumber_actual
      )
  );

  const finales = propuesta.cambios.map(
    (cambio) =>
      Number(
        cambio.forcednumber_simulado
      )
  );

  if (
    actuales.some(
      (numero) =>
        !Number.isInteger(numero) ||
        numero <= 0
    ) ||
    finales.some(
      (numero) =>
        !Number.isInteger(numero) ||
        numero <= 0
    )
  ) {
    throw new Error(
      "La propuesta contiene forcednumber invalidos."
    );
  }

  const actualesOrdenados =
    [...actuales].sort(
      (a, b) => a - b
    );

  const finalesOrdenados =
    [...finales].sort(
      (a, b) => a - b
    );

  if (
    JSON.stringify(actualesOrdenados) !==
    JSON.stringify(finalesOrdenados)
  ) {
    throw new Error(
      "La propuesta intenta introducir forcednumber que no pertenecen al tramo original."
    );
  }
}

function leerFilaOrden(
  db,
  rowid
) {
  return db.prepare(`
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
    WHERE m.rowid = ?
  `).get(rowid);
}

function validarEstadoAntes(
  db,
  propuesta
) {
  for (
    const cambio of propuesta.cambios
  ) {
    const fila = leerFilaOrden(
      db,
      cambio.rowid_match
    );

    if (!fila) {
      throw new Error(
        "Ya no existe rowid " +
          cambio.rowid_match +
          "."
      );
    }

    if (fila.deleted !== 0) {
      throw new Error(
        "El combate rowid " +
          cambio.rowid_match +
          " ya no esta activo."
      );
    }

    if (
      fila.forcedtatami !==
      propuesta.tatami
    ) {
      throw new Error(
        "El tatami del combate cambio desde la simulacion."
      );
    }

    if (
      fila.forcednumber !==
      cambio.forcednumber_actual
    ) {
      throw new Error(
        "El orden cambio desde la simulacion. Vuelve a ejecutar P."
      );
    }

    if (
      fila.numero_combate !==
      cambio.combate
    ) {
      throw new Error(
        "El numero de combate cambio desde la simulacion."
      );
    }

    if (
      String(fila.categoria).trim() !==
      String(cambio.categoria).trim()
    ) {
      throw new Error(
        "La categoria cambio desde la simulacion."
      );
    }
  }
}

function validarEstadoDespues(
  db,
  propuesta
) {
  for (
    const cambio of propuesta.cambios
  ) {
    const fila = leerFilaOrden(
      db,
      cambio.rowid_match
    );

    if (
      !fila ||
      fila.deleted !== 0 ||
      fila.forcedtatami !==
        propuesta.tatami ||
      fila.numero_combate !==
        cambio.combate ||
      String(fila.categoria).trim() !==
        String(cambio.categoria).trim() ||
      fila.forcednumber !==
        cambio.forcednumber_simulado
    ) {
      throw new Error(
        "La verificacion posterior fallo para rowid " +
          cambio.rowid_match +
          "."
      );
    }
  }
}

function crearBackupOrden(
  shiPath
) {
  const carpeta = path.join(
    path.dirname(shiPath),
    "backups-orden"
  );

  fs.mkdirSync(
    carpeta,
    {
      recursive: true,
    }
  );

  const marca = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14);

  const nombreBase =
    path.basename(
      shiPath,
      path.extname(shiPath)
    );

  const backupPath = path.join(
    carpeta,
    nombreBase +
      "-antes-aplicar-" +
      marca +
      ".shi"
  );

  fs.copyFileSync(
    shiPath,
    backupPath
  );

  return backupPath;
}

async function aplicarPropuestaOrden({
  propuesta,
  shiPath,
  permitirEscritura,
}) {
  if (!permitirEscritura) {
    throw new Error(
      "PERMITIR_APLICAR_ORDEN_PRUEBA no esta activado."
    );
  }

  validarPropuestaParaEscritura(
    propuesta,
    shiPath
  );

  /*
   * Por ahora nunca escribimos con JudoShiai
   * abierto. Esto evita modificar SQLite
   * mientras JudoShiai lo esta utilizando.
   */
  if (judoshiaiEstaAbierto()) {
    throw new Error(
      "SEGURIDAD: cierra completamente JudoShiai antes de aplicar la propuesta."
    );
  }

  /*
   * Primera validación, solo lectura.
   */
  const dbLectura = new Database(
    shiPath,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    validarEstadoAntes(
      dbLectura,
      propuesta
    );
  } finally {
    dbLectura.close();
  }

  /*
   * Backup antes de cualquier escritura.
   */
  const backupPath =
    crearBackupOrden(shiPath);

  const db = new Database(
    shiPath,
    {
      fileMustExist: true,
    }
  );

  try {
    const actualizar =
      db.prepare(`
        UPDATE matches
        SET forcednumber = ?
        WHERE rowid = ?
      `);

    const transaccion =
      db.transaction(() => {
        /*
         * Volvemos a comprobar dentro
         * de la transacción.
         */
        validarEstadoAntes(
          db,
          propuesta
        );

        const maximo = Number(
          db.prepare(`
            SELECT
              COALESCE(
                MAX(forcednumber),
                0
              ) AS maximo
            FROM matches
          `).get().maximo
        );

        const temporalBase =
          maximo + 10000;

        /*
         * Primero sacamos todos los combates
         * del rango original para evitar
         * colisiones de forcednumber.
         */
        propuesta.cambios.forEach(
          (cambio, indice) => {
            const resultado =
              actualizar.run(
                temporalBase +
                  indice +
                  1,
                cambio.rowid_match
              );

            if (
              resultado.changes !== 1
            ) {
              throw new Error(
                "No se pudo mover temporalmente rowid " +
                  cambio.rowid_match +
                  "."
              );
            }
          }
        );

        /*
         * Luego ponemos el orden definitivo.
         */
        for (
          const cambio of
          propuesta.cambios
        ) {
          const resultado =
            actualizar.run(
              cambio
                .forcednumber_simulado,
              cambio.rowid_match
            );

          if (
            resultado.changes !== 1
          ) {
            throw new Error(
              "No se pudo aplicar el orden final a rowid " +
                cambio.rowid_match +
                "."
            );
          }
        }

        /*
         * Si esto falla, SQLite hace rollback
         * automático de toda la transacción.
         */
        validarEstadoDespues(
          db,
          propuesta
        );
      });

    transaccion();
  } finally {
    db.close();
  }

  return {
    backupPath,
    cambios:
      propuesta.cambios,
  };
}

module.exports = {
  simularPropuestaOrden,
  aplicarPropuestaOrden,
};
