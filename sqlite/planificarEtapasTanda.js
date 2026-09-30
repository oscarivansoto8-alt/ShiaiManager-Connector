require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { createClient } = require("@supabase/supabase-js");

// ============================================================
// CONFIGURACIÓN
// ============================================================

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY;

if (
  !SUPABASE_URL ||
  !SUPABASE_SERVICE_KEY
) {
  console.error("");
  console.error(
    "❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env"
  );
  console.error("");
  process.exit(1);
}

/*
 * IMPORTANTE:
 *
 * Seguimos trabajando EXCLUSIVAMENTE
 * sobre la copia de prueba.
 */
const rutaShi = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const carpetaPropuestas = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "propuestas"
);

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
// ARGUMENTOS
// ============================================================

function obtenerTandaId() {
  const tandaId =
    Number(process.argv[2]);

  if (
    !Number.isInteger(tandaId) ||
    tandaId <= 0
  ) {
    throw new Error(
      [
        "Debes indicar el ID de la tanda.",
        "",
        "Ejemplo:",
        "node .\\sqlite\\planificarEtapasTanda.js 2",
      ].join("\n")
    );
  }

  return tandaId;
}

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(
    valor ?? ""
  ).trim();
}

function selloFecha() {
  const fecha =
    new Date();

  const pad = (n) =>
    String(n)
      .padStart(
        2,
        "0"
      );

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

// ============================================================
// NOMBRES DE WISHSYS
//
// Este es el sistema solicitado/configurado
// desde JudoShiai.
// ============================================================

function nombreWishsys(
  wishsys
) {
  const sistemas = {
    0:
      "Automático",

    1:
      "ESP Liga",

    2:
      "Doble Pool",

    3:
      "Repechaje",

    4:
      "SWE Rep. doble",

    5:
      "SWE Rep. directa",

    6:
      "EST D-Klass",

    7:
      "Sin repechaje",

    8:
      "SWE Rep. simple",

    9:
      "4 Pools",

    10:
      "ESP Doble pérdida",

    11:
      "IJF Rep. doble",

    12:
      "ESP Repesca simple",

    13:
      "Eliminación doble",

    14:
      "Repechaje 1 bronce",

    15:
      "Doble Pool 2",

    16:
      "Double Lost",

    17:
      "GBR Knockout",

    18:
      "Mejor de 3",

    19:
      "DEN Doble eliminación",

    20:
      "EST D-Klass 1 bronce",

    21:
      "Doble Pool 3",

    22:
      "Personalizado",
  };

  return (
    sistemas[
      Number(wishsys)
    ] ||
    `Wishsys ${wishsys}`
  );
}

// ============================================================
// SISTEMA INTERNO REAL DE JUDOSHIAI
//
// Este valor es mucho más importante para V3.
//
// Después del sorteo, "system" nos dice
// qué estructura real utiliza JudoShiai.
//
// JudoShiai:
//
// 1  = Pool
// 2  = Double Pool
// 3  = French 8
// 4  = French 16
// 5  = French 32
// 6  = French 64
// 7  = French 128
// 8  = French 256
// 9  = Quad Pool
// 10 = Double Pool 2
// 11 = Best of 3
// 12 = Double Pool 3
// 13 = Custom
// ============================================================

function nombreSistemaInterno(
  sistema
) {
  const sistemas = {
    0:
      "Sin sistema / sin sorteo",

    1:
      "Pool",

    2:
      "Double Pool",

    3:
      "French 8",

    4:
      "French 16",

    5:
      "French 32",

    6:
      "French 64",

    7:
      "French 128",

    8:
      "French 256",

    9:
      "Quad Pool",

    10:
      "Double Pool 2",

    11:
      "Best of 3",

    12:
      "Double Pool 3",

    13:
      "Custom",
  };

  return (
    sistemas[
      Number(sistema)
    ] ||
    `Sistema interno ${sistema}`
  );
}

// ============================================================
// TIPO QUE UTILIZARÁ NUESTRO PLANIFICADOR
// ============================================================

function detectarTipoPlanificador(
  categoria
) {
  const sistema =
    Number(
      categoria.system
    ) || 0;

  const wishsys =
    Number(
      categoria.wishsys
    ) || 0;

  const competidores =
    Number(
      categoria.competidores
    ) || 0;

  // ----------------------------------------------------------
  // 1 COMPETIDOR
  // ----------------------------------------------------------

  if (
    competidores <= 1
  ) {
    return {
      tipo:
        "CLASIFICACION_DIRECTA",

      estrategia:
        "Sin combates",

      necesitaEtapas:
        false,
    };
  }

  // ----------------------------------------------------------
  // SISTEMA REAL: POOL
  // ----------------------------------------------------------

  if (
    sistema === 1
  ) {
    return {
      tipo:
        "TODOS_CONTRA_TODOS",

      estrategia:
        "Organizar por pasadas/rondas internas",

      necesitaEtapas:
        true,
    };
  }

  // ----------------------------------------------------------
  // SISTEMA REAL: BEST OF 3
  // ----------------------------------------------------------

  if (
    sistema === 11
  ) {
    return {
      tipo:
        "MEJOR_DE_3",

      estrategia:
        "Separar combate 1 → descanso → combate 2 → posible combate 3",

      necesitaEtapas:
        true,
    };
  }

  // ----------------------------------------------------------
  // SISTEMAS FRENCH / ELIMINATORIOS
  // ----------------------------------------------------------

  if (
    sistema >= 3 &&
    sistema <= 8
  ) {
    return {
      tipo:
        "ELIMINATORIA",

      estrategia:
        "Separar primera ronda/cuartos → semifinales/repechajes → medallas",

      necesitaEtapas:
        true,
    };
  }

  // ----------------------------------------------------------
  // SISTEMAS DE POOLS CON FASE FINAL
  // ----------------------------------------------------------

  if (
    [
      2,
      9,
      10,
      12,
    ].includes(
      sistema
    )
  ) {
    return {
      tipo:
        "POOLS_CON_FASE_FINAL",

      estrategia:
        "Completar pools primero y después fase final",

      necesitaEtapas:
        true,
    };
  }

  // ----------------------------------------------------------
  // PERSONALIZADO
  // ----------------------------------------------------------

  if (
    sistema === 13
  ) {
    return {
      tipo:
        "PERSONALIZADO",

      estrategia:
        "Requiere analizar dependencias antes de ordenar",

      necesitaEtapas:
        true,
    };
  }

  // ----------------------------------------------------------
  // TODAVÍA SIN SORTEO
  //
  // Podemos inferir únicamente la intención.
  // NO la utilizaremos todavía para aplicar orden.
  // ----------------------------------------------------------

  if (
    sistema === 0
  ) {
    if (
      wishsys === 1
    ) {
      return {
        tipo:
          "TODOS_CONTRA_TODOS_PENDIENTE",

        estrategia:
          "Esperando sorteo manual",

        necesitaEtapas:
          false,
      };
    }

    if (
      wishsys === 18
    ) {
      return {
        tipo:
          "MEJOR_DE_3_PENDIENTE",

        estrategia:
          "Esperando sorteo manual",

        necesitaEtapas:
          false,
      };
    }

    return {
      tipo:
        "PENDIENTE_DE_SORTEO",

      estrategia:
        "No planificar combates hasta que el usuario realice el sorteo",

      necesitaEtapas:
        false,
    };
  }

  return {
    tipo:
      "REVISAR",

    estrategia:
      "Sistema todavía no modelado",

    necesitaEtapas:
      false,
  };
}

// ============================================================
// ESTIMAR COMBATES
//
// Esto sirve para conocer carga.
//
// Cuando ya existen combates reales,
// SIEMPRE preferimos el número real generado
// por JudoShiai.
// ============================================================

function estimarCombates(
  categoria
) {
  const generados =
    Number(
      categoria.combates_generados
    ) || 0;

  if (
    generados > 0
  ) {
    return {
      cantidad:
        generados,

      origen:
        "JudoShiai real",
    };
  }

  const n =
    Number(
      categoria.competidores
    ) || 0;

  const sistema =
    Number(
      categoria.system
    ) || 0;

  const wishsys =
    Number(
      categoria.wishsys
    ) || 0;

  if (
    n <= 1
  ) {
    return {
      cantidad: 0,
      origen:
        "Clasificación directa",
    };
  }

  /*
   * Todos contra todos.
   */
  if (
    sistema === 1 ||
    (
      sistema === 0 &&
      wishsys === 1
    )
  ) {
    return {
      cantidad:
        (
          n *
          (n - 1)
        ) / 2,

      origen:
        "Cálculo liga",
    };
  }

  /*
   * Mejor de 3:
   *
   * JudoShiai prepara hasta 3 combates.
   */
  if (
    sistema === 11 ||
    (
      sistema === 0 &&
      wishsys === 18
    )
  ) {
    return {
      cantidad: 3,

      origen:
        "Mejor de 3",
    };
  }

  /*
   * Para eliminatorias y sistemas híbridos,
   * mientras no exista sorteo real,
   * NO inventamos cantidad exacta.
   */
  return {
    cantidad: null,

    origen:
      "Pendiente de sorteo real",
  };
}

// ============================================================
// TANDA
// ============================================================

async function cargarTanda(
  tandaId
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      "tandas_planificador"
    )
    .select(
      `
      id,
      campeonato_id,
      nombre,
      orden,
      estado
      `
    )
    .eq(
      "id",
      tandaId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      error.message
    );
  }

  if (!data) {
    throw new Error(
      `No existe la tanda ${tandaId}.`
    );
  }

  return data;
}

