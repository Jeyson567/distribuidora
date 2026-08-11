import { COL, between, openAccounts } from '../services/db.js';
import { calculateReport, groupSales, topProducts } from '../services/reports.js';
import { badge, dataTable, moneyCell, pageHeader, statCard } from '../ui/components.js';
import { esc, qs, qsa } from '../ui/dom.js';
import { dateTime, money, quantity } from '../utils/format.js';
import { daysOverdue, resolveRange } from '../utils/dates.js';

export default {
  async load() {
    const today = resolveRange('hoy');
    const month = resolveRange('mes');
    const [todaySales, monthSales, monthExpenses, receivables, payables] = await Promise.all([
      between(COL.sales, today.from, today.to, 300),
      between(COL.sales, month.from, month.to, 1000),
      between(COL.expenses, month.from, month.to, 500),
      openAccounts(COL.receivables, 200),
      openAccounts(COL.payables, 200),
    ]);
    return { today, month, todaySales, monthSales, monthExpenses, receivables, payables };
  },

  render({ today, month, todaySales, monthSales, monthExpenses, receivables, payables }, ctx) {
    const dayReport = calculateReport({ sales: todaySales, products: [], from: today.from, to: today.to });
    const monthReport = calculateReport({
      sales: monthSales, expenses: monthExpenses, products: ctx.catalogs.products, from: month.from, to: month.to,
    });
    const lowStock = ctx.catalogs.products
      .filter((product) => product.activo !== false && (product.stockBaseMilli || 0) <= (product.stockMinimoBaseMilli || 0))
      .slice(0, 8);
    const overdue = receivables.filter((document) => (daysOverdue(document.fechaVencimiento) || 0) > 0);
    const partners = groupSales(monthSales, { from: month.from, to: month.to });
    const partnerName = (id) => ctx.catalogs.partners.find((partner) => partner.id === id)?.nombre || 'Sin socio';
    const setupPending = !ctx.catalogs.partners.length || !ctx.catalogs.products.length;

    return `
      ${pageHeader('Dashboard', ctx.cashSession ? 'Caja abierta. El sistema está listo para operar.' : 'La caja está cerrada.',
        ctx.cashSession ? '<button id="go-pos" class="btn-primary">Ir al punto de venta</button>'
          : '<button id="go-cash" class="btn-primary">Abrir caja</button>')}

      ${setupPending ? `
        <div class="card mb-6 border-teal-200 bg-teal-50">
          <h2 class="font-bold text-teal-900">Primeros pasos</h2>
          <ol class="mt-2 list-inside list-decimal space-y-1 text-sm text-teal-900">
            <li>Cargue las unidades estándar en Configuración → Unidades.</li>
            <li>Registre sus socios o áreas y las categorías de producto.</li>
            <li>Cree los productos y registre su inventario inicial o su primera compra.</li>
            <li>Abra la caja y comience a vender.</li>
          </ol>
        </div>` : ''}

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Ventas de hoy', money(dayReport.ventasCents), `${dayReport.cantidadVentas} ventas`)}
        ${statCard('Ganancia de hoy', money(dayReport.gananciaBrutaCents))}
        ${statCard('Ventas del mes', money(monthReport.ventasCents))}
        ${statCard('Utilidad del mes', money(monthReport.utilidadCents),
          `Gastos ${money(monthReport.gastosCents)}`, monthReport.utilidadCents < 0 ? 'text-red-700' : 'text-emerald-700')}
      </section>

      <section class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Valor del inventario', money(monthReport.valorInventarioCents))}
        ${statCard('Por cobrar', money(receivables.reduce((sum, item) => sum + (item.saldoCents || 0), 0)),
          `${overdue.length} vencidos`, overdue.length ? 'text-red-700' : '')}
        ${statCard('Por pagar', money(payables.reduce((sum, item) => sum + (item.saldoCents || 0), 0)))}
        ${statCard('Efectivo en caja', money(ctx.cashSession?.efectivoCents || 0), ctx.cashSession ? 'Caja abierta' : 'Caja cerrada')}
      </section>

      <div class="mt-8 grid gap-6 xl:grid-cols-2">
        <div>
          <h2 class="mb-3 text-lg font-bold">Últimas ventas</h2>
          ${dataTable({
            columns: [
              { label: 'Número', format: (row) => esc(row.numero) },
              { label: 'Hora', format: (row) => esc(dateTime(row.fecha)) },
              { label: 'Cliente', format: (row) => esc(row.clienteNombre || '—') },
              { label: 'Total', align: 'right', format: (row) => moneyCell(row.totalCents) },
            ],
            rows: todaySales.slice(0, 8),
            empty: 'Todavía no hay ventas hoy.',
            dense: true,
          })}
        </div>
        <div>
          <h2 class="mb-3 text-lg font-bold">Alertas de inventario</h2>
          ${dataTable({
            columns: [
              { label: 'Producto', format: (row) => esc(row.nombre) },
              { label: 'Existencia', align: 'right', format: (row) => esc(quantity(row.stockBaseMilli)) },
              { label: 'Mínimo', align: 'right', format: (row) => esc(quantity(row.stockMinimoBaseMilli)) },
              { label: '', format: (row) => badge((row.stockBaseMilli || 0) <= 0 ? 'Agotado' : 'Bajo', (row.stockBaseMilli || 0) <= 0 ? 'red' : 'amber') },
            ],
            rows: lowStock,
            empty: 'Sin alertas de inventario.',
            dense: true,
          })}
        </div>
        <div>
          <h2 class="mb-3 text-lg font-bold">Ganancia del mes por socio</h2>
          ${dataTable({
            columns: [
              { label: 'Socio', format: (row) => esc(partnerName(row.key)) },
              { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
              { label: 'Ganancia', align: 'right', format: (row) => moneyCell(row.gananciaBrutaCents) },
            ],
            rows: partners,
            empty: 'Sin ventas este mes.',
            dense: true,
          })}
        </div>
        <div>
          <h2 class="mb-3 text-lg font-bold">Productos más vendidos del mes</h2>
          ${dataTable({
            columns: [
              { label: 'Producto', format: (row) => esc(row.nombre || '—') },
              { label: 'Cantidad', align: 'right', format: (row) => esc(quantity(row.cantidadBaseMilli)) },
              { label: 'Ventas', align: 'right', format: (row) => moneyCell(row.ventasCents) },
            ],
            rows: topProducts(monthSales, { from: month.from, to: month.to }, 8),
            empty: 'Sin ventas este mes.',
            dense: true,
          })}
        </div>
      </div>`;
  },

  bind(_data, ctx) {
    qs('#go-pos')?.addEventListener('click', () => ctx.navigate('pos'));
    qs('#go-cash')?.addEventListener('click', () => ctx.navigate('caja'));
    qsa('[data-nav-inline]').forEach((button) => {
      button.onclick = () => ctx.navigate(button.dataset.navInline);
    });
  },
};
