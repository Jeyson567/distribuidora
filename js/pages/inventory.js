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

const productUnit = (product) => product.unidadBaseAbreviatura || product.unidadBaseNombre || '';

/** Simple stock entry: quantity only. No cash, purchases or suppliers. */
export function stockInModal(ctx, product) {
  if (!product) return;
  const costo = (product.costoCompraCents ?? product.costoPromedioCents) || 0;
  openModal({
    title: `+ Agregar existencia · ${product.nombre}`,
    submitLabel: 'Guardar entrada',
    body: `
      <div class="space-y-4">
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Existencia actual: <b>${esc(quantity(product.stockBaseMilli))} ${esc(productUnit(product))}</b>
          ${costo ? `<span class="ml-2 text-slate-500">· Costo Q ${(costo / 100).toFixed(2)}</span>` : ''}
        </p>
        ${field('Cantidad a ingresar', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }),
          'Se suma al inventario. No usa caja ni compras.')}
      </div>`,
    onSubmit: async (form) => {
      const result = await registerInventoryAdjustment({
        productId: product.id,
        type: MOVEMENT.adjustIn,
        quantityBaseMilli: toMilli(form.get('qty')),
        unitCostCents: costo || 0,
        reason: 'Entrada de mercancía',
      });
      invalidate(COL.products);
      notice(`Existencia actualizada: ${quantity(result.stockBaseMilli)} ${productUnit(product)}.`);
      await ctx.refresh();
    },
  });
}

/** Simple stock withdrawal / correction. */
export function stockOutModal(ctx, product) {
  if (!product) return;
  openModal({
    title: `− Ajustar / retirar · ${product.nombre}`,
    submitLabel: 'Guardar salida',
    body: `
      <div class="space-y-4">
        <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          Existencia actual: <b>${esc(quantity(product.stockBaseMilli))} ${esc(productUnit(product))}</b>
        </p>
        ${field('Cantidad a retirar', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }),
          'Se descuenta del inventario. No afecta caja.')}
        ${field('Motivo (opcional)', textInput('reason', { placeholder: 'Corrección, merma menor, etc.' }))}
      </div>`,
    onSubmit: async (form) => {
      const result = await registerInventoryAdjustment({
        productId: product.id,
        type: MOVEMENT.adjustOut,
        quantityBaseMilli: toMilli(form.get('qty')),
        reason: (form.get('reason') || '').trim() || 'Retiro de existencia',
      });
      invalidate(COL.products);
      notice(`Existencia actualizada: ${quantity(result.stockBaseMilli)} ${productUnit(product)}.`);
      await ctx.refresh();
    },
  });
}

/**
 * The two ways of moving inventory by hand. They live here so the inventory
 * screen, the movement history and the waste log all offer exactly the same
 * form instead of three slightly different copies.
 */
