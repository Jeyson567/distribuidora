import { COL, CASH_MOVE, PAYMENT, SETTINGS_DOC } from './constants.js';
import { fault } from './errors.js';

/**
 * A plan is a pure description of the documents an operation must write.
 * Both the Firestore executor and the in-memory test store apply the same
 * plan, so the business rules can be verified without a database.
 */
export function createPlan({ newId, now }) {
  const writes = [];
  const api = {
    writes,
    now,
    add(collection, data) {
      const id = newId(collection);
      writes.push({ collection, id, mode: 'set', data });
      return id;
    },
    set(collection, id, data) {
      writes.push({ collection, id, mode: 'set', data });
      return id;
    },
    merge(collection, id, data) {
      writes.push({ collection, id, mode: 'merge', data });
      return id;
    },
    update(collection, id, data) {
      writes.push({ collection, id, mode: 'update', data });
      return id;
    },
    movement(payload) {
      return api.add(COL.inventory, { ...payload, fecha: now });
    },
    audit(accion, modulo, documentoId, valores = {}) {
      return api.add(COL.audit, { accion, modulo, documentoId, valores, fecha: now });
    },
  };
  return api;
}

/**
 * Reserves the next correlative for a document type. Numbers are never reused
 * because the counter is written inside the same transaction that consumes it.
 */
export function takeSerial(plan, counters, key, prefix) {
  const next = (Number(counters?.[key]) || 0) + 1;
  plan.merge(COL.settings, SETTINGS_DOC.counters, { [key]: next, updatedAt: plan.now });
  return `${prefix}-${String(next).padStart(6, '0')}`;
}

const TYPE_TOTAL = {
  [CASH_MOVE.opening]: null,
  [CASH_MOVE.sale]: 'ventasCents',
  [CASH_MOVE.customerPayment]: 'cobrosCents',
  [CASH_MOVE.supplierPayment]: 'pagosCents',
  [CASH_MOVE.purchase]: 'comprasCents',
  [CASH_MOVE.expense]: 'gastosCents',
  [CASH_MOVE.withdrawal]: 'retirosCents',
  [CASH_MOVE.deposit]: 'ingresosCents',
  [CASH_MOVE.saleReturn]: 'devolucionesCents',
  [CASH_MOVE.supplierReturn]: 'devolucionesProveedorCents',
};

const METHOD_TOTAL = {
  [PAYMENT.cash]: 'efectivoCents',
  [PAYMENT.card]: 'tarjetaCents',
  [PAYMENT.transfer]: 'transferenciaCents',
};

/**
 * Records cash movements and keeps the running totals of the open session on
 * the session document, so closing the register never needs a query.
 */
export function cashRecorder(plan, session) {
  const deltas = {};
  const bump = (field, amount) => {
    if (!field) return;
    deltas[field] = (deltas[field] || 0) + amount;
  };
  return {
    get deltas() {
      return deltas;
    },
    require() {
      if (!session?.id) fault('Debe abrir la caja antes de registrar esta operación.');
      return session.id;
    },
    record({ tipo, metodo, montoCents, referenciaId = null, referenciaTipo = null, descripcion = '' }) {
      const cajaId = this.require();
      plan.add(COL.cashMoves, {
        cajaId, tipo, metodo, montoCents, referenciaId, referenciaTipo, descripcion, fecha: plan.now,
      });
      bump(METHOD_TOTAL[metodo], montoCents);
      bump(TYPE_TOTAL[tipo], Math.abs(montoCents));
    },
    flush() {
      if (!session?.id) return;
      const entries = Object.entries(deltas);
      if (!entries.length) return;
      plan.update(COL.cashRegisters, session.id, Object.fromEntries(
        entries.map(([field, delta]) => [field, (Number(session[field]) || 0) + delta]),
      ));
    },
  };
}

export const expectedCashCents = (session) => Number(session?.efectivoCents) || 0;
