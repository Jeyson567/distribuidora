import { PAYMENT, STATUS } from '../domain/constants.js';
import { cancelSale, registerSaleReturn } from '../services/transactions.js';
import { COL, between, invalidate, read, recent } from '../services/db.js';
import { generateSaleReceiptHtml, openPrintWindow } from '../services/printing.js';
import { badge, dataTable, field, moneyCell, pageHeader, rangeFilter, selectInput, statCard, textInput } from '../ui/components.js';
import { confirmAction, esc, notice, openModal, qs, qsa, reportError } from '../ui/dom.js';
import { downloadCsv } from '../utils/csv.js';
import { dateTime, money, quantity } from '../utils/format.js';
import { resolveRange } from '../utils/dates.js';
import { toMilli } from '../utils/math.js';

const rangeFrom = (params) => ({
  preset: params.preset || 'mes',
  from: params.from || '',
  to: params.to || '',
});

const stateBadge = (sale) => {
  if (sale.estado === STATUS.cancelled) return badge('Anulada', 'red');
  if (sale.estado === 'DEVUELTA') return badge('Devuelta', 'amber');
  if (sale.montoDevueltoCents) return badge('Con devolución', 'amber');
  if (sale.creditoCents) return badge('Crédito', 'teal');
  return badge('Activa', 'green');
};

const netTotal = (sale) => (sale.estado === STATUS.cancelled ? 0 : (sale.totalCents || 0) - (sale.montoDevueltoCents || 0));
const netProfit = (sale) => (sale.estado === STATUS.cancelled
  ? 0
  : (sale.gananciaBrutaCents || 0) - ((sale.montoDevueltoCents || 0) - (sale.costoDevueltoCents || 0)));

