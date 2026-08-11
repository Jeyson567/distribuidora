/**
 * Escapa un valor para una celda CSV RFC 4180-compatible.
 * Los valores se convierten a texto y las comillas se duplican.
 */
export function escapeCsvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Convierte una matriz de valores en texto CSV.
 *
 * @param {unknown[][]} rows Filas a exportar.
 * @param {{ headers?: unknown[], delimiter?: string, lineEnding?: string }} options
 * @returns {string}
 */
export function arraysToCsv(rows, { headers, delimiter = ',', lineEnding = '\r\n' } = {}) {
  if (!Array.isArray(rows) || !rows.every(Array.isArray)) {
    throw new TypeError('rows debe ser un arreglo de arreglos.');
  }
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
    throw new TypeError('delimiter debe ser un solo carácter válido.');
  }
  if (typeof lineEnding !== 'string') throw new TypeError('lineEnding debe ser texto.');

  const allRows = headers === undefined ? rows : [headers, ...rows];
  return allRows
    .map((row) => row.map((value) => escapeCsvField(value)).join(delimiter))
    .join(lineEnding);
}

/**
 * Descarga un CSV generado desde un arreglo bidimensional en el navegador.
 */
export function downloadCsv(rows, {
  filename = 'export.csv',
  headers,
  delimiter = ',',
  lineEnding = '\r\n',
  documentObject = globalThis.document,
} = {}) {
  if (!documentObject?.createElement || !globalThis.URL?.createObjectURL) {
    throw new Error('La descarga CSV solo está disponible en el navegador.');
  }

  const csv = arraysToCsv(rows, { headers, delimiter, lineEnding });
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = globalThis.URL.createObjectURL(blob);
  const anchor = documentObject.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  documentObject.body.append(anchor);
  anchor.click();
  anchor.remove();
  globalThis.URL.revokeObjectURL(url);
  return csv;
}
