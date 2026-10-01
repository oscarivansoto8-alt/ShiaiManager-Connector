const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ============================================================
// CONFIGURACIÓN
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

const categoriasObjetivo = [
  "sub18 -40",
  "sub18 -44",
  "sub18 -48",
  "sub18 -52",
  "sub21 -48",
  "sub21 -52",
];

// ============================================================
// CONSTANTES DE JUDOSHIAI
// ============================================================

const GHOST = 1;
const PRIMER_ID_COMPETIDOR = 9;

// ============================================================
// UTILIDADES
// ============================================================

function limpiar(valor) {
  return String(valor ?? "").trim();
}

function selloFecha() {
  const ahora = new Date();

  const pad = (numero) =>
    String(numero).padStart(2, "0");

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

function nombrePersona(persona) {
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
    path.basename(
      rutaShi
    ).toLowerCase();

  if (
    nombre !==
    "planificador-prueba-llaves.shi"
  ) {
    throw new Error(
      "SEGURIDAD: este script solamente puede leer planificador-prueba-llaves.shi"
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
      "SEGURIDAD: el archivo debe estar dentro de pruebas."
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
// NOMBRES DE SISTEMA
// ============================================================

function nombreSistema(system) {
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
    sistemas[
      Number(system)
    ] ||
    `Sistema ${system}`
  );
}

// ============================================================
// DETECTAR TIPO PARA V3
// ============================================================

function detectarTipo(
  categoria
) {
  const system =
    Number(
      categoria.system
    );

  if (
    system === 1
  ) {
    return "TODOS_CONTRA_TODOS";
  }

  if (
    system === 11
  ) {
    return "MEJOR_DE_3";
  }

  if (
    system >= 3 &&
    system <= 8
  ) {
    return "ELIMINATORIA";
  }

  if (
    [
      2,
      9,
      10,
      12,
    ].includes(
      system
    )
  ) {
    return "POOLS_CON_FASE_FINAL";
  }

  if (
    system === 13
  ) {
    return "PERSONALIZADO";
  }

  return "REVISAR";
}

// ============================================================
// INTERPRETAR PARTICIPANTE
// ============================================================

function interpretarParticipante(
  raw,
  personasPorId
) {
  const id =
    Number(raw);

  if (
    id === 0
  ) {
    return {
      id,

      tipo:
        "PENDIENTE",

      nombre:
        "Pendiente",
    };
  }

  if (
    id === GHOST
  ) {
    return {
      id,

      tipo:
        "GHOST",

      nombre:
        "Bye / Ghost",
    };
  }

  const persona =
    personasPorId.get(
      id
    );

  if (
    persona
  ) {
    return {
      id,

      tipo:
        "COMPETIDOR",

      nombre:
        nombrePersona(
          persona
        ),
    };
  }

  if (
    id >=
    PRIMER_ID_COMPETIDOR
  ) {
    return {
      id,

      tipo:
        "ID_NO_ENCONTRADO",

      nombre:
        `Competidor ${id}`,
    };
  }

  return {
    id,

    tipo:
      "VALOR_INTERNO",

    nombre:
      `Valor ${id}`,
  };
}

// ============================================================
// RESULTADO DEL MATCH
// ============================================================

function resultadoMatch(
  match
) {
  const bluePoints =
    Number(
      match.blue_points || 0
    );

  const whitePoints =
    Number(
      match.white_points || 0
    );

  if (
    bluePoints === 0 &&
    whitePoints === 0
  ) {
    return null;
  }

  const blueId =
    Number(
      match.blue
    );

  const whiteId =
    Number(
      match.white
    );

  if (
    bluePoints >
    whitePoints
  ) {
    return {
      ganadorId:
        blueId,

      perdedorId:
        whiteId,

      ganadorLado:
        "BLUE",
    };
  }

  if (
    whitePoints >
    bluePoints
  ) {
    return {
      ganadorId:
        whiteId,

      perdedorId:
        blueId,

      ganadorLado:
        "WHITE",
    };
  }

  return {
    ganadorId: null,

    perdedorId: null,

    ganadorLado:
      "INDETERMINADO",
  };
}

// ============================================================
// ¿MATCH FINALIZADO?
// ============================================================

function combateFinalizado(
  match
) {
  return (
    resultadoMatch(
      match
    ) !== null
  );
}

// ============================================================
// ESTADO BASE
//
// Esto mira solamente:
// - resultado
// - participantes conocidos
// - ghost
//
// Después aplicaremos las dependencias de etapas.
// ============================================================

function calcularEstadoBase(
  match,
  blue,
  white
) {
  if (
    combateFinalizado(
      match
    )
  ) {
    return "FINALIZADO";
  }

  // ----------------------------------------------------------
  // BYE / GHOST
  //
  // Nunca debe ocupar un turno real del tatami.
  // ----------------------------------------------------------

  if (
    blue.tipo ===
      "GHOST" ||
    white.tipo ===
      "GHOST"
  ) {
    return "BYE_NO_OCUPA_TATAMI";
  }

  // ----------------------------------------------------------
  // DOS COMPETIDORES REALES CONOCIDOS
  // ----------------------------------------------------------

  if (
    blue.tipo ===
      "COMPETIDOR" &&
    white.tipo ===
      "COMPETIDOR"
  ) {
    return "CANDIDATO_LISTO";
  }

  // ----------------------------------------------------------
  // FALTA GANADOR/PERDEDOR DE OTRA PELEA
  // ----------------------------------------------------------

  if (
    blue.tipo ===
      "PENDIENTE" ||
    white.tipo ===
      "PENDIENTE"
  ) {
    return "BLOQUEADO_POR_RESULTADO";
  }

  return "REVISAR";
}

// ============================================================
// NOMBRE DE RONDA PRINCIPAL
// ============================================================

function nombreRondaPrincipal(
  participantesEnRonda
) {
  const nombres = {
    256:
      "Ronda de 256",

    128:
      "Ronda de 128",

    64:
      "Ronda de 64",

    32:
      "Ronda de 32",

    16:
      "Octavos de final",

    8:
      "Cuartos de final",
  };

  return (
    nombres[
      participantesEnRonda
    ] ||
    `Ronda de ${participantesEnRonda}`
  );
}

// ============================================================
// MAPA ELIMINATORIO IJF — TABLA 7
// ============================================================
//
// ESTRUCTURA VALIDADA:
//
// French 8
//
// #1-4     Cuartos
// #5-6     Repechaje
// #7-8     Semifinal
// #9-10    Bronce
// #11      Final
//
// French 16
//
// #1-8     Octavos
// #9-12    Cuartos
// #13-14   Repechaje
// #15-16   Semifinal
// #17-18   Bronce
// #19      Final
//
// Para French 32, 64, etc. la fase inicial escala.
// ============================================================

function construirMapaIJFTabla7(
  categoria,
  matches
) {
  const system =
    Number(
      categoria.system
    );

  if (
    system < 3 ||
    system > 8
  ) {
    throw new Error(
      `${categoria.categoria}: no es sistema French.`
    );
  }

  if (
    Number(
      categoria.tabla
    ) !== 7
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `usa tabla ${categoria.tabla}.`,
        "",
        "Esta versión V3 fue validada únicamente",
        "para IJF Rep. doble usando tabla 7.",
      ].join(" ")
    );
  }

  /*
   * system:
   *
   * 3 → French 8
   * 4 → French 16
   * 5 → French 32
   * 6 → French 64
   * 7 → French 128
   * 8 → French 256
   */

  const tamanoLlave =
    2 ** system;

  /*
   * En tabla 7:
   *
   * French 8:
   * 8 + 3 = 11
   *
   * French 16:
   * 16 + 3 = 19
   */

  const totalEsperado =
    tamanoLlave + 3;

  if (
    matches.length !==
    totalEsperado
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `${nombreSistema(system)} tabla 7`,
        `debería tener ${totalEsperado} posiciones`,
        `y JudoShiai tiene ${matches.length}.`,
      ].join(" ")
    );
  }

  const mapa =
    new Map();

  let numeroMatch = 1;
  let macroEtapa = 1;

  // ==========================================================
  // ELIMINACIÓN PRINCIPAL
  //
  // French 16:
  //
  // Octavos
  // Cuartos
  //
  // French 32:
  //
  // Ronda 32
  // Octavos
  // Cuartos
  // ==========================================================

  let participantesEnRonda =
    tamanoLlave;

  while (
    participantesEnRonda >= 8
  ) {
    const cantidadCombates =
      participantesEnRonda / 2;

    const nombre =
      nombreRondaPrincipal(
        participantesEnRonda
      );

    for (
      let i = 0;
      i < cantidadCombates;
      i++
    ) {
      mapa.set(
        numeroMatch,
        {
          macro_etapa:
            macroEtapa,

          macro_nombre:
            nombre,

          subetapa:
            nombre
              .toUpperCase()
              .replaceAll(
                " ",
                "_"
              ),

          tipo_ronda:
            "ELIMINACION_PRINCIPAL",

          prioridad_ronda:
            macroEtapa,
        }
      );

      numeroMatch++;
    }

    participantesEnRonda /=
      2;

    macroEtapa++;
  }

  // ==========================================================
  // REPECHAJES
  //
  // Y SEMIFINALES
  //
  // Compartirán macro-etapa.
  //
  // Más adelante el planificador podrá decidir:
  //
  // repechaje
  // otra categoría
  // semifinal
  // otra categoría...
  // ==========================================================

  const etapaIntermedia =
    macroEtapa;

  for (
    let i = 0;
    i < 2;
    i++
  ) {
    mapa.set(
      numeroMatch,
      {
        macro_etapa:
          etapaIntermedia,

        macro_nombre:
          "Semifinales y repechajes",

        subetapa:
          "REPECHAJE",

        tipo_ronda:
          "REPECHAJE",

        prioridad_ronda:
          etapaIntermedia,
      }
    );

    numeroMatch++;
  }

  for (
    let i = 0;
    i < 2;
    i++
  ) {
    mapa.set(
      numeroMatch,
      {
        macro_etapa:
          etapaIntermedia,

        macro_nombre:
          "Semifinales y repechajes",

        subetapa:
          "SEMIFINAL",

        tipo_ronda:
          "SEMIFINAL",

        prioridad_ronda:
          etapaIntermedia,
      }
    );

    numeroMatch++;
  }

  macroEtapa++;

  // ==========================================================
  // BRONCES
  // ==========================================================

  for (
    let i = 0;
    i < 2;
    i++
  ) {
    mapa.set(
      numeroMatch,
      {
        macro_etapa:
          macroEtapa,

        macro_nombre:
          "Combates por bronce",

        subetapa:
          "BRONCE",

        tipo_ronda:
          "MEDALLA_BRONCE",

        prioridad_ronda:
          macroEtapa,
      }
    );

    numeroMatch++;
  }

  macroEtapa++;

  // ==========================================================
  // FINAL
  // ==========================================================

  mapa.set(
    numeroMatch,
    {
      macro_etapa:
        macroEtapa,

      macro_nombre:
        "Final",

      subetapa:
        "FINAL",

      tipo_ronda:
        "FINAL",

      prioridad_ronda:
        macroEtapa,
    }
  );

  numeroMatch++;

  // ==========================================================
  // VALIDACIÓN
  // ==========================================================

  if (
    numeroMatch - 1 !==
    matches.length
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        "el mapa IJF no cubrió todos los combates.",
        `Mapeados: ${numeroMatch - 1}`,
        `JudoShiai: ${matches.length}`,
      ].join(" ")
    );
  }

  return {
    tamanoLlave,
    mapa,
  };
}

