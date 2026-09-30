const path = require("path");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

function detectarGrupo(nombre) {
  const limpio = String(nombre || "").trim();

  // Sub13 / sub13 / Sub(09) / sub(09)
  const sub = limpio.match(/^(Sub|sub)\s*\(?(\d{1,2})\)?/);

  if (sub) {
    return {
      grupo: `Sub${sub[2]}`,
      sexo: sub[1] === "Sub" ? "M" : "F",
    };
  }

  const lower = limpio.toLowerCase();

  if (lower.includes("absolut")) {
    return {
      grupo: "Absoluto",
      sexo: detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("open")) {
    return {
      grupo: "Open",
      sexo: detectarSexoTexto(limpio),
    };
  }

  if (
    lower.includes("master") ||
    lower.includes("máster")
  ) {
    return {
      grupo: "Máster",
      sexo: detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("novicio")) {
    return {
      grupo: "Novicio",
      sexo: detectarSexoTexto(limpio),
    };
  }

  if (lower.includes("amateur")) {
    return {
      grupo: "Amateur",
      sexo: detectarSexoTexto(limpio),
    };
  }

  return {
    grupo: "Otros",
    sexo: detectarSexoTexto(limpio),
  };
}

function detectarSexoTexto(nombre) {
  const texto = String(nombre || "").trim();

  if (
    /\(M\)/i.test(texto) ||
    /\bmasculino\b/i.test(texto) ||
    /\bvar[oó]n\b/i.test(texto)
  ) {
    return "M";
  }

  if (
    /\(F\)/i.test(texto) ||
    /\bfemenin[ao]\b/i.test(texto) ||
    /\bmujer\b/i.test(texto)
  ) {
    return "F";
  }

  return "?";
}

function obtenerPeso(nombre) {
  const texto = String(nombre || "").trim();

  const peso = texto.match(/([+-]\s*\d+)/);

  if (peso) {
    return peso[1].replace(/\s+/g, "");
  }

  return "-";
}

const db = new Database(rutaArchivo, {
  readonly: true,
  fileMustExist: true,
});

try {
  const categorias = db.prepare(`
    SELECT
      c."index" AS id,
      TRIM(c.category) AS categoria,
      c.wishsys,
      c.tatami,

      COUNT(p."index") AS competidores

    FROM categories AS c

    INNER JOIN competitors AS p
      ON p.category = c.category
     AND (p.deleted & 1) = 0

    WHERE (c.deleted & 1) = 0

    GROUP BY
      c."index",
      c.category,
      c.wishsys,
      c.tatami

    HAVING COUNT(p."index") > 0

    ORDER BY c.category COLLATE NOCASE
  `).all();

  const grupos = {};

  for (const categoria of categorias) {
    const clasificacion =
      detectarGrupo(categoria.categoria);

    const grupo = clasificacion.grupo;
    const sexo = clasificacion.sexo;

    if (!grupos[grupo]) {
      grupos[grupo] = {
        nombre: grupo,
        competidores: 0,
        categorias: 0,

        masculino: {
          competidores: 0,
          categorias: 0,
        },

        femenino: {
          competidores: 0,
          categorias: 0,
        },

        sinSexo: {
          competidores: 0,
          categorias: 0,
        },

        detalle: [],
      };
    }

    const cantidad =
      Number(categoria.competidores) || 0;

    grupos[grupo].competidores += cantidad;
    grupos[grupo].categorias += 1;

    if (sexo === "M") {
      grupos[grupo].masculino.competidores += cantidad;
      grupos[grupo].masculino.categorias += 1;
    } else if (sexo === "F") {
      grupos[grupo].femenino.competidores += cantidad;
      grupos[grupo].femenino.categorias += 1;
    } else {
      grupos[grupo].sinSexo.competidores += cantidad;
      grupos[grupo].sinSexo.categorias += 1;
    }

    grupos[grupo].detalle.push({
      categoria: categoria.categoria,
      sexo,
      peso: obtenerPeso(categoria.categoria),
      competidores: cantidad,
      tatami:
        Number(categoria.tatami) > 0
          ? Number(categoria.tatami)
          : "-",
    });
  }

  const lista = Object.values(grupos).sort(
    (a, b) =>
      a.nombre.localeCompare(
        b.nombre,
        "es",
        { numeric: true }
      )
  );

  console.log("");
  console.log("============================================================");
  console.log("          GRUPOS DISPONIBLES PARA PLANIFICAR");
  console.log("============================================================");
  console.log("");

  console.table(
    lista.map((grupo) => ({
      Grupo: grupo.nombre,
      Competidores: grupo.competidores,
      Categorías: grupo.categorias,

      "Cat. M":
        grupo.masculino.categorias,

      "Comp. M":
        grupo.masculino.competidores,

      "Cat. F":
        grupo.femenino.categorias,

      "Comp. F":
        grupo.femenino.competidores,

      "Sin identificar":
        grupo.sinSexo.categorias,
    }))
  );

  for (const grupo of lista) {
    console.log("");
    console.log(`▼ ${grupo.nombre}`);
    console.log(
      `   ${grupo.competidores} competidores · ${grupo.categorias} categorías`
    );

    for (const categoria of grupo.detalle) {
      const sexoTexto =
        categoria.sexo === "M"
          ? "Masculino"
          : categoria.sexo === "F"
          ? "Femenino"
          : "Sexo sin identificar";

      console.log(
        `   • ${categoria.categoria} | ${sexoTexto} | ${categoria.competidores} competidores | peso ${categoria.peso}`
      );
    }
  }

  console.log("");
  console.log("============================================================");
  console.log("                 OPCIONES PARA EL PANEL");
  console.log("============================================================");
  console.log("");

  for (const grupo of lista) {
    console.log(
      `☐ ${grupo.nombre} (${grupo.competidores} competidores · ${grupo.categorias} categorías)`
    );
  }

  console.log("");
  console.log("🔒 SOLO LECTURA");
  console.log("No se modificó JudoShiai.");
  console.log("");
} finally {
  db.close();
}