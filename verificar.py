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
def r_secretos():
    patrones = [(r'sb_secret_[A-Za-z0-9_-]{8,}', 'llave secreta de Supabase'),
                (r'service_role', 'service_role'),
                (r'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}', 'JWT'),
                (r"GAS_TOKEN\s*=\s*['\"][A-Za-z0-9]{16,}", 'token escrito a mano')]
    for p in HTML + ['sw.js', 'datos.js']:
        s = leer(p)
        if s is None: continue
        for rx, que in patrones:
            if re.search(rx, s):
                falla('secretos', '%s contiene %s' % (p, que))


# ── 6 · Errores que se tragan en silencio ───────────────────
# Todos los fallos de hoy tardaron horas en verse porque nadie los pintaba:
# el catch asumía "sin conexión" y la app seguía como si nada.
def r_silencios():
    for p in HTML:
        s = leer(p)
        if s is None: continue
        js = scripts_de(s)
        # catch que no hace absolutamente nada, ni siquiera un comentario
        vacios = len(re.findall(r'catch\s*\([^)]*\)\s*\{\s*\}', js))
        if vacios:
            aviso('silencio', '%s tiene %d catch vacío(s): si algo falla ahí, '
                              'nadie se entera' % (p, vacios))


def main():
    staged = '--staged' in sys.argv
    r_sintaxis(); r_helpers(); r_version(staged)
    r_personales(); r_secretos(); r_silencios()

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
