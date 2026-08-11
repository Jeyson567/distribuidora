import { MOVEMENT, WASTE_REASONS } from '../domain/constants.js';
import { registerInventoryAdjustment, registerWaste } from '../services/transactions.js';
import { COL, invalidate, productHistory, recent, searchKey } from '../services/db.js';
import { badge, dataTable, field, moneyCell, pageHeader, selectInput, statCard, textInput } from '../ui/components.js';
import { esc, notice, openModal, qs, qsa } from '../ui/dom.js';
import { downloadCsv } from '../utils/csv.js';
import { dateTime, money, quantity } from '../utils/format.js';
import { toCents, toMilli } from '../utils/math.js';

const value = (product) => Math.round(((product.stockBaseMilli || 0) * (product.costoPromedioCents || 0)) / 1000);
const potential = (product) => Math.round(((product.stockBaseMilli || 0) * (product.precioVentaCents || 0)) / 1000);

const sellable = (ctx) => ctx.catalogs.products.filter((product) => product.activo !== false);

/**
 * The two ways of moving inventory by hand. They live here so the inventory
 * screen, the movement history and the waste log all offer exactly the same
 * form instead of three slightly different copies.
 */
export function adjustmentModal(ctx) {
  const products = sellable(ctx);
  if (!products.length) {
    notice('Primero cree un producto: el ajuste se registra sobre un producto existente.', 'warn');
    return ctx.navigate('productos');
  }
  return openModal({
    title: 'Ajuste de inventario',
    body: `
      <div class="space-y-4">
        ${field('Producto', selectInput('productId', products, { required: true }))}
        ${field('Tipo de ajuste', `<select name="type" class="field mt-1" id="adjust-type" required>
          <option value="${MOVEMENT.initial}">Inventario inicial (ingreso con costo)</option>
          <option value="${MOVEMENT.adjustIn}">Ajuste positivo (sobrante)</option>
          <option value="${MOVEMENT.adjustOut}">Ajuste negativo (faltante)</option>
        </select>`)}
        ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
        <div id="cost-wrapper">${field('Costo unitario Q', textInput('cost', { type: 'number', step: '0.01', min: '0' }),
    'Se usa para recalcular el costo promedio. Déjelo vacío para conservar el costo actual.')}</div>
        ${field('Motivo', textInput('reason', { required: true, placeholder: 'Conteo físico, corrección, etc.' }))}
      </div>`,
    onReady: ({ dialog }) => {
      const type = qs('#adjust-type', dialog);
      type.onchange = () => {
        qs('#cost-wrapper', dialog).classList.toggle('hidden', type.value === MOVEMENT.adjustOut);
      };
    },
    onSubmit: async (form) => {
      const result = await registerInventoryAdjustment({
        productId: form.get('productId'),
        type: form.get('type'),
        quantityBaseMilli: toMilli(form.get('qty')),
        unitCostCents: form.get('cost') ? toCents(form.get('cost')) : null,
        reason: (form.get('reason') || '').trim(),
      });
      invalidate(COL.products);
      notice(`Ajuste registrado. Existencia resultante ${quantity(result.stockBaseMilli)}.`);
      await ctx.refresh();
    },
  });
}

export function wasteModal(ctx) {
  const products = sellable(ctx);
  if (!products.length) {
    notice('Primero cree un producto: la merma se descuenta de un producto existente.', 'warn');
    return ctx.navigate('productos');
  }
  return openModal({
    title: 'Registrar merma',
    body: `
      <div class="space-y-4">
        ${field('Producto', selectInput('productId', products, { required: true }))}
        ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
        ${field('Motivo', `<select name="reason" class="field mt-1" required>${
  WASTE_REASONS.map((reason) => `<option>${esc(reason)}</option>`).join('')}</select>`)}
        ${field('Observación', textInput('observation'))}
      </div>`,
    onSubmit: async (form) => {
      const result = await registerWaste({
        productId: form.get('productId'),
        quantityBaseMilli: toMilli(form.get('qty')),
        reason: form.get('reason'),
        observation: (form.get('observation') || '').trim(),
      });
      invalidate(COL.products);
      notice(`Merma registrada por ${money(result.costoPerdidaCents)}.`);
      await ctx.refresh();
    },
  });
}

