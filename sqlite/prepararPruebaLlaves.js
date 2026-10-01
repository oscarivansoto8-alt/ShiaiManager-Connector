const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ============================================================
// ARCHIVO DE PRUEBA
// ============================================================

const rutaShi = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba-llaves.shi"
);

const carpetaBackups = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "backups"
);

// ============================================================
// ESCENARIOS QUE VAMOS A CREAR
// ============================================================
//
// Todos quedan en Tatami 1 para posteriormente comprobar
// cómo V3 mezcla distintos sistemas dentro del mismo tatami.
//
// wishsys:
//  1  = ESP Liga
// 11  = IJF Rep. doble
// 18  = Mejor de 3
//
// ============================================================

const escenarios = [
  {
    categoria: "sub18 -40",
    competidores: 6,
    wishsys: 11,
    sistemaNombre: "IJF Rep. doble",
    prefijo: "L40",
    birthyear: 2010,
    pesoGramos: 39000,
  },

  {
    categoria: "sub18 -44",
    competidores: 8,
    wishsys: 11,
    sistemaNombre: "IJF Rep. doble",
    prefijo: "L44",
    birthyear: 2010,
    pesoGramos: 43000,
  },

  {
    categoria: "sub18 -48",
    competidores: 12,
    wishsys: 11,
    sistemaNombre: "IJF Rep. doble",
    prefijo: "L48",
    birthyear: 2010,
    pesoGramos: 47000,
  },

  {
    categoria: "sub18 -52",
    competidores: 16,
    wishsys: 11,
    sistemaNombre: "IJF Rep. doble",
    prefijo: "L52",
    birthyear: 2010,
    pesoGramos: 51000,
  },

  {
    categoria: "sub21 -48",
    competidores: 2,
    wishsys: 18,
    sistemaNombre: "Mejor de 3",
    prefijo: "M48",
    birthyear: 2007,
    pesoGramos: 47000,
  },

  {
    categoria: "sub21 -52",
    competidores: 4,
    wishsys: 1,
    sistemaNombre: "ESP Liga",
    prefijo: "P52",
    birthyear: 2007,
    pesoGramos: 51000,
  },
];

// ============================================================
// UTILIDADES
// ============================================================

function existeColumna(
  columnas,
  nombre
) {
  return columnas.some(
    (columna) =>
      columna.name === nombre
  );
}

function identificador(nombre) {
  return `"${String(nombre).replace(
    /"/g,
    '""'
  )}"`;
}

function selloFecha() {
  const fecha = new Date();

  const pad = (n) =>
    String(n).padStart(2, "0");

  return (
    fecha.getFullYear() +
    pad(fecha.getMonth() + 1) +
    pad(fecha.getDate()) +
    "-" +
    pad(fecha.getHours()) +
    pad(fecha.getMinutes()) +
    pad(fecha.getSeconds())
  );
}

function crearBackup() {
  fs.mkdirSync(
    carpetaBackups,
    {
      recursive: true,
    }
  );

  const destino = path.resolve(
    carpetaBackups,
    `planificador-prueba-llaves-antes-preparar-${selloFecha()}.shi`
  );

  fs.copyFileSync(
    rutaShi,
    destino
  );

  return destino;
}

// ============================================================
// SEGURIDAD
// ============================================================

function validarRuta() {
  if (
    !fs.existsSync(rutaShi)
  ) {
    throw new Error(
      `No existe:\n${rutaShi}`
    );
  }

  const nombre =
    path.basename(
      rutaShi
    ).toLowerCase();

  if (
    nombre !==
    "planificador-prueba-llaves.shi"
  ) {
    throw new Error(
      "SEGURIDAD: este script solo puede usar planificador-prueba-llaves.shi"
    );
  }

  const normalizada =
    rutaShi
      .toLowerCase()
      .replace(/\\/g, "/");

  if (
    !normalizada.includes(
      "/pruebas/"
    )
  ) {
    throw new Error(
      "SEGURIDAD: el archivo debe estar dentro de la carpeta pruebas."
    );
  }

  if (
    normalizada.includes(
      "/escritorio/torneo judo.shi"
    )
  ) {
    throw new Error(
      "SEGURIDAD: se detectó el torneo real."
    );
  }
}

// ============================================================
// PREPARAR VALOR DEL COMPETIDOR CLONADO
// ============================================================