// ============================================================
// DISTRIBUCIÓN DE CATEGORÍAS
// ============================================================

async function cargarDistribucion(
  tandaId
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      "distribucion_categorias_tatamis"
    )
    .select(
      `
      id,
      tanda_id,
      categoria_clave,
      registro_categoria,
      genero,
      categoria_peso,
      tatami_numero,
      orden,
      cantidad_deportistas,
      combates_estimados,
      judoshiai_index
      `
    )
    .eq(
      "tanda_id",
      tandaId
    )
    .order(
      "tatami_numero",
      {
        ascending: true,
      }
    )
    .order(
      "orden",
      {
        ascending: true,
      }
    );

  if (error) {
    throw new Error(
      error.message
    );
  }

  if (
    !data ||
    data.length === 0
  ) {
    throw new Error(
      "La tanda no tiene categorías distribuidas entre tatamis."
    );
  }

  return data;
}

// ============================================================
// LEER JUDOSHIAI
// ============================================================

function leerJudoShiai(
  distribucion
) {
  if (
    !fs.existsSync(
      rutaShi
    )
  ) {
    throw new Error(
      `No existe la copia de prueba:\n${rutaShi}`
    );
  }

  const db =
    new Database(
      rutaShi,
      {
        readonly: true,
        fileMustExist: true,
      }
    );

  try {
    // --------------------------------------------------------
    // VALIDAR COLUMNAS
    // --------------------------------------------------------

    const columnas =
      db
        .prepare(
          "PRAGMA table_info(categories)"
        )
        .all()
        .map(
          (fila) =>
            fila.name
        );

    const necesarias = [
      "index",
      "category",
      "tatami",
      "wishsys",
      "system",
      "numcomp",
      "table",
    ];

    for (
      const columna
      of necesarias
    ) {
      if (
        !columnas.includes(
          columna
        )
      ) {
        throw new Error(
          `Falta la columna categories.${columna}`
        );
      }
    }

    // --------------------------------------------------------
    // IDS DE LA TANDA
    // --------------------------------------------------------

    const idsPermitidos =
      new Set(
        distribucion
          .map(
            (fila) =>
              Number(
                fila.judoshiai_index
              )
          )
          .filter(
            (id) =>
              Number.isInteger(id) &&
              id > 0
          )
      );

    // --------------------------------------------------------
    // CATEGORÍAS
    // --------------------------------------------------------

    const categorias =
      db
        .prepare(`
          SELECT
            c."index" AS id,
            TRIM(c.category) AS categoria,

            c.tatami,
            c.wishsys,
            c.system,
            c.numcomp,
            c."table" AS tabla,

            (
              SELECT COUNT(*)
              FROM competitors AS p
              WHERE
                p.category = c.category
                AND (
                  COALESCE(
                    p.deleted,
                    0
                  ) & 1
                ) = 0
            ) AS competidores,

            (
              SELECT COUNT(*)
              FROM matches AS m
              WHERE
                m.category = c."index"
                AND (
                  COALESCE(
                    m.deleted,
                    0
                  ) & 1
                ) = 0
            ) AS combates_generados

          FROM categories AS c

          WHERE
            (
              COALESCE(
                c.deleted,
                0
              ) & 1
            ) = 0

          ORDER BY
            c.category COLLATE NOCASE
        `)
        .all()
        .filter(
          (categoria) =>
            idsPermitidos.has(
              Number(
                categoria.id
              )
            )
        );

    // --------------------------------------------------------
    // COMBATES POR CATEGORÍA
    // --------------------------------------------------------

    const matches =
      db
        .prepare(`
          SELECT
            category,
            number,
            blue,
            white,
            blue_points,
            white_points,
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
        .all()
        .filter(
          (match) =>
            idsPermitidos.has(
              Number(
                match.category
              )
            )
        );

    const matchesPorCategoria =
      new Map();

    for (
      const match
      of matches
    ) {
      const categoriaId =
        Number(
          match.category
        );

      if (
        !matchesPorCategoria.has(
          categoriaId
        )
      ) {
        matchesPorCategoria.set(
          categoriaId,
          []
        );
      }

      matchesPorCategoria
        .get(
          categoriaId
        )
        .push(
          match
        );
    }

    return {
      categorias,
      matchesPorCategoria,
    };
  } finally {
    db.close();
  }
}

// ============================================================
// CREAR DIAGNÓSTICO
// ============================================================

function crearDiagnostico(
  distribucion,
  datosShi
) {
  const distribucionPorId =
    new Map();

  for (
    const fila
    of distribucion
  ) {
    distribucionPorId.set(
      Number(
        fila.judoshiai_index
      ),
      fila
    );
  }

  const resultado = [];

  for (
    const categoria
    of datosShi.categorias
  ) {
    const id =
      Number(
        categoria.id
      );

    const distribucionCategoria =
      distribucionPorId.get(
        id
      );

    if (
      !distribucionCategoria
    ) {
      continue;
    }

    const competidores =
      Number(
        categoria.competidores
      ) || 0;

    const matches =
      datosShi.matchesPorCategoria.get(
        id
      ) || [];

    const deteccion =
      detectarTipoPlanificador({
        ...categoria,
        competidores,
      });

    const estimacion =
      estimarCombates({
        ...categoria,
        competidores,
      });

    const tatamiEsperado =
      Number(
        distribucionCategoria.tatami_numero
      );

    const tatamiReal =
      Number(
        categoria.tatami
      ) || 0;

    const tatamiCorrecto =
      tatamiReal ===
      tatamiEsperado;

    resultado.push({
      judoshiaiIndex:
        id,

      categoria:
        categoria.categoria,

      tatamiEsperado,

      tatamiReal,

      tatamiCorrecto,

      competidores,

      wishsys:
        Number(
          categoria.wishsys
        ) || 0,

      wishsysNombre:
        nombreWishsys(
          categoria.wishsys
        ),

      sistemaInterno:
        Number(
          categoria.system
        ) || 0,

      sistemaInternoNombre:
        nombreSistemaInterno(
          categoria.system
        ),

      tabla:
        Number(
          categoria.tabla
        ) || 0,

      numcompInterno:
        Number(
          categoria.numcomp
        ) || 0,

      tipoPlanificador:
        deteccion.tipo,

      estrategia:
        deteccion.estrategia,

      necesitaEtapas:
        deteccion.necesitaEtapas,

      combatesGenerados:
        matches.length,

      combatesCarga:
        estimacion.cantidad,

      origenCarga:
        estimacion.origen,

      sorteada:
        matches.length > 0,
    });
  }

  return resultado;
}

// ============================================================
// AGRUPAR POR TATAMI
// ============================================================

function agruparPorTatami(
  categorias
) {
  const mapa =
    new Map();

  for (
    const categoria
    of categorias
  ) {
    const tatami =
      categoria.tatamiEsperado;

    if (
      !mapa.has(
        tatami
      )
    ) {
      mapa.set(
        tatami,
        []
      );
    }

    mapa
      .get(
        tatami
      )
      .push(
        categoria
      );
  }

  return mapa;
}

// ============================================================
// GUARDAR DIAGNÓSTICO
// ============================================================

function guardarDiagnostico(
  tanda,
  categorias
) {
  fs.mkdirSync(
    carpetaPropuestas,
    {
      recursive: true,
    }
  );

  const ruta =
    path.resolve(
      carpetaPropuestas,
      `diagnostico-etapas-tanda-${tanda.id}-${selloFecha()}.json`
    );

  const contenido = {
    generado_en:
      new Date()
        .toISOString(),

    modo:
      "solo_lectura",

    version:
      "v3_deteccion_sistemas",

    tanda,

    categorias,
  };

  fs.writeFileSync(
    ruta,
    JSON.stringify(
      contenido,
      null,
      2
    ),
    "utf8"
  );

  return ruta;
}

// ============================================================
// EJECUCIÓN
// ============================================================

async function ejecutar() {
  console.log("");

  console.log(
    "============================================================"
  );

  console.log(
    "      PLANIFICADOR V3 — DETECCIÓN DE SISTEMAS"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  const tandaId =
    obtenerTandaId();

  const tanda =
    await cargarTanda(
      tandaId
    );

  const distribucion =
    await cargarDistribucion(
      tanda.id
    );

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `Tanda ID: ${tanda.id}`
  );

  console.log(
    `Campeonato ID: ${tanda.campeonato_id}`
  );

  console.log("");

  console.log(
    `Categorías distribuidas: ${distribucion.length}`
  );

  console.log("");

  console.log(
    `Archivo leído:`
  );

  console.log(
    rutaShi
  );

  console.log("");

  // ==========================================================
  // LEER .SHI
  // ==========================================================

  const datosShi =
    leerJudoShiai(
      distribucion
    );

  const categorias =
    crearDiagnostico(
      distribucion,
      datosShi
    );

  if (
    categorias.length === 0
  ) {
    throw new Error(
      "No se encontraron categorías de la tanda dentro del .shi."
    );
  }

  // ==========================================================
  // VALIDAR TATAMIS
  // ==========================================================

  const erroresTatami =
    categorias.filter(
      (categoria) =>
        !categoria.tatamiCorrecto
    );

  if (
    erroresTatami.length > 0
  ) {
    console.log(
      "⚠️ Hay categorías cuyo tatami no coincide:"
    );

    console.log("");

    console.table(
      erroresTatami.map(
        (categoria) => ({
          Categoría:
            categoria.categoria,

          "T esperado":
            categoria.tatamiEsperado,

          "T JudoShiai":
            categoria.tatamiReal,
        })
      )
    );

    console.log("");
  }

  // ==========================================================
  // MOSTRAR POR TATAMI
  // ==========================================================

  const porTatami =
    agruparPorTatami(
      categorias
    );

  const tatamis =
    [...porTatami.keys()]
      .sort(
        (a, b) =>
          a - b
      );

  for (
    const tatami
    of tatamis
  ) {
    const categoriasTatami =
      porTatami.get(
        tatami
      );

    console.log(
      "============================================================"
    );

    console.log(
      `🥋 TATAMI ${tatami}`
    );

    console.log(
      "============================================================"
    );

    console.log("");

    console.table(
      categoriasTatami.map(
        (categoria) => ({
          Categoría:
            categoria.categoria,

          Competidores:
            categoria.competidores,

          Wishsys:
            categoria.wishsysNombre,

          "Sistema real":
            categoria.sistemaInternoNombre,

          Tipo:
            categoria.tipoPlanificador,

          Combates:
            categoria.combatesCarga,

          Sorteada:
            categoria.sorteada
              ? "Sí"
              : "No",
        })
      )
    );

    console.log("");

    for (
      const categoria
      of categoriasTatami
    ) {
      console.log(
        `• ${categoria.categoria}`
      );

      console.log(
        `  Tipo V3: ${categoria.tipoPlanificador}`
      );

      console.log(
        `  Estrategia: ${categoria.estrategia}`
      );

      console.log(
        `  Competidores: ${categoria.competidores}`
      );

      console.log(
        `  Combates generados: ${categoria.combatesGenerados}`
      );

      console.log(
        `  Carga usada: ${
          categoria.combatesCarga === null
            ? "pendiente"
            : categoria.combatesCarga
        }`
      );

      console.log("");
    }
  }

  // ==========================================================
  // RESUMEN
  // ==========================================================

  const contarTipo = (
    tipo
  ) =>
    categorias.filter(
      (categoria) =>
        categoria.tipoPlanificador ===
        tipo
    ).length;

  console.log(
    "============================================================"
  );

  console.log(
    "                     RESUMEN"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.log(
    `Categorías: ${categorias.length}`
  );

  console.log(
    `Tatamis: ${tatamis.length}`
  );

  console.log("");

  console.log(
    `Todos contra todos: ${contarTipo(
      "TODOS_CONTRA_TODOS"
    )}`
  );

  console.log(
    `Mejor de 3: ${contarTipo(
      "MEJOR_DE_3"
    )}`
  );

  console.log(
    `Eliminatorias: ${contarTipo(
      "ELIMINATORIA"
    )}`
  );

  console.log(
    `Pools + fase final: ${contarTipo(
      "POOLS_CON_FASE_FINAL"
    )}`
  );

  console.log(
    `Personalizadas: ${contarTipo(
      "PERSONALIZADO"
    )}`
  );

  console.log("");

  const totalCombates =
    categorias.reduce(
      (
        total,
        categoria
      ) => {
        if (
          typeof
            categoria.combatesCarga !==
          "number"
        ) {
          return total;
        }

        return (
          total +
          categoria.combatesCarga
        );
      },
      0
    );

  console.log(
    `Combates/carga detectada: ${totalCombates}`
  );

  console.log("");

  // ==========================================================
  // GUARDAR
  // ==========================================================

  const ruta =
    guardarDiagnostico(
      tanda,
      categorias
    );

  console.log(
    "💾 Diagnóstico V3 guardado:"
  );

  console.log(
    ruta
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
    "No se modificó el archivo .shi."
  );

  console.log("");

  console.log(
    "Siguiente etapa:"
  );

  console.log(
    "convertir cada sistema real en rondas/pasadas/etapas antes de ordenar los tatamis."
  );

  console.log("");
}

// ============================================================
// INICIO
// ============================================================

ejecutar().catch(
  (error) => {
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
);