// ============================================================
// MAPA MEJOR DE 3
// ============================================================

function construirMapaMejorDe3(
  categoria,
  matches
) {
  if (
    matches.length !== 3
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        "Mejor de 3 debería tener 3 combates.",
        `JudoShiai tiene ${matches.length}.`,
      ].join(" ")
    );
  }

  const mapa =
    new Map();

  mapa.set(
    1,
    {
      macro_etapa: 1,

      macro_nombre:
        "Combate 1",

      subetapa:
        "MEJOR_DE_3_1",

      tipo_ronda:
        "MEJOR_DE_3",

      prioridad_ronda: 1,

      condicional: false,
    }
  );

  mapa.set(
    2,
    {
      macro_etapa: 2,

      macro_nombre:
        "Combate 2",

      subetapa:
        "MEJOR_DE_3_2",

      tipo_ronda:
        "MEJOR_DE_3",

      prioridad_ronda: 2,

      condicional: false,
    }
  );

  mapa.set(
    3,
    {
      macro_etapa: 3,

      macro_nombre:
        "Combate 3",

      subetapa:
        "MEJOR_DE_3_3",

      tipo_ronda:
        "MEJOR_DE_3",

      prioridad_ronda: 3,

      condicional: true,
    }
  );

  return {
    mapa,
  };
}

