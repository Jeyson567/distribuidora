import { COL, create, invalidate, searchKey, update } from '../services/db.js';
import { buildProductUnits, compatibleUnits } from '../domain/units.js';
import { badge, dataTable, field, moneyCell, pageHeader, selectInput, textInput } from '../ui/components.js';
import { confirmAction, esc, notice, openModal, qs, qsa, reportError } from '../ui/dom.js';
import { money, quantity } from '../utils/format.js';
import { toCents, toMilli } from '../utils/math.js';

const unitPicker = (units, baseUnit, product = {}) => {
  const selected = new Map((product.unidades || []).map((unit) => [unit.id, unit]));
  const options = compatibleUnits(units, baseUnit).filter((unit) => unit.id !== baseUnit?.id);
  if (!options.length) {
    return '<p class="text-sm text-slate-500">No hay otras unidades de la misma magnitud. Créelas en Configuración → Unidades.</p>';
  }
  return `<div class="grid gap-2 sm:grid-cols-2">${options.map((unit) => {
    const stored = selected.get(unit.id);
    return `
      <label class="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
        <input type="checkbox" name="unidadExtra" value="${esc(unit.id)}"${stored ? ' checked' : ''} class="h-4 w-4">
        <span class="flex-1">${esc(unit.nombre)}</span>
        <input type="number" step="0.01" min="0" name="precio_${esc(unit.id)}" class="field w-28"
          placeholder="Precio" value="${stored?.precioVentaCents ? stored.precioVentaCents / 100 : ''}">
      </label>`;
  }).join('')}</div>`;
};

const productForm = (ctx, product = {}) => {
  const units = ctx.catalogs.units.filter((unit) => unit.activo !== false);
  const baseUnit = units.find((unit) => unit.id === product.unidadBaseId) || null;
  return `
    <div class="space-y-4">
      <div class="grid gap-4 sm:grid-cols-2">
        ${field('Nombre', textInput('nombre', { required: true, value: product.nombre || '' }))}
        ${field('Código interno', textInput('codigo', { value: product.codigo || '' }))}
        ${field('Socio / área', selectInput('socioId', ctx.catalogs.partners.filter((p) => p.activo !== false), { selected: product.socioId, required: true }))}
        ${field('Categoría', selectInput('categoriaId', ctx.catalogs.categories.filter((c) => c.activo !== false), { selected: product.categoriaId, required: true }))}
        ${field('Unidad base', selectInput('unidadBaseId', units, { selected: product.unidadBaseId, required: true, attrs: 'id="base-unit"' }),
          'Es la unidad en la que se guarda la existencia. No se puede cambiar después de la primera compra.')}
        ${field('Precio de venta Q (por unidad base)', textInput('precio', { type: 'number', step: '0.01', min: '0', required: true, value: product.precioVentaCents ? product.precioVentaCents / 100 : '' }))}
        ${field('Stock mínimo', textInput('minimo', { type: 'number', step: '0.001', min: '0', value: product.stockMinimoBaseMilli ? product.stockMinimoBaseMilli / 1000 : 0 }))}
        ${field('Stock máximo (opcional)', textInput('maximo', { type: 'number', step: '0.001', min: '0', value: product.stockMaximoBaseMilli ? product.stockMaximoBaseMilli / 1000 : '' }))}
      </div>
      <div>
        <p class="text-sm font-medium text-slate-700">Otras unidades de venta y compra</p>
        <p class="mb-2 text-xs text-slate-500">Se convierten automáticamente a la unidad base. Deje el precio vacío para calcularlo desde el precio base.</p>
        <div id="unit-picker">${unitPicker(units, baseUnit, product)}</div>
      </div>
      ${field('Descripción', `<textarea name="descripcion" class="field mt-1" rows="2">${esc(product.descripcion || '')}</textarea>`)}
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="negativo" class="h-4 w-4"${product.permiteInventarioNegativo ? ' checked' : ''}>
        Permitir vender sin existencia (inventario negativo)
      </label>
    </div>`;
};

