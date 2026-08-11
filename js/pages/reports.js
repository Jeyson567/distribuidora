import { COL, between } from '../services/db.js';
import { aggregateProducts, calculateReport, groupSales, topProducts } from '../services/reports.js';
import { generateDocumentHtml, openPrintWindow } from '../services/printing.js';
import { dataTable, moneyCell, pageHeader, rangeFilter, selectInput, statCard } from '../ui/components.js';
import { esc, qs, reportError } from '../ui/dom.js';
import { downloadCsv } from '../utils/csv.js';
import { dateOnly, money, quantity } from '../utils/format.js';
import { resolveRange } from '../utils/dates.js';
import { percentage } from '../utils/math.js';

const readRange = (params) => ({
  preset: params.preset || 'mes',
  from: params.from || '',
  to: params.to || '',
});

async function loadPeriod(ctx) {
  const range = readRange(ctx.params);
  const { from, to } = resolveRange(range.preset, range);
  const [sales, expenses, waste] = await Promise.all([
    between(COL.sales, from, to, 1000),
    between(COL.expenses, from, to, 500),
    between(COL.waste, from, to, 500),
  ]);
  return { range, from, to, sales, expenses, waste };
}

export default {
  load: loadPeriod,

  render({ range, from, to, sales, expenses, waste }, ctx) {
    const partnerId = ctx.params.socio || '';
    const options = { from, to, partnerId: partnerId || undefined };
    const report = calculateReport({ sales, expenses, products: ctx.catalogs.products, ...options });
    const wasteCents = waste
      .filter((record) => !partnerId || record.socioId === partnerId)
      .reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0);

    const byPartner = groupSales(sales, { from, to, by: 'partnerId' });
    const byProduct = topProducts(sales, options, 10);
    const byCategory = groupSales(sales, { ...options, by: 'categoryId' });
    const partnerName = (id) => ctx.catalogs.partners.find((partner) => partner.id === id)?.nombre || 'Sin socio';
    const categoryName = (id) => ctx.catalogs.categories.find((category) => category.id === id)?.nombre || 'Sin categoría';
    const productName = (id) => ctx.catalogs.products.find((product) => product.id === id)?.nombre || 'Producto';

    return `
      ${pageHeader('Reportes', 'Resultados del negocio en el período seleccionado.', `
        <button id="export-report" class="btn-secondary">Exportar CSV</button>
        <button id="print-report" class="btn-primary">Imprimir</button>`)}
      ${rangeFilter(range, `<label class="text-sm font-medium">Socio${
        selectInput('socio', ctx.catalogs.partners, { selected: partnerId, placeholder: 'Todo el negocio' })}</label>`)}

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Ventas netas', money(report.ventasCents), `${report.cantidadVentas} ventas`)}
        ${statCard('Costo de ventas', money(report.costoCents))}
        ${statCard('Ganancia bruta', money(report.gananciaBrutaCents), `Margen ${percentage(report.gananciaBrutaCents, report.ventasCents)}%`)}
        ${statCard('Utilidad neta', money(report.utilidadCents - wasteCents), 'Ganancia bruta menos gastos y mermas',
          report.utilidadCents - wasteCents < 0 ? 'text-red-700' : 'text-emerald-700')}
      </section>
      <section class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Gastos', money(report.gastosCents), `${report.cantidadGastos} registros`)}
        ${statCard('Mermas', money(wasteCents))}
        ${statCard('Valor del inventario', money(report.valorInventarioCents))}
        ${statCard('Ganancia potencial', money(report.gananciaPotencialCents), 'Si se vende todo el inventario')}
      </section>

      <h2 class="mb-3 mt-8 text-lg font-bold">Resultado por socio</h2>
      ${dataTable({
        columns: [
          { label: 'Socio', format: (row) => `<b>${esc(partnerName(row.key))}</b>` },
          { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
          { label: 'Costo', align: 'right', format: (row) => moneyCell(row.costoCents) },
          { label: 'Ganancia bruta', align: 'right', format: (row) => moneyCell(row.gananciaBrutaCents) },
          { label: 'Margen', align: 'right', format: (row) => `${esc(String(percentage(row.gananciaBrutaCents, row.ventasCents)))}%` },
          {
            label: 'Gastos propios',
            align: 'right',
            format: (row) => moneyCell(expenses.filter((expense) => expense.socioId === row.key)
              .reduce((sum, expense) => sum + (expense.montoCents || 0), 0)),
          },
          {
            label: 'Utilidad',
            align: 'right',
            format: (row) => {
              const own = expenses.filter((expense) => expense.socioId === row.key)
                .reduce((sum, expense) => sum + (expense.montoCents || 0), 0);
              const lost = waste.filter((record) => record.socioId === row.key)
                .reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0);
              const result = row.gananciaBrutaCents - own - lost;
              return `<b class="${result < 0 ? 'text-red-700' : 'text-emerald-700'}">${esc(money(result))}</b>`;
            },
          },
        ],
        rows: byPartner,
        empty: 'No hay ventas en el período.',
      })}

      <div class="mt-8 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 class="mb-3 text-lg font-bold">Productos más vendidos</h2>
          ${dataTable({
            columns: [
              { label: 'Producto', format: (row) => esc(row.nombre || productName(row.key)) },
              { label: 'Cantidad', align: 'right', format: (row) => esc(quantity(row.cantidadBaseMilli)) },
              { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
              { label: 'Ganancia', align: 'right', format: (row) => moneyCell(row.gananciaBrutaCents) },
            ],
            rows: byProduct,
            empty: 'Sin ventas en el período.',
            dense: true,
          })}
        </div>
        <div>
          <h2 class="mb-3 text-lg font-bold">Ventas por categoría</h2>
          ${dataTable({
            columns: [
              { label: 'Categoría', format: (row) => esc(categoryName(row.key)) },
              { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
              { label: 'Ganancia', align: 'right', format: (row) => moneyCell(row.gananciaBrutaCents) },
            ],
            rows: byCategory,
            empty: 'Sin ventas en el período.',
            dense: true,
          })}
        </div>
      </div>`;
  },

  bind(data, ctx) {
    const { range, from, to, sales, expenses, waste } = data;
    const partnerId = ctx.params.socio || '';
    const options = { from, to, partnerId: partnerId || undefined };
    const report = calculateReport({ sales, expenses, products: ctx.catalogs.products, ...options });
    const byPartner = groupSales(sales, { from, to, by: 'partnerId' });
    const partnerName = (id) => ctx.catalogs.partners.find((partner) => partner.id === id)?.nombre || 'Sin socio';

    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('reportes', {
        preset: form.get('preset'), from: form.get('from'), to: form.get('to'), socio: form.get('socio'),
      });
    });

    qs('#export-report')?.addEventListener('click', () => downloadCsv(
      byPartner.map((row) => [
        partnerName(row.key), row.ventasCents / 100, row.costoCents / 100, row.gananciaBrutaCents / 100,
      ]),
      { filename: 'reporte-socios.csv', headers: ['Socio', 'Ventas Q', 'Costo Q', 'Ganancia Q'] },
    ));

    qs('#print-report')?.addEventListener('click', () => {
      try {
        openPrintWindow(generateDocumentHtml({
          title: 'Reporte de resultados',
          business: ctx.business,
          docTitle: 'Reporte de resultados',
          docNumber: `${from ? dateOnly(from) : ''} — ${to ? dateOnly(to) : ''}`,
          meta: [
            ['Período', range.preset],
            ['Socio', partnerId ? partnerName(partnerId) : 'Todo el negocio'],
            ['Ventas', String(report.cantidadVentas)],
            ['Emitido', dateOnly(new Date())],
          ],
          tables: [{
            title: 'Resultado por socio',
            columns: [
              { label: 'Socio' }, { label: 'Ventas', align: 'right' },
              { label: 'Costo', align: 'right' }, { label: 'Ganancia', align: 'right' },
            ],
            rows: byPartner.map((row) => [
              partnerName(row.key), money(row.ventasCents), money(row.costoCents), money(row.gananciaBrutaCents),
            ]),
          }],
          totals: [
            ['Ventas netas', money(report.ventasCents)],
            ['Costo de ventas', money(report.costoCents)],
            ['Ganancia bruta', money(report.gananciaBrutaCents)],
            ['Gastos', money(report.gastosCents)],
            ['Mermas', money(waste.reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0))],
            ['Utilidad neta', money(report.utilidadCents - waste.reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0))],
          ],
        }), { title: 'Reporte' });
      } catch (error) {
        reportError(error, 'No se pudo abrir la ventana de impresión.');
      }
    });
  },
};

