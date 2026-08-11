import { CASH_MOVE, COL, MOVEMENT, PAYMENT, SETTLED_METHODS, STATUS } from './constants.js';
import { fault } from './errors.js';
import { cashRecorder, createPlan, takeSerial } from './plan.js';
import { resolveUnit, toBaseMilli } from './units.js';
import { allocate, requireNonNegative, requirePositive, scale, sum, weightedAverage } from '../utils/math.js';

const money = (value) => `Q${((Number(value) || 0) / 100).toFixed(2)}`;
const amount = (value) => `${((Number(value) || 0) / 1000).toFixed(3).replace(/\.?0+$/, '')}`;

/**
 * Turns raw cart lines into priced sale lines. Cost is captured from the
 * product's current weighted average so the sale keeps its historical cost
 * even if the product is re-purchased later at a different price.
 */
export function buildSaleLines({ lines, productsById, partnersById = new Map() }) {
  if (!Array.isArray(lines) || !lines.length) fault('Agregue al menos un producto a la venta.');
  return lines.map((line, index) => {
    const product = productsById.get(line.productId);
    if (!product) fault('Uno de los productos seleccionados ya no existe.');
    if (product.activo === false) fault(`El producto ${product.nombre} está inactivo.`);

    const unit = resolveUnit(product, line.unitId);
    const cantidadMilli = requirePositive(line.quantityMilli, 'La cantidad');
    const cantidadBaseMilli = toBaseMilli(cantidadMilli, unit.factorMilli);
    if (cantidadBaseMilli <= 0) fault(`La cantidad de ${product.nombre} es demasiado pequeña para su unidad.`);

    const precioUnitarioCents = requireNonNegative(
      line.unitPriceCents ?? unit.precioVentaCents ?? product.precioVentaCents ?? 0,
      'El precio',
    );
    if (!precioUnitarioCents) fault(`Defina un precio de venta para ${product.nombre}.`);

    const brutoCents = scale(cantidadMilli, precioUnitarioCents);
    const descuentoCents = requireNonNegative(line.discountCents || 0, 'El descuento');
    if (descuentoCents > brutoCents) fault(`El descuento de ${product.nombre} supera el importe de la línea.`);

    const costoUnitarioCents = Number(product.costoPromedioCents) || 0;
    const costoCents = scale(cantidadBaseMilli, costoUnitarioCents);
    const subtotalCents = brutoCents - descuentoCents;

    return {
      lineId: `L${index + 1}`,
      productoId: product.id,
      productoNombre: product.nombre,
      socioId: product.socioId,
      socioNombre: partnersById.get(product.socioId)?.nombre || product.socioNombre || '',
      categoriaId: product.categoriaId || null,
      unidadId: unit.id,
      unidadNombre: unit.nombre,
      factorMilli: unit.factorMilli,
      cantidadMilli,
      cantidadBaseMilli,
      unidadBaseNombre: product.unidadBaseNombre || '',
      unitPriceCents: precioUnitarioCents,
      descuentoCents,
      subtotalCents,
      unitCostCents: costoUnitarioCents,
      costCents: costoCents,
      profitCents: subtotalCents - costoCents,
      returnedBaseMilli: 0,
    };
  });
}

/** Rejects a sale that would leave negative stock, adding up repeated lines. */
export function assertStock(lines, productsById) {
  const required = new Map();
  for (const line of lines) {
    required.set(line.productoId, (required.get(line.productoId) || 0) + line.cantidadBaseMilli);
  }
  for (const [productId, quantity] of required) {
    const product = productsById.get(productId);
    const available = Number(product.stockBaseMilli) || 0;
    if (product.permiteInventarioNegativo === true) continue;
    if (available < quantity) {
      fault(`Existencia insuficiente de ${product.nombre}: disponible ${amount(available)} ${product.unidadBaseNombre || ''}.`);
    }
  }
}