// ============================================================
// MAPA TODOS CONTRA TODOS
// ============================================================
//
// n = 3
//
// 3 pasadas
// 1 combate por pasada
//
// n = 4
//
// 3 pasadas
// 2 combates por pasada
//
// n = 5
//
// 5 pasadas
// 2 combates por pasada
// ============================================================

function construirMapaPool(
  categoria,
  matches
) {
  const n =
    Number(
      categoria.numcomp
    );

  if (
    n < 3
  ) {
    throw new Error(
      `${categoria.categoria}: Pool con menos de 3 competidores.`
    );
  }

  const esperados =
    (
      n *
      (n - 1)
    ) / 2;

  if (
    matches.length !==
    esperados
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        `con ${n} competidores`,
        `se esperaban ${esperados} combates`,
        `pero existen ${matches.length}.`,
      ].join(" ")
    );
  }

  const combatesPorPasada =
    Math.floor(
      n / 2
    );

  const cantidadPasadas =
    n % 2 === 0
      ? n - 1
      : n;

  const mapa =
    new Map();

  let numeroMatch = 1;

  for (
    let pasada = 1;
    pasada <= cantidadPasadas;
    pasada++
  ) {
    for (
      let i = 0;
      i < combatesPorPasada;
      i++
    ) {
      mapa.set(
        numeroMatch,
        {
          macro_etapa:
            pasada,

          macro_nombre:
            `Pasada ${pasada}`,

          subetapa:
            `PASADA_${pasada}`,

          tipo_ronda:
            "TODOS_CONTRA_TODOS",

          prioridad_ronda:
            pasada,
        }
      );

      numeroMatch++;
    }
  }

  if (
    numeroMatch - 1 !==
    matches.length
  ) {
    throw new Error(
      [
        `${categoria.categoria}:`,
        "las pasadas no cubrieron todos los combates.",
      ].join(" ")
    );
  }

  return {
    mapa,
  };
}

