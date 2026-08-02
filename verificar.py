#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Revisa el tablero antes de subirlo. Falla si encuentra algo que ya rompió antes.

    python verificar.py            # revisa todo
    python verificar.py --staged   # solo lo que va en el commit (para el hook)

Cada regla existe porque un error real llegó a producción. La fecha dice cuál.
"""
import io, json, os, re, subprocess, sys, tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
HTML = ['index.html', 'tablero.html', 'captura_series.html', 'admin.html',
        'comisiones.html', 'actualizar_datos.html']
# Copias del Apps Script. No se ejecutan aquí, pero se publican igual que lo
# demás: si traen una llave, queda expuesta lo mismo que en un .html.
GS = ['GAS_Codigo.gs', 'GAS_ventas_detalle.gs', 'GAS_arreglo_apartados.gs',
      'GAS_fechas.gs', 'GAS_guardian.gs']

fallas, avisos = [], []
def falla(regla, msg): fallas.append((regla, msg))
def aviso(regla, msg): avisos.append((regla, msg))
def leer(p):
    try: return io.open(os.path.join(BASE, p), encoding='utf-8').read()
    except OSError: return None

def scripts_de(html):
    """El JS embebido, sin los <script src=...>."""
    return '\n;\n'.join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))


# ── 1 · Sintaxis ────────────────────────────────────────────
def r_sintaxis():
    node = None
    for cand in ('node', 'node.exe'):
        try:
            subprocess.run([cand, '--version'], capture_output=True, timeout=10)
            node = cand; break
        except (OSError, subprocess.SubprocessError):
            pass
    if not node:
        aviso('sintaxis', 'node no está instalado: no se pudo validar el JS')
        return
    for p in HTML:
        s = leer(p)
        if s is None: continue
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
        f.write(scripts_de(s)); f.close()
        r = subprocess.run([node, '--check', f.name], capture_output=True, text=True)
        os.unlink(f.name)
        if r.returncode:
            falla('sintaxis', '%s: %s' % (p, (r.stderr.strip().splitlines() or [''])[0][:110]))


# ── 2 · Funciones usadas sin definir ────────────────────────
# 1-ago-2026: se usó gasPost() en captura_series.html sin haberlo definido.
# Cada venta moría con ReferenceError dentro de un try/catch que lo tomaba por
# "sin conexión", así que la app decía que guardaba. No llegó nada a la hoja.
def r_helpers():
    for p in HTML:
        s = leer(p)
        if s is None: continue
        js = scripts_de(s)
        usados = set(re.findall(r'\b([a-zA-Z_][\w]*)\s*\(', js))
        definidos = set(re.findall(r'function\s+([a-zA-Z_][\w]*)', js))
        definidos |= set(re.findall(r'(?:const|let|var)\s+([a-zA-Z_][\w]*)\s*=\s*(?:function|\()', js))
        definidos |= set(re.findall(r'(?:const|let|var)\s+([a-zA-Z_][\w]*)\s*=\s*[a-zA-Z_$][\w]*\s*=>', js))
        # Solo vigilamos los helpers propios del proyecto: lo demás es ruido
        # (APIs del navegador, librerías, métodos).
        propios = {'gasPost', 'gasQS', 'gasPedir', 'gasJsonp', 'jsonp', 'catJsonp',
                   'avisoNube', 'guardarInvCache', 'pintarUpdated', 'segSelector',
                   'desgloseHtml', 'msiInfo', 'vigenteHoy', 'promoActiva'}
        faltan = (usados & propios) - definidos
        if faltan:
            falla('helpers', '%s usa sin definir: %s' % (p, ', '.join(sorted(faltan))))


# ── 3 · Versión del service worker ──────────────────────────
# 1-ago-2026: se cambiaron seis .html y no se subió VERSION. Los celulares
# siguieron con la copia cacheada y NINGÚN arreglo llegó, aunque Pages ya
# sirviera lo nuevo. Se depuró durante horas sobre una versión que nadie tenía.
def r_version(staged):
    sw = leer('sw.js')
    if sw is None:
        falla('sw', 'no se encontró sw.js'); return
    m = re.search(r"const VERSION\s*=\s*'([^']+)'", sw)
    if not m:
        falla('sw', 'no se pudo leer VERSION de sw.js'); return
    ver = m.group(1)

    cambiados = git_cambiados(staged)
    if not cambiados: return
    tocaron_app = [c for c in cambiados
                   if c.endswith('.html') or c.endswith('datos.js')]
    if tocaron_app and 'sw.js' not in cambiados:
        falla('sw', 'cambiaron %s pero VERSION sigue en %s. Súbela en sw.js o los '
                    'celulares no reciben nada.' % (', '.join(tocaron_app[:3]), ver))

    # Todo lo precacheado tiene que existir: un 404 rompe la instalación entera.
    for arch in re.findall(r"'\./([^']+)'", sw):
        if not os.path.exists(os.path.join(BASE, arch)):
            falla('sw', 'sw.js precachea "%s" y ese archivo no existe' % arch)


def git_cambiados(staged):
    cmd = ['git', 'diff', '--name-only'] + (['--cached'] if staged else ['HEAD'])
    try:
        r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True, timeout=20)
        return [os.path.basename(x) for x in r.stdout.split('\n') if x.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


# ── 4 · Datos personales ────────────────────────────────────
# 1-ago-2026: el repo es público y traía nombres completos, números de empleado
# y —en comisiones_datos.js— venta individual y monto de comisión de cada quien.
def r_personales():
    patrones = [
        (r'\b\d{6}\b(?!\s*(?:pieza|pzas|MSI))', 'número de empleado'),
        (r'(?i)\b(perea arias|garcia gutierrez|garcía gutiérrez|aguilar rosete|'
         r'gonzalez arrieta|gonzález arrieta|bonilla gal)', 'apellidos del equipo'),
    ]
    for p in HTML + ['datos.js']:
        s = leer(p)
        if s is None: continue
        for rx, que in patrones:
            hits = re.findall(rx, s)
            if hits:
                muestra = hits[0] if isinstance(hits[0], str) else hits[0][0]
                falla('datos', '%s parece traer %s (ej. "%s")' % (p, que, str(muestra)[:24]))


# ── 5 · Secretos ────────────────────────────────────────────
# 2-ago-2026: al respaldar el Apps Script se vio que configurarOneSignal() traía
# la App ID y la API key escritas en el código. Nunca llegó a este repo —que es
# público— porque el GAS no estaba versionado, pero al versionarlo habría
# entrado con todo y llave. De ahí los dos últimos patrones.
def r_secretos():
    patrones = [(r'sb_secret_[A-Za-z0-9_-]{8,}', 'llave secreta de Supabase'),
                (r'service_role', 'service_role'),
                (r'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}', 'JWT'),
                (r"GAS_TOKEN\s*=\s*['\"][A-Za-z0-9]{16,}", 'token escrito a mano'),
                (r'os_v2_app_[A-Za-z0-9]{16,}', 'API key de OneSignal'),
                (r"ONESIGNAL_(?:KEY|APP_ID)['\"]?\s*:\s*['\"][A-Za-z0-9-]{8,}",
                 'credencial de OneSignal escrita en el código')]
    for p in HTML + ['sw.js', 'datos.js'] + GS:
        s = leer(p)
        if s is None: continue
        for rx, que in patrones:
            if re.search(rx, s):
                falla('secretos', '%s contiene %s' % (p, que))


# ── 6 · Errores que se tragan en silencio ───────────────────
# Todos los fallos de hoy tardaron horas en verse porque nadie los pintaba:
# el catch asumía "sin conexión" y la app seguía como si nada.
def r_silencios():
    """Un catch vacío solo se acepta con el motivo escrito.

    Los 26 que había se revisaron uno por uno el 2-ago-2026: 19 eran legítimos
    (cachés de localStorage, el beep de la captura) y llevan su comentario; los
    otros tapaban fallas reales y ahora avisan. La regla es que cualquiera nuevo
    tenga explicación al lado o arriba, para no volver a acumularlos sin querer.
    """
    for p in HTML:
        s = leer(p)
        if s is None: continue
        L = scripts_de(s).split('\n')
        sin_motivo = []
        for i, l in enumerate(L):
            if not re.search(r'catch\s*\([^)]*\)\s*\{\s*\}', l):
                continue
            # cuenta como justificado un // en la misma línea, o encima del try
            resto = l.split('catch', 1)[1]
            if '//' in resto: continue
            arriba = '\n'.join(L[max(0, i - 4):i])
            if '//' in arriba: continue
            sin_motivo.append(i + 1)
        if sin_motivo:
            falla('silencio', '%s: catch vacío sin explicar en línea(s) %s. '
                              'Si callar es correcto, escribe por qué al lado; '
                              'si no, que avise.'
                  % (p, ', '.join(map(str, sin_motivo[:6]))))


# ── 7 · Cadenas que se rompen juntas ────────────────────────
# Ver MAPA.md. Cada una tumbó algo en producción el 1-ago-2026.
def r_cadenas():
    # 7a · La sesión se arma campo por campo: lo que devuelve login_asesor
    # tiene que estar nombrado en index.html o se pierde en silencio.
    idx = leer('index.html')
    if idx:
        # Hay DOS cfg (login por PIN y login por sesión de gerente) y los dos
        # tienen que llevar los mismos campos: se arman uno por uno, así que
        # basta olvidarlo en uno para que esa vía quede sin token.
        cfgs = re.findall(r'const cfg\s*=\s*\{[^}]*\}', idx)
        if len(cfgs) < 2:
            aviso('cadena', 'index.html: esperaba dos "const cfg"; revisa a mano '
                            'que ambos caminos de login guarden lo mismo')
        for n, bloque in enumerate(cfgs, 1):
            for campo in ('store_id', 'gas_url', 'gas_token', 'vendedores'):
                if campo not in bloque:
                    falla('cadena', 'index.html: el cfg #%d no guarda "%s"; quien '
                                    'entre por ahí se queda sin él (MAPA cadena 1)'
                                    % (n, campo))
        m = re.search(r"const COLS\s*=\s*'([^']+)'", idx)
        if m and 'gas_token' not in m.group(1):
            falla('cadena', 'index.html: COLS no pide gas_token, el gerente entra sin token')

    # 7b · El precio que se cobra y el que se muestra usan la misma prioridad.
    cap, tab = leer('captura_series.html'), leer('tablero.html')
    if cap and 'promoActiva' in cap and 'if(!pr.d2) return null;' not in cap:
        falla('cadena', 'captura_series: promoActiva ya no exige fecha de fin; '
                        'volvería a cobrar promociones vencidas (MAPA cadena 3)')
    if tab and 'const vigenteHoy' in tab and '!!x.d2' not in tab:
        falla('cadena', 'tablero: vigenteHoy ya no exige fecha de fin (MAPA cadena 3)')

    # 7c · Escanear y teclear deben llenar igual.
    if cap and 'CAT_POR_SKU' in cap:
        if cap.count('aplicarProducto(') < 3:
            falla('cadena', 'captura_series: escanear y teclear ya no comparten '
                            'aplicarProducto; van a divergir (MAPA cadena 4)')

    # 7d · La fórmula del stock. Se verificó en piso: On Hand NO incluye exhibición.
    if tab and re.search(r'item\.stock\s*=\s*Math\.max\(0,\s*o\s*-\s*e\b', tab):
        falla('cadena', 'tablero: finalizarStock está restando la exhibición del '
                        'On Hand. Se comprobó en piso que NO se solapan: mostraría '
                        'menos stock del real (MAPA cadena 5)')


def main():
    staged = '--staged' in sys.argv
    r_sintaxis(); r_helpers(); r_version(staged)
    r_personales(); r_secretos(); r_silencios(); r_cadenas()

    for regla, msg in avisos:
        print('  aviso  [%s] %s' % (regla, msg))
    for regla, msg in fallas:
        print('  FALLA  [%s] %s' % (regla, msg))

    if fallas:
        print('\n%d problema(s). No subas esto todavía.' % len(fallas))
        return 1
    print('\nTodo en orden%s.' % (' (%d aviso[s])' % len(avisos) if avisos else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
