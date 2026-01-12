// analyze_pr_churn_filtered.js
import dotenv from "dotenv";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import fs from "fs";
import path from "path";

dotenv.config();

// ============================================================================
// CONSTANTS
// ============================================================================

const CATEGORIES = {
  CHURN: "Churn",
  REWORK: "Rework",
  NEW_WORK: "New Work",
  HELP_OTHERS: "Help Others"
};

const HUNK_TYPES = {
  ADD_ONLY: "add-only",
  DELETE_ONLY: "delete-only",
  REPLACE: "replace"
};

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
const DEFAULT_MAX_DELTA_DAYS = 21;
const DEFAULT_PER_PAGE = 250;
const DEFAULT_OUTPUT_DIR = "output";

// GraphQL query para obtener información de blame
const BLAME_QUERY = `
  query Blame($owner: String!, $repo: String!, $commitExpr: String!, $path: String!) {
    repository(owner: $owner, name: $repo) {
      object(expression: $commitExpr) {
        __typename
        ... on Commit {
          blame(path: $path) {
            ranges {
              startingLine
              endingLine
              commit {
                oid
                committedDate
                author {
                  name
                  email
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Carga y valida la configuración desde variables de entorno
 * @returns {Object} Configuración validada
 */
function loadConfiguration() {
  const config = {
    appId: process.env.APP_ID,
    privateKeyPath: process.env.PRIVATE_KEY_PATH,
    privateKeyRaw: process.env.PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID,
    owner: process.env.REPO_OWNER,
    repo: process.env.REPO_NAME,
    prNumber: process.env.PR_NUMBER ? parseInt(process.env.PR_NUMBER, 10) : undefined,
    maxDeltaDays: parseInt(process.env.MAX_DELTA_DAYS || String(DEFAULT_MAX_DELTA_DAYS), 10),
    outputPath: process.env.OUTPUT_JSON,
    outputDir: process.env.OUTPUT_DIR || DEFAULT_OUTPUT_DIR
  };

  // Validar variables requeridas
  if (!config.appId || (!config.privateKeyPath && !config.privateKeyRaw) || 
      !config.installationId || !config.owner || !config.repo || !config.prNumber) {
    console.error("Missing required env vars. Required: APP_ID, (PRIVATE_KEY_PATH or PRIVATE_KEY), INSTALLATION_ID, OWNER, REPO, PR_NUMBER");
    process.exit(1);
  }

  return config;
}

/**
 * Carga la clave privada desde archivo o variable de entorno
 * @param {string} privateKeyPath - Ruta al archivo de clave privada
 * @param {string} privateKeyRaw - Clave privada como string
 * @returns {string} Clave privada procesada
 */
function loadPrivateKey(privateKeyPath, privateKeyRaw) {
  if (privateKeyPath) {
    try {
      return fs.readFileSync(privateKeyPath, "utf8");
    } catch (err) {
      console.error("Failed reading PRIVATE_KEY_PATH:", err.message);
      process.exit(1);
    }
  }
  
  // Permitir newlines escapados en variable de entorno
  return privateKeyRaw.replace(/\\n/g, "\n");
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Autentica con GitHub App y retorna los clientes de API
 * @param {Object} config - Configuración con credenciales
 * @returns {Object} Clientes de Octokit y GraphQL autenticados
 */
async function authenticateWithGitHub(config) {
  const privateKey = loadPrivateKey(config.privateKeyPath, config.privateKeyRaw);
  
  const appAuth = createAppAuth({
    appId: config.appId,
    privateKey: privateKey,
  });

  let installationAuth;
  try {
    installationAuth = await appAuth({ 
      type: "installation", 
      installationId: parseInt(config.installationId, 10) 
    });
  } catch (err) {
    console.error("Failed to get installation token:", err.message);
    process.exit(1);
  }

  const token = installationAuth.token;
  const octokit = new Octokit({ auth: token });
  const graphqlWithAuth = graphql.defaults({ 
    headers: { authorization: `token ${token}` } 
  });

  return { octokit, graphqlWithAuth };
}

// ============================================================================
// PATCH PARSING
// ============================================================================

/**
 * Verifica si una línea está en blanco
 * @param {string} lineContent - Contenido de la línea
 * @returns {boolean} True si la línea está en blanco
 */
function isBlankLine(lineContent) {
  return /^\s*$/.test(lineContent);
}

/**
 * Determina el tipo de hunk basado en líneas agregadas y removidas
 * @param {Array} removedLines - Líneas removidas (sin líneas en blanco)
 * @param {Array} addedLines - Líneas agregadas (sin líneas en blanco)
 * @param {Array} allAddedLines - Todas las líneas agregadas (incluyendo blancas)
 * @returns {string} Tipo de hunk
 */
function determineHunkType(removedLines, addedLines, allAddedLines) {
  if (removedLines.length === 0 && addedLines.length > 0) {
    return HUNK_TYPES.ADD_ONLY;
  }
  if (removedLines.length > 0 && addedLines.length === 0) {
    return HUNK_TYPES.DELETE_ONLY;
  }
  if (removedLines.length > 0 && addedLines.length > 0) {
    return HUNK_TYPES.REPLACE;
  }
  // Solo líneas en blanco - tratar como add-only si hay líneas agregadas
  return allAddedLines.length > 0 ? HUNK_TYPES.ADD_ONLY : HUNK_TYPES.DELETE_ONLY;
}

/**
 * Finaliza un hunk y agrega las líneas agregadas al resultado
 * @param {Object} currentHunk - Hunk actual siendo procesado
 * @param {Array} addedLines - Array donde se acumulan las líneas agregadas
 * @returns {Object} Hunk reseteado para el siguiente
 */
function finalizeHunk(currentHunk, addedLines) {
  if (currentHunk.addedLines.length === 0 && currentHunk.removedLines.length === 0) {
    return createEmptyHunk(); // Hunk vacío, saltar
  }

  // Filtrar líneas en blanco para determinar tipo de hunk
  const nonBlankRemoved = currentHunk.removedLines.filter(l => !isBlankLine(l.content));
  const nonBlankAdded = currentHunk.addedLines.filter(l => !isBlankLine(l.content));

  const hunkType = determineHunkType(nonBlankRemoved, nonBlankAdded, currentHunk.addedLines);

  // Agregar todas las líneas agregadas con su tipo de hunk
  for (const added of currentHunk.addedLines) {
    addedLines.push({
      line: added.content,
      number: added.lineNum,
      hunkType,
      removedLines: hunkType === HUNK_TYPES.REPLACE ? currentHunk.removedLines : []
    });
  }

  return createEmptyHunk();
}

/**
 * Crea un hunk vacío
 * @returns {Object} Hunk vacío
 */
function createEmptyHunk() {
  return {
    removedLines: [],
    addedLines: [],
    startNewLine: 0,
    startOldLine: 0
  };
}

/**
 * Parsea un patch unificado y retorna líneas agregadas con metadatos de tipo de hunk
 * @param {string} patch - String del patch unificado
 * @returns {Array} Array de { line, number, hunkType, removedLines }
 */
function parsePatch(patch) {
  const addedLines = [];
  let newLineNum = 0;
  let oldLineNum = 0;
  
  const lines = patch.split("\n");
  let currentHunk = createEmptyHunk();

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Finalizar hunk anterior antes de empezar uno nuevo
      currentHunk = finalizeHunk(currentHunk, addedLines);

      // Parsear header del hunk: @@ -12,6 +12,9 @@
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
        currentHunk.startOldLine = oldLineNum;
        currentHunk.startNewLine = newLineNum;
      } else {
        oldLineNum = 0;
        newLineNum = 0;
      }
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      // Línea agregada
      const content = line.substring(1);
      currentHunk.addedLines.push({ content, lineNum: newLineNum });
      newLineNum++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      // Línea removida
      const content = line.substring(1);
      currentHunk.removedLines.push({ content, lineNum: oldLineNum });
      oldLineNum++;
    } else if (!line.startsWith("\\")) {
      // Línea de contexto (o vacía)
      // Finalizar hunk actual cuando encontramos contexto
      if (currentHunk.addedLines.length > 0 || currentHunk.removedLines.length > 0) {
        currentHunk = finalizeHunk(currentHunk, addedLines);
      }
      newLineNum++;
      oldLineNum++;
    }
  }

  // Finalizar último hunk
  finalizeHunk(currentHunk, addedLines);

  return addedLines;
}

// ============================================================================
// BLAME OPERATIONS
// ============================================================================

/**
 * Obtiene rangos de blame para un archivo y filtra commits del PR
 * @param {Function} graphqlClient - Cliente GraphQL autenticado
 * @param {string} filePath - Ruta del archivo
 * @param {string} baseRef - Referencia base (SHA o ref)
 * @param {Set} prShas - Set de SHAs de commits del PR
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @returns {Object} { ranges: Array, filteredCount: number }
 */
async function getFileBlameFiltered(graphqlClient, filePath, baseRef, prShas, owner, repo) {
  try {
    const res = await graphqlClient(BLAME_QUERY, {
      owner,
      repo,
      commitExpr: baseRef,
      path: filePath,
    });

    const obj = res?.repository?.object;
    if (!obj) {
      return { ranges: [], filteredCount: 0 };
    }

    if (obj.__typename !== "Commit") {
      console.warn(`[blame] expected Commit but got ${obj.__typename} for ${baseRef}. Returning empty ranges.`);
      return { ranges: [], filteredCount: 0 };
    }

    const ranges = obj.blame?.ranges || [];

    // Filtrar rangos cuyo commit oid es parte del PR
    const filtered = ranges.filter(r => !(r.commit && prShas.has(r.commit.oid)));
    const filteredCount = ranges.length - filtered.length;

    if (filteredCount > 0) {
      console.log(`  [blame] filtered out ${filteredCount} range(s) in ${filePath} because they point to PR commit(s).`);
    }

    return { ranges: filtered, filteredCount };
  } catch (err) {
    console.warn(`[blame] GraphQL error for ${filePath} @ ${baseRef}: ${err.message}`);
    return { ranges: [], filteredCount: 0 };
  }
}

// ============================================================================
// LINE CLASSIFICATION
// ============================================================================

/**
 * Extrae información del commit desde un rango de blame
 * @param {Object} range - Rango de blame
 * @returns {Object} { author, commitOid, date }
 */
function extractCommitInfo(range) {
  const commit = range.commit || {};
  const author = commit.author?.name || null;
  const commitOid = commit.oid || null;
  const dateStr = commit.committedDate || null;
  const date = dateStr ? new Date(dateStr) : null;

  return { author, commitOid, date };
}

/**
 * Calcula la diferencia en días entre dos fechas
 * @param {Date} currentDate - Fecha actual
 * @param {Date} previousDate - Fecha previa
 * @returns {number} Diferencia en días
 */
function calculateDeltaDays(currentDate, previousDate) {
  const deltaMs = currentDate - previousDate;
  return deltaMs / MILLISECONDS_PER_DAY;
}

/**
 * Clasifica una línea agregada basándose en tipo de hunk e información de blame
 * @param {number} lineNum - Número de línea en el archivo nuevo
 * @param {string} hunkType - Tipo de hunk: "add-only", "replace", o "delete-only"
 * @param {Array} blameRanges - Rangos de blame de git blame
 * @param {string} currentAuthor - Autor del commit actual
 * @param {Date} currentDate - Fecha del commit actual
 * @param {number} maxDeltaDays - Umbral para churn vs rework (default 21 días)
 * @returns {Object} Resultado de clasificación con category, prevAuthor, prevCommit, deltaDays
 */
function classifyLine(lineNum, hunkType, blameRanges, currentAuthor, currentDate, maxDeltaDays) {
  if (!Array.isArray(blameRanges)) {
    blameRanges = [];
  }

  // Si es un hunk add-only, siempre es New Work
  if (hunkType === HUNK_TYPES.ADD_ONLY) {
    return { 
      category: CATEGORIES.NEW_WORK, 
      prevAuthor: null, 
      prevCommit: null, 
      deltaDays: null 
    };
  }

  // Para hunks replace, usar blame para determinar la categoría
  if (hunkType === HUNK_TYPES.REPLACE) {
    const range = blameRanges.find(r => lineNum >= r.startingLine && lineNum <= r.endingLine);

    if (!range) {
      // No se encontró blame, tratar como New Work
      return { 
        category: CATEGORIES.NEW_WORK, 
        prevAuthor: null, 
        prevCommit: null, 
        deltaDays: null 
      };
    }

    const { author: prevAuthor, commitOid: prevCommit, date: prevDate } = extractCommitInfo(range);

    if (!prevDate) {
      return { 
        category: CATEGORIES.NEW_WORK, 
        prevAuthor, 
        prevCommit, 
        deltaDays: null 
      };
    }

    const deltaDays = calculateDeltaDays(currentDate, prevDate);

    let category;
    if (prevAuthor === currentAuthor) {
      category = deltaDays <= maxDeltaDays ? CATEGORIES.CHURN : CATEGORIES.REWORK;
    } else {
      category = CATEGORIES.HELP_OTHERS;
    }

    return { category, prevAuthor, prevCommit, deltaDays };
  }

  // Hunks delete-only no agregan líneas, así que esto no debería ser llamado para ellos
  return { 
    category: CATEGORIES.NEW_WORK, 
    prevAuthor: null, 
    prevCommit: null, 
    deltaDays: null 
  };
}

// ============================================================================
// PR DATA FETCHING
// ============================================================================

/**
 * Obtiene metadatos del PR
 * @param {Object} octokit - Cliente Octokit autenticado
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {number} prNumber - Número del PR
 * @returns {Object} { pr, baseRef, prAuthor }
 */
async function fetchPRMetadata(octokit, owner, repo, prNumber) {
  const prResp = await octokit.pulls.get({ 
    owner, 
    repo, 
    pull_number: prNumber 
  });
  const pr = prResp.data;
  const baseRef = pr.base.sha || pr.base.ref;
  const prAuthor = pr.user?.login || null;

  console.log(`Analyzing PR #${prNumber} in ${owner}/${repo}`);
  console.log(`Base ref for blame: ${baseRef}`);
  console.log(`PR author fallback: ${prAuthor}`);

  return { pr, baseRef, prAuthor };
}