// ============================================================
// CONSTRUIR MAPA SEGÚN SISTEMA
// ============================================================

function construirMapaCategoria(
  categoria,
  matches
) {
  const tipo =
    detectarTipo(
      categoria
    );

  if (
    tipo ===
    "ELIMINATORIA"
  ) {
    return {
      tipo,

      ...construirMapaIJFTabla7(
        categoria,
        matches
      ),
    };
  }

  if (
    tipo ===
    "MEJOR_DE_3"
  ) {
    return {
      tipo,

      ...construirMapaMejorDe3(
        categoria,
        matches
      ),
    };
  }

  if (
    tipo ===
    "TODOS_CONTRA_TODOS"
  ) {
    return {
      tipo,

      ...construirMapaPool(
        categoria,
        matches
      ),
    };
  }

  return {
    tipo,

    mapa:
      new Map(),
  };
}

// ============================================================
// CONVERTIR MATCH EN REGISTRO V3
// ============================================================

function convertirMatchV3({
  match,
  infoRonda,
  personasPorId,
}) {
  const blue =
    interpretarParticipante(
      match.blue,
      personasPorId
    );

  const white =
    interpretarParticipante(
      match.white,
      personasPorId
    );

  const estadoBase =
    calcularEstadoBase(
      match,
      blue,
      white
    );

  return {
    numero:
      Number(
        match.number
      ),

    macro_etapa:
      infoRonda.macro_etapa,

    macro_nombre:
      infoRonda.macro_nombre,

    subetapa:
      infoRonda.subetapa,

    tipo_ronda:
      infoRonda.tipo_ronda,

    condicional:
      Boolean(
        infoRonda.condicional
      ),

    estado_base:
      estadoBase,

    estado:
      estadoBase,

    ocupa_tatami:
      false,

    requiere_control_descanso:
      false,

    blue_id:
      blue.id,

    blue_tipo:
      blue.tipo,

    blue:
      blue.nombre,

    white_id:
      white.id,

    white_tipo:
      white.tipo,

    white:
      white.nombre,

    blue_points:
      Number(
        match.blue_points || 0
      ),

    white_points:
      Number(
        match.white_points || 0
      ),

    blue_score:
      Number(
        match.blue_score || 0
      ),

    white_score:
      Number(
        match.white_score || 0
      ),

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

    match_original:
      match,
  };
}

// ============================================================
// ¿ETAPA TERMINADA?
//
// Una etapa está terminada cuando todos sus combates:
//
// - ya terminaron
// o
// - son BYE que no consumen tatami
// ============================================================

function etapaTerminada(
  combates
) {
  return combates.every(
    (combate) =>
      combate.estado_base ===
        "FINALIZADO" ||
      combate.estado_base ===
        "BYE_NO_OCUPA_TATAMI"
  );
}

// ============================================================
// OBTENER PRIMERA ETAPA PENDIENTE
// ============================================================

function obtenerEtapaActiva(
  combates
) {
  const numeros =
    [
      ...new Set(
        combates.map(
          (combate) =>
            combate.macro_etapa
        )
      ),
    ].sort(
      (a, b) =>
        a - b
    );

  for (
    const numero
    of numeros
  ) {
    const etapa =
      combates.filter(
        (combate) =>
          combate.macro_etapa ===
          numero
      );

    if (
      !etapaTerminada(
        etapa
      )
    ) {
      return numero;
    }
  }

  return null;
}

// ============================================================
// ESTADOS PARA ELIMINATORIAS
// ============================================================

