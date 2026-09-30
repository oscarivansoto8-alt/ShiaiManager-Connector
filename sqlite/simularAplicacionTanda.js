require("dotenv").config();

const path = require("path");
const Database = require("better-sqlite3");
const { createClient } = require("@supabase/supabase-js");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("");
  console.error("❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env");
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

function normalizar(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function obtenerTanda() {
  const idArgumento = Number(process.argv[2]);

  if (Number.isInteger(idArgumento) && idArgumento > 0) {
    const { data, error } = await supabase
      .from("tandas_planificador")
      .select("id, campeonato_id, nombre, orden, estado")
      .eq("id", idArgumento)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error(`No existe la tanda ${idArgumento}.`);
    }

    return data;
  }

  const { data, error } = await supabase
    .from("tandas_planificador")
    .select("id, campeonato_id, nombre, orden, estado")
    .eq("estado", "guardada")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("No hay tandas guardadas en Supabase.");
  }

  return data;
}

async function ejecutar() {
  console.log("");
  console.log(
    "============================================================"
  );
  console.log(
    "          SIMULACIÓN DE APLICACIÓN DE TANDA"
  );
  console.log(
    "============================================================"
  );
  console.log("");

  console.log(`Archivo local: ${rutaArchivo}`);
  console.log("");

  const tanda = await obtenerTanda();

  console.log(`Tanda: ${tanda.nombre}`);
  console.log(`ID: ${tanda.id}`);
  console.log(`Estado: ${tanda.estado}`);
  console.log("");

  const { data: grupos, error: errorGrupos } = await supabase
    .from("tandas_grupos")
    .select("grupo")
    .eq("tanda_id", tanda.id);

  if (errorGrupos) {
    throw new Error(errorGrupos.message);
  }

  const { data: distribucion, error: errorDistribucion } =
    await supabase
      .from("distribucion_categorias_tatamis")
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
      .eq("tanda_id", tanda.id)
      .order("tatami_numero", { ascending: true })
      .order("orden", { ascending: true });

  if (errorDistribucion) {
    throw new Error(errorDistribucion.message);
  }

  if (!distribucion || distribucion.length === 0) {
    throw new Error(
      "La tanda no tiene categorías distribuidas."
    );
  }

  console.log(
    `Grupos: ${(grupos || [])
      .map((fila) => fila.grupo)
      .join(" + ")}`
  );

  console.log(
    `Categorías guardadas: ${distribucion.length}`
  );

  console.log("");

  const db = new Database(rutaArchivo, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const infoFilas = db
      .prepare(`
        SELECT item, value
        FROM info
        WHERE item IN (
          'Competition',
          'Date',
          'NumTatamis'
        )
      `)
      .all();

    const info = {};

    for (const fila of infoFilas) {
      info[fila.item] = fila.value;
    }

    const numeroTatamis =
      Number(info.NumTatamis) || 0;

    console.log(
      `Torneo local: ${info.Competition || "Sin nombre"}`
    );

    console.log(
      `Fecha: ${info.Date || "-"}`
    );

    console.log(
      `Tatamis del .shi: ${numeroTatamis}`
    );

    console.log("");

    const buscarCategoria = db.prepare(`
      SELECT
        "index" AS id,
        TRIM(category) AS categoria,
        category AS categoria_original,
        tatami,
        wishsys,
        system,
        deleted
      FROM categories
      WHERE "index" = ?
      LIMIT 1
    `);

    const contarCompetidores = db.prepare(`
      SELECT COUNT(p."index") AS total
      FROM competitors AS p

      INNER JOIN categories AS c
        ON p.category = c.category

      WHERE
        c."index" = ?
        AND (p.deleted & 1) = 0
        AND (c.deleted & 1) = 0
    `);

    const resultados = [];

    let errores = 0;
    let advertencias = 0;

    const idsVistos = new Set();

    for (const propuesta of distribucion) {
      const judoshiaiIndex =
        Number(propuesta.judoshiai_index);

      if (
        !Number.isInteger(judoshiaiIndex) ||
        judoshiaiIndex <= 0
      ) {
        resultados.push({
          Categoría: propuesta.categoria_clave,
          ID: "-",
          Actual: "-",
          Propuesto: `T${propuesta.tatami_numero}`,
          Competidores: propuesta.cantidad_deportistas,
          Combates: propuesta.combates_estimados,
          Estado: "❌ SIN ID JUDOSHIAI",
        });

        errores++;
        continue;
      }

      if (idsVistos.has(judoshiaiIndex)) {
        resultados.push({
          Categoría: propuesta.categoria_clave,
          ID: judoshiaiIndex,
          Actual: "-",
          Propuesto: `T${propuesta.tatami_numero}`,
          Competidores: propuesta.cantidad_deportistas,
          Combates: propuesta.combates_estimados,
          Estado: "❌ ID DUPLICADO",
        });

        errores++;
        continue;
      }

      idsVistos.add(judoshiaiIndex);

      if (
        propuesta.tatami_numero < 1 ||
        propuesta.tatami_numero > numeroTatamis
      ) {
        resultados.push({
          Categoría: propuesta.categoria_clave,
          ID: judoshiaiIndex,
          Actual: "-",
          Propuesto: `T${propuesta.tatami_numero}`,
          Competidores: propuesta.cantidad_deportistas,
          Combates: propuesta.combates_estimados,
          Estado: "❌ TATAMI INVÁLIDO",
        });

        errores++;
        continue;
      }

      const categoriaLocal =
        buscarCategoria.get(judoshiaiIndex);

      if (!categoriaLocal) {
        resultados.push({
          Categoría: propuesta.categoria_clave,
          ID: judoshiaiIndex,
          Actual: "-",
          Propuesto: `T${propuesta.tatami_numero}`,
          Competidores: propuesta.cantidad_deportistas,
          Combates: propuesta.combates_estimados,
          Estado: "❌ NO EXISTE EN .SHI",
        });

        errores++;
        continue;
      }

      const nombreCoincide =
        normalizar(categoriaLocal.categoria) ===
        normalizar(propuesta.categoria_clave);

      const competidoresLocales =
        contarCompetidores.get(
          judoshiaiIndex
        );

      const cantidadLocal =
        Number(competidoresLocales?.total) || 0;

      let estado = "✅ LISTO";

      if (!nombreCoincide) {
        estado = "❌ NOMBRE NO COINCIDE";
        errores++;
      } else if (
        cantidadLocal !==
        Number(propuesta.cantidad_deportistas)
      ) {
        estado = "⚠️ COMPETIDORES CAMBIARON";
        advertencias++;
      }

      resultados.push({
        Categoría: propuesta.categoria_clave,
        ID: judoshiaiIndex,
        Actual:
          Number(categoriaLocal.tatami) > 0
            ? `T${categoriaLocal.tatami}`
            : "T0",
        Propuesto: `T${propuesta.tatami_numero}`,
        Competidores: `${cantidadLocal}/${propuesta.cantidad_deportistas}`,
        Combates: propuesta.combates_estimados,
        Estado: estado,
      });
    }

    console.log(
      "============================================================"
    );
    console.log(
      "                 COMPARACIÓN"
    );
    console.log(
      "============================================================"
    );
    console.log("");

    console.table(resultados);

    const cargas = new Map();

    for (const fila of distribucion) {
      const tatami = Number(fila.tatami_numero);

      if (!cargas.has(tatami)) {
        cargas.set(tatami, {
          categorias: 0,
          combates: 0,
        });
      }

      const carga = cargas.get(tatami);

      carga.categorias += 1;
      carga.combates +=
        Number(fila.combates_estimados) || 0;
    }

    console.log("");
    console.log(
      "============================================================"
    );
    console.log(
      "              CARGA PROPUESTA"
    );
    console.log(
      "============================================================"
    );
    console.log("");

    for (let tatami = 1; tatami <= numeroTatamis; tatami++) {
      const carga =
        cargas.get(tatami) || {
          categorias: 0,
          combates: 0,
        };

      console.log(
        `🥋 Tatami ${tatami}: ${carga.categorias} categorías · ${carga.combates} combates`
      );
    }

    console.log("");
    console.log(
      "============================================================"
    );
    console.log(
      "                   RESULTADO"
    );
    console.log(
      "============================================================"
    );
    console.log("");

    console.log(
      `Errores: ${errores}`
    );

    console.log(
      `Advertencias: ${advertencias}`
    );

    console.log("");

    if (errores > 0) {
      console.log(
        "❌ NO ES SEGURO APLICAR ESTA TANDA."
      );

      console.log(
        "Hay diferencias que debemos revisar primero."
      );
    } else if (advertencias > 0) {
      console.log(
        "⚠️ La estructura coincide, pero hay datos que cambiaron."
      );

      console.log(
        "Debemos revisar las advertencias antes de aplicar."
      );
    } else {
      console.log(
        "✅ SIMULACIÓN CORRECTA."
      );

      console.log(
        "Los IDs, categorías, competidores y tatamis coinciden."
      );

      console.log("");

      console.log(
        "La tanda está preparada para una futura prueba de escritura."
      );
    }

    console.log("");
    console.log(
      "🔒 MODO SOLO LECTURA"
    );

    console.log(
      "No se modificó el archivo .shi."
    );

    console.log(
      "No se modificó JudoShiai."
    );

    console.log(
      "No se modificó Supabase."
    );

    console.log("");
  } finally {
    db.close();
  }
}

ejecutar().catch((error) => {
  console.error("");
  console.error("❌ ERROR:");
  console.error(error.message);
  console.error("");

  process.exitCode = 1;
});