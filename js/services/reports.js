/**
 * Pure reporting helpers. Monetary values are integer cents and product
 * quantities are integer thousandths of their base unit (milli).
 *
 * The functions accept plain persisted objects; they intentionally do not
 * query Firebase or depend on Firebase timestamp types.
 */

const integer = (value) => (Number.isSafeInteger(value) ? value : 0);
const positiveInteger = (value) => Math.max(0, integer(value));
const centsFor = (quantityBaseMilli, unitCents) =>
  Math.round((positiveInteger(quantityBaseMilli) * integer(unitCents)) / 1000);
const active = (record) => record?.estado !== 'ANULADA' && record?.estado !== 'CANCELADA' && record?.activo !== false;

const timestampMillis = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isSafeInteger(value?.seconds)) return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  return null;
};

const recordDate = (record) => record?.fecha ?? record?.createdAt ?? record?.updatedAt;
const samePartner = (record, partnerId) => partnerId == null || record?.socioId === partnerId || record?.partnerId === partnerId;
const emptySales = () => ({
  ventasCents: 0,
  costoCents: 0,
  gananciaBrutaCents: 0,
  cantidadVentas: 0,
  cantidadProductosBaseMilli: 0,
});

/**
 * Returns whether a timestamp is inside an inclusive range. Range limits may
 * be Date, ISO date strings, epoch milliseconds, or timestamp-like objects.
 * A missing limit makes that side of the range open.
 */
export function isInDateRange(value, { from = null, to = null } = {}) {
  const date = timestampMillis(value);
  if (date == null) return from == null && to == null;
  const start = from == null ? null : timestampMillis(from);
  const end = to == null ? null : timestampMillis(to);
  if (start != null && date < start) return false;
  if (end != null && date > end) return false;
  return true;
}

/**
 * Filters plain records by their fecha (or createdAt fallback) and socioId.
 */
export function filterByRangeAndPartner(records = [], { from, to, partnerId } = {}) {
  return records.filter((record) =>
    samePartner(record, partnerId) && isInDateRange(recordDate(record), { from, to }));
}

// Line amounts are prorated by the quantity that was not returned. Prices are
// per selected unit, so the stored subtotal is the only reliable weight.
const netLine = (line) => {
  const quantityBaseMilli = positiveInteger(line?.quantityBaseMilli ?? line?.cantidadBaseMilli);
  const returnedBaseMilli = Math.min(quantityBaseMilli, positiveInteger(line?.returnedBaseMilli));
  const netQuantityBaseMilli = quantityBaseMilli - returnedBaseMilli;
  const subtotalCents = Number.isSafeInteger(line?.subtotalNetoCents)
    ? line.subtotalNetoCents
    : (Number.isSafeInteger(line?.subtotalCents) ? line.subtotalCents : centsFor(quantityBaseMilli, line?.unitPriceCents));
  const costCents = Number.isSafeInteger(line?.costCents)
    ? line.costCents
    : centsFor(quantityBaseMilli, line?.unitCostCents ?? line?.costoUnitarioCents);
  const prorate = (value) => Math.round((value * netQuantityBaseMilli) / (quantityBaseMilli || 1));
  return {
    partnerId: line?.partnerId ?? line?.socioId,
    productId: line?.productoId ?? line?.productId,
    productName: line?.productoNombre ?? line?.productName ?? '',
    categoryId: line?.categoriaId ?? null,
    netQuantityBaseMilli,
    salesWeightCents: prorate(subtotalCents),
    costCents: prorate(costCents),
  };
};

// Allocates integer cents proportionally while preserving the exact total.
const allocate = (totalCents, lines, weightKey) => {
  const total = integer(totalCents);
  const weight = lines.reduce((sum, line) => sum + positiveInteger(line[weightKey]), 0);
  if (!weight) return lines.map(() => 0);
  const allocations = lines.map((line) => Math.trunc((total * positiveInteger(line[weightKey])) / weight));
  let remainder = total - allocations.reduce((sum, amount) => sum + amount, 0);
  for (let index = 0; remainder !== 0; index = (index + 1) % allocations.length) {
    allocations[index] += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
  }
  return allocations;
};

/**
 * Aggregates active sales. When lines exist, revenue (including discounts and
 * returns) is allocated proportionally to each line, so partner totals add up
 * exactly to a sale's net total.
 */
