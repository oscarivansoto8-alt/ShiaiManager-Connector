require("dotenv").config();

const WebSocket = require("ws");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const JUDOSHIAI_URL =
  process.env.JUDOSHIAI_URL || "ws://localhost:2318/info_pw_";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TIEMPO_RECONEXION_MS = 3000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Faltan las variables de Supabase en el archivo .env");
  console.error("");
  console.error("El archivo .env debe contener:");
  console.error("SUPABASE_URL=...");
  console.error("SUPABASE_SERVICE_KEY=...");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
);

const ultimosDatosPorTatami = new Map();

let ws = null;
let cerrandoPrograma = false;
let reconexionProgramada = false;
let primeraColaRecibida = false;
let identificadorTorneoActual = "";
let limpiandoBaseDeDatos = false;

/*
  Esta promesa evita que se procesen dos mensajes simultáneamente.
  Así no se mezclan las operaciones de limpieza y guardado.
*/
let colaProcesamiento = Promise.resolve();

mostrarInicio();
configurarComandosDeTerminal();
conectarConJudoShiai();

function mostrarInicio() {
  console.clear();

  console.log("==========================================");
  console.log("       ShiaiManager Connector");
  console.log("==========================================");
  console.log("");
  console.log("Conectando con JudoShiai...");
  console.log("");
}

function conectarConJudoShiai() {
  if (cerrandoPrograma) {
    return;
  }

  reconexionProgramada = false;

  ws = new WebSocket(JUDOSHIAI_URL, "js", {
    headers: {
      Origin: "http://localhost:8088",
    },
  });

  ws.on("open", () => {
    console.log("✅ Conectado a JudoShiai");
    console.log("✅ Supabase configurado");
    console.log("");
    console.log("Esperando información de los tatamis...");
    console.log("");
    console.log("Comandos disponibles:");
    console.log("N + Enter = comenzar un torneo nuevo");
    console.log("L + Enter = limpiar combates");
    console.log("");
  });

  ws.on("message", (data) => {
    colaProcesamiento = colaProcesamiento
      .then(() => procesarMensaje(data))
      .catch((error) => {
        console.error("");
        console.error("❌ No se pudo procesar un mensaje:");
        console.error(error.message);
        console.error("");
      });
  });

  ws.on("close", () => {
    console.log("");
    console.log("❌ Se cerró la conexión con JudoShiai.");

    programarReconexion();
  });

  ws.on("error", (error) => {
    console.log("");
    console.log("❌ Error de conexión con JudoShiai:");
    console.log(error.message);

    programarReconexion();
  });
}

function programarReconexion() {
  if (
    cerrandoPrograma ||
    reconexionProgramada
  ) {
    return;
  }

  reconexionProgramada = true;

  console.log(
    `🔄 Se intentará reconectar en ${
      TIEMPO_RECONEXION_MS / 1000
    } segundos...`
  );

  setTimeout(() => {
    conectarConJudoShiai();
  }, TIEMPO_RECONEXION_MS);
}

async function procesarMensaje(data) {
  let mensaje;

  try {
    mensaje = JSON.parse(data.toString());
  } catch {
    return;
  }

  if (
    !mensaje ||
    !Array.isArray(mensaje.msg)
  ) {
    return;
  }

  const datos = mensaje.msg;

  /*
    Solo procesamos mensajes correspondientes
    a la cola de combates de JudoInfo.
  */
  if (
    datos[0] !== 5 ||
    datos[1] !== 1
  ) {
    return;
  }

  const tatami = Number(datos[4]);

  if (
    !Number.isInteger(tatami) ||
    tatami <= 0
  ) {
    return;
  }

  const identificadorRecibido =
    obtenerIdentificadorTorneo(datos);

  /*
    Al recibir la primera cola después de iniciar
    el conector, se eliminan los datos anteriores.
  */
  if (!primeraColaRecibida) {
    primeraColaRecibida = true;

    await limpiarTodosLosCombates();

    ultimosDatosPorTatami.clear();

    if (identificadorRecibido) {
      identificadorTorneoActual =
        identificadorRecibido;
    }

    console.log(
      "🧹 Se eliminaron los combates antiguos."
    );
    console.log("");
  } else if (
    identificadorRecibido &&
    identificadorTorneoActual &&
    identificadorRecibido !==
      identificadorTorneoActual
  ) {
    /*
      Si JudoInfo entrega un identificador diferente,
      se considera que se abrió un nuevo torneo.
    */
    console.log("");
    console.log(
      "🔄 Se detectó un posible cambio de torneo."
    );

    await prepararNuevoTorneo(false);

    identificadorTorneoActual =
      identificadorRecibido;

    console.log(
      "✅ El nuevo torneo quedó preparado."
    );
    console.log("");
  } else if (
    identificadorRecibido &&
    !identificadorTorneoActual
  ) {
    identificadorTorneoActual =
      identificadorRecibido;
  }

  const combates =
    convertirMensajeEnCombates(
      datos,
      tatami
    );

  const firmaActual =
    crearFirmaDeCombates(combates);

  const firmaAnterior =
    ultimosDatosPorTatami.get(tatami);

  /*
    Evita guardar muchas veces exactamente
    la misma cola.
  */
  if (firmaActual === firmaAnterior) {
    return;
  }

  await guardarCombatesEnSupabase(
    tatami,
    combates
  );

  ultimosDatosPorTatami.set(
    tatami,
    firmaActual
  );

  mostrarResumen(
    tatami,
    combates
  );
}

