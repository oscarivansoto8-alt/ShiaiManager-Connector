const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ============================================================
// CONFIGURACIÓN SEGURA
// ============================================================

const rutaShi = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const rutaPropuesta = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "propuestas",
  "orden-tanda-2-descanso-3.json"
);

const carpetaBackups = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "backups"
);

// Archivo REAL que jamás debe tocar este script.
const rutaTorneoRealProhibida = path.resolve(
  "C:\\Users\\oscar\\OneDrive\\Escritorio\\torneo judo.shi"
);

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function numero(valor) {
  return Number(valor);
}

function generarSelloFecha() {
  const ahora = new Date();

  const pad = (n) =>
    String(n).padStart(2, "0");

  return (
    ahora.getFullYear() +
    pad(ahora.getMonth() + 1) +
    pad(ahora.getDate()) +
    "-" +
    pad(ahora.getHours()) +
    pad(ahora.getMinutes()) +
    pad(ahora.getSeconds())
  );
}

function claveCombate(
  categoriaId,
  numeroCombate
) {
  return (
    `${Number(categoriaId)}:` +
    `${Number(numeroCombate)}`
  );
}

// ============================================================
// VALIDACIÓN DEL COMANDO
// ============================================================

function validarConfirmacion() {
  const confirmado =
    process.argv.includes(
      "--confirmar-prueba"
    );

  if (!confirmado) {
    throw new Error(
      [
        "Este script modifica la COPIA de prueba.",
        "",
        "Debes ejecutarlo explícitamente con:",
        "",
        "node .\\sqlite\\aplicarOrdenPrueba.js --confirmar-prueba",
      ].join("\n")
    );
  }
}

// ============================================================
// SEGURIDAD DE RUTAS
// ============================================================

function validarRutas() {
  const normalizada =
    path.normalize(
      rutaShi
    ).toLowerCase();

  const real =
    path.normalize(
      rutaTorneoRealProhibida
    ).toLowerCase();

  if (normalizada === real) {
    throw new Error(
      "BLOQUEADO: la ruta corresponde al torneo REAL."
    );
  }

  if (
    !normalizada.includes(
      path.normalize(
        "\\ShiaiManager-Connector\\pruebas\\"
      ).toLowerCase()
    )
  ) {
    throw new Error(
      "BLOQUEADO: el archivo .shi no está dentro de la carpeta pruebas."
    );
  }

  if (
    path.basename(
      rutaShi
    ).toLowerCase() !==
    "planificador-prueba.shi"
  ) {
    throw new Error(
      "BLOQUEADO: este script solo puede modificar planificador-prueba.shi."
    );
  }

  if (
    !fs.existsSync(
      rutaShi
    )
  ) {
    throw new Error(
      `No existe el archivo de prueba:\n${rutaShi}`
    );
  }

  if (
    !fs.existsSync(
      rutaPropuesta
    )
  ) {
    throw new Error(
      `No existe la propuesta:\n${rutaPropuesta}`
    );
  }
}

// ============================================================
// LEER PROPUESTA
// ============================================================

function cargarPropuesta() {
  let propuesta;

  try {
    propuesta =
      JSON.parse(
        fs.readFileSync(
          rutaPropuesta,
          "utf8"
        )
      );
  } catch (error) {
    throw new Error(
      `No se pudo leer la propuesta JSON: ${error.message}`
    );
  }

  if (
    propuesta.modo !==
    "solo_simulacion"
  ) {
    throw new Error(
      "La propuesta no corresponde al formato esperado."
    );
  }

  if (
    !propuesta.tanda ||
    !Number.isInteger(
      Number(
        propuesta.tanda.id
      )
    )
  ) {
    throw new Error(
      "La propuesta no tiene una tanda válida."
    );
  }

  if (
    !Array.isArray(
      propuesta.tatamis
    ) ||
    propuesta.tatamis.length === 0
  ) {
    throw new Error(
      "La propuesta no contiene tatamis."
    );
  }

  return propuesta;
}

// ============================================================
// EXTRAER COMBATES DE LA PROPUESTA
// ============================================================