/**
 * Obtiene los commits del PR
 * @param {Object} octokit - Cliente Octokit autenticado
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {number} prNumber - Número del PR
 * @returns {Object} { prCommits, prShas }
 */
async function fetchPRCommits(octokit, owner, repo, prNumber) {
  const commitsResp = await octokit.pulls.listCommits({ 
    owner, 
    repo, 
    pull_number: prNumber, 
    per_page: DEFAULT_PER_PAGE 
  });
  const prCommits = commitsResp.data; // más antiguo -> más nuevo
  const prShas = new Set(prCommits.map(c => c.sha));

  console.log(`PR contains ${prCommits.length} commits. (Using ${prShas.size} SHAs)`);

  return { prCommits, prShas };
}

/**
 * Obtiene detalles de un commit
 * @param {Object} octokit - Cliente Octokit autenticado
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {string} sha - SHA del commit
 * @returns {Object|null} Detalles del commit o null si falla
 */
async function fetchCommitDetails(octokit, owner, repo, sha) {
  try {
    const resp = await octokit.repos.getCommit({ owner, repo, ref: sha });
    return resp.data;
  } catch (err) {
    console.warn(`Failed to fetch commit details for ${sha}: ${err.message}`);
    return null;
  }
}

/**
 * Extrae autor y fecha de un commit
 * @param {Object} commitDetails - Detalles del commit
 * @param {Object} commitSummary - Resumen del commit de la lista
 * @param {string} fallbackAuthor - Autor de respaldo
 * @returns {Object} { author, date }
 */
