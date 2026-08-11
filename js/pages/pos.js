import { PAYMENT } from '../domain/constants.js';
import { productUnits, resolveUnit } from '../domain/units.js';
import { registerSale } from '../services/transactions.js';
import { COL, create, invalidate, read, searchKey } from '../services/db.js';
import { generateSaleReceiptHtml, openPrintWindow } from '../services/printing.js';
import { field, optionList, pageHeader, textInput } from '../ui/components.js';
import { esc, notice, openModal, qs, qsa, reportError } from '../ui/dom.js';
import { money, quantity } from '../utils/format.js';
import { inputDate } from '../utils/dates.js';
import { scale, toCents, toMilli } from '../utils/math.js';

const cart = [];
let cartSeed = 0;

const lineTotalCents = (line) => Math.max(0, scale(line.quantityMilli, line.unitPriceCents) - line.discountCents);
const cartTotalCents = () => cart.reduce((total, line) => total + lineTotalCents(line), 0);

const productCard = (product, ctx) => {
  const stock = product.stockBaseMilli || 0;
  const low = stock <= (product.stockMinimoBaseMilli || 0);
  const category = ctx.catalogs.categories.find((item) => item.id === product.categoriaId)?.nombre || '';
  return `
    <button type="button" data-add="${esc(product.id)}"
      class="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-teal-600 hover:shadow"
      data-search="${esc(searchKey(`${product.nombre} ${product.codigo || ''} ${category}`))}"
      data-category="${esc(product.categoriaId || '')}" data-partner="${esc(product.socioId || '')}">
      <span class="line-clamp-2 font-semibold text-slate-900">${esc(product.nombre)}</span>
      <span class="mt-1 text-sm font-bold text-teal-700">${esc(money(product.precioVentaCents))}</span>
      <span class="text-xs text-slate-500">por ${esc(product.unidadBaseNombre || 'unidad')}</span>
      <span class="mt-auto pt-2 text-xs ${low ? 'font-semibold text-amber-700' : 'text-slate-500'}">
        ${stock <= 0 ? 'Sin existencia' : `Disponible ${esc(quantity(stock))}`}
      </span>
    </button>`;
};

const cartHtml = (ctx) => {
  if (!cart.length) {
    return '<p class="py-10 text-center text-sm text-slate-500">Seleccione productos para iniciar la venta.</p>';
  }
  return cart.map((line) => {
    const units = productUnits(line.product);
    return `
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-semibold">${esc(line.product.nombre)}</p>
            <p class="text-xs text-slate-500">${esc(ctx.catalogs.partners.find((p) => p.id === line.product.socioId)?.nombre || '')}</p>
          </div>
          <button type="button" data-remove="${line.key}" class="text-sm font-semibold text-red-700">Quitar</button>
        </div>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <label class="text-xs text-slate-500">Cantidad
            <input data-qty="${line.key}" class="field mt-1" type="number" step="0.001" min="0.001" value="${line.quantityMilli / 1000}">
          </label>
          <label class="text-xs text-slate-500">Unidad
            <select data-unit="${line.key}" class="field mt-1">
              ${units.map((unit) => `<option value="${esc(unit.id)}"${unit.id === line.unit.id ? ' selected' : ''}>${esc(unit.nombre)}</option>`).join('')}
            </select>
          </label>
          <label class="text-xs text-slate-500">Precio Q
            <input data-price="${line.key}" class="field mt-1" type="number" step="0.01" min="0" value="${line.unitPriceCents / 100}">
          </label>
        </div>
        <div class="mt-2 flex items-center justify-between gap-2">
          <label class="text-xs text-slate-500">Descuento Q
            <input data-discount="${line.key}" class="field mt-1 w-28" type="number" step="0.01" min="0" value="${line.discountCents / 100}">
          </label>
          <p class="self-end text-right text-base font-bold">${esc(money(lineTotalCents(line)))}</p>
        </div>
      </div>`;
  }).join('');
};

