import { esc, qs, qsa } from './dom.js';
import { money } from '../utils/format.js';

export const MENU = [
  ['Inicio', [['dashboard', 'Dashboard']]],
  ['Ventas', [['pos', 'Punto de venta'], ['ventas', 'Historial de ventas'], ['devoluciones', 'Devoluciones']]],
  ['Inventario', [['productos', 'Productos'], ['inventario', 'Inventario'], ['movimientos', 'Movimientos'], ['mermas', 'Mermas']]],
  ['Compras', [['compras', 'Compras'], ['proveedores', 'Proveedores'], ['pagar', 'Cuentas por pagar']]],
  ['Clientes', [['clientes', 'Clientes'], ['cobrar', 'Cuentas por cobrar']]],
  ['Socios', [['socios', 'Socios / áreas'], ['resultados', 'Resultados por socio']]],
  ['Caja', [['caja', 'Caja'], ['gastos', 'Gastos']]],
  ['Reportes', [['reportes', 'Reportes']]],
  ['Configuración', [['categorias', 'Categorías'], ['unidades', 'Unidades'], ['configuracion', 'Negocio'], ['auditoria', 'Auditoría']]],
];

export const PAGE_TITLES = Object.fromEntries(MENU.flatMap(([, items]) => items));

export function renderShell(root, { page, cashSession, businessName, onNavigate, onLogout }) {
  const groups = MENU.map(([group, items]) => `
    <div class="mb-4">
      <p class="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">${esc(group)}</p>
      ${items.map(([id, label]) => `
        <button type="button" data-nav="${id}" class="nav-link${page === id ? ' active' : ''}">${esc(label)}</button>`).join('')}
    </div>`).join('');

  root.innerHTML = `
    <div class="min-h-screen lg:flex">
      <button id="menu-toggle" class="no-print fixed left-3 top-3 z-30 rounded-lg bg-slate-900 px-3 py-2 text-white lg:hidden" aria-label="Abrir menú">Menú</button>
      <aside id="sidebar" class="no-print fixed inset-y-0 left-0 z-20 hidden w-64 overflow-y-auto bg-slate-900 p-4 lg:block">
        <div class="mb-6 flex items-center gap-3 px-2 pt-10 lg:pt-0">
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-teal-600 text-lg font-bold text-white">I</span>
          <div class="min-w-0">
            <p class="truncate font-bold text-white">${esc(businessName || 'Isaac POS')}</p>
            <p class="text-xs text-slate-400">Operador único</p>
          </div>
        </div>
        <nav>${groups}</nav>
        <div class="mt-6 rounded-lg bg-slate-800 p-3 text-xs text-slate-300">
          <p class="font-semibold text-white">${cashSession ? 'Caja abierta' : 'Caja cerrada'}</p>
          <p class="mt-1">${cashSession ? `Efectivo esperado ${esc(money(cashSession.efectivoCents))}` : 'Ábrala para vender y cobrar.'}</p>
        </div>
        <button id="logout" class="btn-secondary mt-4 w-full">Cerrar sesión</button>
      </aside>
      <div id="page" class="min-w-0 flex-1 p-4 pt-16 lg:ml-64 lg:p-8 lg:pt-8"></div>
    </div>
    <div id="toasts" class="no-print pointer-events-none fixed right-4 top-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"></div>`;

  const sidebar = qs('#sidebar', root);
  qs('#menu-toggle', root).onclick = () => sidebar.classList.toggle('hidden');
  qsa('[data-nav]', root).forEach((button) => {
    button.onclick = () => {
      sidebar.classList.add('hidden');
      onNavigate(button.dataset.nav);
    };
  });
  qs('#logout', root).onclick = onLogout;
  return qs('#page', root);
}

export const loadingScreen = (message = 'Cargando información…') => `
  <div class="grid min-h-[60vh] place-items-center">
    <div class="flex items-center gap-3 text-slate-500">
      <span class="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600"></span>
      ${esc(message)}
    </div>
  </div>`;

export const errorScreen = (message, link = null) => `
  <div class="grid min-h-[60vh] place-items-center">
    <div class="card max-w-lg text-center">
      <h2 class="text-lg font-bold">No se pudo cargar la información</h2>
      <p class="mt-2 text-sm text-slate-600">${esc(message)}</p>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener"
        class="mt-4 block truncate text-sm font-semibold text-teal-700 underline">Crear el índice en Firebase</a>` : ''}
      <button id="retry" class="btn-primary mt-5">Reintentar</button>
    </div>
  </div>`;