/** Validates the payment mix and returns the credit, settled and change parts. */
export function resolvePayments({ payments, totalCents }) {
  if (!Array.isArray(payments) || !payments.length) fault('Registre al menos una forma de pago.');
  const normalized = payments.map((payment) => {
    if (!SETTLED_METHODS.includes(payment.method) && payment.method !== PAYMENT.credit) {
      fault('El método de pago seleccionado no es válido.');
    }
    return {
      metodo: payment.method,
      montoCents: requirePositive(payment.amountCents, 'El monto del pago'),
      referencia: payment.reference || '',
      fechaVencimiento: payment.method === PAYMENT.credit ? (payment.dueDate || null) : null,
    };
  });

  const creditoCents = sum(normalized.filter((item) => item.metodo === PAYMENT.credit).map((item) => item.montoCents));
  const recibidoCents = sum(normalized.filter((item) => item.metodo !== PAYMENT.credit).map((item) => item.montoCents));
  if (creditoCents > totalCents) fault('El crédito no puede superar el total de la venta.');

  const porCobrarCents = totalCents - creditoCents;
  if (recibidoCents < porCobrarCents) {
    fault(`El pago recibido (${money(recibidoCents)}) no cubre ${money(porCobrarCents)}.`);
  }
  const cambioCents = recibidoCents - porCobrarCents;
  if (cambioCents > 0 && !normalized.some((item) => item.metodo === PAYMENT.cash)) {
    fault('Solo puede entregarse cambio cuando parte del pago es en efectivo.');
  }
  return { pagos: normalized, creditoCents, recibidoCents, cambioCents };
}

/** Sales, cost and gross profit split per partner, adding up to the sale total. */
export function partnerBreakdown(lines, netByLine) {
  const grouped = new Map();
  lines.forEach((line, index) => {
    const current = grouped.get(line.socioId) || {
      socioId: line.socioId, socioNombre: line.socioNombre, ventasCents: 0, costoCents: 0, gananciaBrutaCents: 0,
    };
    current.ventasCents += netByLine[index];
    current.costoCents += line.costCents;
    current.gananciaBrutaCents = current.ventasCents - current.costoCents;
    grouped.set(line.socioId, current);
  });
  return [...grouped.values()];
}

