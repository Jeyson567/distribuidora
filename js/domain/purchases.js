import { CASH_MOVE, COL, MOVEMENT, PAYMENT, SETTLED_METHODS, STATUS } from './constants.js';
import { fault } from './errors.js';
import { cashRecorder, createPlan, takeSerial } from './plan.js';
import { resolveUnit, toBaseMilli } from './units.js';
import { allocate, requireNonNegative, requirePositive, scale, sum, weightedAverage } from '../utils/math.js';

export function buildPurchaseLines({ lines, productsById }) {
  if (!Array.isArray(lines) || !lines.length) fault('Agregue al menos un producto a la compra.');
  return lines.map((line) => {
    const product = productsById.get(line.productId);
    if (!product) fault('Uno de los productos de la compra ya no existe.');
    if (product.activo === false) fault(`El producto ${product.nombre} está inactivo.`);

    const unit = resolveUnit(product, line.unitId);
    const cantidadMilli = requirePositive(line.quantityMilli, 'La cantidad');
    const cantidadBaseMilli = toBaseMilli(cantidadMilli, unit.factorMilli);
    if (cantidadBaseMilli <= 0) fault(`La cantidad de ${product.nombre} es demasiado pequeña para su unidad.`);

    const costoUnitarioCents = requireNonNegative(line.unitCostCents, 'El costo');
    if (!costoUnitarioCents) fault(`Indique el costo de ${product.nombre}.`);
    const brutoCents = scale(cantidadMilli, costoUnitarioCents);
    const descuentoCents = requireNonNegative(line.discountCents || 0, 'El descuento');
    if (descuentoCents > brutoCents) fault(`El descuento de ${product.nombre} supera el importe de la línea.`);

    return {
      productoId: product.id,
      productoNombre: product.nombre,
      socioId: product.socioId,
      unidadId: unit.id,
      unidadNombre: unit.nombre,
      factorMilli: unit.factorMilli,
      cantidadMilli,
      cantidadBaseMilli,
      unitCostCents: costoUnitarioCents,
      descuentoCents,
      subtotalCents: brutoCents - descuentoCents,
    };
  });
}

export function planPurchase({
  supplier, productsById, lines, paymentMethod = 'CONTADO', settlementMethod = PAYMENT.cash,
  dueDate = null, discountCents = 0, observation = '', cashSession, counters, prefix = 'C',
  newId, now,
}) {
  if (supplier?.activo === false) fault('El proveedor seleccionado está inactivo.');
  if (!['CONTADO', 'CREDITO'].includes(paymentMethod)) fault('El método de compra no es válido.');
  if (paymentMethod === 'CREDITO' && !supplier) {
    fault('Las compras a crédito necesitan un proveedor con saldo. Use contado o elija un proveedor existente.');
  }
  if (paymentMethod === 'CONTADO' && !SETTLED_METHODS.includes(settlementMethod)) {
    fault('La forma de pago de la compra no es válida.');
  }
  if (paymentMethod === 'CONTADO' && !cashSession?.id) {
    fault('Debe abrir la caja antes de registrar una compra de contado.');
  }

  const purchaseLines = buildPurchaseLines({ lines, productsById });
  const subtotalCents = sum(purchaseLines.map((line) => line.subtotalCents));
  const descuentoGeneralCents = requireNonNegative(discountCents, 'El descuento');
  if (descuentoGeneralCents > subtotalCents) fault('El descuento general supera el subtotal de la compra.');
  const totalCents = subtotalCents - descuentoGeneralCents;
  if (totalCents <= 0) fault('El total de la compra debe ser mayor que cero.');

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  if (paymentMethod === 'CONTADO') cash.require();

  const discountShare = allocate(descuentoGeneralCents, purchaseLines.map((line) => line.subtotalCents));
  const numero = takeSerial(plan, counters, 'compras', prefix);
  const purchaseId = newId(COL.purchases);

  // Running stock/cost per product so repeated lines chain their averages.
  const running = new Map();
  const storedLines = purchaseLines.map((line, index) => {
    const netoCents = line.subtotalCents - discountShare[index];
    const costoBaseCents = Math.round((netoCents * 1000) / line.cantidadBaseMilli);
    const product = productsById.get(line.productoId);
    const current = running.get(line.productoId) || {
      stock: Number(product.stockBaseMilli) || 0,
      cost: Number(product.costoPromedioCents) || 0,
    };
    const nextCost = weightedAverage(current.stock, current.cost, line.cantidadBaseMilli, costoBaseCents);
    const nextStock = current.stock + line.cantidadBaseMilli;
    running.set(line.productoId, { stock: nextStock, cost: nextCost });

    plan.movement({
      productoId: line.productoId,
      productoNombre: line.productoNombre,
      socioId: line.socioId,
      tipoMovimiento: MOVEMENT.purchase,
      cantidadBaseMilli: line.cantidadBaseMilli,
      cantidadMilli: line.cantidadMilli,
      unidadId: line.unidadId,
      unidadNombre: line.unidadNombre,
      costoUnitarioCents: costoBaseCents,
      costoTotalCents: netoCents,
      existenciaResultanteBaseMilli: nextStock,
      costoPromedioResultanteCents: nextCost,
      referenciaId: purchaseId,
      referenciaTipo: 'COMPRA',
      referenciaNumero: numero,
      observacion: observation,
    });

    return {
      ...line,
      descuentoGeneralCents: discountShare[index],
      subtotalNetoCents: netoCents,
      costoBaseCents,
      costoPromedioResultanteCents: nextCost,
    };
  });

  for (const [productId, value] of running) {
    plan.update(COL.products, productId, {
      stockBaseMilli: value.stock,
      costoPromedioCents: value.cost,
      costoActualCents: storedLines.filter((line) => line.productoId === productId).at(-1).costoBaseCents,
      ultimaCompraFecha: now,
    });
  }

  plan.set(COL.purchases, purchaseId, {
    numero,
    proveedorId: supplier?.id || null,
    proveedorNombre: supplier?.nombre || 'Sin proveedor',
    lineas: storedLines,
    subtotalCents,
    descuentoCents: descuentoGeneralCents,
    totalCents,
    metodoPago: paymentMethod,
    formaPago: paymentMethod === 'CONTADO' ? settlementMethod : PAYMENT.credit,
    fecha: now,
    fechaVencimiento: paymentMethod === 'CREDITO' ? dueDate : null,
    estado: STATUS.active,
    observacion: observation,
    cajaId: cashSession?.id || null,
  });

  if (paymentMethod === 'CREDITO') {
    plan.add(COL.payables, {
      compraId: purchaseId,
      compraNumero: numero,
      proveedorId: supplier.id,
      proveedorNombre: supplier.nombre,
      tipo: 'COMPRA_CREDITO',
      concepto: `Compra ${numero}`,
      cargoCents: totalCents,
      abonoCents: 0,
      saldoCents: totalCents,
      fecha: now,
      fechaVencimiento: dueDate,
      estado: STATUS.pending,
    });
    plan.update(COL.suppliers, supplier.id, {
      saldoActualCents: (Number(supplier.saldoActualCents) || 0) + totalCents,
      totalCompradoCents: (Number(supplier.totalCompradoCents) || 0) + totalCents,
    });
  } else {
    cash.record({
      tipo: CASH_MOVE.purchase,
      metodo: settlementMethod,
      montoCents: -totalCents,
      referenciaId: purchaseId,
      referenciaTipo: 'COMPRA',
      descripcion: `Compra ${numero}`,
    });
    cash.flush();
    if (supplier) {
      plan.update(COL.suppliers, supplier.id, {
        totalCompradoCents: (Number(supplier.totalCompradoCents) || 0) + totalCents,
      });
    }
  }

  plan.audit('COMPRA_REGISTRADA', 'COMPRAS', purchaseId, { numero, totalCents, metodoPago: paymentMethod });

  return { writes: plan.writes, result: { id: purchaseId, numero, totalCents } };
}

