require("dotenv").config();

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { createClient } = require("@supabase/supabase-js");

// ============================================================
// CONFIGURACIÓN SEGURA
// ============================================================

const raizProyecto = path.resolve(__dirname, "..");

const carpetaPruebas = path.resolve(
  raizProyecto,
  "pruebas"
);

const rutaArchivo = path.resolve(
  carpetaPruebas,
  "planificador-prueba.shi"
);

const carpetaBackups = path.resolve(
  carpetaPruebas,
  "backups"
);

const SUPABASE_URL =
  process.env.SUPABASE_URL;

const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_KEY;

// ============================================================
// PROTECCIÓN: SOLO ARCHIVO DE PRUEBA
// ============================================================

function validarRutaSegura() {
  const nombre =
    path.basename(rutaArchivo);

  const estaDentroDePruebas =
    rutaArchivo.startsWith(
      carpetaPruebas + path.sep
    );

  if (
    nombre !== "planificador-prueba.shi" ||
    !estaDentroDePruebas
  ) {
    throw new Error(
      "PROTECCIÓN ACTIVADA: el script solo puede modificar pruebas\\planificador-prueba.shi"
    );
  }

  if (!fs.existsSync(rutaArchivo)) {
    throw new Error(
      `No existe el archivo de prueba:\n${rutaArchivo}`
    );
  }
}

// ============================================================
// CONFIRMACIÓN EXPLÍCITA
// ============================================================

function validarConfirmacion() {
  const confirmado =
    process.argv.includes(
      "--confirmar-prueba"
    );

  if (!confirmado) {
    console.log("");
    console.log(
      "🔒 PROTECCIÓN ACTIVADA"
    );
    console.log("");
    console.log(
      "Este script puede escribir únicamente sobre:"
    );
    console.log("");
    console.log(rutaArchivo);
    console.log("");
    console.log(
      "Para ejecutarlo usa:"
    );
    console.log("");
    console.log(
      "node .\\sqlite\\aplicarTandaPrueba.js --confirmar-prueba"
    );
    console.log("");

    process.exit(1);
  }
}

// ============================================================
// SUPABASE
// ============================================================

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
// UTILIDADES
// ============================================================