function obtenerIdentificadorTorneo(datos) {
  /*
    JudoInfo puede entregar información del torneo
    dentro de los primeros valores del mensaje.

    Se usa datos[3] únicamente cuando contiene
    texto o un número válido.
  */
  const valor = datos[3];

  if (
    typeof valor !== "string" &&
    typeof valor !== "number"
  ) {
    return "";
  }

  const identificador =
    String(valor).trim();

  if (
    !identificador ||
    identificador === "0"
  ) {
    return "";
  }

  return identificador;
}

function convertirMensajeEnCombates(
  datos,
  tatami
) {
  const combates = [];

  let categoriaActual = "";
  let posicion = 1;
  let indice = 16;

  while (indice < datos.length) {
    const valor = datos[indice];

    if (typeof valor !== "string") {
      indice += 1;
      continue;
    }

    const texto = valor.trim();

    if (!texto) {
      indice += 1;
      continue;
    }

    /*
      Cuando no contiene tabulaciones,
      normalmente corresponde al nombre
      de una categoría.
    */
    if (!texto.includes("\t")) {
      categoriaActual = texto;
      indice += 1;
      continue;
    }

    const competidorBlanco =
      separarCompetidor(texto);

    const siguienteValor =
      datos[indice + 1];

    let competidorAzul = {
      apellido: "",
      nombre: "",
      sexo: "",
      club: "",
    };

    if (
      typeof siguienteValor === "string" &&
      siguienteValor.includes("\t")
    ) {
      competidorAzul =
        separarCompetidor(
          siguienteValor
        );

      indice += 1;
    }

    combates.push({
      tatami,
      posicion,
      categoria: categoriaActual,

      apellido_blanco:
        competidorBlanco.apellido,

      nombre_blanco:
        competidorBlanco.nombre,

      club_blanco:
        competidorBlanco.club,

      apellido_azul:
        competidorAzul.apellido,

      nombre_azul:
        competidorAzul.nombre,

      club_azul:
        competidorAzul.club,

      actualizado_en:
        new Date().toISOString(),
    });

    posicion += 1;
    indice += 1;
  }

  return combates;
}

function separarCompetidor(texto) {
  const partes = texto.split("\t");

  return {
    apellido:
      partes[0]?.trim() || "",

    nombre:
      partes[1]?.trim() || "",

    sexo:
      partes[2]?.trim() || "",

    club:
      partes[3]?.trim() || "",
  };
}

function crearFirmaDeCombates(combates) {
  const combatesSinFecha =
    combates.map((combate) => ({
      tatami: combate.tatami,
      posicion: combate.posicion,
      categoria: combate.categoria,

      apellido_blanco:
        combate.apellido_blanco,

      nombre_blanco:
        combate.nombre_blanco,

      club_blanco:
        combate.club_blanco,

      apellido_azul:
        combate.apellido_azul,

      nombre_azul:
        combate.nombre_azul,

      club_azul:
        combate.club_azul,
    }));

  return JSON.stringify(
    combatesSinFecha
  );
}

async function guardarCombatesEnSupabase(
  tatami,
  combates
) {
  if (combates.length === 0) {
    const { error } = await supabase
      .from("combates_en_vivo")
      .delete()
      .eq("tatami", tatami);

    if (error) {
      throw new Error(
        `No se pudo limpiar el Tatami ${tatami}: ${error.message}`
      );
    }

    return;
  }

  const { error: errorGuardado } =
    await supabase
      .from("combates_en_vivo")
      .upsert(combates, {
        onConflict:
          "tatami,posicion",
      });

  if (errorGuardado) {
    throw new Error(
      `No se pudo guardar el Tatami ${tatami}: ${errorGuardado.message}`
    );
  }

  /*
    Borra posiciones antiguas si ahora
    el tatami tiene menos combates.
  */
  const { error: errorLimpieza } =
    await supabase
      .from("combates_en_vivo")
      .delete()
      .eq("tatami", tatami)
      .gt(
        "posicion",
        combates.length
      );

  if (errorLimpieza) {
    throw new Error(
      `Se guardó el Tatami ${tatami}, pero no se pudieron borrar filas antiguas: ${errorLimpieza.message}`
    );
  }
}

