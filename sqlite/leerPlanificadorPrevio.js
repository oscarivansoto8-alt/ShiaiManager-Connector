const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

// ============================================================
// SISTEMAS DE COMPETENCIA DE JUDOSHIAI
// ============================================================

function nombreSistema(wishsys) {
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
    13: "Eliminación doble modificada",
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

  return sistemas[wishsys] || `Sistema ${wishsys}`;
}

// ============================================================
// REGLAS DEL TORNEO
// ============================================================

function reglaEsperada(cantidad) {
  if (cantidad === 1) {
    return "Clasificación directa";
  }

  if (cantidad === 2) {
    return "Mejor de 3";
  }

  if (cantidad >= 3 && cantidad <= 5) {
    return "ESP Liga";
  }

  return "Eliminatoria / IJF / Repechaje";
}

function validarSistema(cantidad, wishsys) {
  if (cantidad === 1) {
    return {
      correcto: true,
      estado: "✅ CLASIFICACIÓN DIRECTA",
    };
  }

  if (cantidad === 2) {
    if (wishsys === 18 || wishsys === 0) {
      return {
        correcto: true,
        estado: "✅ CORRECTO",
      };
    }

    return {
      correcto: false,
      estado: "⚠️ DEBERÍA SER MEJOR DE 3",
    };
  }

  if (cantidad >= 3 && cantidad <= 5) {
    if (wishsys === 1 || wishsys === 0) {
      return {
        correcto: true,
        estado: "✅ CORRECTO",
      };
    }

    return {
      correcto: false,
      estado: "⚠️ DEBERÍA SER ESP LIGA",
    };
  }

  if (cantidad >= 6) {
    if (wishsys === 1 || wishsys === 18) {
      return {
        correcto: false,
        estado: "⚠️ DEBERÍA SER ELIMINATORIA",
      };
    }

    if (wishsys === 0) {
      return {
        correcto: false,
        estado: "⚠️ SISTEMA AUTOMÁTICO - REVISAR",
      };
    }

    return {
      correcto: true,
      estado: "✅ CORRECTO",
    };
  }

  return {
    correcto: false,
    estado: "⚠️ REVISAR",
  };
}

// ============================================================
// COMBATES PROYECTADOS
// ============================================================

function calcularCombates(cantidad) {
  if (cantidad === 1) {
    return 0;
  }

  // Mejor de 3:
  // reservamos máximo de 3 combates.
  if (cantidad === 2) {
    return 3;
  }

  // Todos contra todos.
  if (cantidad >= 3 && cantidad <= 5) {
    return (cantidad * (cantidad - 1)) / 2;
  }

  // Lo calcularemos después según cuadro específico.
  return null;
}

// ============================================================
// DISTRIBUIR CATEGORÍAS ENTRE TATAMIS
// ============================================================

function distribuirCategorias(categorias, numeroTatamis) {
  const tatamis = [];

  for (let i = 1; i <= numeroTatamis; i++) {
    tatamis.push({
      numero: i,
      carga: 0,
      categorias: [],
    });
  }

  const ordenadas = categorias
    .filter(
      (categoria) =>
        categoria.correcto &&
        typeof categoria.combates === "number" &&
        categoria.combates > 0
    )
    .sort((a, b) => {
      if (b.combates !== a.combates) {
        return b.combates - a.combates;
      }

      return a.nombre.localeCompare(
        b.nombre,
        "es",
        { numeric: true }
      );
    });

  for (const categoria of ordenadas) {
    tatamis.sort((a, b) => {
      if (a.carga !== b.carga) {
        return a.carga - b.carga;
      }

      return a.numero - b.numero;
    });

    const tatami = tatamis[0];

    tatami.categorias.push(categoria);
    tatami.carga += categoria.combates;
  }

  tatamis.sort(
    (a, b) => a.numero - b.numero
  );

  return tatamis;
}

// ============================================================
// PROGRAMA PRINCIPAL
// ============================================================

