import { CASH_MOVE, EXPENSE_CATEGORIES, PAYMENT } from '../domain/constants.js';
import { closeCashRegister, openCashRegister, registerCashMovement, registerExpense } from '../services/transactions.js';
import { COL, between, cashMovesFor } from '../services/db.js';
import { generateDocumentHtml, openPrintWindow } from '../services/printing.js';
import { badge, dataTable, field, moneyCell, pageHeader, rangeFilter, selectInput, statCard, textInput } from '../ui/components.js';
import { esc, notice, openModal, qs, qsa } from '../ui/dom.js';
import { dateTime, money } from '../utils/format.js';
import { resolveRange } from '../utils/dates.js';
import { toCents } from '../utils/math.js';

const cutRows = (session) => [
  ['Fondo de apertura', money(session.aperturaCents)],
  ['Ventas en efectivo', money(session.ventasCents)],
  ['Cobros de crédito', money(session.cobrosCents)],
  ['Otros ingresos', money(session.ingresosCents)],
  ['Compras pagadas', `-${money(session.comprasCents)}`],
  ['Pagos a proveedores', `-${money(session.pagosCents)}`],
  ['Gastos', `-${money(session.gastosCents)}`],
  ['Devoluciones', `-${money(session.devolucionesCents)}`],
  ['Retiros', `-${money(session.retirosCents)}`],
];

const printCut = (session, movements, business) => openPrintWindow(generateDocumentHtml({
  title: 'Corte de caja',
  business,
  docTitle: 'Corte de caja',
  docNumber: dateTime(session.fechaApertura),
  meta: [
    ['Apertura', dateTime(session.fechaApertura)],
    ['Cierre', session.fechaCierre ? dateTime(session.fechaCierre) : 'Caja abierta'],
    ['Estado', session.estado],
    ['Movimientos', String(movements.length)],
  ],
  tables: [
    {
      title: 'Resumen de efectivo',
      columns: [{ label: 'Concepto' }, { label: 'Monto', align: 'right' }],
      rows: cutRows(session),
    },
    {
      title: 'Otros medios de pago',
      columns: [{ label: 'Medio' }, { label: 'Monto', align: 'right' }],
      rows: [['Tarjeta', money(session.tarjetaCents)], ['Transferencia', money(session.transferenciaCents)]],
    },
  ],
  totals: [
    ['Efectivo esperado', money(session.efectivoCents)],
    ...(session.estado === 'CERRADA'
      ? [['Efectivo contado', money(session.contadoCents)], ['Diferencia', money(session.diferenciaCents)]]
      : []),
  ],
}), { title: 'Corte de caja' });