export function adjustmentModal(ctx, presetProductId = '') {
  const products = sellable(ctx);
  if (!products.length) {
    notice('Primero cree un producto: el ajuste se registra sobre un producto existente.', 'warn');
    return ctx.navigate('productos');
  }
  return openModal({
    title: 'Ajuste de inventario',
    body: `
      <div class="space-y-4">
        ${field('Producto', selectInput('productId', products, { selected: presetProductId, required: true, attrs: 'id="adjust-product"' }))}
        ${field('Tipo de movimiento', `<select name="type" class="field mt-1" id="adjust-type" required>
          <option value="${MOVEMENT.adjustIn}">Aumentar existencia</option>
          <option value="${MOVEMENT.adjustOut}">Disminuir existencia</option>
          <option value="${MOVEMENT.initial}">Inventario inicial</option>
        </select>`)}
        ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
        <div id="cost-wrapper">${field('Costo unitario Q', textInput('cost', { type: 'number', step: '0.01', min: '0', attrs: 'id="adjust-cost"' }),
    'Por defecto usa el costo del producto. No afecta caja.')}</div>
        ${field('Motivo', textInput('reason', { required: true, placeholder: 'Conteo físico, reposición, corrección, etc.' }))}
      </div>`,
    onReady: ({ dialog }) => {
      const type = qs('#adjust-type', dialog);
      const productSelect = qs('#adjust-product', dialog);
      const costInput = qs('#adjust-cost', dialog);
      const fillCost = () => {
        const product = products.find((item) => item.id === productSelect.value);
        const cents = product?.costoCompraCents ?? product?.costoPromedioCents;
        if (cents && !costInput.value) costInput.value = (cents / 100).toFixed(2);
      };
      type.onchange = () => {
        qs('#cost-wrapper', dialog).classList.toggle('hidden', type.value === MOVEMENT.adjustOut);
      };
      productSelect.onchange = () => {
        costInput.value = '';
        fillCost();
      };
      fillCost();
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
      ${pageHeader('Inventario', 'Sume o retire existencias por producto. No usa caja ni compras.', `
        <button id="export-inventory" class="btn-secondary">Exportar CSV</button>
        <button id="new-waste" class="btn-secondary">+ Registrar merma</button>`)}
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
          { label: 'Costo', align: 'right', format: (row) => moneyCell(row.costoCompraCents ?? row.costoPromedioCents) },
          { label: 'Valor', align: 'right', format: (row) => moneyCell(value(row)) },
          {
            label: 'Estado',
            format: (row) => ((row.stockBaseMilli || 0) <= 0
              ? badge('Sin existencia', 'red')
              : (row.stockBaseMilli || 0) <= (row.stockMinimoBaseMilli || 0) ? badge('Bajo mínimo', 'amber') : badge('Normal', 'green')),
          },
          {
            label: '',
            align: 'right',
            format: (row) => `
              <button data-stock-in="${esc(row.id)}" class="btn-link">+ Agregar existencia</button>
              <button data-stock-out="${esc(row.id)}" class="btn-link">− Ajustar / retirar</button>
              <button data-kardex="${esc(row.id)}" class="btn-link">Kardex</button>`,
          },
        ],
        rows: products,
        empty: ctx.catalogs.products.length
          ? 'No hay productos que coincidan con el filtro.'
          : 'Todavía no hay productos. Agréguelos en Productos con su cantidad inicial.',
        emptyAction: ctx.catalogs.products.length ? null : { id: 'go-products-empty', label: '+ Agregar producto' },
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

    qsa('[data-stock-in]').forEach((button) => {
      button.onclick = () => {
        const product = ctx.catalogs.products.find((item) => item.id === button.dataset.stockIn);
        stockInModal(ctx, product);
      };
    });
    qsa('[data-stock-out]').forEach((button) => {
      button.onclick = () => {
        const product = ctx.catalogs.products.find((item) => item.id === button.dataset.stockOut);
        stockOutModal(ctx, product);
      };
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
        ((product.costoCompraCents ?? product.costoPromedioCents) || 0) / 100,
        (product.precioVentaCents || 0) / 100,
        value(product) / 100,
      ]),
      {
        filename: 'inventario.csv',
        headers: ['Producto', 'Socio', 'Existencia', 'Unidad', 'Costo Q', 'Precio Q', 'Valor Q'],
      },
    ));

    qs('#new-waste')?.addEventListener('click', () => wasteModal(ctx));
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
      [MOVEMENT.initial]: ['Ajuste', 'teal'],
      [MOVEMENT.purchase]: ['Entrada', 'green'],
      [MOVEMENT.sale]: ['Salida', 'slate'],
      [MOVEMENT.saleReturn]: ['Entrada', 'teal'],
      [MOVEMENT.supplierReturn]: ['Salida', 'amber'],
      [MOVEMENT.waste]: ['Salida', 'red'],
      [MOVEMENT.adjustIn]: ['Entrada', 'green'],
      [MOVEMENT.adjustOut]: ['Salida', 'red'],
    };

    return `
      ${pageHeader(
        product ? `Kardex · ${product.nombre}` : 'Movimientos de inventario',
        'Entradas y salidas de inventario con existencia anterior y nueva.',
        `${product ? '<button id="clear-product" class="btn-secondary">Ver todos</button>' : ''}
         <button id="export-moves" class="btn-secondary">Exportar CSV</button>
         <button id="new-waste-moves" class="btn-secondary">+ Registrar merma</button>`,
      )}
      <form id="move-filters" class="no-print card mb-5 flex flex-wrap items-end gap-3">
        <label class="text-sm font-medium">Producto${selectInput('producto', ctx.catalogs.products, { selected: productId, placeholder: 'Todos' })}</label>
        <button class="btn-secondary">Filtrar</button>
      </form>
      ${dataTable({
        columns: [
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Producto', format: (row) => esc(row.productoNombre || ctx.catalogs.products.find((p) => p.id === row.productoId)?.nombre || '—') },
          {
            label: 'Tipo',
            format: (row) => {
              const label = row.tipo || labels[row.tipoMovimiento]?.[0] || row.tipoMovimiento;
              const tone = labels[row.tipoMovimiento]?.[1] || 'slate';
              return badge(label, tone);
            },
          },
          {
            label: 'Cantidad',
            align: 'right',
            format: (row) => `<span class="${(row.cantidadBaseMilli || 0) < 0 ? 'text-red-700' : 'text-emerald-700'}">${
              (row.cantidadBaseMilli || 0) > 0 ? '+' : ''}${esc(quantity(row.cantidadBaseMilli))}</span>`,
          },
          {
            label: 'Exist. anterior',
            align: 'right',
            format: (row) => (row.existenciaAnteriorBaseMilli == null
              ? '—'
              : esc(quantity(row.existenciaAnteriorBaseMilli))),
          },
          {
            label: 'Exist. nueva',
            align: 'right',
            format: (row) => esc(quantity(row.existenciaNuevaBaseMilli ?? row.existenciaResultanteBaseMilli)),
          },
          { label: 'Usuario', format: (row) => esc(row.usuarioEmail || '—') },
          { label: 'Observación', format: (row) => esc(row.observacion || '—') },
        ],
        rows: movements,
        empty: 'Todavía no hay movimientos. Se generan al agregar o retirar existencias, vender o registrar mermas.',
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
    qs('#new-waste-moves')?.addEventListener('click', () => wasteModal(ctx));
    qs('#export-moves')?.addEventListener('click', () => downloadCsv(
      movements.map((move) => [
        dateTime(move.fecha),
        move.productoNombre || '',
        move.tipo || move.tipoMovimiento,
        quantity(move.cantidadBaseMilli),
        quantity(move.existenciaAnteriorBaseMilli),
        quantity(move.existenciaNuevaBaseMilli ?? move.existenciaResultanteBaseMilli),
        move.usuarioEmail || '',
        move.observacion || '',
      ]),
      {
        filename: 'movimientos-inventario.csv',
        headers: ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Exist. anterior', 'Exist. nueva', 'Usuario', 'Observación'],
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
        '<button id="register-waste" class="btn-primary">+ Registrar merma</button>')}
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
        emptyAction: { id: 'register-waste-empty', label: '+ Registrar merma' },
      })}`;
  },

  bind(_data, ctx) {
    qsa('#register-waste, #register-waste-empty').forEach((button) => {
      button.onclick = () => wasteModal(ctx);
    });
  },
};
