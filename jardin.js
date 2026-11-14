/*
 * «Jardín de pausas» · jardin.js
 * La animación abstracta del tiempo, adaptada de «Jardín de horas» (R1)
 * a un canvas de 300 x 150.
 *
 * Qué cambia respecto a la R1:
 *   R1 (reloj)                          R3 (temporizador)
 *   PÉTALOS -> horas del día            PÉTALOS -> progreso de la sesión (12 doceavos)
 *   HOJAS   -> cada 5 minutos           HOJAS   -> sesiones de enfoque completadas hoy
 *   POLEN   -> segundos del reloj       POLEN   -> segundos del minuto en curso de la sesión
 *   CIELO   -> momento del día          CIELO   -> igual: sigue la hora real
 *
 * En ENFOQUE la flor gana un pétalo cada doceavo de la sesión.
 * En DESCANSO la flor está completa y va soltando los pétalos, que caen con
 * el viento; el centro de la flor «respira» (4 s inspirar, 4 s soltar).
 *
 * Migración a p5.js 2.x (feedback de la R1):
 *   - bezierVertex() ahora recibe UN punto por llamada (3 llamadas por curva).
 *   - color.toString() devuelve formato CSS Color 4; para el degradado del
 *     canvas pido el formato '#rrggbb' explícitamente.
 */

// ---------------------------------------------------------------------------
// PALETA (la misma de la R1)
// ---------------------------------------------------------------------------
const PALETA = {
  noche: '#141a33',
  nocheBajo: '#2b2350',
  alba: '#f4a582',
  albaBajo: '#fbd6a4',
  dia: '#9fd3e6',
  diaBajo: '#f7ecd9',
  ocaso: '#6d4c8f',
  ocasoBajo: '#f08a6c',
  tallo: '#2f6b4f',
  hoja: '#5fa36a',
  suelo: '#1d3b31',
  polen: '#ffd35c',
  calma: '#3cc4b3',
  claro: '#fff6e9',
  oscuro: '#1b1f33'
};

// Un color por pétalo (en la R1 era un color por hora)
const COLORES_PETALO = [
  '#ffd35c', '#ffb347', '#ff8c5a', '#f26b6b', '#e0588f', '#b45bb0',
  '#7e63c9', '#5a7be0', '#3fa7d6', '#3cc4b3', '#6bcb77', '#b5d65a'
];

const MAX_HOJAS = 8;          // hojas visibles en el tallo
const MAX_PARTICULAS = 220;   // límite para no gastar batería en el popup

// ---------------------------------------------------------------------------
// VARIABLES DEL DIBUJO
// ---------------------------------------------------------------------------
let u;                        // unidad relativa al alto del canvas
let estrellas = [];
let particulas = [];
let granos = [];              // granos de polen del anillo (uno por segundo)
let ultimoSegundo = -1;       // para detectar el cambio de segundo
let petalosAntes = -1;        // para detectar cuándo cae un pétalo (descanso)
let cieloAlto;
let cieloBajo;
let hojaNuevaDesde = -100000; // millis() en que ha brotado la última hoja

// ---------------------------------------------------------------------------
// COMPOSICIÓN
// ---------------------------------------------------------------------------
function calcularUnidad() {
  u = height / 90;            // 150 / 90 ≈ 1,67 px
}

function posicionFlor() {
  return createVector(width * 0.27, height * 0.42);
}

function alturaSuelo() {
  return height * 0.9;
}

// ---------------------------------------------------------------------------
// CIELO, ESTRELLAS, SOL/LUNA Y SUELO (igual que en la R1, a otra escala)
// ---------------------------------------------------------------------------

// Hora real con decimales (14:30 -> 14.5)
function horaRealDecimal() {
  return hour() + minute() / 60 + second() / 3600;
}

