import { PAYMENT, STATUS } from '../domain/constants.js';
import {
  registerCustomerPayment, registerManualAccount, registerSupplierPayment,
} from '../services/transactions.js';
import { COL, invalidate, openAccounts } from '../services/db.js';
import { badge, dataTable, field, moneyCell, pageHeader, statCard, textInput } from '../ui/components.js';
import { esc, notice, openModal, qs, qsa } from '../ui/dom.js';
import { dateOnly, money } from '../utils/format.js';
import { daysOverdue, dueLabel } from '../utils/dates.js';
import { toCents } from '../utils/math.js';

const CONFIG = {
  cobrar: {
    collection: COL.receivables,
    catalogKey: 'customers',
    ownerField: 'clienteId',
    ownerName: 'clienteNombre',
    title: 'Cuentas por cobrar',
    subtitle: 'Saldos de los clientes que compraron a crédito.',
    actionLabel: 'Registrar cobro',
    newLabel: 'Nueva cuenta por cobrar',
    entityLabel: 'Cliente',
    entityRoute: 'clientes',
    pay: registerCustomerPayment,
    payArgs: (id, values) => ({ customerId: id, ...values }),
  },
  pagar: {
    collection: COL.payables,
    catalogKey: 'suppliers',
    ownerField: 'proveedorId',
    ownerName: 'proveedorNombre',
    title: 'Cuentas por pagar',
    subtitle: 'Deudas con proveedores por compras al crédito.',
    actionLabel: 'Registrar pago',
    newLabel: 'Nueva cuenta por pagar',
    entityLabel: 'Proveedor',
    entityRoute: 'proveedores',
    pay: registerSupplierPayment,
    payArgs: (id, values) => ({ supplierId: id, ...values }),
  },
};

