import { fault } from './errors.js';
import { MILLI, scale } from '../utils/math.js';
import { UNIT_DIMENSIONS } from './constants.js';

/**
 * Units allowed for a product are stored on the product itself so a later
 * change in the catalogue never rewrites the meaning of past documents.
 */
export const productUnits = (product) => {
  const stored = Array.isArray(product?.unidades) ? product.unidades.filter((unit) => unit?.id) : [];
  if (stored.length) return stored;
  return [{
    id: product?.unidadBaseId,
    nombre: product?.unidadBaseNombre || 'Unidad',
    abreviatura: product?.unidadBaseAbreviatura || '',
    factorMilli: MILLI,
    precioVentaCents: product?.precioVentaCents ?? 0,
  }];
};

export const resolveUnit = (product, unitId) => {
  const units = productUnits(product);
  const unit = units.find((item) => item.id === (unitId || product?.unidadBaseId)) || units[0];
  if (!unit) fault(`El producto ${product?.nombre || ''} no tiene unidades configuradas.`);
  if (!Number.isSafeInteger(unit.factorMilli) || unit.factorMilli <= 0) {
    fault(`La conversión de ${unit.nombre} no es válida.`);
  }
  return unit;
};

/** Quantity expressed in the chosen unit, converted to the product base unit. */
export const toBaseMilli = (quantityMilli, factorMilli) => scale(quantityMilli, factorMilli);

/** Inverse conversion, used to show stock in a friendlier unit. */
export const fromBaseMilli = (baseMilli, factorMilli) =>
  (factorMilli ? Math.round((baseMilli * MILLI) / factorMilli) : 0);

/**
 * Conversion factor between two catalogue units of the same dimension, as
 * thousandths of `baseUnit` contained in one `unit`.
 */
export const conversionFactor = (unit, baseUnit) => {
  if (!unit || !baseUnit) fault('Debe seleccionar unidades válidas.');
  if (unit.dimension !== baseUnit.dimension) {
    fault(`${unit.nombre} no se puede convertir a ${baseUnit.nombre}: son magnitudes distintas.`);
  }
  const base = Number(baseUnit.equivalenciaMilli);
  const value = Number(unit.equivalenciaMilli);
  if (!base || !value || base <= 0 || value <= 0) fault('Las equivalencias de unidad deben ser mayores que cero.');
  return Math.round((value * MILLI) / base);
};

/**
 * Snapshot of the units a product can be bought and sold in. It is stored on
 * the product so past documents keep the conversion that was used.
 */
export const buildProductUnits = (baseUnit, selectedUnits, priceByUnitId = {}) => {
  if (!baseUnit) fault('Seleccione la unidad base del producto.');
  const chosen = [baseUnit, ...selectedUnits.filter((unit) => unit.id !== baseUnit.id)];
  return chosen.map((unit) => ({
    id: unit.id,
    nombre: unit.nombre,
    abreviatura: unit.abreviatura || '',
    factorMilli: conversionFactor(unit, baseUnit),
    precioVentaCents: Number(priceByUnitId[unit.id]) || 0,
  }));
};

export const compatibleUnits = (units, baseUnit) =>
  (baseUnit ? units.filter((unit) => unit.dimension === baseUnit.dimension && unit.activo !== false) : []);

export const dimensionLabel = (dimension) => UNIT_DIMENSIONS[dimension]?.label || dimension || '';