// Degradado vertical del cielo. Interpolo entre «fotogramas clave» de color
// según la hora (como en una línea de tiempo de animación) y pinto el
// degradado con la API Canvas 2D (createLinearGradient), porque p5.js no
// tiene una función propia para degradados. Devuelve lo oscuro que está (0-1).
function dibujarCielo(horaDecimal) {
  const claves = [
    [0, PALETA.noche, PALETA.nocheBajo],
    [5.5, PALETA.noche, PALETA.nocheBajo],
    [7.5, PALETA.alba, PALETA.albaBajo],
    [10, PALETA.dia, PALETA.diaBajo],
    [17, PALETA.dia, PALETA.diaBajo],
    [19.5, PALETA.ocaso, PALETA.ocasoBajo],
    [21.5, PALETA.noche, PALETA.nocheBajo],
    [24, PALETA.noche, PALETA.nocheBajo]
  ];
  for (let i = 0; i < claves.length - 1; i++) {
    const a = claves[i];
    const b = claves[i + 1];
    if (horaDecimal >= a[0] && horaDecimal <= b[0]) {
      const k = map(horaDecimal, a[0], b[0], 0, 1);
      cieloAlto = lerpColor(color(a[1]), color(b[1]), k);
      cieloBajo = lerpColor(color(a[2]), color(b[2]), k);
      break;
    }
  }
  const degradado = drawingContext.createLinearGradient(0, 0, 0, height);
  degradado.addColorStop(0, cieloAlto.toString('#rrggbb'));
  degradado.addColorStop(1, cieloBajo.toString('#rrggbb'));
  drawingContext.fillStyle = degradado;
  noStroke();
  rect(0, 0, width, height);

  // luminancia aproximada (0 negro, 1 blanco) del color de arriba
  const luz = (0.299 * red(cieloAlto) + 0.587 * green(cieloAlto) + 0.114 * blue(cieloAlto)) / 255;
  return 1 - luz;
}

function crearEstrellas(cantidad) {
  for (let i = 0; i < cantidad; i++) {
    estrellas.push({ x: random(), y: random(0, 0.65), fase: random(TWO_PI), r: random(0.5, 1.2) });
  }
}

function dibujarEstrellas(oscuridad) {
  if (oscuridad < 0.35) {
    return;
  }
  noStroke();
  const visibilidad = map(oscuridad, 0.35, 0.9, 0, 1, true);
  for (const e of estrellas) {
    const brillo = map(sin(frameCount * 0.05 + e.fase), -1, 1, 80, 255) * visibilidad;
    fill(255, 246, 233, brillo);
    circle(e.x * width, e.y * height, e.r * u);
  }
}

// El sol cruza el cielo de 6 h a 18 h y la luna de 18 h a 6 h
function dibujarAstro(horaDecimal) {
  const esDeDia = horaDecimal >= 6 && horaDecimal < 18;
  const inicio = esDeDia ? 6 : 18;
  const avance = ((horaDecimal - inicio + 24) % 24) / 12;
  const x = lerp(width * 0.04, width * 0.96, avance);
  const y = alturaSuelo() - sin(avance * PI) * height * 0.74;
  noStroke();
  if (esDeDia) {
    for (let i = 3; i > 0; i--) {
      fill(255, 211, 92, 22);
      circle(x, y, u * (6 + i * 2.4 + sin(frameCount * 0.03)));
    }
    fill(PALETA.polen);
    circle(x, y, u * 6);
  } else {
    fill(255, 246, 233, 230);
    circle(x, y, u * 5);
    fill(lerpColor(cieloAlto, cieloBajo, y / height));   // recorte: luna creciente
    circle(x + u * 1.3, y - u * 0.7, u * 3.8);
  }
}

function dibujarSuelo() {
  noStroke();
  fill(PALETA.suelo);
  beginShape();
  vertex(0, height);
  for (let x = 0; x <= width; x += 6) {
    vertex(x, alturaSuelo() + noise(x * 0.012) * u * 4 - u * 2);
  }
  vertex(width, height);
  endShape(CLOSE);
}

