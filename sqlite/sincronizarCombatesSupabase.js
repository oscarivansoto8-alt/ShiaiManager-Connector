require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { createClient } = require("@supabase/supabase-js");

// ============================================================
// CONFIGURACIÓN
// ============================================================

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const carpetaBackups = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "backups"
);

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
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
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function normalizarTexto(valor) {
  return limpiar(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizarPeso(valor) {
  return limpiar(valor)
    .replace(/\s+/g, "");
}

function claveCategoria(
  registroCategoria,
  genero,
  peso
) {
  return [
    normalizarTexto(
      registroCategoria
    ),
    limpiar(
      genero
    ).toUpperCase(),
    normalizarPeso(
      peso
    ),
  ].join("|");
}

function nombrePersona(persona) {
  if (!persona) {
    return null;
  }

  return [
    limpiar(
      persona.first
    ),
    limpiar(
      persona.last
    ),
  ]
    .filter(Boolean)
    .join(" ");
}

function generarSelloFecha() {
  const ahora =
    new Date();

  const pad = (numero) =>
    String(numero)
      .padStart(
        2,
        "0"
      );

  return (
    ahora.getFullYear() +
    pad(
      ahora.getMonth() + 1
    ) +
    pad(
      ahora.getDate()
    ) +
    "-" +
    pad(
      ahora.getHours()
    ) +
    pad(
      ahora.getMinutes()
    ) +
    pad(
      ahora.getSeconds()
    )
  );
}

// ============================================================
// OBTENER ID DE TANDA
// ============================================================

function obtenerTandaId() {
  const argumento =
    process.argv[2];

  const tandaId =
    Number(
      argumento
    );

  if (
    !Number.isInteger(
      tandaId
    ) ||
    tandaId <= 0
  ) {
    throw new Error(
      "Debes indicar el ID de la tanda. Ejemplo: node .\\sqlite\\sincronizarCombatesSupabase.js 2"
    );
  }

  return tandaId;
}

// ============================================================
// OBTENER TANDA
// ============================================================

async function obtenerTanda(
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
      "id, campeonato_id, nombre, orden, estado"
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
// OBTENER DISTRIBUCIÓN
// ============================================================

async function obtenerDistribucion(
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
      "La tanda no tiene distribución guardada."
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
  const db =
    new Database(
      rutaArchivo,
      {
        readonly: true,
        fileMustExist: true,
      }
    );

  try {
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
              Number.isInteger(
                id
              ) &&
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
            "index" AS id,
            TRIM(category) AS categoria,
            category AS categoria_original,
            tatami,
            wishsys,
            system
          FROM categories
          WHERE
            (
              COALESCE(
                deleted,
                0
              ) & 1
            ) = 0
        `)
        .all();

    const categoriasPorId =
      new Map();

    for (
      const categoria
      of categorias
    ) {
      categoriasPorId.set(
        Number(
          categoria.id
        ),
        categoria
      );
    }

    // --------------------------------------------------------
    // COMPETIDORES
    // --------------------------------------------------------

    const competidores =
      db
        .prepare(`
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
      const competidor
      of competidores
    ) {
      competidoresPorId.set(
        Number(
          competidor.id
        ),
        competidor
      );
    }

    // --------------------------------------------------------
    // COMBATES
    // --------------------------------------------------------

    const combates =
      db
        .prepare(`
          SELECT
            category,
            number,
            blue,
            white,
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
          (combate) =>
            idsPermitidos.has(
              Number(
                combate.category
              )
            )
        );

    return {
      categoriasPorId,
      competidoresPorId,
      combates,
    };
  } finally {
    db.close();
  }
}

// ============================================================
// OBTENER COMBATES PLANIFICADOS YA EXISTENTES
// ============================================================

async function obtenerCombatesPlanificados(
  campeonatoId
) {
  const {
    data,
    error,
  } = await supabase
    .from(
      "combates_planificador"
    )
    .select("*")
    .eq(
      "campeonato_id",
      campeonatoId
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
// BACKUP LOCAL
// ============================================================

function guardarBackup(
  tanda,
  filas
) {
  fs.mkdirSync(
    carpetaBackups,
    {
      recursive: true,
    }
  );

  const rutaBackup =
    path.resolve(
      carpetaBackups,
      `combates-planificador-antes-sync-tanda-${tanda.id}-${generarSelloFecha()}.json`
    );

  fs.writeFileSync(
    rutaBackup,
    JSON.stringify(
      {
        tanda,
        fecha:
          new Date()
            .toISOString(),
        filas,
      },
      null,
      2
    ),
    "utf8"
  );

  return rutaBackup;
}

// ============================================================
// SISTEMA
// ============================================================

function obtenerSistema(
  categoriaLocal
) {
  const wishsys =
    Number(
      categoriaLocal?.wishsys
    ) || 0;

  if (
    wishsys === 1
  ) {
    return {
      sistema:
        "todos_contra_todos",

      rondaNumero:
        1,

      rondaNombre:
        "Todos contra todos",
    };
  }

  return {
    sistema:
      "eliminacion_simple",

    rondaNumero:
      1,

    rondaNombre:
      "Eliminación",
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
    "      SINCRONIZAR COMBATES JUDOSHIAI → SUPABASE"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(
    `Archivo: ${rutaArchivo}`
  );

  console.log("");

  // ----------------------------------------------------------
  // TANDA
  // ----------------------------------------------------------

  const tandaId =
    obtenerTandaId();

  const tanda =
    await obtenerTanda(
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

  console.log("");

  // ----------------------------------------------------------
  // DISTRIBUCIÓN
  // ----------------------------------------------------------

  const distribucion =
    await obtenerDistribucion(
      tanda.id
    );

  console.log(
    `Categorías de la tanda: ${distribucion.length}`
  );

  // ----------------------------------------------------------
  // JUDOSHIAI
  // ----------------------------------------------------------

  const datosShi =
    leerJudoShiai(
      distribucion
    );

  console.log(
    `Combates generados actualmente en JudoShiai: ${datosShi.combates.length}`
  );

  console.log("");

  if (
    datosShi.combates.length === 0
  ) {
    console.log(
      "⚠️ Todavía no hay sorteos realizados para las categorías de esta tanda."
    );

    console.log("");
    return;
  }

  // ----------------------------------------------------------
  // COMBATES PLANIFICADOS EXISTENTES
  // ----------------------------------------------------------

  const planificados =
    await obtenerCombatesPlanificados(
      tanda.campeonato_id
    );

  console.log(
    `Combates planificados existentes en Supabase: ${planificados.length}`
  );

  console.log("");

  // ==========================================================
  // AGRUPAR PLANIFICADOS POR CATEGORÍA
  // ==========================================================

  const planificadosPorCategoria =
    new Map();

  for (
    const fila
    of planificados
  ) {
    const clave =
      claveCategoria(
        fila.registro_categoria,
        fila.genero,
        fila.categoria_peso
      );

    if (
      !planificadosPorCategoria.has(
        clave
      )
    ) {
      planificadosPorCategoria.set(
        clave,
        []
      );
    }

    planificadosPorCategoria
      .get(
        clave
      )
      .push(
        fila
      );
  }

  for (
    const filas
    of planificadosPorCategoria.values()
  ) {
    filas.sort(
      (a, b) =>
        Number(
          a.orden_combate
        ) -
        Number(
          b.orden_combate
        )
    );
  }

  // ==========================================================
  // AGRUPAR MATCHES REALES DE JUDOSHIAI
  // ==========================================================

  const matchesPorCategoria =
    new Map();

  for (
    const combate
    of datosShi.combates
  ) {
    const categoriaId =
      Number(
        combate.category
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
        combate
      );
  }

  for (
    const matches
    of matchesPorCategoria.values()
  ) {
    matches.sort(
      (a, b) =>
        Number(
          a.number
        ) -
        Number(
          b.number
        )
    );
  }

  // ==========================================================
  // PREPARAR ACTUALIZACIONES
  // ==========================================================

  const actualizaciones =
    [];

  const filasOriginales =
    [];

  const resumen =
    [];

  for (
    const distribucionCategoria
    of distribucion
  ) {
    const categoriaId =
      Number(
        distribucionCategoria.judoshiai_index
      );

    const matches =
      matchesPorCategoria.get(
        categoriaId
      ) || [];

    // Todavía no se ha sorteado.
    if (
      matches.length === 0
    ) {
      continue;
    }

    const categoriaLocal =
      datosShi.categoriasPorId.get(
        categoriaId
      );

    if (!categoriaLocal) {
      throw new Error(
        `No existe la categoría ID ${categoriaId} en el .shi.`
      );
    }

    if (
      limpiar(
        categoriaLocal.categoria
      ) !==
      limpiar(
        distribucionCategoria.categoria_clave
      )
    ) {
      throw new Error(
        `El nombre de la categoría ID ${categoriaId} no coincide.`
      );
    }

    const tatamiLocal =
      Number(
        categoriaLocal.tatami
      );

    const tatamiEsperado =
      Number(
        distribucionCategoria.tatami_numero
      );

    if (
      tatamiLocal !==
      tatamiEsperado
    ) {
      throw new Error(
        `${categoriaLocal.categoria}: está en T${tatamiLocal}, pero la tanda indica T${tatamiEsperado}.`
      );
    }

    const clave =
      claveCategoria(
        distribucionCategoria.registro_categoria,
        distribucionCategoria.genero,
        distribucionCategoria.categoria_peso
      );

    const filasPlanificadas =
      planificadosPorCategoria.get(
        clave
      ) || [];

    if (
      filasPlanificadas.length === 0
    ) {
      throw new Error(
        `${categoriaLocal.categoria}: no se encontraron combates planificados en Supabase.`
      );
    }

    if (
      filasPlanificadas.length !==
      matches.length
    ) {
      throw new Error(
        `${categoriaLocal.categoria}: JudoShiai tiene ${matches.length} combates, pero Supabase tiene ${filasPlanificadas.length} planificados. No se modificó nada.`
      );
    }

    const sistema =
      obtenerSistema(
        categoriaLocal
      );

    // --------------------------------------------------------
    // VINCULAR MATCH REAL CON FILA PLANIFICADA
    // --------------------------------------------------------

    for (
      let i = 0;
      i < matches.length;
      i++
    ) {
      const match =
        matches[i];

      const filaPlanificada =
        filasPlanificadas[i];

      /*
       * IMPORTANTE:
       *
       * En este archivo .shi,
       * los campos internos blue/white
       * están invertidos respecto a
       * las etiquetas que muestra
       * JudoShiai en pantalla.
       *
       * Visualmente comprobamos:
       *
       * Blanco = match.blue
       * Azul    = match.white
       */

      const blancoId =
        Number(
          match.blue
        );

      const azulId =
        Number(
          match.white
        );

      const blanco =
        datosShi.competidoresPorId.get(
          blancoId
        );

      const azul =
        datosShi.competidoresPorId.get(
          azulId
        );

      if (!blanco) {
        throw new Error(
          `${categoriaLocal.categoria} #${match.number}: no se encontró el competidor blanco ID ${blancoId}.`
        );
      }

      if (!azul) {
        throw new Error(
          `${categoriaLocal.categoria} #${match.number}: no se encontró el competidor azul ID ${azulId}.`
        );
      }

      // Guardamos copia original para poder restaurar.
      filasOriginales.push(
        {
          ...filaPlanificada,
        }
      );

      // Creamos nueva versión de la fila.
      actualizaciones.push({
        ...filaPlanificada,

        tanda_id:
          tanda.id,

        tatami_numero:
          tatamiEsperado,

        categoria_orden:
          Number(
            distribucionCategoria.orden
          ),

        sistema:
          sistema.sistema,

        ronda_numero:
          sistema.rondaNumero,

        ronda_nombre:
          sistema.rondaNombre,

        /*
         * combate_numero se mantiene como
         * número interno del planificador.
         *
         * judoshiai_match_number guarda el
         * número real del combate en JudoShiai.
         */

        orden_combate:
          Number(
            match.number
          ),

        azul_tipo:
          "deportista",

        azul_deportista_id:
          null,

        azul_nombre:
          nombrePersona(
            azul
          ),

        azul_club:
          limpiar(
            azul.club
          ) || null,

        azul_referencia_combate:
          null,

        blanco_tipo:
          "deportista",

        blanco_deportista_id:
          null,

        blanco_nombre:
          nombrePersona(
            blanco
          ),

        blanco_club:
          limpiar(
            blanco.club
          ) || null,

        blanco_referencia_combate:
          null,

        ganador_deportista_id:
          null,

        judoshiai_category_index:
          categoriaId,

        judoshiai_match_number:
          Number(
            match.number
          ),

        judoshiai_blue_index:
          azulId,

        judoshiai_white_index:
          blancoId,

        sincronizado_en:
          new Date()
            .toISOString(),

        updated_at:
          new Date()
            .toISOString(),
      });

      resumen.push({
        Categoría:
          categoriaLocal.categoria,

        Combate:
          `#${match.number}`,

        Tatami:
          `T${tatamiEsperado}`,

        Blanco:
          nombrePersona(
            blanco
          ),

        Azul:
          nombrePersona(
            azul
          ),

        "ID blanco":
          blancoId,

        "ID azul":
          azulId,

        "Fila Supabase":
          filaPlanificada.id,
      });
    }
  }

  // ==========================================================
  // SIN NADA NUEVO
  // ==========================================================

  if (
    actualizaciones.length === 0
  ) {
    console.log(
      "⚠️ No hay combates sorteados para sincronizar."
    );

    console.log("");
    return;
  }

  // ==========================================================
  // MOSTRAR PREVISUALIZACIÓN
  // ==========================================================

  console.log(
    "============================================================"
  );

  console.log(
    "          COMBATES QUE SE SINCRONIZARÁN"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.table(
    resumen
  );

  console.log("");

  // ==========================================================
  // BACKUP
  // ==========================================================

  const rutaBackup =
    guardarBackup(
      tanda,
      filasOriginales
    );

  console.log(
    "✅ Backup local de Supabase creado:"
  );

  console.log(
    rutaBackup
  );

  console.log("");

  // ==========================================================
  // ACTUALIZAR FILAS EXISTENTES
  // ==========================================================

  const sincronizados =
    [];

  try {
    for (
      const fila
      of actualizaciones
    ) {
      const idFila =
        Number(
          fila.id
        );

      if (
        !Number.isInteger(
          idFila
        ) ||
        idFila <= 0
      ) {
        throw new Error(
          "Se encontró una fila de Supabase sin ID válido."
        );
      }

      /*
       * MUY IMPORTANTE:
       *
       * Quitamos "id" antes del UPDATE.
       *
       * id es una columna identity de PostgreSQL
       * y no debemos intentar modificarla.
       */

      const {
        id,
        ...cambios
      } = fila;

      const {
        data,
        error,
      } = await supabase
        .from(
          "combates_planificador"
        )
        .update(
          cambios
        )
        .eq(
          "id",
          idFila
        )
        .select(
          `
          id,
          categoria_clave,
          combate_numero,
          orden_combate,
          tatami_numero,
          estado,
          tanda_id,
          judoshiai_category_index,
          judoshiai_match_number,
          judoshiai_blue_index,
          judoshiai_white_index,
          azul_nombre,
          blanco_nombre
          `
        )
        .single();

      if (error) {
        throw new Error(
          `Error actualizando la fila ${idFila}: ${error.message}`
        );
      }

      if (!data) {
        throw new Error(
          `Supabase no devolvió la fila ${idFila} después de actualizarla.`
        );
      }

      sincronizados.push(
        data
      );
    }
  } catch (error) {
    console.log("");
    console.log(
      "⚠️ Ocurrió un error durante la sincronización."
    );

    console.log(
      "Intentando restaurar las filas originales..."
    );

    let erroresRestauracion =
      0;

    for (
      const original
      of filasOriginales
    ) {
      const {
        id,
        ...camposOriginales
      } = original;

      const {
        error:
          errorRestauracion,
      } = await supabase
        .from(
          "combates_planificador"
        )
        .update(
          camposOriginales
        )
        .eq(
          "id",
          id
        );

      if (
        errorRestauracion
      ) {
        erroresRestauracion++;

        console.error(
          `❌ No se pudo restaurar la fila ${id}: ${errorRestauracion.message}`
        );
      }
    }

    console.log("");

    if (
      erroresRestauracion === 0
    ) {
      console.log(
        "✅ Las filas originales fueron restauradas."
      );
    } else {
      console.log(
        `❌ Hubo ${erroresRestauracion} error(es) al restaurar.`
      );

      console.log(
        "Usa el backup JSON creado antes de la sincronización."
      );
    }

    throw error;
  }

  // ==========================================================
  // VERIFICACIÓN DE CANTIDAD
  // ==========================================================

  if (
    sincronizados.length !==
    actualizaciones.length
  ) {
    throw new Error(
      `Se esperaban ${actualizaciones.length} filas actualizadas, pero Supabase devolvió ${sincronizados.length}.`
    );
  }

  // ==========================================================
  // VERIFICACIÓN FINAL DESDE SUPABASE
  // ==========================================================

  const idsActualizados =
    sincronizados.map(
      (fila) =>
        fila.id
    );

  const {
    data:
      verificacionFinal,
    error:
      errorVerificacion,
  } = await supabase
    .from(
      "combates_planificador"
    )
    .select(
      `
      id,
      tanda_id,
      categoria_clave,
      combate_numero,
      orden_combate,
      tatami_numero,
      estado,
      judoshiai_category_index,
      judoshiai_match_number,
      judoshiai_blue_index,
      judoshiai_white_index,
      azul_nombre,
      blanco_nombre
      `
    )
    .in(
      "id",
      idsActualizados
    )
    .order(
      "judoshiai_match_number",
      {
        ascending: true,
      }
    );

  if (
    errorVerificacion
  ) {
    throw new Error(
      `Error verificando los combates: ${errorVerificacion.message}`
    );
  }

  if (
    !verificacionFinal ||
    verificacionFinal.length !==
      actualizaciones.length
  ) {
    throw new Error(
      "La verificación final no devolvió todos los combates esperados."
    );
  }

  let erroresFinales =
    0;

  for (
    const fila
    of verificacionFinal
  ) {
    const correcto =
      Number(
        fila.tanda_id
      ) ===
        Number(
          tanda.id
        ) &&
      Number(
        fila.judoshiai_category_index
      ) > 0 &&
      Number(
        fila.judoshiai_match_number
      ) > 0 &&
      Number(
        fila.judoshiai_blue_index
      ) > 0 &&
      Number(
        fila.judoshiai_white_index
      ) > 0;

    if (!correcto) {
      erroresFinales++;
    }
  }

  if (
    erroresFinales > 0
  ) {
    throw new Error(
      `La verificación final detectó ${erroresFinales} combate(s) incompletos.`
    );
  }

  // ==========================================================
  // RESULTADO
  // ==========================================================

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

  console.log(
    `✅ Combates sincronizados: ${sincronizados.length}`
  );

  console.log(
    `✅ Tanda: ${tanda.nombre}`
  );

  console.log("");

  console.table(
    verificacionFinal.map(
      (fila) => ({
        ID:
          fila.id,

        Combate:
          `#${fila.judoshiai_match_number}`,

        Tatami:
          `T${fila.tatami_numero}`,

        Blanco:
          fila.blanco_nombre,

        Azul:
          fila.azul_nombre,

        "ID blanco":
          fila.judoshiai_white_index,

        "ID azul":
          fila.judoshiai_blue_index,

        "Categoría JudoShiai":
          fila.judoshiai_category_index,

        Estado:
          fila.estado,
      })
    )
  );

  console.log("");

  console.log(
    "✅ Los registros planificados fueron vinculados con los combates reales."
  );

  console.log(
    "✅ No se crearon combates duplicados."
  );

  console.log(
    "✅ Las categorías sin sorteo no fueron modificadas."
  );

  console.log(
    "✅ Los IDs reales de los competidores quedaron guardados."
  );

  console.log("");

  console.log(
    "🔒 El archivo .shi se leyó solamente."
  );

  console.log(
    "No se modificó JudoShiai."
  );

  console.log("");

  console.log(
    "Backup disponible en:"
  );

  console.log(
    rutaBackup
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