function extraerCombates(
  propuesta
) {
  const resultado = [];

  const claves =
    new Set();

  for (
    const bloqueTatami
    of propuesta.tatamis
  ) {
    const tatami =
      Number(
        bloqueTatami.tatami
      );

    if (
      !Number.isInteger(tatami) ||
      tatami <= 0
    ) {
      throw new Error(
        `Tatami inválido: ${bloqueTatami.tatami}`
      );
    }

    if (
      !Array.isArray(
        bloqueTatami.combates
      )
    ) {
      throw new Error(
        `T${tatami} no contiene una lista de combates válida.`
      );
    }

    const posiciones =
      new Set();

    for (
      const combate
      of bloqueTatami.combates
    ) {
      const orden =
        Number(
          combate.nuevo_orden
        );

      const categoriaId =
        Number(
          combate.judoshiai_category_index
        );

      const matchNumber =
        Number(
          combate.judoshiai_match_number
        );

      if (
        !Number.isInteger(orden) ||
        orden <= 0
      ) {
        throw new Error(
          `Orden inválido en T${tatami}.`
        );
      }

      if (
        posiciones.has(
          orden
        )
      ) {
        throw new Error(
          `T${tatami} tiene el orden ${orden} repetido.`
        );
      }

      posiciones.add(
        orden
      );

      if (
        !Number.isInteger(
          categoriaId
        ) ||
        categoriaId <= 0
      ) {
        throw new Error(
          `Categoría JudoShiai inválida en T${tatami}.`
        );
      }

      if (
        !Number.isInteger(
          matchNumber
        ) ||
        matchNumber <= 0
      ) {
        throw new Error(
          `Número de combate inválido en T${tatami}.`
        );
      }

      const clave =
        claveCombate(
          categoriaId,
          matchNumber
        );

      if (
        claves.has(
          clave
        )
      ) {
        throw new Error(
          `Combate duplicado en propuesta: ${clave}`
        );
      }

      claves.add(
        clave
      );

      resultado.push({
        tatami,

        nuevoOrden:
          orden,

        categoriaId,

        matchNumber,

        categoria:
          limpiar(
            combate.categoria
          ),

        supabaseId:
          Number(
            combate.supabase_id
          ),

        blancoId:
          Number(
            combate.blanco_judoshiai_id
          ),

        blancoNombre:
          limpiar(
            combate.blanco_nombre
          ),

        azulId:
          Number(
            combate.azul_judoshiai_id
          ),

        azulNombre:
          limpiar(
            combate.azul_nombre
          ),
      });
    }

    // Debe existir 1,2,3...N sin saltos.
    for (
      let i = 1;
      i <= bloqueTatami.combates.length;
      i++
    ) {
      if (
        !posiciones.has(i)
      ) {
        throw new Error(
          `T${tatami} no contiene una secuencia continua de orden 1..${bloqueTatami.combates.length}.`
        );
      }
    }
  }

  return resultado;
}

// ============================================================
// VALIDAR ESTRUCTURA DE JUDOSHIAI
// ============================================================

function validarEstructuraDb(
  db
) {
  const columnas =
    db
      .prepare(
        "PRAGMA table_info(matches)"
      )
      .all()
      .map(
        (fila) =>
          fila.name
      );

  const requeridas = [
    "category",
    "number",
    "blue",
    "white",
    "blue_points",
    "white_points",
    "deleted",
    "forcedtatami",
    "forcednumber",
  ];

  for (
    const columna
    of requeridas
  ) {
    if (
      !columnas.includes(
        columna
      )
    ) {
      throw new Error(
        `La tabla matches no contiene la columna requerida "${columna}".`
      );
    }
  }
}

// ============================================================
// LEER COMBATE REAL DESDE .SHI
// ============================================================

function obtenerCombateShi(
  db,
  categoriaId,
  matchNumber
) {
  return db
    .prepare(`
      SELECT
        category,
        number,
        blue,
        white,
        blue_points,
        white_points,
        deleted,
        forcedtatami,
        forcednumber
      FROM matches
      WHERE
        category = ?
        AND number = ?
        AND (
          COALESCE(
            deleted,
            0
          ) & 1
        ) = 0
    `)
    .get(
      categoriaId,
      matchNumber
    );
}

// ============================================================
// PREVALIDACIÓN COMPLETA
// ============================================================