export default {
  async load() {
    return {};
  },

  render(_data, ctx) {
    const partnerId = ctx.params.socio || '';
    const term = searchKey(ctx.params.q || '');
    const onlyAlerts = ctx.params.alertas === '1';
    const products = ctx.catalogs.products.filter((product) => {
      if (partnerId && product.socioId !== partnerId) return false;
      if (term && !searchKey(product.nombre).includes(term)) return false;
      if (onlyAlerts && (product.stockBaseMilli || 0) > (product.stockMinimoBaseMilli || 0)) return false;
      return true;
    });

    const totalValue = products.reduce((total, product) => total + value(product), 0);
    const totalPotential = products.reduce((total, product) => total + potential(product), 0);
    const alerts = ctx.catalogs.products.filter((product) => (product.stockBaseMilli || 0) <= (product.stockMinimoBaseMilli || 0)).length;

    return `
      ${pageHeader('Inventario', 'Valuación al costo promedio ponderado.', `
        <button id="export-inventory" class="btn-secondary">Exportar CSV</button>
        <button id="new-waste" class="btn-secondary">+ Registrar merma</button>
        <button id="new-adjustment" class="btn-primary">+ Ajuste de inventario</button>`)}
      <section class="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        ${statCard('Productos', String(products.length))}
        ${statCard('Valor al costo', money(totalValue))}
        ${statCard('Venta potencial', money(totalPotential))}
        ${statCard('Ganancia potencial', money(totalPotential - totalValue))}
      </section>
      <form id="filters" class="no-print card mb-5 flex flex-wrap items-end gap-3">
        <label class="text-sm font-medium">Buscar<input name="q" class="field mt-1" value="${esc(ctx.params.q || '')}" placeholder="Producto"></label>
        <label class="text-sm font-medium">Socio${selectInput('socio', ctx.catalogs.partners, { selected: partnerId, placeholder: 'Todos' })}</label>
        <label class="flex items-center gap-2 pb-2 text-sm font-medium">
          <input type="checkbox" name="alertas" class="h-4 w-4"${onlyAlerts ? ' checked' : ''}> Solo alertas (${alerts})
        </label>
        <button class="btn-secondary">Filtrar</button>
      </form>
      ${dataTable({
        columns: [
          { label: 'Producto', format: (row) => `<b>${esc(row.nombre)}</b>` },
          { label: 'Socio', format: (row) => esc(ctx.catalogs.partners.find((p) => p.id === row.socioId)?.nombre || '—') },
          {
            label: 'Existencia',
            align: 'right',
            format: (row) => `${esc(quantity(row.stockBaseMilli))} ${esc(row.unidadBaseAbreviatura || row.unidadBaseNombre || '')}`,
          },
          { label: 'Mínimo', align: 'right', format: (row) => esc(quantity(row.stockMinimoBaseMilli)) },
          { label: 'Costo prom.', align: 'right', format: (row) => moneyCell(row.costoPromedioCents) },
          { label: 'Valor', align: 'right', format: (row) => moneyCell(value(row)) },
          { label: 'Venta potencial', align: 'right', format: (row) => moneyCell(potential(row)) },
          {
            label: 'Estado',
            format: (row) => ((row.stockBaseMilli || 0) <= 0
              ? badge('Sin existencia', 'red')
              : (row.stockBaseMilli || 0) <= (row.stockMinimoBaseMilli || 0) ? badge('Bajo mínimo', 'amber') : badge('Normal', 'green')),
          },
          { label: '', align: 'right', format: (row) => `<button data-kardex="${esc(row.id)}" class="btn-link">Kardex</button>` },
        ],
        rows: products,
        empty: ctx.catalogs.products.length
          ? 'No hay productos que coincidan con el filtro.'
          : 'Todavía no hay productos. El inventario se llena al crearlos y comprarlos.',
        emptyAction: ctx.catalogs.products.length ? null : { id: 'go-products-empty', label: '+ Nuevo producto' },
      })}`;
  },

  bind(_data, ctx) {
    qs('#filters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('inventario', {
        q: form.get('q'), socio: form.get('socio'), alertas: form.get('alertas') ? '1' : '',
      });
    });

    qsa('[data-kardex]').forEach((button) => {
      button.onclick = () => ctx.navigate('movimientos', { producto: button.dataset.kardex });
    });

    qs('#go-products-empty')?.addEventListener('click', () => ctx.navigate('productos'));

    qs('#export-inventory')?.addEventListener('click', () => downloadCsv(
      ctx.catalogs.products.map((product) => [
        product.nombre,
        ctx.catalogs.partners.find((partner) => partner.id === product.socioId)?.nombre || '',
        quantity(product.stockBaseMilli),
        product.unidadBaseNombre || '',
        (product.costoPromedioCents || 0) / 100,
        (product.precioVentaCents || 0) / 100,
        value(product) / 100,
      ]),
      {
        filename: 'inventario.csv',
        headers: ['Producto', 'Socio', 'Existencia', 'Unidad', 'Costo promedio Q', 'Precio Q', 'Valor Q'],
      },
    ));

    qs('#new-adjustment')?.addEventListener('click', () => openModal({
      title: 'Ajuste de inventario',
      body: `
        <div class="space-y-4">
          ${field('Producto', selectInput('productId', products, { required: true }))}
          ${field('Tipo de ajuste', `<select name="type" class="field mt-1" id="adjust-type" required>
            <option value="${MOVEMENT.initial}">Inventario inicial (ingreso con costo)</option>
            <option value="${MOVEMENT.adjustIn}">Ajuste positivo (sobrante)</option>
            <option value="${MOVEMENT.adjustOut}">Ajuste negativo (faltante)</option>
          </select>`)}
          ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
          <div id="cost-wrapper">${field('Costo unitario Q', textInput('cost', { type: 'number', step: '0.01', min: '0' }),
            'Se usa para recalcular el costo promedio. Déjelo vacío para conservar el costo actual.')}</div>
          ${field('Motivo', textInput('reason', { required: true, placeholder: 'Conteo físico, corrección, etc.' }))}
        </div>`,
      onReady: ({ dialog }) => {
        const type = qs('#adjust-type', dialog);
        type.onchange = () => {
          qs('#cost-wrapper', dialog).classList.toggle('hidden', type.value === MOVEMENT.adjustOut);
        };
      },
      onSubmit: async (form) => {
        await registerInventoryAdjustment({
          productId: form.get('productId'),
          type: form.get('type'),
          quantityBaseMilli: toMilli(form.get('qty')),
          unitCostCents: form.get('cost') ? toCents(form.get('cost')) : null,
          reason: (form.get('reason') || '').trim(),
        });
        invalidate(COL.products);
        notice('Ajuste registrado.');
        await ctx.refresh();
      },
    }));

    qs('#new-waste')?.addEventListener('click', () => openModal({
      title: 'Registrar merma',
      body: `
        <div class="space-y-4">
          ${field('Producto', selectInput('productId', products, { required: true }))}
          ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
          ${field('Motivo', `<select name="reason" class="field mt-1" required>${
            WASTE_REASONS.map((reason) => `<option>${esc(reason)}</option>`).join('')}</select>`)}
          ${field('Observación', textInput('observation'))}
        </div>`,
      onSubmit: async (form) => {
        const result = await registerWaste({
          productId: form.get('productId'),
          quantityBaseMilli: toMilli(form.get('qty')),
          reason: form.get('reason'),
          observation: (form.get('observation') || '').trim(),
        });
        invalidate(COL.products);
        notice(`Merma registrada por ${money(result.costoPerdidaCents)}.`);
        await ctx.refresh();
      },
    }));
  },
};

