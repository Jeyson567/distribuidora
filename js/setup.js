import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, doc, getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { app, auth, db } from './firebase.js';
import { DEFAULT_UNITS } from './domain/constants.js';

const searchKey = (value) => String(value || '')
  .toLocaleLowerCase('es')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

// Signals boot-check.js that every module loaded, then shows the form that was
// hidden while the page could still turn out to be blank.
globalThis.__ISAAC_POS_BOOTED__ = true;
document.querySelector('[data-boot]')?.remove();
document.querySelector('#setup-app')?.removeAttribute('hidden');

const form = document.querySelector('#setup-form');
const button = document.querySelector('#submit-button');
const fields = document.querySelector('#admin-fields');
const message = document.querySelector('#message');
const systemRef = doc(db, 'configuracion', 'sistema');
let configured = false;

function setStatus(id, text, error = false) {
  const node = document.querySelector(id);
  node.textContent = text;
  node.className = `mt-2 font-semibold ${error ? 'text-red-700' : 'text-teal-700'}`;
}
function show(text, error = false) {
  message.textContent = text;
  message.className = `mt-5 rounded-lg px-4 py-3 text-sm ${error ? 'bg-red-50 text-red-800' : 'bg-teal-50 text-teal-800'}`;
}
function disableSetup() {
  configured = true;
  fields.disabled = true;
  button.disabled = true;
  button.textContent = 'Sistema ya configurado';
  show('El sistema ya fue configurado. No se permite crear otro administrador desde este archivo.', true);
}

async function checkState() {
  try {
    if (!app?.options?.projectId) throw new Error('No se encontró configuración Firebase.');
    setStatus('#firebase-status', `Conectado: ${app.options.projectId}`);
  } catch (error) {
    console.error(error); setStatus('#firebase-status', 'Error de configuración', true); show('No se pudo inicializar Firebase.', true); return;
  }
  try {
    const system = await getDoc(systemRef);
    setStatus('#firestore-status', 'Conectado');
    if (system.exists() && system.data().configurado === true) {
      setStatus('#admin-status', 'Configurado');
      disableSetup();
    } else {
      setStatus('#admin-status', 'Pendiente');
    }
  } catch (error) {
    console.error(error);
    setStatus('#firestore-status', 'No disponible', true);
    setStatus('#admin-status', 'No verificable', true);
    show('No se pudo verificar Firestore. Revise el proyecto, las reglas y la conexión.', true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (configured) return;
  const values = new FormData(form);
  const email = values.get('email').trim().toLowerCase();
  const password = values.get('password');
  if (password.length < 10) return show('La contraseña debe tener al menos 10 caracteres.', true);
  if (password !== values.get('confirmPassword')) return show('Las contraseñas no coinciden.', true);
  button.disabled = true; button.textContent = 'Configurando…';
  try {
    // Recheck immediately before account creation to prevent accidental
    // duplicate setup from a stale open tab.
    const system = await getDoc(systemRef);
    if (system.exists() && system.data().configurado === true) {
      disableSetup(); return;
    }
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const adminUid = credential.user.uid;
    await setDoc(systemRef, {
      adminUid, configurado: true, fechaConfiguracion: serverTimestamp(),
      versionConfiguracion: 1,
    });
    await setDoc(doc(db, 'configuracion', 'negocio'), {
      nombre: values.get('businessName').trim(), direccion: values.get('address').trim(),
      telefono: values.get('phone').trim(), nit: values.get('nit').trim(),
      prefijoVentas: 'V', prefijoCompras: 'C',
      moneda: 'GTQ', simboloMoneda: 'Q', updatedAt: serverTimestamp(),
    }, { merge: true });

    // Baseline documents the application expects to exist.
    await setDoc(doc(db, 'configuracion', 'correlativos'), { updatedAt: serverTimestamp() }, { merge: true });
    await setDoc(doc(db, 'configuracion', 'cajaActiva'), { cajaId: null, updatedAt: serverTimestamp() }, { merge: true });

    const generalRef = doc(db, 'clientes', 'cliente-general');
    const general = await getDoc(generalRef);
    if (!general.exists()) {
      await setDoc(generalRef, {
        nombre: 'CLIENTE GENERAL', nombreBusqueda: 'cliente general', telefono: null,
        activo: true, limiteCreditoCents: 0, saldoActualCents: 0,
        totalCompradoCents: 0, totalPagadoCents: 0,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    }

    // Standard measurement units so products can be created right away.
    const units = writeBatch(db);
    for (const unit of DEFAULT_UNITS) {
      units.set(doc(collection(db, 'unidades')), {
        ...unit,
        nombreBusqueda: searchKey(unit.nombre),
        activo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await units.commit();
    setStatus('#admin-status', 'Configurado');
    disableSetup();
    show(`Configuración terminada. UID administrador: ${adminUid}. Puede iniciar sesión en el POS.`);
    await signOut(auth);
  } catch (error) {
    console.error(error);
    const messages = {
      'auth/email-already-in-use': 'Ese correo ya está registrado. No se creó otro administrador.',
      'auth/invalid-email': 'El correo no es válido.',
      'auth/weak-password': 'La contraseña no cumple la seguridad requerida.',
      'permission-denied': 'Firestore rechazó la operación. Despliegue las reglas actualizadas antes de usar setup.',
    };
    show(messages[error.code] || 'No se pudo terminar la configuración. Revise la consola para diagnóstico.', true);
    button.disabled = false; button.textContent = 'Crear administrador y guardar configuración';
  }
});

checkState();
