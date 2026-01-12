# Guía de Testing

## Tests Unitarios

Los tests unitarios están implementados usando el test runner nativo de Node.js (`node --test`). Para ejecutarlos:

```bash
npm test
```

**Resultado esperado:**
```
# tests 78
# suites 21
# pass 78
# fail 0
```

### Configuración del Test Runner

El comando `npm test` ejecuta:
```bash
node --test test/classifier.test.js test/parser.test.js
```

**Nota:** Los archivos de test se listan explícitamente en lugar de usar glob patterns (`test/*.test.js`) para compatibilidad con Windows/PowerShell, donde los globs no se expanden automáticamente.

## Resumen de Tests

### 📁 `test/classifier.test.js` - 66 tests

Este archivo prueba la función `classifyLine()` que clasifica líneas agregadas en un PR según su tipo de churn.

#### 1. **Add-only hunks** (3 tests)
- Siempre clasifica como "New Work"
- Ignora blame ranges cuando es add-only
- Maneja variaciones de case

#### 2. **Replace hunks - Churn** (6 tests)
- Clasifica como "Churn" cuando mismo autor y ≤ 21 días
- Casos límite: 0 días (mismo día), 1 día, 20.9 días
- Maneja cambios muy recientes (horas)
- Umbral exacto en 21 días

#### 3. **Replace hunks - Rework** (5 tests)
- Clasifica como "Rework" cuando mismo autor y > 21 días
- Casos límite: 21.1 días, 22 días, 30 días
- Maneja código muy antiguo (años)

#### 4. **Replace hunks - Help Others** (5 tests)
- Clasifica como "Help Others" cuando autor diferente
- Independiente del tiempo transcurrido
- Maneja mismo día pero diferente autor
- Comparación case-sensitive de autores

#### 5. **Blame range edge cases** (8 tests)
- Líneas en los bordes exactos (startingLine, endingLine)
- Líneas fuera de rango (antes/después)
- Línea 0 (primera línea)
- Rangos de una sola línea
- Múltiples rangos (encuentra el correcto)
- Rangos superpuestos (encuentra el primero)

#### 6. **Missing or null data edge cases** (16 tests)
- `blameRanges`: null, undefined, objeto no-array, vacío
- `committedDate`: null, undefined, string vacío, string inválido
- `commit`: null, undefined
- `commit.oid`: faltante, null
- `commit.author`: faltante, null
- `commit.author.name`: faltante, null, string vacío
- `startingLine`/`endingLine`: faltantes

#### 7. **Hunk type edge cases** (5 tests)
- `delete-only` (default a New Work)
- Tipos desconocidos
- null, undefined, string vacío

#### 8. **maxDeltaDays edge cases** (6 tests)
- Umbral personalizado (10 días)
- maxDeltaDays = 0 (siempre Rework para mismo autor)
- maxDeltaDays = 1
- maxDeltaDays muy grande (1000 días)
- undefined (usa default 21)
- null

#### 9. **Author edge cases** (4 tests)
- `currentAuthor`: null, undefined, string vacío
- Comparación con whitespace differences (case-sensitive)

#### 10. **Date edge cases** (3 tests)
- Fechas en el futuro (deltaDays negativo)
- Diferentes timezones
- Timestamps exactamente iguales

#### 11. **Line number edge cases** (3 tests)
- Números de línea muy grandes
- Números de línea negativos
- Número de línea como string (coerción)

#### 12. **Complex scenarios** (2 tests)
- Escenario completo real-world
- Condiciones límite para todas las categorías

### 📁 `test/parser.test.js` - 12 tests

Este archivo prueba la función `parsePatch()` que parsea diffs unificados y extrae líneas agregadas.

#### 1. **Add-only hunks** (2 tests)
- Código completamente nuevo
- Líneas en blanco agregadas

#### 2. **Replace hunks** (2 tests)
- Reemplazo de código
- Cambios de formato

#### 3. **Delete-only hunks** (1 test)
- No retorna líneas para delete-only

#### 4. **Edge cases with blank lines** (2 tests)
- Remoción de líneas en blanco + adición de código (tratado como add-only)
- Cambios solo de whitespace

#### 5. **Mixed hunks in one patch** (1 test)
- Múltiples tipos de hunks en un solo patch

#### 6. **Line numbers** (2 tests)
- Números de línea correctos en archivo nuevo
- Números de línea a través de múltiples hunks

#### 7. **Removed lines metadata** (2 tests)
- Incluye líneas removidas para replace hunks
- No incluye líneas removidas para add-only hunks