function aplicarEstadosEliminatoria(
  combates
) {
  const etapaActiva =
    obtenerEtapaActiva(
      combates
    );

  for (
    const combate
    of combates
  ) {
    // --------------------------------------------------------
    // YA TERMINADO
    // --------------------------------------------------------

    if (
      combate.estado_base ===
      "FINALIZADO"
    ) {
      combate.estado =
        "FINALIZADO";

      combate.ocupa_tatami =
        false;

      continue;
    }

    // --------------------------------------------------------
    // BYE
    // --------------------------------------------------------

    if (
      combate.estado_base ===
      "BYE_NO_OCUPA_TATAMI"
    ) {
      combate.estado =
        "BYE_NO_OCUPA_TATAMI";

      combate.ocupa_tatami =
        false;

      continue;
    }

    // --------------------------------------------------------
    // PARTICIPANTES TODAVÍA NO CONOCIDOS
    // --------------------------------------------------------

    if (
      combate.estado_base ===
      "BLOQUEADO_POR_RESULTADO"
    ) {
      combate.estado =
        "BLOQUEADO_POR_RESULTADO";

      combate.ocupa_tatami =
        false;

      continue;
    }

    // --------------------------------------------------------
    // DOS COMPETIDORES CONOCIDOS
    //
    // Pero solo la etapa actual puede liberarse.
    // --------------------------------------------------------

    if (
      combate.estado_base ===
      "CANDIDATO_LISTO"
    ) {
      if (
        etapaActiva !== null &&
        combate.macro_etapa ===
          etapaActiva
      ) {
        combate.estado =
          "LISTO";

        combate.ocupa_tatami =
          true;

        combate.requiere_control_descanso =
          true;
      } else {
        combate.estado =
          "PLANIFICADO_FUTURO";

        combate.ocupa_tatami =
          false;

        combate.requiere_control_descanso =
          true;
      }

      continue;
    }

    combate.estado =
      "REVISAR";
  }

  return etapaActiva;
}

// ============================================================
// ESTADOS PARA TODOS CONTRA TODOS
//
// IMPORTANTE:
//
// Aunque JudoShiai conoce desde el inicio
// todos los participantes de los 6 combates,
// NO queremos que todas las pasadas estén
// habilitadas a la vez.
//
// Solo liberamos la primera pasada pendiente.
//
// Ejemplo:
//
// Pasada 1 → LISTO
// Pasada 2 → PLANIFICADO_FUTURO
// Pasada 3 → PLANIFICADO_FUTURO
//
// Cuando termina Pasada 1:
//
// Pasada 2 → LISTO
// Pasada 3 → PLANIFICADO_FUTURO
// ============================================================

function aplicarEstadosPool(
  combates
) {
  const etapaActiva =
    obtenerEtapaActiva(
      combates
    );

  for (
    const combate
    of combates
  ) {
    if (
      combate.estado_base ===
      "FINALIZADO"
    ) {
      combate.estado =
        "FINALIZADO";

      combate.ocupa_tatami =
        false;

      continue;
    }

    if (
      combate.estado_base ===
      "BYE_NO_OCUPA_TATAMI"
    ) {
      combate.estado =
        "BYE_NO_OCUPA_TATAMI";

      combate.ocupa_tatami =
        false;

      continue;
    }

    if (
      combate.estado_base ===
      "BLOQUEADO_POR_RESULTADO"
    ) {
      combate.estado =
        "BLOQUEADO_POR_RESULTADO";

      combate.ocupa_tatami =
        false;

      continue;
    }

    if (
      combate.estado_base ===
      "CANDIDATO_LISTO"
    ) {
      if (
        etapaActiva !== null &&
        combate.macro_etapa ===
          etapaActiva
      ) {
        combate.estado =
          "LISTO";

        combate.ocupa_tatami =
          true;

        combate.requiere_control_descanso =
          true;
      } else {
        combate.estado =
          "PLANIFICADO_FUTURO";

        combate.ocupa_tatami =
          false;

        combate.requiere_control_descanso =
          true;
      }

      continue;
    }

    combate.estado =
      "REVISAR";
  }

  return etapaActiva;
}

// ============================================================
// OBTENER MATCH POR NÚMERO
// ============================================================

function obtenerCombateNumero(
  combates,
  numero
) {
  return combates.find(
    (combate) =>
      Number(
        combate.numero
      ) === numero
  );
}

// ============================================================
// ESTADOS PARA MEJOR DE 3
//
// REGLAS:
//
// #1
// → LISTO inicialmente.
//
// #2
// → PLANIFICADO_FUTURO hasta terminar #1.
//
// Después de #1:
// #2 → LISTO.
//
// #3
// → BLOQUEADO_POR_SERIE
// mientras no terminen #1 y #2.
//
// Si tras #1 y #2:
// 2-0 → NO_NECESARIO.
//
// Si tras #1 y #2:
// 1-1 → LISTO.
//
// Después el planificador de tatami todavía
// deberá comprobar el DESCANSO.
// ============================================================

