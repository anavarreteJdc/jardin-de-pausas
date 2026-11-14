"""
Pruebas de «Jardín de pausas» sin esperar 25 minutos de verdad.

Abre popup.html en un navegador sin ventana (Playwright + Chromium),
fija la hora del reloj del navegador, mete un estado en localStorage
(como lo dejaría storeItem()) y comprueba qué hace la extensión al abrirse.
También guarda una captura de cada caso en pruebas/capturas/.

Instalación:  pip install playwright  &&  python -m playwright install chromium
Uso:          python pruebas/probar_estados.py      (desde la carpeta del proyecto)

Nota: aquí la página se sirve por http://, no como extensión, así que
browser.storage no existe y solo se prueba la parte de storeItem()/getItem().
El permiso "storage" se comprueba a mano en Firefox (about:debugging).
"""
import datetime
import functools
import http.server
import json
import os
import threading

from playwright.sync_api import sync_playwright

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SALIDA = os.path.join(os.path.dirname(__file__), 'capturas')
PUERTO = 8765
HOY = '2026-11-14'


def ms(texto):
    """'2026-11-14T10:30:00' (hora local) -> milisegundos desde 1970."""
    return int(datetime.datetime.fromisoformat(texto).timestamp() * 1000)


def servidor():
    class Silencioso(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    manejador = functools.partial(Silencioso, directory=RAIZ)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PUERTO), manejador)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def caso(navegador, nombre, ahora, estado=None, dia=None, comprobar=None):
    ctx = navegador.new_context(viewport={'width': 348, 'height': 440},
                                device_scale_factor=2, timezone_id='Europe/Madrid')
    pagina = ctx.new_page()
    errores = []
    pagina.on('pageerror', lambda e: errores.append(str(e)))
    pagina.clock.install(time=ahora / 1000)      # el reloj empieza en «ahora»
    pagina.clock.resume()                        # ...y sigue corriendo

    # 1. Preparar localStorage igual que lo dejaría storeItem()
    pagina.goto(f'http://127.0.0.1:{PUERTO}/style.css')   # misma página = mismo localStorage
    if estado is not None:
        pagina.evaluate("([k, v]) => { localStorage.setItem(k, v); localStorage.setItem(k + 'p5TypeID', 'object'); }",
                        ['jp_estado', json.dumps(estado)])
    if dia is not None:
        pagina.evaluate("([k, v]) => { localStorage.setItem(k, v); localStorage.setItem(k + 'p5TypeID', 'object'); }",
                        ['jp_dia', json.dumps(dia)])

    # 2. Abrir el popup
    pagina.goto(f'http://127.0.0.1:{PUERTO}/popup.html')
    pagina.wait_for_timeout(2500)
    pagina.locator('#app').screenshot(path=os.path.join(SALIDA, nombre + '.png'))

    # 3. Leer el resultado
    r = pagina.evaluate("""() => ({
        estado: JSON.parse(localStorage.getItem('jp_estado')),
        dia: JSON.parse(localStorage.getItem('jp_dia')),
        mensaje: document.querySelector('.mensaje').textContent,
        boton: document.querySelector('.principal').textContent
    })""")
    ok = comprobar(r) if comprobar else True
    print(('OK   ' if ok and not errores else 'FALLO'), nombre, '|', r['mensaje'])
    for e in errores:
        print('      error:', e)
    ctx.close()


def main():
    os.makedirs(SALIDA, exist_ok=True)
    srv = servidor()
    base = {'minutos': {'enfoque': 25, 'descanso': 5}, 'transcurrido': 0}
    with sync_playwright() as p:
        nav = p.chromium.launch()
        # Primera vez: sin nada guardado
        caso(nav, '01_primera_vez', ms(f'{HOY}T16:40:00'),
             comprobar=lambda r: r['dia']['sesiones'] == 0 and r['boton'] == 'Iniciar')
        # Enfoque en marcha que empezó hace 14:23 (popup cerrado mientras tanto)
        caso(nav, '02_enfoque_en_marcha', ms(f'{HOY}T10:30:00'),
             estado=dict(base, modo='enfoque', corriendo=True, inicio=ms(f'{HOY}T10:30:00') - (14 * 60 + 23) * 1000),
             dia={'fecha': HOY, 'sesiones': 3, 'minutos': 75},
             comprobar=lambda r: r['estado']['corriendo'] and r['boton'] == 'Pausar')
        # Descanso de noche (respiración)
        caso(nav, '03_descanso_noche', ms(f'{HOY}T22:10:00'),
             estado=dict(base, modo='descanso', corriendo=True, inicio=ms(f'{HOY}T22:10:00') - 130 * 1000),
             dia={'fecha': HOY, 'sesiones': 6, 'minutos': 150})
        # La sesión terminó (18:55) con el popup cerrado: se cuenta al abrir a las 19:05
        caso(nav, '04_termino_con_popup_cerrado', ms(f'{HOY}T19:05:00'),
             estado=dict(base, modo='enfoque', corriendo=True, inicio=ms(f'{HOY}T18:30:00')),
             dia={'fecha': HOY, 'sesiones': 2, 'minutos': 50},
             comprobar=lambda r: r['dia']['sesiones'] == 3 and r['estado']['modo'] == 'descanso')
        # Sesión en pausa guardada ayer: el resumen del día se reinicia, la pausa se mantiene
        caso(nav, '05_pausa_y_dia_nuevo', ms(f'{HOY}T08:15:00'),
             estado={'modo': 'enfoque', 'minutos': {'enfoque': 50, 'descanso': 10}, 'corriendo': False,
                     'inicio': 0, 'transcurrido': (31 * 60 + 5) * 1000},
             dia={'fecha': '2026-11-13', 'sesiones': 4, 'minutos': 100},
             comprobar=lambda r: r['dia']['sesiones'] == 0 and r['boton'] == 'Continuar')
        nav.close()
    srv.shutdown()


if __name__ == '__main__':
    main()
