import { CASH_MOVE, COL, MOVEMENT, PAYMENT, SETTINGS_DOC, SETTLED_METHODS, STATUS } from './constants.js';
import { fault } from './errors.js';
import { cashRecorder, createPlan, expectedCashCents } from './plan.js';
import { requireNonNegative, requirePositive, scale, sum, weightedAverage } from '../utils/math.js';

const money = (value) => `Q${((Number(value) || 0) / 100).toFixed(2)}`;

/** Applies a payment to open documents oldest first, so ageing stays accurate. */
function applyFifo(plan, collection, documents, amountCents, now) {
  const applications = [];
  let remaining = amountCents;
  const ordered = [...documents]
    .filter((document) => (Number(document.saldoCents) || 0) > 0)
    .sort((a, b) => (a.fechaOrden || 0) - (b.fechaOrden || 0));

  for (const document of ordered) {
    if (remaining <= 0) break;
    const balance = Number(document.saldoCents) || 0;
    const applied = Math.min(balance, remaining);
    remaining -= applied;
    const saldoCents = balance - applied;
    plan.update(collection, document.id, {
      abonoCents: (Number(document.abonoCents) || 0) + applied,
      saldoCents,
      estado: saldoCents === 0 ? STATUS.settled : STATUS.partial,
      ultimoPagoFecha: now,
    });
    applications.push({ documentoId: document.id, concepto: document.concepto || '', montoCents: applied });
  }
  return { applications, remaining };
}

export function planCustomerPayment({
  customer, openReceivables = [], amountCents, method = PAYMENT.cash,
  reference = '', observation = '', cashSession, newId, now,
}) {
  if (!customer) fault('Seleccione el cliente que realiza el pago.');
  if (!SETTLED_METHODS.includes(method)) fault('La forma de pago no es válida.');
  const monto = requirePositive(amountCents, 'El monto del pago');
  const saldo = Number(customer.saldoActualCents) || 0;
  if (saldo <= 0) fault(`${customer.nombre} no tiene saldo pendiente.`);
  if (monto > saldo) fault(`El pago supera el saldo pendiente de ${money(saldo)}.`);

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  cash.require();

  const paymentId = newId(COL.customerPayments);
  const { applications } = applyFifo(plan, COL.receivables, openReceivables, monto, now);

  plan.set(COL.customerPayments, paymentId, {
    clienteId: customer.id,
    clienteNombre: customer.nombre,
    montoCents: monto,
    metodo: method,
    referencia: reference,
    observacion: observation,
    aplicaciones: applications,
    saldoAnteriorCents: saldo,
    saldoPosteriorCents: saldo - monto,
    fecha: now,
    estado: 'ACTIVO',
  });
  plan.add(COL.receivables, {
    clienteId: customer.id,
    clienteNombre: customer.nombre,
    pagoId: paymentId,
    tipo: 'PAGO',
    concepto: 'Pago recibido',
    cargoCents: 0,
    abonoCents: monto,
    saldoCents: -monto,
    fecha: now,
    fechaVencimiento: null,
    estado: 'APLICADA',
  });
  plan.update(COL.customers, customer.id, {
    saldoActualCents: saldo - monto,
    totalPagadoCents: (Number(customer.totalPagadoCents) || 0) + monto,
  });
  cash.record({
    tipo: CASH_MOVE.customerPayment,
    metodo: method,
    montoCents: monto,
    referenciaId: paymentId,
    referenciaTipo: 'PAGO_CLIENTE',
    descripcion: `Pago de ${customer.nombre}`,
  });
  cash.flush();
  plan.audit('PAGO_CLIENTE', 'CUENTAS_POR_COBRAR', paymentId, { clienteId: customer.id, montoCents: monto });

  return { writes: plan.writes, result: { id: paymentId, montoCents: monto, saldoCents: saldo - monto } };
}

/**
 * Records a debt that did not come from a sale or a purchase: an opening
 * balance, or an agreement made outside the system. It only moves the account,
 * never the cash drawer, because no money changed hands.
 */
