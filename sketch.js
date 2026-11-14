/*
 * «Jardín de pausas» — Extensión de Firefox (Manifest V3, popup)
 * Autor: Arturo Navarrete Jiménez de Cisneros (2026)
 * UOC · Desarrollo de aplicaciones interactivas · Reto R3 «Extensión web»
 *
 * Temporizador de enfoque y descanso basado en mi reloj «Jardín de horas» (R1).
 * Mientras te concentras, la flor gana pétalos; cuando descansas, los suelta
 * y su centro respira contigo. Cada sesión de enfoque completada hace brotar
 * una hoja en el tallo: al final del día ves cuánto has cultivado.
 *
 * Ficheros:
 *   sketch.js  -> setup(), draw() e interfaz (botones, slider, textos)
 *   jardin.js  -> todo lo que se dibuja en el canvas
 *   estado.js  -> guardar y recuperar el estado con storeItem() / getItem()
 *
 * p5.js 2.4.0 (copia local en libs/): setup() es async y las fuentes se cargan
 * con await loadFont(), sin preload().
 */

let fuenteTitulo;           // DM Serif Display
let fuenteMono;             // Space Mono
let ui = {};                // elementos del DOM creados con p5
let momentoApertura;        // Date.now() al abrir el popup
let inicioIntro = 0;        // millis() al terminar setup (animación de entrada)
let esperandoConfirmacion = false;
let temporizadorConfirmacion;

const LIMITES = {
  enfoque: { min: 5, max: 60, paso: 5 },
  descanso: { min: 1, max: 30, paso: 1 }
};

// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------
async function setup() {
  momentoApertura = Date.now();
  const lienzo = createCanvas(300, 150);
  lienzo.parent('lienzo');
  frameRate(30);            // en un popup no hace falta más: ahorro batería
  calcularUnidad();

  fuenteTitulo = await loadFont('assets/fonts/DMSerifDisplay-Regular.ttf');
  fuenteMono = await loadFont('assets/fonts/SpaceMono-Regular.ttf');

  await cargarEstado();     // estado.js: getItem() (+ copia de seguridad)
  crearEstrellas(45);
  crearInterfaz();
  actualizarInterfaz();
  mostrarMensajeDeBienvenida();
  inicioIntro = millis();
}

// ---------------------------------------------------------------------------
// DRAW
// ---------------------------------------------------------------------------
function draw() {
  // 1. ¿Ha terminado la sesión? (también detecta si terminó con el popup cerrado)
  const fin = comprobarFinDeSesion(momentoApertura);
  if (fin) {
    alTerminarSesion(fin);
  }
  if (frameCount % 30 === 0 && comprobarCambioDeDia()) {
    actualizarInterfaz();
  }

  // 2. Fondo: cielo de la hora real, estrellas, sol o luna y suelo
  const horaReal = horaRealDecimal();
  const oscuridad = dibujarCielo(horaReal);
  dibujarEstrellas(oscuridad);
  dibujarAstro(horaReal);
  dibujarSuelo();

  // 3. La flor
  const flor = posicionFlor();
  const intro = easeOut(constrain((millis() - inicioIntro) / 1200, 0, 1));
  const p = progreso();
  let cantidad;
  let escalaCentro = 1;
  let colorCentro;

  if (estado.modo === 'enfoque') {
    cantidad = p * 12 * intro;                    // crecen los pétalos
    colorCentro = color(COLORES_PETALO[min(11, floor(p * 12))]);
  } else {
    cantidad = (1 - p) * 12 * intro;              // se van soltando
    colorCentro = color(PALETA.calma);
    if (estado.corriendo) {
      escalaCentro = 1 + 0.35 * respiracion().valor;
    }
    if (intro >= 1) {
      detectarPetalosCaidos(flor, cantidad);
    }
  }

  dibujarTallo(flor, dia.sesiones);
  actualizarAnillo(floor(tiempoTranscurrido() / 1000) % 60);
  dibujarAnilloPolen(flor);
  dibujarPetalos(flor, cantidad, escalaCentro, colorCentro);
  actualizarParticulas();

  // 4. Tiempo restante y estado
  dibujarPanelTiempo(oscuridad, datosDelPanel(p));
}

// Ciclo de respiración de 8 s: 4 s inspirar, 4 s soltar el aire.
// Uso Date.now() (y no millis()) para que el ritmo no se reinicie al abrir.
function respiracion() {
  const fase = (Date.now() % 8000) / 8000;
  if (fase < 0.5) {
    return { valor: easeInOut(fase * 2), texto: 'inspira…' };
  }
  return { valor: easeInOut(2 - fase * 2), texto: 'suelta el aire…' };
}

