const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ENTITIES[character]);

const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (cents) => `Q${(asNumber(cents) / 100).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amount = (milli) => (asNumber(milli) / 1000).toLocaleString('es-GT', { maximumFractionDigits: 3 });
const dateTime = (value) => {
  const date = value?.toDate ? value.toDate() : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
};

const STYLES = `
  @page { size: letter; margin: 16mm; }
  * { box-sizing: border-box; }
  body { color: #111; font: 11pt/1.45 Arial, Helvetica, sans-serif; margin: 0; }
  .sheet { max-width: 184mm; margin: 0 auto; }
  header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 16px; display: flex; gap: 14px; align-items: flex-start; }
  header img { max-height: 68px; max-width: 68px; object-fit: contain; }
  h1 { font-size: 17pt; margin: 0; }
  h2 { font-size: 12pt; margin: 18px 0 6px; }
  .muted { color: #444; margin: 2px 0 0; font-size: 9.5pt; }
  .doc-title { text-align: right; margin-left: auto; }
  .doc-title strong { display: block; font-size: 13pt; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 20px; margin-bottom: 14px; font-size: 10pt; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; }
  th, td { border-bottom: 1px solid #c9c9c9; padding: 6px 4px; text-align: left; vertical-align: top; }
  th { border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: 9.5pt; text-transform: uppercase; letter-spacing: .02em; }
  .num { text-align: right; white-space: nowrap; }
  .totals { width: 78mm; margin-left: auto; margin-top: 12px; }
  .totals td { border: 0; padding: 3px 0; }
  .totals .grand { border-top: 1.5px solid #111; font-size: 12.5pt; font-weight: bold; padding-top: 6px; }
  .note { margin-top: 14px; font-size: 9.5pt; }
  footer { border-top: 1px solid #111; margin-top: 26px; padding-top: 8px; text-align: center; font-size: 9pt; color: #333; }
`;

const header = (business, docTitle, docNumber) => `
  <header>
    ${business?.logoUrl ? `<img src="${escapeHtml(business.logoUrl)}" alt="">` : ''}
    <div>
      <h1>${escapeHtml(business?.nombre || 'Negocio')}</h1>
      ${business?.direccion ? `<p class="muted">${escapeHtml(business.direccion)}</p>` : ''}
      <p class="muted">${[business?.telefono && `Tel. ${business.telefono}`, business?.nit && `NIT ${business.nit}`]
        .filter(Boolean).map(escapeHtml).join(' · ')}</p>
    </div>
    <div class="doc-title">
      <strong>${escapeHtml(docTitle)}</strong>
      ${docNumber ? `<span>${escapeHtml(docNumber)}</span>` : ''}
    </div>
  </header>`;

const page = (title, business, docTitle, docNumber, content) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head>
<body><main class="sheet">${header(business, docTitle, docNumber)}${content}</main></body></html>`;

/** Letter-sized sale receipt, ready for a normal office printer. */
export function generateSaleReceiptHtml(sale = {}, business = {}, { copy = false } = {}) {
  const lines = Array.isArray(sale.lineas) ? sale.lineas : [];
  const rows = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.productoNombre || line.productName || '')}</td>
      <td class="num">${escapeHtml(amount(line.cantidadMilli ?? line.quantityMilli ?? line.cantidadBaseMilli))}</td>
      <td>${escapeHtml(line.unidadNombre || '')}</td>
      <td class="num">${escapeHtml(money(line.unitPriceCents))}</td>
      <td class="num">${escapeHtml(money(line.descuentoCents))}</td>
      <td class="num">${escapeHtml(money(line.subtotalNetoCents ?? line.subtotalCents))}</td>
    </tr>`).join('');

  const payments = (Array.isArray(sale.pagos) ? sale.pagos : [])
    .map((payment) => `${escapeHtml(payment.metodo || payment.method || '')} ${escapeHtml(money(payment.montoCents ?? payment.amountCents))}`)
    .join(' · ');

  const content = `
    <section class="meta">
      <div><strong>Fecha:</strong> ${escapeHtml(dateTime(sale.fecha))}</div>
      <div><strong>Cliente:</strong> ${escapeHtml(sale.clienteNombre || '')}</div>
      <div><strong>Estado:</strong> ${escapeHtml(sale.estado || '')}</div>
      <div><strong>Forma de pago:</strong> ${payments || '—'}</div>
    </section>
    <table>
      <thead><tr>
        <th>Producto</th><th class="num">Cantidad</th><th>Unidad</th>
        <th class="num">Precio</th><th class="num">Desc.</th><th class="num">Importe</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tbody>
      <tr><td>Subtotal</td><td class="num">${escapeHtml(money(sale.subtotalCents))}</td></tr>
      ${sale.descuentoCents ? `<tr><td>Descuento</td><td class="num">-${escapeHtml(money(sale.descuentoCents))}</td></tr>` : ''}
      <tr><td class="grand">Total</td><td class="num grand">${escapeHtml(money(sale.totalCents))}</td></tr>
      ${sale.recibidoCents ? `<tr><td>Recibido</td><td class="num">${escapeHtml(money(sale.recibidoCents))}</td></tr>` : ''}
      ${sale.cambioCents ? `<tr><td>Cambio</td><td class="num">${escapeHtml(money(sale.cambioCents))}</td></tr>` : ''}
      ${sale.creditoCents ? `<tr><td>Saldo a crédito</td><td class="num">${escapeHtml(money(sale.creditoCents))}</td></tr>` : ''}
      ${sale.montoDevueltoCents ? `<tr><td>Devuelto</td><td class="num">-${escapeHtml(money(sale.montoDevueltoCents))}</td></tr>` : ''}
    </tbody></table>
    ${sale.observacion ? `<p class="note"><strong>Observaciones:</strong> ${escapeHtml(sale.observacion)}</p>` : ''}
    <footer>${copy ? 'REIMPRESIÓN · ' : ''}Gracias por su compra.</footer>`;

  return page(`Comprobante ${sale.numero || ''}`, business, copy ? 'Comprobante (copia)' : 'Comprobante de venta', sale.numero, content);
}

/** Generic letter-sized document used by statements, reports and cash cuts. */
export function generateDocumentHtml({ title, business, docTitle, docNumber, meta = [], tables = [], totals = [], note = '' }) {
  const metaHtml = meta.length
    ? `<section class="meta">${meta.map(([label, value]) => `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`).join('')}</section>`
    : '';
  const tablesHtml = tables.map((table) => `
    ${table.title ? `<h2>${escapeHtml(table.title)}</h2>` : ''}
    <table>
      <thead><tr>${table.columns.map((column) => `<th class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>${table.rows.map((row) => `<tr>${row.map((cell, index) => `<td class="${table.columns[index]?.align === 'right' ? 'num' : ''}">${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`).join('');
  const totalsHtml = totals.length
    ? `<table class="totals"><tbody>${totals.map(([label, value], index) => `<tr><td class="${index === totals.length - 1 ? 'grand' : ''}">${escapeHtml(label)}</td><td class="num ${index === totals.length - 1 ? 'grand' : ''}">${escapeHtml(value)}</td></tr>`).join('')}</tbody></table>`
    : '';
  return page(title, business, docTitle, docNumber, `${metaHtml}${tablesHtml}${totalsHtml}${
    note ? `<p class="note">${escapeHtml(note)}</p>` : ''}<footer>${escapeHtml(business?.nombre || '')}</footer>`);
}

/** Opens the document in its own window and triggers the print dialog. */
export function openPrintWindow(html, { title = 'Documento', windowObject = globalThis.window } = {}) {
  if (typeof html !== 'string') throw new TypeError('html debe ser texto.');
  const printWindow = windowObject?.open('', '_blank', 'width=900,height=700');
  if (!printWindow) throw new Error('El navegador bloqueó la ventana de impresión. Permita las ventanas emergentes.');
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.document.title = title;
  const print = () => {
    printWindow.focus();
    printWindow.print();
  };
  if (printWindow.document.readyState === 'complete') print();
  else printWindow.addEventListener('load', print, { once: true });
  return printWindow;
}