export function planSale({
  customer, productsById, partnersById, lines, payments,
  discountCents = 0, observation = '', cashSession, counters, prefix = 'V',
  newId, now,
}) {
  if (!cashSession?.id) fault('Debe abrir la caja antes de registrar una venta.');
  if (!customer) fault('Seleccione un cliente para la venta.');
  if (customer.activo === false) fault('El cliente seleccionado está inactivo.');

  const saleLines = buildSaleLines({ lines, productsById, partnersById });
  assertStock(saleLines, productsById);

  const subtotalCents = sum(saleLines.map((line) => line.subtotalCents));
  const descuentoGeneralCents = requireNonNegative(discountCents, 'El descuento');
  if (descuentoGeneralCents > subtotalCents) fault('El descuento general supera el subtotal de la venta.');
  const totalCents = subtotalCents - descuentoGeneralCents;
  if (totalCents <= 0) fault('El total de la venta debe ser mayor que cero.');

  const { pagos, creditoCents, recibidoCents, cambioCents } = resolvePayments({ payments, totalCents });
  const saldoDisponible = (Number(customer.limiteCreditoCents) || 0) - (Number(customer.saldoActualCents) || 0);
  if (creditoCents > 0 && creditoCents > saldoDisponible) {
    fault(`${customer.nombre} solo tiene ${money(Math.max(0, saldoDisponible))} de crédito disponible.`);
  }

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  const cajaId = cash.require();

  const discountShare = allocate(descuentoGeneralCents, saleLines.map((line) => line.subtotalCents));
  const netByLine = saleLines.map((line, index) => line.subtotalCents - discountShare[index]);
  const costoVentaCents = sum(saleLines.map((line) => line.costCents));

  const numero = takeSerial(plan, counters, 'ventas', prefix);
  const saleId = newId(COL.sales);

  const storedLines = saleLines.map((line, index) => ({
    ...line,
    descuentoGeneralCents: discountShare[index],
    subtotalNetoCents: netByLine[index],
    profitCents: netByLine[index] - line.costCents,
  }));

  plan.set(COL.sales, saleId, {
    numero,
    clienteId: customer.id,
    clienteNombre: customer.nombre,
    lineas: storedLines,
    distribucionSocios: partnerBreakdown(saleLines, netByLine),
    subtotalCents,
    descuentoCents: descuentoGeneralCents,
    totalCents,
    pagos,
    recibidoCents,
    cambioCents,
    creditoCents,
    costoVentaCents,
    gananciaBrutaCents: totalCents - costoVentaCents,
    montoDevueltoCents: 0,
    costoDevueltoCents: 0,
    cajaId,
    fecha: now,
    estado: STATUS.active,
    observacion: observation,
  });

  const stockByProduct = new Map();
  for (const line of saleLines) {
    const product = productsById.get(line.productoId);
    const current = stockByProduct.has(line.productoId)
      ? stockByProduct.get(line.productoId)
      : Number(product.stockBaseMilli) || 0;
    const updated = current - line.cantidadBaseMilli;
    stockByProduct.set(line.productoId, updated);
    plan.movement({
      productoId: line.productoId,
      productoNombre: line.productoNombre,
      socioId: line.socioId,
      tipoMovimiento: MOVEMENT.sale,
      cantidadBaseMilli: -line.cantidadBaseMilli,
      unidadId: line.unidadId,
      unidadNombre: line.unidadNombre,
      cantidadMilli: -line.cantidadMilli,
      costoUnitarioCents: line.unitCostCents,
      costoTotalCents: -line.costCents,
      existenciaResultanteBaseMilli: updated,
      referenciaId: saleId,
      referenciaTipo: 'VENTA',
      referenciaNumero: numero,
      observacion: observation,
    });
  }
  for (const [productId, stock] of stockByProduct) {
    plan.update(COL.products, productId, { stockBaseMilli: stock, ultimaVentaFecha: now });
  }

  for (const payment of pagos.filter((item) => item.metodo !== PAYMENT.credit)) {
    cash.record({
      tipo: CASH_MOVE.sale,
      metodo: payment.metodo,
      montoCents: payment.montoCents,
      referenciaId: saleId,
      referenciaTipo: 'VENTA',
      descripcion: `Venta ${numero}`,
    });
  }
  if (cambioCents > 0) {
    cash.record({
      tipo: CASH_MOVE.sale,
      metodo: PAYMENT.cash,
      montoCents: -cambioCents,
      referenciaId: saleId,
      referenciaTipo: 'VENTA',
      descripcion: `Cambio venta ${numero}`,
    });
  }
  cash.flush();

  if (creditoCents > 0) {
    const vencimiento = pagos.find((item) => item.metodo === PAYMENT.credit)?.fechaVencimiento || null;
    plan.add(COL.receivables, {
      ventaId: saleId,
      ventaNumero: numero,
      clienteId: customer.id,
      clienteNombre: customer.nombre,
      tipo: 'VENTA_CREDITO',
      concepto: `Venta ${numero}`,
      cargoCents: creditoCents,
      abonoCents: 0,
      saldoCents: creditoCents,
      fecha: now,
      fechaVencimiento: vencimiento,
      estado: STATUS.pending,
    });
    plan.update(COL.customers, customer.id, {
      saldoActualCents: (Number(customer.saldoActualCents) || 0) + creditoCents,
      totalCompradoCents: (Number(customer.totalCompradoCents) || 0) + totalCents,
    });
  } else {
    plan.update(COL.customers, customer.id, {
      totalCompradoCents: (Number(customer.totalCompradoCents) || 0) + totalCents,
    });
  }

  plan.audit('VENTA_REGISTRADA', 'VENTAS', saleId, {
    numero, totalCents, costoVentaCents, creditoCents,
  });

  return { writes: plan.writes, result: { id: saleId, numero, totalCents, cambioCents, creditoCents } };
}