function datosDelPanel(p) {
  const segundos = ceil(tiempoRestante() / 1000);
  const tiempo = nf(floor(segundos / 60), 2) + ':' + nf(segundos % 60, 2);
  const esEnfoque = estado.modo === 'enfoque';
  const etiqueta = (esEnfoque ? 'ENFOQUE' : 'DESCANSO') + ' · ' + estado.minutos[estado.modo] + ' MIN';

  let detalle;
  if (estado.corriendo && esEnfoque) {
    detalle = 'cultivando la sesión ' + (dia.sesiones + 1);
  } else if (estado.corriendo) {
    detalle = respiracion().texto;
  } else if (estado.transcurrido > 0) {
    detalle = 'en pausa';
  } else {
    detalle = esEnfoque ? 'listo para empezar' : 'tómate un respiro';
  }

  return {
    etiqueta: etiqueta,
    tiempo: tiempo,
    detalle: detalle,
    progreso: p,
    colorBarra: color(esEnfoque ? PALETA.polen : PALETA.calma)
  };
}

function alTerminarSesion(fin) {
  reiniciarAnillo();
  if (fin.modo === 'enfoque') {
    celebrar();
    if (fin.mientrasCerrado) {
      mostrarMensaje('Terminaste una sesión de enfoque a las ' + horaTexto(fin.fin) +
        ' con el jardín cerrado. ¡Ha brotado una hoja!');
    } else {
      mostrarMensaje('¡Sesión completada! Ha brotado una hoja. Pulsa «Iniciar» para descansar.');
    }
  } else {
    dispersarPolen();
    if (fin.mientrasCerrado) {
      mostrarMensaje('Tu descanso terminó a las ' + horaTexto(fin.fin) + '. ¿Otra sesión de enfoque?');
    } else {
      mostrarMensaje('Descanso terminado. ¿Otra sesión de enfoque?');
    }
  }
  actualizarInterfaz();
}

// ---------------------------------------------------------------------------
// INTERFAZ (elementos del DOM creados con p5.js y estilados en style.css)
// ---------------------------------------------------------------------------
function crearInterfaz() {
  const contenedor = select('#controles');

  // Pestañas de modo
  const pestanas = createDiv();
  pestanas.class('pestanas');
  pestanas.parent(contenedor);
  ui.enfoque = createButton('Enfoque');
  ui.enfoque.class('pestana');
  ui.enfoque.parent(pestanas);
  ui.enfoque.mousePressed(() => elegirModo('enfoque'));
  ui.descanso = createButton('Descanso');
  ui.descanso.class('pestana descanso');
  ui.descanso.parent(pestanas);
  ui.descanso.mousePressed(() => elegirModo('descanso'));

  // Slider de duración
  const filaDuracion = createDiv();
  filaDuracion.class('fila');
  filaDuracion.parent(contenedor);
  const etiqueta = createSpan('Duración');
  etiqueta.class('etiqueta');
  etiqueta.parent(filaDuracion);
  ui.slider = createSlider(5, 60, 25, 5);
  ui.slider.parent(filaDuracion);
  ui.slider.attribute('aria-label', 'Duración en minutos');
  ui.slider.input(alMoverSlider);
  ui.valor = createSpan('');
  ui.valor.class('valor');
  ui.valor.parent(filaDuracion);

  // Botones de marcha
  const filaBotones = createDiv();
  filaBotones.class('fila');
  filaBotones.parent(contenedor);
  ui.principal = createButton('Iniciar');
  ui.principal.class('boton principal');
  ui.principal.parent(filaBotones);
  ui.principal.mousePressed(alternarMarcha);
  ui.reiniciar = createButton('Reiniciar');
  ui.reiniciar.class('boton');
  ui.reiniciar.parent(filaBotones);
  ui.reiniciar.mousePressed(alPulsarReiniciar);

  // Mensajes
  ui.mensaje = createP('');
  ui.mensaje.class('mensaje');
  ui.mensaje.parent(contenedor);
  ui.mensaje.attribute('aria-live', 'polite');

  // Resumen del día + borrar datos
  const filaDatos = createDiv();
  filaDatos.class('fila datos');
  filaDatos.parent(contenedor);
  ui.resumen = createSpan('');
  ui.resumen.parent(filaDatos);
  ui.borrar = createButton('Borrar datos');
  ui.borrar.class('enlace');
  ui.borrar.parent(filaDatos);
  ui.borrar.mousePressed(pedirBorrado);
}