function aplicarEstadosMejorDe3(
  combates
) {
  const combate1 =
    obtenerCombateNumero(
      combates,
      1
    );

  const combate2 =
    obtenerCombateNumero(
      combates,
      2
    );

  const combate3 =
    obtenerCombateNumero(
      combates,
      3
    );

  if (
    !combate1 ||
    !combate2 ||
    !combate3
  ) {
    throw new Error(
      "Mejor de 3 incompleto: faltan #1, #2 o #3."
    );
  }

  // ==========================================================
  // COMBATE 1
  // ==========================================================

  if (
    combate1.estado_base ===
    "FINALIZADO"
  ) {
    combate1.estado =
      "FINALIZADO";

    combate1.ocupa_tatami =
      false;
  } else if (
    combate1.estado_base ===
    "CANDIDATO_LISTO"
  ) {
    combate1.estado =
      "LISTO";

    combate1.ocupa_tatami =
      true;

    combate1.requiere_control_descanso =
      true;
  } else {
    combate1.estado =
      combate1.estado_base;

    combate1.ocupa_tatami =
      false;
  }

  // ==========================================================
  // COMBATE 2
  // ==========================================================

  if (
    combate2.estado_base ===
    "FINALIZADO"
  ) {
    combate2.estado =
      "FINALIZADO";

    combate2.ocupa_tatami =
      false;
  } else if (
    combate1.estado_base ===
      "FINALIZADO" &&
    combate2.estado_base ===
      "CANDIDATO_LISTO"
  ) {
    /*
     * La dependencia deportiva se cumplió.
     *
     * Aun así el planificador deberá colocar
     * otros combates entre medio para descanso.
     */

    combate2.estado =
      "LISTO";

    combate2.ocupa_tatami =
      true;

    combate2.requiere_control_descanso =
      true;
  } else if (
    combate2.estado_base ===
    "CANDIDATO_LISTO"
  ) {
    combate2.estado =
      "PLANIFICADO_FUTURO";

    combate2.ocupa_tatami =
      false;

    combate2.requiere_control_descanso =
      true;
  } else {
    combate2.estado =
      combate2.estado_base;

    combate2.ocupa_tatami =
      false;
  }

  // ==========================================================
  // COMBATE 3
  // ==========================================================

  if (
    combate3.estado_base ===
    "FINALIZADO"
  ) {
    combate3.estado =
      "FINALIZADO";

    combate3.ocupa_tatami =
      false;

    return 3;
  }

  const resultado1 =
    resultadoMatch(
      combate1.match_original
    );

  const resultado2 =
    resultadoMatch(
      combate2.match_original
    );

  // ----------------------------------------------------------
  // AÚN NO TERMINAN LOS DOS PRIMEROS
  // ----------------------------------------------------------

  if (
    !resultado1 ||
    !resultado2
  ) {
    combate3.estado =
      "BLOQUEADO_POR_SERIE";

    combate3.ocupa_tatami =
      false;

    combate3.requiere_control_descanso =
      true;

    if (
      combate1.estado ===
      "LISTO"
    ) {
      return 1;
    }

    if (
      combate2.estado ===
      "LISTO"
    ) {
      return 2;
    }

    return null;
  }

  // ----------------------------------------------------------
  // RESULTADO INDETERMINADO
  // ----------------------------------------------------------

  if (
    resultado1.ganadorId ===
      null ||
    resultado2.ganadorId ===
      null
  ) {
    combate3.estado =
      "REVISAR_SERIE";

    combate3.ocupa_tatami =
      false;

    return null;
  }

  // ----------------------------------------------------------
  // MISMO GANADOR EN #1 Y #2
  //
  // Serie 2-0.
  // No necesitamos #3.
  // ----------------------------------------------------------

  if (
    resultado1.ganadorId ===
    resultado2.ganadorId
  ) {
    combate3.estado =
      "NO_NECESARIO";

    combate3.ocupa_tatami =
      false;

    return null;
  }

  // ----------------------------------------------------------
  // GANADORES DISTINTOS
  //
  // Serie 1-1.
  // El tercero sí es necesario.
  // ----------------------------------------------------------

  if (
    combate3.estado_base ===
    "CANDIDATO_LISTO"
  ) {
    combate3.estado =
      "LISTO";

    combate3.ocupa_tatami =
      true;

    combate3.requiere_control_descanso =
      true;

    return 3;
  }

  combate3.estado =
    combate3.estado_base;

  combate3.ocupa_tatami =
    false;

  return null;
}

// ============================================================
// APLICAR MOTOR DE ESTADOS SEGÚN TIPO
// ============================================================