function normalizar(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function generarSelloFecha() {
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

function obtenerIdArgumento() {
  for (const argumento of process.argv.slice(2)) {
    if (
      argumento.startsWith("--")
    ) {
      continue;
    }

    const numero =
      Number(argumento);

    if (
      Number.isInteger(numero) &&
      numero > 0
    ) {
      return numero;
    }
  }

  return null;
}

// ============================================================
// OBTENER TANDA
// ============================================================

async function obtenerTanda() {
  const idSolicitado =
    obtenerIdArgumento();

  if (idSolicitado) {
    const { data, error } =
      await supabase
        .from(
          "tandas_planificador"
        )
        .select(
          "id, campeonato_id, nombre, orden, estado"
        )
        .eq(
          "id",
          idSolicitado
        )
        .maybeSingle();

    if (error) {
      throw new Error(
        error.message
      );
    }

    if (!data) {
      throw new Error(
        `No existe la tanda ${idSolicitado}.`
      );
    }

    return data;
  }

  const { data, error } =
    await supabase
      .from(
        "tandas_planificador"
      )
      .select(
        "id, campeonato_id, nombre, orden, estado"
      )
      .eq(
        "estado",
        "guardada"
      )
      .order(
        "id",
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      error.message
    );
  }

  if (!data) {
    throw new Error(
      "No hay tandas guardadas en Supabase."
    );
  }

  return data;
}

// ============================================================
// CARGAR DISTRIBUCIÓN
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
// VALIDACIÓN PREVIA
// ============================================================

function validarArchivo(
  distribucion
) {
  const db = new Database(
    rutaArchivo,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    const infoTatamis =
      db
        .prepare(`
          SELECT value
          FROM info
          WHERE item = 'NumTatamis'
          LIMIT 1
        `)
        .get();

    const numeroTatamis =
      Number(
        infoTatamis?.value
      ) || 0;

    if (
      !Number.isInteger(
        numeroTatamis
      ) ||
      numeroTatamis <= 0
    ) {
      throw new Error(
        "No se pudo determinar la cantidad de tatamis del archivo .shi."
      );
    }

    const buscarCategoria =
      db.prepare(`
        SELECT
          "index" AS id,
          TRIM(category) AS categoria,
          category AS categoria_original,
          tatami,
          deleted
        FROM categories
        WHERE "index" = ?
        LIMIT 1
      `);

    const contarCompetidores =
      db.prepare(`
        SELECT
          COUNT(p."index")
            AS total

        FROM competitors AS p

        INNER JOIN categories AS c
          ON p.category =
             c.category

        WHERE
          c."index" = ?
          AND
          (
            COALESCE(
              p.deleted,
              0
            ) & 1
          ) = 0
          AND
          (
            COALESCE(
              c.deleted,
              0
            ) & 1
          ) = 0
      `);

    const resultados = [];
    const idsVistos =
      new Set();

    const errores = [];

    for (
      const propuesta
      of distribucion
    ) {
      const id =
        Number(
          propuesta.judoshiai_index
        );

      const tatamiPropuesto =
        Number(
          propuesta.tatami_numero
        );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        errores.push(
          `${propuesta.categoria_clave}: ID JudoShiai inválido.`
        );

        continue;
      }

      if (
        idsVistos.has(id)
      ) {
        errores.push(
          `${propuesta.categoria_clave}: ID ${id} duplicado.`
        );

        continue;
      }

      idsVistos.add(id);

      if (
        !Number.isInteger(
          tatamiPropuesto
        ) ||
        tatamiPropuesto < 1 ||
        tatamiPropuesto >
          numeroTatamis
      ) {
        errores.push(
          `${propuesta.categoria_clave}: Tatami ${tatamiPropuesto} inválido.`
        );

        continue;
      }

      const categoriaLocal =
        buscarCategoria.get(id);

      if (!categoriaLocal) {
        errores.push(
          `${propuesta.categoria_clave}: no existe el ID ${id} en el .shi.`
        );

        continue;
      }

      if (
        normalizar(
          categoriaLocal.categoria
        ) !==
        normalizar(
          propuesta.categoria_clave
        )
      ) {
        errores.push(
          `ID ${id}: el nombre no coincide (${categoriaLocal.categoria} ≠ ${propuesta.categoria_clave}).`
        );

        continue;
      }

      const conteo =
        contarCompetidores.get(
          id
        );

      const competidoresLocales =
        Number(
          conteo?.total
        ) || 0;

      const competidoresEsperados =
        Number(
          propuesta.cantidad_deportistas
        ) || 0;

      if (
        competidoresLocales !==
        competidoresEsperados
      ) {
        errores.push(
          `${propuesta.categoria_clave}: competidores ${competidoresLocales}/${competidoresEsperados}.`
        );

        continue;
      }

      resultados.push({
        Categoria:
          propuesta.categoria_clave,

        ID:
          id,

        Actual:
          Number(
            categoriaLocal.tatami
          ) > 0
            ? `T${categoriaLocal.tatami}`
            : "T0",

        Nuevo:
          `T${tatamiPropuesto}`,

        Competidores:
          `${competidoresLocales}/${competidoresEsperados}`,

        Combates:
          propuesta.combates_estimados,
      });
    }

    if (
      errores.length > 0
    ) {
      console.log("");
      console.log(
        "❌ VALIDACIÓN FALLIDA"
      );
      console.log("");

      for (
        const error
        of errores
      ) {
        console.log(
          `- ${error}`
        );
      }

      console.log("");

      throw new Error(
        "La tanda no puede aplicarse porque la validación previa encontró errores."
      );
    }

    return {
      numeroTatamis,
      resultados,
    };
  } finally {
    db.close();
  }
}

