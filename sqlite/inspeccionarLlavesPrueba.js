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

const carpetaPropuestas = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "propuestas"
);

// Solo analizaremos las categorías nuevas.
const categoriasObjetivo = [
  "sub18 -40",
  "sub18 -44",
  "sub18 -48",
  "sub18 -52",
  "sub21 -48",
  "sub21 -52",
];

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function selloFecha() {
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

// ============================================================
// SEGURIDAD
// ============================================================

function validarRuta() {
  if (!fs.existsSync(rutaShi)) {
    throw new Error(
      `No existe:\n${rutaShi}`
    );
  }

  const nombre =
    path.basename(rutaShi).toLowerCase();

  if (
    nombre !==
    "planificador-prueba-llaves.shi"
  ) {
    throw new Error(
      "SEGURIDAD: este script solo puede leer planificador-prueba-llaves.shi"
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
      "SEGURIDAD: el archivo no está dentro de pruebas."
    );
  }
}

// ============================================================
// NOMBRE DEL SISTEMA INTERNO
// ============================================================

function nombreSistemaInterno(
  sistema
) {
  const sistemas = {
    0: "Sin sistema",
    1: "Pool",
    2: "Double Pool",
    3: "French 8",
    4: "French 16",
    5: "French 32",
    6: "French 64",
    7: "French 128",
    8: "French 256",
    9: "Quad Pool",
    10: "Double Pool 2",
    11: "Best of 3",
    12: "Double Pool 3",
    13: "Custom",
  };

  return (
    sistemas[Number(sistema)] ||
    `Sistema ${sistema}`
  );
}

// ============================================================
// WISHSYS
// ============================================================

function nombreWishsys(
  wishsys
) {
  const sistemas = {
    0: "Automático",
    1: "ESP Liga",
    2: "Doble Pool",
    3: "Repechaje",
    4: "SWE Rep. doble",
    5: "SWE Rep. directa",
    6: "EST D-Klass",
    7: "Sin repechaje",
    8: "SWE Rep. simple",
    9: "4 Pools",
    10: "ESP Doble pérdida",
    11: "IJF Rep. doble",
    12: "ESP Repesca simple",
    13: "Eliminación doble",
    14: "Repechaje 1 bronce",
    15: "Doble Pool 2",
    16: "Double Lost",
    17: "GBR Knockout",
    18: "Mejor de 3",
    19: "DEN Doble eliminación",
    20: "EST D-Klass 1 bronce",
    21: "Doble Pool 3",
    22: "Personalizado",
  };

  return (
    sistemas[Number(wishsys)] ||
    `Wishsys ${wishsys}`
  );
}

// ============================================================
// INTERPRETAR UN VALOR BLUE / WHITE
// ============================================================

function interpretarParticipante(
  valor,
  competidoresPorId
) {
  const id = Number(valor);

  if (id === 0) {
    return {
      tipo: "VACIO",
      id,
      texto: "Pendiente",
    };
  }

  if (id === 1) {
    return {
      tipo: "GHOST",
      id,
      texto: "Bye / Ghost",
    };
  }

  const persona =
    competidoresPorId.get(id);

  if (persona) {
    return {
      tipo: "COMPETIDOR",
      id,
      texto: [
        limpiar(persona.first),
        limpiar(persona.last),
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  return {
    tipo: "REFERENCIA_O_VALOR_INTERNO",
    id,
    texto: `Valor interno ${id}`,
  };
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
    "       INSPECCIÓN DE LLAVES REALES DE JUDOSHIAI"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  validarRuta();

  console.log("Archivo:");
  console.log(rutaShi);
  console.log("");

  const db =
    new Database(
      rutaShi,
      {
        readonly: true,
        fileMustExist: true,
      }
    );

  try {
    // ========================================================
    // COMPETIDORES
    // ========================================================

    const personas =
      db.prepare(`
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
      `).all();

    const competidoresPorId =
      new Map();

    for (
      const persona
      of personas
    ) {
      competidoresPorId.set(
        Number(persona.id),
        persona
      );
    }

    // ========================================================
    // CATEGORÍAS
    // ========================================================

    const obtenerCategoria =
      db.prepare(`
        SELECT
          "index" AS id,
          TRIM(category) AS categoria,
          tatami,
          wishsys,
          system,
          numcomp,
          "table" AS tabla,
          deleted
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

    const obtenerMatches =
      db.prepare(`
        SELECT
          category,
          number,
          blue,
          white,
          blue_score,
          white_score,
          blue_points,
          white_points,
          comment,
          forcedtatami,
          forcednumber,
          deleted
        FROM matches
        WHERE
          category = ?
          AND (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
        ORDER BY
          number ASC
      `);

    const resultado = [];

    // ========================================================
    // ANALIZAR
    // ========================================================

    for (
      const nombreCategoria
      of categoriasObjetivo
    ) {
      const categoria =
        obtenerCategoria.get(
          nombreCategoria
        );

      if (!categoria) {
        throw new Error(
          `No se encontró la categoría "${nombreCategoria}".`
        );
      }

      const matches =
        obtenerMatches.all(
          Number(categoria.id)
        );

      console.log(
        "============================================================"
      );

      console.log(
        `🥋 ${categoria.categoria}`
      );

      console.log(
        "============================================================"
      );

      console.log("");

      console.log(
        `ID categoría: ${categoria.id}`
      );

      console.log(
        `Tatami: T${categoria.tatami}`
      );

      console.log(
        `Competidores internos: ${categoria.numcomp}`
      );

      console.log(
        `Wishsys: ${categoria.wishsys} (${nombreWishsys(
          categoria.wishsys
        )})`
      );

      console.log(
        `Sistema real: ${categoria.system} (${nombreSistemaInterno(
          categoria.system
        )})`
      );

      console.log(
        `Tabla: ${categoria.tabla}`
      );

      console.log(
        `Matches generados: ${matches.length}`
      );

      console.log("");

      const filas = [];

      const matchesJSON = [];

      for (
        const match
        of matches
      ) {
        const blue =
          interpretarParticipante(
            match.blue,
            competidoresPorId
          );

        const white =
          interpretarParticipante(
            match.white,
            competidoresPorId
          );

        const pendiente =
          Number(
            match.blue_points
          ) === 0 &&
          Number(
            match.white_points
          ) === 0;

        filas.push({
          "#":
            Number(
              match.number
            ),

          "Blue raw":
            Number(
              match.blue
            ),

          Blue:
            blue.texto,

          "White raw":
            Number(
              match.white
            ),

          White:
            white.texto,

          Estado:
            pendiente
              ? "Pendiente"
              : "Con resultado",

          ForcedTatami:
            Number(
              match.forcedtatami
            ) || 0,

          ForcedNumber:
            Number(
              match.forcednumber
            ) || 0,

          Comment:
            Number(
              match.comment
            ) || 0,
        });

        matchesJSON.push({
          number:
            Number(
              match.number
            ),

          blue_raw:
            Number(
              match.blue
            ),

          blue_tipo:
            blue.tipo,

          blue_nombre:
            blue.texto,

          white_raw:
            Number(
              match.white
            ),

          white_tipo:
            white.tipo,

          white_nombre:
            white.texto,

          blue_score:
            Number(
              match.blue_score
            ) || 0,

          white_score:
            Number(
              match.white_score
            ) || 0,

          blue_points:
            Number(
              match.blue_points
            ) || 0,

          white_points:
            Number(
              match.white_points
            ) || 0,

          comment:
            Number(
              match.comment
            ) || 0,

          forcedtatami:
            Number(
              match.forcedtatami
            ) || 0,

          forcednumber:
            Number(
              match.forcednumber
            ) || 0,
        });
      }

      console.table(
        filas
      );

      console.log("");

      resultado.push({
        categoria: {
          id:
            Number(
              categoria.id
            ),

          nombre:
            categoria.categoria,

          tatami:
            Number(
              categoria.tatami
            ),

          wishsys:
            Number(
              categoria.wishsys
            ),

          wishsys_nombre:
            nombreWishsys(
              categoria.wishsys
            ),

          system:
            Number(
              categoria.system
            ),

          system_nombre:
            nombreSistemaInterno(
              categoria.system
            ),

          table:
            Number(
              categoria.tabla
            ),

          numcomp:
            Number(
              categoria.numcomp
            ),

          matches:
            matches.length,
        },

        combates:
          matchesJSON,
      });
    }

    // ========================================================
    // RESUMEN
    // ========================================================

    console.log(
      "============================================================"
    );

    console.log(
      "                       RESUMEN"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.table(
      resultado.map(
        (item) => ({
          Categoría:
            item.categoria.nombre,

          Competidores:
            item.categoria.numcomp,

          Wishsys:
            item.categoria.wishsys_nombre,

          "Sistema real":
            item.categoria.system_nombre,

          Tabla:
            item.categoria.table,

          Matches:
            item.categoria.matches,

          Tatami:
            `T${item.categoria.tatami}`,
        })
      )
    );

    // ========================================================
    // GUARDAR JSON
    // ========================================================

    fs.mkdirSync(
      carpetaPropuestas,
      {
        recursive: true,
      }
    );

    const rutaSalida =
      path.resolve(
        carpetaPropuestas,
        `inspeccion-llaves-${selloFecha()}.json`
      );

    fs.writeFileSync(
      rutaSalida,
      JSON.stringify(
        {
          generado_en:
            new Date()
              .toISOString(),

          modo:
            "solo_lectura",

          archivo:
            rutaShi,

          categorias:
            resultado,
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("");

    console.log(
      "💾 Inspección guardada:"
    );

    console.log(
      rutaSalida
    );

    console.log("");

    console.log(
      "🔒 SOLO LECTURA"
    );

    console.log(
      "No se modificó JudoShiai."
    );

    console.log(
      "No se modificó Supabase."
    );

    console.log(
      "No se modificó el .shi."
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

  process.exitCode = 1;
}