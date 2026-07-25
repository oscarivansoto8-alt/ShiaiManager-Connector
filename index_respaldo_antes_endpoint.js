require("dotenv").config();

const WebSocket = require("ws");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

const JUDOSHIAI_URL =
  process.env.JUDOSHIAI_URL || "ws://localhost:2318/info_pw_";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TIEMPO_RECONEXION_MS = 3000;
const TIEMPO_SINCRONIZACION_MS = 400;
const REGISTROS_POR_MENSAJE_516 = 11;
const VALORES_POR_REGISTRO_516 = 9;

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
const categoriasPorId = new Map();
const competidoresPorId = new Map();
const programacionPorTatami = new Map();
const definicionesSolicitadas = new Set();

let ws = null;
let cerrandoPrograma = false;
let reconexionProgramada = false;
let primeraProgramacionRecibida = false;
let identificadorTorneoActual = "";
let limpiandoBaseDeDatos = false;

let temporizadorSincronizacion = null;
let sincronizacionEnCurso = false;
let sincronizacionPendiente = false;

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

    solicitarInformacionCompleta();
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
    if (cerrandoPrograma) {
      return;
    }

    console.log("");
    console.log("❌ Se cerró la conexión con JudoShiai.");
    programarReconexion();
  });

  ws.on("error", (error) => {
    if (cerrandoPrograma) {
      return;
    }

    console.log("");
    console.log("❌ Error de conexión con JudoShiai:");
    console.log(error.message);
    programarReconexion();
  });
}

function solicitarInformacionCompleta() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  enviarMensaje([5, 11, 0, 7300]);
  enviarMensaje([5, 23, 0, 7300]);

  console.log("📤 Solicitudes 5-11 y 5-23 enviadas");
}

function enviarMensaje(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  ws.send(
    JSON.stringify({
      pw: "",
      msg,
    })
  );

  return true;
}

function programarReconexion() {
  if (cerrandoPrograma || reconexionProgramada) {
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

  if (!mensaje || !Array.isArray(mensaje.msg)) {
    return;
  }

  const datos = mensaje.msg;

  if (Number(datos[0]) !== 5) {
    return;
  }

  const tipoMensaje = Number(datos[1]);

  if (tipoMensaje === 9) {
    registrarDefinicion59(datos);
    programarSincronizacion();
    return;
  }

  if (tipoMensaje === 16) {
    await prepararRecepcionDeProgramacion(datos);
    registrarProgramacion516(datos);
    programarSincronizacion();
    return;
  }

  if (tipoMensaje === 24) {
    await sincronizarProgramacionCompleta();
  }
}

async function prepararRecepcionDeProgramacion(datos) {
  const identificadorRecibido =
    obtenerIdentificadorTorneo(datos);

  if (!primeraProgramacionRecibida) {
    primeraProgramacionRecibida = true;

    await limpiarTodosLosCombates();
    limpiarMemoriaDelTorneo();

    identificadorTorneoActual =
      identificadorRecibido || "";

    console.log("");
    console.log("🧹 Se eliminaron los combates antiguos.");
    console.log("");
    return;
  }

  if (
    identificadorRecibido &&
    identificadorTorneoActual &&
    identificadorRecibido !== identificadorTorneoActual
  ) {
    console.log("");
    console.log("🔄 Se detectó un cambio de torneo.");

    await limpiarTodosLosCombates();
    limpiarMemoriaDelTorneo();

    identificadorTorneoActual = identificadorRecibido;

    console.log("✅ El nuevo torneo quedó preparado.");
    console.log("");
    return;
  }

  if (
    identificadorRecibido &&
    !identificadorTorneoActual
  ) {
    identificadorTorneoActual = identificadorRecibido;
  }
}

function registrarDefinicion59(datos) {
  const id = Number(datos[4]);

  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  definicionesSolicitadas.delete(id);

  if (id >= 10000) {
    categoriasPorId.set(id, {
      id,
      nombre: String(datos[5] || "").trim(),
    });

    return;
  }

  competidoresPorId.set(id, {
    id,
    apellido: String(datos[5] || "").trim(),
    nombre: String(datos[6] || "").trim(),
    club: String(datos[7] || "").trim(),
  });
}

function registrarProgramacion516(datos) {
  const tatami = Number(datos[4]);

  if (!Number.isInteger(tatami) || tatami <= 0) {
    return;
  }

  programacionPorTatami.set(tatami, [...datos]);
}

function solicitarDefinicion(id) {
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    definicionesSolicitadas.has(id)
  ) {
    return;
  }

  if (enviarMensaje([5, 10, 0, 7300, id])) {
    definicionesSolicitadas.add(id);
  }
}