export function planManualAccount({
  kind, owner, amountCents, concept, dueDate = null, observation = '', newId, now,
}) {
  const receivable = kind === 'cobrar';
  if (!owner) fault(receivable ? 'Seleccione el cliente.' : 'Seleccione el proveedor.');
  const monto = requirePositive(amountCents, 'El monto de la cuenta');
  const concepto = String(concept || '').trim();
  if (!concepto) fault('Escriba el concepto de la cuenta.');

  const plan = createPlan({ newId, now });
  const collection = receivable ? COL.receivables : COL.payables;
  const ownerCollection = receivable ? COL.customers : COL.suppliers;
  const saldo = Number(owner.saldoActualCents) || 0;

  if (receivable) {
    const limite = Number(owner.limiteCreditoCents) || 0;
    if (limite > 0 && saldo + monto > limite) {
      fault(`La cuenta supera el límite de crédito de ${money(limite)} de ${owner.nombre}.`);
    }
  }

  const accountId = newId(collection);
  plan.set(collection, accountId, {
    [receivable ? 'clienteId' : 'proveedorId']: owner.id,
    [receivable ? 'clienteNombre' : 'proveedorNombre']: owner.nombre,
    tipo: 'CARGO_MANUAL',
    concepto,
    observacion: observation,
    cargoCents: monto,
    abonoCents: 0,
    saldoCents: monto,
    fecha: now,
    fechaVencimiento: dueDate,
    estado: STATUS.pending,
  });
  plan.update(ownerCollection, owner.id, {
    saldoActualCents: saldo + monto,
    ...(receivable ? { totalCompradoCents: (Number(owner.totalCompradoCents) || 0) + monto } : {}),
  });
  plan.audit(
    receivable ? 'CUENTA_POR_COBRAR_MANUAL' : 'CUENTA_POR_PAGAR_MANUAL',
    receivable ? 'CUENTAS_POR_COBRAR' : 'CUENTAS_POR_PAGAR',
    accountId,
    { ownerId: owner.id, montoCents: monto, concepto },
  );

  return { writes: plan.writes, result: { id: accountId, saldoCents: saldo + monto } };
}

export function planSupplierPayment({
  supplier, openPayables = [], amountCents, method = PAYMENT.cash,
  reference = '', observation = '', cashSession, newId, now,
}) {
  if (!supplier) fault('Seleccione el proveedor.');
  if (!SETTLED_METHODS.includes(method)) fault('La forma de pago no es válida.');
  const monto = requirePositive(amountCents, 'El monto del pago');
  const saldo = Number(supplier.saldoActualCents) || 0;
  if (saldo <= 0) fault(`${supplier.nombre} no tiene saldo pendiente.`);
  if (monto > saldo) fault(`El pago supera el saldo pendiente de ${money(saldo)}.`);

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  cash.require();

  const paymentId = newId(COL.supplierPayments);
  const { applications } = applyFifo(plan, COL.payables, openPayables, monto, now);

  plan.set(COL.supplierPayments, paymentId, {
    proveedorId: supplier.id,
    proveedorNombre: supplier.nombre,
    montoCents: monto,
    metodo: method,
    referencia: reference,
    observacion: observation,
    aplicaciones: applications,
    saldoAnteriorCents: saldo,
    saldoPosteriorCents: saldo - monto,
    fecha: now,
    estado: 'ACTIVO',
  });
  plan.add(COL.payables, {
    proveedorId: supplier.id,
    proveedorNombre: supplier.nombre,
    pagoId: paymentId,
    tipo: 'PAGO',
    concepto: 'Pago realizado',
    cargoCents: 0,
    abonoCents: monto,
    saldoCents: -monto,
    fecha: now,
    fechaVencimiento: null,
    estado: 'APLICADA',
  });
  plan.update(COL.suppliers, supplier.id, {
    saldoActualCents: saldo - monto,
    totalPagadoCents: (Number(supplier.totalPagadoCents) || 0) + monto,
  });
  cash.record({
    tipo: CASH_MOVE.supplierPayment,
    metodo: method,
    montoCents: -monto,
    referenciaId: paymentId,
    referenciaTipo: 'PAGO_PROVEEDOR',
    descripcion: `Pago a ${supplier.nombre}`,
  });
  cash.flush();
  plan.audit('PAGO_PROVEEDOR', 'CUENTAS_POR_PAGAR', paymentId, { proveedorId: supplier.id, montoCents: monto });

  return { writes: plan.writes, result: { id: paymentId, montoCents: monto, saldoCents: saldo - monto } };
}

export function planExpense({
  category, description, amountCents, method = PAYMENT.cash, partner = null,
  observation = '', cashSession, newId, now,
}) {
  if (!category) fault('Seleccione la categoría del gasto.');
  if (!description) fault('Describa el gasto.');
  if (!SETTLED_METHODS.includes(method)) fault('La forma de pago del gasto no es válida.');
  const monto = requirePositive(amountCents, 'El monto del gasto');

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  cash.require();

  const expenseId = plan.add(COL.expenses, {
    categoria: category,
    descripcion: description,
    montoCents: monto,
    metodoPago: method,
    socioId: partner?.id || null,
    socioNombre: partner?.nombre || 'GENERAL',
    observacion: observation,
    fecha: now,
    estado: 'ACTIVO',
  });
  cash.record({
    tipo: CASH_MOVE.expense,
    metodo: method,
    montoCents: -monto,
    referenciaId: expenseId,
    referenciaTipo: 'GASTO',
    descripcion: description,
  });
  cash.flush();
  plan.audit('GASTO_REGISTRADO', 'GASTOS', expenseId, { montoCents: monto, socioId: partner?.id || null });

  return { writes: plan.writes, result: { id: expenseId, montoCents: monto } };
}