export function planSaleReturn({
  sale, customer, productsById, requestedLines, reason, resolution = PAYMENT.cash,
  observation = '', cashSession, counters, prefix = 'D', newId, now,
}) {
  if (!sale) fault('La venta indicada no existe.');
  if (sale.estado === STATUS.cancelled) fault('No se puede devolver una venta anulada.');
  if (!Array.isArray(requestedLines) || !requestedLines.length) fault('Seleccione al menos una línea a devolver.');
  if (!reason) fault('Indique el motivo de la devolución.');

  const saleLines = Array.isArray(sale.lineas) ? sale.lineas : [];
  const selected = requestedLines.map((request) => {
    const line = saleLines.find((item) => item.lineId === request.lineId);
    if (!line) fault('La línea seleccionada no pertenece a esta venta.');
    const quantity = requirePositive(request.quantityBaseMilli, 'La cantidad a devolver');
    const alreadyReturned = Number(line.returnedBaseMilli) || 0;
    if (alreadyReturned + quantity > line.cantidadBaseMilli) {
      fault(`No puede devolver más de lo vendido de ${line.productoNombre}.`);
    }
    const netCents = Number(line.subtotalNetoCents ?? line.subtotalCents) || 0;
    return {
      line,
      quantity,
      refundCents: Math.round((netCents * quantity) / line.cantidadBaseMilli),
      costCents: Math.round(((Number(line.costCents) || 0) * quantity) / line.cantidadBaseMilli),
    };
  });

  const montoCents = sum(selected.map((item) => item.refundCents));
  const costoCents = sum(selected.map((item) => item.costCents));
  if (montoCents <= 0) fault('El importe de la devolución debe ser mayor que cero.');

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  const isCreditAdjustment = resolution === PAYMENT.credit;

  if (isCreditAdjustment) {
    if (!customer) fault('No se encontró el cliente de la venta.');
    if ((Number(customer.saldoActualCents) || 0) < montoCents) {
      fault('El saldo del cliente es menor que la devolución. Devuelva en efectivo.');
    }
  } else {
    cash.require();
  }

  const numero = takeSerial(plan, counters, 'devoluciones', prefix);
  const returnId = newId(COL.returns);

  for (const item of selected) {
    const product = productsById.get(item.line.productoId);
    if (!product) fault('El producto de la línea ya no existe.');
    const stock = (Number(product.stockBaseMilli) || 0) + item.quantity;
    const unitCost = Number(item.line.unitCostCents) || 0;
    plan.update(COL.products, item.line.productoId, {
      stockBaseMilli: stock,
      costoPromedioCents: weightedAverage(
        Number(product.stockBaseMilli) || 0,
        Number(product.costoPromedioCents) || 0,
        item.quantity,
        unitCost,
      ),
    });
    plan.movement({
      productoId: item.line.productoId,
      productoNombre: item.line.productoNombre,
      socioId: item.line.socioId,
      tipoMovimiento: MOVEMENT.saleReturn,
      cantidadBaseMilli: item.quantity,
      unidadId: item.line.unidadId,
      unidadNombre: item.line.unidadNombre,
      costoUnitarioCents: unitCost,
      costoTotalCents: item.costCents,
      existenciaResultanteBaseMilli: stock,
      referenciaId: returnId,
      referenciaTipo: 'DEVOLUCION',
      referenciaNumero: numero,
      observacion: reason,
    });
  }

  const updatedLines = saleLines.map((line) => {
    const item = selected.find((entry) => entry.line.lineId === line.lineId);
    return item ? { ...line, returnedBaseMilli: (Number(line.returnedBaseMilli) || 0) + item.quantity } : line;
  });
  const fullyReturned = updatedLines.every((line) => (Number(line.returnedBaseMilli) || 0) >= line.cantidadBaseMilli);

  plan.update(COL.sales, sale.id, {
    lineas: updatedLines,
    montoDevueltoCents: (Number(sale.montoDevueltoCents) || 0) + montoCents,
    costoDevueltoCents: (Number(sale.costoDevueltoCents) || 0) + costoCents,
    estado: fullyReturned ? 'DEVUELTA' : sale.estado,
  });

  plan.set(COL.returns, returnId, {
    numero,
    ventaId: sale.id,
    ventaNumero: sale.numero,
    clienteId: sale.clienteId,
    clienteNombre: sale.clienteNombre,
    lineas: selected.map((item) => ({
      lineId: item.line.lineId,
      productoId: item.line.productoId,
      productoNombre: item.line.productoNombre,
      socioId: item.line.socioId,
      cantidadBaseMilli: item.quantity,
      unidadNombre: item.line.unidadNombre,
      montoCents: item.refundCents,
      costoCents: item.costCents,
    })),
    montoCents,
    costoCents,
    motivo: reason,
    resolucion: isCreditAdjustment ? PAYMENT.credit : PAYMENT.cash,
    observacion: observation,
    fecha: now,
    estado: STATUS.active,
  });

  if (isCreditAdjustment) {
    plan.update(COL.customers, customer.id, {
      saldoActualCents: (Number(customer.saldoActualCents) || 0) - montoCents,
    });
    plan.add(COL.receivables, {
      clienteId: customer.id,
      clienteNombre: customer.nombre,
      ventaId: sale.id,
      devolucionId: returnId,
      tipo: 'DEVOLUCION',
      concepto: `Devolución ${numero}`,
      cargoCents: 0,
      abonoCents: montoCents,
      saldoCents: -montoCents,
      fecha: now,
      fechaVencimiento: null,
      estado: 'APLICADA',
    });
  } else {
    cash.record({
      tipo: CASH_MOVE.saleReturn,
      metodo: PAYMENT.cash,
      montoCents: -montoCents,
      referenciaId: returnId,
      referenciaTipo: 'DEVOLUCION',
      descripcion: `Devolución ${numero}`,
    });
    cash.flush();
  }

  plan.audit('DEVOLUCION_VENTA', 'DEVOLUCIONES', returnId, { numero, ventaId: sale.id, montoCents });

  return { writes: plan.writes, result: { id: returnId, numero, montoCents } };
}

