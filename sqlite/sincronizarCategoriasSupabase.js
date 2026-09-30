require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { createClient } = require("@supabase/supabase-js");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("");
  console.error("❌ Faltan variables de Supabase en .env");
  console.error("");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// ============================================================
// DETECTAR SEXO
// ============================================================

function detectarSexoTexto(nombre) {
  const texto = String(nombre || "").trim();

  if (
    /\(M\)/i.test(texto) ||
    /\bmasculino\b/i.test(texto) ||
    /\bvar[oó]n\b/i.test(texto)
  ) {
    return "M";
  }

  if (
    /\(F\)/i.test(texto) ||
    /\bfemenin[ao]\b/i.test(texto) ||
    /\bmujer\b/i.test(texto)
  ) {
    return "F";
  }

  return "?";
}

// ============================================================
// DETECTAR GRUPO
// ============================================================

function detectarGrupo(nombre) {
  const limpio = String(nombre || "").trim();

  // Sub18 = masculino
  // sub18 = femenino
  const sub = limpio.match(
    /^(Sub|sub)\s*\(?(\d{1,2})\)?/
  );

  if (sub) {
    return {
      grupo: `Sub${sub[2]}`,
      sexo:
        sub[1] === "Sub"
          ? "M"
          : "F",
    };
  }

  const lower =
    limpio.toLowerCase();

  if (lower.includes("absolut")) {
    return {
      grupo: "Absoluto",
      sexo:
        detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("open")) {
    return {
      grupo: "Open",
      sexo:
        detectarSexoTexto(limpio),
    };
  }

  if (
    lower.includes("master") ||
    lower.includes("máster")
  ) {
    return {
      grupo: "Máster",
      sexo:
        detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("novicio")) {
    return {
      grupo: "Novicio",
      sexo:
        detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("amateur")) {
    return {
      grupo: "Amateur",
      sexo:
        detectarSexoTexto(limpio),
    };
  }

  return {
    grupo: "Otros",
    sexo:
      detectarSexoTexto(limpio),
  };
}

// ============================================================
// PESO
// ============================================================

function obtenerPeso(nombre) {
  const texto =
    String(nombre || "").trim();

  const resultado =
    texto.match(/([+-]\s*\d+)/);

  if (!resultado) {
    return null;
  }

  return resultado[1].replace(
    /\s+/g,
    ""
  );
}

// ============================================================
// SISTEMA
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
    sistemas[wishsys] ||
    `Sistema ${wishsys}`
  );
}

// ============================================================
// VALIDAR SISTEMA
// ============================================================

function validarSistema(
  competidores,
  wishsys
) {
  if (competidores === 1) {
    return {
      correcto: true,
      estado:
        "Clasificación directa",
    };
  }

  if (competidores === 2) {
    const correcto =
      wishsys === 18 ||
      wishsys === 0;

    return {
      correcto,
      estado: correcto
        ? "Correcto"
        : "Debería ser Mejor de 3",
    };
  }

  if (
    competidores >= 3 &&
    competidores <= 5
  ) {
    const correcto =
      wishsys === 1 ||
      wishsys === 0;

    return {
      correcto,
      estado: correcto
        ? "Correcto"
        : "Debería ser ESP Liga",
    };
  }

  if (competidores >= 6) {
    const correcto =
      wishsys !== 1 &&
      wishsys !== 18;

    return {
      correcto,
      estado: correcto
        ? "Sistema eliminatorio"
        : "Revisar sistema eliminatorio",
    };
  }

  return {
    correcto: false,
    estado: "Revisar",
  };
}

// ============================================================
// COMBATES ESTIMADOS
// ============================================================

function calcularCombates(
  competidores,
  combatesGenerados
) {
  if (competidores === 1) {
    return 0;
  }

  if (competidores === 2) {
    return 3;
  }

  if (
    competidores >= 3 &&
    competidores <= 5
  ) {
    return (
      competidores *
      (competidores - 1)
    ) / 2;
  }

  if (
    competidores >= 6 &&
    combatesGenerados > 0
  ) {
    return combatesGenerados;
  }

  return null;
}

// ============================================================
// SINCRONIZAR
// ============================================================

async function sincronizar() {
  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "   SINCRONIZAR CATEGORÍAS → SUPABASE"
  );
  console.log(
    "=========================================="
  );
  console.log("");

  const db = new Database(
    rutaArchivo,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    // --------------------------------------------------------
    // DATOS DEL TORNEO
    // --------------------------------------------------------

    const infoFilas = db
      .prepare(`
        SELECT item, value
        FROM info
        WHERE item IN (
          'Competition',
          'Date'
        )
      `)
      .all();

    const info = {};

    for (const fila of infoFilas) {
      info[fila.item] =
        fila.value;
    }

    const torneoNombre =
      info.Competition ||
      "Sin nombre";

    const torneoFecha =
      info.Date || null;

    // --------------------------------------------------------
    // CATEGORÍAS ACTIVAS
    // --------------------------------------------------------

    const filas = db
      .prepare(`
        SELECT
          c."index" AS id,
          TRIM(c.category) AS categoria,
          c.wishsys,
          c.tatami,

          COUNT(p."index")
            AS competidores,

          (
            SELECT COUNT(*)
            FROM matches AS m
            WHERE
              m.category = c."index"
              AND (m.deleted & 1) = 0
          ) AS combates_generados

        FROM categories AS c

        INNER JOIN competitors AS p
          ON p.category = c.category
         AND (p.deleted & 1) = 0

        WHERE
          (c.deleted & 1) = 0

        GROUP BY
          c."index",
          c.category,
          c.wishsys,
          c.tatami

        HAVING
          COUNT(p."index") > 0

        ORDER BY
          c.category COLLATE NOCASE
      `)
      .all();

    const registros = [];

    for (const fila of filas) {
      const clasificacion =
        detectarGrupo(
          fila.categoria
        );

      const competidores =
        Number(
          fila.competidores
        ) || 0;

      const wishsys =
        Number(
          fila.wishsys
        ) || 0;

      const combatesGenerados =
        Number(
          fila.combates_generados
        ) || 0;

      const validacion =
        validarSistema(
          competidores,
          wishsys
        );

      registros.push({
        judoshiai_index:
          Number(fila.id),

        categoria:
          String(
            fila.categoria
          ).trim(),

        grupo:
          clasificacion.grupo,

        sexo:
          clasificacion.sexo,

        peso:
          obtenerPeso(
            fila.categoria
          ),

        competidores,

        wishsys,

        sistema:
          nombreSistema(
            wishsys
          ),

        sistema_correcto:
          validacion.correcto,

        estado_sistema:
          validacion.estado,

        combates_estimados:
          calcularCombates(
            competidores,
            combatesGenerados
          ),

        tatami_actual:
          Number(
            fila.tatami
          ) || 0,

        torneo_nombre:
          torneoNombre,

        torneo_fecha:
          torneoFecha,

        sincronizado_en:
          new Date().toISOString(),
      });
    }

    if (registros.length === 0) {
      console.log(
        "⚠️ No se encontraron categorías activas."
      );

      return;
    }

    // --------------------------------------------------------
    // GUARDAR EN SUPABASE
    // --------------------------------------------------------

    const { error } =
      await supabase
        .from(
          "categorias_judoshiai"
        )
        .upsert(
          registros,
          {
            onConflict:
              "judoshiai_index",
          }
        );

    if (error) {
      throw new Error(
        error.message
      );
    }

    // --------------------------------------------------------
    // ELIMINAR CATEGORÍAS ANTIGUAS
    // --------------------------------------------------------

    const idsActuales =
      registros.map(
        (r) =>
          r.judoshiai_index
      );

    const {
      data: existentes,
      error: errorLectura,
    } = await supabase
      .from(
        "categorias_judoshiai"
      )
      .select(
        "judoshiai_index"
      );

    if (errorLectura) {
      throw new Error(
        errorLectura.message
      );
    }

    const idsAntiguos =
      (existentes || [])
        .map(
          (fila) =>
            Number(
              fila.judoshiai_index
            )
        )
        .filter(
          (id) =>
            !idsActuales.includes(
              id
            )
        );

    if (
      idsAntiguos.length > 0
    ) {
      const {
        error:
          errorLimpieza,
      } = await supabase
        .from(
          "categorias_judoshiai"
        )
        .delete()
        .in(
          "judoshiai_index",
          idsAntiguos
        );

      if (errorLimpieza) {
        throw new Error(
          errorLimpieza.message
        );
      }
    }

    // --------------------------------------------------------
    // RESULTADO
    // --------------------------------------------------------

    const totalCompetidores =
      registros.reduce(
        (total, fila) =>
          total +
          fila.competidores,
        0
      );

    const totalCombates =
      registros.reduce(
        (total, fila) => {
          if (
            typeof
              fila.combates_estimados !==
            "number"
          ) {
            return total;
          }

          return (
            total +
            fila.combates_estimados
          );
        },
        0
      );

    console.log(
      `✅ Categorías sincronizadas: ${registros.length}`
    );

    console.log(
      `✅ Competidores detectados: ${totalCompetidores}`
    );

    console.log(
      `✅ Combates estimados: ${totalCombates}`
    );

    console.log("");

    console.table(
      registros.map(
        (fila) => ({
          Categoría:
            fila.categoria,

          Grupo:
            fila.grupo,

          Sexo:
            fila.sexo,

          Peso:
            fila.peso,

          Competidores:
            fila.competidores,

          Sistema:
            fila.sistema,

          Combates:
            fila.combates_estimados,

          Tatami:
            fila.tatami_actual,
        })
      )
    );

    console.log("");
    console.log(
      "✅ Datos enviados a Supabase."
    );
    console.log("");
  } finally {
    db.close();
  }
}

sincronizar().catch(
  (error) => {
    console.error("");
    console.error(
      "❌ ERROR:"
    );
    console.error(
      error.message
    );
    console.error("");
    process.exitCode = 1;
  }
);