import { fault } from '../domain/errors.js';

// Money is stored as integer quetzal cents. Quantities are stored as integer
// thousandths ("milli") of a unit, which keeps 0.25 lb style sales exact.
export const MILLI = 1000;

const parse = (value) => Number(String(value ?? '').trim().replace(',', '.'));

export const toCents = (value) => {
  const amount = parse(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
};

export const toMilli = (value) => {
  const amount = parse(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * MILLI);
};

export const fromCents = (cents) => (Number(cents) || 0) / 100;
export const fromMilli = (milli) => (Number(milli) || 0) / MILLI;

export const requireInteger = (value, label) => {
  if (!Number.isSafeInteger(value)) fault(`${label} no es un valor válido.`);
  return value;
};

export const requireNonNegative = (value, label) => {
  requireInteger(value, label);
  if (value < 0) fault(`${label} no puede ser negativo.`);
  return value;
};

export const requirePositive = (value, label) => {
  requireInteger(value, label);
  if (value <= 0) fault(`${label} debe ser mayor que cero.`);
  return value;
};

/** quantityMilli x unitAmountCents, both scaled by 1000. */
export const scale = (quantityMilli, unitAmountCents) =>
  Math.round((quantityMilli * unitAmountCents) / MILLI);

export const lineTotal = (quantityMilli, unitPriceCents) =>
  scale(requireNonNegative(quantityMilli, 'La cantidad'), requireNonNegative(unitPriceCents, 'El precio'));

export const convertToBaseMilli = (quantityMilli, factorToBaseMilli = MILLI) =>
  scale(requireNonNegative(quantityMilli, 'La cantidad'), requirePositive(factorToBaseMilli, 'La conversión de unidad'));

export const weightedAverage = (currentQtyMilli, currentCostCents, incomingQtyMilli, incomingCostCents) => {
  const quantity = currentQtyMilli + incomingQtyMilli;
  if (quantity <= 0) return incomingCostCents || currentCostCents || 0;
  return Math.round(((currentQtyMilli * currentCostCents) + (incomingQtyMilli * incomingCostCents)) / quantity);
};

export const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Splits an integer amount across weighted parts without losing or inventing
 * cents: the allocations always add up to the original amount.
 */
export const allocate = (totalCents, weights) => {
  const total = Math.trunc(totalCents);
  const safeWeights = weights.map((weight) => Math.max(0, Math.trunc(weight) || 0));
  const totalWeight = sum(safeWeights);
  if (!safeWeights.length) return [];
  if (!totalWeight) {
    const shares = safeWeights.map(() => 0);
    shares[0] = total;
    return shares;
  }
  const shares = safeWeights.map((weight) => Math.trunc((total * weight) / totalWeight));
  let remainder = total - sum(shares);
  const step = remainder >= 0 ? 1 : -1;
  for (let index = 0; remainder !== 0; index = (index + 1) % shares.length) {
    if (!safeWeights[index]) continue;
    shares[index] += step;
    remainder -= step;
  }
  return shares;
};

export const percentage = (part, whole) => (whole ? Math.round((part / whole) * 10000) / 100 : 0);
