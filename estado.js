/*
 * «Jardín de pausas» · estado.js
 * Guardar y recuperar el estado con storeItem() / getItem() de p5.js.
 *
 * Problema: el popup de una extensión se destruye cada vez que se cierra
 * (al hacer clic fuera). Si el temporizador viviera solo en variables,
 * se perdería todo al volver a abrirlo.
 *
 * Solución: no guardo «cuántos segundos llevo» (eso solo lo sabe el popup
 * mientras está abierto), sino el MOMENTO en el que empezó la sesión
 * (Date.now()). Al volver a abrir el popup calculo:
 *
 *      transcurrido = ahora - inicio
 *
 * y la animación continúa en el punto correcto, aunque el popup haya
 * estado cerrado diez minutos. Si mientras tanto la sesión ha terminado,
 * se detecta al abrir y se cuenta igualmente.
 *
 * storeItem() guarda en window.localStorage (convierte los objetos a JSON
 * y añade una clave extra «<clave>p5TypeID» con el tipo, para que getItem()
 * devuelva un objeto y no un texto).
 */

const CLAVE_ESTADO = 'jp_estado';   // temporizador: modo, duración, marcha...
const CLAVE_DIA = 'jp_dia';         // resumen del día: sesiones y minutos
const CLAVE_COPIA = 'jp_copia';     // copia de seguridad en browser.storage.local

let estado;   // ver estadoInicial()
let dia;      // { fecha: 'AAAA-MM-DD', sesiones: 0, minutos: 0 }

function estadoInicial() {
  return {
    modo: 'enfoque',                       // 'enfoque' o 'descanso'
    minutos: { enfoque: 25, descanso: 5 }, // duración elegida en cada modo
    corriendo: false,                      // ¿está en marcha?
    inicio: 0,                             // Date.now() del arranque (corregido tras pausas)
    transcurrido: 0                        // ms acumulados cuando está en pausa
  };
}

function diaInicial(fecha) {
  return { fecha: fecha, sesiones: 0, minutos: 0 };
}

// ---------------------------------------------------------------------------
// CARGAR Y GUARDAR
// ---------------------------------------------------------------------------

// Se llama una vez en setup(). Es async por la copia de seguridad.
async function cargarEstado() {
  if (!hayStorageDeExtension()) {
    // Pasa si se quita "storage" del manifest (o si se abre popup.html como web normal)
    console.info('[Jardín de pausas] browser.storage no disponible (¿falta el permiso "storage"?): sin copia de seguridad.');
  }
  let guardado = getItem(CLAVE_ESTADO);
  let guardadoDia = getItem(CLAVE_DIA);

  // Si localStorage está vacío (primera vez, o el usuario ha borrado el
  // historial de Firefox) intento recuperar la copia de browser.storage.local.
  if (guardado === null) {
    const copia = await leerCopiaSeguridad();
    if (copia) {
      guardado = copia.estado;
      guardadoDia = copia.dia;
      console.info('[Jardín de pausas] Estado recuperado de la copia de seguridad.');
    }
  }

  // Object.assign mezcla lo guardado con los valores por defecto: si en una
  // versión futura añado un campo nuevo, no se rompe con datos antiguos.
  estado = Object.assign(estadoInicial(), guardado || {});

  const hoy = fechaTexto(new Date());
  if (guardadoDia && guardadoDia.fecha === hoy) {
    dia = guardadoDia;
  } else {
    dia = diaInicial(hoy);                 // nuevo día: el jardín empieza sin hojas
  }
  guardarTodo();
}

function guardarEstado() {
  storeItem(CLAVE_ESTADO, estado);
  guardarCopiaSeguridad();
}

function guardarDia() {
  storeItem(CLAVE_DIA, dia);
  guardarCopiaSeguridad();
}

function guardarTodo() {
  storeItem(CLAVE_ESTADO, estado);
  storeItem(CLAVE_DIA, dia);
  guardarCopiaSeguridad();
}

// Borra todo (botón «Borrar datos»). clearStorage() vacía el localStorage
// de la extensión; como cada extensión tiene su propio origen
// (moz-extension://...), no afecta a ninguna web ni a otras extensiones.
function borrarDatos() {
  clearStorage();
  if (hayStorageDeExtension()) {
    browser.storage.local.remove(CLAVE_COPIA);
  }
  estado = estadoInicial();
  dia = diaInicial(fechaTexto(new Date()));
  guardarTodo();
}