export default {
  async load(ctx) {
    const range = { preset: ctx.params.preset || 'mes', from: ctx.params.from || '', to: ctx.params.to || '' };
    const { from, to } = resolveRange(range.preset, range);
    const [sessions, movements] = await Promise.all([
      between(COL.cashRegisters, from, to, 100, 'fechaApertura'),
      ctx.cashSession ? cashMovesFor(ctx.cashSession.id) : Promise.resolve([]),
    ]);
    return { sessions, movements, range };
  },

  render({ sessions, movements, range }, ctx) {
    const session = ctx.cashSession;
    const header = pageHeader('Caja', 'Todo el efectivo del día se controla desde la caja abierta.', session
      ? `<button id="cash-in" class="btn-secondary">Ingreso</button>
         <button id="cash-out" class="btn-secondary">Retiro</button>
         <button id="print-cut" class="btn-secondary">Imprimir corte</button>
         <button id="close-cash" class="btn-primary">Cerrar caja</button>`
      : '<button id="open-cash" class="btn-primary">+ Abrir caja</button>');

    const current = session ? `
      <section class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Efectivo esperado', money(session.efectivoCents), `Abierta ${dateTime(session.fechaApertura)}`)}
        ${statCard('Ventas en efectivo', money(session.ventasCents))}
        ${statCard('Cobros de crédito', money(session.cobrosCents))}
        ${statCard('Salidas', money((session.gastosCents || 0) + (session.pagosCents || 0) + (session.retirosCents || 0) + (session.comprasCents || 0)))}
      </section>
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Fondo de apertura', money(session.aperturaCents))}
        ${statCard('Tarjeta', money(session.tarjetaCents))}
        ${statCard('Transferencia', money(session.transferenciaCents))}
      </section>
      <h2 class="mb-3 text-lg font-bold">Movimientos de la caja abierta</h2>
      ${dataTable({
        columns: [
          { label: 'Hora', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Tipo', format: (row) => badge(row.tipo, 'slate') },
          { label: 'Medio', format: (row) => esc(row.metodo) },
          { label: 'Descripción', format: (row) => esc(row.descripcion || '—') },
          {
            label: 'Monto',
            align: 'right',
            format: (row) => `<span class="${(row.montoCents || 0) < 0 ? 'text-red-700' : 'text-emerald-700'}">${esc(money(row.montoCents))}</span>`,
          },
        ],
        rows: movements,
        empty: 'Sin movimientos todavía.',
        dense: true,
      })}`
      : `<div class="card mb-6 text-center">
          <h2 class="text-lg font-bold">No hay una caja abierta</h2>
          <p class="mt-2 text-sm text-slate-600">Las ventas, cobros, pagos y gastos requieren una caja abierta.</p>
          <button id="open-cash-empty" class="btn-primary mt-4">+ Abrir caja</button>
        </div>`;

    return `
      ${header}
      ${current}
      <h2 class="mb-3 mt-8 text-lg font-bold">Historial de cajas</h2>
      ${rangeFilter(range)}
      ${dataTable({
        columns: [
          { label: 'Apertura', format: (row) => esc(dateTime(row.fechaApertura)) },
          { label: 'Cierre', format: (row) => esc(row.fechaCierre ? dateTime(row.fechaCierre) : '—') },
          { label: 'Fondo', align: 'right', format: (row) => moneyCell(row.aperturaCents) },
          { label: 'Ventas efectivo', align: 'right', format: (row) => moneyCell(row.ventasCents) },
          { label: 'Esperado', align: 'right', format: (row) => moneyCell(row.estado === 'CERRADA' ? row.esperadoCents : row.efectivoCents) },
          { label: 'Contado', align: 'right', format: (row) => (row.estado === 'CERRADA' ? moneyCell(row.contadoCents) : '—') },
          {
            label: 'Diferencia',
            align: 'right',
            format: (row) => (row.estado === 'CERRADA'
              ? `<span class="${row.diferenciaCents ? 'font-semibold text-red-700' : 'text-emerald-700'}">${esc(money(row.diferenciaCents))}</span>`
              : '—'),
          },
          { label: 'Estado', format: (row) => badge(row.estado, row.estado === 'ABIERTA' ? 'green' : 'slate') },
          { label: '', align: 'right', format: (row) => `<button data-cut="${esc(row.id)}" class="btn-link">Corte</button>` },
        ],
        rows: sessions,
        empty: 'No hay cajas en el período.',
        emptyAction: ctx.cashSession ? null : { id: 'open-cash-history', label: '+ Abrir caja' },
      })}`;
  },

  bind({ sessions, movements }, ctx) {
    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('caja', { preset: form.get('preset'), from: form.get('from'), to: form.get('to') });
    });

    qsa('#open-cash, #open-cash-empty, #open-cash-history').forEach((button) => {
      button.onclick = () => openModal({
        title: 'Apertura de caja',
        submitLabel: 'Abrir caja',
        body: `<div class="space-y-4">
          ${field('Fondo inicial en efectivo Q', textInput('amount', { type: 'number', step: '0.01', min: '0', required: true, value: '0' }))}
          ${field('Observación', textInput('observation'))}
        </div>`,
        onSubmit: async (form) => {
          await openCashRegister({
            openingCents: toCents(form.get('amount')),
            observation: (form.get('observation') || '').trim(),
          });
          notice('Caja abierta.');
          await ctx.refresh();
        },
      });
    });

    qs('#close-cash')?.addEventListener('click', () => {
      const session = ctx.cashSession;
      openModal({
        title: 'Cierre de caja',
        submitLabel: 'Cerrar caja',
        body: `
          <div class="space-y-4">
            <div class="rounded-lg bg-slate-50 p-3 text-sm">
              ${cutRows(session).map(([label, value]) => `<p class="flex justify-between"><span>${esc(label)}</span><b>${esc(value)}</b></p>`).join('')}
              <p class="mt-2 flex justify-between border-t border-slate-300 pt-2 text-base"><span>Efectivo esperado</span><b>${esc(money(session.efectivoCents))}</b></p>
            </div>
            ${field('Efectivo contado Q', textInput('counted', { type: 'number', step: '0.01', min: '0', required: true }))}
            <p id="difference" class="text-sm text-slate-600"></p>
            ${field('Observación del cierre', textInput('observation'))}
          </div>`,
        onReady: ({ dialog }) => {
          const counted = qs('[name="counted"]', dialog);
          counted.oninput = () => {
            const difference = toCents(counted.value || 0) - (session.efectivoCents || 0);
            qs('#difference', dialog).textContent = difference === 0
              ? 'La caja cuadra exactamente.'
              : `Diferencia: ${money(difference)} ${difference > 0 ? '(sobrante)' : '(faltante)'}`;
          };
        },
        onSubmit: async (form) => {
          const result = await closeCashRegister({
            countedCents: toCents(form.get('counted')),
            observation: (form.get('observation') || '').trim(),
          });
          notice(result.diferenciaCents === 0
            ? 'Caja cerrada sin diferencia.'
            : `Caja cerrada con diferencia de ${money(result.diferenciaCents)}.`);
          await ctx.refresh();
        },
      });
    });

    const movementModal = (type) => openModal({
      title: type === CASH_MOVE.withdrawal ? 'Retiro de efectivo' : 'Ingreso de efectivo',
      body: `<div class="space-y-4">
        ${field('Monto Q', textInput('amount', { type: 'number', step: '0.01', min: '0.01', required: true }))}
        ${field('Descripción', textInput('description', { required: true }))}
      </div>`,
      onSubmit: async (form) => {
        await registerCashMovement({
          type,
          amountCents: toCents(form.get('amount')),
          description: (form.get('description') || '').trim(),
        });
        notice('Movimiento registrado.');
        await ctx.refresh();
      },
    });

    qs('#cash-out')?.addEventListener('click', () => movementModal(CASH_MOVE.withdrawal));
    qs('#cash-in')?.addEventListener('click', () => movementModal(CASH_MOVE.deposit));
    qs('#print-cut')?.addEventListener('click', () => printCut(ctx.cashSession, movements, ctx.business));

    qsa('[data-cut]').forEach((button) => {
      button.onclick = async () => {
        const session = sessions.find((item) => item.id === button.dataset.cut);
        const sessionMoves = session.id === ctx.cashSession?.id ? movements : await cashMovesFor(session.id);
        printCut(session, sessionMoves, ctx.business);
      };
    });
  },
};