/** Movement history (kardex) for every product or a single one. */
export const movementsPage = {
  async load(ctx) {
    const productId = ctx.params.producto || '';
    const movements = productId
      ? await productHistory(productId, 200)
      : await recent(COL.inventory, 200);
    return { movements, productId };
  },

  render({ movements, productId }, ctx) {
    const product = ctx.catalogs.products.find((item) => item.id === productId);
    const labels = {
      [MOVEMENT.initial]: ['Inventario inicial', 'teal'],
      [MOVEMENT.purchase]: ['Compra', 'green'],
      [MOVEMENT.sale]: ['Venta', 'slate'],
      [MOVEMENT.saleReturn]: ['Devolución de venta', 'teal'],
      [MOVEMENT.supplierReturn]: ['Devolución a proveedor', 'amber'],
      [MOVEMENT.waste]: ['Merma', 'red'],
      [MOVEMENT.adjustIn]: ['Ajuste positivo', 'green'],
      [MOVEMENT.adjustOut]: ['Ajuste negativo', 'red'],
    };

    return `
      ${pageHeader(
        product ? `Kardex · ${product.nombre}` : 'Movimientos de inventario',
        'Toda entrada y salida queda registrada con su costo y existencia resultante.',
        `${product ? '<button id="clear-product" class="btn-secondary">Ver todos</button>' : ''}
         <button id="export-moves" class="btn-secondary">Exportar CSV</button>`,
      )}
      <form id="move-filters" class="no-print card mb-5 flex flex-wrap items-end gap-3">
        <label class="text-sm font-medium">Producto${selectInput('producto', ctx.catalogs.products, { selected: productId, placeholder: 'Todos' })}</label>
        <button class="btn-secondary">Filtrar</button>
      </form>
      ${dataTable({
        columns: [
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Producto', format: (row) => esc(row.productoNombre || ctx.catalogs.products.find((p) => p.id === row.productoId)?.nombre || '—') },
          { label: 'Tipo', format: (row) => badge(labels[row.tipoMovimiento]?.[0] || row.tipoMovimiento, labels[row.tipoMovimiento]?.[1] || 'slate') },
          {
            label: 'Cantidad',
            align: 'right',
            format: (row) => `<span class="${(row.cantidadBaseMilli || 0) < 0 ? 'text-red-700' : 'text-emerald-700'}">${
              (row.cantidadBaseMilli || 0) > 0 ? '+' : ''}${esc(quantity(row.cantidadBaseMilli))}</span>`,
          },
          { label: 'Costo unitario', align: 'right', format: (row) => moneyCell(row.costoUnitarioCents) },
          { label: 'Existencia', align: 'right', format: (row) => esc(quantity(row.existenciaResultanteBaseMilli)) },
          { label: 'Referencia', format: (row) => esc(row.referenciaNumero || row.referenciaTipo || '—') },
          { label: 'Observación', format: (row) => esc(row.observacion || '—') },
        ],
        rows: movements,
        empty: 'Todavía no hay movimientos de inventario. Se generan al comprar, vender, ajustar o registrar mermas.',
        emptyAction: { id: 'go-inventory-empty', label: 'Ir a Inventario' },
        dense: true,
      })}`;
  },

  bind({ movements }, ctx) {
    qs('#move-filters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      ctx.navigate('movimientos', { producto: new FormData(event.currentTarget).get('producto') });
    });
    qs('#clear-product')?.addEventListener('click', () => ctx.navigate('movimientos', {}));
    qs('#go-inventory-empty')?.addEventListener('click', () => ctx.navigate('inventario'));
    qs('#export-moves')?.addEventListener('click', () => downloadCsv(
      movements.map((move) => [
        dateTime(move.fecha), move.productoNombre || '', move.tipoMovimiento,
        quantity(move.cantidadBaseMilli), (move.costoUnitarioCents || 0) / 100,
        quantity(move.existenciaResultanteBaseMilli), move.referenciaNumero || '',
      ]),
      {
        filename: 'movimientos-inventario.csv',
        headers: ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Costo unitario Q', 'Existencia', 'Referencia'],
      },
    ));
  },
};