function extractCommitAuthorAndDate(commitDetails, commitSummary, fallbackAuthor) {
  const author = commitDetails?.commit?.author?.name || 
                 commitSummary?.author?.login || 
                 fallbackAuthor || 
                 "unknown";
  
  const date = commitDetails?.commit?.author?.date 
    ? new Date(commitDetails.commit.author.date)
    : new Date();

  return { author, date };
}

/**
 * Construye un mapa del último commit por archivo modificado en el PR
 * @param {Object} octokit - Cliente Octokit autenticado
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {Array} prCommits - Commits del PR (más antiguo -> más nuevo)
 * @param {string} prAuthor - Autor del PR como respaldo
 * @returns {Map} Mapa de filename -> { author, date, sha }
 */
async function buildLastCommitByFile(octokit, owner, repo, prCommits, prAuthor) {
  const lastCommitByFile = new Map();
  const commitDetailsCache = new Map();

  console.log(`Building last-commit-per-file map (walk commits newest->oldest)...`);

  // Iterar desde el más nuevo al más antiguo para obtener el último commit por archivo
  for (let i = prCommits.length - 1; i >= 0; i--) {
    const commitSummary = prCommits[i];
    const sha = commitSummary.sha;

    let commitDetails = commitDetailsCache.get(sha);
    if (!commitDetails) {
      commitDetails = await fetchCommitDetails(octokit, owner, repo, sha);
      if (!commitDetails) continue;
      commitDetailsCache.set(sha, commitDetails);
    }

    const { author, date } = extractCommitAuthorAndDate(commitDetails, commitSummary, prAuthor);

    const files = commitDetails.files || [];
    for (const file of files) {
      if (!lastCommitByFile.has(file.filename)) {
        lastCommitByFile.set(file.filename, {
          author,
          date,
          sha,
        });
      }
    }
  }

  console.log(`Found last commit info for ${lastCommitByFile.size} files touched in PR.`);

  return lastCommitByFile;
}