/** Expenses, optionally assigned to a partner. */
export const expensesPage = {
  async load(ctx) {
    const range = { preset: ctx.params.preset || 'mes', from: ctx.params.from || '', to: ctx.params.to || '' };
    const { from, to } = resolveRange(range.preset, range);
    return { expenses: await between(COL.expenses, from, to, 300), range };
  },

  render({ expenses, range }, ctx) {
    const partnerId = ctx.params.socio || '';
    const rows = partnerId ? expenses.filter((expense) => expense.socioId === partnerId) : expenses;
    const total = rows.reduce((sum, expense) => sum + (expense.montoCents || 0), 0);
    const general = rows.filter((expense) => !expense.socioId).reduce((sum, expense) => sum + (expense.montoCents || 0), 0);

    return `
      ${pageHeader('Gastos', 'Los gastos salen de la caja y pueden asignarse a un socio.',
        '<button id="new-expense" class="btn-primary">+ Registrar gasto</button>')}
      ${rangeFilter(range, `<label class="text-sm font-medium">Socio${
        selectInput('socio', ctx.catalogs.partners, { selected: partnerId, placeholder: 'Todos' })}</label>`)}
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Gastos del período', money(total), `${rows.length} registros`)}
        ${statCard('Generales', money(general))}
        ${statCard('Asignados a socios', money(total - general))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Categoría', format: (row) => esc(row.categoria || '—') },
          { label: 'Descripción', format: (row) => esc(row.descripcion || '—') },
          { label: 'Socio', format: (row) => esc(row.socioNombre || 'GENERAL') },
          { label: 'Medio', format: (row) => esc(row.metodoPago || '—') },
          { label: 'Monto', align: 'right', format: (row) => moneyCell(row.montoCents) },
        ],
        rows,
        empty: 'No hay gastos en el período.',
        emptyAction: { id: 'new-expense-empty', label: '+ Registrar gasto' },
      })}`;
  },

  bind(_data, ctx) {
    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('gastos', {
        preset: form.get('preset'), from: form.get('from'), to: form.get('to'), socio: form.get('socio'),
      });
    });

    qsa('#new-expense, #new-expense-empty').forEach((button) => {
      button.onclick = () => openModal({
        title: 'Registrar gasto',
        body: `
          <div class="space-y-4">
            ${field('Categoría', `<select name="category" class="field mt-1" required>${
              EXPENSE_CATEGORIES.map((category) => `<option>${esc(category)}</option>`).join('')}</select>`)}
            ${field('Descripción', textInput('description', { required: true }))}
            ${field('Monto Q', textInput('amount', { type: 'number', step: '0.01', min: '0.01', required: true }))}
            ${field('Forma de pago', `<select name="method" class="field mt-1">
              <option value="${PAYMENT.cash}">Efectivo</option>
              <option value="${PAYMENT.transfer}">Transferencia</option>
              <option value="${PAYMENT.card}">Tarjeta</option>
            </select>`)}
            ${field('Socio (opcional)', selectInput('partner', ctx.catalogs.partners, { placeholder: 'Gasto general' }))}
          </div>`,
        onSubmit: async (form) => {
          await registerExpense({
            category: form.get('category'),
            description: (form.get('description') || '').trim(),
            amountCents: toCents(form.get('amount')),
            method: form.get('method'),
            partnerId: form.get('partner') || null,
          });
          notice('Gasto registrado.');
          await ctx.refresh();
        },
      });
    });
  },
};