/** Waste log, kept separate so losses are easy to review. */
export const wastePage = {
  async load() {
    return { waste: await recent(COL.waste, 200) };
  },

  render({ waste }, ctx) {
    const total = waste.reduce((sum, record) => sum + (record.costoPerdidaCents || 0), 0);
    return `
      ${pageHeader('Mermas', 'Pérdidas de producto valuadas al costo promedio del momento.',
        '<button id="register-waste" class="btn-primary">Registrar merma</button>')}
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Registros', String(waste.length))}
        ${statCard('Pérdida acumulada', money(total))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Producto', format: (row) => esc(row.productoNombre || '—') },
          { label: 'Socio', format: (row) => esc(ctx.catalogs.partners.find((p) => p.id === row.socioId)?.nombre || '—') },
          { label: 'Cantidad', align: 'right', format: (row) => `${esc(quantity(row.cantidadBaseMilli))} ${esc(row.unidadNombre || '')}` },
          { label: 'Costo perdido', align: 'right', format: (row) => moneyCell(row.costoPerdidaCents) },
          { label: 'Motivo', format: (row) => esc(row.motivo || '—') },
        ],
        rows: waste,
        empty: 'No hay mermas registradas.',
        emptyAction: { id: 'register-waste-empty', label: 'Registrar merma' },
      })}`;
  },

  bind(_data, ctx) {
    qsa('#register-waste, #register-waste-empty').forEach((button) => {
      button.onclick = () => openModal({
        title: 'Registrar merma',
        body: `
          <div class="space-y-4">
            ${field('Producto', selectInput('productId', ctx.catalogs.products.filter((p) => p.activo !== false), { required: true }))}
            ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
            ${field('Motivo', `<select name="reason" class="field mt-1" required>${
              WASTE_REASONS.map((reason) => `<option>${esc(reason)}</option>`).join('')}</select>`)}
            ${field('Observación', textInput('observation'))}
          </div>`,
        onSubmit: async (form) => {
          const result = await registerWaste({
            productId: form.get('productId'),
            quantityBaseMilli: toMilli(form.get('qty')),
            reason: form.get('reason'),
            observation: (form.get('observation') || '').trim(),
          });
          invalidate(COL.products);
          notice(`Merma registrada por ${money(result.costoPerdidaCents)}.`);
          await ctx.refresh();
        },
      });
    });
  },
};
