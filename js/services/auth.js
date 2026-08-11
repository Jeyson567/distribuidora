import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import { auth } from '../firebase.js';
import { COL, read } from './db.js';
import { SETTINGS_DOC } from '../domain/constants.js';

export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);

/**
 * Result of asking Firestore whether the signed-in account is the operator.
 *
 * Being signed in and being authorised are two different questions answered by
 * two different services, so they are reported separately: a Firestore outage
 * must never be presented as a broken session.
 */
export const ACCESS = {
  ADMIN: 'ADMIN',           // the account matches configuracion/sistema.adminUid
  DENIED: 'DENIED',         // read succeeded and this is a different account
  NOT_CONFIGURED: 'NOT_CONFIGURED', // setup.html has not run yet
  UNVERIFIED: 'UNVERIFIED', // Firestore could not answer; the session is intact
};

/** Firestore codes that mean "ask again later", not "the answer is no". */
const RETRYABLE = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'internal', 'cancelled']);

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Watches Firebase Authentication and nothing else. Having no session is a
 * normal state reported as `null`, never as a failure; `onFailure` only runs
 * when Authentication itself fails.
 */
export const observeSession = (onSession, onFailure) => onAuthStateChanged(
  auth,
  (user) => onSession(user || null),
  (error) => {
    console.error(error);
    onFailure?.(error);
  },
);

/**
 * Confirms against Firestore that the session belongs to the single operator.
 * Transient failures are retried, because the first read of a page load can
 * land before the connection to Firestore is ready.
 */
export async function verifyAccess(user, {
  attempts = 3,
  backoff = 600,
  sleep = delay,
  readSystem = () => read(COL.settings, SETTINGS_DOC.system),
} = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const system = await readSystem();
      if (!system?.adminUid) return { status: ACCESS.NOT_CONFIGURED };
      return system.adminUid === user.uid
        ? { status: ACCESS.ADMIN, user }
        : { status: ACCESS.DENIED, user };
    } catch (error) {
      last = error;
      if (!RETRYABLE.has(error?.code) || attempt === attempts) break;
      await sleep(backoff * attempt);
    }
  }
  console.error(last);
  return { status: ACCESS.UNVERIFIED, error: last };
}

export { authMessage } from './errors.js';