// Pone cada control de acuerdo con el estado actual
function actualizarInterfaz() {
  const esEnfoque = estado.modo === 'enfoque';
  if (esEnfoque) {
    ui.enfoque.addClass('activa');
    ui.descanso.removeClass('activa');
  } else {
    ui.descanso.addClass('activa');
    ui.enfoque.removeClass('activa');
  }

  const lim = LIMITES[estado.modo];
  ui.slider.attribute('min', lim.min);
  ui.slider.attribute('max', lim.max);
  ui.slider.attribute('step', lim.paso);
  ui.slider.value(estado.minutos[estado.modo]);
  ui.valor.html(estado.minutos[estado.modo] + ' min');

  // La duración solo se puede cambiar antes de empezar
  if (sesionEmpezada()) {
    ui.slider.attribute('disabled', '');
  } else {
    ui.slider.removeAttribute('disabled');
  }

  if (estado.corriendo) {
    ui.principal.html('Pausar');
    ui.principal.addClass('en-marcha');
  } else {
    ui.principal.html(estado.transcurrido > 0 ? 'Continuar' : 'Iniciar');
    ui.principal.removeClass('en-marcha');
  }

  const palabra = dia.sesiones === 1 ? 'sesión' : 'sesiones';
  ui.resumen.html('Hoy: ' + dia.sesiones + ' ' + palabra + ' · ' + dia.minutos + ' min');
}

function mostrarMensaje(texto) {
  ui.mensaje.elt.textContent = texto;      // textContent: no interpreta HTML
}

function mostrarMensajeDeBienvenida() {
  if (estado.corriendo) {
    mostrarMensaje('El temporizador ha seguido contando mientras el jardín estaba cerrado.');
  } else if (estado.transcurrido > 0) {
    mostrarMensaje('Tienes una sesión en pausa. Pulsa «Continuar» cuando quieras.');
  } else if (dia.sesiones === 0) {
    mostrarMensaje('Elige la duración y pulsa «Iniciar». La flor crecerá mientras te concentras.');
  }
}

// ---------------------------------------------------------------------------
// RESPUESTA A LA INTERACCIÓN
// ---------------------------------------------------------------------------
function alternarMarcha() {
  if (estado.corriendo) {
    pausar();
    mostrarMensaje('En pausa. El jardín te espera.');
  } else {
    iniciar();
    mostrarMensaje(estado.modo === 'enfoque'
      ? 'A concentrarse. Puedes cerrar el popup: el tiempo sigue contando.'
      : 'Descansa y respira al ritmo del centro de la flor.');
  }
  actualizarInterfaz();
}

function alPulsarReiniciar() {
  reiniciar();
  reiniciarAnillo();
  mostrarMensaje('Sesión reiniciada.');
  actualizarInterfaz();
}

function elegirModo(modo) {
  if (modo === estado.modo) {
    return;
  }
  if (sesionEmpezada()) {
    mostrarMensaje('Reinicia la sesión actual antes de cambiar de modo.');
    return;
  }
  cambiarModo(modo);
  reiniciarAnillo();
  mostrarMensaje('');
  actualizarInterfaz();
}

function alMoverSlider() {
  const minutos = Number(ui.slider.value());
  cambiarDuracion(minutos);
  ui.valor.html(minutos + ' min');
}

// «Borrar datos» pide una segunda pulsación en lugar de usar confirm(),
// porque los cuadros de diálogo no funcionan bien dentro de un popup.
function pedirBorrado() {
  if (!esperandoConfirmacion) {
    esperandoConfirmacion = true;
    ui.borrar.html('¿Seguro? Pulsa otra vez');
    ui.borrar.addClass('confirmar');
    temporizadorConfirmacion = setTimeout(cancelarBorrado, 3000);
    return;
  }
  clearTimeout(temporizadorConfirmacion);
  cancelarBorrado();
  borrarDatos();
  reiniciarAnillo();
  particulas = [];
  mostrarMensaje('Datos borrados. El jardín vuelve a empezar.');
  actualizarInterfaz();
}

function cancelarBorrado() {
  esperandoConfirmacion = false;
  ui.borrar.html('Borrar datos');
  ui.borrar.removeClass('confirmar');
}

// Atajo de teclado: barra espaciadora para iniciar / pausar
function keyPressed() {
  const foco = document.activeElement ? document.activeElement.tagName : '';
  if (key === ' ' && foco !== 'BUTTON' && foco !== 'INPUT') {
    alternarMarcha();
    return false;                          // evita que la página haga scroll
  }
}