export function aggregateSales(sales = [], { from, to, partnerId } = {}) {
  const result = emptySales();

  for (const sale of sales) {
    if (!active(sale) || !isInDateRange(recordDate(sale), { from, to })) continue;
    const lines = (sale.lineas || sale.lines || []).map(netLine);
    const netTotalCents = integer(sale.totalCents) - positiveInteger(sale.montoDevueltoCents);

    if (!lines.length) {
      if (!samePartner(sale, partnerId)) continue;
      result.ventasCents += netTotalCents;
      result.costoCents += integer(sale.costoVentaCents) - positiveInteger(sale.costoDevueltoCents);
      result.cantidadVentas += 1;
      continue;
    }

    const allocatedSales = allocate(netTotalCents, lines, 'salesWeightCents');
    let saleIncluded = false;
    lines.forEach((line, index) => {
      if (partnerId != null && line.partnerId !== partnerId) return;
      saleIncluded = true;
      result.ventasCents += allocatedSales[index];
      result.costoCents += line.costCents;
      result.cantidadProductosBaseMilli += line.netQuantityBaseMilli;
    });
    if (saleIncluded) result.cantidadVentas += 1;
  }

  result.gananciaBrutaCents = result.ventasCents - result.costoCents;
  return result;
}

/**
 * Aggregates active expenses. Expenses without a socioId belong only to the
 * overall report, not to an individual partner.
 */
export function aggregateExpenses(expenses = [], { from, to, partnerId } = {}) {
  let gastosCents = 0;
  let cantidadGastos = 0;
  for (const expense of expenses) {
    if (!active(expense) || !samePartner(expense, partnerId) || !isInDateRange(recordDate(expense), { from, to })) continue;
    gastosCents += positiveInteger(expense.montoCents ?? expense.amountCents);
    cantidadGastos += 1;
  }
  return { gastosCents, cantidadGastos };
}

/**
 * Aggregates current inventory. If a date range is supplied, products are
 * filtered by their creation date; this is not a historical inventory
 * reconstruction.
 */
export function aggregateProducts(products = [], { from, to, partnerId, includeInactive = true } = {}) {
  const result = {
    valorInventarioCents: 0,
    ventasPotencialesCents: 0,
    gananciaPotencialCents: 0,
    cantidadProductos: 0,
    stockBaseMilli: 0,
  };
  for (const product of products) {
    if ((!includeInactive && product?.activo === false) || !samePartner(product, partnerId) || !isInDateRange(recordDate(product), { from, to })) continue;
    const stockBaseMilli = positiveInteger(product?.stockBaseMilli);
    const inventoryValue = centsFor(stockBaseMilli, product?.costoPromedioCents);
    const potentialSales = centsFor(stockBaseMilli, product?.precioVentaCents);
    result.valorInventarioCents += inventoryValue;
    result.ventasPotencialesCents += potentialSales;
    result.gananciaPotencialCents += potentialSales - inventoryValue;
    result.cantidadProductos += 1;
    result.stockBaseMilli += stockBaseMilli;
  }
  return result;
}

/**
 * Groups net sale lines by partner, product or category. Returns entries with
 * sales, cost, gross profit and quantity, ordered by sales descending.
 */
export function groupSales(sales = [], { from, to, partnerId, by = 'partnerId' } = {}) {
  const grouped = new Map();
  for (const sale of sales) {
    if (!active(sale) || !isInDateRange(recordDate(sale), { from, to })) continue;
    const lines = (sale.lineas || sale.lines || []).map(netLine);
    if (!lines.length) continue;
    const netTotalCents = integer(sale.totalCents) - positiveInteger(sale.montoDevueltoCents);
    const allocated = allocate(netTotalCents, lines, 'salesWeightCents');
    lines.forEach((line, index) => {
      if (partnerId != null && line.partnerId !== partnerId) return;
      const key = line[by] ?? 'sin-clasificar';
      const entry = grouped.get(key) || {
        key, nombre: by === 'productId' ? line.productName : '',
        ventasCents: 0, costoCents: 0, gananciaBrutaCents: 0, cantidadBaseMilli: 0,
      };
      entry.ventasCents += allocated[index];
      entry.costoCents += line.costCents;
      entry.gananciaBrutaCents = entry.ventasCents - entry.costoCents;
      entry.cantidadBaseMilli += line.netQuantityBaseMilli;
      grouped.set(key, entry);
    });
  }
  return [...grouped.values()].sort((a, b) => b.ventasCents - a.ventasCents);
}

export const topProducts = (sales, options = {}, count = 5) =>
  groupSales(sales, { ...options, by: 'productId' }).slice(0, count);

/**
 * Combines sales, expenses, and inventory into one report. Utilidad is gross
 * profit less expenses; all returned monetary fields are integer cents.
 */
export function calculateReport({ sales = [], expenses = [], products = [], from, to, partnerId, includeInactive } = {}) {
  const salesSummary = aggregateSales(sales, { from, to, partnerId });
  const expensesSummary = aggregateExpenses(expenses, { from, to, partnerId });
  const inventorySummary = aggregateProducts(products, { from, to, partnerId, includeInactive });
  return {
    ...salesSummary,
    ...expensesSummary,
    ...inventorySummary,
    utilidadCents: salesSummary.gananciaBrutaCents - expensesSummary.gastosCents,
  };
}