function aplicarEstadosOperativos(
  tipo,
  combates
) {
  if (
    tipo ===
    "ELIMINATORIA"
  ) {
    return aplicarEstadosEliminatoria(
      combates
    );
  }

  if (
    tipo ===
    "TODOS_CONTRA_TODOS"
  ) {
    return aplicarEstadosPool(
      combates
    );
  }

  if (
    tipo ===
    "MEJOR_DE_3"
  ) {
    return aplicarEstadosMejorDe3(
      combates
    );
  }

  for (
    const combate
    of combates
  ) {
    combate.estado =
      combate.estado_base;

    combate.ocupa_tatami =
      combate.estado ===
      "CANDIDATO_LISTO";
  }

  return null;
}

// ============================================================
// AGRUPAR POR MACRO-ETAPA
// ============================================================

function agruparPorEtapa(
  combates
) {
  const mapa =
    new Map();

  for (
    const combate
    of combates
  ) {
    const numero =
      combate.macro_etapa;

    if (
      !mapa.has(
        numero
      )
    ) {
      mapa.set(
        numero,
        {
          numero,

          nombre:
            combate.macro_nombre,

          combates: [],
        }
      );
    }

    mapa
      .get(numero)
      .combates
      .push(
        combate
      );
  }

  return [
    ...mapa.values(),
  ].sort(
    (a, b) =>
      a.numero -
      b.numero
  );
}

// ============================================================
// CONTAR ESTADOS
// ============================================================

