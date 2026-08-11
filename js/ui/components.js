import { esc } from './dom.js';
import { money, quantity } from '../utils/format.js';
import { RANGE_PRESETS } from '../utils/dates.js';

export const pageHeader = (title, subtitle = '', actions = '') => `
  <header class="no-print mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">${esc(title)}</h1>
      ${subtitle ? `<p class="mt-1 text-sm text-slate-500">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="flex flex-wrap gap-2">${actions}</div>
  </header>`;

export const statCard = (label, value, hint = '', tone = '') => `
  <div class="card">
    <p class="text-sm text-slate-500">${esc(label)}</p>
    <p class="mt-1 text-2xl font-bold ${tone}">${esc(value)}</p>
    ${hint ? `<p class="mt-1 text-xs text-slate-500">${esc(hint)}</p>` : ''}
  </div>`;

export const badge = (text, tone = 'slate') => {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    amber: 'bg-amber-100 text-amber-800',
    teal: 'bg-teal-100 text-teal-800',
  };
  return `<span class="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone] || tones.slate}">${esc(text)}</span>`;
};

/**
 * An empty screen must never be a dead end: when the table has something the
 * operator can create, the button to do it is offered right there.
 * `action` is `{ id, label }` and reuses the same handler as the header button.
 */
export const emptyState = (message, action = null) => `
  <div class="py-10 text-center">
    <p class="text-sm text-slate-500">${esc(message)}</p>
    ${action ? `<button id="${esc(action.id)}" class="btn-primary mt-4">${esc(action.label)}</button>` : ''}
  </div>`;

/**
 * Renders a table. Column `format` receives the row and returns already
 * escaped HTML; plain `key` values are escaped automatically.
 */
export function dataTable({
  columns, rows, empty = 'Sin registros.', dense = false, emptyAction = null,
}) {
  if (!rows.length) return `<div class="card">${emptyState(empty, emptyAction)}</div>`;
  const head = columns
    .map((column) => `<th class="px-3 py-3 font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}">${esc(column.label)}</th>`)
    .join('');
  const body = rows.map((row) => `
    <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      ${columns.map((column) => `<td class="px-3 ${dense ? 'py-2' : 'py-3'} ${column.align === 'right' ? 'text-right tabular-nums' : ''}">${
        column.format ? column.format(row) : esc(row[column.key] ?? '—')
      }</td>`).join('')}
    </tr>`).join('');
  return `<div class="card overflow-x-auto p-0">
    <table class="w-full min-w-[36rem] text-sm">
      <thead class="border-b border-slate-200 bg-slate-50 text-slate-600"><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

export const moneyCell = (cents) => `<span class="tabular-nums">${esc(money(cents))}</span>`;
export const quantityCell = (milli, unit = '') => `<span class="tabular-nums">${esc(quantity(milli))} ${esc(unit)}</span>`;

export const optionList = (items, selected = '', placeholder = 'Seleccione…') => [
  placeholder ? `<option value="">${esc(placeholder)}</option>` : '',
  ...items.map((item) => `<option value="${esc(item.id)}"${item.id === selected ? ' selected' : ''}>${esc(item.nombre)}</option>`),
].join('');

export const field = (label, control, hint = '') => `
  <label class="block text-sm font-medium text-slate-700">${esc(label)}
    ${control}
    ${hint ? `<span class="mt-1 block text-xs font-normal text-slate-500">${esc(hint)}</span>` : ''}
  </label>`;

export const textInput = (name, options = {}) => {
  const { type = 'text', value = '', required = false, step, min, placeholder = '', attrs = '' } = options;
  return `<input class="field mt-1" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}"
    ${required ? 'required' : ''} ${step ? `step="${esc(step)}"` : ''} ${min !== undefined ? `min="${esc(min)}"` : ''}
    placeholder="${esc(placeholder)}" ${attrs}>`;
};

export const selectInput = (name, items, options = {}) => {
  const { selected = '', required = false, placeholder = 'Seleccione…', attrs = '' } = options;
  return `<select class="field mt-1" name="${esc(name)}" ${required ? 'required' : ''} ${attrs}>${
    optionList(items, selected, placeholder)}</select>`;
};

/** Date range filter shared by every financial screen. */
export const rangeFilter = (range, extra = '') => `
  <form id="range-filter" class="no-print card mb-6 flex flex-wrap items-end gap-3">
    <label class="text-sm font-medium">Período
      <select name="preset" class="field mt-1">
        ${RANGE_PRESETS.map(([value, label]) => `<option value="${value}"${range.preset === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}
      </select>
    </label>
    <label class="text-sm font-medium ${range.preset === 'personalizado' ? '' : 'hidden'}" data-custom>Desde
      <input type="date" name="from" value="${esc(range.from || '')}" class="field mt-1">
    </label>
    <label class="text-sm font-medium ${range.preset === 'personalizado' ? '' : 'hidden'}" data-custom>Hasta
      <input type="date" name="to" value="${esc(range.to || '')}" class="field mt-1">
    </label>
    ${extra}
    <button class="btn-primary">Aplicar</button>
  </form>`;

export const printArea = (html) => `<div id="print-area" class="hidden print:block">${html}</div>`;