const buildPayload = (form, ctx) => {
  const units = ctx.catalogs.units;
  const baseUnit = units.find((unit) => unit.id === form.get('unidadBaseId'));
  const extras = form.getAll('unidadExtra').map((id) => units.find((unit) => unit.id === id)).filter(Boolean);
  const basePriceCents = toCents(form.get('precio'));
  const prices = { [baseUnit.id]: basePriceCents };
  for (const unit of extras) {
    const raw = form.get(`precio_${unit.id}`);
    prices[unit.id] = raw ? toCents(raw) : 0;
  }
  const unidades = buildProductUnits(baseUnit, extras, prices).map((unit) => ({
    ...unit,
    // A blank price falls back to the base price times the conversion factor.
    precioVentaCents: unit.precioVentaCents || Math.round((basePriceCents * unit.factorMilli) / 1000),
  }));
  const nombre = (form.get('nombre') || '').trim();
  return {
    nombre,
    nombreBusqueda: searchKey(nombre),
    codigo: (form.get('codigo') || '').trim() || null,
    descripcion: (form.get('descripcion') || '').trim() || null,
    socioId: form.get('socioId'),
    categoriaId: form.get('categoriaId'),
    unidadBaseId: baseUnit.id,
    unidadBaseNombre: baseUnit.nombre,
    unidadBaseAbreviatura: baseUnit.abreviatura || '',
    unidades,
    precioVentaCents: basePriceCents,
    stockMinimoBaseMilli: toMilli(form.get('minimo') || 0),
    stockMaximoBaseMilli: form.get('maximo') ? toMilli(form.get('maximo')) : null,
    permiteInventarioNegativo: form.get('negativo') === 'on',
  };
};

/**
 * A product cannot exist without a partner, a category and a unit. The screen
 * never hides the create button for that reason: it says what is missing and
 * takes the operator to the screen that creates it.
 */
const missingCatalogs = (ctx) => [
  !ctx.catalogs.partners.length && ['socios', 'un socio'],
  !ctx.catalogs.categories.length && ['categorias', 'una categoría'],
  !ctx.catalogs.units.length && ['unidades', 'una unidad de medida'],
].filter(Boolean);

