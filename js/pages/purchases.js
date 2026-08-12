import { PAYMENT } from '../domain/constants.js';
import { productUnits } from '../domain/units.js';
import { registerPurchase, registerSupplierReturn } from '../services/transactions.js';
import { COL, between, invalidate } from '../services/db.js';
import { generateDocumentHtml, openPrintWindow } from '../services/printing.js';
import { badge, dataTable, field, moneyCell, optionList, pageHeader, rangeFilter, selectInput, statCard, textInput } from '../ui/components.js';
import { esc, notice, openModal, qs, qsa } from '../ui/dom.js';
import { dateOnly, dateTime, money, quantity } from '../utils/format.js';
import { inputDate, resolveRange } from '../utils/dates.js';
import { toCents, toMilli } from '../utils/math.js';

const lineRow = (index, products) => `
  <div class="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_5.5rem_6.5rem_2rem] items-end gap-2" data-line="${index}">
    <label class="text-xs text-slate-500">Producto
      <select class="field mt-1" data-product="${index}" required>${optionList(products, '')}</select>
    </label>
    <label class="text-xs text-slate-500">Unidad
      <select class="field mt-1" data-unit="${index}" required></select>
    </label>
    <label class="text-xs text-slate-500">Cantidad
      <input class="field mt-1" data-qty="${index}" type="number" step="0.001" min="0.001" required>
    </label>
    <label class="text-xs text-slate-500">Costo Q
      <input class="field mt-1" data-cost="${index}" type="number" step="0.01" min="0" required>
    </label>
    <button type="button" data-drop="${index}" class="mb-2 text-xl text-red-700" aria-label="Quitar">&times;</button>
  </div>`;

