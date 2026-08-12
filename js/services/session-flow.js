import { ACCESS, authMessage } from './auth.js';

/**
 * Turns Firebase events into exactly one of four outcomes, keeping the two
 * questions apart: Authentication says whether there is a session, Firestore
 * says whether that session may operate. A failure of the second one never
 * invalidates the first.
 *
 * The screens are injected so the flow can be driven end to end in tests.
 */
export function startSession({
  observe, verify, onLogin, onVerifying, onAdmin, onBlocked, signOut,
}) {
  const state = { session: null, attempt: 0, notice: '' };

  async function admit(user) {
    if (!user) return;
    state.attempt += 1;
    const attempt = state.attempt;
    onVerifying();

    const { status, error } = await verify(user);
    // A newer auth event or retry already took over.
    if (attempt !== state.attempt) return;

    if (status === ACCESS.ADMIN) {
      onAdmin(user);
      return;
    }
    if (status === ACCESS.DENIED) {
      // Signing out reopens the login screen; leave the reason behind for it.
      state.notice = 'Esta cuenta no es la del administrador registrado en configuracion/sistema.';
      onLogin(state.notice);
      signOut();
      return;
    }
    if (status === ACCESS.NOT_CONFIGURED) {
      onBlocked({
        title: 'El sistema aún no está configurado',
        detail: 'Falta el documento configuracion/sistema. Complete la instalación inicial para crear el administrador y los documentos base. Firestore creará las colecciones al guardar el primer registro de cada módulo.',
        retry: false,
        setupHref: './setup.html',
      });
      return;
    }
    onBlocked({
      title: 'La sesión está activa, pero Firestore no respondió',
      detail: `Su sesión de Firebase sigue abierta y no se pudieron leer los permisos. ${authMessage(error, 'Vuelva a intentarlo.')}`,
      retry: true,
    });
  }

  observe(
    (user) => {
      state.session = user;
      state.attempt += 1;
      // Having no session is the normal starting point, never an error.
      if (!user) {
        onLogin(state.notice);
        state.notice = '';
        return;
      }
      state.notice = '';
      admit(user);
    },
    (error) => {
      state.session = null;
      onLogin(authMessage(error, 'Firebase Authentication devolvió un error.'));
    },
  );

  return { retry: () => admit(state.session), state };
}
