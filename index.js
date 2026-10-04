require("dotenv").config();

const WebSocket = require("ws");
const readline = require("readline");
const {
  simularPropuestaOrden,
  aplicarPropuestaOrden,
} = require("./orden-propuesta");
const { createClient } = require("@supabase/supabase-js");

const JUDOSHIAI_URL =
  process.env.JUDOSHIAI_URL || "ws://localhost:2318/info_pw_";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TIEMPO_RECONEXION_MS = 3000;
const TIEMPO_SINCRONIZACION_MS = 400;
const TIEMPO_REVISION_ORDENES_MS = 2000;
const REGISTROS_POR_MENSAJE_516 = 11;
const VALORES_POR_REGISTRO_516 = 9;

const JUDOSHIAI_PROTOCOL_VERSION_CONFIGURADA =
  Number(process.env.JUDOSHIAI_PROTOCOL_VERSION || 0);

const JUDOSHIAI_PROTOCOL_VERSIONES_SOPORTADAS =
  [7, 5];

const JUDOSHIAI_HTTP_URL =
  process.env.JUDOSHIAI_HTTP_URL ||
  "http://127.0.0.1:8088/json";

const JUDOSHIAI_WEB_PASSWORD = String(
  process.env.JUDOSHIAI_WEB_PASSWORD || ""
);

const JUDOSHIAI_SHI_PATH = String(
  process.env.JUDOSHIAI_SHI_PATH || ""
).trim();

const MODO_PRUEBA_SEGURO =
  process.env.MODO_PRUEBA_SEGURO === "1";

const PERMITIR_APLICAR_ORDEN_PRUEBA =
  process.env.PERMITIR_APLICAR_ORDEN_PRUEBA ===
  "1";

const PERMITIR_REORDEN_WEB_PRUEBA =
  process.env.PERMITIR_REORDEN_WEB_PRUEBA ===
  "1";

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
let judoshiaiProtocolVersion =
  JUDOSHIAI_PROTOCOL_VERSION_CONFIGURADA || null;
let cerrandoPrograma = false;
let reconexionProgramada = false;
let primeraProgramacionRecibida = false;
let identificadorTorneoActual = "";
let limpiandoBaseDeDatos = false;

let temporizadorSincronizacion = null;
let sincronizacionEnCurso = false;
let sincronizacionPendiente = false;

let colaProcesamiento = Promise.resolve();

let ultimaPropuestaSimulada = null;

let temporizadorOrdenes = null;
let consultaOrdenesEnCurso = false;
let ultimoErrorDetectorOrdenes = "";

const ordenesWebDetectadas = new Set();

mostrarInicio();
configurarComandosDeTerminal();
iniciarDetectorOrdenes();
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

  if (!JUDOSHIAI_PROTOCOL_VERSION_CONFIGURADA) {
    judoshiaiProtocolVersion = null;
  }

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
    console.log("P tatami actual destino = simular nuevo orden");
    console.log("A CONFIRMAR = aplicar ultima simulacion de prueba");
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

  const versiones =
    judoshiaiProtocolVersion
      ? [judoshiaiProtocolVersion]
      : JUDOSHIAI_PROTOCOL_VERSIONES_SOPORTADAS;

  for (const version of versiones) {
    enviarMensaje([
      version,
      11,
      0,
      7300,
    ]);

    enviarMensaje([
      version,
      23,
      0,
      7300,
    ]);
  }

  if (judoshiaiProtocolVersion) {
    console.log(
      `📤 Solicitudes enviadas con protocolo ${judoshiaiProtocolVersion}`
    );
  } else {
    console.log(
      "📤 Detectando protocolo JudoShiai (7/5)..."
    );
  }
}