function contarEstado(
  combates,
  estado
) {
  return combates.filter(
    (combate) =>
      combate.estado ===
      estado
  ).length;
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
    "      V3 — MAPEO DE RONDAS + ESTADOS OPERATIVOS"
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
    // PERSONAS
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

    const personasPorId =
      new Map();

    for (
      const persona
      of personas
    ) {
      personasPorId.set(
        Number(
          persona.id
        ),
        persona
      );
    }

    // ========================================================
    // SQL
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
    // PROCESAR CATEGORÍAS
    // ========================================================

    for (
      const nombre
      of categoriasObjetivo
    ) {
      const categoria =
        obtenerCategoria.get(
          nombre
        );

      if (
        !categoria
      ) {
        throw new Error(
          `No existe "${nombre}".`
        );
      }

      const matches =
        obtenerMatches.all(
          Number(
            categoria.id
          )
        );

      const estructura =
        construirMapaCategoria(
          categoria,
          matches
        );

      if (
        estructura.mapa.size ===
        0
      ) {
        console.log(
          `⚠️ ${categoria.categoria}: sistema todavía no soportado.`
        );

        continue;
      }

      // ======================================================
      // CONVERTIR MATCHES
      // ======================================================

      const combatesMapeados =
        [];

      for (
        const match
        of matches
      ) {
        const infoRonda =
          estructura.mapa.get(
            Number(
              match.number
            )
          );

        if (
          !infoRonda
        ) {
          throw new Error(
            [
              `${categoria.categoria}:`,
              `#${match.number}`,
              "no tiene ronda mapeada.",
            ].join(" ")
          );
        }

        combatesMapeados.push(
          convertirMatchV3({
            match,
            infoRonda,
            personasPorId,
          })
        );
      }

      // ======================================================
      // ESTADO OPERATIVO
      // ======================================================

      const etapaActiva =
        aplicarEstadosOperativos(
          estructura.tipo,
          combatesMapeados
        );

      const etapas =
        agruparPorEtapa(
          combatesMapeados
        );

      // ======================================================
      // MOSTRAR
      // ======================================================

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
        `Tipo: ${estructura.tipo}`
      );

      console.log(
        `Sistema: ${nombreSistema(
          categoria.system
        )}`
      );

      console.log(
        `Tabla: ${categoria.tabla}`
      );

      console.log(
        `Competidores: ${categoria.numcomp}`
      );

      console.log(
        `Combates generados: ${matches.length}`
      );

      if (
        estructura.tamanoLlave
      ) {
        console.log(
          `Tamaño de llave: ${estructura.tamanoLlave}`
        );
      }

      if (
        etapaActiva !==
        null
      ) {
        console.log(
          `Etapa activa: ${etapaActiva}`
        );
      }

      console.log("");

      for (
        const etapa
        of etapas
      ) {
        console.log(
          `── ETAPA ${etapa.numero}: ${etapa.nombre}`
        );

        console.log("");

        console.table(
          etapa.combates.map(
            (combate) => ({
              "#":
                combate.numero,

              Subetapa:
                combate.subetapa,

              Blue:
                combate.blue,

              White:
                combate.white,

              Estado:
                combate.estado,

              "Tatami ahora":
                combate.ocupa_tatami
                  ? "Sí"
                  : "No",
            })
          )
        );

        console.log("");
      }

      // ======================================================
      // RESUMEN DE CATEGORÍA
      // ======================================================

      const resumen = {
        total:
          combatesMapeados.length,

        listos:
          contarEstado(
            combatesMapeados,
            "LISTO"
          ),

        futuros:
          contarEstado(
            combatesMapeados,
            "PLANIFICADO_FUTURO"
          ),

        bloqueadosResultado:
          contarEstado(
            combatesMapeados,
            "BLOQUEADO_POR_RESULTADO"
          ),

        bloqueadosSerie:
          contarEstado(
            combatesMapeados,
            "BLOQUEADO_POR_SERIE"
          ),

        byes:
          contarEstado(
            combatesMapeados,
            "BYE_NO_OCUPA_TATAMI"
          ),

        noNecesarios:
          contarEstado(
            combatesMapeados,
            "NO_NECESARIO"
          ),

        finalizados:
          contarEstado(
            combatesMapeados,
            "FINALIZADO"
          ),
      };

      console.log(
        `✅ Listos ahora: ${resumen.listos}`
      );

      console.log(
        `🕒 Planificados futuros: ${resumen.futuros}`
      );

      console.log(
        `🔒 Bloqueados por resultados: ${resumen.bloqueadosResultado}`
      );

      console.log(
        `🔐 Bloqueados por serie: ${resumen.bloqueadosSerie}`
      );

      console.log(
        `👻 Bye/Ghost: ${resumen.byes}`
      );

      console.log(
        `⛔ No necesarios: ${resumen.noNecesarios}`
      );

      console.log(
        `🏁 Finalizados: ${resumen.finalizados}`
      );

      console.log("");

      // ======================================================
      // QUITAR MATCH ORIGINAL ANTES DEL JSON
      // ======================================================

      for (
        const combate
        of combatesMapeados
      ) {
        delete combate.match_original;
      }

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

          system:
            Number(
              categoria.system
            ),

          sistema:
            nombreSistema(
              categoria.system
            ),

          table:
            Number(
              categoria.tabla
            ),

          competidores:
            Number(
              categoria.numcomp
            ),

          tipo:
            estructura.tipo,

          tamano_llave:
            estructura.tamanoLlave ||
            null,

          etapa_activa:
            etapaActiva,
        },

        etapas,

        resumen,
      });
    }

    // ========================================================
    // RESUMEN GENERAL
    // ========================================================

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

    console.table(
      resultado.map(
        (item) => ({
          Categoría:
            item.categoria.nombre,

          Tipo:
            item.categoria.tipo,

          Sistema:
            item.categoria.sistema,

          Competidores:
            item.categoria.competidores,

          Total:
            item.resumen.total,

          Listos:
            item.resumen.listos,

          Futuros:
            item.resumen.futuros,

          "Bloq. resultado":
            item.resumen
              .bloqueadosResultado,

          "Bloq. serie":
            item.resumen
              .bloqueadosSerie,

          Byes:
            item.resumen.byes,

          "No necesario":
            item.resumen
              .noNecesarios,

          Finalizados:
            item.resumen.finalizados,
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

    const contenido = {
      generado_en:
        new Date()
          .toISOString(),

      version:
        "v3_mapeo_rondas_estados_operativos",

      modo:
        "solo_lectura",

      estados: {
        LISTO:
          "La estructura permite este combate. El planificador todavía debe validar descanso.",

        PLANIFICADO_FUTURO:
          "Participantes conocidos, pero debe esperar la etapa anterior.",

        BLOQUEADO_POR_RESULTADO:
          "Falta conocer ganador o perdedor de otro combate.",

        BLOQUEADO_POR_SERIE:
          "No se sabe todavía si este combate de Mejor de 3 será necesario.",

        NO_NECESARIO:
          "Combate condicional que ya no debe realizarse.",

        BYE_NO_OCUPA_TATAMI:
          "Avance automático. No consume un combate real en el tatami.",

        FINALIZADO:
          "Combate ya disputado.",
      },

      reglas: {
        ijf_tabla_validada:
          7,

        pool_por_pasadas:
          true,

        mejor_de_3_secuencial:
          true,

        mejor_de_3_tercer_combate_condicional:
          true,

        fases_futuras_bloqueadas:
          true,

        descanso:
          "Se calculará en planificarTatamiV3.js",

        descanso_referencia:
          "3-6 bueno; >6 permitido por cierre de ronda; mínimo 2 preferido; 1 emergencia; 0 pausa manual",
      },

      categorias:
        resultado,
    };

    const ruta =
      path.resolve(
        carpetaPropuestas,
        `rondas-llaves-${selloFecha()}.json`
      );

    const rutaLatest =
      path.resolve(
        carpetaPropuestas,
        "rondas-llaves-latest.json"
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

    console.log("");

    console.log(
      "💾 Mapeo guardado:"
    );

    console.log(
      ruta
    );

    console.log("");

    console.log(
      "💾 Último mapeo:"
    );

    console.log(
      rutaLatest
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
} catch (
  error
) {
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