// ============================================================
// CREAR BACKUP
// ============================================================

function crearBackup() {
  fs.mkdirSync(
    carpetaBackups,
    {
      recursive: true,
    }
  );

  const sello =
    generarSelloFecha();

  const rutaBackup =
    path.resolve(
      carpetaBackups,
      `planificador-prueba-backup-${sello}.shi`
    );

  fs.copyFileSync(
    rutaArchivo,
    rutaBackup
  );

  if (
    !fs.existsSync(
      rutaBackup
    )
  ) {
    throw new Error(
      "No se pudo crear el respaldo del archivo."
    );
  }

  return rutaBackup;
}

// ============================================================
// APLICAR CAMBIOS
// ============================================================

function aplicarDistribucion(
  distribucion
) {
  const db = new Database(
    rutaArchivo,
    {
      readonly: false,
      fileMustExist: true,
    }
  );

  db.pragma(
    "busy_timeout = 5000"
  );

  try {
    const actualizar =
      db.prepare(`
        UPDATE categories

        SET tatami = ?

        WHERE
          "index" = ?
          AND
          (
            COALESCE(
              deleted,
              0
            ) & 1
          ) = 0
      `);

    const comprobar =
      db.prepare(`
        SELECT
          "index" AS id,
          TRIM(category)
            AS categoria,
          tatami
        FROM categories
        WHERE "index" = ?
        LIMIT 1
      `);

    const transaccion =
      db.transaction(() => {
        for (
          const propuesta
          of distribucion
        ) {
          const id =
            Number(
              propuesta.judoshiai_index
            );

          const tatami =
            Number(
              propuesta.tatami_numero
            );

          const resultado =
            actualizar.run(
              tatami,
              id
            );

          if (
            resultado.changes !== 1
          ) {
            throw new Error(
              `No se pudo actualizar la categoría ${propuesta.categoria_clave} (ID ${id}).`
            );
          }
        }

        // ------------------------------------------
        // VERIFICAR DENTRO DE LA MISMA TRANSACCIÓN
        // ------------------------------------------

        for (
          const propuesta
          of distribucion
        ) {
          const id =
            Number(
              propuesta.judoshiai_index
            );

          const esperado =
            Number(
              propuesta.tatami_numero
            );

          const fila =
            comprobar.get(id);

          if (!fila) {
            throw new Error(
              `No se pudo verificar el ID ${id}.`
            );
          }

          if (
            Number(
              fila.tatami
            ) !== esperado
          ) {
            throw new Error(
              `${fila.categoria}: debería estar en T${esperado}, pero quedó en T${fila.tatami}.`
            );
          }
        }
      });

    transaccion();
  } finally {
    db.close();
  }
}

// ============================================================
// VERIFICACIÓN FINAL
// ============================================================

