require("dotenv").config();

const fs = require("fs");
const path = require("path");
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

const carpetaPropuestas = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "propuestas"
);

// Hasta 12 combates usamos búsqueda exacta.
// Sobre 12 usamos búsqueda heurística.
const LIMITE_BUSQUEDA_EXACTA = 12;

const ANCHO_BEAM = 5000;

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
      "Debes indicar el ID de la tanda.\n" +
      "Ejemplo: node .\\sqlite\\optimizarOrdenTanda.js 2 3"
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

  const descanso =
    Number(argumento);

  if (
    !Number.isInteger(descanso) ||
    descanso < 0 ||
    descanso > 20
  ) {
    throw new Error(
      "El descanso mínimo debe ser un número entero entre 0 y 20."
    );
  }

  return descanso;
}

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function nombreCategoria(combate) {
  const registro =
    limpiar(
      combate.registro_categoria
    );

  const peso =
    limpiar(
      combate.categoria_peso
    );

  if (
    registro ||
    peso
  ) {
    return [
      registro,
      peso,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return limpiar(
    combate.categoria_clave
  );
}

function nombreCompetidor(
  nombre,
  id
) {
  const limpio =
    limpiar(nombre);

  if (limpio) {
    return limpio;
  }

  if (
    Number.isInteger(Number(id))
  ) {
    return `Competidor ${id}`;
  }

  return "DESCONOCIDO";
}

function participantes(combate) {
  return [
    Number(
      combate.judoshiai_blue_index
    ),
    Number(
      combate.judoshiai_white_index
    ),
  ].filter(
    (id) =>
      Number.isInteger(id) &&
      id > 0
  );
}

function compararPuntajes(
  a,
  b
) {
  if (
    a.conflictos !==
    b.conflictos
  ) {
    return (
      a.conflictos -
      b.conflictos
    );
  }

  if (
    a.deficit !==
    b.deficit
  ) {
    return (
      a.deficit -
      b.deficit
    );
  }

  if (
    a.repeticionCategoria !==
    b.repeticionCategoria
  ) {
    return (
      a.repeticionCategoria -
      b.repeticionCategoria
    );
  }

  return 0;
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
// CARGAR COMBATES
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

      sistema,
      ronda_numero,
      ronda_nombre,

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
// VALIDAR COMBATES
// ============================================================

function validarCombates(
  combates
) {
  for (
    const combate
    of combates
  ) {
    if (
      combate.estado !==
      "pendiente"
    ) {
      throw new Error(
        `El combate Supabase ID ${combate.id} está en estado "${combate.estado}". ` +
        "Esta versión solamente reorganiza combates pendientes."
      );
    }

    if (
      combate.sistema !==
      "todos_contra_todos"
    ) {
      throw new Error(
        `${nombreCategoria(combate)} utiliza sistema "${combate.sistema}". ` +
        "Esta primera versión segura solo optimiza todos contra todos."
      );
    }

    const azul =
      Number(
        combate.judoshiai_blue_index
      );

    const blanco =
      Number(
        combate.judoshiai_white_index
      );

    if (
      !Number.isInteger(azul) ||
      azul <= 0 ||
      !Number.isInteger(blanco) ||
      blanco <= 0
    ) {
      throw new Error(
        `${nombreCategoria(combate)} #${combate.judoshiai_match_number} no tiene IDs válidos de JudoShiai.`
      );
    }
  }
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
// ORDEN ACTUAL
// ============================================================

function obtenerOrdenActual(
  combates
) {
  return [...combates]
    .sort(
      (a, b) => {
        const categoria =
          Number(
            a.categoria_orden
          ) -
          Number(
            b.categoria_orden
          );

        if (
          categoria !== 0
        ) {
          return categoria;
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
}

// ============================================================
// ANALIZAR UNA SECUENCIA
// ============================================================

function analizarSecuencia(
  orden,
  descansoMinimo
) {
  const ultimaAparicion =
    new Map();

  const conflictos =
    [];

  const filas =
    [];

  let deficitTotal =
    0;

  for (
    let posicion = 0;
    posicion < orden.length;
    posicion++
  ) {
    const combate =
      orden[posicion];

    const azulId =
      Number(
        combate.judoshiai_blue_index
      );

    const blancoId =
      Number(
        combate.judoshiai_white_index
      );

    const lista = [
      {
        id:
          azulId,

        lado:
          "Azul",

        nombre:
          nombreCompetidor(
            combate.azul_nombre,
            azulId
          ),
      },
      {
        id:
          blancoId,

        lado:
          "Blanco",

        nombre:
          nombreCompetidor(
            combate.blanco_nombre,
            blancoId
          ),
      },
    ];

    const advertencias =
      [];

    for (
      const participante
      of lista
    ) {
      const anterior =
        ultimaAparicion.get(
          participante.id
        );

      if (anterior) {
        const descanso =
          posicion -
          anterior.posicion -
          1;

        if (
          descanso <
          descansoMinimo
        ) {
          const faltan =
            descansoMinimo -
            descanso;

          deficitTotal +=
            faltan;

          conflictos.push({
            participante:
              participante.nombre,

            participanteId:
              participante.id,

            posicionAnterior:
              anterior.posicion + 1,

            posicionActual:
              posicion + 1,

            categoriaAnterior:
              anterior.categoria,

            combateAnterior:
              anterior.combate,

            categoriaActual:
              nombreCategoria(
                combate
              ),

            combateActual:
              Number(
                combate.judoshiai_match_number
              ),

            descanso,

            minimo:
              descansoMinimo,

            faltan,
          });

          advertencias.push(
            `${participante.nombre}: ${descanso}/${descansoMinimo}`
          );
        }
      }
    }

    filas.push({
      nuevoOrden:
        posicion + 1,

      combate,

      estado:
        advertencias.length === 0
          ? "✅ OK"
          : `⚠️ ${advertencias.join(" | ")}`,
    });

    ultimaAparicion.set(
      azulId,
      {
        posicion,

        categoria:
          nombreCategoria(
            combate
          ),

        combate:
          Number(
            combate.judoshiai_match_number
          ),
      }
    );

    ultimaAparicion.set(
      blancoId,
      {
        posicion,

        categoria:
          nombreCategoria(
            combate
          ),

        combate:
          Number(
            combate.judoshiai_match_number
          ),
      }
    );
  }

  return {
    conflictos:
      conflictos.length,

    deficit:
      deficitTotal,

    detalles:
      conflictos,

    filas,
  };
}

// ============================================================
// COSTO INCREMENTAL
// ============================================================

function calcularCostoIncremental(
  candidatoIndice,
  ultimosIndices,
  combates,
  descansoMinimo
) {
  const candidato =
    combates[
      candidatoIndice
    ];

  const ids =
    participantes(
      candidato
    );

  let conflictos = 0;
  let deficit = 0;

  for (
    const id
    of ids
  ) {
    /*
     * Solo necesitamos mirar los últimos
     * "descansoMinimo" combates.
     */

    for (
      let i =
        ultimosIndices.length - 1;
      i >= 0;
      i--
    ) {
      const indiceAnterior =
        ultimosIndices[i];

      const anterior =
        combates[
          indiceAnterior
        ];

      if (
        participantes(anterior)
          .includes(id)
      ) {
        const distancia =
          ultimosIndices.length -
          i;

        const descanso =
          distancia - 1;

        if (
          descanso <
          descansoMinimo
        ) {
          conflictos++;

          deficit +=
            descansoMinimo -
            descanso;
        }

        break;
      }
    }
  }

  let repeticionCategoria =
    0;

  if (
    ultimosIndices.length > 0
  ) {
    const anterior =
      combates[
        ultimosIndices[
          ultimosIndices.length - 1
        ]
      ];

    if (
      anterior.judoshiai_category_index ===
      candidato.judoshiai_category_index
    ) {
      repeticionCategoria = 1;
    }
  }

  return {
    conflictos,
    deficit,
    repeticionCategoria,
  };
}

// ============================================================
// BÚSQUEDA EXACTA
// ============================================================

function optimizarExacto(
  combates,
  descansoMinimo
) {
  const cantidad =
    combates.length;

  const mascaraCompleta =
    (1n << BigInt(cantidad)) -
    1n;

  const memo =
    new Map();

  let estadosExplorados =
    0;

  function resolver(
    mascara,
    ultimos
  ) {
    if (
      mascara ===
      mascaraCompleta
    ) {
      return {
        conflictos: 0,
        deficit: 0,
        repeticionCategoria: 0,
        siguiente: -1,
      };
    }

    const clave =
      `${mascara.toString()}|${ultimos.join(",")}`;

    const guardado =
      memo.get(clave);

    if (guardado) {
      return guardado;
    }

    estadosExplorados++;

    let mejor = null;

    for (
      let indice = 0;
      indice < cantidad;
      indice++
    ) {
      const bit =
        1n << BigInt(indice);

      if (
        (mascara & bit) !== 0n
      ) {
        continue;
      }

      const costo =
        calcularCostoIncremental(
          indice,
          ultimos,
          combates,
          descansoMinimo
        );

      const nuevosUltimos =
        [
          ...ultimos,
          indice,
        ].slice(
          -descansoMinimo
        );

      const futuro =
        resolver(
          mascara | bit,
          nuevosUltimos
        );

      const candidato = {
        conflictos:
          costo.conflictos +
          futuro.conflictos,

        deficit:
          costo.deficit +
          futuro.deficit,

        repeticionCategoria:
          costo.repeticionCategoria +
          futuro.repeticionCategoria,

        siguiente:
          indice,
      };

      if (
        !mejor ||
        compararPuntajes(
          candidato,
          mejor
        ) < 0
      ) {
        mejor =
          candidato;
      }
    }

    memo.set(
      clave,
      mejor
    );

    return mejor;
  }

  const resultado =
    resolver(
      0n,
      []
    );

  const ordenIndices =
    [];

  let mascara =
    0n;

  let ultimos =
    [];

  while (
    mascara !==
    mascaraCompleta
  ) {
    const clave =
      `${mascara.toString()}|${ultimos.join(",")}`;

    const estado =
      memo.get(clave);

    if (
      !estado ||
      estado.siguiente < 0
    ) {
      break;
    }

    const indice =
      estado.siguiente;

    ordenIndices.push(
      indice
    );

    mascara |=
      1n << BigInt(indice);

    ultimos =
      [
        ...ultimos,
        indice,
      ].slice(
        -descansoMinimo
      );
  }

  const orden =
    ordenIndices.map(
      (indice) =>
        combates[indice]
    );

  return {
    metodo:
      "EXACTO",

    garantizaOptimo:
      true,

    estadosExplorados,

    orden,

    conflictos:
      resultado.conflictos,

    deficit:
      resultado.deficit,
  };
}

// ============================================================
// BÚSQUEDA HEURÍSTICA BEAM
// ============================================================

function optimizarBeam(
  combates,
  descansoMinimo
) {
  const cantidad =
    combates.length;

  let estados = [
    {
      mascara:
        0n,

      ultimos:
        [],

      secuencia:
        [],

      conflictos:
        0,

      deficit:
        0,

      repeticionCategoria:
        0,
    },
  ];

  let estadosExplorados =
    0;

  for (
    let paso = 0;
    paso < cantidad;
    paso++
  ) {
    const candidatos =
      new Map();

    for (
      const estado
      of estados
    ) {
      for (
        let indice = 0;
        indice < cantidad;
        indice++
      ) {
        const bit =
          1n << BigInt(indice);

        if (
          (estado.mascara & bit) !==
          0n
        ) {
          continue;
        }

        estadosExplorados++;

        const costo =
          calcularCostoIncremental(
            indice,
            estado.ultimos,
            combates,
            descansoMinimo
          );

        const nuevaMascara =
          estado.mascara |
          bit;

        const nuevosUltimos =
          [
            ...estado.ultimos,
            indice,
          ].slice(
            -descansoMinimo
          );

        const nuevoEstado = {
          mascara:
            nuevaMascara,

          ultimos:
            nuevosUltimos,

          secuencia: [
            ...estado.secuencia,
            indice,
          ],

          conflictos:
            estado.conflictos +
            costo.conflictos,

          deficit:
            estado.deficit +
            costo.deficit,

          repeticionCategoria:
            estado.repeticionCategoria +
            costo.repeticionCategoria,
        };

        const clave =
          `${nuevaMascara.toString()}|${nuevosUltimos.join(",")}`;

        const existente =
          candidatos.get(
            clave
          );

        if (
          !existente ||
          compararPuntajes(
            nuevoEstado,
            existente
          ) < 0
        ) {
          candidatos.set(
            clave,
            nuevoEstado
          );
        }
      }
    }

    estados =
      [...candidatos.values()]
        .sort(
          compararPuntajes
        )
        .slice(
          0,
          ANCHO_BEAM
        );
  }

  const mejor =
    estados
      .sort(
        compararPuntajes
      )[0];

  const orden =
    mejor.secuencia.map(
      (indice) =>
        combates[indice]
    );

  return {
    metodo:
      "HEURÍSTICO",

    garantizaOptimo:
      false,

    estadosExplorados,

    orden,

    conflictos:
      mejor.conflictos,

    deficit:
      mejor.deficit,
  };
}

// ============================================================
// OPTIMIZAR TATAMI
// ============================================================

function optimizarTatami(
  combates,
  descansoMinimo
) {
  if (
    combates.length <=
    LIMITE_BUSQUEDA_EXACTA
  ) {
    return optimizarExacto(
      combates,
      descansoMinimo
    );
  }

  return optimizarBeam(
    combates,
    descansoMinimo
  );
}

// ============================================================
// DETECTAR CRUCES ENTRE TATAMIS
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
    const lista = [
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
      of lista
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
        id:
          registro.id,

        nombre:
          registro.nombre,

        tatamis:
          [...registro.tatamis]
            .sort(
              (a, b) =>
                a - b
            ),

        categorias:
          [...registro.categorias],
      })
    );
}

// ============================================================
// CREAR TABLA DE PROPUESTA
// ============================================================

function crearFilasPropuesta(
  orden,
  descansoMinimo
) {
  const analisis =
    analizarSecuencia(
      orden,
      descansoMinimo
    );

  const ordenOriginal =
    new Map();

  const ordenActual =
    obtenerOrdenActual(
      orden
    );

  for (
    let i = 0;
    i < ordenActual.length;
    i++
  ) {
    ordenOriginal.set(
      ordenActual[i].id,
      i + 1
    );
  }

  return analisis.filas.map(
    (fila) => {
      const combate =
        fila.combate;

      return {
        Nuevo:
          fila.nuevoOrden,

        Antes:
          ordenOriginal.get(
            combate.id
          ),

        Categoría:
          nombreCategoria(
            combate
          ),

        Combate:
          `#${combate.judoshiai_match_number}`,

        Blanco:
          nombreCompetidor(
            combate.blanco_nombre,
            combate.judoshiai_white_index
          ),

        Azul:
          nombreCompetidor(
            combate.azul_nombre,
            combate.judoshiai_blue_index
          ),

        Estado:
          fila.estado,
      };
    }
  );
}

// ============================================================
// GUARDAR PROPUESTA LOCAL
// ============================================================

function guardarPropuesta(
  tanda,
  descansoMinimo,
  resultados,
  resumen
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
      `orden-tanda-${tanda.id}-descanso-${descansoMinimo}.json`
    );

  const contenido = {
    generado_en:
      new Date()
        .toISOString(),

    modo:
      "solo_simulacion",

    tanda: {
      id:
        tanda.id,

      nombre:
        tanda.nombre,

      campeonato_id:
        tanda.campeonato_id,
    },

    descanso_minimo:
      descansoMinimo,

    resumen,

    tatamis:
      resultados.map(
        (resultado) => ({
          tatami:
            resultado.tatami,

          metodo:
            resultado.metodo,

          garantiza_optimo:
            resultado.garantizaOptimo,

          conflictos_actuales:
            resultado.actual.conflictos,

          conflictos_propuestos:
            resultado.propuesto.conflictos,

          deficit_actual:
            resultado.actual.deficit,

          deficit_propuesto:
            resultado.propuesto.deficit,

          combates:
            resultado.orden.map(
              (combate, indice) => ({
                nuevo_orden:
                  indice + 1,

                supabase_id:
                  combate.id,

                judoshiai_category_index:
                  combate.judoshiai_category_index,

                judoshiai_match_number:
                  combate.judoshiai_match_number,

                categoria:
                  nombreCategoria(
                    combate
                  ),

                tatami:
                  combate.tatami_numero,

                blanco_judoshiai_id:
                  combate.judoshiai_white_index,

                blanco_nombre:
                  combate.blanco_nombre,

                azul_judoshiai_id:
                  combate.judoshiai_blue_index,

                azul_nombre:
                  combate.azul_nombre,
              })
            ),
        })
      ),
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
    "           OPTIMIZAR ORDEN DE LA TANDA"
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
    `Descanso mínimo: ${descansoMinimo} combate(s)`
  );

  console.log("");

  const combates =
    await cargarCombates(
      tanda
    );

  console.log(
    `Combates sincronizados: ${combates.length}`
  );

  console.log("");

  if (
    combates.length === 0
  ) {
    console.log(
      "⚠️ No existen combates sincronizados para optimizar."
    );

    console.log("");
    return;
  }

  validarCombates(
    combates
  );

  const crucesTatamis =
    detectarCrucesTatamis(
      combates
    );

  if (
    crucesTatamis.length > 0
  ) {
    console.log(
      "⚠️ ADVERTENCIA:"
    );

    console.log(
      "Hay competidores presentes en más de un tatami."
    );

    console.log(
      "La optimización independiente por tatami no puede garantizar el descanso global entre tatamis."
    );

    console.log("");

    console.table(
      crucesTatamis.map(
        (registro) => ({
          ID:
            registro.id,

          Competidor:
            registro.nombre,

          Tatamis:
            registro.tatamis
              .map(
                (tatami) =>
                  `T${tatami}`
              )
              .join(", "),

          Categorías:
            registro.categorias
              .join(", "),
        })
      )
    );

    console.log("");
  }

  const porTatami =
    agruparPorTatami(
      combates
    );

  const tatamis =
    [...porTatami.keys()]
      .sort(
        (a, b) =>
          a - b
      );

  const resultados =
    [];

  let conflictosActualesTotales =
    0;

  let conflictosPropuestosTotales =
    0;

  let deficitActualTotal =
    0;

  let deficitPropuestoTotal =
    0;

  // ==========================================================
  // OPTIMIZAR CADA TATAMI
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

    const combatesTatami =
      porTatami.get(
        tatami
      );

    const ordenActual =
      obtenerOrdenActual(
        combatesTatami
      );

    const analisisActual =
      analizarSecuencia(
        ordenActual,
        descansoMinimo
      );

    console.log(
      `Combates: ${combatesTatami.length}`
    );

    console.log(
      `Conflictos actuales: ${analisisActual.conflictos}`
    );

    console.log(
      `Déficit actual de descanso: ${analisisActual.deficit}`
    );

    console.log("");

    console.log(
      "🔎 Calculando mejor orden..."
    );

    console.log("");

    const optimizacion =
      optimizarTatami(
        combatesTatami,
        descansoMinimo
      );

    const analisisPropuesto =
      analizarSecuencia(
        optimizacion.orden,
        descansoMinimo
      );

    console.log(
      `Método: ${optimizacion.metodo}`
    );

    console.log(
      `Estados explorados: ${optimizacion.estadosExplorados}`
    );

    console.log(
      `Conflictos propuestos: ${analisisPropuesto.conflictos}`
    );

    console.log(
      `Déficit propuesto: ${analisisPropuesto.deficit}`
    );

    console.log("");

    if (
      optimizacion.garantizaOptimo
    ) {
      console.log(
        "✅ Se realizó búsqueda exacta."
      );

      if (
        analisisPropuesto.conflictos === 0
      ) {
        console.log(
          "✅ Existe un orden que cumple completamente el descanso configurado."
        );
      } else {
        console.log(
          `⚠️ Con estos combates NO es posible llegar a 0 conflictos manteniendo un mínimo de ${descansoMinimo}.`
        );

        console.log(
          `El mínimo matemático encontrado es ${analisisPropuesto.conflictos} conflicto(s).`
        );
      }
    } else {
      console.log(
        "⚠️ Se utilizó búsqueda heurística porque hay más de 12 combates."
      );

      console.log(
        "El resultado es el mejor encontrado, pero no demuestra matemáticamente que sea el óptimo absoluto."
      );
    }

    console.log("");

    console.log(
      "ORDEN PROPUESTO:"
    );

    console.log("");

    console.table(
      crearFilasPropuesta(
        optimizacion.orden,
        descansoMinimo
      )
    );

    console.log("");

    const mejora =
      analisisActual.conflictos -
      analisisPropuesto.conflictos;

    if (
      mejora > 0
    ) {
      console.log(
        `✅ Mejora: ${analisisActual.conflictos} → ${analisisPropuesto.conflictos} conflictos (-${mejora}).`
      );
    } else if (
      mejora === 0
    ) {
      console.log(
        "ℹ️ No se encontró reducción en la cantidad de conflictos."
      );
    } else {
      console.log(
        "⚠️ La propuesta resultó peor que el orden actual. Se conservará el orden actual en la propuesta final."
      );
    }

    console.log("");

    let ordenFinal =
      optimizacion.orden;

    let analisisFinal =
      analisisPropuesto;

    if (
      compararPuntajes(
        {
          conflictos:
            analisisPropuesto.conflictos,

          deficit:
            analisisPropuesto.deficit,

          repeticionCategoria:
            0,
        },
        {
          conflictos:
            analisisActual.conflictos,

          deficit:
            analisisActual.deficit,

          repeticionCategoria:
            0,
        }
      ) > 0
    ) {
      ordenFinal =
        ordenActual;

      analisisFinal =
        analisisActual;
    }

    conflictosActualesTotales +=
      analisisActual.conflictos;

    conflictosPropuestosTotales +=
      analisisFinal.conflictos;

    deficitActualTotal +=
      analisisActual.deficit;

    deficitPropuestoTotal +=
      analisisFinal.deficit;

    resultados.push({
      tatami,

      metodo:
        optimizacion.metodo,

      garantizaOptimo:
        optimizacion.garantizaOptimo,

      actual:
        analisisActual,

      propuesto:
        analisisFinal,

      orden:
        ordenFinal,
    });
  }

  // ==========================================================
  // RESUMEN
  // ==========================================================

  console.log(
    "============================================================"
  );

  console.log(
    "                    RESUMEN GENERAL"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `Combates: ${combates.length}`
  );

  console.log(
    `Tatamis: ${tatamis.length}`
  );

  console.log(
    `Descanso mínimo: ${descansoMinimo}`
  );

  console.log("");

  console.log(
    `Conflictos antes: ${conflictosActualesTotales}`
  );

  console.log(
    `Conflictos después: ${conflictosPropuestosTotales}`
  );

  console.log("");

  console.log(
    `Déficit antes: ${deficitActualTotal}`
  );

  console.log(
    `Déficit después: ${deficitPropuestoTotal}`
  );

  console.log("");

  const reduccion =
    conflictosActualesTotales -
    conflictosPropuestosTotales;

  if (
    conflictosPropuestosTotales === 0
  ) {
    console.log(
      "✅ SE ENCONTRÓ UN ORDEN SIN CONFLICTOS."
    );
  } else if (
    reduccion > 0
  ) {
    console.log(
      `✅ Se redujeron ${reduccion} conflictos.`
    );
  } else {
    console.log(
      "ℹ️ No fue posible reducir la cantidad de conflictos."
    );
  }

  console.log("");

  const todosExactos =
    resultados.every(
      (resultado) =>
        resultado.garantizaOptimo
    );

  if (
    todosExactos
  ) {
    console.log(
      "✅ Todos los tatamis fueron evaluados mediante búsqueda exacta."
    );

    if (
      conflictosPropuestosTotales > 0
    ) {
      console.log(
        "⚠️ Por lo tanto, los conflictos restantes no pueden eliminarse solamente cambiando el orden de los combates disponibles."
      );

      console.log(
        "Para reducirlos más sería necesario agregar otros combates/categorías entre medio o utilizar tiempo real de descanso."
      );
    }
  }

  console.log("");

  if (
    crucesTatamis.length === 0
  ) {
    console.log(
      "✅ No hay competidores cruzados entre los tatamis sincronizados."
    );
  } else {
    console.log(
      `⚠️ Competidores presentes en varios tatamis: ${crucesTatamis.length}`
    );
  }

  // ==========================================================
  // GUARDAR PROPUESTA LOCAL
  // ==========================================================

  const resumen = {
    combates:
      combates.length,

    tatamis:
      tatamis.length,

    descanso_minimo:
      descansoMinimo,

    conflictos_antes:
      conflictosActualesTotales,

    conflictos_despues:
      conflictosPropuestosTotales,

    deficit_antes:
      deficitActualTotal,

    deficit_despues:
      deficitPropuestoTotal,

    competidores_varios_tatamis:
      crucesTatamis.length,
  };

  const rutaPropuesta =
    guardarPropuesta(
      tanda,
      descansoMinimo,
      resultados,
      resumen
    );

  console.log("");

  console.log(
    "💾 Propuesta guardada localmente:"
  );

  console.log(
    rutaPropuesta
  );

  console.log("");

  console.log(
    "🔒 MODO SIMULACIÓN"
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

  console.log(
    "La propuesta JSON servirá después para probar la aplicación del nuevo orden sobre la COPIA de JudoShiai."
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