const paymentBody = (totalCents, customer) => `
  <div class="space-y-4">
    <p class="rounded-lg bg-slate-900 px-4 py-3 text-right text-2xl font-bold text-white">Total ${esc(money(totalCents))}</p>
    <div class="grid gap-3 sm:grid-cols-2">
      ${field('Efectivo Q', textInput('efectivo', { type: 'number', step: '0.01', min: '0', value: '', attrs: 'data-pay' }))}
      ${field('Tarjeta Q', textInput('tarjeta', { type: 'number', step: '0.01', min: '0', attrs: 'data-pay' }))}
      ${field('Transferencia Q', textInput('transferencia', { type: 'number', step: '0.01', min: '0', attrs: 'data-pay' }))}
      ${field('Crédito Q', textInput('credito', { type: 'number', step: '0.01', min: '0', attrs: 'data-pay' }),
        customer ? `Disponible ${money(Math.max(0, (customer.limiteCreditoCents || 0) - (customer.saldoActualCents || 0)))}` : '')}
    </div>
    ${field('Vence el (crédito)', textInput('vencimiento', { type: 'date', value: inputDate(Date.now() + 15 * 86400000) }))}
    ${field('Observación', textInput('observacion'))}
    <div class="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
      <span>Recibido</span><b data-received class="text-right tabular-nums">Q0.00</b>
      <span data-change-label>Faltante</span><b data-change class="text-right tabular-nums">${esc(money(totalCents))}</b>
    </div>
    <button type="button" id="exact-cash" class="btn-secondary w-full">Pago exacto en efectivo</button>
  </div>`;

