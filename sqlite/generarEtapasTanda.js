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

// IMPORTANTE:
// seguimos trabajando solamente con la copia de prueba.
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
        "node .\\sqlite\\generarEtapasTanda.js 2",
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

function nombrePersona(
  persona
) {
  if (!persona) {
    return "?";
  }

  return [
    limpiar(persona.first),
    limpiar(persona.last),
  ]
    .filter(Boolean)
    .join(" ");
}

function selloFecha() {
  const fecha =
    new Date();

  const pad = (n) =>
    String(n)
      .padStart(2, "0");

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

function ordenarMatches(
  matches
) {
  return [...matches]
    .sort(
      (a, b) =>
        Number(a.number) -
        Number(b.number)
    );
}

// ============================================================
// VALIDAR NUMERACIÓN OFICIAL
// ============================================================

function validarNumeracionContinua(
  categoria,
  matches
) {
  const ordenados =
    ordenarMatches(matches);

  for (
    let i = 0;
    i < ordenados.length;
    i++
  ) {
    const esperado =
      i + 1;

    const real =
      Number(
        ordenados[i].number
      );

    if (
      real !== esperado
    ) {
      throw new Error(
        [
          `${categoria.categoria}:`,
          `la numeración de combates no es continua.`,
          `Se esperaba #${esperado}`,
          `pero apareció #${real}.`,
          "",
          "No se modificó nada.",
        ].join(" ")
      );
    }
  }

  return ordenados;
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
// DISTRIBUCIÓN
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
      "La tanda no tiene categorías distribuidas."
    );
  }

  return data;
}

// ============================================================
// DETECTAR TIPO DE SISTEMA
// ============================================================

function detectarTipo(
  categoria
) {
  const sistema =
    Number(
      categoria.system
    ) || 0;

  const competidores =
    Number(
      categoria.competidores
    ) || 0;

  if (
    competidores <= 1
  ) {
    return "CLASIFICACION_DIRECTA";
  }

  // Pool / Liga
  if (
    sistema === 1
  ) {
    return "TODOS_CONTRA_TODOS";
  }

  // Best of 3
  if (
    sistema === 11
  ) {
    return "MEJOR_DE_3";
  }

  // Llaves French
  if (
    sistema >= 3 &&
    sistema <= 8
  ) {
    return "ELIMINATORIA";
  }

  // Pools + fase final
  if (
    [
      2,
      9,
      10,
      12,
    ].includes(sistema)
  ) {
    return "POOLS_CON_FASE_FINAL";
  }

  if (
    sistema === 13
  ) {
    return "PERSONALIZADO";
  }

  return "REVISAR";
}

// ============================================================
// LEER ARCHIVO .SHI
// ============================================================