export function planWaste({ product, quantityBaseMilli, reason, observation = '', newId, now }) {
  if (!product) fault('Seleccione el producto.');
  if (!reason) fault('Indique el motivo de la merma.');
  const quantity = requirePositive(quantityBaseMilli, 'La cantidad');
  const stock = Number(product.stockBaseMilli) || 0;
  if (stock < quantity) fault(`Existencia insuficiente de ${product.nombre} para registrar la merma.`);

  const plan = createPlan({ newId, now });
  const unitCost = Number(product.costoPromedioCents) || 0;
  const perdidaCents = scale(quantity, unitCost);
  const nextStock = stock - quantity;
  const wasteId = newId(COL.waste);

  plan.set(COL.waste, wasteId, {
    productoId: product.id,
    productoNombre: product.nombre,
    socioId: product.socioId,
    categoriaId: product.categoriaId || null,
    cantidadBaseMilli: quantity,
    unidadNombre: product.unidadBaseNombre || '',
    costoUnitarioCents: unitCost,
    costoPerdidaCents: perdidaCents,
    motivo: reason,
    observacion: observation,
    fecha: now,
    estado: STATUS.active,
  });
  plan.update(COL.products, product.id, { stockBaseMilli: nextStock });
  plan.movement({
    productoId: product.id,
    productoNombre: product.nombre,
    socioId: product.socioId,
    tipoMovimiento: MOVEMENT.waste,
    cantidadBaseMilli: -quantity,
    unidadNombre: product.unidadBaseNombre || '',
    costoUnitarioCents: unitCost,
    costoTotalCents: -perdidaCents,
    existenciaResultanteBaseMilli: nextStock,
    referenciaId: wasteId,
    referenciaTipo: 'MERMA',
    observacion: reason,
  });
  plan.audit('MERMA_REGISTRADA', 'MERMAS', wasteId, {
    productoId: product.id, cantidadBaseMilli: quantity, costoPerdidaCents: perdidaCents,
  });

  return { writes: plan.writes, result: { id: wasteId, costoPerdidaCents: perdidaCents } };
}

export function planInventoryAdjustment({
  product, type, quantityBaseMilli, unitCostCents = null, reason, observation = '', newId, now,
}) {
  if (!product) fault('Seleccione el producto.');
  if (!reason) fault('Indique el motivo del ajuste.');
  const allowed = [MOVEMENT.adjustIn, MOVEMENT.adjustOut, MOVEMENT.initial];
  if (!allowed.includes(type)) fault('El tipo de ajuste no es válido.');
  const quantity = requirePositive(quantityBaseMilli, 'La cantidad');

  const stock = Number(product.stockBaseMilli) || 0;
  const isIncrease = type !== MOVEMENT.adjustOut;
  if (!isIncrease && stock < quantity) {
    fault(`Existencia insuficiente de ${product.nombre} para el ajuste negativo.`);
  }
  if (isIncrease && unitCostCents !== null) requireNonNegative(unitCostCents, 'El costo');

  const plan = createPlan({ newId, now });
  const currentCost = Number(product.costoPromedioCents) || 0;
  const appliedCost = isIncrease ? (unitCostCents ?? currentCost) : currentCost;
  if (isIncrease && !appliedCost) fault('Indique el costo unitario del inventario que ingresa.');

  const nextStock = isIncrease ? stock + quantity : stock - quantity;
  const nextCost = isIncrease ? weightedAverage(stock, currentCost, quantity, appliedCost) : currentCost;
  const valorCents = scale(quantity, appliedCost);
  const adjustmentId = newId(COL.inventory);

  plan.update(COL.products, product.id, { stockBaseMilli: nextStock, costoPromedioCents: nextCost });
  plan.set(COL.inventory, adjustmentId, {
    productoId: product.id,
    productoNombre: product.nombre,
    socioId: product.socioId,
    tipoMovimiento: type,
    cantidadBaseMilli: isIncrease ? quantity : -quantity,
    unidadNombre: product.unidadBaseNombre || '',
    costoUnitarioCents: appliedCost,
    costoTotalCents: isIncrease ? valorCents : -valorCents,
    existenciaResultanteBaseMilli: nextStock,
    costoPromedioResultanteCents: nextCost,
    referenciaId: adjustmentId,
    referenciaTipo: 'AJUSTE',
    observacion: reason,
    detalle: observation,
    fecha: now,
  });
  plan.audit('AJUSTE_INVENTARIO', 'INVENTARIO', adjustmentId, {
    productoId: product.id, tipo: type, cantidadBaseMilli: quantity,
  });

  return { writes: plan.writes, result: { id: adjustmentId, stockBaseMilli: nextStock } };
}

