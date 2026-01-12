# PR Code Metrics Analyzer

Analiza Pull Requests de GitHub y clasifica las líneas de código añadidas en cuatro categorías:

- **New Work**: Código completamente nuevo
- **Churn**: Modificaciones del mismo autor en código reciente (≤21 días)
- **Rework**: Modificaciones del mismo autor en código antiguo (>21 días)
- **Help Others**: Modificaciones de otro autor en su código

## Características

- ✅ Distingue correctamente entre hunks add-only y replace
- ✅ Filtra líneas en blanco para determinar el tipo de hunk
- ✅ Excluye commits del PR del análisis de blame
- ✅ Tests unitarios completos con fixtures reales
- ✅ Configurable vía variables de entorno

## Instalación

```bash
npm install
```

## Configuración

1. Copia el archivo de ejemplo:
```bash
cp .env.example .env
```

2. Configura las variables en `.env`:
   - `APP_ID`: ID de tu GitHub App
   - `INSTALLATION_ID`: ID de instalación de la app
   - `PRIVATE_KEY_PATH` o `PRIVATE_KEY`: Clave privada de la app
   - `REPO_OWNER`: Dueño del repositorio
   - `REPO_NAME`: Nombre del repositorio
   - `PR_NUMBER`: Número del PR a analizar
   - `MAX_DELTA_DAYS` (opcional): Umbral en días para Churn vs Rework (default: 21)

## Uso

```bash
node api.js
```

El script generará:
1. Output en consola con detalles línea por línea
2. Archivo JSON con el resumen y detalles completos

## Ejemplo de Output

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
      "contenido": "  const newVar = 20;",
      "tipoHunk": "replace",
      "categoria": "Churn",
      "autorActual": "Alice",
      "autorPrevio": "Alice",
      "commitPrevio": "abc123",
      "deltaDias": 6.5
    }
  ],
  "analysed_at": "2024-12-17T10:30:00.000Z"
}
```

## Clasificación de Líneas

### New Work
- Líneas en hunks **add-only** (solo `+`, sin `-`)
- Líneas en hunks replace sin blame previo

### Churn
- Mismo autor modifica su propio código
- Tiempo transcurrido ≤ MAX_DELTA_DAYS (default: 21 días)

### Rework
- Mismo autor modifica su propio código
- Tiempo transcurrido > MAX_DELTA_DAYS

### Help Others
- Autor diferente modifica código de otro
- Sin importar el tiempo transcurrido

## Edge Cases Manejados

1. **Líneas en blanco**: Se filtran al determinar el tipo de hunk
   - Eliminar 2 líneas en blanco + agregar 1 línea de código = **add-only**

2. **Delete-only hunks**: No generan LOC positivas (no se cuentan)

3. **Commits del PR en blame**: Se filtran automáticamente

4. **Archivos binarios**: Se omiten (no tienen patch)

## Tests

Ejecutar tests unitarios:

```bash
npm test
```

Los tests cubren:
- Parser de patches (add-only, replace, delete-only)
- Clasificación de líneas (New Work, Churn, Rework, Help Others)
- Edge cases (líneas en blanco, múltiples hunks, etc.)

## Estructura del Proyecto

```
.
├── api.js                    # Script principal
├── package.json
├── .env.example             # Ejemplo de configuración
├── README.md
├── jest.config.js           # Configuración de tests
└── test/
    ├── fixtures/
    │   └── patches.js       # Patches de ejemplo para tests
    ├── parser.test.js       # Tests del parser
    └── classifier.test.js   # Tests del clasificador
```

## Limitaciones Actuales

- Analiza PRs completos (no commits individuales históricos)
- Requiere GitHub App con permisos de lectura en el repositorio
- Limitado a 250 commits/archivos por PR (paginación no implementada)

## Próximos Pasos

- [ ] Análisis de commits históricos con git local
- [ ] Soporte para múltiples PRs en batch
- [ ] Dashboard web para visualizar métricas
- [ ] Exportar a CSV/Excel