export function planSaleCancellation({ sale, customer, productsById, reason, cashSession, newId, now }) {
  if (!sale) fault('La venta indicada no existe.');
  if (sale.estado === STATUS.cancelled) fault('La venta ya fue anulada.');
  if (!reason) fault('Indique el motivo de la anulación.');

  const plan = createPlan({ newId, now });
  const cash = cashRecorder(plan, cashSession);
  const lines = Array.isArray(sale.lineas) ? sale.lineas : [];
  const pendingLines = lines.filter((line) => (Number(line.returnedBaseMilli) || 0) < line.cantidadBaseMilli);

  for (const line of pendingLines) {
    const product = productsById.get(line.productoId);
    if (!product) fault('Un producto de la venta ya no existe.');
    const quantity = line.cantidadBaseMilli - (Number(line.returnedBaseMilli) || 0);
    const stock = (Number(product.stockBaseMilli) || 0) + quantity;
    plan.update(COL.products, line.productoId, { stockBaseMilli: stock });
    plan.movement({
      productoId: line.productoId,
      productoNombre: line.productoNombre,
      socioId: line.socioId,
      tipoMovimiento: MOVEMENT.saleReturn,
      cantidadBaseMilli: quantity,
      unidadId: line.unidadId,
      unidadNombre: line.unidadNombre,
      costoUnitarioCents: line.unitCostCents,
      costoTotalCents: scale(quantity, line.unitCostCents),
      existenciaResultanteBaseMilli: stock,
      referenciaId: sale.id,
      referenciaTipo: 'ANULACION',
      referenciaNumero: sale.numero,
      observacion: reason,
    });
  }

  const creditoCents = Number(sale.creditoCents) || 0;
  if (creditoCents > 0 && customer) {
    plan.update(COL.customers, customer.id, {
      saldoActualCents: Math.max(0, (Number(customer.saldoActualCents) || 0) - creditoCents),
    });
    plan.add(COL.receivables, {
      clienteId: customer.id,
      clienteNombre: customer.nombre,
      ventaId: sale.id,
      tipo: 'ANULACION',
      concepto: `Anulación venta ${sale.numero}`,
      cargoCents: 0,
      abonoCents: creditoCents,
      saldoCents: -creditoCents,
      fecha: now,
      fechaVencimiento: null,
      estado: 'APLICADA',
    });
  }

  const efectivoCents = sum((sale.pagos || [])
    .filter((payment) => payment.metodo === PAYMENT.cash)
    .map((payment) => payment.montoCents)) - (Number(sale.cambioCents) || 0);
  if (efectivoCents > 0 && cashSession?.id) {
    cash.record({
      tipo: CASH_MOVE.saleReturn,
      metodo: PAYMENT.cash,
      montoCents: -efectivoCents,
      referenciaId: sale.id,
      referenciaTipo: 'ANULACION',
      descripcion: `Anulación venta ${sale.numero}`,
    });
    cash.flush();
  }

  plan.update(COL.sales, sale.id, {
    estado: STATUS.cancelled,
    motivoAnulacion: reason,
    fechaAnulacion: now,
  });
  plan.audit('VENTA_ANULADA', 'VENTAS', sale.id, { numero: sale.numero, reason });

  return { writes: plan.writes, result: { id: sale.id, numero: sale.numero } };
}