// ---------------------------------------------------------------------------
// COPIA DE SEGURIDAD (necesita "permissions": ["storage"] en el manifest)
// ---------------------------------------------------------------------------
// MDN recomienda no fiarse solo de localStorage en extensiones porque
// Firefox lo borra cuando el usuario limpia el historial y los datos de
// navegación. browser.storage.local sí se conserva. Sin el permiso
// "storage", browser.storage no existe y esta copia simplemente no se hace.

function hayStorageDeExtension() {
  return typeof browser !== 'undefined' && browser.storage && browser.storage.local;
}

function guardarCopiaSeguridad() {
  if (!hayStorageDeExtension()) {
    return;
  }
  const copia = {};
  copia[CLAVE_COPIA] = { estado: estado, dia: dia };
  browser.storage.local.set(copia);
}

async function leerCopiaSeguridad() {
  if (!hayStorageDeExtension()) {
    return null;
  }
  const resultado = await browser.storage.local.get(CLAVE_COPIA);
  return resultado[CLAVE_COPIA] || null;
}

// ---------------------------------------------------------------------------
// TEMPORIZADOR
// ---------------------------------------------------------------------------

function duracionMs() {
  return estado.minutos[estado.modo] * 60 * 1000;
}

function tiempoTranscurrido() {
  if (estado.corriendo) {
    return Date.now() - estado.inicio;
  }
  return estado.transcurrido;
}

function tiempoRestante() {
  return max(0, duracionMs() - tiempoTranscurrido());
}

// De 0 (empieza) a 1 (terminada)
function progreso() {
  return constrain(tiempoTranscurrido() / duracionMs(), 0, 1);
}

function sesionEmpezada() {
  return estado.corriendo || estado.transcurrido > 0;
}

function iniciar() {
  // Si venía de una pausa, «retraso» el inicio lo que ya llevaba hecho.
  estado.inicio = Date.now() - estado.transcurrido;
  estado.corriendo = true;
  guardarEstado();
}

function pausar() {
  estado.transcurrido = Date.now() - estado.inicio;
  estado.corriendo = false;
  guardarEstado();
}

function reiniciar() {
  estado.corriendo = false;
  estado.transcurrido = 0;
  estado.inicio = 0;
  guardarEstado();
}

function cambiarModo(modo) {
  estado.modo = modo;
  reiniciar();
}

function cambiarDuracion(minutos) {
  estado.minutos[estado.modo] = minutos;
  guardarEstado();
}

// Se llama en cada fotograma. Si la sesión ha llegado al final, la cierra,
// pasa al otro modo y devuelve información para avisar al usuario.
// Si no ha terminado, devuelve null.
function comprobarFinDeSesion(momentoApertura) {
  if (!estado.corriendo || tiempoTranscurrido() < duracionMs()) {
    return null;
  }
  const fin = estado.inicio + duracionMs();
  const modoTerminado = estado.modo;

  if (modoTerminado === 'enfoque') {
    const fechaFin = fechaTexto(new Date(fin));
    if (dia.fecha !== fechaFin) {
      dia = diaInicial(fechaFin);
    }
    dia.sesiones++;
    dia.minutos += estado.minutos.enfoque;
  }

  estado.modo = modoTerminado === 'enfoque' ? 'descanso' : 'enfoque';
  estado.corriendo = false;
  estado.transcurrido = 0;
  estado.inicio = 0;
  guardarTodo();

  return {
    modo: modoTerminado,
    fin: fin,
    // ¿Terminó antes de abrir el popup? (margen de 1,5 s)
    mientrasCerrado: fin < momentoApertura - 1500
  };
}

// Si el popup sigue abierto al pasar la medianoche, empieza un día nuevo.
function comprobarCambioDeDia() {
  const hoy = fechaTexto(new Date());
  if (dia.fecha !== hoy) {
    dia = diaInicial(hoy);
    guardarDia();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// UTILIDADES DE FECHA
// ---------------------------------------------------------------------------

// 'AAAA-MM-DD' con la fecha local (no UTC, para que el día cambie a las 0 h)
function fechaTexto(d) {
  return d.getFullYear() + '-' + nf(d.getMonth() + 1, 2) + '-' + nf(d.getDate(), 2);
}

// 'HH:MM' de un instante en milisegundos
function horaTexto(ms) {
  const d = new Date(ms);
  return nf(d.getHours(), 2) + ':' + nf(d.getMinutes(), 2);
}