export function planOpenCash({ activeSession, openingCents, observation = '', newId, now }) {
  if (activeSession?.id) fault('Ya existe una caja abierta. Ciérrela antes de abrir otra.');
  const apertura = requireNonNegative(openingCents, 'El fondo inicial');

  const plan = createPlan({ newId, now });
  const cashId = newId(COL.cashRegisters);
  plan.set(COL.cashRegisters, cashId, {
    aperturaCents: apertura,
    efectivoCents: apertura,
    tarjetaCents: 0,
    transferenciaCents: 0,
    ventasCents: 0,
    cobrosCents: 0,
    pagosCents: 0,
    comprasCents: 0,
    gastosCents: 0,
    retirosCents: 0,
    ingresosCents: 0,
    devolucionesCents: 0,
    observacionApertura: observation,
    fechaApertura: now,
    estado: STATUS.open,
  });
  plan.add(COL.cashMoves, {
    cajaId: cashId,
    tipo: CASH_MOVE.opening,
    metodo: PAYMENT.cash,
    montoCents: apertura,
    referenciaId: cashId,
    referenciaTipo: 'CAJA',
    descripcion: 'Apertura de caja',
    fecha: now,
  });
  plan.merge(COL.settings, SETTINGS_DOC.activeCash, { cajaId: cashId, updatedAt: now });
  plan.audit('CAJA_ABIERTA', 'CAJA', cashId, { aperturaCents: apertura });

  return { writes: plan.writes, result: { id: cashId, aperturaCents: apertura } };
}

export function planCloseCash({ session, countedCents, observation = '', newId, now }) {
  if (!session?.id) fault('No hay una caja abierta.');
  if (session.estado !== STATUS.open) fault('La caja ya fue cerrada.');
  const contado = requireNonNegative(countedCents, 'El efectivo contado');
  const esperado = expectedCashCents(session);

  const plan = createPlan({ newId, now });
  plan.update(COL.cashRegisters, session.id, {
    esperadoCents: esperado,
    contadoCents: contado,
    diferenciaCents: contado - esperado,
    observacionCierre: observation,
    fechaCierre: now,
    estado: STATUS.closed,
  });
  plan.merge(COL.settings, SETTINGS_DOC.activeCash, { cajaId: null, updatedAt: now });
  plan.audit('CAJA_CERRADA', 'CAJA', session.id, {
    esperadoCents: esperado, contadoCents: contado, diferenciaCents: contado - esperado,
  });

  return {
    writes: plan.writes,
    result: { id: session.id, esperadoCents: esperado, contadoCents: contado, diferenciaCents: contado - esperado },
  };
}

export function planCashMovement({ session, type, amountCents, description, newId, now }) {
  if (![CASH_MOVE.withdrawal, CASH_MOVE.deposit].includes(type)) fault('El tipo de movimiento no es válido.');
  if (!description) fault('Describa el movimiento de caja.');
  const monto = requirePositive(amountCents, 'El monto');

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, session);
  cash.require();
  if (type === CASH_MOVE.withdrawal && expectedCashCents(session) < monto) {
    fault('El retiro supera el efectivo disponible en caja.');
  }
  cash.record({
    tipo: type,
    metodo: PAYMENT.cash,
    montoCents: type === CASH_MOVE.withdrawal ? -monto : monto,
    referenciaTipo: 'CAJA',
    descripcion: description,
  });
  cash.flush();
  plan.audit(type === CASH_MOVE.withdrawal ? 'RETIRO_CAJA' : 'INGRESO_CAJA', 'CAJA', session.id, {
    montoCents: monto, descripcion: description,
  });

  return { writes: plan.writes, result: { montoCents: monto } };
}

export const totalCashIn = (moves) =>
  sum(moves.filter((move) => (move.montoCents || 0) > 0).map((move) => move.montoCents));
export const totalCashOut = (moves) =>
  sum(moves.filter((move) => (move.montoCents || 0) < 0).map((move) => -move.montoCents));