/**
 * Obtiene los archivos modificados en el PR
 * @param {Object} octokit - Cliente Octokit autenticado
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {number} prNumber - Número del PR
 * @returns {Array} Archivos modificados en el PR
 */
async function fetchPRFiles(octokit, owner, repo, prNumber) {
  const prFilesResp = await octokit.pulls.listFiles({ 
    owner, 
    repo, 
    pull_number: prNumber, 
    per_page: DEFAULT_PER_PAGE 
  });
  return prFilesResp.data;
}

// ============================================================================
// ANALYSIS
// ============================================================================

/**
 * Analiza un archivo y clasifica sus líneas agregadas
 * @param {Object} file - Archivo del PR
 * @param {Function} graphqlClient - Cliente GraphQL autenticado
 * @param {string} baseRef - Referencia base
 * @param {Set} prShas - SHAs de commits del PR
 * @param {Map} lastCommitByFile - Mapa del último commit por archivo
 * @param {string} prAuthor - Autor del PR como respaldo
 * @param {Date} prDate - Fecha del PR como respaldo
 * @param {number} maxDeltaDays - Umbral máximo de días para churn
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @returns {Object} { summary, details }
 */
async function analyzeFile(file, graphqlClient, baseRef, prShas, lastCommitByFile, 
                           prAuthor, prDate, maxDeltaDays, owner, repo) {
  console.log(`\n----\nChecking file: ${file.filename}`);

  if (!file.patch) {
    console.log(`Skipping ${file.filename} (no patch - maybe binary)`);
    return { summary: {}, details: [] };
  }

  const addedLines = parsePatch(file.patch);
  console.log(`  Added lines to analyze: ${addedLines.length}`);

  // Contar tipos de hunk para logging
  const hunkTypeCounts = addedLines.reduce((acc, line) => {
    acc[line.hunkType] = (acc[line.hunkType] || 0) + 1;
    return acc;
  }, {});
  console.log(`  Hunk types: ${JSON.stringify(hunkTypeCounts)}`);

  // Blame en baseRef (para que cambios del PR no estén en blame) y filtrar rangos que apunten a commits del PR
  const { ranges: blameRanges, filteredCount } = await getFileBlameFiltered(
    graphqlClient, 
    file.filename, 
    baseRef, 
    prShas,
    owner,
    repo
  );

  if (filteredCount > 0) {
    console.warn(`  NOTE: ${filteredCount} blame ranges in ${file.filename} pointed to PR commits and were filtered out.`);
  }

  // Obtener autor/fecha "actual" para este archivo desde lastCommitByFile si existe
  const lastCommit = lastCommitByFile.get(file.filename);
  const currentAuthor = lastCommit?.author || prAuthor || "unknown";
  const currentDate = lastCommit?.date || prDate;

  const summary = {};
  const details = [];

  for (const addedLine of addedLines) {
    const result = classifyLine(
      addedLine.number, 
      addedLine.hunkType, 
      blameRanges, 
      currentAuthor, 
      currentDate, 
      maxDeltaDays
    );

    // Log detalle
    if (result.prevCommit) {
      console.log(
        `  [${file.filename}] line ${addedLine.number} [${addedLine.hunkType}]: ` +
        `"${addedLine.line.slice(0, 60)}" => ${result.category} ` +
        `(prev: ${result.prevAuthor}@${result.prevCommit.slice(0, 7)}, ` +
        `Δ=${(result.deltaDays || 0).toFixed(1)}d)`
      );
    } else {
      console.log(
        `  [${file.filename}] line ${addedLine.number} [${addedLine.hunkType}]: ` +
        `"${addedLine.line.slice(0, 60)}" => ${result.category}`
      );
    }

    // Acumular
    summary[result.category] = (summary[result.category] || 0) + 1;
    details.push({
      archivo: file.filename,
      linea: addedLine.number,
      contenido: addedLine.line,
      tipoHunk: addedLine.hunkType,
      categoria: result.category,
      autorActual: currentAuthor,
      autorPrevio: result.prevAuthor,
      commitPrevio: result.prevCommit,
      deltaDias: result.deltaDays
    });
  }

  return { summary, details };
}