// ---------------------------------------------------------------------------
// TALLO Y HOJAS (sesiones completadas hoy)
// ---------------------------------------------------------------------------
function dibujarTallo(flor, sesionesHoy) {
  const base = createVector(flor.x - u * 3, alturaSuelo() + u);
  const viento = sin(frameCount * 0.02) * u * 1.2;

  stroke(PALETA.tallo);
  strokeWeight(u * 1.1);
  noFill();
  bezier(base.x, base.y, base.x + u * 5 + viento, lerp(base.y, flor.y, 0.6),
    flor.x - u * 4 + viento, lerp(base.y, flor.y, 0.25), flor.x, flor.y);

  // Una hoja por sesión de enfoque terminada hoy. La última brota poco a poco.
  const hojas = min(sesionesHoy, MAX_HOJAS);
  for (let i = 0; i < hojas; i++) {
    let tam = 1;
    if (i === hojas - 1) {
      tam = easeOut(constrain((millis() - hojaNuevaDesde) / 1500, 0, 1));
    }
    const k = map(i, 0, MAX_HOJAS - 1, 0.1, 0.62);          // de abajo arriba
    const p = puntoDelTallo(base, flor, viento, k);
    const lado = i % 2 === 0 ? -1 : 1;
    const angulo = lado * (PI / 3.2) + sin(frameCount * 0.03 + i) * 0.12;
    dibujarHoja(p.x, p.y, angulo, u * 7 * tam, lado);
  }
}

// Punto de la curva del tallo (mismos puntos de control que bezier() de arriba)
function puntoDelTallo(base, flor, viento, k) {
  const x = bezierPoint(base.x, base.x + u * 5 + viento, flor.x - u * 4 + viento, flor.x, k);
  const y = bezierPoint(base.y, lerp(base.y, flor.y, 0.6), lerp(base.y, flor.y, 0.25), flor.y, k);
  return createVector(x, y);
}

function dibujarHoja(x, y, angulo, largo, lado) {
  if (largo < 0.5) {
    return;
  }
  push();
  translate(x, y);
  rotate(angulo);
  noStroke();
  fill(PALETA.hoja);
  // p5 2.x: cada bezierVertex() es un punto (control 1, control 2, destino)
  beginShape();
  vertex(0, 0);
  bezierVertex(largo * 0.35 * lado, -largo * 0.2);
  bezierVertex(largo * 0.35 * lado, -largo * 0.8);
  bezierVertex(0, -largo);
  bezierVertex(-largo * 0.1 * lado, -largo * 0.6);
  bezierVertex(-largo * 0.05 * lado, -largo * 0.2);
  bezierVertex(0, 0);
  endShape(CLOSE);
  stroke(PALETA.tallo);
  strokeWeight(max(0.6, largo * 0.04));
  line(0, 0, largo * 0.05 * lado, -largo * 0.85);           // nervio central
  pop();
}

// ---------------------------------------------------------------------------
// PÉTALOS (progreso de la sesión)
// ---------------------------------------------------------------------------
// cantidad: de 0 a 12 con decimales. La parte entera son los pétalos
// completos; la parte decimal es el tamaño del pétalo que está creciendo
// (enfoque) o desapareciendo (descanso).
function dibujarPetalos(flor, cantidad, escalaCentro, colorCentro) {
  const largo = u * 15;
  const completos = floor(cantidad);
  const fraccion = cantidad - completos;

  push();
  translate(flor.x, flor.y);
  for (let i = 0; i < 12; i++) {
    const angulo = -HALF_PI + i * TWO_PI / 12 + sin(frameCount * 0.015 + i) * 0.03;
    // silueta tenue: enseña la flor que se puede llegar a cultivar
    dibujarPetalo(angulo, largo, color(255, 255, 255, 22));
    let tam = 0;
    if (i < completos) {
      tam = 1;
    } else if (i === completos) {
      tam = fraccion;
    }
    if (tam > 0.01) {
      const c = color(COLORES_PETALO[i]);
      if (tam < 1) {
        c.setAlpha(170);                                     // el pétalo «en camino» es translúcido
      }
      dibujarPetalo(angulo, largo * easeOut(tam), c);
    }
  }
  // centro de la flor
  const r = u * 7.4 * escalaCentro;
  noStroke();
  fill(0, 0, 0, 40);
  circle(0, u * 0.5, r * 1.03);
  fill(colorCentro);
  circle(0, 0, r);
  fill(255, 255, 255, 70);
  circle(-r * 0.16, -r * 0.16, r * 0.3);
  pop();
}

