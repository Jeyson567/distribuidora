import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence, getAuth, indexedDBLocalPersistence, initializeAuth,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

/*
 * CONFIGURACIÓN DE FIREBASE — este es el único lugar que hay que editar para
 * apuntar el sistema a otro proyecto de Firebase. Los datos se copian de
 * Firebase Console → Configuración del proyecto → Tus aplicaciones → Web.
 *
 * La versión del SDK que se descarga del CDN se define en el bloque
 * <script type="importmap"> de index.html y setup.html.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyDJUUBIFkhe9iFIrWwrNAUn_5Nb3jzOSBM',
  authDomain: 'isaac-61efd.firebaseapp.com',
  projectId: 'isaac-61efd',
  storageBucket: 'isaac-61efd.firebasestorage.app',
  messagingSenderId: '212525365642',
  appId: '1:212525365642:web:9f000b4d0e324732bcf073',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * The session must survive reloads, so persistence is declared explicitly
 * instead of relying on the default: IndexedDB first, and localStorage when a
 * browser profile has IndexedDB unavailable or blocked.
 *
 * Persistence is scoped to the origin: a session opened from one address is not
 * visible from another (127.0.0.1 and localhost are different origins).
 */
function startAuth() {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } catch {
    // Already initialised (a second entry point on the same page) or running
    // outside a browser, as in the test suite.
    return getAuth(app);
  }
}

export const auth = startAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);