/** Focused view of what each partner earns, including their inventory. */
export const partnerResultsPage = {
  load: loadPeriod,

  render({ range, from, to, sales, expenses, waste }, ctx) {
    const rows = ctx.catalogs.partners.map((partner) => {
      const grouped = groupSales(sales, { from, to, partnerId: partner.id })[0]
        || { ventasCents: 0, costoCents: 0, gananciaBrutaCents: 0 };
      const own = expenses.filter((expense) => expense.socioId === partner.id)
        .reduce((sum, expense) => sum + (expense.montoCents || 0), 0);
      const lost = waste.filter((record) => record.socioId === partner.id)
        .reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0);
      const inventory = aggregateProducts(ctx.catalogs.products, { partnerId: partner.id });
      return {
        partner, ...grouped, gastosCents: own, mermasCents: lost,
        utilidadCents: grouped.gananciaBrutaCents - own - lost,
        inventarioCents: inventory.valorInventarioCents,
        potencialCents: inventory.gananciaPotencialCents,
      };
    }).sort((a, b) => b.utilidadCents - a.utilidadCents);

    const totals = rows.reduce((acc, row) => ({
      ventas: acc.ventas + row.ventasCents,
      utilidad: acc.utilidad + row.utilidadCents,
      inventario: acc.inventario + row.inventarioCents,
    }), { ventas: 0, utilidad: 0, inventario: 0 });

    return `
      ${pageHeader('Resultados por socio', 'Cada socio recibe la ganancia de sus propios productos.')}
      ${rangeFilter(range)}
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Ventas del período', money(totals.ventas))}
        ${statCard('Utilidad repartible', money(totals.utilidad))}
        ${statCard('Inventario de socios', money(totals.inventario))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Socio', format: (row) => `<b>${esc(row.partner.nombre)}</b>` },
          { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
          { label: 'Costo', align: 'right', format: (row) => moneyCell(row.costoCents) },
          { label: 'Ganancia bruta', align: 'right', format: (row) => moneyCell(row.gananciaBrutaCents) },
          { label: 'Gastos', align: 'right', format: (row) => moneyCell(row.gastosCents) },
          { label: 'Mermas', align: 'right', format: (row) => moneyCell(row.mermasCents) },
          {
            label: 'Utilidad',
            align: 'right',
            format: (row) => `<b class="${row.utilidadCents < 0 ? 'text-red-700' : 'text-emerald-700'}">${esc(money(row.utilidadCents))}</b>`,
          },
          { label: 'Inventario', align: 'right', format: (row) => moneyCell(row.inventarioCents) },
        ],
        rows,
        empty: 'Registre socios para ver sus resultados.',
      })}`;
  },

  bind(_data, ctx) {
    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('resultados', { preset: form.get('preset'), from: form.get('from'), to: form.get('to') });
    });
  },
};
