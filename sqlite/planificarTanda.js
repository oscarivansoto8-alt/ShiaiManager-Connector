const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const rutaArchivo = path.resolve(
  __dirname,
  "..",
  "pruebas",
  "planificador-prueba.shi"
);

// ============================================================
// DETECTAR GRUPO Y SEXO
// ============================================================

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

function detectarGrupo(nombre) {
  const limpio = String(nombre || "").trim();

  // Sub18 = masculino
  // sub18 = femenino
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

// ============================================================
// PESO
// ============================================================

function obtenerPeso(nombre) {
  const texto = String(nombre || "").trim();

  const peso = texto.match(/([+-]\s*\d+)/);

  if (peso) {
    return peso[1].replace(/\s+/g, "");
  }

  return "-";
}

// ============================================================
// SISTEMA JUDOSHIAI
// ============================================================

function nombreSistema(wishsys) {
  const sistemas = {
    0: "Automático",
    1: "ESP Liga",
    2: "Doble Pool",
    3: "Repechaje",
    4: "SWE Rep. doble",
    5: "SWE Rep. directa",
    6: "EST D-Klass",
    7: "Sin repechaje",
    8: "SWE Rep. simple",
    9: "4 Pools",
    10: "ESP Doble pérdida",
    11: "IJF Rep. doble",
    12: "ESP Repesca simple",
    13: "Eliminación doble",
    14: "Repechaje 1 bronce",
    15: "Doble Pool 2",
    16: "Double Lost",
    17: "GBR Knockout",
    18: "Mejor de 3",
    19: "DEN Doble eliminación",
    20: "EST D-Klass 1 bronce",
    21: "Doble Pool 3",
    22: "Personalizado",
  };

  return sistemas[wishsys] || `Sistema ${wishsys}`;
}

// ============================================================
// VALIDAR SISTEMA
// ============================================================

function validarSistema(cantidad, wishsys) {
  if (cantidad === 1) {
    return {
      correcto: true,
      estado: "Clasificación directa",
    };
  }

  if (cantidad === 2) {
    return {
      correcto: wishsys === 18 || wishsys === 0,
      estado:
        wishsys === 18 || wishsys === 0
          ? "Correcto"
          : "Revisar: debería ser Mejor de 3",
    };
  }

  if (cantidad >= 3 && cantidad <= 5) {
    return {
      correcto: wishsys === 1 || wishsys === 0,
      estado:
        wishsys === 1 || wishsys === 0
          ? "Correcto"
          : "Revisar: debería ser ESP Liga",
    };
  }

  if (cantidad >= 6) {
    if (wishsys === 1 || wishsys === 18) {
      return {
        correcto: false,
        estado: "Revisar sistema eliminatorio",
      };
    }

    return {
      correcto: true,
      estado: "Sistema eliminatorio",
    };
  }

  return {
    correcto: false,
    estado: "Revisar",
  };
}

// ============================================================
// CALCULAR COMBATES
// ============================================================

function calcularCombates(cantidad, combatesGenerados) {
  if (cantidad === 1) {
    return 0;
  }

  if (cantidad === 2) {
    return 3;
  }

  if (cantidad >= 3 && cantidad <= 5) {
    return (cantidad * (cantidad - 1)) / 2;
  }

  // Si JudoShiai ya generó el cuadro,
  // usamos el número real de registros.
  if (cantidad >= 6 && combatesGenerados > 0) {
    return combatesGenerados;
  }

  // Para 6+ sin cuadro generado todavía
  // no inventamos un número.
  return null;
}

// ============================================================
// ORDENAR GRUPOS
// ============================================================

function ordenarGrupos(a, b) {
  const subA = a.nombre.match(/^Sub(\d+)$/i);
  const subB = b.nombre.match(/^Sub(\d+)$/i);

  if (subA && subB) {
    return Number(subA[1]) - Number(subB[1]);
  }

  if (subA) return -1;
  if (subB) return 1;

  return a.nombre.localeCompare(b.nombre, "es");
}

// ============================================================
// DISTRIBUIR ENTRE TATAMIS
// ============================================================

function distribuirCategorias(categorias, numeroTatamis) {
  const tatamis = [];

  for (let i = 1; i <= numeroTatamis; i++) {
    tatamis.push({
      numero: i,
      carga: 0,
      categorias: [],
    });
  }

  const planificables = categorias
    .filter(
      (categoria) =>
        categoria.sistemaCorrecto &&
        typeof categoria.combates === "number" &&
        categoria.combates > 0
    )
    .sort((a, b) => {
      if (b.combates !== a.combates) {
        return b.combates - a.combates;
      }

      return a.nombre.localeCompare(
        b.nombre,
        "es",
        { numeric: true }
      );
    });

  for (const categoria of planificables) {
    tatamis.sort((a, b) => {
      if (a.carga !== b.carga) {
        return a.carga - b.carga;
      }

      return a.numero - b.numero;
    });

    const destino = tatamis[0];

    destino.categorias.push(categoria);
    destino.carga += categoria.combates;
  }

  tatamis.sort(
    (a, b) => a.numero - b.numero
  );

  return tatamis;
}

// ============================================================
// PROGRAMA PRINCIPAL
// ============================================================

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
    Number(info.NumTatamis) || 3;

  // ==========================================================
  // CATEGORÍAS + COMPETIDORES REALES
  // ==========================================================

  const filas = db
    .prepare(`
      SELECT
        c."index" AS id,
        TRIM(c.category) AS categoria,
        c.category AS categoria_original,
        c.wishsys,
        c.tatami,

        COUNT(p."index") AS competidores,

        (
          SELECT COUNT(*)
          FROM matches AS m
          WHERE m.category = c."index"
            AND (m.deleted & 1) = 0
        ) AS combates_generados

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

      ORDER BY
        c.category COLLATE NOCASE,
        c."index"
    `)
    .all();

  const categorias = [];

  for (const fila of filas) {
    const clasificacion =
      detectarGrupo(fila.categoria);

    const cantidad =
      Number(fila.competidores) || 0;

    const wishsys =
      Number(fila.wishsys) || 0;

    const combatesGenerados =
      Number(fila.combates_generados) || 0;

    const validacion =
      validarSistema(
        cantidad,
        wishsys
      );

    categorias.push({
      id: Number(fila.id),

      nombre:
        String(fila.categoria).trim(),

      grupo:
        clasificacion.grupo,

      sexo:
        clasificacion.sexo,

      peso:
        obtenerPeso(fila.categoria),

      competidores:
        cantidad,

      wishsys,

      sistema:
        nombreSistema(wishsys),

      sistemaCorrecto:
        validacion.correcto,

      estadoSistema:
        validacion.estado,

      combates:
        calcularCombates(
          cantidad,
          combatesGenerados
        ),

      tatamiActual:
        Number(fila.tatami) || 0,
    });
  }

  // ==========================================================
  // AGRUPAR
  // ==========================================================

  const mapaGrupos = {};

  for (const categoria of categorias) {
    if (!mapaGrupos[categoria.grupo]) {
      mapaGrupos[categoria.grupo] = {
        nombre: categoria.grupo,

        competidores: 0,
        categorias: 0,

        masculinoCompetidores: 0,
        masculinoCategorias: 0,

        femeninoCompetidores: 0,
        femeninoCategorias: 0,

        categoriasDetalle: [],
      };
    }

    const grupo =
      mapaGrupos[categoria.grupo];

    grupo.competidores +=
      categoria.competidores;

    grupo.categorias += 1;

    grupo.categoriasDetalle.push(
      categoria
    );

    if (categoria.sexo === "M") {
      grupo.masculinoCompetidores +=
        categoria.competidores;

      grupo.masculinoCategorias += 1;
    }

    if (categoria.sexo === "F") {
      grupo.femeninoCompetidores +=
        categoria.competidores;

      grupo.femeninoCategorias += 1;
    }
  }

  const grupos =
    Object.values(mapaGrupos).sort(
      ordenarGrupos
    );

  // ==========================================================
  // MOSTRAR MENÚ
  // ==========================================================

  console.log("");
  console.log(
    "============================================================"
  );

  console.log(
    "                 PLANIFICAR TANDA"
  );

  console.log(
    "============================================================"
  );

  console.log("");

  console.log(
    `Tatamis disponibles: ${numeroTatamis}`
  );

  console.log("");

  grupos.forEach((grupo, index) => {
    console.log(
      `[${index + 1}] ${grupo.nombre}`
    );

    console.log(
      `    ${grupo.competidores} competidores · ${grupo.categorias} categorías`
    );

    if (
      grupo.masculinoCategorias > 0
    ) {
      console.log(
        `    M: ${grupo.masculinoCompetidores} competidores · ${grupo.masculinoCategorias} categorías`
      );
    }

    if (
      grupo.femeninoCategorias > 0
    ) {
      console.log(
        `    F: ${grupo.femeninoCompetidores} competidores · ${grupo.femeninoCategorias} categorías`
      );
    }

    console.log("");
  });

  // ==========================================================
  // SELECCIÓN
  // ==========================================================

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "Selecciona los grupos para esta tanda (ejemplo: 1,3): ",
    (respuesta) => {
      const numeros = [
        ...new Set(
          respuesta
            .split(",")
            .map((valor) =>
              Number(valor.trim())
            )
            .filter(
              (numero) =>
                Number.isInteger(numero) &&
                numero >= 1 &&
                numero <= grupos.length
            )
        ),
      ];

      if (numeros.length === 0) {
        console.log("");
        console.log(
          "❌ No seleccionaste ningún grupo válido."
        );
        console.log("");

        rl.close();
        db.close();
        return;
      }

      const gruposSeleccionados =
        numeros.map(
          (numero) =>
            grupos[numero - 1]
        );

      const nombresSeleccionados =
        gruposSeleccionados.map(
          (grupo) => grupo.nombre
        );

      const categoriasSeleccionadas =
        categorias.filter(
          (categoria) =>
            nombresSeleccionados.includes(
              categoria.grupo
            )
        );

      // ======================================================
      // RESUMEN DE LA TANDA
      // ======================================================

      const totalCompetidores =
        categoriasSeleccionadas.reduce(
          (total, categoria) =>
            total +
            categoria.competidores,
          0
        );

      const totalCategorias =
        categoriasSeleccionadas.length;

      const totalCombatesCalculados =
        categoriasSeleccionadas.reduce(
          (total, categoria) => {
            if (
              typeof categoria.combates !==
              "number"
            ) {
              return total;
            }

            return total +
              categoria.combates;
          },
          0
        );

      console.log("");
      console.log(
        "============================================================"
      );

      console.log(
        "                   TANDA SELECCIONADA"
      );

      console.log(
        "============================================================"
      );

      console.log("");

      console.log(
        `Grupos: ${nombresSeleccionados.join(" + ")}`
      );

      console.log(
        `Competidores: ${totalCompetidores}`
      );

      console.log(
        `Categorías: ${totalCategorias}`
      );

      console.log(
        `Combates proyectados calculados: ${totalCombatesCalculados}`
      );

      console.log("");

      // ======================================================
      // DETALLE
      // ======================================================

      console.table(
        categoriasSeleccionadas.map(
          (categoria) => ({
            Grupo:
              categoria.grupo,

            Categoría:
              categoria.nombre,

            Sexo:
              categoria.sexo,

            Peso:
              categoria.peso,

            Competidores:
              categoria.competidores,

            Sistema:
              categoria.sistema,

            Combates:
              categoria.combates === null
                ? "Pendiente"
                : categoria.combates,

            Estado:
              categoria.estadoSistema,
          })
        )
      );

      // ======================================================
      // CATEGORÍAS NO CALCULABLES
      // ======================================================

      const pendientes =
        categoriasSeleccionadas.filter(
          (categoria) =>
            !categoria.sistemaCorrecto ||
            categoria.combates === null
        );

      if (pendientes.length > 0) {
        console.log("");
        console.log(
          "⚠️ CATEGORÍAS QUE NECESITAN REVISIÓN:"
        );

        for (const categoria of pendientes) {
          console.log("");
          console.log(
            `   ${categoria.nombre}`
          );

          console.log(
            `   Competidores: ${categoria.competidores}`
          );

          console.log(
            `   Sistema: ${categoria.sistema}`
          );

          console.log(
            `   Estado: ${categoria.estadoSistema}`
          );

          if (
            categoria.combates === null
          ) {
            console.log(
              "   Combates: todavía no calculables con seguridad"
            );
          }
        }

        console.log("");
      }

      // ======================================================
      // DISTRIBUIR
      // ======================================================

      const propuesta =
        distribuirCategorias(
          categoriasSeleccionadas,
          numeroTatamis
        );

      console.log("");
      console.log(
        "============================================================"
      );

      console.log(
        "             PROPUESTA DE DISTRIBUCIÓN"
      );

      console.log(
        "============================================================"
      );

      console.log("");

      for (const tatami of propuesta) {
        console.log(
          `🥋 TATAMI ${tatami.numero}`
        );

        console.log(
          `   Carga proyectada: ${tatami.carga} combates`
        );

        if (
          tatami.categorias.length === 0
        ) {
          console.log(
            "   Sin categorías"
          );
        } else {
          for (
            const categoria
            of tatami.categorias
          ) {
            const sexoTexto =
              categoria.sexo === "M"
                ? "M"
                : categoria.sexo === "F"
                ? "F"
                : "?";

            console.log(
              `   • ${categoria.nombre} | ${sexoTexto} | ${categoria.competidores} competidores | ${categoria.combates} combates`
            );
          }
        }

        console.log("");
      }

      // ======================================================
      // BALANCE
      // ======================================================

      const cargas =
        propuesta.map(
          (tatami) =>
            tatami.carga
        );

      const maxima =
        Math.max(...cargas);

      const minima =
        Math.min(...cargas);

      console.log(
        "============================================================"
      );

      console.log(
        "                     BALANCE"
      );

      console.log(
        "============================================================"
      );

      console.log("");

      console.log(
        `Carga máxima: ${maxima}`
      );

      console.log(
        `Carga mínima: ${minima}`
      );

      console.log(
        `Diferencia: ${maxima - minima} combates`
      );

      console.log("");

      console.log(
        "🔒 SOLO PROPUESTA"
      );

      console.log(
        "No se modificó JudoShiai."
      );

      console.log(
        "No se asignó ningún tatami."
      );

      console.log("");

      rl.close();
      db.close();
    }
  );
} catch (error) {
  console.error("");
  console.error("❌ ERROR:");
  console.error(error.message);
  console.error("");

  db.close();
}