function prevalidar(
  combates
) {
  const db =
    new Database(
      rutaShi,
      {
        readonly: true,
        fileMustExist: true,
      }
    );

  try {
    validarEstructuraDb(
      db
    );

    const resumen = [];

    for (
      const propuesta
      of combates
    ) {
      const real =
        obtenerCombateShi(
          db,
          propuesta.categoriaId,
          propuesta.matchNumber
        );

      if (!real) {
        throw new Error(
          [
            "No existe el combate en JudoShiai:",
            `${propuesta.categoria}`,
            `Categoría ID ${propuesta.categoriaId}`,
            `Combate #${propuesta.matchNumber}`,
          ].join(" ")
        );
      }

      // ------------------------------------------------------
      // IMPORTANTE:
      //
      // En nuestra prueba comprobamos:
      //
      // matches.blue  = Blanco visual
      // matches.white = Azul visual
      //
      // Por eso la comparación es intencional.
      // ------------------------------------------------------

      if (
        Number(
          real.blue
        ) !==
        propuesta.blancoId
      ) {
        throw new Error(
          [
            `Participante blanco no coincide en`,
            `${propuesta.categoria} #${propuesta.matchNumber}.`,
            `Propuesta ID ${propuesta.blancoId},`,
            `JudoShiai blue=${real.blue}.`,
          ].join(" ")
        );
      }

      if (
        Number(
          real.white
        ) !==
        propuesta.azulId
      ) {
        throw new Error(
          [
            `Participante azul no coincide en`,
            `${propuesta.categoria} #${propuesta.matchNumber}.`,
            `Propuesta ID ${propuesta.azulId},`,
            `JudoShiai white=${real.white}.`,
          ].join(" ")
        );
      }

      // ------------------------------------------------------
      // NO TOCAR COMBATES YA FINALIZADOS
      // ------------------------------------------------------

      if (
        Number(
          real.blue_points
        ) !== 0 ||
        Number(
          real.white_points
        ) !== 0
      ) {
        throw new Error(
          [
            "BLOQUEADO:",
            `${propuesta.categoria} #${propuesta.matchNumber}`,
            "ya contiene puntuación.",
            "No se reorganizarán combates finalizados.",
          ].join(" ")
        );
      }

      resumen.push({
        Tatami:
          `T${propuesta.tatami}`,

        Orden:
          propuesta.nuevoOrden,

        Categoría:
          propuesta.categoria,

        Combate:
          `#${propuesta.matchNumber}`,

        Blanco:
          propuesta.blancoNombre,

        Azul:
          propuesta.azulNombre,

        "Antes T":
          Number(
            real.forcedtatami
          ) || "-",

        "Antes orden":
          Number(
            real.forcednumber
          ) || "-",
      });
    }

    return resumen;
  } finally {
    db.close();
  }
}

// ============================================================
// CREAR BACKUP
// ============================================================

function crearBackup() {
  fs.mkdirSync(
    carpetaBackups,
    {
      recursive: true,
    }
  );

  const rutaBackup =
    path.resolve(
      carpetaBackups,
      `planificador-prueba-antes-orden-${generarSelloFecha()}.shi`
    );

  fs.copyFileSync(
    rutaShi,
    rutaBackup
  );

  return rutaBackup;
}

// ============================================================
// APLICAR ORDEN
// ============================================================

function aplicarOrden(
  combates
) {
  const db =
    new Database(
      rutaShi,
      {
        readonly: false,
        fileMustExist: true,
      }
    );

  try {
    validarEstructuraDb(
      db
    );

    const actualizar =
      db.prepare(`
        UPDATE matches
        SET
          forcedtatami = ?,
          forcednumber = ?
        WHERE
          category = ?
          AND number = ?
          AND (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
      `);

    const transaccion =
      db.transaction(
        () => {
          for (
            const combate
            of combates
          ) {
            // Verificamos otra vez justo antes de escribir.
            const actual =
              obtenerCombateShi(
                db,
                combate.categoriaId,
                combate.matchNumber
              );

            if (!actual) {
              throw new Error(
                `Desapareció ${combate.categoria} #${combate.matchNumber} antes de escribir.`
              );
            }

            if (
              Number(
                actual.blue_points
              ) !== 0 ||
              Number(
                actual.white_points
              ) !== 0
            ) {
              throw new Error(
                `${combate.categoria} #${combate.matchNumber} ya no está pendiente.`
              );
            }

            const resultado =
              actualizar.run(
                combate.tatami,
                combate.nuevoOrden,
                combate.categoriaId,
                combate.matchNumber
              );

            if (
              resultado.changes !== 1
            ) {
              throw new Error(
                `Se esperaba modificar 1 fila para ${combate.categoria} #${combate.matchNumber}, pero se modificaron ${resultado.changes}.`
              );
            }
          }

          // --------------------------------------------------
          // VERIFICACIÓN DENTRO DE LA TRANSACCIÓN
          // --------------------------------------------------

          for (
            const combate
            of combates
          ) {
            const verificacion =
              obtenerCombateShi(
                db,
                combate.categoriaId,
                combate.matchNumber
              );

            if (
              Number(
                verificacion.forcedtatami
              ) !==
                combate.tatami ||
              Number(
                verificacion.forcednumber
              ) !==
                combate.nuevoOrden
            ) {
              throw new Error(
                `Falló la verificación de ${combate.categoria} #${combate.matchNumber}.`
              );
            }
          }
        }
      );

    transaccion();
  } finally {
    db.close();
  }
}

// ============================================================
// VERIFICACIÓN FINAL READONLY
// ============================================================