function purchaseModal(ctx) {
  const products = ctx.catalogs.products.filter((product) => product.activo !== false);
  const suppliers = ctx.catalogs.suppliers.filter((supplier) => supplier.activo !== false);
  if (!products.length) {
    return notice('Registre al menos un producto antes de comprar.', 'warn');
  }

  let counter = 0;
  openModal({
    title: 'Registrar compra',
    size: 'xl',
    submitLabel: 'Guardar compra',
    body: `
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          ${suppliers.length
    ? field('Proveedor (opcional)', selectInput('supplier', suppliers, { placeholder: 'Sin proveedor' }),
      'El costo se toma de cada línea; no depende del proveedor.')
    : `<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 sm:col-span-2">La compra se registra sin proveedor. El costo queda en cada producto.</p>`}
          ${field('Documento / referencia', textInput('documento', { placeholder: 'Factura, recibo, etc.' }))}
        </div>
        <div>
          <p class="mb-2 text-sm font-medium text-slate-700">Productos</p>
          <div id="lines" class="space-y-2"></div>
          <button type="button" id="add-line" class="btn-secondary mt-2">Agregar producto</button>
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          ${field('Condición', `<select name="method" class="field mt-1" id="purchase-method">
            <option value="CONTADO">Contado</option>
            ${suppliers.length ? '<option value="CREDITO">Crédito</option>' : ''}
          </select>`)}
          <div id="settlement-wrapper">${field('Forma de pago', `<select name="settlement" class="field mt-1">
            <option value="${PAYMENT.cash}">Efectivo</option>
            <option value="${PAYMENT.transfer}">Transferencia</option>
            <option value="${PAYMENT.card}">Tarjeta</option>
          </select>`)}</div>
          <div id="due-wrapper" class="hidden">${field('Vence el', textInput('due', { type: 'date', value: inputDate(Date.now() + 30 * 86400000) }))}</div>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          ${field('Descuento general Q', textInput('discount', { type: 'number', step: '0.01', min: '0', value: 0 }))}
          ${field('Observación', textInput('observation'))}
        </div>
        <p class="rounded-lg bg-slate-50 p-3 text-right text-lg font-bold">Total <span id="purchase-total">Q0.00</span></p>
      </div>`,
    onReady: ({ dialog }) => {
      const container = qs('#lines', dialog);
      const recalc = () => {
        let total = 0;
        qsa('[data-line]', dialog).forEach((row) => {
          const index = row.dataset.line;
          total += Math.round((toMilli(qs(`[data-qty="${index}"]`, dialog).value) * toCents(qs(`[data-cost="${index}"]`, dialog).value)) / 1000);
        });
        total -= toCents(qs('[name="discount"]', dialog).value || 0);
        qs('#purchase-total', dialog).textContent = money(Math.max(0, total));
      };

      const fillUnits = (index) => {
        const productId = qs(`[data-product="${index}"]`, dialog).value;
        const product = products.find((item) => item.id === productId);
        const select = qs(`[data-unit="${index}"]`, dialog);
        select.innerHTML = product
          ? productUnits(product).map((unit) => `<option value="${esc(unit.id)}">${esc(unit.nombre)}</option>`).join('')
          : '';
        const cost = qs(`[data-cost="${index}"]`, dialog);
        if (product && !cost.value) cost.value = product.costoPromedioCents ? (product.costoPromedioCents / 100).toFixed(2) : '';
        recalc();
      };

      const addLine = () => {
        const index = counter;
        counter += 1;
        container.insertAdjacentHTML('beforeend', lineRow(index, products));
        qs(`[data-product="${index}"]`, dialog).onchange = () => fillUnits(index);
        qs(`[data-unit="${index}"]`, dialog).onchange = recalc;
        qs(`[data-qty="${index}"]`, dialog).oninput = recalc;
        qs(`[data-cost="${index}"]`, dialog).oninput = recalc;
        qs(`[data-drop="${index}"]`, dialog).onclick = () => {
          qs(`[data-line="${index}"]`, dialog).remove();
          recalc();
        };
        fillUnits(index);
      };

      qs('#add-line', dialog).onclick = addLine;
      qs('[name="discount"]', dialog).oninput = recalc;
      qs('#purchase-method', dialog).onchange = (event) => {
        const credit = event.target.value === 'CREDITO';
        qs('#due-wrapper', dialog).classList.toggle('hidden', !credit);
        qs('#settlement-wrapper', dialog).classList.toggle('hidden', credit);
      };
      addLine();
    },
    onSubmit: async (form, { dialog }) => {
      const lines = qsa('[data-line]', dialog).map((row) => {
        const index = row.dataset.line;
        return {
          productId: qs(`[data-product="${index}"]`, dialog).value,
          unitId: qs(`[data-unit="${index}"]`, dialog).value,
          quantityMilli: toMilli(qs(`[data-qty="${index}"]`, dialog).value),
          unitCostCents: toCents(qs(`[data-cost="${index}"]`, dialog).value),
        };
      });
      const result = await registerPurchase({
        supplierId: form.get('supplier') || null,
        lines,
        paymentMethod: form.get('method'),
        settlementMethod: form.get('settlement'),
        dueDate: form.get('method') === 'CREDITO' ? form.get('due') : null,
        discountCents: toCents(form.get('discount') || 0),
        observation: [form.get('documento'), form.get('observation')].filter(Boolean).join(' · '),
      });
      invalidate(COL.products, COL.suppliers);
      notice(`Compra ${result.numero} registrada por ${money(result.totalCents)}.`);
      await ctx.refresh();
    },
  });
}

export default {
  async load(ctx) {
    const range = {
      preset: ctx.params.preset || 'mes',
      from: ctx.params.from || '',
      to: ctx.params.to || '',
    };
    const { from, to } = resolveRange(range.preset, range);
    return { purchases: await between(COL.purchases, from, to, 300), range };
  },

  render({ purchases, range }, ctx) {
    const total = purchases.reduce((sum, purchase) => sum + (purchase.totalCents || 0), 0);
    const credit = purchases.filter((purchase) => purchase.metodoPago === 'CREDITO')
      .reduce((sum, purchase) => sum + (purchase.totalCents || 0), 0);

    return `
      ${pageHeader('Compras', 'Cada compra actualiza existencias y costo promedio ponderado dentro de una transacción.', `
        ${ctx.catalogs.suppliers.some((s) => s.activo !== false) ? '<button id="supplier-return" class="btn-secondary">Devolver mercancía</button>' : ''}
        <button id="new-purchase" class="btn-primary">+ Registrar compra</button>`)}
      ${rangeFilter(range)}
      <section class="mb-6 grid gap-4 sm:grid-cols-3">
        ${statCard('Compras del período', money(total), `${purchases.length} documentos`)}
        ${statCard('Compradas al crédito', money(credit))}
        ${statCard('Compradas de contado', money(total - credit))}
      </section>
      ${dataTable({
        columns: [
          { label: 'Número', format: (row) => `<b>${esc(row.numero)}</b>` },
          { label: 'Fecha', format: (row) => esc(dateTime(row.fecha)) },
          { label: 'Proveedor', format: (row) => esc(row.proveedorNombre || '—') },
          { label: 'Productos', align: 'right', format: (row) => String((row.lineas || []).length) },
          { label: 'Total', align: 'right', format: (row) => moneyCell(row.totalCents) },
          { label: 'Condición', format: (row) => badge(row.metodoPago === 'CREDITO' ? 'Crédito' : 'Contado', row.metodoPago === 'CREDITO' ? 'amber' : 'green') },
          { label: 'Vence', format: (row) => esc(row.fechaVencimiento ? dateOnly(row.fechaVencimiento) : '—') },
          { label: '', align: 'right', format: (row) => `<button data-view="${esc(row.id)}" class="btn-link">Ver</button>` },
        ],
        rows: purchases,
        empty: 'No hay compras en el período seleccionado.',
        emptyAction: { id: 'new-purchase-empty', label: '+ Registrar compra' },
      })}`;
  },

  bind({ purchases }, ctx) {
    qsa('#new-purchase, #new-purchase-empty').forEach((button) => {
      button.onclick = () => purchaseModal(ctx);
    });
    qs('#range-filter')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      ctx.navigate('compras', { preset: form.get('preset'), from: form.get('from'), to: form.get('to') });
    });

    qsa('[data-view]').forEach((button) => {
      button.onclick = () => {
        const purchase = purchases.find((item) => item.id === button.dataset.view);
        openModal({
          title: `Compra ${purchase.numero}`,
          size: 'lg',
          submitLabel: 'Imprimir',
          body: `
            <div class="space-y-3 text-sm">
              <p>Proveedor: <b>${esc(purchase.proveedorNombre)}</b> · ${esc(dateTime(purchase.fecha))}</p>
              <div class="overflow-x-auto rounded-lg border border-slate-200">
                <table class="w-full text-sm">
                  <thead class="bg-slate-50 text-left text-slate-600"><tr>
                    <th class="px-3 py-2">Producto</th><th class="px-3 py-2 text-right">Cantidad</th>
                    <th class="px-3 py-2 text-right">Costo</th><th class="px-3 py-2 text-right">Importe</th>
                    <th class="px-3 py-2 text-right">Costo prom. resultante</th>
                  </tr></thead>
                  <tbody>${(purchase.lineas || []).map((line) => `
                    <tr class="border-t border-slate-100">
                      <td class="px-3 py-2">${esc(line.productoNombre)}</td>
                      <td class="px-3 py-2 text-right">${esc(quantity(line.cantidadMilli))} ${esc(line.unidadNombre || '')}</td>
                      <td class="px-3 py-2 text-right">${esc(money(line.unitCostCents))}</td>
                      <td class="px-3 py-2 text-right">${esc(money(line.subtotalNetoCents ?? line.subtotalCents))}</td>
                      <td class="px-3 py-2 text-right">${esc(money(line.costoPromedioResultanteCents))}</td>
                    </tr>`).join('')}</tbody>
                </table>
              </div>
              <p class="text-right text-lg font-bold">Total ${esc(money(purchase.totalCents))}</p>
            </div>`,
          onSubmit: () => openPrintWindow(generateDocumentHtml({
            title: `Compra ${purchase.numero}`,
            business: ctx.business,
            docTitle: 'Compra',
            docNumber: purchase.numero,
            meta: [['Fecha', dateTime(purchase.fecha)], ['Proveedor', purchase.proveedorNombre || ''],
              ['Condición', purchase.metodoPago || ''], ['Vence', purchase.fechaVencimiento ? dateOnly(purchase.fechaVencimiento) : '—']],
            tables: [{
              columns: [{ label: 'Producto' }, { label: 'Cantidad', align: 'right' }, { label: 'Costo', align: 'right' }, { label: 'Importe', align: 'right' }],
              rows: (purchase.lineas || []).map((line) => [
                line.productoNombre, `${quantity(line.cantidadMilli)} ${line.unidadNombre || ''}`,
                money(line.unitCostCents), money(line.subtotalNetoCents ?? line.subtotalCents),
              ]),
            }],
            totals: [['Total', money(purchase.totalCents)]],
          })),
        });
      };
    });

    qs('#supplier-return')?.addEventListener('click', () => openModal({
      title: 'Devolución de mercancía',
      body: `
        <div class="space-y-4">
          ${field('Proveedor', selectInput('supplier', ctx.catalogs.suppliers.filter((s) => s.activo !== false), { required: true }))}
          ${field('Producto', selectInput('product', ctx.catalogs.products.filter((p) => p.activo !== false), { required: true }))}
          ${field('Cantidad en unidad base', textInput('qty', { type: 'number', step: '0.001', min: '0.001', required: true }))}
          ${field('Motivo', textInput('reason', { required: true }))}
          <p class="text-xs text-slate-500">Se valora al costo promedio actual del producto. Si hay saldo pendiente se aplica primero a esa deuda.</p>
        </div>`,
      onSubmit: async (form) => {
        const result = await registerSupplierReturn({
          supplierId: form.get('supplier'),
          productId: form.get('product'),
          quantityBaseMilli: toMilli(form.get('qty')),
          reason: (form.get('reason') || '').trim(),
        });
        invalidate(COL.products, COL.suppliers);
        notice(`Devolución registrada por ${money(result.montoCents)}.`);
        await ctx.refresh();
      },
    }));
  },
};