export default {
  async load(ctx) {
    return { products: ctx.catalogs.products };
  },

  render({ products }, ctx) {
    const term = searchKey(ctx.params.q || '');
    const partnerId = ctx.params.socio || '';
    const rows = products.filter((product) => {
      if (partnerId && product.socioId !== partnerId) return false;
      if (term && !searchKey(product.nombre).includes(term) && !searchKey(product.codigo).includes(term)) return false;
      return true;
    });
    const partnerName = (id) => ctx.catalogs.partners.find((partner) => partner.id === id)?.nombre || '—';
    const categoryName = (id) => ctx.catalogs.categories.find((category) => category.id === id)?.nombre || '—';

    const missing = missingCatalogs(ctx);

    return `
      ${pageHeader('Productos', 'Cada producto pertenece a un socio y guarda su costo promedio ponderado.',
        '<button id="new-product" class="btn-primary">+ Nuevo producto</button>')}
      ${missing.length ? `<div class="card mb-5 border-amber-200 bg-amber-50 text-sm text-amber-900">
        <p>Antes de crear productos falta registrar ${esc(missing.map(([, label]) => label).join(', '))}.</p>
        <div class="mt-3 flex flex-wrap gap-2">
          ${missing.map(([route, label]) => `<button data-goto="${esc(route)}" class="btn-secondary">Crear ${esc(label)}</button>`).join('')}
        </div>
      </div>` : ''}
      <form id="filters" class="no-print card mb-5 flex flex-wrap items-end gap-3">
        <label class="text-sm font-medium">Buscar
          <input name="q" class="field mt-1" value="${esc(ctx.params.q || '')}" placeholder="Nombre o código">
        </label>
        <label class="text-sm font-medium">Socio
          ${selectInput('socio', ctx.catalogs.partners, { selected: partnerId, placeholder: 'Todos' })}
        </label>
        <button class="btn-secondary">Filtrar</button>
      </form>
      ${dataTable({
        columns: [
          {
            label: 'Producto',
            format: (row) => `<b>${esc(row.nombre)}</b><span class="block text-xs text-slate-500">${esc(categoryName(row.categoriaId))}${row.codigo ? ` · ${esc(row.codigo)}` : ''}</span>`,
          },
          { label: 'Socio', format: (row) => esc(partnerName(row.socioId)) },
          {
            label: 'Existencia',
            align: 'right',
            format: (row) => {
              const low = (row.stockBaseMilli || 0) <= (row.stockMinimoBaseMilli || 0);
              return `<span class="${low ? 'font-semibold text-amber-700' : ''}">${esc(quantity(row.stockBaseMilli))} ${esc(row.unidadBaseAbreviatura || row.unidadBaseNombre || '')}</span>`;
            },
          },
          { label: 'Costo prom.', align: 'right', format: (row) => moneyCell(row.costoPromedioCents) },
          { label: 'Precio', align: 'right', format: (row) => moneyCell(row.precioVentaCents) },
          {
            label: 'Margen',
            align: 'right',
            format: (row) => {
              const margin = row.precioVentaCents - (row.costoPromedioCents || 0);
              const tone = margin > 0 ? 'text-emerald-700' : 'text-red-700';
              return `<span class="${row.costoPromedioCents ? tone : 'text-slate-400'}">${row.costoPromedioCents ? esc(money(margin)) : '—'}</span>`;
            },
          },
          { label: 'Unidades', format: (row) => esc((row.unidades || []).map((unit) => unit.nombre).join(', ') || row.unidadBaseNombre || '—') },
          { label: 'Estado', format: (row) => badge(row.activo === false ? 'Inactivo' : 'Activo', row.activo === false ? 'slate' : 'green') },
          {
            label: '',
            align: 'right',
            format: (row) => `<button data-edit="${esc(row.id)}" class="btn-link">Editar</button>
              <button data-toggle="${esc(row.id)}" class="btn-link">${row.activo === false ? 'Activar' : 'Desactivar'}</button>`,
          },
        ],
        rows,
        empty: term || partnerId
          ? 'No hay productos que coincidan con el filtro.'
          : 'Todavía no hay productos registrados.',
        emptyAction: term || partnerId ? null : { id: 'new-product-empty', label: '+ Nuevo producto' },
      })}`;
  },

  bind({ products }, ctx) {
    const openForm = (product) => openModal({
      title: product ? `Editar ${product.nombre}` : 'Nuevo producto',
      size: 'lg',
      body: productForm(ctx, product || {}),
      onReady: ({ dialog }) => {
        const baseSelect = qs('#base-unit', dialog);
        baseSelect.onchange = () => {
          const baseUnit = ctx.catalogs.units.find((unit) => unit.id === baseSelect.value);
          qs('#unit-picker', dialog).innerHTML = unitPicker(ctx.catalogs.units, baseUnit, product || {});
        };
      },
      onSubmit: async (form) => {
        const payload = buildPayload(form, ctx);
        if (product) {
          await update(COL.products, product.id, payload);
        } else {
          await create(COL.products, {
            ...payload,
            stockBaseMilli: 0,
            costoPromedioCents: 0,
            costoActualCents: 0,
            activo: true,
          });
        }
        invalidate(COL.products);
        notice(product ? 'Producto actualizado.' : 'Producto creado. Registre una compra o un inventario inicial.');
        await ctx.refresh();
      },
    });

    const requirementsModal = (missing) => openModal({
      title: 'Falta configuración para crear productos',
      submitLabel: `Ir a crear ${missing[0][1]}`,
      body: `
        <p class="text-sm text-slate-600">Un producto necesita un socio, una categoría y una unidad de medida.
        Todavía falta registrar ${esc(missing.map(([, label]) => label).join(', '))}.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          ${missing.map(([route, label]) => `<button type="button" data-jump="${esc(route)}" class="btn-secondary">Crear ${esc(label)}</button>`).join('')}
        </div>`,
      onReady: ({ dialog, close }) => {
        qsa('[data-jump]', dialog).forEach((button) => {
          button.onclick = () => { close(); ctx.navigate(button.dataset.jump); };
        });
      },
      onSubmit: () => ctx.navigate(missing[0][0]),
    });

    qsa('#new-product, #new-product-empty').forEach((button) => {
      button.onclick = () => {
        const missing = missingCatalogs(ctx);
        if (missing.length) requirementsModal(missing);
        else openForm(null);
      };
    });
    qsa('[data-goto]').forEach((button) => {
      button.onclick = () => ctx.navigate(button.dataset.goto);
    });
    qsa('[data-edit]').forEach((button) => {
      button.onclick = () => openForm(products.find((product) => product.id === button.dataset.edit));
    });
    qsa('[data-toggle]').forEach((button) => {
      button.onclick = async () => {
        const product = products.find((item) => item.id === button.dataset.toggle);
        const activating = product.activo === false;
        const confirmed = await confirmAction({
          title: activating ? 'Activar producto' : 'Desactivar producto',
          message: activating
            ? `${product.nombre} volverá a aparecer en el punto de venta.`
            : `${product.nombre} dejará de venderse. Su historial y existencia se conservan.`,
          confirmLabel: activating ? 'Activar' : 'Desactivar',
        });
        if (!confirmed) return;
        try {
          await update(COL.products, product.id, { activo: activating });
          invalidate(COL.products);
          await ctx.refresh();
        } catch (error) {
          reportError(error, 'No se pudo actualizar el producto.');
        }
      };
    });

    qs('#filters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('productos', { q: form.get('q'), socio: form.get('socio') });
    });
  },
};