function convertirProgramacion516(datos) {
  const tatamiDelMensaje = Number(datos[4]);
  const combates = [];
  let faltanDatos = false;

  for (
    let numeroRegistro = 0;
    numeroRegistro < REGISTROS_POR_MENSAJE_516;
    numeroRegistro += 1
  ) {
    const indice =
      4 + numeroRegistro * VALORES_POR_REGISTRO_516;

    if (indice + 8 >= datos.length) {
      break;
    }

    const tatami = Number(datos[indice]);
    const posicion = Number(datos[indice + 1]);
    const categoriaId = Number(datos[indice + 2]);
    const numeroCombate = Number(datos[indice + 3]);
    const competidorBlancoId = Number(datos[indice + 4]);
    const competidorAzulId = Number(datos[indice + 5]);
    const estado = Number(datos[indice + 8]);

    if (
      tatami !== tatamiDelMensaje ||
      !Number.isInteger(posicion) ||
      posicion <= 0 ||
      !Number.isInteger(categoriaId) ||
      categoriaId <= 0
    ) {
      continue;
    }

    const categoria =
      categoriasPorId.get(categoriaId);

    const blanco =
      competidorBlancoId > 0
        ? competidoresPorId.get(competidorBlancoId)
        : null;

    const azul =
      competidorAzulId > 0
        ? competidoresPorId.get(competidorAzulId)
        : null;

    if (!categoria) {
      faltanDatos = true;
      solicitarDefinicion(categoriaId);
    }

    if (competidorBlancoId > 0 && !blanco) {
      faltanDatos = true;
      solicitarDefinicion(competidorBlancoId);
    }

    if (competidorAzulId > 0 && !azul) {
      faltanDatos = true;
      solicitarDefinicion(competidorAzulId);
    }

    combates.push({
      tatami,
      posicion,
      categoria: categoria?.nombre || "",

      apellido_blanco: blanco?.apellido || "",
      nombre_blanco: blanco?.nombre || "",
      club_blanco: blanco?.club || "",

      apellido_azul: azul?.apellido || "",
      nombre_azul: azul?.nombre || "",
      club_azul: azul?.club || "",

      actualizado_en: new Date().toISOString(),

      _numeroCombate: numeroCombate,
      _estado: estado,
    });
  }

  return {
    combates,
    faltanDatos,
  };
}

function programarSincronizacion() {
  if (temporizadorSincronizacion) {
    clearTimeout(temporizadorSincronizacion);
  }

  temporizadorSincronizacion = setTimeout(() => {
    temporizadorSincronizacion = null;

    sincronizarProgramacionCompleta().catch((error) => {
      console.error("");
      console.error(
        "❌ No se pudo sincronizar la programación:"
      );
      console.error(error.message);
      console.error("");
    });
  }, TIEMPO_SINCRONIZACION_MS);
}

async function sincronizarProgramacionCompleta() {
  if (sincronizacionEnCurso) {
    sincronizacionPendiente = true;
    return;
  }

  if (programacionPorTatami.size === 0) {
    return;
  }

  sincronizacionEnCurso = true;

  try {
    do {
      sincronizacionPendiente = false;
      await ejecutarSincronizacion();
    } while (sincronizacionPendiente);
  } finally {
    sincronizacionEnCurso = false;
  }
}

async function ejecutarSincronizacion() {
  const tatamis =
    [...programacionPorTatami.keys()]
      .sort((a, b) => a - b);

  let tatamisActualizados = 0;
  let tatamisSinCambios = 0;
  let tatamisEsperandoDatos = 0;
  let totalCombates = 0;

  for (const tatami of tatamis) {
    const datos = programacionPorTatami.get(tatami);

    if (!datos) {
      continue;
    }

    const resultado =
      convertirProgramacion516(datos);

    if (resultado.faltanDatos) {
      tatamisEsperandoDatos += 1;
      continue;
    }

    const combatesParaGuardar =
      resultado.combates.map((combate) => {
        const {
          _numeroCombate,
          _estado,
          ...combateSupabase
        } = combate;

        return combateSupabase;
      });

    totalCombates += combatesParaGuardar.length;

    const firmaActual =
      crearFirmaDeCombates(combatesParaGuardar);

    const firmaAnterior =
      ultimosDatosPorTatami.get(tatami);

    if (firmaActual === firmaAnterior) {
      tatamisSinCambios += 1;
      continue;
    }

    await guardarCombatesEnSupabase(
      tatami,
      combatesParaGuardar
    );

    ultimosDatosPorTatami.set(
      tatami,
      firmaActual
    );

    tatamisActualizados += 1;
  }

  mostrarResumenSincronizacion({
    tatamisRecibidos: tatamis.length,
    tatamisActualizados,
    tatamisSinCambios,
    tatamisEsperandoDatos,
    totalCombates,
  });
}