function verificarResultado(
  distribucion
) {
  const db = new Database(
    rutaArchivo,
    {
      readonly: true,
      fileMustExist: true,
    }
  );

  try {
    const buscar =
      db.prepare(`
        SELECT
          "index" AS id,
          TRIM(category)
            AS categoria,
          tatami
        FROM categories
        WHERE "index" = ?
        LIMIT 1
      `);

    const resultados = [];

    let errores = 0;

    for (
      const propuesta
      of distribucion
    ) {
      const id =
        Number(
          propuesta.judoshiai_index
        );

      const esperado =
        Number(
          propuesta.tatami_numero
        );

      const categoria =
        buscar.get(id);

      const actual =
        Number(
          categoria?.tatami
        ) || 0;

      const correcto =
        actual === esperado;

      if (!correcto) {
        errores++;
      }

      resultados.push({
        Categoría:
          propuesta.categoria_clave,

        ID:
          id,

        Esperado:
          `T${esperado}`,

        Resultado:
          actual > 0
            ? `T${actual}`
            : "T0",

        Estado:
          correcto
            ? "✅ CORRECTO"
            : "❌ ERROR",
      });
    }

    return {
      errores,
      resultados,
    };
  } finally {
    db.close();
  }
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
    "       APLICAR TANDA SOBRE COPIA DE PRUEBA"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  validarRutaSegura();
  validarConfirmacion();

  console.log(
    "🔒 Archivo autorizado:"
  );

  console.log(
    rutaArchivo
  );

  console.log("");

  const tanda =
    await obtenerTanda();

  if (
    tanda.estado !==
    "guardada"
  ) {
    throw new Error(
      `La tanda está en estado "${tanda.estado}". Solo se permiten tandas guardadas para esta prueba.`
    );
  }

  console.log(
    `Tanda: ${tanda.nombre}`
  );

  console.log(
    `ID: ${tanda.id}`
  );

  console.log(
    `Estado: ${tanda.estado}`
  );

  console.log("");

  const distribucion =
    await cargarDistribucion(
      tanda.id
    );

  console.log(
    `Categorías a aplicar: ${distribucion.length}`
  );

  console.log("");

  console.log(
    "1️⃣ Validando archivo..."
  );

  const validacion =
    validarArchivo(
      distribucion
    );

  console.log("");
  console.table(
    validacion.resultados
  );

  console.log("");
  console.log(
    "✅ Validación previa correcta."
  );

  console.log(
    `Tatamis del archivo: ${validacion.numeroTatamis}`
  );

  console.log("");

  console.log(
    "2️⃣ Creando respaldo..."
  );

  const rutaBackup =
    crearBackup();

  console.log("");
  console.log(
    "✅ Backup creado:"
  );

  console.log(
    rutaBackup
  );

  console.log("");

  console.log(
    "3️⃣ Aplicando distribución..."
  );

  aplicarDistribucion(
    distribucion
  );

  console.log("");
  console.log(
    "✅ Transacción SQLite completada."
  );

  console.log("");

  console.log(
    "4️⃣ Verificando resultado..."
  );

  const verificacion =
    verificarResultado(
      distribucion
    );

  console.log("");
  console.table(
    verificacion.resultados
  );

  console.log("");

  if (
    verificacion.errores > 0
  ) {
    console.log(
      `❌ Se detectaron ${verificacion.errores} errores.`
    );

    console.log("");
    console.log(
      "Existe un backup para restaurar el archivo:"
    );

    console.log(
      rutaBackup
    );

    throw new Error(
      "La verificación posterior no fue correcta."
    );
  }

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
    "✅ TANDA APLICADA CORRECTAMENTE A LA COPIA."
  );

  console.log("");

  console.log(
    "La distribución esperada quedó:"
  );

  const cargas =
    new Map();

  for (
    const fila
    of distribucion
  ) {
    const tatami =
      Number(
        fila.tatami_numero
      );

    if (
      !cargas.has(tatami)
    ) {
      cargas.set(
        tatami,
        []
      );
    }

    cargas
      .get(tatami)
      .push(
        fila.categoria_clave
      );
  }

  for (
    let tatami = 1;
    tatami <=
      validacion.numeroTatamis;
    tatami++
  ) {
    const categorias =
      cargas.get(tatami) ||
      [];

    console.log("");

    console.log(
      `🥋 Tatami ${tatami}`
    );

    for (
      const categoria
      of categorias
    ) {
      console.log(
        `   - ${categoria}`
      );
    }
  }

  console.log("");
  console.log(
    "🔒 IMPORTANTE"
  );

  console.log(
    "Solo se modificó pruebas\\planificador-prueba.shi"
  );

  console.log(
    "No se modificó el torneo original."
  );

  console.log(
    "No se modificó Supabase."
  );

  console.log(
    "No se cambió el estado de la tanda."
  );

  console.log(
    "No se modificaron los combates."
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

ejecutar().catch(
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