function dibujarPetalo(angulo, largo, c) {
  push();
  rotate(angulo);
  noStroke();
  fill(c);
  beginShape();
  vertex(u * 2, 0);
  bezierVertex(largo * 0.45, -largo * 0.32);
  bezierVertex(largo * 0.95, -largo * 0.2);
  bezierVertex(largo, 0);
  bezierVertex(largo * 0.95, largo * 0.2);
  bezierVertex(largo * 0.45, largo * 0.32);
  bezierVertex(u * 2, 0);
  endShape(CLOSE);
  pop();
}

// En descanso: si el número de pétalos baja, el que se va cae como partícula
function detectarPetalosCaidos(flor, cantidad) {
  const ahora = floor(cantidad);
  if (petalosAntes !== -1 && ahora < petalosAntes) {
    for (let i = ahora; i < petalosAntes; i++) {
      const a = -HALF_PI + i * TWO_PI / 12;
      particulas.push(nuevaParticula(flor.x + cos(a) * u * 8, flor.y + sin(a) * u * 8,
        'petalo', color(COLORES_PETALO[i])));
    }
  }
  petalosAntes = ahora;
}

// ---------------------------------------------------------------------------
// ANILLO DE POLEN (segundos del minuto en curso)
// ---------------------------------------------------------------------------

// Añade un grano por cada segundo nuevo. Al completar un minuto el anillo
// se dispersa con el viento (como en la R1).
function actualizarAnillo(segundo) {
  if (segundo === ultimoSegundo) {
    return;
  }
  if (ultimoSegundo === -1) {
    // primer fotograma tras abrir el popup: el anillo aparece ya formado
    granos = [];
    for (let i = 1; i <= segundo; i++) {
      granos.push({ indice: i, nacido: -100000 });
    }
  } else if (segundo > ultimoSegundo) {
    for (let i = ultimoSegundo + 1; i <= segundo; i++) {
      granos.push({ indice: i, nacido: millis() });
    }
  } else {
    // ha dado la vuelta: minuto completado
    dispersarPolen();
    for (let i = 1; i <= segundo; i++) {
      granos.push({ indice: i, nacido: millis() });
    }
  }
  ultimoSegundo = segundo;
}

function reiniciarAnillo() {
  granos = [];
  ultimoSegundo = -1;
  petalosAntes = -1;
}

function dibujarAnilloPolen(flor) {
  const radio = u * 20;
  noStroke();
  for (let i = 0; i < 60; i++) {                             // guía de los 60 huecos
    const p = posicionEnAnillo(flor, radio, i);
    fill(255, 255, 255, i % 5 === 0 ? 80 : 40);
    circle(p.x, p.y, u * (i % 5 === 0 ? 0.8 : 0.5));
  }
  for (const g of granos) {                                  // cada grano viaja del centro a su hueco
    const destino = posicionEnAnillo(flor, radio, g.indice);
    const k = easeOut(constrain((millis() - g.nacido) / 800, 0, 1));
    const x = lerp(flor.x, destino.x, k);
    const y = lerp(flor.y, destino.y, k);
    fill(255, 211, 92, 60);
    circle(x, y, u * 2);
    stroke(27, 31, 51, 110);
    strokeWeight(0.6);
    fill(PALETA.polen);
    circle(x, y, u * (g.indice % 5 === 0 ? 1.5 : 1.1));
    noStroke();
  }
}

function posicionEnAnillo(flor, radio, indice) {
  const a = -HALF_PI + indice * TWO_PI / 60;
  return createVector(flor.x + cos(a) * radio, flor.y + sin(a) * radio);
}

// ---------------------------------------------------------------------------
// PARTÍCULAS (polen, pétalos y celebración)
// ---------------------------------------------------------------------------
// Cada partícula es un objeto con posición, velocidad, giro y vida.
// En cada fotograma: velocidad += viento (ruido Perlin) + gravedad,
// posición += velocidad, vida -= algo. Cuando la vida llega a 0 se borra.
// (Basado en el capítulo 4 de The Nature of Code, D. Shiffman.)

function nuevaParticula(x, y, tipo, c) {
  return {
    x: x,
    y: y,
    tipo: tipo,
    c: c,
    vx: random(-0.3, 0.9),
    vy: tipo === 'polen' ? random(-0.9, 0) : random(-0.2, 0.3),
    giro: random(TWO_PI),
    vida: 255,
    semilla: random(1000)
  };
}

