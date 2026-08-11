import { userMessage } from '../domain/errors.js';

/** Firebase error codes turned into something the operator can act on. */
const MESSAGES = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/wrong-password': 'Correo o contraseña incorrectos.',
  'auth/user-not-found': 'No existe una cuenta con ese correo.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada en Firebase Authentication.',
  'auth/too-many-requests': 'Demasiados intentos fallidos. Espere unos minutos.',
  'auth/network-request-failed': 'Sin conexión con Firebase. Revise su internet.',
  'auth/operation-not-allowed': 'Habilite el proveedor Correo/Contraseña en Firebase Authentication.',
  'auth/invalid-api-key': 'La configuración de Firebase del proyecto no es válida.',
  unavailable: 'Firestore no respondió. Revise su conexión a internet.',
  'permission-denied': 'Firestore rechazó la operación. Despliegue las reglas con "firebase deploy --only firestore:rules".',
  'deadline-exceeded': 'Firestore tardó demasiado en responder. Inténtelo de nuevo.',
  'not-found': 'El registro ya no existe.',
  'already-exists': 'Ese registro ya existe.',
  'resource-exhausted': 'Se agotó la cuota de Firestore del proyecto.',
  unauthenticated: 'La sesión expiró. Vuelva a iniciar sesión.',
};

export function authMessage(error, fallback = 'No se pudo completar la operación con Firebase.') {
  if (error?.isBusinessError) return error.message;
  if (error?.code === 'failed-precondition') return indexMessage(error);
  return MESSAGES[error?.code] || (error?.code ? `${fallback} (${error.code})` : fallback);
}

/**
 * A missing composite index is the one Firestore error that carries its own
 * fix: the message includes a console link that creates the index. Losing that
 * link behind a generic sentence is what makes the error look unsolvable.
 */
const indexMessage = (error) => (indexUrl(error)
  ? 'Esta consulta necesita un índice de Firestore que todavía no existe. Créelo con el enlace de abajo, o despliegue firestore.indexes.json.'
  : `Firestore rechazó la consulta: ${error?.message || 'condición previa no cumplida'}.`);

export const indexUrl = (error) => (error?.code === 'failed-precondition'
  ? (String(error.message || '').match(/https:\/\/console\.firebase\.google\.com\/\S+/) || [])[0]?.replace(/[).,]+$/, '') || null
  : null);

/**
 * Everything a screen needs to explain a failure: a readable sentence and,
 * when Firestore offers one, the link that fixes it.
 */
export function explainError(error, fallback) {
  return {
    message: error?.isBusinessError ? error.message : authMessage(error, userMessage(error, fallback)),
    link: indexUrl(error),
  };
}