function enviarMensaje(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  ws.send(
    JSON.stringify({
      pw: JUDOSHIAI_WEB_PASSWORD,
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

  const versionRecibida = Number(datos[0]);

  if (
    !JUDOSHIAI_PROTOCOL_VERSIONES_SOPORTADAS.includes(
      versionRecibida
    )
  ) {
    return;
  }

  if (
    JUDOSHIAI_PROTOCOL_VERSION_CONFIGURADA &&
    versionRecibida !==
      JUDOSHIAI_PROTOCOL_VERSION_CONFIGURADA
  ) {
    return;
  }

  if (!judoshiaiProtocolVersion) {
    judoshiaiProtocolVersion = versionRecibida;
    console.log(
      `✅ Protocolo JudoShiai detectado: ${judoshiaiProtocolVersion}`
    );
  }

  if (versionRecibida !== judoshiaiProtocolVersion) {
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

  if (
    enviarMensaje([
      judoshiaiProtocolVersion,
      10,
      0,
      7300,
      id,
    ])
  ) {
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

async function obtenerProgramacionTatami(
  tatami,
  datosWebSocket
) {
  const operacionHttp =
    judoshiaiProtocolVersion === 7
      ? "matches_all"
      : judoshiaiProtocolVersion === 5
        ? "matches"
        : null;

  if (!operacionHttp) {
    return convertirProgramacion516(
      datosWebSocket
    );
  }

  try {
    const respuesta = await fetch(
      JUDOSHIAI_HTTP_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          op: operacionHttp,
          pw: JUDOSHIAI_WEB_PASSWORD,
          tatami,
        }),
      }
    );

    if (!respuesta.ok) {
      throw new Error(
        "HTTP " + respuesta.status
      );
    }

    const lista = await respuesta.json();

    if (!Array.isArray(lista)) {
      throw new Error(
        operacionHttp + " no devolvio un array"
      );
    }

    const actualizadoEn =
      new Date().toISOString();

    return {
      combates: lista.map(
        (combate, indice) => {
          const azul =
            combate?.comp1 || {};

          const blanco =
            combate?.comp2 || {};

          return {
            tatami,
            posicion: indice + 1,
            categoria: String(
              combate?.category || ""
            ).trim(),

            apellido_blanco: String(
              blanco.last || ""
            ).trim(),
            nombre_blanco: String(
              blanco.first || ""
            ).trim(),
            club_blanco: String(
              blanco.club || ""
            ).trim(),

            apellido_azul: String(
              azul.last || ""
            ).trim(),
            nombre_azul: String(
              azul.first || ""
            ).trim(),
            club_azul: String(
              azul.club || ""
            ).trim(),

            actualizado_en:
              actualizadoEn,

            _numeroCombate: Number(
              combate?.number || 0
            ),
            _estado: 0,
          };
        }
      ),
      faltanDatos: false,
    };
  } catch (error) {
    console.log(
      operacionHttp + " no disponible en Tatami " +
        tatami +
        "; usando WebSocket normal."
    );

    return convertirProgramacion516(
      datosWebSocket
    );
  }
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
      await obtenerProgramacionTatami(
        tatami,
        datos
      );

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
  if (MODO_PRUEBA_SEGURO) {
    console.log(
      "[PRUEBA SEGURA] Tatami " +
        tatami +
        ": se habrian guardado " +
        combates.length +
        " combates."
    );
    return;
  }

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
  if (MODO_PRUEBA_SEGURO) {
    console.log(
      "[PRUEBA SEGURA] NO se modifico Supabase."
    );
    return;
  }

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

function iniciarDetectorOrdenes() {
  if (temporizadorOrdenes) {
    return;
  }

  revisarOrdenesPendientes().catch(() => {});

  temporizadorOrdenes = setInterval(
    () => {
      revisarOrdenesPendientes().catch(() => {});
    },
    TIEMPO_REVISION_ORDENES_MS
  );
}

function normalizarOrdenWeb(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function validarCombateEsperado(
  orden,
  cambioPrincipal
) {
  const esperado =
    orden.combate_esperado &&
    typeof orden.combate_esperado === "object"
      ? orden.combate_esperado
      : {};

  const categoriaOrden =
    normalizarOrdenWeb(
      orden.categoria
    );

  const categoriaReal =
    normalizarOrdenWeb(
      cambioPrincipal.categoria
    );

  if (
    categoriaOrden &&
    categoriaOrden !== categoriaReal
  ) {
    throw new Error(
      "La categoria ya no coincide con JudoShiai."
    );
  }

  const blancoEsperado =
    normalizarOrdenWeb(
      esperado.blanco
    );

  const azulEsperado =
    normalizarOrdenWeb(
      esperado.azul
    );

  const nombreEsperado =
    normalizarOrdenWeb(
      esperado.nombre
    );

  const blancoReal =
    normalizarOrdenWeb(
      cambioPrincipal.blanco
    );

  const azulReal =
    normalizarOrdenWeb(
      cambioPrincipal.azul
    );

  if (
    blancoEsperado &&
    blancoEsperado !== blancoReal
  ) {
    throw new Error(
      "El competidor blanco ya no coincide con JudoShiai."
    );
  }

  if (
    azulEsperado &&
    azulEsperado !== azulReal
  ) {
    throw new Error(
      "El competidor azul ya no coincide con JudoShiai."
    );
  }

  if (
    nombreEsperado &&
    nombreEsperado !== blancoReal &&
    nombreEsperado !== azulReal
  ) {
    throw new Error(
      "El deportista esperado ya no aparece en ese combate."
    );
  }
}

async function actualizarEstadoOrdenWeb(
  orden,
  estado,
  mensaje,
  finalizada = false,
  estadoEsperado = "pendiente",
  incrementarIntento = true
) {
  const cambios = {
    estado,
    mensaje,
    actualizado_en:
      new Date().toISOString(),
  };

  if (incrementarIntento) {
    cambios.intentos =
      Number(orden.intentos || 0) + 1;
  }

  if (finalizada) {
    cambios.procesada_en =
      new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("ordenes_judoshiai")
    .update(cambios)
    .eq("id", orden.id)
    .eq("estado", estadoEsperado)
    .select("id, estado")
    .maybeSingle();

  if (error) {
    throw new Error(
      "No se pudo actualizar la orden " +
        orden.id +
        ": " +
        error.message
    );
  }

  return data;
}

async function validarOrdenWebContraJudoShiai(
  orden
) {
  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN ||
    judoshiaiProtocolVersion !== 7
  ) {
    return {
      esperando: true,
      motivo:
        "Esperando JudoShiai Custom protocolo 7.",
    };
  }

  const tatami =
    Number(orden.tatami);

  const posicionActual =
    Number(orden.posicion_actual);

  const posicionDestino =
    Number(orden.posicion_destino);

  if (
    !Number.isInteger(tatami) ||
    tatami <= 0
  ) {
    throw new Error(
      "Tatami invalido."
    );
  }

  if (
    !Number.isInteger(posicionActual) ||
    posicionActual < 3
  ) {
    throw new Error(
      "Seguridad: no se pueden mover las posiciones 1 o 2."
    );
  }

  if (
    !Number.isInteger(posicionDestino) ||
    posicionDestino <= posicionActual
  ) {
    throw new Error(
      "La posicion destino no es valida."
    );
  }

  const cambios =
    await simularPropuestaOrden({
      tatami,
      posicionActual,
      posicionDestino,
      protocolVersion:
        judoshiaiProtocolVersion,
      httpUrl:
        JUDOSHIAI_HTTP_URL,
      shiPath:
        JUDOSHIAI_SHI_PATH,
    });

  if (
    !Array.isArray(cambios) ||
    cambios.length < 2
  ) {
    throw new Error(
      "JudoShiai no devolvio un movimiento valido."
    );
  }

  const cambioPrincipal =
    cambios.find(
      (cambio) =>
        Number(cambio.posicion_actual) ===
        posicionActual
    );

  if (!cambioPrincipal) {
    throw new Error(
      "No se encontro el combate que la web intenta mover."
    );
  }

  validarCombateEsperado(
    orden,
    cambioPrincipal
  );

  return {
    esperando: false,
    cambios,
    cambioPrincipal,
  };
}

function esArchivoPruebaOrden() {
  return JUDOSHIAI_SHI_PATH
    .replace(/\\/g, "/")
    .toLowerCase()
    .endsWith("/prueba-simulador-orden.shi");
}

async function obtenerColaCustom(tatami) {
  const respuesta = await fetch(
    JUDOSHIAI_HTTP_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        op: "matches_all",
        pw: JUDOSHIAI_WEB_PASSWORD,
        tatami,
      }),
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      "matches_all respondio HTTP " +
        respuesta.status
    );
  }

  const lista = await respuesta.json();

  if (!Array.isArray(lista)) {
    throw new Error(
      "matches_all no devolvio un array."
    );
  }

  return lista;
}

async function aplicarOrdenWebViaJudoShiai(
  orden,
  validacion
) {
  if (!PERMITIR_REORDEN_WEB_PRUEBA) {
    throw new Error(
      "PERMITIR_REORDEN_WEB_PRUEBA no esta activado."
    );
  }

  if (judoshiaiProtocolVersion !== 7) {
    throw new Error(
      "El reordenamiento en vivo requiere JudoShiai Custom protocolo 7."
    );
  }

  if (!esArchivoPruebaOrden()) {
    throw new Error(
      "SEGURIDAD: por ahora solo se permite prueba-simulador-orden.shi."
    );
  }

  const principal =
    validacion.cambioPrincipal;

  const categoryId = Number(
    principal.category_id || 0
  );

  const numeroCombate = Number(
    principal.combate || 0
  );

  if (
    !Number.isInteger(categoryId) ||
    categoryId <= 0
  ) {
    throw new Error(
      "matches_all no entrego un category_id valido."
    );
  }

  if (
    !Number.isInteger(numeroCombate) ||
    numeroCombate <= 0
  ) {
    throw new Error(
      "Numero de combate invalido."
    );
  }

  const respuesta = await fetch(
    JUDOSHIAI_HTTP_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        op: "reorder_matches",
        pw: JUDOSHIAI_WEB_PASSWORD,
        tatami: Number(orden.tatami),
        from_position:
          Number(orden.posicion_actual),
        to_position:
          Number(orden.posicion_destino),
        expected_category_id:
          categoryId,
        expected_number:
          numeroCombate,
      }),
    }
  );

  if (!respuesta.ok) {
    throw new Error(
      "reorder_matches respondio HTTP " +
        respuesta.status
    );
  }

  const resultado =
    await respuesta.json();

  if (!resultado || resultado.ok !== true) {
    throw new Error(
      "JudoShiai no confirmo el reordenamiento."
    );
  }

  const cola =
    await obtenerColaCustom(
      Number(orden.tatami)
    );

  const destino =
    cola[
      Number(orden.posicion_destino) - 1
    ];

  if (!destino) {
    throw new Error(
      "No existe la posicion destino despues del cambio."
    );
  }

  if (
    Number(destino.category_id) !==
      categoryId ||
    Number(destino.number) !==
      numeroCombate
  ) {
    throw new Error(
      "La verificacion posterior del orden fallo."
    );
  }

  return {
    categoryId,
    numeroCombate,
    resultado,
  };
}
async function revisarOrdenesPendientes() {
  if (
    cerrandoPrograma ||
    consultaOrdenesEnCurso
  ) {
    return;
  }

  consultaOrdenesEnCurso = true;

  try {
    const { data, error } = await supabase
      .from("ordenes_judoshiai")
      .select(
        "id, created_at, tatami, posicion_actual, posicion_destino, categoria, combate_esperado, estado, intentos"
      )
      .eq("estado", "pendiente")
      .order(
        "created_at",
        { ascending: true }
      )
      .limit(20);

    if (error) {
      throw new Error(error.message);
    }

    ultimoErrorDetectorOrdenes = "";

    for (const orden of data ?? []) {
      const id = String(orden.id);

      if (
        ordenesWebDetectadas.has(id)
      ) {
        continue;
      }

      let validacion;

      try {
        validacion =
          await validarOrdenWebContraJudoShiai(
            orden
          );
      } catch (errorValidacion) {
        const mensaje =
          errorValidacion instanceof Error
            ? errorValidacion.message
            : String(errorValidacion);

        const actualizada =
          await actualizarEstadoOrdenWeb(
            orden,
            "rechazada",
            "Rechazada por Connector: " +
              mensaje,
            true
          );

        if (!actualizada) {
          continue;
        }

        ordenesWebDetectadas.add(id);

        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "       ORDEN WEB RECHAZADA"
        );
        console.log(
          "=========================================="
        );
        console.log(
          "ID: " + orden.id
        );
        console.log(
          "Motivo: " + mensaje
        );
        console.log(
          "NO se modifico JudoShiai ni el .shi."
        );
        console.log(
          "=========================================="
        );
        console.log("");

        continue;
      }

      if (validacion.esperando) {
        continue;
      }

      if (!PERMITIR_REORDEN_WEB_PRUEBA) {
        ordenesWebDetectadas.add(id);

        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "       ORDEN WEB VALIDADA"
        );
        console.log(
          "=========================================="
        );
        console.log(
          "ID: " + orden.id
        );
        console.log(
          "✅ Coincide con JudoShiai."
        );
        console.log(
          "🔒 Aplicacion automatica desactivada."
        );
        console.log(
          "La orden permanece pendiente."
        );
        console.log(
          "=========================================="
        );
        console.log("");

        continue;
      }

      const actualizada =
        await actualizarEstadoOrdenWeb(
          orden,
          "procesando",
          "Validada por Connector. Aplicando en JudoShiai.",
          false
        );

      if (!actualizada) {
        continue;
      }

      ordenesWebDetectadas.add(id);

      console.log("");
      console.log(
        "=========================================="
      );
      console.log(
        "       APLICANDO ORDEN WEB"
      );
      console.log(
        "=========================================="
      );
      console.log(
        "ID: " + orden.id
      );
      console.log(
        "Tatami: " + orden.tatami
      );
      console.log(
        "Movimiento: #" +
          orden.posicion_actual +
          " -> #" +
          orden.posicion_destino
      );

      try {
        const aplicada =
          await aplicarOrdenWebViaJudoShiai(
            orden,
            validacion
          );

        const finalizada =
          await actualizarEstadoOrdenWeb(
            orden,
            "aplicada",
            "Aplicada y verificada por Connector en JudoShiai.",
            true,
            "procesando",
            false
          );

        if (!finalizada) {
          throw new Error(
            "El combate se movio, pero no se pudo cerrar la orden en Supabase."
          );
        }

        console.log(
          "✅ ORDEN APLICADA Y VERIFICADA"
        );
        console.log(
          "Categoria ID: " +
            aplicada.categoryId
        );
        console.log(
          "Combate: " +
            aplicada.numeroCombate
        );
        console.log(
          "Estado Supabase: aplicada"
        );

        solicitarInformacionCompleta();
      } catch (errorAplicacion) {
        const mensajeAplicacion =
          errorAplicacion instanceof Error
            ? errorAplicacion.message
            : String(errorAplicacion);

        try {
          await actualizarEstadoOrdenWeb(
            orden,
            "error",
            "Error al aplicar en JudoShiai: " +
              mensajeAplicacion,
            true,
            "procesando",
            false
          );
        } catch (errorEstado) {
          console.error(
            "No se pudo registrar el estado error en Supabase: " +
              errorEstado.message
          );
        }

        console.error(
          "❌ No se pudo aplicar la orden: " +
            mensajeAplicacion
        );
      }

      console.log(
        "=========================================="
      );
      console.log("");
    }
  } catch (error) {
    const mensaje =
      error instanceof Error
        ? error.message
        : String(error);

    if (
      mensaje !==
      ultimoErrorDetectorOrdenes
    ) {
      ultimoErrorDetectorOrdenes =
        mensaje;

      console.error("");
      console.error(
        "❌ Detector de ordenes web:"
      );
      console.error(mensaje);
      console.error("");
    }
  } finally {
    consultaOrdenesEnCurso = false;
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

    if (comando.startsWith("p ")) {
      const partes = comando
        .split(/\s+/)
        .filter(Boolean);

      if (partes.length !== 4) {
        console.log("");
        console.log(
          "Uso: P <tatami> <posicion actual> <posicion destino>"
        );
        console.log("Ejemplo: P 2 5 6");
        console.log("");
        return;
      }

      const tatami = Number(partes[1]);
      const posicionActual = Number(partes[2]);
      const posicionDestino = Number(partes[3]);

      try {
        const cambios =
          await simularPropuestaOrden({
            tatami,
            posicionActual,
            posicionDestino,
            protocolVersion:
              judoshiaiProtocolVersion,
            httpUrl:
              JUDOSHIAI_HTTP_URL,
            shiPath:
              JUDOSHIAI_SHI_PATH,
          });

        ultimaPropuestaSimulada = {
          tatami,
          posicionActual,
          posicionDestino,
          cambios,
          shiPath:
            JUDOSHIAI_SHI_PATH,
          creadaEn: Date.now(),
        };

        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "       SIMULACION DE NUEVO ORDEN"
        );
        console.log(
          "=========================================="
        );
        console.log(
          `Tatami: ${tatami}`
        );
        console.log(
          `Movimiento solicitado: ` +
            `#${posicionActual} -> #${posicionDestino}`
        );
        console.log("");
        console.table(cambios);
        console.log("");
        console.log("🧪 SOLO SIMULACION");
        console.log(
          "No se modifico JudoShiai, el .shi ni Supabase."
        );
        console.log(
          "=========================================="
        );
        console.log("");
      } catch (error) {
        console.error("");
        console.error(
          "❌ No se pudo simular la propuesta:"
        );
        console.error(error.message);
        console.error("");
      }

      return;
    }
    if (comando === "a confirmar") {
      if (!ultimaPropuestaSimulada) {
        console.log("");
        console.log(
          "❌ No hay una propuesta simulada pendiente."
        );
        console.log(
          "Primero usa P <tatami> <actual> <destino>."
        );
        console.log("");
        return;
      }

      try {
        const resultado =
          await aplicarPropuestaOrden({
            propuesta:
              ultimaPropuestaSimulada,
            shiPath:
              JUDOSHIAI_SHI_PATH,
            permitirEscritura:
              PERMITIR_APLICAR_ORDEN_PRUEBA,
          });

        console.log("");
        console.log(
          "=========================================="
        );
        console.log(
          "       ORDEN APLICADO EN PRUEBA"
        );
        console.log(
          "=========================================="
        );
        console.log(
          "✅ Transaccion completada."
        );
        console.log(
          "✅ matches.number NO fue modificado."
        );
        console.log(
          "✅ Backup automatico:"
        );
        console.log(
          resultado.backupPath
        );
        console.log("");
        console.table(
          resultado.cambios
        );
        console.log(
          "=========================================="
        );
        console.log("");

        ultimaPropuestaSimulada = null;
      } catch (error) {
        console.error("");
        console.error(
          "❌ NO se aplico la propuesta:"
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
        "Usa N, L, P <tatami> <actual> <destino> o A CONFIRMAR."
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

  if (temporizadorOrdenes) {
    clearInterval(temporizadorOrdenes);
    temporizadorOrdenes = null;
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