export function planSupplierReturn({
  supplier, product, quantityBaseMilli, reason, observation = '',
  cashSession, newId, now,
}) {
  if (!supplier) fault('Seleccione el proveedor de la devolución.');
  if (!product) fault('Seleccione el producto a devolver.');
  if (!reason) fault('Indique el motivo de la devolución.');
  const quantity = requirePositive(quantityBaseMilli, 'La cantidad');
  const stock = Number(product.stockBaseMilli) || 0;
  if (stock < quantity) fault(`Existencia insuficiente de ${product.nombre} para devolver al proveedor.`);

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  const unitCost = Number(product.costoPromedioCents) || 0;
  const montoCents = scale(quantity, unitCost);
  const saldoProveedor = Number(supplier.saldoActualCents) || 0;
  const aplicaSaldo = Math.min(saldoProveedor, montoCents);
  const enEfectivo = montoCents - aplicaSaldo;
  if (enEfectivo > 0) cash.require();

  const returnId = newId(COL.returns);
  const nextStock = stock - quantity;

  plan.update(COL.products, product.id, { stockBaseMilli: nextStock });
  plan.movement({
    productoId: product.id,
    productoNombre: product.nombre,
    socioId: product.socioId,
    tipoMovimiento: MOVEMENT.supplierReturn,
    cantidadBaseMilli: -quantity,
    unidadId: product.unidadBaseId,
    unidadNombre: product.unidadBaseNombre,
    costoUnitarioCents: unitCost,
    costoTotalCents: -montoCents,
    existenciaResultanteBaseMilli: nextStock,
    referenciaId: returnId,
    referenciaTipo: 'DEVOLUCION_PROVEEDOR',
    observacion: reason,
  });
  plan.set(COL.returns, returnId, {
    tipo: 'PROVEEDOR',
    proveedorId: supplier.id,
    proveedorNombre: supplier.nombre,
    productoId: product.id,
    productoNombre: product.nombre,
    socioId: product.socioId,
    cantidadBaseMilli: quantity,
    montoCents,
    costoCents: montoCents,
    motivo: reason,
    observacion: observation,
    fecha: now,
    estado: STATUS.active,
  });

  if (aplicaSaldo > 0) {
    plan.update(COL.suppliers, supplier.id, { saldoActualCents: saldoProveedor - aplicaSaldo });
    plan.add(COL.payables, {
      proveedorId: supplier.id,
      proveedorNombre: supplier.nombre,
      devolucionId: returnId,
      tipo: 'DEVOLUCION',
      concepto: 'Devolución a proveedor',
      cargoCents: 0,
      abonoCents: aplicaSaldo,
      saldoCents: -aplicaSaldo,
      fecha: now,
      fechaVencimiento: null,
      estado: 'APLICADA',
    });
  }
  if (enEfectivo > 0) {
    cash.record({
      tipo: CASH_MOVE.supplierReturn,
      metodo: PAYMENT.cash,
      montoCents: enEfectivo,
      referenciaId: returnId,
      referenciaTipo: 'DEVOLUCION_PROVEEDOR',
      descripcion: `Devolución a ${supplier.nombre}`,
    });
    cash.flush();
  }

  plan.audit('DEVOLUCION_PROVEEDOR', 'COMPRAS', returnId, { montoCents, productoId: product.id });

  return { writes: plan.writes, result: { id: returnId, montoCents } };
}