async function limpiarTodosLosCombates() {
  if (limpiandoBaseDeDatos) {
    return;
  }

  limpiandoBaseDeDatos = true;

  try {
    /*
      Como los tatamis válidos son mayores
      que cero, esta condición elimina
      todas las filas existentes.
    */
    const { error } = await supabase
      .from("combates_en_vivo")
      .delete()
      .gte("tatami", 0);

    if (error) {
      throw new Error(
        `No se pudieron limpiar los combates: ${error.message}`
      );
    }
  } finally {
    limpiandoBaseDeDatos = false;
  }
}

async function prepararNuevoTorneo(
  mostrarMensaje = true
) {
  if (mostrarMensaje) {
    console.log("");
    console.log(
      "🔄 Preparando un torneo nuevo..."
    );
  }

  await limpiarTodosLosCombates();

  ultimosDatosPorTatami.clear();

  identificadorTorneoActual = "";

  /*
    Se mantiene primeraColaRecibida en true
    para evitar una segunda limpieza cuando
    llegue el primer tatami del nuevo torneo.
  */
  primeraColaRecibida = true;

  if (mostrarMensaje) {
    console.log(
      "✅ Combates anteriores eliminados."
    );

    console.log(
      "✅ Esperando los combates del nuevo torneo."
    );

    console.log("");
  }
}

function configurarComandosDeTerminal() {
  const terminal =
    readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

  terminal.on(
    "line",
    async (entrada) => {
      const comando =
        entrada
          .trim()
          .toLowerCase();

      if (
        comando === "n" ||
        comando === "nuevo"
      ) {
        try {
          await prepararNuevoTorneo();
        } catch (error) {
          console.error("");
          console.error(
            "❌ No se pudo preparar el torneo nuevo:"
          );
          console.error(
            error.message
          );
          console.error("");
        }

        return;
      }

      if (
        comando === "l" ||
        comando === "limpiar"
      ) {
        try {
          await limpiarTodosLosCombates();

          ultimosDatosPorTatami.clear();

          console.log("");
          console.log(
            "✅ Tabla combates_en_vivo limpiada."
          );
          console.log("");
        } catch (error) {
          console.error("");
          console.error(
            "❌ No se pudieron limpiar los combates:"
          );
          console.error(
            error.message
          );
          console.error("");
        }

        return;
      }

      if (comando) {
        console.log("");
        console.log(
          "Comando desconocido."
        );
        console.log(
          "Usa N para torneo nuevo o L para limpiar."
        );
        console.log("");
      }
    }
  );
}

function mostrarResumen(
  tatami,
  combates
) {
  console.clear();

  console.log("==========================================");
  console.log("       ShiaiManager Connector");
  console.log("==========================================");
  console.log("");
  console.log("✅ JudoShiai conectado");
  console.log("✅ Supabase conectado");
  console.log("");
  console.log(
    `Tatami actualizado: ${tatami}`
  );
  console.log(
    `Combates guardados: ${combates.length}`
  );
  console.log(
    `Hora: ${new Date().toLocaleTimeString()}`
  );
  console.log("");

  combates.forEach((combate) => {
    console.log(
      "------------------------------------------"
    );

    console.log(
      `Posición ${combate.posicion}`
    );

    console.log(
      `Categoría: ${
        combate.categoria ||
        "Sin categoría"
      }`
    );

    const blanco =
      `${combate.apellido_blanco} ${combate.nombre_blanco}`.trim();

    const azul =
      `${combate.apellido_azul} ${combate.nombre_azul}`.trim();

    console.log(
      `Blanco: ${
        blanco ||
        "Sin competidor"
      }`
    );

    console.log(
      `Club blanco: ${
        combate.club_blanco ||
        "Sin club"
      }`
    );

    console.log(
      `Azul: ${
        azul ||
        "Sin competidor"
      }`
    );

    console.log(
      `Club azul: ${
        combate.club_azul ||
        "Sin club"
      }`
    );
  });

  console.log("");
  console.log(
    "Esperando nuevas actualizaciones..."
  );
  console.log("");
  console.log(
    "N + Enter = comenzar un torneo nuevo"
  );
}

function cerrarConector() {
  cerrandoPrograma = true;

  console.log("");
  console.log(
    "Cerrando ShiaiManager Connector..."
  );

  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    ws.close();
  }

  setTimeout(() => {
    process.exit(0);
  }, 200);
}

process.on(
  "SIGINT",
  cerrarConector
);

process.on(
  "SIGTERM",
  cerrarConector
);