## Categorías de Clasificación

El sistema clasifica cada línea agregada en una de estas 4 categorías:

### 1. **New Work**
- Código completamente nuevo
- Hunks de tipo `add-only`
- Líneas sin blame previo
- Líneas con fecha inválida o faltante

### 2. **Churn**
- Mismo autor modificando código reciente
- Umbral: ≤ `MAX_DELTA_DAYS` (default: 21 días)
- Indica iteraciones rápidas o correcciones inmediatas

### 3. **Rework**
- Mismo autor modificando código antiguo
- Umbral: > `MAX_DELTA_DAYS` (default: 21 días)
- Indica refactors o mejoras a código establecido

### 4. **Help Others**
- Diferente autor modificando código
- Independiente del tiempo transcurrido
- Indica colaboración o mantenimiento cruzado

## Tipos de Hunks

El sistema identifica 3 tipos de hunks en los diffs:

### 1. **add-only**
- Solo líneas agregadas (`+`)
- No hay líneas removidas (`-`) en el hunk
- Siempre clasificado como "New Work"

### 2. **replace**
- Tanto líneas agregadas como removidas
- Requiere análisis de blame para clasificación
- Puede ser Churn, Rework o Help Others

### 3. **delete-only**
- Solo líneas removidas
- No agrega líneas, así que no se clasifica
- (Las líneas removidas no se analizan en el contexto de churn)

## Validación con PR Real

Para validar que el código funciona correctamente con un PR real de GitHub:

### 1. Configurar GitHub App

Necesitas una GitHub App con permisos de lectura en el repositorio:

1. Ve a GitHub Settings → Developer settings → GitHub Apps
2. Crea una nueva app o usa una existente
3. Permisos necesarios:
   - Repository permissions → Contents: Read
   - Repository permissions → Pull requests: Read
   - Repository permissions → Metadata: Read
4. Instala la app en tu repositorio
5. Descarga la private key

### 2. Configurar Variables de Entorno

Crea un archivo `.env`:

```bash
APP_ID=123456
INSTALLATION_ID=789012
PRIVATE_KEY_PATH=./private-key.pem
# O alternativamente:
# PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
REPO_OWNER=tu-usuario
REPO_NAME=tu-repo
PR_NUMBER=123
MAX_DELTA_DAYS=21
OUTPUT_DIR=output
OUTPUT_JSON=pr_123_churn_summary.json
```

### 3. Ejecutar el Análisis

```bash
node api.js
```

### 4. Verificar el Output

El script generará:

1. **Output en consola** con detalles línea por línea:
```
Analyzing PR #123 in owner/repo
Base ref for blame: abc123def456
PR contains 5 commits. (Using 5 SHAs)

----
Checking file: src/app.js
  Added lines to analyze: 10
  Hunk types: {"add-only":5,"replace":5}
  [src/app.js] line 15 [replace]: "const newVar = 20;" => Churn (prev: Alice@abc123, Δ=6.5d)
  [src/app.js] line 20 [add-only]: "function newFunc() {" => New Work
```

2. **Archivo JSON** en `output/pr_123_churn_summary.json`:
```json
{
  "pr": 123,
  "repo": "owner/repo",
  "resumen": {
    "New Work": 42,
    "Churn": 12,
    "Rework": 8,
    "Help Others": 5
  },
  "detalles": [
    {
      "archivo": "src/app.js",
      "linea": 15,
      "contenido": "const newVar = 20;",
      "tipoHunk": "replace",
      "categoria": "Churn",
      "autorActual": "Alice",
      "autorPrevio": "Alice",
      "commitPrevio": "abc123def456",
      "deltaDias": 6.5
    }
  ],
  "analysed_at": "2024-12-01T12:00:00.000Z"
}
```

### 5. Validar Manualmente

Para verificar que las clasificaciones son correctas:

#### A. Revisar el PR en GitHub
```bash
# Abre el PR en tu navegador
https://github.com/owner/repo/pull/123/files
```

#### B. Verificar New Work
- Busca líneas en el output marcadas como `[add-only]`
- En GitHub, verifica que esas líneas NO reemplacen código existente
- Solo deben tener `+` sin `-` en el mismo hunk

#### C. Verificar Churn
- Busca líneas marcadas como `Churn`
- Verifica que:
  - El autor previo = autor actual
  - El delta de días ≤ 21
  - Son líneas que reemplazan código (`[replace]`)

#### D. Verificar Rework
- Busca líneas marcadas como `Rework`
- Verifica que:
  - El autor previo = autor actual
  - El delta de días > 21

