# Flujo de Alto Nivel - api.js

## Diagrama de Flujo Completo

```
┌─────────────────────────────────────────────────────────────────┐
│                    INICIO - main()                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 1: CONFIGURACIÓN                                          │
│  ────────────────────────                                       │
│  • loadConfiguration()                                          │
│    - Lee variables de entorno (.env)                            │
│    - Valida: APP_ID, PRIVATE_KEY, INSTALLATION_ID,              │
│              OWNER, REPO, PR_NUMBER                             │
│    - Configura: maxDeltaDays, outputDir, outputPath            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 2: AUTENTICACIÓN                                          │
│  ────────────────────────                                       │
│  • authenticateWithGitHub()                                    │
│    - loadPrivateKey() → Lee clave privada (archivo o env)       │
│    - createAppAuth() → Crea autenticación de GitHub App         │
│    - Obtiene token de instalación                               │
│    - Crea clientes: Octokit (REST) y GraphQL                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 3: OBTENCIÓN DE DATOS DEL PR                               │
│  ─────────────────────────────────                              │
│                                                                  │
│  3.1) fetchPRMetadata()                                         │
│       └─> Obtiene: PR base ref, PR author                       │
│                                                                  │
│  3.2) fetchPRCommits()                                          │
│       └─> Lista todos los commits del PR                        │
│       └─> Crea Set de SHAs de commits del PR                    │
│                                                                  │
│  3.3) buildLastCommitByFile()                                   │
│       └─> Para cada commit (nuevo → antiguo):                    │
│           • fetchCommitDetails() → Detalles del commit          │
│           • extractCommitAuthorAndDate() → Autor y fecha         │
│           • Mapea: archivo → último commit que lo modificó      │
│                                                                  │
│  3.4) fetchPRFiles()                                            │
│       └─> Lista archivos modificados en el PR (con patches)     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 4: ANÁLISIS DE ARCHIVOS                                   │
│  ────────────────────────────                                   │
│                                                                  │
│  Para cada archivo en el PR:                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  analyzeFile()                                           │  │
│  │                                                           │  │
│  │  4.1) parsePatch()                                       │  │
│  │       └─> Parsea el diff unificado                       │  │
│  │       └─> Identifica líneas agregadas                     │  │
│  │       └─> Clasifica hunks:                               │  │
│  │           • add-only: Solo líneas agregadas               │  │
│  │           • replace: Líneas removidas y agregadas        │  │
│  │           • delete-only: Solo líneas removidas           │  │
│  │                                                           │  │
│  │  4.2) getFileBlameFiltered()                             │  │
│  │       └─> Ejecuta query GraphQL (BLAME_QUERY)            │  │
│  │       └─> Obtiene blame en baseRef (antes del PR)       │  │
│  │       └─> Filtra rangos que apuntan a commits del PR     │  │
│  │                                                           │  │
│  │  4.3) Para cada línea agregada:                           │  │
│  │       └─> classifyLine()                                 │  │
│  │           • Si hunk es "add-only" → "New Work"           │  │
│  │           • Si hunk es "replace":                         │  │
│  │             - Busca rango de blame para la línea          │  │
│  │             - Extrae: autor previo, commit, fecha         │  │
│  │             - Calcula deltaDays (días entre commits)     │  │
│  │             - Clasifica:                                  │  │
│  │               * Mismo autor + Δ ≤ 21 días → "Churn"       │  │
│  │               * Mismo autor + Δ > 21 días → "Rework"    │  │
│  │               * Diferente autor → "Help Others"          │  │
│  │           • Acumula en summary y details                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  FASE 5: GUARDADO DE RESULTADOS                                 │
│  ───────────────────────────────                                │
│  • saveResults()                                                │
│    - ensureOutputDirectoryExists() → Crea carpeta "output/"     │
│    - Genera objeto JSON con:                                    │
│      • pr, repo, resumen (contadores), detalles (líneas)       │
│    - Guarda en: output/pr_{N}_churn_summary.json               │
│    - Muestra resumen en consola                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FIN - process.exit(0)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Descripción Detallada de las Fases

### FASE 1: CONFIGURACIÓN
- **Propósito**: Validar y cargar configuración desde variables de entorno
- **Input**: Archivo `.env` con credenciales y parámetros
- **Output**: Objeto `config` validado
- **Validaciones**: Verifica que todas las variables requeridas estén presentes

### FASE 2: AUTENTICACIÓN
- **Propósito**: Autenticarse con GitHub usando GitHub App
- **Proceso**:
  1. Lee la clave privada (desde archivo o variable de entorno)
  2. Crea autenticación de GitHub App
  3. Obtiene token de instalación
  4. Crea clientes autenticados (Octokit REST API y GraphQL)
- **Output**: Clientes `octokit` y `graphqlWithAuth` listos para usar

### FASE 3: OBTENCIÓN DE DATOS DEL PR
- **Propósito**: Recopilar toda la información necesaria del Pull Request
- **Datos obtenidos**:
  1. **Metadatos del PR**: Base ref (SHA de la rama base), autor del PR
  2. **Commits del PR**: Lista de commits y sus SHAs (para filtrar)
  3. **Último commit por archivo**: Mapa que indica qué commit modificó cada archivo por última vez
  4. **Archivos modificados**: Lista de archivos con sus patches (diffs)

### FASE 4: ANÁLISIS DE ARCHIVOS
- **Propósito**: Clasificar cada línea agregada en el PR según su tipo de churn
- **Proceso por archivo**:
  1. **Parseo del patch**: Extrae líneas agregadas y clasifica hunks
  2. **Blame**: Obtiene información histórica de cada línea (quién y cuándo la escribió)
  3. **Clasificación**: Para cada línea agregada:
     - Determina si es código nuevo, churn, rework o ayuda a otros
     - Basado en: tipo de hunk, autor previo, tiempo transcurrido

### FASE 5: GUARDADO DE RESULTADOS
- **Propósito**: Persistir los resultados del análisis
- **Proceso**:
  1. Crea directorio de salida si no existe
  2. Genera objeto JSON con resumen y detalles
  3. Guarda archivo en `output/pr_{N}_churn_summary.json`
  4. Muestra resumen en consola

## Clasificación de Líneas

El sistema clasifica cada línea agregada en 4 categorías:

1. **New Work**: Código completamente nuevo (hunk add-only o sin blame previo)
2. **Churn**: Mismo autor modificando código reciente (≤ 21 días)
3. **Rework**: Mismo autor modificando código antiguo (> 21 días)
4. **Help Others**: Diferente autor modificando código de otro

## Puntos Clave del Flujo

- **Filtrado de commits del PR**: Se filtran los commits del PR del blame para evitar sesgos
- **Blame en baseRef**: Se usa la rama base (antes del PR) para el blame
- **Último commit por archivo**: Se identifica el último commit que modificó cada archivo para determinar autor/fecha actual
- **Procesamiento secuencial**: Los archivos se procesan uno por uno, pero el análisis es eficiente con caché de commits
