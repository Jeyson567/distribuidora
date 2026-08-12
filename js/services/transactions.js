import { collection, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { forOwner } from './db.js';
import { COL, SETTINGS_DOC } from '../domain/constants.js';
import { BusinessError } from '../domain/errors.js';
import {
  planCashMovement, planCloseCash, planCustomerPayment, planExpense,
  planInventoryAdjustment, planManualAccount, planOpenCash, planSupplierPayment, planWaste,
} from '../domain/operations.js';
import { planSale, planSaleCancellation, planSaleReturn } from '../domain/sales.js';
import { planPurchase, planSupplierReturn } from '../domain/purchases.js';

const refOf = (collectionName, id) => doc(db, collectionName, id);
const newId = (collectionName) => doc(collection(db, collectionName)).id;

const readDoc = async (tx, collectionName, id) => {
  if (!id) return null;
  const snapshot = await tx.get(refOf(collectionName, id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
};

const readMany = async (tx, collectionName, ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  const documents = await Promise.all(unique.map((id) => readDoc(tx, collectionName, id)));
  return new Map(documents.filter(Boolean).map((document) => [document.id, document]));
};

/** Reads the pointer document and then the open register it points to. */
const readCashSession = async (tx) => {
  const pointer = await readDoc(tx, COL.settings, SETTINGS_DOC.activeCash);
  if (!pointer?.cajaId) return null;
  const session = await readDoc(tx, COL.cashRegisters, pointer.cajaId);
  return session?.estado === 'ABIERTA' ? session : null;
};

const readContext = async (tx) => ({
  counters: (await readDoc(tx, COL.settings, SETTINGS_DOC.counters)) || {},
  business: (await readDoc(tx, COL.settings, SETTINGS_DOC.business)) || {},
});

const applyPlan = (tx, writes) => {
  const now = serverTimestamp();
  for (const write of writes) {
    const reference = refOf(write.collection, write.id);
    if (write.mode === 'set') tx.set(reference, { ...write.data, createdAt: now, updatedAt: now });
    else if (write.mode === 'merge') tx.set(reference, { ...write.data, updatedAt: now }, { merge: true });
    else tx.update(reference, { ...write.data, updatedAt: now });
  }
};

const execute = (build) => runTransaction(db, async (tx) => {
  const { writes, result } = await build(tx);
  applyPlan(tx, writes);
  return result;
});

/**
 * Firestore forbids queries inside a transaction, so candidate documents are
 * located first and then re-read transactionally before being modified.
 */
const openAccountDocuments = async (collectionName, field, ownerId) => {
  // Filtering and ordering on different fields would demand a composite index,
  // so the oldest-first order that FIFO needs is applied here instead.
  const documents = await forOwner(collectionName, field, ownerId, 200, 'asc');
  return documents
    .filter((document) => (Number(document.saldoCents) || 0) > 0)
    .map((document, index) => ({ ...document, order: index }));
};

const reReadAccountDocuments = async (tx, collectionName, candidates) => {
  const documents = await Promise.all(candidates.map(async (candidate) => {
    const current = await readDoc(tx, collectionName, candidate.id);
    return current ? { ...current, fechaOrden: candidate.order } : null;
  }));
  return documents.filter((document) => document && (Number(document.saldoCents) || 0) > 0);
};

export async function registerSale({ customerId, lines, payments, discountCents = 0, observation = '' }) {
  return execute(async (tx) => {
    const customer = await readDoc(tx, COL.customers, customerId);
    const productsById = await readMany(tx, COL.products, lines.map((line) => line.productId));
    const partnersById = await readMany(tx, COL.partners, [...productsById.values()].map((p) => p.socioId));
    const { counters, business } = await readContext(tx);
    const cashSession = await readCashSession(tx);
    return planSale({
      customer, productsById, partnersById, lines, payments, discountCents, observation,
      cashSession, counters, prefix: business.prefijoVentas || 'V',
      newId, now: serverTimestamp(),
    });
  });
}

export async function registerPurchase({
  supplierId, lines, paymentMethod = 'CONTADO', settlementMethod = 'EFECTIVO',
  dueDate = null, discountCents = 0, observation = '',
}) {
  return execute(async (tx) => {
    const supplier = await readDoc(tx, COL.suppliers, supplierId);
    const productsById = await readMany(tx, COL.products, lines.map((line) => line.productId));
    const { counters, business } = await readContext(tx);
    const cashSession = await readCashSession(tx);
    return planPurchase({
      supplier, productsById, lines, paymentMethod, settlementMethod, dueDate,
      discountCents, observation, cashSession, counters,
      prefix: business.prefijoCompras || 'C', newId, now: serverTimestamp(),
    });
  });
}

export async function registerSaleReturn({
  saleId, lines, reason, resolution = 'EFECTIVO', observation = '',
}) {
  return execute(async (tx) => {
    const sale = await readDoc(tx, COL.sales, saleId);
    if (!sale) throw new BusinessError('La venta indicada no existe.');
    const productIds = (sale.lineas || [])
      .filter((line) => lines.some((request) => request.lineId === line.lineId))
      .map((line) => line.productoId);
    const productsById = await readMany(tx, COL.products, productIds);
    const customer = await readDoc(tx, COL.customers, sale.clienteId);
    const { counters } = await readContext(tx);
    const cashSession = await readCashSession(tx);
    return planSaleReturn({
      sale, customer, productsById, requestedLines: lines, reason, resolution, observation,
      cashSession, counters, newId, now: serverTimestamp(),
    });
  });
}

export async function cancelSale({ saleId, reason }) {
  return execute(async (tx) => {
    const sale = await readDoc(tx, COL.sales, saleId);
    if (!sale) throw new BusinessError('La venta indicada no existe.');
    const productsById = await readMany(tx, COL.products, (sale.lineas || []).map((line) => line.productoId));
    const customer = await readDoc(tx, COL.customers, sale.clienteId);
    const cashSession = await readCashSession(tx);
    return planSaleCancellation({
      sale, customer, productsById, reason, cashSession, newId, now: serverTimestamp(),
    });
  });
}

export async function registerCustomerPayment({
  customerId, amountCents, method = 'EFECTIVO', reference = '', observation = '',
}) {
  const candidates = await openAccountDocuments(COL.receivables, 'clienteId', customerId);
  return execute(async (tx) => {
    const customer = await readDoc(tx, COL.customers, customerId);
    const openReceivables = await reReadAccountDocuments(tx, COL.receivables, candidates);
    const cashSession = await readCashSession(tx);
    return planCustomerPayment({
      customer, openReceivables, amountCents, method, reference, observation,
      cashSession, newId, now: serverTimestamp(),
    });
  });
}

export async function registerSupplierPayment({
  supplierId, amountCents, method = 'EFECTIVO', reference = '', observation = '',
}) {
  const candidates = await openAccountDocuments(COL.payables, 'proveedorId', supplierId);
  return execute(async (tx) => {
    const supplier = await readDoc(tx, COL.suppliers, supplierId);
    const openPayables = await reReadAccountDocuments(tx, COL.payables, candidates);
    const cashSession = await readCashSession(tx);
    return planSupplierPayment({
      supplier, openPayables, amountCents, method, reference, observation,
      cashSession, newId, now: serverTimestamp(),
    });
  });
}

export async function registerManualAccount({
  kind, ownerId, amountCents, concept, dueDate = null, observation = '',
}) {
  return execute(async (tx) => {
    const owner = await readDoc(tx, kind === 'cobrar' ? COL.customers : COL.suppliers, ownerId);
    return planManualAccount({
      kind, owner, amountCents, concept, dueDate, observation, newId, now: serverTimestamp(),
    });
  });
}

export async function registerExpense({
  category, description, amountCents, method = 'EFECTIVO', partnerId = null, observation = '',
}) {
  return execute(async (tx) => {
    const partner = partnerId ? await readDoc(tx, COL.partners, partnerId) : null;
    const cashSession = await readCashSession(tx);
    return planExpense({
      category, description, amountCents, method, partner, observation,
      cashSession, newId, now: serverTimestamp(),
    });
  });
}

export async function registerWaste({ productId, quantityBaseMilli, reason, observation = '' }) {
  return execute(async (tx) => {
    const product = await readDoc(tx, COL.products, productId);
    return planWaste({ product, quantityBaseMilli, reason, observation, newId, now: serverTimestamp() });
  });
}

export async function registerInventoryAdjustment({
  productId, type, quantityBaseMilli, unitCostCents = null, reason, observation = '',
}) {
  return execute(async (tx) => {
    const product = await readDoc(tx, COL.products, productId);
    const user = auth.currentUser;
    return planInventoryAdjustment({
      product, type, quantityBaseMilli, unitCostCents, reason, observation,
      operator: user ? { uid: user.uid, email: user.email || '' } : null,
      newId, now: serverTimestamp(),
    });
  });
}

export async function registerSupplierReturn({
  supplierId, productId, quantityBaseMilli, reason, observation = '',
}) {
  return execute(async (tx) => {
    const supplier = await readDoc(tx, COL.suppliers, supplierId);
    const product = await readDoc(tx, COL.products, productId);
    const cashSession = await readCashSession(tx);
    return planSupplierReturn({
      supplier, product, quantityBaseMilli, reason, observation,
      cashSession, newId, now: serverTimestamp(),
    });
  });
}

export async function openCashRegister({ openingCents, observation = '' }) {
  return execute(async (tx) => {
    const activeSession = await readCashSession(tx);
    return planOpenCash({ activeSession, openingCents, observation, newId, now: serverTimestamp() });
  });
}

export async function closeCashRegister({ countedCents, observation = '' }) {
  return execute(async (tx) => {
    const session = await readCashSession(tx);
    return planCloseCash({ session, countedCents, observation, newId, now: serverTimestamp() });
  });
}

export async function registerCashMovement({ type, amountCents, description }) {
  return execute(async (tx) => {
    const session = await readCashSession(tx);
    return planCashMovement({ session, type, amountCents, description, newId, now: serverTimestamp() });
  });
}

/** Current open register, or null. Used by the UI to guide the operator. */
export async function loadActiveCashSession() {
  const pointer = await getDoc(refOf(COL.settings, SETTINGS_DOC.activeCash));
  const cashId = pointer.exists() ? pointer.data().cajaId : null;
  if (!cashId) return null;
  const session = await getDoc(refOf(COL.cashRegisters, cashId));
  if (!session.exists() || session.data().estado !== 'ABIERTA') return null;
  return { id: session.id, ...session.data() };
}
