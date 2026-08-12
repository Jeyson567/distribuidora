import { authMessage, login, logout, observeSession, verifyAccess } from './services/auth.js';
import { startSession } from './services/session-flow.js';
import { explainError } from './services/errors.js';
import { businessSettings, loadCatalogs, watchCatalogs } from './services/db.js';
import { loadActiveCashSession } from './services/transactions.js';
import { closeDialogs, qs } from './ui/dom.js';
import { errorScreen, loadingScreen, PAGE_TITLES, renderShell } from './ui/layout.js';
import { blockedScreen, loginScreen } from './ui/session.js';

import dashboardPage from './pages/dashboard.js';
import posPage from './pages/pos.js';
import salesPage, { returnsPage } from './pages/sales.js';
import productsPage from './pages/products.js';
import inventoryPage, { movementsPage, wastePage } from './pages/inventory.js';
import cashPage, { expensesPage } from './pages/cash.js';
import reportsPage, { partnerResultsPage } from './pages/reports.js';
import settingsPage, { auditPage } from './pages/settings.js';
import { entityPage } from './pages/entities.js';
import { accountsPage } from './pages/accounts.js';

// Tells boot-check.js that every module loaded, so it stops waiting and never
// shows the "something did not load" instructions.
globalThis.__ISAAC_POS_BOOTED__ = true;

const root = qs('#app');

const ROUTES = {
  dashboard: dashboardPage,
  pos: posPage,
  ventas: salesPage,
  devoluciones: returnsPage,
  productos: productsPage,
  inventario: inventoryPage,
  movimientos: movementsPage,
  mermas: wastePage,
  clientes: entityPage('clientes'),
  cobrar: accountsPage('cobrar'),
  socios: entityPage('socios'),
  resultados: partnerResultsPage,
  caja: cashPage,
  gastos: expensesPage,
  reportes: reportsPage,
  categorias: entityPage('categorias'),
  unidades: entityPage('unidades'),
  configuracion: settingsPage,
  auditoria: auditPage,
};

// `user` is only set once Firestore confirms the signed-in account is the
// registered operator; the raw Firebase session lives in the session flow.
const state = { user: null, stopWatching: null };

/** Routing lives in the hash so reloading keeps the operator where they were. */
function currentRoute() {
  const raw = globalThis.location.hash.replace(/^#\/?/, '');
  const [page, search = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(search));
  return { page: ROUTES[page] ? page : 'dashboard', params };
}

function navigate(page, params = {}) {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== '' && value != null),
  ).toString();
  globalThis.location.hash = `#/${page}${search ? `?${search}` : ''}`;
}

function showLogin(message = '') {
  loginScreen(root, {
    message,
    onSubmit: async (form, { showError }) => {
      try {
        await login(form.get('email'), form.get('password'));
      } catch (error) {
        console.error(error);
        showError(authMessage(error, 'No se pudo iniciar sesión.'));
      }
    },
  });
}

function showBlocked({ title, detail, retry = true, setupHref = '' }) {
  blockedScreen(root, {
    title,
    detail,
    setupHref,
    onRetry: retry ? () => session.retry() : null,
    onSignOut: () => logout(),
  });
}

async function render() {
  if (!state.user) {
    showLogin();
    return;
  }

  const { page, params } = currentRoute();
  const module = ROUTES[page];
  closeDialogs();

  if (!qs('#page', root)) root.innerHTML = loadingScreen('Cargando el sistema…');

  let business = {};
  let cashSession = null;
  let catalogs = {};

  try {
    [business, cashSession, catalogs] = await Promise.all([
      businessSettings().then((value) => value || {}),
      loadActiveCashSession(),
      loadCatalogs(),
    ]);
  } catch (error) {
    console.error(error);
    const { message, link } = explainError(
      error,
      'Revise su conexión a internet y los permisos de Firestore. No se modificó ninguna información.',
    );
    root.innerHTML = errorScreen(message, link);
    qs('#retry').onclick = render;
    return;
  }

  const ctx = {
    page,
    params,
    business,
    cashSession,
    catalogs,
    navigate,
    refresh: () => render(),
  };

  const pageContainer = renderShell(root, {
    page,
    cashSession,
    businessName: business.nombre,
    onNavigate: (target) => navigate(target),
    onLogout: () => logout(),
  });
  pageContainer.innerHTML = loadingScreen();
  document.title = `${PAGE_TITLES[page] || 'Isaac POS'} · ${business.nombre || 'Isaac POS'}`;

  try {
    const data = await module.load(ctx);
    pageContainer.innerHTML = module.render(data, ctx);
    module.bind(data, ctx);
  } catch (error) {
    console.error(error);
    const { message, link } = explainError(
      error,
      'No se pudieron cargar los datos de esta pantalla.',
    );
    pageContainer.innerHTML = errorScreen(message, link);
    qs('#retry').onclick = render;
  }
}

/**
 * Firestore pushes catalogue changes as they happen. The screen is repainted
 * from that push, but never on top of an open form or in the middle of a sale:
 * rebuilding the DOM there would throw away what the operator is typing.
 */
let repaintTimer = null;

function repaintFromFirestore() {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => {
    if (!state.user) return;
    if (qs('dialog[data-app-dialog][open]')) return;
    if (currentRoute().page === 'pos') return;
    render();
  }, 250);
}

function startWatching() {
  if (state.stopWatching) return;
  state.stopWatching = watchCatalogs(repaintFromFirestore, (error, name) => {
    console.error(`No se pudo escuchar ${name} en tiempo real.`, error);
  });
}

function stopWatching() {
  state.stopWatching?.();
  state.stopWatching = null;
}

globalThis.addEventListener('hashchange', () => {
  if (state.user) render();
});

showLogin();
const session = startSession({
  observe: observeSession,
  verify: verifyAccess,
  signOut: logout,
  onVerifying: () => { root.innerHTML = loadingScreen('Verificando la sesión…'); },
  onLogin: (message) => { stopWatching(); state.user = null; showLogin(message); },
  onBlocked: (options) => { stopWatching(); state.user = null; showBlocked(options); },
  onAdmin: (user) => { state.user = user; startWatching(); render(); },
});