export function accountsPage(routeId) {
  const config = CONFIG[routeId];

  return {
    async load() {
      return { documents: await openAccounts(config.collection) };
    },

    render({ documents }, ctx) {
      const entities = (ctx.catalogs[config.catalogKey] || []).filter((entity) => (entity.saldoActualCents || 0) > 0);
      const total = entities.reduce((sum, entity) => sum + (entity.saldoActualCents || 0), 0);
      const overdue = documents.filter((document) => (daysOverdue(document.fechaVencimiento) || 0) > 0);
      const overdueTotal = overdue.reduce((sum, document) => sum + (document.saldoCents || 0), 0);

      const owners = ctx.catalogs[config.catalogKey] || [];

      return `
        ${pageHeader(config.title, config.subtitle, `
          <button id="new-account" class="btn-secondary">${esc(config.newLabel)}</button>
          <button id="new-payment" class="btn-primary">${esc(config.actionLabel)}</button>`)}
        ${owners.length ? '' : `<div class="card mb-5 border-amber-200 bg-amber-50 text-sm text-amber-900">
          <p>Todavía no hay ${esc(config.entityLabel.toLowerCase())}s registrados.</p>
          <button data-goto="${esc(config.entityRoute)}" class="btn-secondary mt-3">Crear ${esc(config.entityLabel.toLowerCase())}</button>
        </div>`}
        <section class="mb-6 grid gap-4 sm:grid-cols-3">
          ${statCard('Saldo total', money(total), `${entities.length} ${config.entityLabel.toLowerCase()}s con saldo`)}
          ${statCard('Vencido', money(overdueTotal), `${overdue.length} documentos`, overdueTotal ? 'text-red-700' : '')}
          ${statCard('Por vencer', money(total - overdueTotal))}
        </section>

        <h2 class="mb-3 text-lg font-bold">Saldos por ${esc(config.entityLabel.toLowerCase())}</h2>
        ${dataTable({
          columns: [
            { label: config.entityLabel, format: (row) => `<b>${esc(row.nombre)}</b>` },
            { label: 'Teléfono', format: (row) => esc(row.telefono || '—') },
            { label: 'Saldo', align: 'right', format: (row) => `<b>${esc(money(row.saldoActualCents))}</b>` },
            { label: '', align: 'right', format: (row) => `<button data-pay="${esc(row.id)}" class="btn-link">${esc(config.actionLabel)}</button>` },
          ],
          rows: entities,
          empty: 'No hay saldos pendientes.',
          emptyAction: owners.length ? { id: 'new-account-empty', label: config.newLabel } : null,
        })}

        <h2 class="mb-3 mt-8 text-lg font-bold">Documentos pendientes</h2>
        ${dataTable({
          columns: [
            { label: config.entityLabel, format: (row) => esc(row[config.ownerName] || '—') },
            { label: 'Concepto', format: (row) => esc(row.concepto || row.tipo || '—') },
            { label: 'Emitido', format: (row) => esc(dateOnly(row.fecha)) },
            { label: 'Vence', format: (row) => esc(row.fechaVencimiento ? dateOnly(row.fechaVencimiento) : '—') },
            { label: 'Cargo', align: 'right', format: (row) => moneyCell(row.cargoCents) },
            { label: 'Abonado', align: 'right', format: (row) => moneyCell(row.abonoCents) },
            { label: 'Saldo', align: 'right', format: (row) => `<b>${esc(money(row.saldoCents))}</b>` },
            {
              label: 'Estado',
              format: (row) => {
                const days = daysOverdue(row.fechaVencimiento);
                const overdue = days > 0;
                const state = overdue ? 'Vencida' : row.estado === STATUS.partial ? 'Parcial' : 'Pendiente';
                return `${badge(state, overdue ? 'red' : row.estado === STATUS.partial ? 'amber' : 'teal')}
                  <span class="ml-1 text-xs text-slate-500">${esc(dueLabel(row.fechaVencimiento))}</span>`;
              },
            },
          ],
          rows: documents,
          empty: 'No hay documentos pendientes.',
          emptyAction: owners.length ? { id: 'new-account-doc-empty', label: config.newLabel } : null,
          dense: true,
        })}`;
    },

    bind(_data, ctx) {
      const owners = ctx.catalogs[config.catalogKey] || [];
      const entities = owners.filter((entity) => (entity.saldoActualCents || 0) > 0);

      const openNewAccount = () => {
        if (!owners.length) return notice(`Registre primero un ${config.entityLabel.toLowerCase()}.`, 'warn');
        return openModal({
          title: config.newLabel,
          body: `
            <div class="space-y-4">
              ${field(config.entityLabel, `<select name="owner" class="field mt-1" required>
                ${owners.map((owner) => `<option value="${esc(owner.id)}">${esc(owner.nombre)}</option>`).join('')}
              </select>`)}
              ${field('Concepto', textInput('concept', { required: true, placeholder: 'Saldo anterior, acuerdo, etc.' }))}
              ${field('Monto Q', textInput('amount', { type: 'number', step: '0.01', min: '0.01', required: true }))}
              ${field('Fecha de vencimiento', textInput('due', { type: 'date' }), 'Opcional. Sirve para el control de vencidos.')}
              ${field('Observación', textInput('observation'))}
            </div>`,
          submitLabel: 'Crear cuenta',
          onSubmit: async (form) => {
            const due = form.get('due');
            await registerManualAccount({
              kind: routeId,
              ownerId: form.get('owner'),
              amountCents: toCents(form.get('amount')),
              concept: form.get('concept'),
              dueDate: due ? new Date(`${due}T12:00:00`) : null,
              observation: (form.get('observation') || '').trim(),
            });
            invalidate(COL.customers, COL.suppliers);
            notice('Cuenta registrada.');
            await ctx.refresh();
          },
        });
      };

      const openPayment = (entityId = '') => {
        if (!entities.length) return notice('No hay saldos pendientes.', 'warn');
        openModal({
          title: config.actionLabel,
          body: `
            <div class="space-y-4">
              ${field(config.entityLabel, `<select name="entity" class="field mt-1" id="pay-entity" required>
                ${entities.map((entity) => `<option value="${esc(entity.id)}"${entity.id === entityId ? ' selected' : ''}>
                  ${esc(entity.nombre)} — saldo ${esc(money(entity.saldoActualCents))}</option>`).join('')}
              </select>`)}
              ${field('Monto Q', textInput('amount', { type: 'number', step: '0.01', min: '0.01', required: true }))}
              ${field('Forma de pago', `<select name="method" class="field mt-1">
                <option value="${PAYMENT.cash}">Efectivo</option>
                <option value="${PAYMENT.transfer}">Transferencia</option>
                <option value="${PAYMENT.card}">Tarjeta</option>
              </select>`)}
              ${field('Referencia', textInput('reference', { placeholder: 'Número de boleta, cheque, etc.' }))}
              <p id="pay-hint" class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600"></p>
            </div>`,
          onReady: ({ dialog }) => {
            const select = qs('#pay-entity', dialog);
            const amount = qs('[name="amount"]', dialog);
            const hint = qs('#pay-hint', dialog);
            const update = () => {
              const entity = entities.find((item) => item.id === select.value);
              amount.max = ((entity?.saldoActualCents || 0) / 100).toFixed(2);
              hint.textContent = `Saldo pendiente ${money(entity?.saldoActualCents)}. El pago se aplica a los documentos más antiguos primero.`;
            };
            select.onchange = update;
            update();
          },
          onSubmit: async (form) => {
            const result = await config.pay(config.payArgs(form.get('entity'), {
              amountCents: toCents(form.get('amount')),
              method: form.get('method'),
              reference: (form.get('reference') || '').trim(),
            }));
            invalidate(COL.customers, COL.suppliers);
            notice(`Pago registrado. Saldo restante ${money(result.saldoCents)}.`);
            await ctx.refresh();
          },
        });
      };

      qs('#new-payment')?.addEventListener('click', () => openPayment());
      qsa('[data-pay]').forEach((button) => {
        button.onclick = () => openPayment(button.dataset.pay);
      });
      qsa('#new-account, #new-account-empty, #new-account-doc-empty').forEach((button) => {
        button.onclick = openNewAccount;
      });
      qsa('[data-goto]').forEach((button) => {
        button.onclick = () => ctx.navigate(button.dataset.goto);
      });
    },
  };
}