#### E. Verificar Help Others
- Busca líneas marcadas como `Help Others`
- Verifica que:
  - El autor previo ≠ autor actual

### 6. Casos de Prueba Recomendados

Para una validación completa, prueba con PRs que tengan:

#### PR Tipo 1: Solo Código Nuevo
- Archivo completamente nuevo
- **Esperado:** 100% New Work

#### PR Tipo 2: Refactor Reciente
- Autor modifica su propio código de hace pocos días
- **Esperado:** Alto % de Churn

#### PR Tipo 3: Refactor Antiguo
- Autor modifica su código de hace meses
- **Esperado:** Alto % de Rework

#### PR Tipo 4: Colaboración
- Autor B modifica código de Autor A
- **Esperado:** Alto % de Help Others

#### PR Tipo 5: Mixto
- Combinación de nuevo código y modificaciones
- **Esperado:** Mix de todas las categorías

### 7. Troubleshooting

#### Error: "Missing required env vars"
- Verifica que todas las variables en `.env` estén configuradas
- Asegúrate de que el archivo `.env` esté en el directorio raíz

#### Error: "Failed to get installation token"
- Verifica que `APP_ID` e `INSTALLATION_ID` sean correctos
- Verifica que la private key sea válida
- Asegúrate de que la app esté instalada en el repositorio

#### Error: "GraphQL error for [file]"
- El archivo puede no existir en la rama base
- Puede ser un archivo nuevo (esto es normal, se clasifica como New Work)

#### Clasificaciones Incorrectas
- Verifica que `MAX_DELTA_DAYS` esté configurado correctamente
- Revisa los logs para ver el `hunkType` de cada línea
- Compara con el diff del PR en GitHub

#### Tests no se ejecutan en Windows
- El problema de glob patterns (`test/*.test.js`) ya está solucionado
- Los archivos de test se listan explícitamente en `package.json`
- Si agregas nuevos archivos de test, agrégalos manualmente al script

### 8. Ejemplo de Validación Manual

```bash
# 1. Ejecutar el análisis
node api.js

# 2. Ver el resumen
cat output/pr_123_churn_summary.json | jq '.resumen'

# 3. Ver detalles de un archivo específico
cat output/pr_123_churn_summary.json | jq '.detalles[] | select(.archivo == "src/app.js")'

# 4. Contar líneas por tipo de hunk
cat output/pr_123_churn_summary.json | jq '.detalles | group_by(.tipoHunk) | map({tipo: .[0].tipoHunk, count: length})'

# 5. Ver líneas de Churn
cat output/pr_123_churn_summary.json | jq '.detalles[] | select(.categoria == "Churn")'

# 6. Ver distribución por categoría
cat output/pr_123_churn_summary.json | jq '.detalles | group_by(.categoria) | map({categoria: .[0].categoria, count: length})'
```

### 9. Métricas Esperadas

Para un proyecto saludable:

- **New Work**: 60-80% (mayoría del código es nuevo)
- **Churn**: 5-15% (algunas iteraciones rápidas)
- **Rework**: 5-10% (refactors ocasionales)
- **Help Others**: 5-15% (colaboración)

**Señales de alerta:**
- Churn > 30%: Posible inestabilidad o falta de planificación
- Rework > 30%: Posible deuda técnica acumulada
- New Work < 40%: Poco código nuevo, mucho mantenimiento
- Help Others > 50%: Posible falta de ownership o rotación alta

## Debugging

Para ver más detalles durante la ejecución, el script ya incluye logs detallados:

```javascript
console.log(`  Hunk types: ${JSON.stringify(hunkTypeCounts)}`);
console.log(`  [${file.filename}] line ${lineNum} [${hunkType}]: ...`);
```

Si necesitas más información, puedes agregar logs adicionales en `api.js`.

## Cobertura de Tests

### Archivos Testeados
- ✅ `classifyLine()` - Función de clasificación de líneas
- ✅ `parsePatch()` - Parser de diffs unificados

### Archivos No Testeados (Requieren GitHub API)
- ⚠️ Funciones de autenticación (`authenticateWithGitHub`)
- ⚠️ Funciones de obtención de datos (`fetchPRMetadata`, `fetchPRCommits`, etc.)
- ⚠️ Funciones de análisis (`analyzeFile`, `getFileBlameFiltered`)
- ⚠️ Función principal (`main`)

Estas funciones requieren acceso a la API de GitHub y se validan mediante pruebas manuales con PRs reales.