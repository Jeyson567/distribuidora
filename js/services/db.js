import {
  addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { COL, DEFAULT_UNITS, SETTINGS_DOC, STATUS } from '../domain/constants.js';
import { sortByDate, sortByText } from '../utils/sort.js';

export { COL, SETTINGS_DOC };

export const ref = (name, id) => doc(db, name, id);

export const searchKey = (value) => String(value || '')
  .toLocaleLowerCase('es')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

export const create = (name, payload) => addDoc(collection(db, name), {
  ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
}).then((reference) => reference.id);

export const update = (name, id, payload) => updateDoc(ref(name, id), {
  ...payload, updatedAt: serverTimestamp(),
});

export const read = async (name, id) => {
  const snapshot = await getDoc(ref(name, id));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
};

export const list = async (name, constraints = []) => {
  const snapshot = await getDocs(query(collection(db, name), ...constraints));
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
};

/** Catalogues are small and read on almost every screen, so they are cached. */
const cache = new Map();

export const catalog = async (name, { refresh = false } = {}) => {
  if (!refresh && cache.has(name)) return cache.get(name);
  const records = sortByText(await list(name, [limit(500)]), 'nombreBusqueda');
  cache.set(name, records);
  return records;
};

export const invalidate = (...names) => {
  if (!names.length) cache.clear();
  names.forEach((name) => cache.delete(name));
};

const CATALOGS = [COL.partners, COL.categories, COL.units, COL.products, COL.customers, COL.suppliers];

export const loadCatalogs = async (options) => {
  const [partners, categories, units, products, customers, suppliers] = await Promise.all(
    CATALOGS.map((name) => catalog(name, options)),
  );
  return { partners, categories, units, products, customers, suppliers };
};

/**
 * Keeps the catalogues live. Firestore pushes every change — made here, in
 * another tab or from another device — so the cache is always current and the
 * caller can repaint. The first snapshot of each collection is the data that
 * was just read, so it is swallowed to avoid a pointless repaint on entry.
 *
 * Returns the function that cancels every listener.
 */
export function watchCatalogs(onChange, onError = () => {}) {
  const stops = CATALOGS.map((name) => {
    let first = true;
    return onSnapshot(
      query(collection(db, name), limit(500)),
      (snapshot) => {
        cache.set(name, sortByText(
          snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
          'nombreBusqueda',
        ));
        if (first) first = false;
        else onChange(name);
      },
      (error) => onError(error, name),
    );
  });
  return () => stops.forEach((stop) => stop());
}

// Ordering by the same field it filters on needs no composite index.
export const recent = (name, count = 50, field = 'fecha') =>
  list(name, [orderBy(field, 'desc'), limit(count)]);

export const between = (name, from, to, count = 500, field = 'fecha') => {
  const constraints = [];
  if (from) constraints.push(where(field, '>=', from));
  if (to) constraints.push(where(field, '<=', to));
  constraints.push(orderBy(field, 'desc'), limit(count));
  return list(name, constraints);
};

export const forOwner = async (name, field, ownerId, count = 200, sort = 'desc') =>
  sortByDate(await list(name, [where(field, '==', ownerId), limit(count)]), 'fecha', sort);

export const productHistory = async (productId, count = 100) =>
  sortByDate(await list(COL.inventory, [where('productoId', '==', productId), limit(count)]), 'fecha');

export const openAccounts = async (name, count = 300) => sortByDate(
  await list(name, [where('estado', 'in', [STATUS.pending, STATUS.partial]), limit(count)]),
  'fechaVencimiento',
  'asc',
);

export const cashMovesFor = async (cashId, count = 300) =>
  sortByDate(await list(COL.cashMoves, [where('cajaId', '==', cashId), limit(count)]), 'fecha');

export const businessSettings = () => read(COL.settings, SETTINGS_DOC.business);

export const saveBusinessSettings = (payload) => setDoc(ref(COL.settings, SETTINGS_DOC.business), {
  ...payload, updatedAt: serverTimestamp(),
}, { merge: true });

export const GENERAL_CUSTOMER_ID = 'cliente-general';

/**
 * The documents the application takes for granted. An installation can lack
 * them (setup interrupted, project restored, an older installation), so every
 * one of them is checked and can be created from the Configuración screen
 * instead of forcing the operator into the Firebase console.
 */
export const baselineStatus = async () => {
  const [business, counters, activeCash, general, units] = await Promise.all([
    read(COL.settings, SETTINGS_DOC.business),
    read(COL.settings, SETTINGS_DOC.counters),
    read(COL.settings, SETTINGS_DOC.activeCash),
    read(COL.customers, GENERAL_CUSTOMER_ID),
    catalog(COL.units, { refresh: true }),
  ]);
  return [
    { key: 'business', label: 'Datos del negocio', path: 'configuracion/negocio', ok: Boolean(business) },
    { key: 'counters', label: 'Correlativos de ventas y compras', path: 'configuracion/correlativos', ok: Boolean(counters) },
    { key: 'activeCash', label: 'Puntero de caja activa', path: 'configuracion/cajaActiva', ok: Boolean(activeCash) },
    { key: 'general', label: 'CLIENTE GENERAL', path: `clientes/${GENERAL_CUSTOMER_ID}`, ok: Boolean(general) },
    { key: 'units', label: 'Unidades de medida', path: 'unidades', ok: units.length > 0 },
  ];
};

/**
 * Creates only what is missing. Every write is either a merge or guarded by the
 * previous check, so running it twice never duplicates anything.
 */
export const createMissingBaseline = async () => {
  const status = await baselineStatus();
  const missing = new Set(status.filter((item) => !item.ok).map((item) => item.key));
  const created = [];

  if (missing.has('business')) {
    await saveBusinessSettings({
      nombre: 'Mi negocio',
      prefijoVentas: 'V',
      prefijoCompras: 'C',
      moneda: 'GTQ',
      simboloMoneda: 'Q',
    });
    created.push('Datos del negocio');
  }
  if (missing.has('counters')) {
    await setDoc(ref(COL.settings, SETTINGS_DOC.counters), { updatedAt: serverTimestamp() }, { merge: true });
    created.push('Correlativos');
  }
  if (missing.has('activeCash')) {
    await setDoc(ref(COL.settings, SETTINGS_DOC.activeCash), { cajaId: null, updatedAt: serverTimestamp() }, { merge: true });
    created.push('Puntero de caja activa');
  }
  if (missing.has('general')) {
    await setDoc(ref(COL.customers, GENERAL_CUSTOMER_ID), {
      nombre: 'CLIENTE GENERAL',
      nombreBusqueda: 'cliente general',
      telefono: null,
      activo: true,
      limiteCreditoCents: 0,
      saldoActualCents: 0,
      totalCompradoCents: 0,
      totalPagadoCents: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    invalidate(COL.customers);
    created.push('CLIENTE GENERAL');
  }
  if (missing.has('units')) {
    const added = await seedDefaultUnits();
    if (added) created.push(`${added} unidades de medida`);
  }
  return created;
};

/**
 * Writes the standard measurement units. These are configuration, not sample
 * data, and each one stays editable afterwards.
 */
export const seedDefaultUnits = async () => {
  const existing = await catalog(COL.units, { refresh: true });
  const known = new Set(existing.map((unit) => searchKey(unit.nombre)));
  const missing = DEFAULT_UNITS.filter((unit) => !known.has(searchKey(unit.nombre)));
  if (!missing.length) return 0;
  const batch = writeBatch(db);
  for (const unit of missing) {
    batch.set(doc(collection(db, COL.units)), {
      ...unit,
      nombreBusqueda: searchKey(unit.nombre),
      activo: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
  invalidate(COL.units);
  return missing.length;
};