function ejecutar() {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "                  PLANIFICADOR PREVIO"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(
      "No se encontró planificador-prueba.shi"
    );
  }

  const db = new Database(rutaArchivo, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    // ========================================================
    // INFORMACIÓN DEL TORNEO
    // ========================================================

    const infoFilas = db
      .prepare(`
        SELECT item, value
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

    const numeroTatamis =
      Number(info.NumTatamis) || 3;

    console.log(
      `Torneo: ${info.Competition || "Sin nombre"}`
    );

    console.log(
      `Fecha: ${info.Date || "Sin fecha"}`
    );

    console.log(
      `Tatamis configurados: ${numeroTatamis}`
    );

    console.log("");

    // ========================================================
    // CATEGORÍAS REALES + COMPETIDORES REALES
    //
    // IMPORTANTE:
    // La relación correcta de JudoShiai es:
    //
    // categories.category = competitors.category
    //
    // NO usamos categories.numcomp.
    // NO usamos pos1...pos8.
    // ========================================================

    const filas = db
      .prepare(`
        SELECT
          c."index" AS id,
          TRIM(c.category) AS categoria,
          c.category AS categoria_original,
          c.wishsys,
          c.tatami,
          c."group" AS grupo,

          COUNT(p."index") AS competidores

        FROM categories AS c

        INNER JOIN competitors AS p
          ON p.category = c.category
         AND (p.deleted & 1) = 0

        WHERE (c.deleted & 1) = 0

        GROUP BY
          c."index",
          c.category,
          c.wishsys,
          c.tatami,
          c."group"

        HAVING COUNT(p."index") > 0

        ORDER BY
          c.category COLLATE NOCASE,
          c."index"
      `)
      .all();

    const categorias = [];

    for (const fila of filas) {
      const cantidad =
        Number(fila.competidores) || 0;

      const wishsys =
        Number(fila.wishsys) || 0;

      const validacion =
        validarSistema(
          cantidad,
          wishsys
        );

      const combates =
        calcularCombates(cantidad);

      categorias.push({
        id: Number(fila.id),
        nombre:
          String(fila.categoria).trim(),

        competidores:
          cantidad,

        wishsys,

        sistema:
          nombreSistema(wishsys),

        regla:
          reglaEsperada(cantidad),

        combates,

        tatamiActual:
          Number(fila.tatami) || 0,

        correcto:
          validacion.correcto,

        estado:
          validacion.estado,
      });
    }

    // ========================================================
    // VALIDACIÓN
    // ========================================================

    console.log(
      "============================================================"
    );

    console.log(
      "              VALIDACIÓN DE CATEGORÍAS"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.table(
      categorias.map((categoria) => ({
        Categoría:
          categoria.nombre,

        Competidores:
          categoria.competidores,

        "Sistema elegido":
          categoria.sistema,

        "Regla esperada":
          categoria.regla,

        "Combates proyectados":
          categoria.combates === null
            ? "Pendiente"
            : categoria.combates,

        "Tatami actual":
          categoria.tatamiActual > 0
            ? categoria.tatamiActual
            : "-",

        Estado:
          categoria.estado,
      }))
    );

    // ========================================================
    // ADVERTENCIAS
    // ========================================================

    const incorrectas =
      categorias.filter(
        (categoria) =>
          !categoria.correcto
      );

    if (incorrectas.length > 0) {
      console.log("");
      console.log(
        "⚠️ SISTEMAS A REVISAR:"
      );

      for (const categoria of incorrectas) {
        console.log(
          `   ${categoria.nombre}`
        );

        console.log(
          `   Actual: ${categoria.sistema}`
        );

        console.log(
          `   Esperado: ${categoria.regla}`
        );

        console.log("");
      }
    }

    // ========================================================
    // AVISAR TATAMIS YA ASIGNADOS
    // ========================================================

    const asignadas =
      categorias.filter(
        (categoria) =>
          categoria.tatamiActual > 0
      );

    if (asignadas.length > 0) {
      console.log("");
      console.log(
        "⚠️ CATEGORÍAS QUE YA TIENEN TATAMI:"
      );

      for (const categoria of asignadas) {
        console.log(
          `   ${categoria.nombre} → Tatami ${categoria.tatamiActual}`
        );
      }

      console.log("");
    }

    // ========================================================
    // CARGA
    // ========================================================

    const totalCompetidores =
      categorias.reduce(
        (total, categoria) =>
          total +
          categoria.competidores,
        0
      );

    const totalCombates =
      categorias.reduce(
        (total, categoria) => {
          if (
            typeof categoria.combates !==
            "number"
          ) {
            return total;
          }

          return (
            total +
            categoria.combates
          );
        },
        0
      );

    console.log(
      "============================================================"
    );

    console.log(
      "                 CARGA PROYECTADA"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.log(
      `Categorías activas: ${categorias.length}`
    );

    console.log(
      `Competidores reales: ${totalCompetidores}`
    );

    console.log(
      `Combates proyectados: ${totalCombates}`
    );

    console.log("");

    // ========================================================
    // PROPUESTA DE TATAMIS
    // ========================================================

    const propuesta =
      distribuirCategorias(
        categorias,
        numeroTatamis
      );

    console.log(
      "============================================================"
    );

    console.log(
      "           PROPUESTA AUTOMÁTICA DE TATAMIS"
    );

    console.log(
      "============================================================"
    );

    console.log("");

    for (const tatami of propuesta) {
      console.log(
        `🥋 TATAMI ${tatami.numero}`
      );

      console.log(
        `   Carga: ${tatami.carga} combates`
      );

      if (
        tatami.categorias.length === 0
      ) {
        console.log(
          "   Sin categorías"
        );
      } else {
        for (
          const categoria
          of tatami.categorias
        ) {
          console.log(
            `   • ${categoria.nombre} | ${categoria.competidores} competidores | ${categoria.combates} combates`
          );
        }
      }

      console.log("");
    }

    console.log(
      "============================================================"
    );

    console.log(
      "🔒 SOLO LECTURA"
    );

    console.log(
      "No se modificó el archivo .shi."
    );

    console.log(
      "No se modificó ningún tatami."
    );

    console.log(
      "============================================================"
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
  console.error("❌ ERROR:");
  console.error(error.message);
  console.error("");
}