function obtenerIdentificadorTorneo(datos) {
  const valor = datos[3];

  if (
    typeof valor !== "string" &&
    typeof valor !== "number"
  ) {
    return "";
  }

  const identificador = String(valor).trim();

  if (!identificador || identificador === "0") {
    return "";
  }

  return identificador;
}

function crearFirmaDeCombates(combates) {
  const combatesSinFecha =
    combates.map((combate) => ({
      tatami: combate.tatami,
      posicion: combate.posicion,
      categoria: combate.categoria,

      apellido_blanco: combate.apellido_blanco,
      nombre_blanco: combate.nombre_blanco,
      club_blanco: combate.club_blanco,

      apellido_azul: combate.apellido_azul,
      nombre_azul: combate.nombre_azul,
      club_azul: combate.club_azul,
    }));

  return JSON.stringify(combatesSinFecha);
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
        onConflict: "tatami,posicion",
      });

  if (errorGuardado) {
    throw new Error(
      `No se pudo guardar el Tatami ${tatami}: ${errorGuardado.message}`
    );
  }

  const posicionMaxima = Math.max(
    ...combates.map((combate) => combate.posicion)
  );

  const { error: errorLimpieza } =
    await supabase
      .from("combates_en_vivo")
      .delete()
      .eq("tatami", tatami)
      .gt("posicion", posicionMaxima);

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

function limpiarMemoriaDelTorneo() {
  ultimosDatosPorTatami.clear();
  categoriasPorId.clear();
  competidoresPorId.clear();
  programacionPorTatami.clear();
  definicionesSolicitadas.clear();

  if (temporizadorSincronizacion) {
    clearTimeout(temporizadorSincronizacion);
    temporizadorSincronizacion = null;
  }
}

async function prepararNuevoTorneo(
  mostrarMensaje = true
) {
  if (mostrarMensaje) {
    console.log("");
    console.log("🔄 Preparando un torneo nuevo...");
  }

  await limpiarTodosLosCombates();
  limpiarMemoriaDelTorneo();

  identificadorTorneoActual = "";
  primeraProgramacionRecibida = true;

  if (mostrarMensaje) {
    console.log("✅ Combates anteriores eliminados.");
    console.log(
      "✅ Esperando los combates del nuevo torneo."
    );
    console.log("");
  }
}

function configurarComandosDeTerminal() {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  terminal.on("line", async (entrada) => {
    const comando =
      entrada.trim().toLowerCase();

    if (comando === "n" || comando === "nuevo") {
      try {
        await prepararNuevoTorneo();
        solicitarInformacionCompleta();
      } catch (error) {
        console.error("");
        console.error(
          "❌ No se pudo preparar el torneo nuevo:"
        );
        console.error(error.message);
        console.error("");
      }

      return;
    }

    if (comando === "l" || comando === "limpiar") {
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
        console.error(error.message);
        console.error("");
      }

      return;
    }

    if (comando) {
      console.log("");
      console.log("Comando desconocido.");
      console.log(
        "Usa N para torneo nuevo o L para limpiar."
      );
      console.log("");
    }
  });
}

function mostrarResumenSincronizacion({
  tatamisRecibidos,
  tatamisActualizados,
  tatamisSinCambios,
  tatamisEsperandoDatos,
  totalCombates,
}) {
  console.log("");
  console.log("==========================================");
  console.log("       PROGRAMACIÓN SINCRONIZADA");
  console.log("==========================================");
  console.log(`Tatamis recibidos: ${tatamisRecibidos}`);
  console.log(
    `Tatamis actualizados: ${tatamisActualizados}`
  );
  console.log(`Tatamis sin cambios: ${tatamisSinCambios}`);
  console.log(`Combates detectados: ${totalCombates}`);

  if (tatamisEsperandoDatos > 0) {
    console.log(
      `⏳ Esperando datos de ${tatamisEsperandoDatos} tatami(s)`
    );
  } else {
    console.log("✅ Programación completa lista");
  }

  console.log("==========================================");
  console.log("");
  console.log(
    "Esperando nuevas actualizaciones de JudoShiai..."
  );
  console.log("");
  console.log("N + Enter = comenzar un torneo nuevo");
  console.log("L + Enter = limpiar combates");
  console.log("");
}

function cerrarConector() {
  cerrandoPrograma = true;

  if (temporizadorSincronizacion) {
    clearTimeout(temporizadorSincronizacion);
    temporizadorSincronizacion = null;
  }

  console.log("");
  console.log("Cerrando ShiaiManager Connector...");

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  setTimeout(() => {
    process.exit(0);
  }, 200);
}

process.on("SIGINT", cerrarConector);
process.on("SIGTERM", cerrarConector);