function detailModal(sale, ctx) {
  const lines = sale.lineas || [];
  openModal({
    title: `Venta ${sale.numero}`,
    size: 'lg',
    submitLabel: 'Imprimir comprobante',
    body: `
      <div class="space-y-4 text-sm">
        <div class="grid gap-2 sm:grid-cols-2">
          <p>Fecha: <b>${esc(dateTime(sale.fecha))}</b></p>
          <p>Cliente: <b>${esc(sale.clienteNombre)}</b></p>
          <p>Estado: <b>${esc(sale.estado)}</b></p>
          <p>Pago: <b>${esc((sale.pagos || []).map((payment) => `${payment.metodo} ${money(payment.montoCents)}`).join(' · ') || '—')}</b></p>
        </div>
        <div class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-left text-slate-600">
              <tr><th class="px-3 py-2">Producto</th><th class="px-3 py-2">Socio</th><th class="px-3 py-2 text-right">Cantidad</th>
              <th class="px-3 py-2 text-right">Precio</th><th class="px-3 py-2 text-right">Importe</th><th class="px-3 py-2 text-right">Ganancia</th></tr>
            </thead>
            <tbody>${lines.map((line) => `
              <tr class="border-t border-slate-100">
                <td class="px-3 py-2">${esc(line.productoNombre)}${line.returnedBaseMilli ? `<span class="block text-xs text-amber-700">Devuelto ${esc(quantity(line.returnedBaseMilli))}</span>` : ''}</td>
                <td class="px-3 py-2">${esc(line.socioNombre || ctx.catalogs.partners.find((p) => p.id === line.socioId)?.nombre || '—')}</td>
                <td class="px-3 py-2 text-right">${esc(quantity(line.cantidadMilli))} ${esc(line.unidadNombre || '')}</td>
                <td class="px-3 py-2 text-right">${esc(money(line.unitPriceCents))}</td>
                <td class="px-3 py-2 text-right">${esc(money(line.subtotalNetoCents ?? line.subtotalCents))}</td>
                <td class="px-3 py-2 text-right">${esc(money(line.profitCents))}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="rounded-lg bg-slate-50 p-3">
          <p class="mb-2 font-semibold">Reparto por socio</p>
          ${(sale.distribucionSocios || []).map((item) => `
            <p class="flex justify-between"><span>${esc(item.socioNombre || ctx.catalogs.partners.find((p) => p.id === item.socioId)?.nombre || '—')}</span>
            <span>Venta ${esc(money(item.ventasCents))} · Costo ${esc(money(item.costoCents))} · Ganancia <b>${esc(money(item.gananciaBrutaCents))}</b></span></p>`).join('')}
        </div>
        <div class="text-right">
          <p>Subtotal ${esc(money(sale.subtotalCents))}</p>
          ${sale.descuentoCents ? `<p>Descuento -${esc(money(sale.descuentoCents))}</p>` : ''}
          <p class="text-lg font-bold">Total ${esc(money(sale.totalCents))}</p>
          ${sale.montoDevueltoCents ? `<p class="text-amber-700">Devuelto -${esc(money(sale.montoDevueltoCents))}</p>` : ''}
        </div>
      </div>`,
    onSubmit: () => openPrintWindow(generateSaleReceiptHtml(sale, ctx.business, { copy: true }), { title: `Venta ${sale.numero}` }),
  });
}

function returnModal(sale, ctx) {
  const lines = (sale.lineas || []).filter((line) => (Number(line.returnedBaseMilli) || 0) < line.cantidadBaseMilli);
  if (!lines.length) return notice('Esta venta ya fue devuelta por completo.', 'warn');

  openModal({
    title: `Devolución de la venta ${sale.numero}`,
    size: 'lg',
    submitLabel: 'Registrar devolución',
    body: `
      <div class="space-y-4">
        <p class="text-sm text-slate-600">Indique la cantidad a devolver en la unidad base de cada producto. El inventario y el costo se reponen automáticamente.</p>
        <div class="space-y-2">
          ${lines.map((line) => {
            const remaining = line.cantidadBaseMilli - (Number(line.returnedBaseMilli) || 0);
            return `
              <div class="grid grid-cols-[1fr_9rem] items-end gap-3 rounded-lg border border-slate-200 p-3">
                <div>
                  <p class="font-semibold">${esc(line.productoNombre)}</p>
                  <p class="text-xs text-slate-500">Disponible para devolver: ${esc(quantity(remaining))} · Importe ${esc(money(line.subtotalNetoCents ?? line.subtotalCents))}</p>
                </div>
                <label class="text-xs text-slate-500">Cantidad
                  <input class="field mt-1" type="number" step="0.001" min="0" max="${remaining / 1000}"
                    name="qty_${esc(line.lineId)}" value="0">
                </label>
              </div>`;
          }).join('')}
        </div>
        ${field('Motivo', textInput('reason', { required: true, placeholder: 'Producto en mal estado, error de cobro, etc.' }))}
        ${field('Resolución', `<select name="resolution" class="field mt-1">
          <option value="${PAYMENT.cash}">Devolver efectivo de caja</option>
          <option value="${PAYMENT.credit}">Rebajar el saldo del cliente</option>
        </select>`)}
      </div>`,
    onSubmit: async (form) => {
      const requested = lines
        .map((line) => ({ lineId: line.lineId, quantityBaseMilli: toMilli(form.get(`qty_${line.lineId}`) || 0) }))
        .filter((line) => line.quantityBaseMilli > 0);
      const result = await registerSaleReturn({
        saleId: sale.id,
        lines: requested,
        reason: (form.get('reason') || '').trim(),
        resolution: form.get('resolution'),
      });
      invalidate(COL.products, COL.customers);
      notice(`Devolución ${result.numero} por ${money(result.montoCents)}.`);
      await ctx.refresh();
    },
  });
}

export default {
  async load(ctx) {
    const range = rangeFrom(ctx.params);
    const { from, to } = resolveRange(range.preset, range);
    const sales = await between(COL.sales, from, to, 500);
    return { sales, range };
  },

  render({ sales, range }, ctx) {
    const customerId = ctx.params.cliente || '';
    const rows = customerId ? sales.filter((sale) => sale.clienteId === customerId) : sales;
    const totals = rows.reduce((acc, sale) => ({
      ventas: acc.ventas + netTotal(sale),
      ganancia: acc.ganancia + netProfit(sale),
      credito: acc.credito + (sale.estado === STATUS.cancelled ? 0 : (sale.creditoCents || 0)),
    }), { ventas: 0, ganancia: 0, credito: 0 });

    return `
      ${pageHeader('Historial de ventas', 'Las ventas no se eliminan: se anulan o se devuelven.', `
        <button id="export-sales" class="btn-secondary">Exportar CSV</button>
        <button id="go-pos" class="btn-primary">Nueva venta</button>`)}
      ${rangeFilter(range, `<label class="text-sm font-medium">Cliente${
        selectInput('cliente', ctx.catalogs.customers, { selected: customerId, placeholder: 'Todos' })}</label>`)}
      <section class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Ventas netas', money(totals.ventas), `${rows.length} documentos`)}
        ${statCard('Ganancia bruta', money(totals.ganancia))}
        ${statCard('Vendido a crédito', money(totals.credito))}
        ${statCard('Ticket promedio', money(rows.length ? Math.round(totals.ventas / rows.length) : 0))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Número', format: (row) => `<b>${esc(row.numero)}</b>` },
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Cliente', format: (row) => esc(row.clienteNombre || '—') },
          { label: 'Total', align: 'right', format: (row) => moneyCell(row.totalCents) },
          { label: 'Devuelto', align: 'right', format: (row) => (row.montoDevueltoCents ? moneyCell(row.montoDevueltoCents) : '—') },
          { label: 'Ganancia', align: 'right', format: (row) => moneyCell(netProfit(row)) },
          { label: 'Estado', format: stateBadge },
          {
            label: '',
            align: 'right',
            format: (row) => `
              <button data-view="${esc(row.id)}" class="btn-link">Ver</button>
              <button data-print="${esc(row.id)}" class="btn-link">Imprimir</button>
              ${row.estado === STATUS.cancelled ? '' : `
                <button data-return="${esc(row.id)}" class="btn-link">Devolver</button>
                <button data-cancel="${esc(row.id)}" class="btn-link">Anular</button>`}`,
          },
        ],
        rows,
        empty: 'No hay ventas en el período seleccionado.',
        emptyAction: { id: 'go-pos-empty', label: 'Nueva venta' },
      })}`;
  },

  bind({ sales }, ctx) {
    const find = (id) => sales.find((sale) => sale.id === id);

    qsa('#go-pos, #go-pos-empty').forEach((button) => {
      button.onclick = () => ctx.navigate('pos');
    });

    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('ventas', {
        preset: form.get('preset'), from: form.get('from'), to: form.get('to'), cliente: form.get('cliente'),
      });
    });

    qsa('[data-view]').forEach((button) => {
      button.onclick = () => detailModal(find(button.dataset.view), ctx);
    });
    qsa('[data-print]').forEach((button) => {
      button.onclick = () => {
        try {
          openPrintWindow(generateSaleReceiptHtml(find(button.dataset.print), ctx.business, { copy: true }));
        } catch (error) {
          reportError(error, 'No se pudo abrir la ventana de impresión.');
        }
      };
    });
    qsa('[data-return]').forEach((button) => {
      button.onclick = () => returnModal(find(button.dataset.return), ctx);
    });
    qsa('[data-cancel]').forEach((button) => {
      button.onclick = () => {
        const sale = find(button.dataset.cancel);
        openModal({
          title: `Anular venta ${sale.numero}`,
          submitLabel: 'Anular venta',
          body: `
            <div class="space-y-4">
              <p class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                La venta se marcará como anulada, el inventario regresará y el crédito se revertirá.
                El documento se conserva para auditoría.
              </p>
              ${field('Motivo de la anulación', textInput('reason', { required: true }))}
            </div>`,
          onSubmit: async (form) => {
            await cancelSale({ saleId: sale.id, reason: (form.get('reason') || '').trim() });
            invalidate(COL.products, COL.customers);
            notice(`Venta ${sale.numero} anulada.`);
            await ctx.refresh();
          },
        });
      };
    });

    qs('#export-sales')?.addEventListener('click', () => downloadCsv(
      sales.map((sale) => [
        sale.numero, dateTime(sale.fecha), sale.clienteNombre || '',
        (sale.totalCents || 0) / 100, (sale.costoVentaCents || 0) / 100,
        netProfit(sale) / 100, sale.estado,
      ]),
      {
        filename: 'ventas.csv',
        headers: ['Número', 'Fecha', 'Cliente', 'Total Q', 'Costo Q', 'Ganancia Q', 'Estado'],
      },
    ));
  },
};

/** Returns registered against sales, with their own list. */
export const returnsPage = {
  async load() {
    // Recent sales travel with the page so a return can be started here
    // instead of forcing a detour through the sales history.
    const [returns, sales] = await Promise.all([
      recent(COL.returns, 200),
      recent(COL.sales, 100),
    ]);
    return { returns, sales };
  },

  render({ returns }, ctx) {
    const total = returns.reduce((sum, item) => sum + (item.montoCents || 0), 0);
    return `
      ${pageHeader('Devoluciones', 'Reponen el inventario y ajustan el saldo o la caja según la resolución.', `
        <button id="go-sales" class="btn-secondary">Ir al historial de ventas</button>
        <button id="new-return" class="btn-primary">Nueva devolución</button>`)}
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Devoluciones', String(returns.length))}
        ${statCard('Importe devuelto', money(total))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Número', format: (row) => esc(row.numero || '—') },
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Origen', format: (row) => esc(row.ventaNumero || row.proveedorNombre || '—') },
          { label: 'Cliente / Proveedor', format: (row) => esc(row.clienteNombre || row.proveedorNombre || '—') },
          { label: 'Importe', align: 'right', format: (row) => moneyCell(row.montoCents) },
          { label: 'Resolución', format: (row) => badge(row.resolucion || row.tipo || '—', 'slate') },
          { label: 'Motivo', format: (row) => esc(row.motivo || '—') },
        ],
        rows: returns,
        empty: 'No hay devoluciones registradas.',
        emptyAction: { id: 'new-return-empty', label: 'Nueva devolución' },
      })}`;
  },

  bind({ sales }, ctx) {
    qs('#go-sales')?.addEventListener('click', () => ctx.navigate('ventas'));

    const returnable = sales.filter((sale) => sale.estado !== STATUS.cancelled
      && (sale.lineas || []).some((line) => (Number(line.returnedBaseMilli) || 0) < line.cantidadBaseMilli));

    qsa('#new-return, #new-return-empty').forEach((button) => {
      button.onclick = () => {
        if (!returnable.length) {
          return notice('No hay ventas recientes disponibles para devolver.', 'warn');
        }
        return openModal({
          title: 'Nueva devolución',
          submitLabel: 'Continuar',
          body: field('Venta a devolver', `<select name="saleId" class="field mt-1" required>
            ${returnable.map((sale) => `<option value="${esc(sale.id)}">
              ${esc(sale.numero)} · ${esc(dateTime(sale.fecha))} · ${esc(sale.clienteNombre || 'Cliente general')} · ${esc(money(sale.totalCents))}
            </option>`).join('')}
          </select>`, 'Solo aparecen las ventas activas con producto pendiente de devolver.'),
          onSubmit: (form) => {
            const sale = returnable.find((item) => item.id === form.get('saleId'));
            // Deferred so this modal finishes closing before the next one opens.
            setTimeout(() => returnModal(sale, ctx), 0);
          },
        });
      };
    });
  },
};