function dispersarPolen() {
  const flor = posicionFlor();
  for (const g of granos) {
    const p = posicionEnAnillo(flor, u * 20, g.indice);
    particulas.push(nuevaParticula(p.x, p.y, 'polen', color(PALETA.polen)));
  }
  granos = [];
}

// Al terminar una sesión de enfoque: ¡fiesta de pétalos y polen!
function celebrar() {
  const flor = posicionFlor();
  for (let i = 0; i < 12; i++) {
    const a = -HALF_PI + i * TWO_PI / 12;
    const p = nuevaParticula(flor.x + cos(a) * u * 10, flor.y + sin(a) * u * 10,
      'petalo', color(COLORES_PETALO[i]));
    p.vx = cos(a) * random(0.6, 1.4);
    p.vy = sin(a) * random(0.6, 1.4) - 0.5;
    particulas.push(p);
  }
  for (let i = 0; i < 30; i++) {
    const p = nuevaParticula(flor.x, flor.y, 'polen', color(PALETA.polen));
    p.vx = random(-1.5, 1.5);
    p.vy = random(-1.8, 0.4);
    particulas.push(p);
  }
  hojaNuevaDesde = millis();
}

function actualizarParticulas() {
  while (particulas.length > MAX_PARTICULAS) {
    particulas.shift();                                      // las más antiguas fuera
  }
  noStroke();
  // recorro al revés para poder borrar con splice() sin saltarme ninguna
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];
    const viento = (noise(p.semilla, frameCount * 0.015) - 0.4) * 1.2;
    p.vx += viento * 0.04;
    p.vy += p.tipo === 'polen' ? -0.004 : 0.025;             // el polen flota, los pétalos caen
    p.x += p.vx;
    p.y += p.vy;
    p.giro += 0.04;
    p.vida -= p.tipo === 'polen' ? 2.2 : 1.6;
    p.c.setAlpha(max(0, p.vida));
    fill(p.c);
    push();
    translate(p.x, p.y);
    rotate(p.giro);
    if (p.tipo === 'polen') {
      circle(0, 0, u * 1.1);
    } else {
      ellipse(0, 0, u * 3.4, u * 1.4);
    }
    pop();
    if (p.vida <= 0 || p.y > height + 10) {
      particulas.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// PANEL DE TIEMPO (lado derecho del canvas)
// ---------------------------------------------------------------------------
function dibujarPanelTiempo(oscuridad, datos) {
  const tinta = oscuridad > 0.45 ? color(PALETA.claro) : color(PALETA.oscuro);
  const x = width * 0.56;
  const anchoBarra = width - x - u * 7;

  // «Cristal» translúcido detrás del texto: el sol o la luna pueden pasar
  // por detrás sin que se deje de leer el tiempo (lo vi en las pruebas de tarde).
  noStroke();
  if (oscuridad > 0.45) {
    fill(20, 26, 51, 90);
  } else {
    fill(255, 255, 255, 95);
  }
  rect(x - u * 5, height * 0.13, width - x + u * 2, height * 0.74, 8);

  fill(tinta);
  textAlign(LEFT, BASELINE);

  textFont(fuenteMono);
  textSize(8);
  text(datos.etiqueta, x, height * 0.27);

  textFont(fuenteTitulo);
  textSize(44);
  text(datos.tiempo, x - 1, height * 0.6);

  // barra de progreso fina
  const yBarra = height * 0.67;
  fill(red(tinta), green(tinta), blue(tinta), 50);
  rect(x, yBarra, anchoBarra, 2.5, 2);
  fill(datos.colorBarra);
  rect(x, yBarra, anchoBarra * datos.progreso, 2.5, 2);

  fill(tinta);
  textFont(fuenteMono);
  textSize(8.5);
  text(datos.detalle, x, height * 0.79);
}

// ---------------------------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------------------------

// Suavizado de salida: arranca rápido y frena al final
function easeOut(k) {
  return 1 - pow(1 - k, 3);
}

// Suavizado de entrada y salida (para la respiración)
function easeInOut(k) {
  return k < 0.5 ? 4 * k * k * k : 1 - pow(-2 * k + 2, 3) / 2;
}