function verificarResultado(
  combates
) {
  const db =
    new Database(
      rutaShi,
      {
        readonly: true,
        fileMustExist: true,
      }
    );

  try {
    const filas = [];

    let errores = 0;

    const ordenados =
      [...combates]
        .sort(
          (a, b) => {
            if (
              a.tatami !==
              b.tatami
            ) {
              return (
                a.tatami -
                b.tatami
              );
            }

            return (
              a.nuevoOrden -
              b.nuevoOrden
            );
          }
        );

    for (
      const combate
      of ordenados
    ) {
      const real =
        obtenerCombateShi(
          db,
          combate.categoriaId,
          combate.matchNumber
        );

      const correcto =
        !!real &&
        Number(
          real.forcedtatami
        ) ===
          combate.tatami &&
        Number(
          real.forcednumber
        ) ===
          combate.nuevoOrden;

      if (!correcto) {
        errores++;
      }

      filas.push({
        Tatami:
          `T${combate.tatami}`,

        Orden:
          combate.nuevoOrden,

        Categoría:
          combate.categoria,

        Combate:
          `#${combate.matchNumber}`,

        Blanco:
          combate.blancoNombre,

        Azul:
          combate.azulNombre,

        Estado:
          correcto
            ? "✅"
            : "❌",
      });
    }

    return {
      filas,
      errores,
    };
  } finally {
    db.close();
  }
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
    "       APLICAR ORDEN OPTIMIZADO — COPIA DE PRUEBA"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  validarConfirmacion();
  validarRutas();

  console.log(
    `Archivo .shi:`
  );

  console.log(
    rutaShi
  );

  console.log("");

  console.log(
    `Propuesta:`
  );

  console.log(
    rutaPropuesta
  );

  console.log("");

  const propuesta =
    cargarPropuesta();

  console.log(
    `Tanda: ${propuesta.tanda.nombre}`
  );

  console.log(
    `Tanda ID: ${propuesta.tanda.id}`
  );

  console.log(
    `Descanso mínimo: ${propuesta.descanso_minimo}`
  );

  console.log("");

  const combates =
    extraerCombates(
      propuesta
    );

  console.log(
    `Combates de la propuesta: ${combates.length}`
  );

  console.log("");

  // ==========================================================
  // PREVALIDACIÓN
  // ==========================================================

  console.log(
    "🔎 Validando propuesta contra JudoShiai..."
  );

  console.log("");

  const previo =
    prevalidar(
      combates
    );

  console.log(
    "✅ Todos los combates coinciden con la copia .shi."
  );

  console.log(
    "✅ No se detectaron combates finalizados en la propuesta."
  );

  console.log("");

  console.log(
    "RESUMEN ANTES DE ESCRIBIR:"
  );

  console.log("");

  console.table(
    previo
  );

  console.log("");

  // ==========================================================
  // BACKUP
  // ==========================================================

  const rutaBackup =
    crearBackup();

  console.log(
    "✅ Backup creado:"
  );

  console.log(
    rutaBackup
  );

  console.log("");

  // ==========================================================
  // APLICAR
  // ==========================================================

  console.log(
    "✍️ Aplicando forcedtatami + forcednumber..."
  );

  console.log("");

  aplicarOrden(
    combates
  );

  // ==========================================================
  // VERIFICACIÓN
  // ==========================================================

  const resultado =
    verificarResultado(
      combates
    );

  console.log(
    "============================================================"
  );

  console.log(
    "                 ORDEN FINAL EN LA COPIA"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.table(
    resultado.filas
  );

  console.log("");

  if (
    resultado.errores > 0
  ) {
    throw new Error(
      `La verificación final detectó ${resultado.errores} error(es). El backup está disponible en ${rutaBackup}`
    );
  }

  console.log(
    `✅ Combates verificados: ${resultado.filas.length}`
  );

  console.log(
    "✅ Todos tienen el tatami y orden propuestos."
  );

  console.log("");

  console.log(
    "🔒 SEGURIDAD:"
  );

  console.log(
    "✅ Solo se modificó planificador-prueba.shi."
  );

  console.log(
    "✅ No se modificó torneo judo.shi."
  );

  console.log(
    "✅ No se modificó Supabase."
  );

  console.log(
    "✅ No se cambiaron sorteos."
  );

  console.log(
    "✅ No se cambiaron participantes."
  );

  console.log(
    "✅ No se cambiaron resultados."
  );

  console.log(
    "✅ Solo se escribieron forcedtatami y forcednumber."
  );

  console.log("");

  console.log(
    "Ahora abre planificador-prueba.shi en JudoShiai y revisa visualmente los Tatamis 1, 2 y 3."
  );

  console.log("");

  console.log(
    "Backup:"
  );

  console.log(
    rutaBackup
  );

  console.log("");
}

// ============================================================
// INICIO
// ============================================================

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