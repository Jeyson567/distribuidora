import { COL, create, forOwner, invalidate, searchKey, seedDefaultUnits, update } from '../services/db.js';
import { UNIT_DIMENSIONS } from '../domain/constants.js';
import { badge, dataTable, field, moneyCell, pageHeader, textInput } from '../ui/components.js';
import { confirmAction, esc, notice, openModal, qs, qsa, reportError, withBusy } from '../ui/dom.js';
import { dateOnly, dateTime, money, quantity } from '../utils/format.js';
import { toCents, toMilli } from '../utils/math.js';
import { generateDocumentHtml, openPrintWindow } from '../services/printing.js';

const text = (name, label, options = {}) => field(label, textInput(name, options));

const ENTITIES = {
  socios: {
    key: 'partners',
    collection: COL.partners,
    title: 'Socios / áreas',
    subtitle: 'Entidades del negocio dueñas de una línea de productos. No son usuarios del sistema.',
    singular: 'socio',
    columns: (record, ctx) => [
      { label: 'Socio', format: (row) => `<b>${esc(row.nombre)}</b>` },
      { label: 'Descripción', format: (row) => esc(row.descripcion || '—') },
      { label: 'Teléfono', format: (row) => esc(row.telefono || '—') },
      { label: 'Productos', align: 'right', format: (row) => String(ctx.catalogs.products.filter((p) => p.socioId === row.id).length) },
    ],
    form: (record = {}) => `
      <div class="space-y-4">
        ${text('nombre', 'Nombre del socio o área', { required: true, value: record.nombre || '' })}
        ${text('descripcion', 'Descripción', { value: record.descripcion || '' })}
        ${text('telefono', 'Teléfono', { value: record.telefono || '' })}
      </div>`,
    payload: (form) => ({
      descripcion: (form.get('descripcion') || '').trim() || null,
      telefono: (form.get('telefono') || '').trim() || null,
    }),
  },

  categorias: {
    key: 'categories',
    collection: COL.categories,
    title: 'Categorías',
    subtitle: 'Agrupan los productos dentro del punto de venta.',
    singular: 'categoría',
    newLabel: '+ Nueva categoría',
    columns: (record, ctx) => [
      { label: 'Categoría', format: (row) => `<b>${esc(row.nombre)}</b>` },
      { label: 'Descripción', format: (row) => esc(row.descripcion || '—') },
      { label: 'Productos', align: 'right', format: (row) => String(ctx.catalogs.products.filter((p) => p.categoriaId === row.id).length) },
    ],
    form: (record = {}) => `
      <div class="space-y-4">
        ${text('nombre', 'Nombre', { required: true, value: record.nombre || '' })}
        ${text('descripcion', 'Descripción', { value: record.descripcion || '' })}
      </div>`,
    payload: (form) => ({ descripcion: (form.get('descripcion') || '').trim() || null }),
  },

  unidades: {
    key: 'units',
    collection: COL.units,
    title: 'Unidades de medida',
    subtitle: 'La equivalencia indica cuánto vale una unidad respecto a la referencia de su magnitud (libra, litro o unidad).',
    singular: 'unidad',
    newLabel: '+ Nueva unidad',
    searchPlaceholder: 'Buscar unidad',
    extraActions: '<button id="seed-units" class="btn-secondary">Cargar unidades estándar</button>',
    columns: () => [
      { label: 'Unidad', format: (row) => `<b>${esc(row.nombre)}</b> <span class="text-slate-400">${esc(row.abreviatura || '')}</span>` },
      { label: 'Magnitud', format: (row) => esc(UNIT_DIMENSIONS[row.dimension]?.label || row.dimension || '—') },
      {
        label: 'Equivalencia',
        align: 'right',
        format: (row) => `${esc(quantity(row.equivalenciaMilli))} ${esc(UNIT_DIMENSIONS[row.dimension]?.reference || '')}`,
      },
    ],
    form: (record = {}) => `
      <div class="space-y-4">
        ${text('nombre', 'Nombre', { required: true, value: record.nombre || '' })}
        ${text('abreviatura', 'Abreviatura', { value: record.abreviatura || '' })}
        ${field('Magnitud', `<select class="field mt-1" name="dimension" required>${
          Object.entries(UNIT_DIMENSIONS).map(([value, item]) =>
            `<option value="${value}"${record.dimension === value ? ' selected' : ''}>${esc(item.label)} (referencia: ${esc(item.reference)})</option>`).join('')
        }</select>`)}
        ${field('Equivalencia con la referencia',
          textInput('equivalencia', { type: 'number', step: '0.001', min: '0.001', required: true, value: record.equivalenciaMilli ? record.equivalenciaMilli / 1000 : '' }),
          'Ejemplo: 1 quintal = 100 libras, entonces escriba 100.')}
      </div>`,
    payload: (form) => ({
      abreviatura: (form.get('abreviatura') || '').trim() || null,
      dimension: form.get('dimension'),
      equivalenciaMilli: toMilli(form.get('equivalencia')),
    }),
  },

  clientes: {
    key: 'customers',
    collection: COL.customers,
    title: 'Clientes',
    subtitle: 'Registre clientes para vender a crédito y llevar su estado de cuenta.',
    singular: 'cliente',
    searchPlaceholder: 'Buscar por nombre o teléfono',
    matches: (row, term) => searchKey(row.nombre).includes(term) || String(row.telefono || '').includes(term),
    columns: () => [
      { label: 'Cliente', format: (row) => `<b>${esc(row.nombre)}</b>${row.nit ? `<span class="block text-xs text-slate-500">NIT ${esc(row.nit)}</span>` : ''}` },
      { label: 'Teléfono', format: (row) => esc(row.telefono || '—') },
      { label: 'Límite', align: 'right', format: (row) => moneyCell(row.limiteCreditoCents) },
      { label: 'Saldo', align: 'right', format: (row) => `<span class="${(row.saldoActualCents || 0) > 0 ? 'font-semibold text-red-700' : ''}">${esc(money(row.saldoActualCents))}</span>` },
      { label: 'Disponible', align: 'right', format: (row) => moneyCell(Math.max(0, (row.limiteCreditoCents || 0) - (row.saldoActualCents || 0))) },
    ],
    rowAction: { label: 'Estado de cuenta', handler: 'statement' },
    form: (record = {}) => `
      <div class="grid gap-4 sm:grid-cols-2">
        ${text('nombre', 'Nombre', { required: true, value: record.nombre || '' })}
        ${text('telefono', 'Teléfono', { value: record.telefono || '' })}
        ${text('dpi', 'DPI (opcional)', { value: record.dpi || '' })}
        ${text('nit', 'NIT (opcional)', { value: record.nit || '' })}
        ${field('Límite de crédito Q', textInput('limite', { type: 'number', step: '0.01', min: '0', value: record.limiteCreditoCents ? record.limiteCreditoCents / 100 : 0 }),
          'Deje en 0 para no permitir crédito a este cliente.')}
        ${text('direccion', 'Dirección', { value: record.direccion || '' })}
      </div>`,
    payload: (form) => ({
      telefono: (form.get('telefono') || '').trim() || null,
      dpi: (form.get('dpi') || '').trim() || null,
      nit: (form.get('nit') || '').trim() || null,
      direccion: (form.get('direccion') || '').trim() || null,
      limiteCreditoCents: toCents(form.get('limite')),
    }),
    defaults: { saldoActualCents: 0, totalCompradoCents: 0, totalPagadoCents: 0 },
  },

  proveedores: {
    key: 'suppliers',
    collection: COL.suppliers,
    title: 'Proveedores',
    subtitle: 'Origen de las compras y de las cuentas por pagar.',
    singular: 'proveedor',
    searchPlaceholder: 'Buscar por nombre o teléfono',
    matches: (row, term) => searchKey(row.nombre).includes(term) || String(row.telefono || '').includes(term),
    columns: () => [
      { label: 'Proveedor', format: (row) => `<b>${esc(row.nombre)}</b>${row.empresa ? `<span class="block text-xs text-slate-500">${esc(row.empresa)}</span>` : ''}` },
      { label: 'Contacto', format: (row) => esc(row.contacto || row.telefono || '—') },
      { label: 'NIT', format: (row) => esc(row.nit || '—') },
      { label: 'Comprado', align: 'right', format: (row) => moneyCell(row.totalCompradoCents) },
      { label: 'Saldo', align: 'right', format: (row) => `<span class="${(row.saldoActualCents || 0) > 0 ? 'font-semibold text-red-700' : ''}">${esc(money(row.saldoActualCents))}</span>` },
    ],
    rowAction: { label: 'Estado de cuenta', handler: 'supplierStatement' },
    form: (record = {}) => `
      <div class="grid gap-4 sm:grid-cols-2">
        ${text('nombre', 'Nombre', { required: true, value: record.nombre || '' })}
        ${text('empresa', 'Empresa', { value: record.empresa || '' })}
        ${text('telefono', 'Teléfono', { value: record.telefono || '' })}
        ${text('contacto', 'Contacto', { value: record.contacto || '' })}
        ${text('nit', 'NIT', { value: record.nit || '' })}
        ${text('direccion', 'Dirección', { value: record.direccion || '' })}
        ${text('observaciones', 'Observaciones', { value: record.observaciones || '' })}
      </div>`,
    payload: (form) => ({
      empresa: (form.get('empresa') || '').trim() || null,
      telefono: (form.get('telefono') || '').trim() || null,
      contacto: (form.get('contacto') || '').trim() || null,
      nit: (form.get('nit') || '').trim() || null,
      direccion: (form.get('direccion') || '').trim() || null,
      observaciones: (form.get('observaciones') || '').trim() || null,
    }),
    defaults: { saldoActualCents: 0, totalCompradoCents: 0, totalPagadoCents: 0 },
  },
};