export default {
  async load() {
    return {};
  },

  render(_data, ctx) {
    if (!ctx.cashSession) {
      return `
        ${pageHeader('Punto de venta')}
        <div class="card mx-auto max-w-lg text-center">
          <h2 class="text-lg font-bold">La caja está cerrada</h2>
          <p class="mt-2 text-sm text-slate-600">Debe abrir la caja antes de registrar ventas, cobros o gastos.</p>
          <button id="go-cash" class="btn-primary mt-5">Ir a Caja</button>
        </div>`;
    }

    const products = ctx.catalogs.products.filter((product) => product.activo !== false);
    const customers = ctx.catalogs.customers.filter((customer) => customer.activo !== false);
    const generalCustomer = customers.find((customer) => customer.id === 'cliente-general') || customers[0];

    if (!products.length) {
      return `
        ${pageHeader('Punto de venta')}
        <div class="card mx-auto max-w-lg text-center">
          <h2 class="text-lg font-bold">No hay productos activos</h2>
          <p class="mt-2 text-sm text-slate-600">Cree productos y registre su inventario para comenzar a vender.</p>
          <button id="go-products" class="btn-primary mt-5">Ir a Productos</button>
        </div>`;
    }

    return `
      ${pageHeader('Punto de venta', 'Busque, seleccione la unidad y cobre. Una venta puede incluir productos de varios socios.')}
      <div class="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section class="min-w-0">
          <div class="card mb-4">
            <input id="pos-search" class="field" placeholder="Buscar producto por nombre, código o categoría" autocomplete="off" autofocus>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" data-filter="" class="chip chip-active">Todas</button>
              ${ctx.catalogs.categories.filter((category) => category.activo !== false)
                .map((category) => `<button type="button" data-filter="${esc(category.id)}" class="chip">${esc(category.nombre)}</button>`).join('')}
            </div>
          </div>
          <div id="pos-products" class="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
            ${products.map((product) => productCard(product, ctx)).join('')}
          </div>
          <p id="pos-empty" class="hidden py-10 text-center text-sm text-slate-500">Ningún producto coincide con la búsqueda.</p>
        </section>

        <section class="card sticky top-4 flex max-h-[calc(100vh-2rem)] flex-col self-start">
          <h2 class="text-lg font-bold">Venta actual</h2>
          <div class="mt-3">
            <label class="block text-sm font-medium" for="pos-customer">Cliente</label>
            <div class="mt-1 flex gap-2">
              <select id="pos-customer" class="field">${optionList(customers, generalCustomer?.id || '', '')}</select>
              <button type="button" id="new-customer" class="btn-secondary px-3" title="Nuevo cliente">+</button>
            </div>
          </div>
          <div id="cart" class="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"></div>
          <div class="mt-4 border-t border-slate-200 pt-4">
            <div class="flex items-center justify-between text-sm text-slate-600">
              <span id="cart-count">0 productos</span>
              <button type="button" id="clear-cart" class="text-sm font-semibold text-red-700">Vaciar</button>
            </div>
            <p class="mt-2 flex items-baseline justify-between">
              <span class="text-sm text-slate-500">Total</span>
              <b id="cart-total" class="text-3xl font-bold tabular-nums">Q0.00</b>
            </p>
            <button id="checkout" class="btn-primary mt-4 w-full py-3 text-base" disabled>Cobrar</button>
          </div>
        </section>
      </div>`;
  },

  bind(_data, ctx) {
    qs('#go-cash')?.addEventListener('click', () => ctx.navigate('caja'));
    qs('#go-products')?.addEventListener('click', () => ctx.navigate('productos'));
    if (!ctx.cashSession || !qs('#cart')) return;

    const container = qs('#cart');
    const redraw = () => {
      container.innerHTML = cartHtml(ctx);
      const total = cartTotalCents();
      qs('#cart-total').textContent = money(total);
      qs('#cart-count').textContent = `${cart.length} producto${cart.length === 1 ? '' : 's'}`;
      qs('#checkout').disabled = !cart.length;

      qsa('[data-remove]', container).forEach((button) => {
        button.onclick = () => {
          const index = cart.findIndex((line) => line.key === Number(button.dataset.remove));
          cart.splice(index, 1);
          redraw();
        };
      });
      qsa('[data-qty]', container).forEach((input) => {
        input.onchange = () => {
          const line = cart.find((item) => item.key === Number(input.dataset.qty));
          line.quantityMilli = Math.max(1, toMilli(input.value));
          redraw();
        };
      });
      qsa('[data-price]', container).forEach((input) => {
        input.onchange = () => {
          const line = cart.find((item) => item.key === Number(input.dataset.price));
          line.unitPriceCents = Math.max(0, toCents(input.value));
          redraw();
        };
      });
      qsa('[data-discount]', container).forEach((input) => {
        input.onchange = () => {
          const line = cart.find((item) => item.key === Number(input.dataset.discount));
          line.discountCents = Math.max(0, toCents(input.value));
          redraw();
        };
      });
      qsa('[data-unit]', container).forEach((select) => {
        select.onchange = () => {
          const line = cart.find((item) => item.key === Number(select.dataset.unit));
          line.unit = resolveUnit(line.product, select.value);
          line.unitPriceCents = line.unit.precioVentaCents
            || Math.round((line.product.precioVentaCents * line.unit.factorMilli) / 1000);
          redraw();
        };
      });
    };

    const addProduct = (product) => {
      const unit = resolveUnit(product, product.unidadBaseId);
      const existing = cart.find((line) => line.product.id === product.id && line.unit.id === unit.id);
      if (existing) existing.quantityMilli += 1000;
      else {
        cartSeed += 1;
        cart.push({
          key: cartSeed,
          product,
          unit,
          quantityMilli: 1000,
          unitPriceCents: unit.precioVentaCents || product.precioVentaCents,
          discountCents: 0,
        });
      }
      redraw();
    };

    qsa('[data-add]').forEach((button) => {
      button.onclick = () => addProduct(ctx.catalogs.products.find((product) => product.id === button.dataset.add));
    });

    const applyFilters = () => {
      const term = searchKey(qs('#pos-search').value);
      const category = qs('.chip-active')?.dataset.filter || '';
      let visible = 0;
      qsa('[data-add]').forEach((button) => {
        const matches = (!term || button.dataset.search.includes(term))
          && (!category || button.dataset.category === category);
        button.classList.toggle('hidden', !matches);
        if (matches) visible += 1;
      });
      qs('#pos-empty').classList.toggle('hidden', visible > 0);
    };

    qs('#pos-search').oninput = applyFilters;
    qs('#pos-search').onkeydown = (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const first = qsa('[data-add]').find((button) => !button.classList.contains('hidden'));
      if (!first) return;
      addProduct(ctx.catalogs.products.find((product) => product.id === first.dataset.add));
      qs('#pos-search').select();
    };
    qsa('[data-filter]').forEach((chip) => {
      chip.onclick = () => {
        qsa('[data-filter]').forEach((item) => item.classList.remove('chip-active'));
        chip.classList.add('chip-active');
        applyFilters();
      };
    });

    qs('#clear-cart').onclick = () => {
      cart.splice(0);
      redraw();
    };

    qs('#new-customer').onclick = () => openModal({
      title: 'Nuevo cliente',
      submitLabel: 'Crear cliente',
      body: `
        <div class="grid gap-4 sm:grid-cols-2">
          ${field('Nombre', textInput('nombre', { required: true }))}
          ${field('Teléfono', textInput('telefono'))}
          ${field('NIT', textInput('nit'))}
          ${field('Límite de crédito Q', textInput('limite', { type: 'number', step: '0.01', min: '0', value: 0 }),
            'Deje 0 si el cliente no compra al crédito.')}
        </div>`,
      onSubmit: async (form) => {
        const nombre = (form.get('nombre') || '').trim();
        await create(COL.customers, {
          nombre,
          nombreBusqueda: searchKey(nombre),
          telefono: (form.get('telefono') || '').trim() || null,
          nit: (form.get('nit') || '').trim() || null,
          limiteCreditoCents: toCents(form.get('limite') || 0),
          saldoActualCents: 0,
          totalCompradoCents: 0,
          totalPagadoCents: 0,
          activo: true,
        });
        invalidate(COL.customers);
        notice(`Cliente ${nombre} creado.`);
        await ctx.refresh();
      },
    });

    qs('#checkout').onclick = () => {
      const total = cartTotalCents();
      const customerId = qs('#pos-customer').value;
      const customer = ctx.catalogs.customers.find((item) => item.id === customerId);
      if (!customer) return notice('Seleccione un cliente.', 'error');

      openModal({
        title: `Cobrar · ${customer.nombre}`,
        submitLabel: 'Confirmar venta',
        body: paymentBody(total, customer),
        onReady: ({ dialog }) => {
          const update = () => {
            const received = ['efectivo', 'tarjeta', 'transferencia', 'credito']
              .reduce((sum, name) => sum + toCents(qs(`[name="${name}"]`, dialog).value || 0), 0);
            const difference = received - total;
            qs('[data-received]', dialog).textContent = money(received);
            qs('[data-change-label]', dialog).textContent = difference >= 0 ? 'Cambio' : 'Faltante';
            qs('[data-change]', dialog).textContent = money(Math.abs(difference));
            qs('[data-change]', dialog).className = `text-right tabular-nums ${difference < 0 ? 'text-red-700' : 'text-emerald-700'}`;
          };
          qsa('[data-pay]', dialog).forEach((input) => { input.oninput = update; });
          qs('#exact-cash', dialog).onclick = () => {
            qs('[name="efectivo"]', dialog).value = (total / 100).toFixed(2);
            update();
          };
          update();
        },
        onSubmit: async (form) => {
          const payments = [
            [PAYMENT.cash, toCents(form.get('efectivo') || 0)],
            [PAYMENT.card, toCents(form.get('tarjeta') || 0)],
            [PAYMENT.transfer, toCents(form.get('transferencia') || 0)],
            [PAYMENT.credit, toCents(form.get('credito') || 0)],
          ].filter(([, amount]) => amount > 0)
            .map(([method, amountCents]) => ({
              method,
              amountCents,
              dueDate: method === PAYMENT.credit ? (form.get('vencimiento') || null) : null,
            }));

          const result = await registerSale({
            customerId,
            lines: cart.map((line) => ({
              productId: line.product.id,
              unitId: line.unit.id,
              quantityMilli: line.quantityMilli,
              unitPriceCents: line.unitPriceCents,
              discountCents: line.discountCents,
            })),
            payments,
            observation: (form.get('observacion') || '').trim(),
          });

          cart.splice(0);
          invalidate(COL.products, COL.customers);
          notice(`Venta ${result.numero} registrada${result.cambioCents ? ` · Cambio ${money(result.cambioCents)}` : ''}.`);
          // The screen is refreshed first: rendering closes open dialogs, so the
          // receipt has to be offered afterwards.
          await ctx.refresh();
          await showReceipt(result.id, ctx);
        },
      });
    };

    redraw();
  },
};

/** Offers the printable receipt from a user gesture so popups are not blocked. */
async function showReceipt(saleId, ctx) {
  try {
    const sale = await read(COL.sales, saleId);
    if (!sale) return;
    openModal({
      title: `Venta ${sale.numero} registrada`,
      submitLabel: 'Imprimir comprobante',
      body: `
        <div class="space-y-2 text-sm">
          <p class="text-2xl font-bold">${esc(money(sale.totalCents))}</p>
          <p>Cliente: <b>${esc(sale.clienteNombre)}</b></p>
          ${sale.cambioCents ? `<p>Cambio a entregar: <b>${esc(money(sale.cambioCents))}</b></p>` : ''}
          ${sale.creditoCents ? `<p>Queda a crédito: <b>${esc(money(sale.creditoCents))}</b></p>` : ''}
          <p class="text-slate-500">El comprobante se imprime en tamaño carta.</p>
        </div>`,
      onSubmit: () => {
        openPrintWindow(generateSaleReceiptHtml(sale, ctx.business), { title: `Venta ${sale.numero}` });
      },
    });
  } catch (error) {
    reportError(error, 'La venta se registró, pero no se pudo cargar el comprobante.');
  }
}