function prepararCompetidor({
  plantilla,
  columnas,
  nuevoIndex,
  escenario,
  numero,
}) {
  const fila = {
    ...plantilla,
  };

  // ----------------------------------------------------------
  // ID INTERNO PRINCIPAL
  // ----------------------------------------------------------

  fila.index =
    nuevoIndex;

  // ----------------------------------------------------------
  // NOMBRE VISIBLE
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "first"
    )
  ) {
    fila.first =
      `${escenario.prefijo}_${String(
        numero
      ).padStart(2, "0")}`;
  }

  if (
    existeColumna(
      columnas,
      "last"
    )
  ) {
    fila.last =
      "PRUEBA";
  }

  // ----------------------------------------------------------
  // CLUB
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "club"
    )
  ) {
    fila.club =
      "CLUB TEST V3";
  }

  // ----------------------------------------------------------
  // CATEGORÍA
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "category"
    )
  ) {
    fila.category =
      escenario.categoria;
  }

  if (
    existeColumna(
      columnas,
      "regcategory"
    )
  ) {
    fila.regcategory =
      escenario.categoria;
  }

  // ----------------------------------------------------------
  // ACTIVO
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "deleted"
    )
  ) {
    fila.deleted = 0;
  }

  if (
    existeColumna(
      columnas,
      "visible"
    )
  ) {
    fila.visible = 1;
  }

  // ----------------------------------------------------------
  // EVITAR CABEZAS DE SERIE HEREDADAS
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "seeding"
    )
  ) {
    fila.seeding = 0;
  }

  if (
    existeColumna(
      columnas,
      "clubseeding"
    )
  ) {
    fila.clubseeding = 0;
  }

  // ----------------------------------------------------------
  // AÑO DE NACIMIENTO
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "birthyear"
    )
  ) {
    fila.birthyear =
      escenario.birthyear;
  }

  // ----------------------------------------------------------
  // PESO
  //
  // JudoShiai normalmente maneja el peso en gramos.
  // Esto es solamente para hacer coherente la prueba.
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "weight"
    )
  ) {
    fila.weight =
      escenario.pesoGramos;
  }

  // ----------------------------------------------------------
  // IDENTIFICADOR EXTERNO
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "id"
    )
  ) {
    fila.id =
      `TEST-V3-${nuevoIndex}`;
  }

  // ----------------------------------------------------------
  // COMENTARIO
  // ----------------------------------------------------------

  if (
    existeColumna(
      columnas,
      "comment"
    )
  ) {
    fila.comment =
      "Generado para prueba V3";
  }

  return fila;
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
    "        PREPARAR PRUEBA DE SISTEMAS Y LLAVES V3"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  validarRuta();

  console.log(
    "Archivo:"
  );

  console.log(
    rutaShi
  );

  console.log("");

  const backup =
    crearBackup();

  console.log(
    "✅ Backup creado:"
  );

  console.log(
    backup
  );

  console.log("");

  const db =
    new Database(
      rutaShi,
      {
        readonly: false,
        fileMustExist: true,
      }
    );

  try {
    // ========================================================
    // COLUMNAS
    // ========================================================

    const columnasCompetidores =
      db
        .prepare(
          "PRAGMA table_info(competitors)"
        )
        .all();

    const columnasCategorias =
      db
        .prepare(
          "PRAGMA table_info(categories)"
        )
        .all();

    const nombresCompetidores =
      new Set(
        columnasCompetidores.map(
          (columna) =>
            columna.name
        )
      );

    const necesariasCompetidores = [
      "index",
      "first",
      "last",
      "category",
      "deleted",
    ];

    for (
      const necesaria
      of necesariasCompetidores
    ) {
      if (
        !nombresCompetidores.has(
          necesaria
        )
      ) {
        throw new Error(
          `Falta competitors.${necesaria}`
        );
      }
    }

    const nombresCategorias =
      new Set(
        columnasCategorias.map(
          (columna) =>
            columna.name
        )
      );

    const necesariasCategorias = [
      "index",
      "category",
      "tatami",
      "wishsys",
      "system",
      "numcomp",
      "deleted",
    ];

    for (
      const necesaria
      of necesariasCategorias
    ) {
      if (
        !nombresCategorias.has(
          necesaria
        )
      ) {
        throw new Error(
          `Falta categories.${necesaria}`
        );
      }
    }

    // ========================================================
    // PLANTILLA DE COMPETIDOR
    // ========================================================

    const plantilla =
      db
        .prepare(`
          SELECT *
          FROM competitors
          WHERE
            (
              COALESCE(
                deleted,
                0
              ) & 1
            ) = 0
          ORDER BY
            "index"
          LIMIT 1
        `)
        .get();

    if (!plantilla) {
      throw new Error(
        "No existe un competidor que pueda utilizarse como plantilla."
      );
    }

    // ========================================================
    // ENCONTRAR CATEGORÍAS EXACTAS
    //
    // IMPORTANTE:
    // se respeta mayúscula/minúscula.
    // Sub18 y sub18 NO se consideran lo mismo.
    // ========================================================

    const obtenerCategoria =
      db.prepare(`
        SELECT *
        FROM categories
        WHERE
          TRIM(category) = ?
          COLLATE BINARY
          AND (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
        LIMIT 1
      `);

    const categoriasEncontradas =
      [];

    for (
      const escenario
      of escenarios
    ) {
      const categoria =
        obtenerCategoria.get(
          escenario.categoria
        );

      if (!categoria) {
        throw new Error(
          `No existe exactamente la categoría "${escenario.categoria}".`
        );
      }

      categoriasEncontradas.push({
        escenario,
        categoria,
      });
    }

    // ========================================================
    // ÍNDICE SIGUIENTE
    // ========================================================

    const maximo =
      db
        .prepare(`
          SELECT
            MAX("index") AS maximo
          FROM competitors
        `)
        .get();

    let siguienteIndex =
      Number(
        maximo?.maximo
      ) || 0;

    // ========================================================
    // SQL INSERT DINÁMICO
    // ========================================================

    const columnasInsert =
      columnasCompetidores.map(
        (columna) =>
          columna.name
      );

    const sqlInsert = `
      INSERT INTO competitors (
        ${columnasInsert
          .map(
            identificador
          )
          .join(", ")}
      )
      VALUES (
        ${columnasInsert
          .map(() => "?")
          .join(", ")}
      )
    `;

    const insertarCompetidor =
      db.prepare(
        sqlInsert
      );

    // ========================================================
    // BORRADO DE COMPETIDORES DE PRUEBAS ANTERIORES
    // ========================================================

    let sqlEliminarCompetidores;

    if (
      nombresCompetidores.has(
        "regcategory"
      )
    ) {
      sqlEliminarCompetidores =
        db.prepare(`
          DELETE FROM competitors
          WHERE
            category = ?
            COLLATE BINARY
            OR
            regcategory = ?
            COLLATE BINARY
        `);
    } else {
      sqlEliminarCompetidores =
        db.prepare(`
          DELETE FROM competitors
          WHERE
            category = ?
            COLLATE BINARY
        `);
    }

    const eliminarMatches =
      db.prepare(`
        DELETE FROM matches
        WHERE category = ?
      `);

    // ========================================================
    // TRANSACCIÓN
    // ========================================================

    const transaccion =
      db.transaction(() => {
        for (
          const {
            escenario,
            categoria,
          }
          of categoriasEncontradas
        ) {
          const categoriaId =
            Number(
              categoria.index
            );

          // --------------------------------------------------
          // BORRAR SORTEOS ANTERIORES SOLO DE ESTAS CATEGORÍAS
          // --------------------------------------------------

          eliminarMatches.run(
            categoriaId
          );

          // --------------------------------------------------
          // BORRAR COMPETIDORES DE UNA EJECUCIÓN ANTERIOR
          // --------------------------------------------------

          if (
            nombresCompetidores.has(
              "regcategory"
            )
          ) {
            sqlEliminarCompetidores.run(
              escenario.categoria,
              escenario.categoria
            );
          } else {
            sqlEliminarCompetidores.run(
              escenario.categoria
            );
          }

          // --------------------------------------------------
          // REINICIAR LA CATEGORÍA
          //
          // No realizamos sorteo.
          // Eso seguirá siendo MANUAL.
          // --------------------------------------------------

          const cambios = {
            tatami: 1,
            wishsys:
              escenario.wishsys,
            system: 0,
            numcomp: 0,
            deleted: 0,
          };

          if (
            nombresCategorias.has(
              "table"
            )
          ) {
            cambios.table = 0;
          }

          for (
            let i = 1;
            i <= 8;
            i++
          ) {
            const columna =
              `pos${i}`;

            if (
              nombresCategorias.has(
                columna
              )
            ) {
              cambios[columna] = 0;
            }
          }

          const campos =
            Object.keys(
              cambios
            );

          const sqlUpdate = `
            UPDATE categories
            SET
              ${campos
                .map(
                  (campo) =>
                    `${identificador(
                      campo
                    )} = ?`
                )
                .join(", ")}
            WHERE
              "index" = ?
          `;

          db
            .prepare(
              sqlUpdate
            )
            .run(
              ...campos.map(
                (campo) =>
                  cambios[campo]
              ),
              categoriaId
            );

          // --------------------------------------------------
          // CREAR COMPETIDORES
          // --------------------------------------------------

          for (
            let numero = 1;
            numero <=
              escenario.competidores;
            numero++
          ) {
            siguienteIndex++;

            const fila =
              prepararCompetidor({
                plantilla,
                columnas:
                  columnasCompetidores,
                nuevoIndex:
                  siguienteIndex,
                escenario,
                numero,
              });

            const valores =
              columnasInsert.map(
                (columna) =>
                  fila[columna] ??
                  null
              );

            insertarCompetidor.run(
              ...valores
            );
          }
        }
      });

    transaccion();

    // ========================================================
    // VERIFICACIÓN FINAL
    // ========================================================

    const resumen = [];

    for (
      const escenario
      of escenarios
    ) {
      const categoria =
        db
          .prepare(`
            SELECT
              "index" AS id,
              category,
              tatami,
              wishsys,
              system,
              numcomp
            FROM categories
            WHERE
              TRIM(category) = ?
              COLLATE BINARY
            LIMIT 1
          `)
          .get(
            escenario.categoria
          );

      const cantidad =
        db
          .prepare(`
            SELECT COUNT(*) AS total
            FROM competitors
            WHERE
              category = ?
              COLLATE BINARY
              AND (
                COALESCE(
                  deleted,
                  0
                ) & 1
              ) = 0
          `)
          .get(
            escenario.categoria
          );

      const matches =
        db
          .prepare(`
            SELECT COUNT(*) AS total
            FROM matches
            WHERE
              category = ?
              AND (
                COALESCE(
                  deleted,
                  0
                ) & 1
              ) = 0
          `)
          .get(
            Number(
              categoria.id
            )
          );

      const totalCompetidores =
        Number(
          cantidad.total
        );

      if (
        totalCompetidores !==
        escenario.competidores
      ) {
        throw new Error(
          [
            `${escenario.categoria}:`,
            `se esperaban ${escenario.competidores}`,
            `competidores y quedaron ${totalCompetidores}.`,
          ].join(" ")
        );
      }

      if (
        Number(matches.total) !==
        0
      ) {
        throw new Error(
          `${escenario.categoria}: quedaron matches antes del sorteo.`
        );
      }

      resumen.push({
        Categoría:
          escenario.categoria,

        Competidores:
          totalCompetidores,

        Sistema:
          escenario.sistemaNombre,

        Wishsys:
          Number(
            categoria.wishsys
          ),

        Tatami:
          `T${categoria.tatami}`,

        Sorteo:
          "Pendiente",
      });
    }

    console.log(
      "============================================================"
    );

    console.log(
      "                    RESULTADO"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.table(
      resumen
    );

    console.log("");

    const totalNuevos =
      escenarios.reduce(
        (
          total,
          escenario
        ) =>
          total +
          escenario.competidores,
        0
      );

    console.log(
      `✅ Competidores de prueba creados: ${totalNuevos}`
    );

    console.log(
      `✅ Categorías preparadas: ${escenarios.length}`
    );

    console.log(
      "✅ Todas quedaron en Tatami 1."
    );

    console.log(
      "✅ No se realizó ningún sorteo."
    );

    console.log(
      "✅ No se modificó Supabase."
    );

    console.log("");

    console.log(
      "ESCENARIOS:"
    );

    console.log(
      "sub18 -40 → 6 → IJF Rep. doble"
    );

    console.log(
      "sub18 -44 → 8 → IJF Rep. doble"
    );

    console.log(
      "sub18 -48 → 12 → IJF Rep. doble"
    );

    console.log(
      "sub18 -52 → 16 → IJF Rep. doble"
    );

    console.log(
      "sub21 -48 → 2 → Mejor de 3"
    );

    console.log(
      "sub21 -52 → 4 → Todos contra todos"
    );

    console.log("");

    console.log(
      "🔒 Solo se modificó:"
    );

    console.log(
      rutaShi
    );

    console.log("");
  } finally {
    db.close();
  }
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

  console.error(
    "No continúes con los sorteos hasta revisar el error."
  );

  console.error("");

  process.exitCode = 1;
}