async function showStatement({ record, movements, business, isCustomer }) {
  let balance = 0;
  const rows = [...movements].reverse().map((movement) => {
    balance += (Number(movement.cargoCents) || 0) - (Number(movement.abonoCents) || 0);
    return [
      dateOnly(movement.fecha),
      movement.concepto || movement.tipo || '',
      money(movement.cargoCents),
      money(movement.abonoCents),
      money(balance),
    ];
  });

  const table = `<div class="card overflow-x-auto p-0"><table class="w-full text-sm">
    <thead class="border-b bg-slate-50 text-left text-slate-600"><tr>
      <th class="px-3 py-2">Fecha</th><th class="px-3 py-2">Concepto</th>
      <th class="px-3 py-2 text-right">Cargo</th><th class="px-3 py-2 text-right">Abono</th><th class="px-3 py-2 text-right">Saldo</th>
    </tr></thead>
    <tbody>${rows.length ? rows.map((row) => `<tr class="border-b border-slate-100">${row.map((cell, index) =>
      `<td class="px-3 py-2 ${index > 1 ? 'text-right tabular-nums' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('')
      : '<tr><td colspan="5" class="px-3 py-6 text-center text-slate-500">Sin movimientos.</td></tr>'}</tbody>
  </table></div>`;

  openModal({
    title: `Estado de cuenta · ${record.nombre}`,
    size: 'lg',
    submitLabel: 'Imprimir',
    body: `
      <div class="mb-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Total ${isCustomer ? 'comprado' : 'comprado'}</p><p class="font-bold">${esc(money(record.totalCompradoCents))}</p></div>
        <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Total pagado</p><p class="font-bold">${esc(money(record.totalPagadoCents))}</p></div>
        <div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-500">Saldo pendiente</p><p class="font-bold text-red-700">${esc(money(record.saldoActualCents))}</p></div>
      </div>
      ${isCustomer ? `<p class="mb-3 text-sm text-slate-600">Límite de crédito ${esc(money(record.limiteCreditoCents))} · Disponible ${esc(money(Math.max(0, (record.limiteCreditoCents || 0) - (record.saldoActualCents || 0))))}</p>` : ''}
      ${table}`,
    onSubmit: async () => {
      openPrintWindow(generateDocumentHtml({
        title: `Estado de cuenta ${record.nombre}`,
        business,
        docTitle: 'Estado de cuenta',
        docNumber: record.nombre,
        meta: [
          ['Fecha', dateTime(new Date())],
          [isCustomer ? 'Cliente' : 'Proveedor', record.nombre],
          ['Teléfono', record.telefono || '—'],
          ['Saldo pendiente', money(record.saldoActualCents)],
        ],
        tables: [{
          columns: [
            { label: 'Fecha' }, { label: 'Concepto' },
            { label: 'Cargo', align: 'right' }, { label: 'Abono', align: 'right' }, { label: 'Saldo', align: 'right' },
          ],
          rows,
        }],
        totals: [['Saldo pendiente', money(record.saldoActualCents)]],
      }), { title: 'Estado de cuenta' });
    },
  });
}

export function entityPage(routeId) {
  const config = ENTITIES[routeId];

  return {
    async load(ctx) {
      return { records: ctx.catalogs[config.key] || [] };
    },

    render({ records }, ctx) {
      const term = searchKey(ctx.params.q || '');
      const matches = config.matches || ((row, value) => searchKey(row.nombre).includes(value));
      const filtered = term ? records.filter((row) => matches(row, term)) : records;
      const newLabel = config.newLabel || `+ Nuevo ${config.singular}`;
      const columns = [
        ...config.columns(null, ctx),
        { label: 'Estado', format: (row) => badge(row.activo === false ? 'Inactivo' : 'Activo', row.activo === false ? 'slate' : 'green') },
        {
          label: '',
          align: 'right',
          format: (row) => `
            ${config.rowAction ? `<button data-detail="${esc(row.id)}" class="btn-link">${esc(config.rowAction.label)}</button>` : ''}
            <button data-edit="${esc(row.id)}" class="btn-link">Editar</button>
            <button data-toggle="${esc(row.id)}" class="btn-link">${row.activo === false ? 'Activar' : 'Desactivar'}</button>`,
        },
      ];

      return `
        ${pageHeader(config.title, config.subtitle, `${config.extraActions || ''}<button id="new-record" class="btn-primary">${esc(newLabel)}</button>`)}
        <form id="search-form" class="no-print mb-4 flex gap-2">
          <input name="q" class="field max-w-sm" placeholder="${esc(config.searchPlaceholder || 'Buscar por nombre')}" value="${esc(ctx.params.q || '')}">
          <button class="btn-secondary">Buscar</button>
          ${term ? '<button type="button" id="clear-search" class="btn-link">Quitar filtro</button>' : ''}
        </form>
        ${dataTable({
          columns,
          rows: filtered,
          empty: term
            ? 'Ningún registro coincide con la búsqueda.'
            : `Todavía no hay registros. Cree el primer ${config.singular}.`,
          emptyAction: term ? null : { id: 'new-record-empty', label: newLabel },
        })}`;
    },

    bind({ records }, ctx) {
      const save = async (form, record) => {
        const nombre = (form.get('nombre') || '').trim();
        if (!nombre) throw Object.assign(new Error('El nombre es obligatorio.'), { isBusinessError: true });
        const payload = { nombre, nombreBusqueda: searchKey(nombre), ...config.payload(form) };
        if (record) await update(config.collection, record.id, payload);
        else await create(config.collection, { ...config.defaults, ...payload, activo: true });
        invalidate(config.collection);
        notice(record ? 'Registro actualizado.' : 'Registro creado y guardado en Firestore.');
        await ctx.refresh();
      };

      qsa('#new-record, #new-record-empty').forEach((button) => {
        button.onclick = () => openModal({
          title: config.newLabel || `+ Nuevo ${config.singular}`,
          body: config.form(),
          onSubmit: (form) => save(form, null),
        });
      });

      qsa('[data-edit]').forEach((button) => {
        button.onclick = () => {
          const record = records.find((row) => row.id === button.dataset.edit);
          openModal({
            title: `Editar ${config.singular}`,
            body: config.form(record),
            onSubmit: (form) => save(form, record),
          });
        };
      });

      qsa('[data-toggle]').forEach((button) => {
        button.onclick = async () => {
          const record = records.find((row) => row.id === button.dataset.toggle);
          const activating = record.activo === false;
          const confirmed = await confirmAction({
            title: activating ? `Activar ${config.singular}` : `Desactivar ${config.singular}`,
            message: activating
              ? `${record.nombre} volverá a estar disponible.`
              : `${record.nombre} dejará de aparecer en nuevas operaciones. El historial se conserva.`,
            confirmLabel: activating ? 'Activar' : 'Desactivar',
          });
          if (!confirmed) return;
          try {
            await update(config.collection, record.id, { activo: activating });
            invalidate(config.collection);
            await ctx.refresh();
          } catch (error) {
            reportError(error, 'No se pudo actualizar el estado.');
          }
        };
      });

      qs('#search-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        ctx.navigate(routeId, { q: new FormData(event.currentTarget).get('q') });
      });
      qs('#clear-search')?.addEventListener('click', () => ctx.navigate(routeId, {}));

      qs('#seed-units')?.addEventListener('click', (event) => withBusy(event.currentTarget, 'Cargando…', async () => {
        try {
          const added = await seedDefaultUnits();
          notice(added ? `Se agregaron ${added} unidades.` : 'Las unidades estándar ya estaban registradas.');
          await ctx.refresh();
        } catch (error) {
          reportError(error, 'No se pudieron cargar las unidades.');
        }
      }));

      qsa('[data-detail]').forEach((button) => {
        button.onclick = async () => {
          const record = records.find((row) => row.id === button.dataset.detail);
          const isCustomer = routeId === 'clientes';
          try {
            const movements = await forOwner(
              isCustomer ? COL.receivables : COL.payables,
              isCustomer ? 'clienteId' : 'proveedorId',
              record.id,
            );
            await showStatement({ record, movements, business: ctx.business, isCustomer });
          } catch (error) {
            reportError(error, 'No se pudo cargar el estado de cuenta.');
          }
        };
      });
    },
  };
}