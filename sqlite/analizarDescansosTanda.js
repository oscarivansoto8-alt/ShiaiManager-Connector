require("dotenv").config();

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

// ============================================================
// ARGUMENTOS
// ============================================================

function obtenerTandaId() {
  const tandaId =
    Number(
      process.argv[2]
    );

  if (
    !Number.isInteger(tandaId) ||
    tandaId <= 0
  ) {
    throw new Error(
      "Debes indicar el ID de la tanda.\nEjemplo: node .\\sqlite\\analizarDescansosTanda.js 2"
    );
  }

  return tandaId;
}

function obtenerDescansoMinimo() {
  const argumento =
    process.argv[3];

  if (
    argumento === undefined
  ) {
    return 3;
  }

  const minimo =
    Number(
      argumento
    );

  if (
    !Number.isInteger(minimo) ||
    minimo < 0 ||
    minimo > 20
  ) {
    throw new Error(
      "El descanso mínimo debe ser un número entero entre 0 y 20."
    );
  }

  return minimo;
}

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(
    valor ?? ""
  ).trim();
}

function nombreCategoria(fila) {
  if (
    limpiar(
      fila.categoria_clave
    )
  ) {
    return limpiar(
      fila.categoria_clave
    );
  }

  return [
    limpiar(
      fila.registro_categoria
    ),
    limpiar(
      fila.categoria_peso
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

function nombreCompetidor(
  nombre,
  id
) {
  const nombreLimpio =
    limpiar(nombre);

  if (nombreLimpio) {
    return nombreLimpio;
  }

  if (
    Number.isInteger(
      Number(id)
    )
  ) {
    return `Competidor ${id}`;
  }

  return "DESCONOCIDO";
}

// ============================================================
// CARGAR TANDA
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
// CARGAR COMBATES SINCRONIZADOS
// ============================================================

async function cargarCombates(
  tanda
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      "combates_planificador"
    )
    .select(
      `
      id,
      campeonato_id,
      tanda_id,

      categoria_clave,
      registro_categoria,
      genero,
      categoria_peso,

      tatami_numero,
      categoria_orden,

      combate_numero,
      orden_combate,

      estado,

      azul_nombre,
      azul_club,
      blanco_nombre,
      blanco_club,

      judoshiai_category_index,
      judoshiai_match_number,
      judoshiai_blue_index,
      judoshiai_white_index
      `
    )
    .eq(
      "campeonato_id",
      tanda.campeonato_id
    )
    .eq(
      "tanda_id",
      tanda.id
    )
    .not(
      "judoshiai_category_index",
      "is",
      null
    )
    .not(
      "judoshiai_match_number",
      "is",
      null
    )
    .order(
      "tatami_numero",
      {
        ascending: true,
      }
    )
    .order(
      "categoria_orden",
      {
        ascending: true,
      }
    )
    .order(
      "orden_combate",
      {
        ascending: true,
      }
    );

  if (error) {
    throw new Error(
      error.message
    );
  }

  return data ?? [];
}

// ============================================================
// AGRUPAR POR TATAMI
// ============================================================

function agruparPorTatami(
  combates
) {
  const mapa =
    new Map();

  for (
    const combate
    of combates
  ) {
    const tatami =
      Number(
        combate.tatami_numero
      );

    if (
      !mapa.has(tatami)
    ) {
      mapa.set(
        tatami,
        []
      );
    }

    mapa
      .get(tatami)
      .push(combate);
  }

  return mapa;
}

// ============================================================
// ANALIZAR UN TATAMI
// ============================================================

function analizarTatami(
  numeroTatami,
  combates,
  descansoMinimo
) {
  /*
   * La posición es el orden actual
   * dentro de la cola planificada.
   *
   * Por ahora:
   *
   * categoria_orden
   *       ↓
   * orden_combate
   *
   * Más adelante nuestro optimizador
   * cambiará este orden.
   */

  const ordenados =
    [...combates].sort(
      (a, b) => {
        const diferenciaCategoria =
          Number(
            a.categoria_orden
          ) -
          Number(
            b.categoria_orden
          );

        if (
          diferenciaCategoria !== 0
        ) {
          return diferenciaCategoria;
        }

        return (
          Number(
            a.orden_combate
          ) -
          Number(
            b.orden_combate
          )
        );
      }
    );

  /*
   * Guarda la última aparición
   * de cada competidor.
   *
   * Clave:
   * ID real de JudoShiai.
   */

  const ultimaAparicion =
    new Map();

  const conflictos =
    [];

  const filas =
    [];

  let posicionGlobal =
    0;

  for (
    const combate
    of ordenados
  ) {
    posicionGlobal++;

    const categoria =
      nombreCategoria(
        combate
      );

    const azulId =
      Number(
        combate.judoshiai_blue_index
      );

    const blancoId =
      Number(
        combate.judoshiai_white_index
      );

    const azulNombre =
      nombreCompetidor(
        combate.azul_nombre,
        azulId
      );

    const blancoNombre =
      nombreCompetidor(
        combate.blanco_nombre,
        blancoId
      );

    const competidores = [
      {
        lado: "Azul",
        id: azulId,
        nombre:
          azulNombre,
      },
      {
        lado: "Blanco",
        id: blancoId,
        nombre:
          blancoNombre,
      },
    ];

    const advertenciasCombate =
      [];

    for (
      const competidor
      of competidores
    ) {
      if (
        !Number.isInteger(
          competidor.id
        ) ||
        competidor.id <= 0
      ) {
        advertenciasCombate.push(
          `${competidor.lado}: sin ID JudoShiai`
        );

        continue;
      }

      const anterior =
        ultimaAparicion.get(
          competidor.id
        );

      if (anterior) {
        /*
         * Ejemplo:
         *
         * anterior posición 1
         * actual posición 5
         *
         * combates entre medio:
         * 5 - 1 - 1 = 3
         */

        const combatesEntreMedio =
          posicionGlobal -
          anterior.posicion -
          1;

        if (
          combatesEntreMedio <
          descansoMinimo
        ) {
          const faltan =
            descansoMinimo -
            combatesEntreMedio;

          const conflicto = {
            tatami:
              numeroTatami,

            posicionActual:
              posicionGlobal,

            categoriaActual:
              categoria,

            combateActual:
              Number(
                combate.judoshiai_match_number
              ),

            competidorId:
              competidor.id,

            competidor:
              competidor.nombre,

            lado:
              competidor.lado,

            posicionAnterior:
              anterior.posicion,

            categoriaAnterior:
              anterior.categoria,

            combateAnterior:
              anterior.combate,

            descanso:
              combatesEntreMedio,

            minimo:
              descansoMinimo,

            faltan,
          };

          conflictos.push(
            conflicto
          );

          advertenciasCombate.push(
            `${competidor.nombre}: ${combatesEntreMedio}/${descansoMinimo}`
          );
        }
      }
    }

    let estado =
      "✅ OK";

    if (
      advertenciasCombate.length > 0
    ) {
      estado =
        `⚠️ ${advertenciasCombate.join(" | ")}`;
    }

    filas.push({
      Orden:
        posicionGlobal,

      Categoría:
        categoria,

      Combate:
        `#${combate.judoshiai_match_number}`,

      Blanco:
        blancoNombre,

      Azul:
        azulNombre,

      Estado:
        estado,
    });

    /*
     * Guardamos la aparición actual
     * DESPUÉS de comprobar ambos lados.
     */

    if (
      Number.isInteger(
        azulId
      ) &&
      azulId > 0
    ) {
      ultimaAparicion.set(
        azulId,
        {
          posicion:
            posicionGlobal,

          categoria,

          combate:
            Number(
              combate.judoshiai_match_number
            ),

          nombre:
            azulNombre,
        }
      );
    }

    if (
      Number.isInteger(
        blancoId
      ) &&
      blancoId > 0
    ) {
      ultimaAparicion.set(
        blancoId,
        {
          posicion:
            posicionGlobal,

          categoria,

          combate:
            Number(
              combate.judoshiai_match_number
            ),

          nombre:
            blancoNombre,
        }
      );
    }
  }

  return {
    tatami:
      numeroTatami,

    combates:
      ordenados.length,

    filas,

    conflictos,
  };
}

// ============================================================
// DETECTAR COMPETIDORES EN MÁS DE UN TATAMI
// ============================================================

function detectarCrucesTatamis(
  combates
) {
  const mapa =
    new Map();

  for (
    const combate
    of combates
  ) {
    const participantes = [
      {
        id:
          Number(
            combate.judoshiai_blue_index
          ),

        nombre:
          nombreCompetidor(
            combate.azul_nombre,
            combate.judoshiai_blue_index
          ),
      },
      {
        id:
          Number(
            combate.judoshiai_white_index
          ),

        nombre:
          nombreCompetidor(
            combate.blanco_nombre,
            combate.judoshiai_white_index
          ),
      },
    ];

    for (
      const participante
      of participantes
    ) {
      if (
        !Number.isInteger(
          participante.id
        ) ||
        participante.id <= 0
      ) {
        continue;
      }

      if (
        !mapa.has(
          participante.id
        )
      ) {
        mapa.set(
          participante.id,
          {
            id:
              participante.id,

            nombre:
              participante.nombre,

            tatamis:
              new Set(),

            categorias:
              new Set(),
          }
        );
      }

      const registro =
        mapa.get(
          participante.id
        );

      registro.tatamis.add(
        Number(
          combate.tatami_numero
        )
      );

      registro.categorias.add(
        nombreCategoria(
          combate
        )
      );
    }
  }

  return [...mapa.values()]
    .filter(
      (registro) =>
        registro.tatamis.size > 1
    )
    .map(
      (registro) => ({
        ID:
          registro.id,

        Competidor:
          registro.nombre,

        Tatamis:
          [...registro.tatamis]
            .sort(
              (a, b) =>
                a - b
            )
            .map(
              (tatami) =>
                `T${tatami}`
            )
            .join(", "),

        Categorías:
          [...registro.categorias]
            .join(", "),
      })
    );
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
    "          ANALIZAR DESCANSOS DE LA TANDA"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  const tandaId =
    obtenerTandaId();

  const descansoMinimo =
    obtenerDescansoMinimo();

  const tanda =
    await cargarTanda(
      tandaId
    );

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `ID: ${tanda.id}`
  );

  console.log(
    `Campeonato ID: ${tanda.campeonato_id}`
  );

  console.log(
    `Descanso mínimo configurado: ${descansoMinimo} combate(s) entre apariciones`
  );

  console.log("");

  const combates =
    await cargarCombates(
      tanda
    );

  console.log(
    `Combates sincronizados disponibles: ${combates.length}`
  );

  console.log("");

  if (
    combates.length === 0
  ) {
    console.log(
      "⚠️ No hay combates sincronizados para analizar."
    );

    console.log("");
    console.log(
      "Primero debes hacer sorteos en JudoShiai y ejecutar sincronizarCombatesSupabase.js."
    );

    console.log("");
    return;
  }

  const porTatami =
    agruparPorTatami(
      combates
    );

  const resultados =
    [];

  let conflictosTotales =
    0;

  const numerosTatami =
    [...porTatami.keys()]
      .sort(
        (a, b) =>
          a - b
      );

  for (
    const tatami
    of numerosTatami
  ) {
    const resultado =
      analizarTatami(
        tatami,
        porTatami.get(
          tatami
        ),
        descansoMinimo
      );

    resultados.push(
      resultado
    );

    conflictosTotales +=
      resultado.conflictos.length;

    console.log(
      "============================================================"
    );

    console.log(
      `🥋 TATAMI ${tatami}`
    );

    console.log(
      `Combates analizados: ${resultado.combates}`
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
      resultado.conflictos.length === 0
    ) {
      console.log(
        "✅ Sin conflictos de descanso en este tatami."
      );
    } else {
      console.log(
        `⚠️ Conflictos detectados: ${resultado.conflictos.length}`
      );

      console.log("");

      console.table(
        resultado.conflictos.map(
          (conflicto) => ({
            Competidor:
              conflicto.competidor,

            ID:
              conflicto.competidorId,

            "Combate anterior":
              `${conflicto.categoriaAnterior} #${conflicto.combateAnterior}`,

            "Combate actual":
              `${conflicto.categoriaActual} #${conflicto.combateActual}`,

            Descanso:
              conflicto.descanso,

            Mínimo:
              conflicto.minimo,

            Faltan:
              conflicto.faltan,
          })
        )
      );
    }

    console.log("");
  }

  // ==========================================================
  // CRUCES ENTRE TATAMIS
  // ==========================================================

  const crucesTatamis =
    detectarCrucesTatamis(
      combates
    );

  console.log(
    "============================================================"
  );

  console.log(
    "        COMPETIDORES PRESENTES EN VARIOS TATAMIS"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  if (
    crucesTatamis.length === 0
  ) {
    console.log(
      "✅ Ningún competidor sincronizado aparece en más de un tatami."
    );
  } else {
    console.log(
      "⚠️ Estos competidores aparecen en más de un tatami."
    );

    console.log(
      "El descanso por cantidad de combates no puede garantizarse únicamente mirando una cola individual."
    );

    console.log("");

    console.table(
      crucesTatamis
    );
  }

  console.log("");

  // ==========================================================
  // RESUMEN
  // ==========================================================

  console.log(
    "============================================================"
  );

  console.log(
    "                    RESUMEN"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `Combates analizados: ${combates.length}`
  );

  console.log(
    `Tatamis con combates sincronizados: ${resultados.length}`
  );

  console.log(
    `Descanso mínimo: ${descansoMinimo}`
  );

  console.log(
    `Conflictos detectados: ${conflictosTotales}`
  );

  console.log(
    `Competidores en varios tatamis: ${crucesTatamis.length}`
  );

  console.log("");

  if (
    conflictosTotales === 0 &&
    crucesTatamis.length === 0
  ) {
    console.log(
      "✅ EL ORDEN ACTUAL CUMPLE EL DESCANSO CONFIGURADO."
    );
  } else {
    console.log(
      "⚠️ EL ORDEN ACTUAL NECESITA REORGANIZACIÓN."
    );

    console.log("");

    console.log(
      "El siguiente paso será calcular un nuevo orden sin modificar JudoShiai."
    );
  }

  console.log("");

  console.log(
    "🔒 MODO SOLO LECTURA"
  );

  console.log(
    "No se modificó Supabase."
  );

  console.log(
    "No se modificó JudoShiai."
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