/**
 * Asegura que el directorio de salida existe, creándolo si es necesario
 * @param {string} dirPath - Ruta del directorio
 */
function ensureOutputDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created output directory: ${dirPath}`);
    } catch (err) {
      console.error(`Failed to create output directory ${dirPath}:`, err.message);
      throw err;
    }
  }
}

/**
 * Genera el resumen final y lo guarda
 * @param {Object} summary - Resumen de categorías
 * @param {Array} details - Detalles de todas las líneas
 * @param {number} prNumber - Número del PR
 * @param {string} owner - Propietario del repositorio
 * @param {string} repo - Nombre del repositorio
 * @param {string} outputPath - Ruta opcional para el archivo de salida
 * @param {string} outputDir - Directorio donde guardar los archivos (default: "output")
 */
function saveResults(summary, details, prNumber, owner, repo, outputPath, outputDir = DEFAULT_OUTPUT_DIR) {
  const output = {
    pr: prNumber,
    repo: `${owner}/${repo}`,
    resumen: summary,
    detalles: details,
    analysed_at: new Date().toISOString()
  };

  console.log("\n==== FINAL SUMMARY ====");
  console.log(JSON.stringify(output, null, 2));

  // Asegurar que el directorio de salida existe
  ensureOutputDirectoryExists(outputDir);

  // Construir ruta del archivo
  const fileName = outputPath || `pr_${prNumber}_churn_summary.json`;
  const finalOutputPath = path.join(outputDir, fileName);

  try {
    fs.writeFileSync(finalOutputPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`Saved output to ${finalOutputPath}`);
  } catch (err) {
    console.warn("Failed to write output file:", err.message);
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

/**
 * Función principal que ejecuta el análisis completo
 */
async function main() {
  const config = loadConfiguration();
  const { octokit, graphqlWithAuth } = await authenticateWithGitHub(config);

  // 1) Obtener metadatos del PR
  const { pr, baseRef, prAuthor } = await fetchPRMetadata(
    octokit, 
    config.owner, 
    config.repo, 
    config.prNumber
  );

  // 2) Obtener commits del PR
  const { prCommits, prShas } = await fetchPRCommits(
    octokit, 
    config.owner, 
    config.repo, 
    config.prNumber
  );

  // 3) Construir mapa del último commit por archivo
  const lastCommitByFile = await buildLastCommitByFile(
    octokit, 
    config.owner, 
    config.repo, 
    prCommits, 
    prAuthor
  );

  // 4) Obtener archivos del PR
  const prFiles = await fetchPRFiles(
    octokit, 
    config.owner, 
    config.repo, 
    config.prNumber
  );

  // 5) Analizar cada archivo
  const summary = { 
    [CATEGORIES.CHURN]: 0, 
    [CATEGORIES.REWORK]: 0, 
    [CATEGORIES.NEW_WORK]: 0, 
    [CATEGORIES.HELP_OTHERS]: 0 
  };
  const allDetails = [];

  const prDate = new Date(pr.updated_at || pr.created_at || Date.now());

  for (const file of prFiles) {
    const { summary: fileSummary, details: fileDetails } = await analyzeFile(
      file,
      graphqlWithAuth,
      baseRef,
      prShas,
      lastCommitByFile,
      prAuthor,
      prDate,
      config.maxDeltaDays,
      config.owner,
      config.repo
    );

    // Acumular resultados
    for (const [category, count] of Object.entries(fileSummary)) {
      summary[category] = (summary[category] || 0) + count;
    }
    allDetails.push(...fileDetails);
  }

  // 6) Guardar resultados
  saveResults(
    summary, 
    allDetails, 
    config.prNumber, 
    config.owner, 
    config.repo, 
    config.outputPath,
    config.outputDir
  );
}

// Ejecutar
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