function leerShi(
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
    // CATEGORÍAS
    // --------------------------------------------------------

    const categorias =
      db.prepare(`
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
            FROM competitors p
            WHERE
              p.category = c.category
              AND (
                COALESCE(
                  p.deleted,
                  0
                ) & 1
              ) = 0
          ) AS competidores

        FROM categories c

        WHERE
          (
            COALESCE(
              c.deleted,
              0
            ) & 1
          ) = 0
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
    // COMPETIDORES
    // --------------------------------------------------------

    const competidores =
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
      `)
        .all();

    const competidoresPorId =
      new Map();

    for (
      const persona
      of competidores
    ) {
      competidoresPorId.set(
        Number(
          persona.id
        ),
        persona
      );
    }

    // --------------------------------------------------------
    // MATCHES
    // --------------------------------------------------------

    const matches =
      db.prepare(`
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
        .get(categoriaId)
        .push(match);
    }

    return {
      categorias,
      competidoresPorId,
      matchesPorCategoria,
    };
  } finally {
    db.close();
  }
}

// ============================================================
// OBTENER PARTICIPANTES REALES DESDE LOS MATCHES
// ============================================================

function obtenerParticipantes(
  matches
) {
  const resultado = [];
  const vistos =
    new Set();

  for (
    const match
    of matches
  ) {
    for (
      const valor
      of [
        match.blue,
        match.white,
      ]
    ) {
      const id =
        Number(valor);

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        continue;
      }

      if (
        vistos.has(id)
      ) {
        continue;
      }

      vistos.add(id);

      resultado.push(id);
    }
  }

  return resultado;
}

// ============================================================
// CONVERTIR MATCH REAL A FORMATO V3
//
// Recordatorio de nuestra comprobación:
// visualmente en JudoShiai:
//
// Blanco = match.blue
// Azul   = match.white
// ============================================================

function convertirMatch(
  match,
  personas
) {
  const blancoId =
    Number(
      match.blue
    );

  const azulId =
    Number(
      match.white
    );

  const blanco =
    personas.get(
      blancoId
    );

  const azul =
    personas.get(
      azulId
    );

  if (!blanco) {
    throw new Error(
      `No se encontró competidor ID ${blancoId}.`
    );
  }

  if (!azul) {
    throw new Error(
      `No se encontró competidor ID ${azulId}.`
    );
  }

  return {
    judoshiai_category_index:
      Number(
        match.category
      ),

    judoshiai_match_number:
      Number(
        match.number
      ),

    blanco_id:
      blancoId,

    blanco:
      nombrePersona(
        blanco
      ),

    azul_id:
      azulId,

    azul:
      nombrePersona(
        azul
      ),
  };
}

// ============================================================
// VALIDAR UNA PASADA
//
// Dentro de una misma pasada:
//
// - un atleta no puede pelear 2 veces
// - los combates respetan #1, #2, #3...
// ============================================================

function validarPasada(
  categoria,
  numeroPasada,
  matches
) {
  const usados =
    new Set();

  for (
    const match
    of matches
  ) {
    const blanco =
      Number(
        match.blue
      );

    const azul =
      Number(
        match.white
      );

    for (
      const atleta
      of [
        blanco,
        azul,
      ]
    ) {
      if (
        usados.has(
          atleta
        )
      ) {
        throw new Error(
          [
            `${categoria.categoria}:`,
            `la Pasada ${numeroPasada}`,
            `no puede formarse respetando el orden oficial.`,
            "",
            `El competidor ID ${atleta}`,
            "aparecería dos veces en la misma pasada.",
            "",
            "No se reordenaron los números de JudoShiai.",
            "Hay que revisar este sistema antes de continuar.",
          ].join(" ")
        );
      }

      usados.add(
        atleta
      );
    }
  }

  return usados;
}

// ============================================================
// TODOS CONTRA TODOS
//
// NUEVA REGLA:
//
// RESPETAMOS EL ORDEN OFICIAL.
//
// Ejemplo 4 competidores:
//
// Pasada 1:
// #1
// #2
//
// Pasada 2:
// #3
// #4
//
// Pasada 3:
// #5
// #6
//
// Solo se acepta si dentro de cada pasada
// ningún atleta se repite.
// ============================================================

function generarPasadasPool(
  categoria,
  matches,
  personas
) {
  const ordenados =
    validarNumeracionContinua(
      categoria,
      matches
    );

  const participantes =
    obtenerParticipantes(
      ordenados
    );

  const cantidadCompetidores =
    participantes.length;

  if (
    cantidadCompetidores < 3
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `se detectaron ${cantidadCompetidores} participantes`,
        "en un sistema todos-contra-todos.",
      ].join(" ")
    );
  }

  // ----------------------------------------------------------
  // CANTIDAD DE COMBATES ESPERADA
  // ----------------------------------------------------------

  const combatesEsperados =
    (
      cantidadCompetidores *
      (
        cantidadCompetidores -
        1
      )
    ) / 2;

  if (
    ordenados.length !==
    combatesEsperados
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `con ${cantidadCompetidores} competidores`,
        `se esperaban ${combatesEsperados} combates,`,
        `pero JudoShiai tiene ${ordenados.length}.`,
        "",
        "No se modificó nada.",
      ].join(" ")
    );
  }

  // ----------------------------------------------------------
  // COMBATES POR PASADA
  //
  // 3 personas → 1
  // 4 personas → 2
  // 5 personas → 2
  // 6 personas → 3
  // ----------------------------------------------------------

  const combatesPorPasada =
    Math.floor(
      cantidadCompetidores /
      2
    );

  // ----------------------------------------------------------
  // CANTIDAD DE PASADAS
  //
  // par:
  // n - 1
  //
  // impar:
  // n
  // ----------------------------------------------------------

  const cantidadPasadas =
    cantidadCompetidores % 2 === 0
      ? cantidadCompetidores - 1
      : cantidadCompetidores;

  const etapas = [];

  let indiceMatch = 0;

  for (
    let pasada = 1;
    pasada <= cantidadPasadas;
    pasada++
  ) {
    const matchesPasada =
      ordenados.slice(
        indiceMatch,
        indiceMatch +
          combatesPorPasada
      );

    if (
      matchesPasada.length !==
      combatesPorPasada
    ) {
      throw new Error(
        [
          `${categoria.categoria}:`,
          `la Pasada ${pasada}`,
          "quedó incompleta.",
        ].join(" ")
      );
    }

    const atletasUsados =
      validarPasada(
        categoria,
        pasada,
        matchesPasada
      );

    // --------------------------------------------------------
    // SI LA CANTIDAD ES IMPAR,
    // DETECTAMOS QUIÉN DESCANSA.
    // --------------------------------------------------------

    let descansaId =
      null;

    let descansaNombre =
      null;

    if (
      cantidadCompetidores % 2 !== 0
    ) {
      const libres =
        participantes.filter(
          (id) =>
            !atletasUsados.has(
              id
            )
        );

      if (
        libres.length !== 1
      ) {
        throw new Error(
          [
            `${categoria.categoria}:`,
            `en la Pasada ${pasada}`,
            `se esperaba exactamente 1 competidor descansando,`,
            `pero se detectaron ${libres.length}.`,
          ].join(" ")
        );
      }

      descansaId =
        libres[0];

      descansaNombre =
        nombrePersona(
          personas.get(
            descansaId
          )
        );
    }

    etapas.push({
      numero:
        pasada,

      tipo:
        "PASADA_POOL",

      nombre:
        `Pasada ${pasada}`,

      orden_oficial:
        true,

      primer_match:
        Number(
          matchesPasada[0]
            .number
        ),

      ultimo_match:
        Number(
          matchesPasada[
            matchesPasada.length -
            1
          ].number
        ),

      descansa_id:
        descansaId,

      descansa:
        descansaNombre,

      combates:
        matchesPasada.map(
          (match) =>
            convertirMatch(
              match,
              personas
            )
        ),
    });

    indiceMatch +=
      combatesPorPasada;
  }

  // ----------------------------------------------------------
  // VERIFICACIÓN FINAL
  // ----------------------------------------------------------

  if (
    indiceMatch !==
    ordenados.length
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `se utilizaron ${indiceMatch} combates`,
        `de ${ordenados.length}.`,
      ].join(" ")
    );
  }

  return etapas;
}

// ============================================================
// MEJOR DE 3
//
// Aquí también respetamos:
//
// #1
// #2
// #3
//
// No cambiamos los números.
//
// El planificador futuro decidirá qué peleas
// de otras categorías van ENTRE ellos.
// ============================================================

function generarEtapasMejorDe3(
  categoria,
  matches,
  personas
) {
  const ordenados =
    validarNumeracionContinua(
      categoria,
      matches
    );

  if (
    ordenados.length !== 3
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        "Mejor de 3 debería tener 3 combates preparados.",
        `JudoShiai tiene ${ordenados.length}.`,
      ].join(" ")
    );
  }

  // ----------------------------------------------------------
  // VALIDAR QUE SEAN LOS MISMOS DOS COMPETIDORES
  // ----------------------------------------------------------

  const primeraPareja =
    [
      Number(
        ordenados[0].blue
      ),
      Number(
        ordenados[0].white
      ),
    ].sort(
      (a, b) =>
        a - b
    );

  for (
    const match
    of ordenados
  ) {
    const pareja =
      [
        Number(
          match.blue
        ),
        Number(
          match.white
        ),
      ].sort(
        (a, b) =>
          a - b
      );

    if (
      pareja[0] !==
        primeraPareja[0] ||
      pareja[1] !==
        primeraPareja[1]
    ) {
      throw new Error(
        [
          `${categoria.categoria}:`,
          "los tres combates de Mejor de 3",
          "no contienen la misma pareja.",
        ].join(" ")
      );
    }
  }

  return ordenados.map(
    (
      match,
      indice
    ) => ({
      numero:
        indice + 1,

      tipo:
        "MEJOR_DE_3",

      nombre:
        `Combate ${indice + 1}`,

      orden_oficial:
        true,

      condicional:
        indice === 2,

      descripcion:
        indice === 2
          ? "Solo se realiza si la serie queda 1-1"
          : "Combate de la serie",

      combates: [
        convertirMatch(
          match,
          personas
        ),
      ],
    })
  );
}

// ============================================================
// GENERAR ETAPAS SEGÚN TIPO
// ============================================================

function generarEtapasCategoria(
  categoria,
  matches,
  personas
) {
  const tipo =
    detectarTipo(
      categoria
    );

  // ----------------------------------------------------------
  // CLASIFICACIÓN DIRECTA
  // ----------------------------------------------------------

  if (
    tipo ===
    "CLASIFICACION_DIRECTA"
  ) {
    return {
      tipo,

      estado:
        "LISTO",

      etapas: [],
    };
  }

  // ----------------------------------------------------------
  // TODOS CONTRA TODOS
  // ----------------------------------------------------------

  if (
    tipo ===
    "TODOS_CONTRA_TODOS"
  ) {
    if (
      matches.length === 0
    ) {
      return {
        tipo,

        estado:
          "ESPERANDO_SORTEO",

        etapas: [],
      };
    }

    return {
      tipo,

      estado:
        "LISTO",

      etapas:
        generarPasadasPool(
          categoria,
          matches,
          personas
        ),
    };
  }

  // ----------------------------------------------------------
  // MEJOR DE 3
  // ----------------------------------------------------------

  if (
    tipo ===
    "MEJOR_DE_3"
  ) {
    if (
      matches.length === 0
    ) {
      return {
        tipo,

        estado:
          "ESPERANDO_SORTEO",

        etapas: [],
      };
    }

    return {
      tipo,

      estado:
        "LISTO",

      etapas:
        generarEtapasMejorDe3(
          categoria,
          matches,
          personas
        ),
    };
  }

  // ----------------------------------------------------------
  // ELIMINATORIAS
  //
  // TODAVÍA NO INVENTAMOS RONDAS.
  //
  // Próximo paso:
  //
  // primera ronda
  // octavos
  // cuartos
  // semifinal
  // repechaje
  // bronce
  // final
  // ----------------------------------------------------------

  if (
    tipo ===
      "ELIMINATORIA" ||
    tipo ===
      "POOLS_CON_FASE_FINAL" ||
    tipo ===
      "PERSONALIZADO"
  ) {
    return {
      tipo,

      estado:
        "PENDIENTE_MAPEO_DE_RONDAS",

      etapas: [],
    };
  }

  return {
    tipo,

    estado:
      "REVISAR",

    etapas: [],
  };
}

// ============================================================
// GUARDAR RESULTADO
// ============================================================

function guardarResultado(
  tanda,
  categorias
) {
  fs.mkdirSync(
    carpetaPropuestas,
    {
      recursive: true,
    }
  );

  const contenido = {
    generado_en:
      new Date()
        .toISOString(),

    version:
      "v3_etapas_orden_oficial",

    modo:
      "solo_lectura",

    reglas: {
      respetar_numero_judoshiai:
        true,

      alterar_match_number:
        false,

      pool:
        "Las pasadas se forman usando #1,#2... en orden oficial",

      mejor_de_3:
        "#1 → descanso → #2 → descanso → #3 condicional",

      eliminatorias:
        "Pendientes de mapeo real de rondas",
    },

    tanda,

    categorias,
  };

  const ruta =
    path.resolve(
      carpetaPropuestas,
      `etapas-tanda-${tanda.id}-${selloFecha()}.json`
    );

  const rutaLatest =
    path.resolve(
      carpetaPropuestas,
      `etapas-tanda-${tanda.id}-latest.json`
    );

  const texto =
    JSON.stringify(
      contenido,
      null,
      2
    );

  fs.writeFileSync(
    ruta,
    texto,
    "utf8"
  );

  fs.writeFileSync(
    rutaLatest,
    texto,
    "utf8"
  );

  return {
    ruta,
    rutaLatest,
  };
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
    "   PLANIFICADOR V3 — ETAPAS EN ORDEN OFICIAL"
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

  const datos =
    leerShi(
      distribucion
    );

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

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `Tanda ID: ${tanda.id}`
  );

  console.log(
    `Categorías: ${datos.categorias.length}`
  );

  console.log("");

  console.log(
    "✅ Se respetará el número oficial de JudoShiai."
  );

  console.log(
    "✅ Los #1, #2, #3... NO serán modificados."
  );

  console.log("");

  // ==========================================================
  // ORDENAR CATEGORÍAS POR TATAMI
  // ==========================================================

  const categoriasOrdenadas =
    [...datos.categorias]
      .sort(
        (a, b) => {
          const da =
            distribucionPorId.get(
              Number(a.id)
            );

          const db =
            distribucionPorId.get(
              Number(b.id)
            );

          const tatamiA =
            Number(
              da?.tatami_numero
            ) || 0;

          const tatamiB =
            Number(
              db?.tatami_numero
            ) || 0;

          if (
            tatamiA !==
            tatamiB
          ) {
            return (
              tatamiA -
              tatamiB
            );
          }

          return (
            Number(
              da?.orden
            ) -
            Number(
              db?.orden
            )
          );
        }
      );

  const resultadoCategorias =
    [];

  // ==========================================================
  // GENERAR ETAPAS
  // ==========================================================

  for (
    const categoria
    of categoriasOrdenadas
  ) {
    const distribucionCategoria =
      distribucionPorId.get(
        Number(
          categoria.id
        )
      );

    if (
      !distribucionCategoria
    ) {
      throw new Error(
        `No existe distribución para categoría ID ${categoria.id}.`
      );
    }

    const tatami =
      Number(
        distribucionCategoria.tatami_numero
      );

    const matches =
      datos.matchesPorCategoria.get(
        Number(
          categoria.id
        )
      ) || [];

    const generado =
      generarEtapasCategoria(
        categoria,
        matches,
        datos.competidoresPorId
      );

    resultadoCategorias.push({
      judoshiai_index:
        Number(
          categoria.id
        ),

      categoria:
        categoria.categoria,

      tatami,

      competidores:
        Number(
          categoria.competidores
        ),

      wishsys:
        Number(
          categoria.wishsys
        ),

      sistema_interno:
        Number(
          categoria.system
        ),

      tabla:
        Number(
          categoria.tabla
        ),

      tipo:
        generado.tipo,

      estado:
        generado.estado,

      combates:
        matches.length,

      etapas:
        generado.etapas,
    });
  }

  // ==========================================================
  // TATAMIS
  // ==========================================================

  const tatamis =
    [
      ...new Set(
        resultadoCategorias.map(
          (categoria) =>
            categoria.tatami
        )
      ),
    ]
      .sort(
        (a, b) =>
          a - b
      );

  // ==========================================================
  // MOSTRAR RESULTADO
  // ==========================================================

  for (
    const tatami
    of tatamis
  ) {
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

    const categoriasTatami =
      resultadoCategorias.filter(
        (categoria) =>
          categoria.tatami ===
          tatami
      );

    for (
      const categoria
      of categoriasTatami
    ) {
      console.log(
        `📂 ${categoria.categoria}`
      );

      console.log(
        `   Tipo: ${categoria.tipo}`
      );

      console.log(
        `   Competidores: ${categoria.competidores}`
      );

      console.log(
        `   Combates: ${categoria.combates}`
      );

      console.log(
        `   Estado: ${categoria.estado}`
      );

      console.log(
        `   Etapas: ${categoria.etapas.length}`
      );

      console.log("");

      for (
        const etapa
        of categoria.etapas
      ) {
        console.log(
          `   ── ${etapa.nombre}`
        );

        if (
          etapa.primer_match &&
          etapa.ultimo_match
        ) {
          console.log(
            `      Orden oficial: #${etapa.primer_match} → #${etapa.ultimo_match}`
          );
        }

        if (
          etapa.descansa
        ) {
          console.log(
            `      Descansa: ${etapa.descansa}`
          );
        }

        if (
          etapa.condicional
        ) {
          console.log(
            `      ⚠️ ${etapa.descripcion}`
          );
        }

        console.table(
          etapa.combates.map(
            (combate) => ({
              Combate:
                `#${combate.judoshiai_match_number}`,

              Blanco:
                combate.blanco,

              Azul:
                combate.azul,
            })
          )
        );
      }

      console.log("");
    }
  }

  // ==========================================================
  // VALIDACIÓN GENERAL
  // ==========================================================

  let categoriasListas = 0;

  let categoriasPendientes = 0;

  let combatesEnEtapas = 0;

  let pools = 0;

  let mejorDe3 = 0;

  let eliminatorias = 0;

  for (
    const categoria
    of resultadoCategorias
  ) {
    if (
      categoria.estado ===
      "LISTO"
    ) {
      categoriasListas++;
    } else {
      categoriasPendientes++;
    }

    if (
      categoria.tipo ===
      "TODOS_CONTRA_TODOS"
    ) {
      pools++;
    }

    if (
      categoria.tipo ===
      "MEJOR_DE_3"
    ) {
      mejorDe3++;
    }

    if (
      categoria.tipo ===
      "ELIMINATORIA"
    ) {
      eliminatorias++;
    }

    for (
      const etapa
      of categoria.etapas
    ) {
      combatesEnEtapas +=
        etapa.combates.length;
    }
  }

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
    `Categorías procesadas: ${resultadoCategorias.length}`
  );

  console.log(
    `Todos contra todos: ${pools}`
  );

  console.log(
    `Mejor de 3: ${mejorDe3}`
  );

  console.log(
    `Eliminatorias: ${eliminatorias}`
  );

  console.log("");

  console.log(
    `Categorías listas: ${categoriasListas}`
  );

  console.log(
    `Categorías pendientes: ${categoriasPendientes}`
  );

  console.log(
    `Combates incluidos en etapas: ${combatesEnEtapas}`
  );

  console.log("");

  // ==========================================================
  // GUARDAR
  // ==========================================================

  const archivos =
    guardarResultado(
      tanda,
      resultadoCategorias
    );

  console.log(
    "💾 Etapas guardadas:"
  );

  console.log(
    archivos.ruta
  );

  console.log("");

  console.log(
    "💾 Última propuesta:"
  );

  console.log(
    archivos.rutaLatest
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