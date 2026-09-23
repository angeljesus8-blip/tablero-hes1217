#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Revisa el tablero antes de subirlo. Falla si encuentra algo que ya rompió antes.

    python verificar.py            # revisa todo
    python verificar.py --staged   # solo lo que va en el commit (para el hook)

Cada regla existe porque un error real llegó a producción. La fecha dice cuál.
"""
import glob, io, json, os, re, subprocess, sys, tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
HTML = ['index.html', 'tablero.html', 'captura_series.html', 'admin.html',
        'comisiones.html', 'horarios.html']
# actualizar_datos.html se retiró el 22-sep-2026: quedó una página mínima que
# manda a Admin, sin cargas ni sesión. Por eso ya no está en estas listas.
# horarios.html no se edita aquí: es copia de horario_semanal.html, que se
# publica también en el repo planeador-odemas para las demás tiendas.
# 9-sep-2026: la carpeta se reorganizó como bóveda de Obsidian. Antes esta ruta
# decía '..', '02_Equipo'; ahora las dos apps son hermanas dentro de 02-Apps\.
COPIAS = {'horarios.html': os.path.join('..', 'horario-semanal', 'horario_semanal.html')}
# Páginas que se PUBLICAN pero no son la app: no las sirve el service worker ni
# se enlazan desde el menú. No entran en HTML porque no deben obligar a subir
# VERSION —no llegan a ningún celular por esa vía— pero sí tienen que pasar por
# sintaxis, secretos y datos personales: se publican igual de expuestas.
# (20-ago-2026: `accesorios_tecnico.html` se subió sin que nada la revisara.)
SUELTOS = ['accesorios_tecnico.html']
# Copias del Apps Script. No se ejecutan aquí, pero se publican igual que lo
# demás: si traen una llave, queda expuesta lo mismo que en un .html.
GS = ['GAS_Codigo.gs', 'GAS_ventas_detalle.gs', 'GAS_arreglo_apartados.gs',
      'GAS_fechas.gs', 'GAS_guardian.gs', 'GAS_exportar.gs']

fallas, avisos = [], []
def falla(regla, msg): fallas.append((regla, msg))
def aviso(regla, msg): avisos.append((regla, msg))
def leer(p):
    try: return io.open(os.path.join(BASE, p), encoding='utf-8').read()
    except OSError: return None

def scripts_de(html):
    """El JS embebido, sin los <script src=...>."""
    return '\n;\n'.join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))


def zonas_script(html):
    """(inicio, fin) de cada bloque de JS embebido, en offsets del ARCHIVO.

    scripts_de() concatena y pierde la posición original, así que lo que se
    reporte con sus números manda a la línea equivocada del .html. Para avisar
    de algo hay que poder decir dónde está.
    """
    return [(m.start(1), m.end(1)) for m in
            re.finditer(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)]


def _fin_cadena(s, j):
    """Posición justo después de la comilla que cierra la cadena abierta en j."""
    q, k = s[j], j + 1
    while k < len(s):
        if s[k] == '\\':
            k += 2; continue
        if s[k] == q:
            return k + 1
        if s[k] == '\n':          # cadena sin cerrar: no nos tragamos el resto
            return k
        k += 1
    return len(s)


def _fin_template(s, j):
    """Igual para `plantillas`, saltando el código de cada ${...}."""
    k = j + 1
    while k < len(s):
        c = s[k]
        if c == '\\':
            k += 2; continue
        if c == '`':
            return k + 1
        if c == '$' and k + 1 < len(s) and s[k + 1] == '{':
            prof, m = 0, k + 1
            while m < len(s):
                if s[m] == '{':
                    prof += 1
                elif s[m] == '}':
                    prof -= 1
                    if prof == 0:
                        break
                elif s[m] in '"\'':
                    m = _fin_cadena(s, m); continue
                elif s[m] == '`':
                    m = _fin_template(s, m); continue
                m += 1
            k = m + 1; continue
        k += 1
    return len(s)


# Tras uno de estos, una "/" abre una expresión regular; tras un identificador,
# un número o un ")", es una división.
_ANTES_DE_REGEX = set('(,=:[!&|?{};+-*%~^<>')
_PALABRAS_REGEX = ('return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
                   'void', 'throw', 'case', 'do', 'else', 'yield', 'await')


def _abre_regex(s, j, anterior):
    if anterior == '' or anterior in _ANTES_DE_REGEX:
        return True
    izq = s[:j].rstrip()
    for w in _PALABRAS_REGEX:
        if izq.endswith(w):
            antes = izq[:-len(w)]
            if not antes or not (antes[-1].isalnum() or antes[-1] in '_$'):
                return True
    return False


def _fin_regex(s, j):
    k, en_clase = j + 1, False
    while k < len(s):
        c = s[k]
        if c == '\\':
            k += 2; continue
        if c == '\n':                 # no era una regex después de todo
            return j + 1
        if c == '[':
            en_clase = True
        elif c == ']':
            en_clase = False
        elif c == '/' and not en_clase:
            k += 1
            while k < len(s) and s[k].isalpha():   # banderas: gimsuy
                k += 1
            return k
        k += 1
    return len(s)


def cierre_de_bloque(s, i):
    """Contenido del bloque {...} que abre en s[i]. Devuelve (cuerpo, pos_cierre).

    Cuenta solo las llaves que son código: se salta las de dentro de cadenas,
    plantillas, comentarios y expresiones regulares. Contarlas a secas parece
    que funciona hasta que aparece un `catch(e){ log('}') }`, donde el bloque
    cerraría en la llave del texto y el cuerpo quedaría partido a la mitad —y
    esta función decide si un catch está vacío, así que equivocarse ahí es
    dejar pasar justo lo que se está buscando.
    """
    prof, j, anterior = 0, i, ''
    n = len(s)
    while j < n:
        c = s[j]

        if c == '/' and j + 1 < n and s[j + 1] == '/':
            k = s.find('\n', j)
            if k < 0:
                break
            j = k; continue

        if c == '/' and j + 1 < n and s[j + 1] == '*':
            k = s.find('*/', j + 2)
            j = n if k < 0 else k + 2
            continue

        if c in '"\'':
            j = _fin_cadena(s, j); anterior = c; continue

        if c == '`':
            j = _fin_template(s, j); anterior = c; continue

        if c == '/' and _abre_regex(s, j, anterior):
            j = _fin_regex(s, j); anterior = '/'; continue

        if c == '{':
            prof += 1
        elif c == '}':
            prof -= 1
            if prof == 0:
                return s[i + 1:j], j

        if not c.isspace():
            anterior = c
        j += 1
    return s[i + 1:], n


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
    for p in HTML + SUELTOS:
        s = leer(p)
        if s is None: continue
        f = tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8')
        f.write(scripts_de(s)); f.close()
        # Sin text=True: en Windows lo decodifica en cp1252 y REVIENTA si el
        # mensaje trae un emoji o un acento — o sea justo cuando hay un error
        # que reportar. El verificador se caía con un traceback en vez de decir
        # dónde estaba el fallo. (20-ago-2026)
        r = subprocess.run([node, '--check', f.name], capture_output=True)
        os.unlink(f.name)
        if r.returncode:
            err = r.stderr.decode('utf-8', 'replace')
            # La 1ª línea es la ruta del temporal; la 2ª, el código con el fallo,
            # y la que dice QUÉ pasa viene después. Se dan las dos útiles.
            lineas = [l.strip() for l in err.splitlines() if l.strip()]
            detalle = next((l for l in lineas if 'Error' in l), '')
            donde = lineas[1][:70] if len(lineas) > 1 else ''
            falla('sintaxis', '%s: %s  —  cerca de: %s' % (p, detalle[:90], donde))


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

        """Y las que ESTABAN y ya no estan, si se siguen usando.

        24-ago-2026: `accVerCrudo`, `accBotonCrudo` y `accAvisoFecha` se borraron
        sin querer al reemplazar un bloque de codigo, y siguieron llamandose. La
        pantalla dejo de leer tickets —la excepcion caia en el catch del OCR y
        salia «no se pudo leer»— y esto paso el verificador y se publico dos
        veces.

        La lista `propios` de arriba es fija y de trece nombres, escrita hace
        meses: ninguna funcion creada despues estaba vigilada. Ampliarla a mano
        deja el mismo agujero para la siguiente.

        Comparar con el commit anterior no necesita lista: lo que ayer existia y
        hoy no, y se sigue llamando, esta roto seguro. No caza una funcion que
        nunca existio —para eso esta `propios`— pero si el caso de hoy, que es
        borrar algo que estaba."""
        try:
            r = subprocess.run(['git', 'show', 'HEAD:./' + p], cwd=BASE,
                               capture_output=True, timeout=20,
                               encoding='utf-8', errors='replace')
            antes_js = scripts_de(r.stdout or '') if r.returncode == 0 else ''
        except (OSError, subprocess.SubprocessError):
            antes_js = ''
        if antes_js:
            antes_def = set(re.findall(r'function\s+([a-zA-Z_][\w]*)', antes_js))
            antes_def |= set(re.findall(r'(?:const|let|var|window\.)\s*([a-zA-Z_][\w]*)\s*=\s*(?:async\s+)?function', antes_js))
            ahora_def = set(definidos)
            ahora_def |= set(re.findall(r'window\.([a-zA-Z_][\w]*)\s*=\s*(?:async\s+)?function', js))
            borradas = (antes_def - ahora_def) & usados
            if borradas:
                falla('helpers', '%s BORRA funciones que sigue usando: %s. La pantalla '
                                 'revienta en cuanto se llame a una — y si es dentro de un '
                                 'catch, se ve como «no se pudo leer» y no como un fallo.'
                      % (p, ', '.join(sorted(borradas))))


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
    # Solo los archivos que SIRVE el service worker. Un .html que no está en
    # `HTML` ni en el precache no llega a ningún celular por esa vía, así que
    # exigir que suba VERSION es hacer saltar la regla por algo correcto — y una
    # regla que avisa de lo correcto se acaba ignorando. (17-ago-2026, con
    # `prueba_ticket.html`, una página suelta de medición; se borró el
    # 21-sep-2026 junto con el banco de escaneo, pero la regla se queda: la
    # siguiente página de medición tampoco debe obligar a subir VERSION.)
    precache = set(re.findall(r"'\./([^']+)'", sw))
    tocaron_app = [c for c in cambiados
                   if (c.endswith('.html') or c.endswith('datos.js'))
                   and (c in HTML or c in precache)]
    if tocaron_app and 'sw.js' not in cambiados:
        falla('sw', 'cambiaron %s pero VERSION sigue en %s. Súbela en sw.js o los '
                    'celulares no reciben nada.' % (', '.join(tocaron_app[:3]), ver))

    # Todo lo precacheado tiene que existir: un 404 rompe la instalación entera.
    for arch in re.findall(r"'\./([^']+)'", sw):
        if not os.path.exists(os.path.join(BASE, arch)):
            falla('sw', 'sw.js precachea "%s" y ese archivo no existe' % arch)


# ── 3b · Copias de archivos que se editan en otro lado ──────
# 4-ago-2026: el planeador de horarios pasó a abrirse dentro del tablero, así que
# ahora existe en dos carpetas. Editar una y olvidar la otra deja al equipo viendo
# un horario y al gerente otro, sin ninguna señal de que están desfasados.
# Solo avisa: en GitHub Actions se clona un repo sin 02_Equipo al lado, y ahí no
# hay contra qué comparar.
def r_copias():
    for copia, origen in COPIAS.items():
        a, b = leer(copia), leer(origen)
        if a is None:
            falla('copia', 'falta %s (se copia de %s)' % (copia, origen)); continue
        if b is None:
            # 9-sep-2026: antes esto era un `continue` mudo. En el runner de
            # GitHub el repo es SOLO el tablero y la fuente nunca está ahí, así
            # que callar allá es correcto. Pero en una máquina de trabajo el
            # silencio quería decir otra cosa: que la carpeta se movió y esta
            # comprobación se apagó sin avisar —justo la que impide que el
            # equipo de la 1217 siga viendo el horario de la semana pasada—.
            if not os.environ.get('GITHUB_ACTIONS'):
                aviso('copia', 'no encuentro %s. Aqui se comprueba que %s no se '
                               'quede atras: mientras la fuente no aparezca, esa '
                               'revision NO se esta haciendo.' % (origen, copia))
            continue
        if a != b:
            aviso('copia', '%s no es igual a %s. Vuelve a copiarla o el horario '
                           'del tablero se queda atrás.' % (copia, origen))


# ── 3b-bis · Quién lleva la tienda, dicho en dos archivos ───
# 6-sep-2026: `tablero.html` decide con `PUESTOS_GESTION` quién ve Resurtir, y
# `horarios.html` con `PUESTOS_GESTION_H` quién ve el horario del equipo. Son la
# MISMA pregunta escrita dos veces, y no se puede compartir: horarios.html se
# publica también en `planeador-odemas`, donde no existe nada del 1217.
#
# Si las dos listas se separan, ascender a alguien le abre una cosa y no la otra
# —o peor, se le quita el horario del equipo y sigue viendo los pedidos—, sin
# ningún error y sin nadie que ate el síntoma a dos listas distintas.
def r_puestos_gestion():
    def lista(archivo, nombre):
        txt = leer(archivo)
        if txt is None: return None
        m = re.search(r'(?:const|let|var)\s+' + nombre + r'\s*=\s*\[(.*?)\]', txt, re.S)
        if not m: return None
        return sorted(re.findall(r"'([^']+)'", m.group(1)))

    # (6-sep-2026) Son ya CUATRO. La de captura_series.html llevaba ahí desde el
    # 17-ago decidiendo quién ve el ✏️ de corregir una venta, y esta regla nació
    # sin mirarla: una lista de «quién manda» que nadie compara con las otras es
    # justo el problema que la regla viene a evitar.
    esperadas = [('horarios.html',       'PUESTOS_GESTION_H'),
                 ('comisiones.html',     'PUESTOS_GESTION_C'),
                 ('captura_series.html', '_PUESTOS_GESTION_CS')]

    a = lista('tablero.html', 'PUESTOS_GESTION')
    if a is None:
        falla('puestos', 'no encuentro PUESTOS_GESTION en tablero.html'); return
    for archivo, nombre in esperadas:
        b = lista(archivo, nombre)
        if b is None:
            falla('puestos', 'no encuentro %s en %s: sin ella, esa pantalla '
                             'decide quién ve qué por otra regla' % (nombre, archivo))
        elif a != b:
            falla('puestos', 'los puestos que llevan la tienda no coinciden: '
                             'tablero.html %s vs %s %s' % (a, archivo, b))


# ── 3b-bis · La sesión, separada por app ────────────────────
def r_sesion_prefijada():
    """Las tres claves de sesión llevan el prefijo de la app. Siempre.

    14-sep-2026. `localStorage` es POR ORIGEN, no por carpeta: todo lo que se
    publica bajo el mismo usuario de GitHub Pages —los dos tableros, el
    planeador, el showroom— comparte un solo almacén. Los cachés ya iban
    prefijados (`hes1217_inv_cache` vs `odemas_inv_cache`); las tres claves de
    SESIÓN no, y son justo las que dicen qué tienda y quién eres.

    Con eso, abrir el tablero multi-tienda dejaba su `hes_store` escrito para el
    de la 1217, que ni siquiera usa la misma base de datos. Nada avisaba: la
    sesión parecía válida y la pantalla se pintaba con la tienda equivocada.

    Una sola clave sin prefijo que vuelva a colarse basta para reabrirlo, así que
    lo que se prohíbe es el literal a secas. El fallo tardaría semanas en
    aparecer y no se parecería a su causa.
    """
    CLAVES = ('store', 'empleado', 'role')
    # `horarios.html` es el caso aparte: se publica en los DOS tableros y en el
    # planeador suelto, así que no puede llevar el prefijo escrito — lo deduce de
    # la ruta. Que lo siga deduciendo se comprueba abajo, no aquí.
    for p in [f for f in HTML + SUELTOS if os.path.basename(f) != 'horarios.html']:
        s = leer(p)
        if s is None: continue
        malas = sorted(set(re.findall(r"(?<![\w-])hes_(%s)\b" % '|'.join(CLAVES), s)))
        if malas:
            falla('sesion', '%s usa hes_%s sin prefijo de app. Todas las apps del '
                            'mismo origen comparten localStorage: sin prefijo, el '
                            'otro tablero te pisa la sesión y nada avisa. Usa '
                            'hes1217_%s.' % (p, ', hes_'.join(malas), malas[0]))

    # Y el que lo deduce, que lo siga deduciendo por los dos lados.
    h = leer('horarios.html')
    if h is not None:
        if 'prefijoDelTablero_' not in h:
            falla('sesion', 'horarios.html ya no deduce el prefijo de la ruta: se '
                            'publica en los dos tableros, y con el prefijo escrito '
                            'uno de los dos leería la sesión del otro')
        for ruta in ('/tablero-hes1217/', '/tablero-odemas/'):
            if ruta not in h:
                falla('sesion', 'horarios.html no reconoce la ruta %s: en ese '
                                'tablero dejaría de heredar la sesión y pediría '
                                'login sin motivo' % ruta)


# ── 3c · El cupo de preventa, en sus dos sitios ─────────────
# 5-ago-2026: el cupo vive en la const PREVENTA (lo que ve el asesor) y en la
# tabla preventa_cupo de Supabase (el tope que frena dos apartados a la vez).
# Subir uno y olvidar el otro deja al tablero ofreciendo una pieza que la base
# va a rechazar —o peor, al revés—. El .sql se genera con preventa_cupo_gen.py.
def r_cupo():
    sql = leer('supabase_preventa_cupo.sql')
    if sql is None: return            # todavía no se ha generado
    html = leer('tablero.html')
    if html is None: return
    m = re.search(r'const PREVENTA = \[(.*?)\n\];', html, re.S)
    if not m:
        # 8-ago-2026: la preventa de la Pura 90S terminó —los equipos llegaron—
        # y con ella se retiró la lista fija de SKUs con cupo. La tabla
        # `preventa_cupo` y su trigger se conservan en Supabase para la próxima
        # preventa; mientras no haya una, no hay nada que comparar.
        return
    enHtml = {sku: int(n) for sku, n in
              re.findall(r"sku:'(\d+)'.*?cupo:(\d+)", m.group(1))}
    enSql  = {sku: int(n) for sku, n in
              re.findall(r"\(\s*'\d+',\s*'(\d+)',\s*(\d+)\s*\)", sql)}
    if not enSql:
        falla('cupo', 'supabase_preventa_cupo.sql no trae ningún cupo'); return
    for sku in sorted(set(enHtml) | set(enSql)):
        a, b = enHtml.get(sku), enSql.get(sku)
        if a != b:
            falla('cupo', 'SKU %s: tablero.html dice %s y el .sql dice %s. '
                          'Corre preventa_cupo_gen.py' % (sku, a, b))


def r_preventa_sb():
    """La preventa dejó la hoja el 7-ago-2026. Estas tres cosas son las que, si
    se deshacen por descuido, no dan error: dan apartados que desaparecen de la
    pantalla o cupos contados sobre datos viejos."""
    html = leer('tablero.html')
    if html is None: return

    # 1 · Nada de preventa puede volver a escribirse en la hoja. Un apartado que
    #     entre por el Apps Script no lo lee nadie: no aparece en el tablero, no
    #     cuenta para el cupo, y su pieza se vende dos veces.
    for modo in ('apartado_add', 'apartado_estatus', 'apartado_del'):
        if 'modo=' + modo in html:
            falla('preventa', 'tablero.html vuelve a llamar modo=%s. La preventa '
                              'va a Supabase: usa apartado_guardar / apartado_estatus.' % modo)

    # 2 · aplicarTodo solo puede aceptar apartados de Supabase. Sin el candado
    #     __sb, la respuesta del Apps Script llega ~7 s después y borra de la
    #     pantalla el apartado recién guardado.
    m = re.search(r'if\s*\((.{0,40}?)Array\.isArray\(d\.apartados\)\)', html)
    if not m:
        falla('preventa', 'no encontré dónde aplicarTodo aplica los apartados en tablero.html')
    elif '__sb' not in m.group(1):
        falla('preventa', 'aplicarTodo acepta apartados sin comprobar d.__sb: los del '
                          'Apps Script salen de una hoja que ya nadie escribe y pisarían '
                          'lo que el asesor acaba de guardar.')

    # 3 · Las escrituras van firmadas. Sin p_token la base responde
    #     no_autorizado, y eso sale como "no se pudo guardar" sin decir por qué.
    if 'sbEscribir' in html and 'p_token: GAS_TOKEN' not in html:
        falla('preventa', 'sbEscribir dejó de mandar p_token: toda escritura de '
                          'preventa se va a rechazar con no_autorizado.')

    cap = leer('captura_series.html')
    if cap is not None and 'apartado_entregar' in cap and 'p_token' not in cap:
        falla('preventa', 'captura_series.html llama apartado_entregar sin p_token.')


def r_cargas_sb():
    """Las cargas del Excel dejaron la hoja el 7-ago-2026. Estas dos cosas, si
    se deshacen, no dan error: dan datos viejos con cara de actuales."""
    # 1 · Ninguna pantalla puede volver a mandar una carga al Apps Script. Si lo
    #     hiciera, el Excel iría a una hoja que ya nadie lee y el tablero
    #     seguiría con el inventario del día anterior — sin avisar de nada.
    for archivo in ('admin.html',):
        s = leer(archivo)
        if s is None: continue
        for tipo in ("tipo:'catalogo'", "tipo:'catalogo_ref'", "tipo:'exhibicion'",
                     "tipo:'promos'", "tipo:'comisiones'"):
            if tipo in s:
                falla('cargas', '%s vuelve a mandar %s al Apps Script. Las cargas van '
                                'a Supabase: usa carga_catalogo / carga_promos / …'
                      % (archivo, tipo))

    # 2 · El stock solo se acepta de Supabase. El `modo=todo` del Apps Script
    #     también trae inventario, pero de una hoja que ya no recibe el Excel:
    #     un stock viejo no es un dato incompleto, es uno falso.
    html = leer('tablero.html')
    if html is None: return
    m = re.search(r'(.{0,30})aplicarInventario\(d\.inventario\)', html)
    if not m:
        falla('cargas', 'no encontré dónde aplicarTodo aplica el inventario en tablero.html')
    elif '__sb' not in m.group(1):
        falla('cargas', 'aplicarTodo acepta inventario sin comprobar d.__sb: el del '
                        'Apps Script sale de una hoja que ya no recibe el Excel y '
                        'diría que hay piezas que ya se vendieron.')


def r_lectura_con_escritura():
    """Si Admin ESCRIBE algo en Supabase, tiene que LEERLO de Supabase.

    7-ago-2026: las escrituras de EOL, avisos, combos y comisiones se movieron en
    v125 y las cuatro listas siguieron leyendo del Apps Script — o sea de la hoja
    que ya no recibe nada. El gerente agregaba un EOL y la lista seguía enseñando
    la de antes; lo borraba y seguía ahí. No da error: da una pantalla que miente
    sobre lo que acabas de hacer.

    Es el mismo fallo que costó las dos fugas de la fase 2, repetido. Por eso
    ahora lo vigila una regla en vez de la memoria de nadie."""
    s = leer('admin.html')
    if s is None: return
    # (modo del Apps Script, función de Supabase que ya escribe ese dato)
    PARES = [('eol_cloud',    'eol_guardar'),
             ('avisos_cloud', 'aviso_guardar'),
             ('bundles',      'bundle_guardar'),
             ('comisiones',   'carga_comisiones')]
    for modo, escritura in PARES:
        if escritura in s and ("gasQS('modo=%s'" % modo) in s:
            falla('lectura', 'admin.html escribe %s en Supabase pero sigue leyendo '
                             'modo=%s del Apps Script: la lista enseñaría lo de la hoja, '
                             'que ya no recibe nada.' % (escritura, modo))


def r_porteros():
    """Una condición de permiso se pregunta desde UN solo sitio.

    17-ago-2026: «Ventas del día» se abrió a gerente y subgerente, pero solo en
    `updateDownloadAccess` —el que ENSEÑA el botón—. El `onclick` tenía su propia
    copia de la condición, con la versión vieja. El botón aparecía y al tocarlo
    decía "no tienes permiso", con el gerente delante.

    Es la misma lección de `seccionVisible_` en tablero.html, que existe porque
    esconder una sección son cuatro sitios y basta olvidar uno. La diferencia es
    que aquí nadie lo recordaba, así que ahora lo cuenta esta regla.

    No mira nombres de función: cuenta cuántas veces se COMPARA la constante. Si
    sale de una función, aparece una vez (en la función) y las demás la llaman.

    Solo vigila las constantes de SESIÓN —las que traen un valor de la config y
    se comparan contra el estado actual—, no las banderas booleanas ya
    calculadas. Se probó con `PUEDE_GESTIONAR` y da falso positivo:
    `confirmarPuesto()` hace `if(antes !== PUEDE_GESTIONAR)` para detectar un
    cambio, que no es decidir un permiso. Una regla que avisa de algo correcto
    se acaba ignorando, y entonces no avisa de nada.

    A esa bandera la cubren las pruebas del bloque 7 de `casos_tablero.js`, que
    comprueban los cuatro consultantes de `seccionVisible_`."""
    PERMISOS = [('captura_series.html', 'DESCARGA_AUTORIZADA')]
    for arch, const in PERMISOS:
        s = leer(arch)
        if s is None: continue
        # Comparaciones y usos en condición, no la declaración ni los comentarios
        js = scripts_de(s)      # devuelve un str, no una lista: no lo "juntes"
        js = re.sub(r'/\*[\s\S]*?\*/', '', js)
        js = re.sub(r'(?m)//.*$', '', js)
        usos = len(re.findall(r'[=!]==?\s*' + const + r'\b', js)) \
             + len(re.findall(r'\b' + const + r'\s*[=!]==?', js)) \
             + len(re.findall(r'(?:\|\||&&|\(|!)\s*' + const + r'\b(?!\s*[=:])', js))
        if usos > 1:
            falla('porteros', '%s decide con %s en %d sitios. Sácalo a UNA función '
                              'y que los demás la llamen: si no, cambiar uno deja el '
                              'otro con la regla vieja y el botón aparece pero no '
                              'deja pasar.' % (arch, const, usos))


def r_join_sql():
    """`FROM a, b LEFT JOIN c` asocia el JOIN a `b`, no a `a`.

    Cometido DOS VECES en dos días (18 y 19-ago-2026), en
    `supabase_venta_exhibicion.sql` y en `supabase_accesorios_reporte.sql`. La
    coma y el JOIN mezclados leen bien pero significan otra cosa: Postgres
    responde «invalid reference to FROM-clause entry for table a».

    Al menos este falla ruidosamente al pegar. Se vigila igual porque cuesta un
    viaje de ida y vuelta cada vez, y el arreglo siempre es el mismo: CROSS
    JOIN explícito, después del JOIN."""
    for p in sorted(glob.glob(os.path.join(BASE, '*.sql'))):
        s = leer(os.path.basename(p))
        if s is None: continue
        sin_com = re.sub(r'/\*[\s\S]*?\*/', '', s)
        sin_com = re.sub(r'(?m)^\s*--.*$', '', sin_com)
        # `FROM tabla alias, …` y nada más. Sin acotarlo así, el `from` de
        # `extract(year from …)` se toma por una cláusula FROM y la regla salta
        # sobre SQL correcto — que es como se acaba ignorando una regla.
        for m in re.finditer(r'(?i)\bFROM\s+(?:public\.)?\w+\s+\w+\s*,[^;\n]*', sin_com):
            cola = sin_com[m.end():m.end() + 400]
            corte = re.search(r'(?i)\b(WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|\)\s*$)', cola)
            if corte: cola = cola[:corte.start()]
            if re.search(r'(?i)\b(LEFT|RIGHT|INNER|FULL)?\s*JOIN\b', cola):
                falla('join', '%s: «%s…» mezcla coma y JOIN. El JOIN se asocia a la '
                              'ÚLTIMA tabla de la coma, no a la primera. Usa CROSS JOIN '
                              'explícito y ponlo DESPUÉS del JOIN.'
                              % (os.path.basename(p), m.group(0).strip()[:60]))
                break


def r_contrato_sql():
    """Aviso: si cambia lo que DEVUELVE una función SQL, mirar quién la consume.

    17-ago-2026: `exh_vendida` pasó a traer el excedente ya descontado. El campo
    seguía llegando perfecto y el tablero seguía restándolo por su cuenta, así
    que la resta se anulaba y el aparador marcaba una pieza ya vendida. No dio
    ningún error: dio un número.

    Es el reverso de la regla de migrar lecturas —allí faltaba un campo, aquí
    sobraba una cuenta— y las dos veces el dato se ve bien.

    Esto NO se puede bloquear: hace falta criterio para saber si el consumidor
    necesita cambiar. Solo pone la pregunta delante en el momento en que se está
    tocando, que es cuando sale barata."""
    cambiados = git_cambiados(staged='--staged' in sys.argv)
    sqls = [c for c in cambiados if c.endswith('.sql')]
    if not sqls: return
    htmls = ['tablero.html', 'captura_series.html', 'admin.html',
             'comisiones.html']
    for sql in sqls:
        s = leer(sql)
        if s is None: continue
        for m in re.finditer(r'FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s*\n?\s*RETURNS\s+TABLE\s*\(([^;]*?)\)\s*\n\s*LANGUAGE',
                             s, re.I):
            fn, cuerpo = m.group(1), m.group(2)
            campos = re.findall(r'(?m)^\s*(\w+)\s+\w', cuerpo)
            quien = [h for h in htmls if (leer(h) or '').find(fn) >= 0]
            if quien and campos:
                aviso('contrato', '%s cambia lo que devuelve %s (%s). Lo leen: %s. '
                                  'Comprueba que devuelve los MISMOS campos Y que '
                                  'significan lo mismo — un campo que cambia de '
                                  'sentido no da error, da un número falso.'
                                  % (sql, fn, ', '.join(campos[:6]), ', '.join(quien)))


def r_preventa_stock():
    """La lectura del inventario y el corte tienen que contar las ventas con el
    MISMO filtro. Si se separan no da error: da stock inventado.

    `inventario_vivo` calcula `vendido = total - corte`. Las entregas de
    preventa se excluyen porque el POS ya descontó esas piezas al cobrar el
    apartado. Pero el corte se DESPEJA de ese mismo total, así que si uno
    excluye y el otro no, cada entrega resta una venta normal del conteo y el
    tablero enseña piezas que no están."""
    FILTRO = 'a.venta_id = v.id'
    archivos = {
        'supabase_inventario_preventa.sql': 3,   # inventario_vivo + los 2 de cargar_cortes
        'supabase_carga.sql': 2,                 # los 2 de cargar_cortes
    }
    for nombre, esperados in archivos.items():
        sql = leer(nombre)
        if sql is None: continue
        n = sql.count(FILTRO)
        if n != esperados:
            falla('preventa-stock',
                  '%s tiene %d filtros de entrega de preventa y deberían ser %d. '
                  'inventario_vivo y cargar_cortes tienen que excluir lo MISMO, o el '
                  'tablero enseña stock que no existe.' % (nombre, n, esperados))


def versionados():
    """Los archivos que git conoce en esta carpeta.

    24-ago-2026: `r_cadenas` mira TODOS los .sql del directorio para saber que
    devuelve `login_asesor`. Un respaldo suelto —`_b.sql`, «copia de
    supabase_hoja_auth.sql»— aporta sus campos como si fuera el bueno, y la
    regla da por entregado algo que el archivo de verdad ya no devuelve.

    Se descubrio porque el respaldo lo dejaba la propia prueba de la regla: al
    quitarle un campo al login, seguia diciendo que todo estaba bien. Un archivo
    que nadie va a pegar en el servidor no puede contar como si lo fuera."""
    try:
        r = subprocess.run(['git', 'ls-files'], cwd=BASE, capture_output=True,
                           timeout=20, encoding='utf-8', errors='replace')
        if r.returncode != 0: return None      # sin git: no se filtra nada
        return set(x.strip() for x in (r.stdout or '').split('\n') if x.strip())
    except (OSError, subprocess.SubprocessError):
        return None


def por_publicar():
    """Lo versionado MAS lo que esta a punto de serlo.

    15-sep-2026: el concurso llego con seis archivos nuevos. El escaneo de
    privacidad solo miraba `versionados()` —lo que git YA rastrea— asi que los
    seis pasaron limpios sin haberse mirado, y uno traia el numero de empleado
    real de un asesor en el texto de prueba. El aviso habria llegado al commit
    siguiente, es decir, despues de publicarlo.

    `versionados()` no se amplia porque otras reglas dependen de que deje fuera
    los respaldos sueltos. Aqui hace falta lo contrario: un archivo sin `git
    add` es exactamente el que nadie ha revisado todavia."""
    base = versionados()
    if base is None: return None
    try:
        r = subprocess.run(['git', 'ls-files', '--others', '--exclude-standard'],
                           cwd=BASE, capture_output=True, timeout=20,
                           encoding='utf-8', errors='replace')
        if r.returncode == 0:
            base = base | set(x.strip() for x in (r.stdout or '').splitlines() if x.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    return base


def git_cambiados(staged):
    cmd = ['git', 'diff', '--name-only'] + (['--cached'] if staged else ['HEAD'])
    try:
        r = subprocess.run(cmd, cwd=BASE, capture_output=True, text=True, timeout=20)
        return [os.path.basename(x) for x in r.stdout.split('\n') if x.strip()]
    except (OSError, subprocess.SubprocessError):
        return []


def r_git():
    """Cinco reglas le preguntan a git. Sin git, las cinco callan y esto dice
    «Todo en orden» sin haber corrido ninguna.

    28-ago-2026: pasó de verdad. Se tocó `admin.html` en una máquina sin git en
    el PATH; `git_cambiados` devolvió [] por su `except OSError`, `r_version` se
    salió por el `if not cambiados: return` y el verificador dio el visto bueno
    sin comprobar VERSION — que era exactamente lo que faltaba subir. Con ella
    callaron `r_contrato_sql`, `r_returns_table_drop` y `r_funcion_repetida`, y
    `git_publicados` dejó de filtrar los .sql que no están en el repo.

    Es el mismo fallo que este archivo ya describe dos veces con otra causa:
    «una regla que calla por no saber leer el archivo es peor que no tenerla,
    porque además da permiso». Aquí no sabe leer el repo.

    FALLA y no avisa. Un aviso al final de una lista de «ok» verdes no para a
    nadie, y lo que está en juego es subir sin VERSION: la página queda al día y
    los celulares del equipo se quedan con la copia vieja, sin error y sin
    aviso. Eso ya costó horas el 1-ago-2026."""
    try:
        r = subprocess.run(['git', 'rev-parse', '--git-dir'], cwd=BASE,
                           capture_output=True, timeout=20,
                           encoding='utf-8', errors='replace')
    except (OSError, subprocess.SubprocessError) as e:
        falla('git', 'no se pudo ejecutar git (%s). Lo consultan la VERSION del '
                     'service worker, el contrato SQL, el DROP del RETURNS TABLE '
                     'y las funciones repetidas: sin él se saltan todas en '
                     'silencio.' % (str(e)[:70] or 'no está en el PATH'))
        return
    if r.returncode != 0:
        falla('git', 'git no reconoce esto como repositorio (%s). Las reglas que '
                     'comparan contra el último commit no pueden correr, y sin '
                     'este aviso se saltarían sin decir nada.'
              % ((r.stderr or '').strip().replace('\n', ' ')[:70] or 'sin detalle'))


# ── 4 · Datos personales ────────────────────────────────────
# 1-ago-2026: el repo es público y traía nombres completos, números de empleado
# y —en comisiones_datos.js— venta individual y monto de comisión de cada quien.
PRIVADO = os.path.join('_privado', 'datos_equipo.txt')
# Vive al lado de la lista y tampoco se versiona. Trae el `nombre_reporte` de
# cada quien —«APELLIDOS NOMBRE»—, así que de ahí salen los nombres de pila sin
# que nadie los escriba a mano. Ver `_pilas_deducidas`.
MAPEO = 'mapeo_nombres.sql'
# Trozos de apellido compuesto que el mapeo trae sueltos. No son el nombre de
# nadie, y buscarlos encendería todos los archivos. Esta lista NO crece con el
# equipo: es castellano, no personas.
_PARTICULAS = frozenset(
    'de del la las los y san santa santos mac von van der da dos e i'.split())
# 15-sep-2026: esto era una lista BLANCA de once extensiones. Cada fuga por
# extensión ha sido la misma frase: «es que .csv no estaba en la lista». Y las
# que faltaban no eran raras —`.csv` es como sale el equipo del sistema, `.ps1`
# es como se publica, `.svg` lleva texto dentro—. Ahora se mira TODO menos lo
# que no se puede leer como texto, que es una lista corta y que no crece sola.
BINARIO = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip',
           '.xlsx', '.xlsm', '.xls', '.docx', '.woff', '.woff2', '.ttf',
           '.otf', '.mp4', '.mp3', '.exe', '.dll')


def _sin_acentos(s):
    import unicodedata
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn').lower()


def _espacios(s):
    """Todo el texto en una línea, con espacios sencillos.

    Un apellido no deja de serlo porque el HTML lo parta en dos líneas o porque
    un pegado le meta dos espacios. Comparar contra el texto tal cual escrito es
    comparar contra la maquetación."""
    return re.sub(r'\s+', ' ', s)


def _duenno():
    """Los trozos del nombre de quien firma los commits.

    Su propio nombre no es una fuga: es suyo, y es él quien decide publicarlo.
    Sin esto, la deducción de abajo lo metería en la lista y el repo fallaría por
    llevar la firma de su propio dueño."""
    trozos = set()
    for clave in ('user.email', 'user.name'):
        try:
            r = subprocess.run(['git', 'config', '--get', clave], cwd=BASE,
                               capture_output=True, text=True, timeout=10)
        except Exception:
            continue
        if r.returncode == 0 and (r.stdout or '').strip():
            trozos.add(_sin_acentos(r.stdout.strip().split('@')[0]))
    return trozos


def _pilas_deducidas(apellidos, sueltos):
    """Los nombres de pila, SIN que nadie los teclee.

    15-sep-2026. La tercera columna de `datos_equipo.txt` pedía escribir a mano
    el nombre de pila de cada quien. Eso no lo hace nadie dos veces: en la 1217
    son seis personas, pero en `tablero-odemas` cada gerente tendría que venir a
    anotar aquí a cada asesor que da de alta desde la app. Una lista que se
    mantiene a mano se queda vieja el primer día, y una lista vieja es peor que
    ninguna porque aparenta estar cubriendo.

    No hace falta teclearlos: `_privado/mapeo_nombres.sql` ya trae el
    `nombre_reporte` de cada persona, que es «APELLIDOS NOMBRE». Quitándole los
    apellidos —que ya están en la lista— lo que queda es el nombre de pila. Y
    ese archivo no se queda viejo por su cuenta: es el que cuadra las comisiones
    contra el Excel regional, así que si le falta alguien se nota en el sueldo
    de esa persona mucho antes que aquí.

    Se dejan fuera tres cosas: lo que no sea todo letras —en ese SQL el número
    de empleado va entre comillas igual que el nombre, y colarlo aquí haría que
    esta función dijera «nombre» donde hay un número—, los trozos del nombre del
    dueño del repo, y las partículas de los apellidos compuestos («de», «del»,
    «la»), que no son el nombre de nadie y encenderían todos los archivos.

    El mínimo son TRES letras, y ese número está medido, no supuesto. Estuvo en
    cuatro por miedo a que un nombre corto casara con palabra corriente. Se
    midieron diez nombres de pila de tres letras sobre los tres repos —179
    archivos—: nueve dan cero, y el único que enciende algo es «luz», que sale
    en los avisos de la cámara («con buena luz»). Mientras tanto, a cuatro
    letras —que ya se aceptaban— «rosa» enciende 5 archivos y 2 en odemas, por
    el color. O sea que **el ruido no viene del largo del nombre, sino de que el
    nombre sea además una palabra corriente**, y eso pasa igual con cuatro
    letras que con tres.

    El día que entre alguien llamado como una palabra corriente, esta lista lo
    va a traer igual —y eso está bien: el que decide si es una fuga ya no es el
    largo de la palabra ni una lista de excepciones, es lo que tenga al lado.
    Ver `_con_senal`, que es donde se cerró ese hueco el 17-sep-2026."""
    s = leer(os.path.join(os.path.dirname(PRIVADO), MAPEO))
    if s is None: return []
    s = '\n'.join(l for l in s.split('\n') if not l.strip().startswith('--'))
    mio, fuera, pilas = _duenno(), set(sueltos), set()
    for cadena in re.findall(r"'([^']{6,60})'", s):
        for w in _sin_acentos(cadena).split():
            if len(w) < 3 or not w.isalpha() or w in fuera: continue
            if w in _PARTICULAS: continue
            if any(w in a.split() for a in apellidos): continue
            if any(w in trozo for trozo in mio): continue
            pilas.add(w)
    return sorted(pilas)


def _datos_equipo():
    """Los apellidos y números reales, de un archivo que NO se versiona.

    28-ago-2026: antes estaban escritos DENTRO de esta función, o sea que el
    archivo encargado de vigilar la fuga era parte de la fuga.

    Devuelve None si no se puede leer, y entonces `r_personales` falla: no saber
    qué buscar no es lo mismo que no encontrar nada."""
    s = leer(PRIVADO)
    if s is None: return None
    apellidos, sueltos, numeros, pilas, salvo = [], [], [], [], set()
    # Cuáles de `sueltos` son nombre de PILA. No cambia qué se busca: cambia qué
    # hace falta para darlo por fuga. Ver `r_personales`.
    de_pila = set()
    for linea in s.split('\n'):
        linea = linea.split('#')[0].strip()
        if not linea: continue
        if linea.startswith('!'):            # palabra comun que ademas es apellido
            salvo.add(_sin_acentos(linea[1:].strip()))
            continue
        partes = [x.strip() for x in linea.split('|')]
        if len(partes) > 2 and partes[2]:
            # Tercera columna: los nombres de pila. Un ticket del POS imprime
            # «APELLIDOS, NOMBRE», y de ahí se copian los dos. Vigilar solo los
            # apellidos deja publicable la mitad de cada persona.
            for pila in _espacios(_sin_acentos(partes[2])).split():
                if len(pila) >= 4: sueltos.append(pila); de_pila.add(pila)
            pilas.append(partes[2])
        if partes[0]:
            entero = _espacios(_sin_acentos(partes[0]))
            apellidos.append(entero)
            # 15-sep-2026: SOLO se buscaba el apellido compuesto entero. MAPA.md
            # llevaba meses publicando el primero a secas, como ejemplo de una
            # explicacion, y la regla lo leia sin verlo: «X Y» no esta dentro de
            # un archivo que escribe «X».
            for palabra in entero.split():
                if len(palabra) >= 4: sueltos.append(palabra)
        if len(partes) > 1 and partes[1]: numeros.append(partes[1])
    # La tercera columna viene vacía, y va a venir vacía siempre: es trabajo a
    # mano y no escala a las demás tiendas. Los nombres de pila se deducen.
    deducidas = _pilas_deducidas(apellidos, sueltos)
    sueltos.extend(deducidas)
    pilas.extend(deducidas)
    de_pila.update(deducidas)
    sueltos = sorted(set(w for w in sueltos if w not in salvo))
    # Un apellido que además es nombre de pila de otro —pasa a menudo— se
    # queda del lado fuerte: el apellido identifica solo.
    de_pila = frozenset(w for w in de_pila
                        if w in sueltos
                        and not any(w in a.split() for a in apellidos))
    return ((apellidos, sueltos, numeros, pilas, de_pila)
            if (apellidos or sueltos or numeros) else None)


# Cuánto texto alrededor cuenta como «al lado». No es el renglón de verdad:
# `_espacios` ya juntó el archivo en una sola línea —eso es lo que caza el
# apellido partido por un salto—, así que se mide en caracteres. 80 es una línea
# de código larga; con 200 empezaba a alcanzar el comentario del bloque de
# arriba, que habla de otra cosa.
_VENTANA = 80


def _con_senal(plano, m, fuertes, apellidos):
    """¿Algo junto a este nombre de pila dice que ahí hay una persona?

    17-sep-2026. El hueco que quedó abierto el 15: un nombre de pila que además
    es palabra corriente hacía fallar archivos sin
    ninguna fuga. La salida que existía era escribir `!palabra` en
    `datos_equipo.txt`, y no sirve: ese archivo vive en la 1217 y **los demás
    gerentes no salen de la app**. Un arreglo que pide entrar al repo a mano no
    se hace nunca, y mientras tanto la regla grita donde no hay nada —que es
    como se deja de leer una regla—.

    Así que la diferencia no la marca la palabra, la marca la compañía. Un
    APELLIDO identifica a alguien él solo y sigue cayendo solo. Un nombre de
    pila, no: «rosa» es un color y «luz» es lo que pide la cámara. Lo que
    convierte un nombre de pila en una persona es lo que tiene al lado — un
    puesto, una etiqueta de las que anteceden a una persona, un número de
    empleado, o un apellido del equipo—. Eso es esto.

    No hay lista de palabras corrientes que mantener, y por tanto no hay lista
    que se quede vieja: el vocabulario que se consulta es el que ya usan las dos
    reglas de la sección 4-bis, y ése no crece con el equipo.

    Lo que se paga, dicho claro: un nombre de pila SOLO, sin nada alrededor, ya
    no falla. Se midió antes de aceptarlo (ver MAPA.md): de veinte cebos armados
    desde `_privado/`, se pierden tres, y los tres son el mismo caso —el nombre
    a secas, sin nada que lleve a nadie—. Una fuga de verdad llega con su
    compañía, porque sale de un sistema que imprime el renglón entero: el POS,
    el concentrado, el Excel regional.

    Y una señal MÁS que se probó y se tiró: «otro nombre de pila del equipo al
    lado», que recuperaba uno de esos tres cebos. Encendía MAPA.md y este mismo
    archivo, porque los dos explican el problema enumerando nombres corrientes
    uno detrás de otro. Un archivo que EXPLICA la regla no puede dispararla —y
    acortar la distancia hasta que dejaran de tocarse era ajustar el número
    hasta que la medición saliera bien, que es medir al revés—. Por un cebo que
    además no identifica a nadie, no vale."""
    v = plano[max(0, m.start() - _VENTANA):m.end() + _VENTANA]
    # Un nombre INVENTADO de los que el repo usa a propósito no vuelve persona a
    # nadie: para eso existe `NOMBRES_EJEMPLO`. Sin esto, el día que entre al
    # equipo alguien que se llame como el asesor de mentira de las pruebas, los
    # seis archivos de prueba se encienden a la vez —y no llevan a nadie real—.
    quien = m.group(0)
    for ej in NOMBRES_EJEMPLO:
        if quien in ej.split() and ej in v: return False
    if _SENAL_PILA.search(v): return True
    for a in apellidos:
        if a in v: return True
    for w in fuertes:
        if re.search(r'(?<![\wáéíóúñ])%s(?![\wáéíóúñ])' % re.escape(w), v):
            return True
    return False


def r_personales():
    """Que no salgan del repo los nombres ni los números del equipo.

    1-ago-2026: el repo es público y traía nombres completos, números de empleado
    y —en comisiones_datos.js— venta individual y monto de comisión de cada quien.

    28-ago-2026: se descubrió que seguían ahí, en 14 archivos, porque la regla
    solo miraba `HTML + SUELTOS + datos.js`. No revisaba los `.sql` —donde estaba
    el mapeo entero con los cinco nombres y sus números—, ni `MAPA.md`, ni
    `pruebas/`. Ahora mira TODO lo que devuelve `versionados()`, que es la lista
    de lo que git publica de verdad y no una escrita a mano que se queda corta.

    ⚠️ Y el único nombre que sí estaba en un archivo vigilado —`tablero.html`— se
    le escapó igual: el patrón traía la grafía buena del apellido y el archivo
    llevaba la mala, con una letra de más. La misma letra que descuadró las
    comisiones de agosto. Por eso `_privado/datos_equipo.txt` pide escribir
    también las grafías malas que circulan.

    15-sep-2026: se auditó a propósito, con dieciocho cebos, en vez de esperar a
    la siguiente fuga. Pasaban doce. Las tres familias eran las mismas de
    siempre, y ninguna era un caso raro:

      · se buscaba el apellido compuesto ENTERO, así que el primero a secas
        pasaba — y `MAPA.md` llevaba meses publicando uno, de ejemplo;
      · se comparaba contra el texto tal cual, así que el mismo apellido partido
        por un salto de línea o con dos espacios no casaba con nada;
      · se miraba una lista BLANCA de once extensiones, así que `.csv` —como
        sale el equipo del sistema—, `.ps1` y `.svg` no se miraban.

    Los tres arreglos van en la misma dirección: comparar contra el CONTENIDO y
    no contra cómo esté escrito, y mirar todo salvo lo ilegible. La lista blanca
    se invirtió (`BINARIO`) porque cada fuga por extensión acabó en la misma
    frase: «es que no estaba en la lista».

    El apellido suelto se busca con frontera de palabra y no como trozo: como
    trozo se encendía en veintidós archivos corrientes, y una regla que grita
    donde no hay nada deja de leerse, que es otra forma de no tenerla.

    17-sep-2026: y por eso mismo, lo que se busca ya no pesa todo igual. El
    apellido identifica solo; el nombre de pila necesita compañía, porque
    también es un color o lo que pide la cámara. Ver `_con_senal`.

    (Y esta explicación no puede nombrarlas: este archivo se audita a sí mismo,
    que es precisamente lo que hizo falta para llegar hasta aquí.)"""
    datos = _datos_equipo()
    if datos is None:
        # 19-sep-2026: en GitHub Actions este archivo no existe NI PUEDE existir
        # —vive en `_privado/`, que es exactamente lo que no se publica—, así que
        # «Verificar tablero» llevaba en rojo desde que se creó, en todos los
        # push. Un rojo permanente no avisa de nada: es el mismo «nadie lee el
        # rojo» que ya se pagó el 4-ago con el working-directory, y es lo que
        # dejó pasar un archivo con las ventas de la tienda al repo público.
        #
        # Allí es aviso, no falla, y se dice qué se deja de comprobar. Lo que sí
        # corre en CI es `r_nombres_forma`, que no necesita la lista: caza la
        # FORMA de un nombre y es la única que ve el concentrado de otra tienda.
        # En la máquina donde se trabaja sigue siendo FALLA — ahí el archivo
        # tiene que estar, y no saber contra qué comparar es no comprobar nada.
        if os.environ.get('GITHUB_ACTIONS') == 'true':
            aviso('datos', 'aquí no está %s y no puede estar: vive en _privado/. '
                           'Lo que NO se comprueba en este job es el cotejo contra '
                           'los nombres y números reales; eso se comprueba antes de '
                           'cada commit, en la máquina del gerente. Lo que sí corre '
                           'aquí es la regla de la FORMA de un nombre.' % PRIVADO)
            return
        falla('datos', 'no se pudo leer %s, así que no hay contra qué comparar. '
                       'Créalo (ver MAPA.md) o esta regla no comprueba nada — y '
                       'callar aquí es dar permiso para publicar los nombres.'
              % PRIVADO)
        return
    apellidos, sueltos, numeros, pilas, de_pila = datos
    # Los que identifican solos: el apellido entero y el apellido suelto.
    fuertes = [w for w in sueltos if w not in de_pila]
    if not pilas:
        # Aviso y no falla: que falten no es una fuga, es media regla. Pero
        # callarlo sí lo sería — el POS imprime «APELLIDOS, NOMBRE» y el nombre
        # de pila se copia igual de fácil que el apellido.
        #
        # Esto ya no pide teclear nada: los nombres de pila salen solos del
        # mapeo (ver `_pilas_deducidas`). Si este aviso aparece, es que tampoco
        # está el mapeo, y entonces sí no hay de dónde sacarlos.
        aviso('datos', 'no hay nombres de pila contra qué comparar: %s no trae '
                       'tercera columna y falta %s, de donde se deducen solos. '
                       'Sin ellos, un archivo que escriba solo el nombre de '
                       'alguien pasa limpio.'
              % (PRIVADO, os.path.join(os.path.dirname(PRIVADO), MAPEO)))

    publicados = por_publicar()
    if publicados is None:
        # Sin git ya falla `r_git()`. Aquí se cae a lo que se pueda enumerar,
        # para no dejar de mirar del todo.
        publicados = [os.path.relpath(r, BASE).replace('\\', '/')
                      for r in glob.glob(os.path.join(BASE, '**', '*'), recursive=True)
                      if os.path.isfile(r)]

    for p in sorted(publicados):
        if p.endswith('/') or p.lower().endswith(BINARIO): continue
        if p.replace('\\', '/').startswith('_privado/'): continue
        # verificar.py NO se excluye: ya no lleva los apellidos dentro, así que
        # se audita como cualquier otro. Excluirlo dejaría abierta justo la
        # puerta por la que entraron la primera vez.
        s = leer(p)
        if s is None: continue
        plano = _espacios(_sin_acentos(s))
        # `_espacios` junta el texto en una sola línea con espacios sencillos.
        # Sin eso, un apellido partido por el salto de línea de un `+` de JS, o
        # con dos espacios de un pegado, no casa con nada — y se publica.
        hallado = None
        for a in apellidos:
            if a in plano: hallado = a; break
        if not hallado:
            for w in sueltos:
                # Con frontera de palabra, NO como trozo: buscar el primer
                # apellido suelto como subcadena lo enciende dentro de palabras
                # corrientes, y una regla que grita en veinte archivos deja de
                # leerse — que es otra manera de no tenerla.
                for m in re.finditer(
                        r'(?<![\wáéíóúñ])%s(?![\wáéíóúñ])' % re.escape(w), plano):
                    # El apellido cae solo. El nombre de pila necesita que algo
                    # cerca diga que ahí hay una persona: ver `_con_senal`.
                    if w in de_pila and not _con_senal(plano, m, fuertes, apellidos):
                        continue
                    hallado = w; break
                if hallado: break
        if hallado:
            # «un nombre», no «un apellido»: desde el 15-sep-2026 la lista lleva
            # también los nombres de pila, deducidos del mapeo. Decir «apellido»
            # mandaba a buscar lo que no era.
            falla('datos', '%s trae un nombre del equipo ("%s"). Los datos '
                           'reales van en _privado/, no en el repo.'
                  % (p, hallado[:24]))
        for n in numeros:
            # Con separador opcional entre dígitos: el mismo número escrito
            # `900-001` o `900 001` es el mismo número de empleado, y la versión
            # con guion pasaba limpia.
            #
            # (Este comentario llevaba el número de verdad de un asesor, puesto
            # de ejemplo al escribir la regla. Lo cazó la propia regla, en el
            # primer commit. Por eso `verificar.py` se audita a sí mismo.)
            suelto = r'[-. ]?'.join(re.escape(c) for c in n)
            if re.search(r'(?<![#\w])%s(?!\d)' % suelto, s):
                falla('datos', '%s trae un número de empleado real. Usa un '
                               '<placeholder> o un número de ejemplo.' % p)
                break

    # La red de siempre, sobre las páginas de la app: pilla un número que todavía
    # no esté en la lista privada —alguien que acaba de entrar al equipo—.
    # El (?<![#\w]) es por los colores hex: horarios.html trae #777777 y #827717,
    # que sin eso se reportaban como números de empleado.
    for p in HTML + SUELTOS + ['datos.js']:
        s = leer(p)
        if s is None: continue
        hits = re.findall(r'(?<![#\w])\d{6}\b(?!\s*(?:pieza|pzas|MSI))', s)
        if hits:
            falla('datos', '%s parece traer un número de empleado (ej. "%s")'
                  % (p, str(hits[0])[:24]))


# ── 4-bis · Nombres de persona, sin saber de quién ──────────────────
# 15-sep-2026. `r_personales` compara contra una LISTA de personas, y esa lista
# hay que mantenerla a mano. En la 1217 son seis y no se mueven. En
# `tablero-odemas` no se puede: cada tienda tiene su gerente, y las altas de
# asesor las hace cada quien desde la app, no desde el repo. Nadie va a venir a
# anotar aquí a cada asesor que entre. La lista se queda vieja el primer día —y
# una lista vieja es peor que ninguna, porque aparenta estar cubriendo.
#
# Esta regla no pregunta QUIÉN es. Pregunta si algo tiene FORMA de nombre de
# persona. Lo único que se mantiene son los nombres de ejemplo —inventados, los
# mismos siempre— y ésos no crecen con el equipo. Coste por asesor dado de alta:
# cero. Sirve igual con una tienda que con cincuenta.
#
# Tres formas, y las tres se midieron sobre los tres repos antes de apretarlas,
# porque una regla que grita en cuarenta archivos corrientes deja de leerse:
#
#   1. Tres palabras Capitalizadas .......... 13 + 9 + 0 cadenas distintas.
#   2. Detrás de una etiqueta de persona .... 12 en total. La etiqueta `nombre`
#      a secas daba 347: arrastra producto («Mica HR») y código (`nombres.map`).
#   3. TRES MAYÚSCULAS —como sale del concentrado— sólo en un renglón que además
#      lleva un número de empleado ......... 9 + 8 + 0. Suelta daba 293 y hubo
#      que descartarla; con el número al lado no se parece a nada más, y es la
#      única que caza el concentrado de una tienda AJENA, que es justo lo que
#      `r_personales` no puede ver.

# Nombres inventados que sí pueden aparecer. Ninguno es de nadie.
NOMBRES_EJEMPLO = (
    'ana ramirez solis', 'luis ortega vidal', 'jesus ortega vidal',
    'elena navarro galvez', 'jorge medina rejon', 'maria fuentes bravo',
    'ana quiroga', 'luis bermudez', 'maria zepeda',
    # Las formas CORTAS de los de arriba: hacen falta para poder escribir
    # «asi se guarda» -> «asi esta en la ficha» sin usar a nadie real.
    'jorge medina', 'luis vidal', 'luis ortega',
    'perez ramirez', 'ramirez soto', 'lopez', 'perez', 'martinez',
    'tadeo', 'luis', 'maria', 'ana', 'elena',
)

# Casan el patrón y no son personas: encabezados del ticket, herramientas,
# producto, nombres de caso de prueba. Van en lista APARTE a propósito: decir
# «esto no es un nombre» no es lo mismo que decir «este nombre se puede
# publicar», y mezclarlas haría que mañana nadie sepa por qué está cada una.
NO_SON_NOMBRES = (
    'google apps script', 'con orange ocean', 'least one target',
    'tipo importe impuesto', 'tino importe impuesto', 'cantidad precio importe',
    'informe articulos totales', 'par por mao',
    'articulo cantidad precio',      # encabezado del ticket
    'master card nacional',          # forma de pago del ticket, no una persona
    'prueba uno', 'prueba dos', 'equipo', 'asesor', 'gerente', 'subgerente',
    'alguien que no vende', 'string', 'bundle', 'respuesta', 'otro', 'otra',
    # renglones con SKU: producto, no personas (patrón 3)
    'disco duro adata', 'prueba tel con', 'prueba tel sin', 'prueba se trae',
    'prueba solo pieza', 'prueba eol con', 'prueba eol agotado',
    'prueba sin precio', 'prueba promo sin',
    'prueba eol piso', 'prueba activo traido', 'prueba eol detenido',
    # nombres de producto ya traducidos a lenguaje de cliente (nombres.js):
    # escritos en Título, tres palabras parecen un nombre de pila y apellidos
    'huawei watch kids',
)

# Un nombre nunca lleva una de éstas. Sirven para separar un nombre de una
# frase: el ruido de las MAYÚSCULAS era casi todo encabezado de comentario en
# español («POR QUE ESTE», «HAY QUE COMPROBAR»).
_VACIAS = frozenset('''por que este esta esto con las los del en el la un una
unos unas mas ya hay se es son era ser ha han de a y o u ni pero sino como
cuando donde quien cual cada todo toda todos todas otro otra otros otras mismo
misma solo sola sobre entre hasta desde sin tras ante bajo muy mucho poco nada
algo alguien nadie siempre nunca tambien tampoco si no aun aunque porque pues
asi bien mal mejor peor antes despues luego hacer hace hecho puede pueden debe
deben tiene tienen va van ir dos tres cuatro cinco seis siete ocho nueve diez
mil ciento leer lee escribir subir bajar abrir cerrar poner quitar dar dejar
al lo le les su sus mi tu nuestro verdad mano nuevo nueva para'''.split())

_MAY = 'A-ZÁÉÍÓÚÑ'
_MIN = 'a-záéíóúñ'

# 1) Tres palabras Capitalizadas: «nombre y los dos apellidos», que es como se
#    escribe una persona en México y como sale del sistema.
_FORMA_NOMBRE = re.compile(
    r'\b[%s][%s]{2,}(?: [%s][%s]{2,}){2}\b' % (_MAY, _MIN, _MAY, _MIN))

# 2) Dos palabras no se pueden pedir: «Mica HR», «Office Personal» y media
#    tienda tienen esa forma. Y un nombre de pila suelto detrás de «atendido
#    por» —que fue la fuga de verdad, en un texto de prueba de OCR— tampoco se
#    caza por la forma: son dos palabras y una es la etiqueta. Se caza por la
#    ETIQUETA: lo que viene detrás de «atendido por» o de `nombre_reporte` es
#    una persona, tenga una palabra o cuatro.
#    Las palabras van en su propia constante porque las comparte `r_personales`
#    (sección 4) como segunda señal: lo que aquí dice «detrás de esto viene una
#    persona» dice allá «esto de aquí al lado es una persona». Una sola lista;
#    dos copias del mismo vocabulario y la que se queda corta es la que nadie
#    mira, que es la lección del 15-sep-2026.
_PALABRAS_ETIQUETA = (r'atendido\s+por|vendedor|asesor|nombre_reporte|'
                      r'nombre_completo|nombre_asesor|vendedor_nombre')
_ETIQUETA = re.compile(
    r'(?i:\b(?:%s)\b)\s*[:=]?\s*[\'"]?'
    # La ETIQUETA se busca sin distinguir mayusculas —«Vendedor:» con V se
    # colaba entera—, pero lo que sigue tiene que empezar en MAYUSCULA.
    # Aceptando minuscula se cazaba tambien «atendido por fernando», y
    # costaba 21 fallas falsas: `nombre_reporte text NOT NULL` se leia
    # como una persona en cada .sql del repo. Un nombre en minuscula
    # detras de la etiqueta es prosa; escrito de verdad, viene en alta.
    r'([%s][%s%s. ]{2,40})' % (_PALABRAS_ETIQUETA, _MAY, _MAY, _MIN))

# La inicial con punto cuenta como palabra: el vendedor escrito con inicial y
# apellido se le escapaba por empezar con algo de dos caracteres.
_PARECE_NOMBRE = re.compile(
    r'^(?:[%s]\.|[%s][%s]+|[%s]{3,}|[%s]{3,})'
    r'(?: (?:[%s]\.|[%s][%s]+|[%s]{2,}|[%s]{2,})){0,3}\.?$'
    % (_MAY, _MAY, _MIN, _MAY, _MIN, _MAY, _MAY, _MIN, _MAY, _MIN))

# 3) La fila del concentrado: APELLIDO APELLIDO NOMBRE, en el mismo renglón que
#    el número de empleado.
_TRES_MAY = re.compile(
    r'(?<![%s])[%s]{3,}(?: [%s]{2,}){2}(?![%s])' % (_MAY, _MAY, _MAY, _MAY))
# Un numero de empleado de seis digitos no se parece a nada mas en estos
# repos. Uno de CINCO si: es exactamente la forma de un SKU, y el catalogo
# de accesorios trae trece productos con nombre de tres palabras en alta
# —MEMORIA USB ADATA, DISCO DURO TOSHIBA—. Pedir cinco digitos encendia el
# catalogo entero, y ese catalogo CRECE: seria otra lista que mantener, que
# es justo lo que esta regla existe para no tener. Asi que el de cinco solo
# cuenta si el renglon ademas habla de una persona.
_EMPNO = re.compile(r'(?<!\d)\d{6}(?!\d)')
_EMPNO_CORTO = re.compile(r'(?<!\d)\d{4,7}(?!\d)')
_PALABRAS_PUESTO = (r'asesor|asesora|gerente|subgerente|empleado|empleada|'
                    r'vendedor|vendedora|nomina|n[o\u00f3]mina|colaborador')
# `puesto` va aparte porque `_SENAL_PILA` no lo quiere suelto. Ver ah\u00ed.
_ES_DE_PERSONA = re.compile(r'(?i)\b(?:%s|puesto)\b' % _PALABRAS_PUESTO)

# La segunda se\u00f1al que pide `r_personales` (secci\u00f3n 4) para dar por fuga un
# NOMBRE DE PILA: el vocabulario de las dos reglas de arriba, reunido.
#
# Dos cosas se cayeron al medirlo, y las dos por lo mismo \u2014lo que no estorba
# dentro de un rengl\u00f3n del concentrado s\u00ed estorba suelto en un archivo\u2014:
#
#   \u00b7 el N\u00daMERO DE EMPLEADO. Seis d\u00edgitos no se parecen a nada en un rengl\u00f3n de
#     TRES MAY\u00daSCULAS (patr\u00f3n 3), pero a 80 caracteres de distancia s\u00ed: el SKU
#     `304271` de `tablero.html` ca\u00eda a un palmo de la palabra \u00abrosa\u00bb del
#     cat\u00e1logo y la convert\u00eda en persona. Los n\u00fameros de empleado de verdad ya
#     los caza `r_personales` por su cuenta, uno por uno.
#   \u00b7 \u00abPUESTO\u00bb a secas, que en espa\u00f1ol es tambi\u00e9n el participio de poner: \u00abel
#     c\u00f3digo estaba puesto en admin\u00bb hac\u00eda persona a quien pasara cerca. Con
#     dos puntos o igual detr\u00e1s es el campo, y \u00e9se s\u00ed cuenta \u2014y adem\u00e1s el campo
#     siempre trae al lado el valor, que ya es \u00abasesor\u00bb o \u00abgerente\u00bb\u2014.
_SENAL_PILA = re.compile(r'(?i)\b(?:%s|%s)\b|\bpuesto\s*[:=]'
                         % (_PALABRAS_PUESTO, _PALABRAS_ETIQUETA))


def r_nombres_forma():
    """Que no se publique NADA con forma de nombre de persona.

    `r_personales` necesita saber a quién buscar; ésta no, y por eso es la única
    que sirve donde el equipo lo da de alta otro y cambia sin avisar.

    Se auditó con veinte cebos armados desde `_privado/` —nunca tecleando un
    nombre, y corriendo esta función, no una copia de su lógica—. En la primera
    pasada se le iban ocho. Tres eran arreglables y están cerrados:

      · la etiqueta sólo casaba en minúscula, así que «Vendedor: …» con V
        mayúscula pasaba entero;
      · la inicial con punto —«A. APELLIDO»— no contaba como palabra;
      · el número de empleado se pedía de seis dígitos, y los reales son de
        CINCO y de seis. La fila del concentrado pasaba por un dígito.

    Los cuatro que quedan abiertos están aquí para que no se vuelvan a
    descubrir, y ninguno se cierra sin pagarlo:

      · apellido SUELTO de alguien de otra tienda. Una palabra capitalizada no
        se distingue de ninguna otra palabra. `r_personales` lo cubre para la
        gente de la 1217 y nada puede cubrirlo para el resto.
      · DOS apellidos en MAYÚSCULAS sin número al lado. El patrón suelto da 293
        cadenas en este repo, y aun quitando SQL y palabras vacías se queda en
        44: catálogo de accesorios y basura del OCR. Se pide el número al lado
        porque una fila del concentrado siempre lo trae —para eso es una fila
        del concentrado— y así baja a 9 y 8.
      · «APELLIDOS, Nombre», que es como lo imprime el POS: 35 y 18 cadenas, casi
        todas `KEY, JSON` de desestructurar en JS. No se puede usar como falla.
      · el valor lejos de su columna: en `insert ... (nombre_reporte) values
        (...)` el nombre queda a media línea de la etiqueta y no se alcanza.
      · un nombre en minúscula detrás de la etiqueta.
      · un nombre partido por un salto de línea. Se mira renglón por renglón a
        propósito: juntando líneas, dos celdas de una tabla se leen como un
        nombre que nadie escribió, y eso encendía siete archivos corrientes.

    FALLA en vez de avisar. Un nombre de persona en un repo público no es un
    matiz, y el mensaje dice qué cadena y en qué archivo: eso se arregla en un
    minuto, que es lo que hace que una regla se respete en vez de esquivarse."""
    publicados = por_publicar()
    if publicados is None: return
    permitido = set(NOMBRES_EJEMPLO) | set(NO_SON_NOMBRES)

    def _limpio(t):
        """Normalizado para comparar, o None si no puede ser un nombre."""
        t = t.strip(' .')
        if not t: return None
        clave = _sin_acentos(t)
        if clave in permitido: return None
        if any(w in _VACIAS for w in clave.split()): return None
        return clave

    for p in sorted(publicados):
        if p.lower().endswith(BINARIO): continue
        if p.replace(os.sep, '/').startswith('_privado/'): continue
        s = leer(p)
        if s is None: continue

        vistos = set()

        def _grita(texto, molde):
            clave = _limpio(texto)
            if clave is None or clave in vistos: return
            vistos.add(clave)
            falla('nombres', molde % (p, texto.strip(' .')[:44]))

        # OJO: aquí NO se juntan las líneas. `_espacios` sirve para un apellido
        # partido por un salto, pero aplicado a la FORMA inventa nombres que no
        # existen: dos celdas de una tabla en renglones distintos se leen como
        # un nombre que nadie escribió. Una persona se escribe en un renglón.
        # Sólo se aplastan los espacios horizontales.
        for linea in s.splitlines():
            linea = re.sub(r'[ \t]+', ' ', linea)

            for m in _FORMA_NOMBRE.findall(linea):
                _grita(m, '%s trae «%s», que tiene forma de nombre de persona. '
                          'Si es de alguien real, va en _privado/. Si es un '
                          'ejemplo, usa uno de NOMBRES_EJEMPLO en verificar.py, '
                          'o añade ahí el tuyo.')

            for m in _ETIQUETA.findall(linea):
                if not _PARECE_NOMBRE.match(m.strip(' .')): continue
                _grita(m, '%s dice «... %s»: eso es el nombre de quien vendió. '
                          'Ese campo lo llena el sistema con la persona de '
                          'verdad; en el repo sólo puede llevar un nombre de '
                          'NOMBRES_EJEMPLO.')

            if (_EMPNO.search(linea)
                    or (_EMPNO_CORTO.search(linea)
                        and _ES_DE_PERSONA.search(linea))):
                for m in _TRES_MAY.findall(linea):
                    _grita(m, '%s trae «%s» junto a un número de empleado: eso '
                              'es una fila del concentrado. Ese archivo no se '
                              'publica, va en _privado/.')


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
    for p in HTML + SUELTOS + ['sw.js', 'datos.js'] + GS:
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

    3-ago-2026: la regla tenía dos puntos ciegos y por eso decía "todo en orden"
    sin haber mirado de verdad.

      · Solo veía `catch(e){}` con las llaves en la MISMA línea. Uno escrito en
        varias líneas —que es como se escriben los que llevan algo dentro y
        luego se vacían— pasaba entero sin que nadie lo mirara.
      · Daba por justificado cualquier `//` en las cuatro líneas de arriba. Un
        `// ---- sección ----` que no habla del catch valía como explicación.
        Los 7 legítimos que dependen del comentario de arriba lo tienen en la
        línea inmediatamente anterior, así que estrecharlo a una no molesta a
        ninguno y cierra la puerta.
    """
    for p in HTML + SUELTOS:
        s = leer(p)
        if s is None: continue
        L = s.split('\n')
        sin_motivo = []
        for ini, fin in zonas_script(s):
            for m in re.finditer(r'catch\s*(?:\([^)]*\))?\s*\{', s[ini:fin]):
                abre = ini + m.end() - 1
                cuerpo, cierra = cierre_de_bloque(s, abre)
                # ¿queda algo si se le quitan los comentarios?
                vivo = re.sub(r'/\*.*?\*/', '',
                              re.sub(r'//[^\n]*', '', cuerpo), flags=re.S).strip()
                if vivo: continue                       # hace algo: no es un silencio
                if '//' in cuerpo or '/*' in cuerpo: continue   # explicado por dentro
                n = s[:abre].count('\n')                # 0-based, línea del ARCHIVO
                # explicación al lado: lo que sigue al } de cierre, misma línea
                al_lado = s[cierra + 1:].split('\n')[0]
                if '//' in al_lado: continue
                # o justo encima: la línea inmediatamente anterior, no cuatro
                if n > 0 and '//' in L[n - 1]: continue
                sin_motivo.append(n + 1)
        if sin_motivo:
            falla('silencio', '%s: catch vacío sin explicar en línea(s) %s. '
                              'Si callar es correcto, escribe por qué al lado o '
                              'en la línea de arriba; si no, que avise.'
                  % (p, ', '.join(map(str, sorted(sin_motivo)[:6]))))


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

    # 7a-bis · Lo que el cliente lee de la sesión, el login lo tiene que dar.
    # 2-ago-2026: index.html leía data.hoja_auth y login_asesor no lo devolvía.
    # Quedaba '' y `currentVend === DESCARGA_AUTORIZADA` era falso siempre, así
    # que el botón de las ventas del día estuvo oculto para todos —incluida
    # la única persona que lo usa— sin que nada fallara a la vista. El 1-ago se
    # arregló el nombre del campo en el cliente y se dio por cerrado; el lado
    # del servidor nunca se tocó.
    if idx:
        m = re.search(r'const cfg\s*=\s*\{([^}]*)\}', idx)
        pedidos = set(re.findall(r'data\.(\w+)', m.group(1))) if m else set()
        entregados, hay_sql = set(), False
        vers = versionados()
        for d in (BASE, os.path.dirname(BASE)):
            try: archivos = [x for x in os.listdir(d) if x.endswith('.sql')]
            except OSError: continue
            # En la carpeta del repo, solo los que git conoce: un respaldo suelto
            # aportaria campos que el archivo de verdad ya no devuelve, y la
            # regla daria por bueno lo que viene a vigilar.
            if d == BASE and vers is not None:
                archivos = [x for x in archivos if x in vers]
            for f in archivos:
                try: s = io.open(os.path.join(d, f), encoding='utf-8').read()
                except OSError: continue
                for ret in re.findall(r'login_asesor\s*\([^)]*\)\s*\n?\s*RETURNS TABLE\s*\(((?:[^()]|\([^()]*\))*)\)',
                                      s, re.I):
                    hay_sql = True
                    entregados |= set(re.findall(r'(\w+)\s+(?:text|jsonb|boolean|int)', ret))
        faltan = pedidos - entregados - {'vendedores'}
        if hay_sql and faltan:
            falla('cadena', 'index.html lee de la sesión %s, y login_asesor no lo(s) '
                            'devuelve en ningún .sql. Llega vacío y quien dependa de '
                            'eso se queda sin ver nada (MAPA cadena 1)'
                  % ', '.join('"%s"' % x for x in sorted(faltan)))

    # 7b · El precio que se cobra y el que se muestra usan la misma prioridad.
    cap, tab = leer('captura_series.html'), leer('tablero.html')
    if cap and 'promoActiva' in cap and 'if(!pr.d2) return null;' not in cap:
        falla('cadena', 'captura_series: promoActiva ya no exige fecha de fin; '
                        'volvería a cobrar promociones vencidas (MAPA cadena 3)')
    if tab and 'const vigenteHoy' in tab and '!!x.d2' not in tab:
        falla('cadena', 'tablero: vigenteHoy ya no exige fecha de fin (MAPA cadena 3)')

    # 7b-bis · La fecha que manda la app y la que compara el GAS son la misma.
    # La hoja guarda "2/8/2026" sin ceros a la izquierda, y leerVentasDetalle_
    # compara ese texto letra por letra. Si alguien "arregla" fechaGas con
    # padStart para que se vea 02/08/2026, deja de encontrar y no falla: devuelve
    # lista vacía, que en pantalla parece "no hubo ventas ese día".
    if cap and 'fechaGas' in cap:
        m = re.search(r'const fechaGas\s*=\s*([^;]+);', cap)
        if m and ('padStart' in m.group(1) or 'toISOString' in m.group(1)):
            falla('cadena', 'captura_series: fechaGas está rellenando con ceros o '
                            'usando ISO. La hoja guarda "2/8/2026" y el Apps Script '
                            'compara ese texto: no encontraría nada y se vería como '
                            '"sin ventas" (MAPA cadena 3)')
        gs = leer('GAS_Codigo.gs')
        if gs and m:
            # ambos lados tienen que construirla igual: getDate()/getMonth()+1/getFullYear()
            patron = r"getDate\(\)\s*\+\s*'/'\s*\+\s*\(\s*\w+\.getMonth\(\)\s*\+\s*1\s*\)\s*\+\s*'/'"
            if re.search(patron, gs) and not re.search(patron, m.group(1)):
                falla('cadena', 'captura_series: fechaGas ya no arma la fecha como '
                                'fmtFecha_ del Apps Script; dejarían de coincidir')

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


# ── 14-ter · Un ejemplo no puede parecerse a un dato ─────────
# 21-sep-2026. Buscando de dónde salía una venta de «ANA QUIROGA» en la 1217
# —que resultó ser una venta de PRUEBA metida en la base real, ver MAPA.md— se
# vio que el campo de Admin → Equipo tenía como ejemplo «Ana Quiroga / Luis
# Bermúdez / María Zepeda»: tres nombres indistinguibles de una lista de verdad.
#
# NO fue la causa de aquella venta, y conviene que quede dicho para no defender
# una regla con un motivo que no es. Pero el riesgo es real y barato de cerrar:
# quien configura la tienda ve tres nombres con forma de equipo y no tiene cómo
# saber que son de mentira. Si los deja, entran en el desplegable de Captura y
# de ahí a las comisiones y al Excel de la región como una persona más.
#
# Por eso los campos que alimentan DATOS llevan instrucciones de ejemplo, no
# ejemplos que se puedan confundir con el dato.
def r_ejemplos_no_datos():
    CAMPOS = [('admin.html', 'cfgVend', 'la lista del equipo')]
    for pagina, campo, que in CAMPOS:
        s = leer(pagina)
        if s is None:
            continue
        m = re.search(r'id="%s"[^>]*placeholder="([^"]*)"' % campo, s)
        if not m:
            m = re.search(r'placeholder="([^"]*)"[^>]*id="%s"' % campo, s)
        if not m:
            continue
        ejemplo = m.group(1)
        # Dos palabras capitalizadas seguidas = tiene forma de nombre de persona.
        if re.search(r'[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+', ejemplo):
            falla('ejemplos', '%s: el ejemplo de "%s" (%s) tiene forma de nombre '
                              'real ("%s"). Ya pasó una vez: se copió a %s y '
                              'acabó en una venta.'
                              % (pagina, campo, que, ejemplo[:40], que))


# ── 14-quater · Un SQL no puede nombrar una tabla que no existe ──
# 21-sep-2026. Se le pasó a Ángel un SQL para pegar que decía
# `FROM public.accesorios`, y esa tabla se llama `accesorios_ventas`. Lo cazó
# Postgres al pegarlo —«relation does not exist»—, o sea el peor sitio: con el
# editor abierto, a medio aplicar un cambio, y con la duda de si lo que ya
# corrió quedó a medias.
#
# Es barato de comprobar antes: el repo versiona los CREATE de casi todo, así
# que un nombre que no define NADIE es casi siempre un error de escritura.
#
# Las llamadas a función (`FROM public.ventas_hoy(...)`) quedan fuera: se
# reconocen por el paréntesis. Y `empleados` y `tiendas` van en la lista de
# conocidas porque existen en la base desde antes de que el repo versionara
# esquemas — no se versionaron nunca, y eso es un hueco aparte.
def r_tablas_que_existen():
    CONOCIDAS_SIN_CREATE = {'empleados', 'tiendas'}
    definidas = set(CONOCIDAS_SIN_CREATE)
    sqls = []
    for carpeta in ('', '_privado'):
        d = os.path.join(BASE, carpeta) if carpeta else BASE
        try:
            for f in sorted(os.listdir(d)):
                if f.endswith('.sql'):
                    sqls.append(os.path.join(carpeta, f) if carpeta else f)
        except OSError:
            pass
    textos = {}
    for f in sqls:
        t = leer(f)
        if t is None:
            continue
        textos[f] = t
        for m in re.finditer(r'create\s+(?:or\s+replace\s+)?'
                             r'(?:table|view|materialized\s+view|function)\s+'
                             r'(?:if\s+not\s+exists\s+)?public\.(\w+)', t, re.I):
            definidas.add(m.group(1).lower())

    for f, t in textos.items():
        for m in re.finditer(r'\b(?:from|join|update|into)\s+public\.(\w+)(\s*\()?', t, re.I):
            nombre, parentesis = m.group(1).lower(), m.group(2)
            if parentesis:          # es una llamada a función, no una tabla
                continue
            if nombre not in definidas:
                falla('sql', '%s usa public.%s y ningun CREATE del repo la define. '
                             'Si es un nombre mal escrito, Postgres lo dira al pegarlo '
                             '—con el cambio a medio aplicar—; si la tabla existe de '
                             'verdad, falta versionar su CREATE.' % (f, nombre))


# ── 15 · El precache tiene que bajar de la red ──────────────
# 9-ago-2026. `c.add(url)` a secas pasa por la cache HTTP del navegador, y
# GitHub Pages manda max-age=600: la cache nueva se llenaba con los HTML
# VIEJOS que el navegador ya tenia. El service worker los servia creyendo que
# eran los ultimos, y como la cache lleva el numero de version correcto no
# habia forma de verlo desde fuera. El equipo estuvo dos dias sin recibir un
# solo arreglo por esto.
def r_precache():
    s = leer('sw.js')
    if s is None:
        falla('precache', 'no encuentro sw.js'); return
    m = re.search(r'addEventListener\(\s*.install.', s)
    if not m:
        falla('precache', 'sw.js no tiene el evento install'); return
    cuerpo = s[m.start():m.start() + 1600]
    # Sin comentarios: el propio comentario que explica esto dice "reload" y
    # satisfacia la regla aunque el codigo ya no lo hiciera. Una regla que se
    # cumple sola con su documentacion no vigila nada.
    codigo = re.sub(r'/\*.*?\*/', '', cuerpo, flags=re.S)
    codigo = re.sub(r'//[^\n]*', '', codigo)
    if re.search(r'cache\s*:\s*.reload.', codigo):
        return
    falla('precache', "sw.js precachea sin cache:'reload': se guardaran los "
                      'archivos que el navegador tenga en su cache HTTP, no los '
                      'publicados, y la app servira una version vieja sin avisar')


# ── 13-ter · Paleta: se puede limpiar, no ensuciar ──────────
# 22-sep-2026, con el rediseño visual. Ninguna página compartía estilo: Captura
# usaba 84 colores distintos y el tablero 72, casi todos puestos a mano una vez
# y nunca más. Así, cada pantalla parecía de otra app.
#
# Limpiarlo es trabajo de varias sesiones (ver estilo.css). Esta regla es el
# TRINQUETE: el número de colores de cada página puede bajar, nunca subir. Un
# color nuevo se agrega como variable en estilo.css y se usa por su nombre
# (var(--alerta)), no como #b01c22 suelto en un archivo.
#
# Cuando una página baja, se baja aquí su tope en el mismo commit — el aviso lo
# dice — para que no quede holgura que otro se gaste.
#
# horarios.html es la COPIA que publica horario-semanal/deploy.ps1: si su tope
# salta, el color nuevo se quita en horario_semanal.html, no aquí.
PALETA_TOPE = {
    'index.html': 2, 'tablero.html': 72, 'captura_series.html': 16,
    'admin.html': 6, 'horarios.html': 3, 'comisiones.html': 1,
    'accesorios_tecnico.html': 1,
    'estilo.css': 19,
}
def _colores(texto):
    return set(c.lower() for c in re.findall(r'#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b', texto))

def r_paleta():
    sw = leer('sw.js') or ''
    for arch, tope in PALETA_TOPE.items():
        s = leer(arch)
        if s is None:
            continue
        n = len(_colores(s))
        if n > tope:
            nuevos = ''
            try:
                antes = subprocess.run(['git', 'show', 'HEAD:' + arch], cwd=BASE,
                                       capture_output=True, text=True, encoding='utf-8',
                                       errors='replace').stdout
                nuevos = ', '.join(sorted(_colores(s) - _colores(antes))[:6])
            except (OSError, subprocess.SubprocessError):
                pass
            falla('paleta', '%s usa %d colores y su tope es %d%s. Usa una variable de '
                            'estilo.css (var(--alerta), var(--tinta-3)…) en vez de un '
                            'color suelto' % (arch, n, tope, (' — nuevos: ' + nuevos) if nuevos else ''))
        elif n < tope:
            aviso('paleta', '%s bajó a %d colores (tope %d): baja su tope en PALETA_TOPE '
                            'para que no quede holgura' % (arch, n, tope))
    # La página que se apoya en estilo.css sin tenerlo en caché abre SIN
    # encabezado ni colores cuando no hay señal, y con red se ve perfecta.
    for pagina in PALETA_TOPE:
        s = leer(pagina) or ''
        if re.search(r'<link[^>]+href="\./estilo\.css"', s) and "'./estilo.css'" not in sw:
            falla('paleta', '%s carga estilo.css pero no está en ARCHIVOS de sw.js: '
                            'sin señal la página abre sin estilo' % pagina)


# ── 13-bis · Los .js que carga cada página existen y se precachean ──────
# 20-ago-2026, al sacar `accClave`/`accPrefijo` de captura_series.html a
# `acc_codigos.js` para que Admin usara LA MISMA regla y no una copia.
#
# Compartir código entre páginas crea una dependencia que antes no había, y
# falla de la peor manera: el <script src> que no llega no rompe la página al
# abrirla —rompe la primera función que use lo que traía—. Aquí sería al
# teclear un código de artículo, con un ReferenceError que solo se ve en la
# consola del teléfono.
#
# Y si el archivo existe pero no está en ARCHIVOS del service worker, funciona
# con red y falla sin ella: el peor de los dos mundos, porque pasa las pruebas.
def r_scripts_locales():
    sw = leer('sw.js') or ''
    for pagina in ('index.html', 'tablero.html', 'captura_series.html',
                   'admin.html', 'comisiones.html', 'horarios.html'):
        s = leer(pagina)
        if s is None:
            continue
        for src in re.findall(r'<script[^>]+src="\./([^"]+\.js)"', s):
            if not os.path.exists(os.path.join(BASE, src)):
                falla('scripts', '%s carga ./%s y ese archivo no existe: la '
                                 'pagina abre igual y revienta al usar lo que '
                                 'traia' % (pagina, src))
                continue
            if ("'./%s'" % src) not in sw and ('"./%s"' % src) not in sw:
                falla('scripts', './%s lo carga %s pero no esta en ARCHIVOS de '
                                 'sw.js: funciona con red y falla sin ella'
                                 % (src, pagina))


# ── 14 · Que la app FUNCIONE, no solo que compile ───────────
# Las reglas de arriba leen el código. Éstas lo ejecutan: pintan las seis
# pantallas del tablero con una tienda inventada y recorren las 64 formas de
# salir de una pantalla y volver.
#
# Se añadieron el 8-ago-2026 después de publicar tres versiones seguidas con
# fallos que ninguna revisión de código habría visto —dos dejaron la app sin
# forma de llegar al menú— porque cada arreglo se probó por su camino y los
# fallos vivían en los cruces. Tardan menos de dos segundos las dos.
def r_pruebas():
    node = None
    for cand in ('node', 'node.exe'):
        try:
            subprocess.run([cand, '--version'], capture_output=True, timeout=10)
            node = cand; break
        except (OSError, subprocess.SubprocessError):
            pass
    if not node:
        aviso('pruebas', 'node no está instalado: no se pudo ejecutar la app')
        return
    # Bibliotecas, no pruebas: no se ejecutan solas.
    APOYO = ('dom.js', 'entorno.js', 'casos_tablero.js')
    GUIONES = ('humo_tablero.js', 'humo_captura.js', 'humo_menu.js',
               'login_a_captura.js', 'navegacion.js', 'actualizacion.js',
               'cola_ventas.js', 'catalogo_accesorios.js', 'mrfix_tipo.js',
               'mrfix_detecta.js', 'ventas_dia_seguro.js', 'acc_alias_codigos.js',
               'horario_solo_mio.js', 'horario_sesion_ajena.js', 'tareas_rotacion.js',
               'comisiones_solo_mia.js',
               'login_por_correo.js', 'admin_sesion_ajena.js',
               'mrfix_corregir.js', 'cea_precio_nuevo.js', 'cea_vigencia.js',
               'concurso_oro_plata.js', 'admin_preventa.js',
               'lector_etiqueta.js', 'venta_borrar.js',
               'venta_quien.js', 'pantalla_390.js', 'nombres_cliente.js',
               'captura_nombres_seguro.js', 'horario_hoy.js')

    # La lista de arriba es explícita a propósito —así falta un archivo y se
    # nota—, pero eso deja el hueco contrario: una prueba escrita y no añadida
    # aquí no corre nunca, y nada lo dice. Se pasa por escrito y no se usa.
    try:
        sueltas = [f for f in sorted(os.listdir(os.path.join(BASE, 'pruebas')))
                   if f.endswith('.js') and f not in GUIONES and f not in APOYO]
    except OSError:
        sueltas = []
    for f in sueltas:
        falla('pruebas', 'pruebas/%s existe pero no está en la lista de '
                         'verificar.py: no se ejecuta, y parece que sí' % f)

    for guion in GUIONES:
        ruta = os.path.join(BASE, 'pruebas', guion)
        if not os.path.exists(ruta):
            falla('pruebas', 'falta pruebas/%s — es lo que impide publicar una app '
                             'que no se puede usar' % guion)
            continue
        try:
            r = subprocess.run([node, ruta], capture_output=True, text=True,
                               timeout=120, encoding='utf-8', errors='replace')
        except subprocess.SubprocessError as e:
            falla('pruebas', '%s no pudo correr: %s' % (guion, e))
            continue
        salida = (r.stdout or '').strip() + (('\n' + r.stderr.strip()) if r.returncode and r.stderr else '')
        if r.returncode:
            for linea in salida.splitlines()[:12]:
                falla('pruebas', linea.strip())
        elif salida:
            print('  ok     %s' % salida.splitlines()[0])


# ── 16 · Una función que ESCRIBE no puede ir marcada STABLE ──
def _sql_sin_comentarios(t):
    if not t: return ''   # `git show` de un archivo que no estaba devuelve vacio
    # Los de bloque TAMBIEN: un comentario que explica por que un alias no debe
    # llamarse `r` contiene, por fuerza, el texto del alias malo. Sin quitarlos,
    # la regla se denuncia a si misma y el aviso real se pierde entre los falsos.
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    return re.sub(r'--[^\n]*', '', t)


def r_sql_volatilidad():
    """Marcar STABLE algo que escribe da un 405, y la app lo llama «sin conexión».

    20-ago-2026: `accesorios_tecnico_lista` y `accesorios_tecnico_foto` iban
    marcadas STABLE y llamaban a `tecnico_ok_`, que sella `ultimo_acceso` con un
    UPDATE. PostgREST corre las funciones STABLE en transacción de SOLO LECTURA,
    así que reventaban con `25006: cannot execute UPDATE in a read-only
    transaction`.

    Lo que lo hizo caro fue CUÁNDO falla: solo con la clave BUENA. Con una mala,
    `tecnico_ok_` sale en el SELECT, antes del UPDATE, y devuelve cero filas tan
    tranquila. O sea que probarlo con una clave inventada —lo primero que hace
    cualquiera— sale bien, y el único que ve el fallo es el técnico de verdad.

    Se mira también a QUIÉN llama cada función, no solo su cuerpo: aquí ninguna
    de las dos tenía un UPDATE a la vista. El UPDATE estaba una llamada más
    abajo, y esa es justo la razón de que se marcaran STABLE sin que chirriara."""
    # El nombre de la tabla al final y NO un \b: `UPDATE\s+\w\b` no casa nunca
    # —la \w se come la primera letra y entre esa y la segunda no hay límite—,
    # y así la regla daba por buenas justo las funciones que venía a cazar.
    # Pedir el identificador de después deja fuera el `FOR UPDATE` de un SELECT,
    # que es un bloqueo de fila y no una escritura.
    ESCRIBE = re.compile(r'\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+[\w"]', re.I)
    funcs = {}
    for ruta in sorted(glob.glob(os.path.join(BASE, 'supabase_*.sql'))):
        arch = os.path.basename(ruta)
        s = leer(arch)
        if s is None: continue
        for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(',
                             s, re.I):
            cab = re.search(r'\bAS\s+(\$\w*\$)', s[m.end():], re.I)
            if not cab: continue
            tag = cab.group(1)
            ini = m.end() + cab.end()
            fin = s.find(tag, ini)
            if fin < 0: continue
            # Sin comentarios: la explicación de POR QUÉ una función no es STABLE
            # lleva la palabra STABLE escrita, y la regla se delataría sola.
            fija = re.search(r'\b(STABLE|IMMUTABLE)\b',
                             _sql_sin_comentarios(s[m.end(): m.end() + cab.start()]), re.I)
            funcs[m.group(1)] = (arch, fija.group(1).upper() if fija else '',
                                 _sql_sin_comentarios(s[ini:fin]))

    escriben = set(n for n, (_, _, c) in funcs.items() if ESCRIBE.search(c))
    for _ in range(len(funcs) + 1):          # y quien las llama, y quien llama a esas
        nuevas = set()
        for n, (_, _, c) in funcs.items():
            if n in escriben: continue
            for otra in escriben:
                if re.search(r'\b%s\s*\(' % re.escape(otra), c):
                    nuevas.add(n); break
        if not nuevas: break
        escriben |= nuevas

    for n in sorted(escriben):
        arch, fija, _ = funcs[n]
        if fija:
            falla('sql-volatil',
                  '%s: `%s` va marcada %s y escribe (o llama a algo que escribe). '
                  'PostgREST la corre en transacción de solo lectura y devuelve 405; '
                  'la pantalla lo enseña como «no hay conexión». Quítale %s.'
                  % (arch, n, fija, fija))


# ── 17 · Un botón de galería que abre la cámara ─────────────
def r_galeria():
    """`capture` en el input de la galería la anula, y no se ve por ningún lado.

    24-ago-2026: el ticket del accesorio solo se podía fotografiar en el momento
    —`capture="environment"` ABRE LA CÁMARA y deja fuera el carrete—, así que un
    ticket ya guardado en el teléfono no había forma de subirlo.

    El fallo que vigila esta regla es el de después: copiar el input de la cámara
    para hacer el de la galería y dejarle el `capture` puesto. El botón aparece,
    se pulsa, se abre la cámara y el asesor supone que el teléfono es así. No hay
    error, no hay pantalla en blanco: hay una función que dice estar y no está."""
    for p in HTML + SUELTOS:
        s = leer(p)
        if s is None: continue
        for m in re.finditer(r'<input[^>]*type="file"[^>]*>', s, re.I):
            tag = m.group(0)
            idm = re.search(r'id="([^"]+)"', tag)
            if not idm or 'image/' not in tag: continue
            if re.search(r'gal', idm.group(1), re.I) and 'capture' in tag.lower():
                falla('galeria',
                      '%s: el input `%s` es el de la galería y lleva `capture`, '
                      'que abre la cámara. El botón estaría ahí sin hacer lo suyo, '
                      'y eso no da error en ningún sitio.' % (p, idm.group(1)))

    # Y el caso simétrico, que es el que se coló: una pantalla de fotos que
    # nace SÓLO con cámara.
    #
    # 21-sep-2026. El concurso salió con `cnFile` y nada más, así que el ticket
    # que ya estaba en el teléfono —el de cerrar el día, el que un compañero
    # mandó por WhatsApp— no se podía subir. No es un fallo que se vea: la
    # pantalla funciona, el botón dispara la cámara, y la función que falta no
    # deja hueco en ningún sitio. Las series y los accesorios ya tenían sus dos
    # inputs desde el 24-ago; el concurso, de septiembre, nació sin el segundo.
    #
    # Sólo sobre HTML —las pantallas de verdad—: una página de diagnóstico se
    # abre en el escritorio y no es algo que un asesor use con el cliente
    # delante. (El ejemplo era `prueba_ticket.html`, borrada el 21-sep-2026.)
    for p in HTML:
        s = leer(p)
        if s is None: continue
        conCaptura, deGaleria = [], []
        for m in re.finditer(r'<input[^>]*type="file"[^>]*>', s, re.I):
            tag = m.group(0)
            if 'image/' not in tag: continue
            idm = re.search(r'id="([^"]+)"', tag)
            ident = idm.group(1) if idm else tag[:40]
            if 'capture' in tag.lower(): conCaptura.append(ident)
            else: deGaleria.append(ident)
        for ident in conCaptura:
            # El hermano se reconoce por el nombre: `accFile` → `accFileGal`,
            # `fileCam` → `fileGal`. Si mañana se nombran de otra forma, esta
            # regla lo dice y se decide entonces; callarse es lo que no puede.
            raiz = re.sub(r'(cam|file)$', '', ident, flags=re.I).lower()
            if not any(raiz in g.lower() or g.lower().startswith(ident.lower())
                       or 'gal' in g.lower() and raiz[:2] in g.lower()
                       for g in deGaleria):
                falla('galeria',
                      '%s: el input `%s` abre la cámara (`capture`) y no tiene '
                      'al lado uno de galería. El ticket que ya está en el '
                      'teléfono no se puede subir, y la pantalla no lo dice.'
                      % (p, ident))


# ── 18 · Las reparaciones NO entran en el Excel regional ────
def r_reparaciones_fuera():
    """Una reparación en el Excel de Mr Fix mueve comisiones de todo el equipo.

    24-ago-2026. `accesorios_reporte` arma el pegado del Excel regional
    —`Registro_Ventas_MrFix_Odemas_2026.xlsx`, hoja `1217 AGOS 26`, que
    comparten diez tiendas— y lee `accesorios_ventas`. Las reparaciones viven en
    su propia tabla justo para que no puedan colarse ahí.

    Que hoy sean tablas distintas es la garantía; esta regla es la que avisa el
    día que alguien la deshaga. Un JOIN «para verlo todo junto» en la función
    del reporte, o un `reparaciones_lista` llamado desde la pantalla que baja el
    Excel, no darían error: darían un Excel con importes de más y comisiones
    para gente que no vendió nada. Y se vería, si se ve, al cuadrar la región.

    Se comprueban los dos caminos, el del servidor y el de la app, porque cada
    uno basta por su cuenta para contaminar el archivo."""
    # A · ninguna función de reporte puede leer la tabla de reparaciones
    for ruta in sorted(glob.glob(os.path.join(BASE, 'supabase_*.sql'))):
        arch = os.path.basename(ruta)
        s = leer(arch)
        if s is None: continue
        for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w*reporte\w*)\s*\(',
                             s, re.I):
            cab = re.search(r'\bAS\s+(\$\w*\$)', s[m.end():], re.I)
            if not cab: continue
            tag = cab.group(1)
            ini = m.end() + cab.end()
            fin = s.find(tag, ini)
            if fin < 0: continue
            cuerpo = _sql_sin_comentarios(s[ini:fin])
            if re.search(r'\breparaciones\b', cuerpo, re.I):
                falla('excel-mrfix',
                      '%s: `%s` arma el reporte del Excel regional y lee `reparaciones`. '
                      'Esas no se cobran a la tienda: el Excel saldría con importes de más '
                      'y comisiones para quien no vendió nada, sin dar error.'
                      % (arch, m.group(1)))

    # B · en la app, el Excel solo puede armarse con lo que dio `accesorios_reporte`
    #
    # (6-sep-2026) Antes esto era una lista blanca de UN nombre: la pantalla solo
    # podía llamar a `reparacion_guardar`. Se quedó corta el día que hubo que
    # corregir y borrar tickets desde aquí —y era corta ya, porque una lectura
    # llamada `mrfix_dia` trae reparaciones y no lleva «reparacion» en el nombre:
    # la regla la habría dejado pasar sin decir nada.
    #
    # Ahora se ata AL DATO y no al nombre. `_repFilas` es lo único de lo que se
    # construye el XLSX (`for(const f of _repFilas)`), así que basta exigir que
    # solo se llene desde `accesorios_reporte`. Con eso da igual cuántas
    # lecturas de reparaciones haya en la pantalla: ninguna puede llegar al
    # pegado sin pasar por aquí.
    s = leer('captura_series.html')
    if s is None: return

    ESCRITURAS_DE_UNA_FILA = ('reparacion_guardar', 'reparacion_editar', 'reparacion_eliminar')
    for m in re.finditer(r"sbCallCS\(\s*'(reparacion\w*|reparaciones\w*)'", s):
        if m.group(1) not in ESCRITURAS_DE_UNA_FILA:
            falla('excel-mrfix',
                  'captura_series.html llama a `%s`, y esta es la pantalla que baja el '
                  'Excel regional. Guardar, corregir o borrar UNA reparación está bien; '
                  'traerse listas de ellas es lo que acaba metiéndolas en el pegado.'
                  % m.group(1))

    if '_repFilas' not in s:
        falla('excel-mrfix',
              'captura_series.html ya no tiene `_repFilas`: si el Excel se arma ahora '
              'con otra variable, esta regla dejó de vigilar nada. Actualízala.')
        return
    for m in re.finditer(r'_repFilas\s*=\s*([^;\n]+)', s):
        origen = m.group(1).strip()
        # `[]` es vaciarla antes de pedir; lo demás tiene que venir del reporte.
        if origen.startswith('[]'):
            continue
        # Se exige que la variable asignada sea LA MISMA que recibió la llamada a
        # `accesorios_reporte`. Buscar solo si ese nombre aparece «cerca» no vale:
        # la llamada está siete líneas más arriba, así que cambiar el origen por
        # otra lista pasaba la comprobación sin despeinarse. (Comprobado: la
        # primera versión de esta regla no cazó justo eso.)
        var = re.match(r'^([A-Za-z_$][\w$]*)\s*$', origen)
        if not var:
            falla('excel-mrfix',
                  '`_repFilas` se llena con «%s», que no es una variable suelta. De ahí '
                  'sale el Excel de la región: déjalo en una asignación simple que se '
                  'pueda seguir hasta `accesorios_reporte`.' % origen[:60])
            continue
        antes = s[max(0, m.start() - 900):m.start()]
        if not re.search(r'\b' + re.escape(var.group(1)) +
                         r'\s*=\s*await\s+sbCallCS\(\s*[\'"]accesorios_reporte[\'"]', antes):
            falla('excel-mrfix',
                  '`_repFilas` se llena con `%s`, que no viene de `accesorios_reporte`. '
                  'De esa variable sale el Excel de la región: si le entra cualquier otra '
                  'lista —la de corregir tickets, por ejemplo— el pegado se lleva '
                  'reparaciones y mueve comisiones de diez tiendas, sin dar error.'
                  % var.group(1))


# ── 19 · Un alias de tabla que pisa una variable del DECLARE ─
def r_alias_variable():
    """plpgsql resuelve sus variables ANTES que las tablas, y revienta entera.

    24-ago-2026: al ampliar `accesorios_tecnico_foto` para aceptar reparaciones
    se escribió `FROM public.reparaciones r`, en una función que declara
    `r record`. El `r.store_id` del WHERE se leyó como un campo de la variable
    —sin asignar todavía— y la función murió con
    `55000: record "r" is not assigned yet`.

    Lo que lo hace caro es el alcance: no falla solo lo nuevo. Esa función es la
    que abre TODAS las fotos, así que un alias de dos letras dejó al técnico sin
    poder ver tampoco los tickets de accesorios, que llevaban semanas
    funcionando. Y la variable se declara en un archivo distinto del que se está
    editando, así que al escribir el alias no hay nada a la vista que chirríe.

    Se vio probando la función contra el servidor después de pegarla, no
    leyéndola: el SQL es válido y el fallo solo existe en tiempo de ejecución."""
    CLAVES = set('''where on group order limit having left right inner outer full
                    join cross union all as into using set returning for loop
                    and or not exists select from natural lateral'''.split())
    for ruta in sorted(glob.glob(os.path.join(BASE, 'supabase_*.sql'))):
        arch = os.path.basename(ruta)
        s = leer(arch)
        if s is None: continue
        for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(',
                             s, re.I):
            cab = re.search(r'\bAS\s+(\$\w*\$)', s[m.end():], re.I)
            if not cab: continue
            tag = cab.group(1)
            ini = m.end() + cab.end()
            fin = s.find(tag, ini)
            if fin < 0: continue
            cuerpo = _sql_sin_comentarios(s[ini:fin])

            # Las variables del DECLARE (lo que va entre DECLARE y el BEGIN)
            dec = re.search(r'\bDECLARE\b(.*?)\bBEGIN\b', cuerpo, re.I | re.S)
            if not dec: continue
            # Solo las de tipo RECORD (o %ROWTYPE). Con una variable escalar no
            # hay choque: un `int` no tiene campos, asi que `a.venta_id` resuelve
            # a la tabla y funciona. `cargar_cortes` lleva meses cargando el
            # inventario cada dia con un alias `a` y una variable `a int`.
            # Marcarlas seria enseñar cinco fallos falsos, y una regla que grita
            # sin motivo se acaba desactivando entera —con el fallo de verdad
            # dentro—.
            variables = set()
            for linea in dec.group(1).split(';'):
                v = re.match(r'\s*(\w+)\s+(record\b|\w+%rowtype\b)', linea, re.I)
                if v: variables.add(v.group(1).lower())
            if not variables: continue

            # Los alias de tabla del cuerpo
            for a in re.finditer(r'\b(?:FROM|JOIN)\s+(?:public\.)?\w+\s+(?:AS\s+)?(\w+)',
                                 cuerpo, re.I):
                alias = a.group(1).lower()
                if alias in CLAVES or alias not in variables: continue
                falla('alias-var',
                      '%s: `%s` usa `%s` como alias de tabla y `%s` es tambien una '
                      'variable del DECLARE. plpgsql resuelve la variable primero, asi '
                      'que la funcion entera falla en ejecucion (55000) aunque el SQL '
                      'sea valido. Cambiale el alias.' % (arch, m.group(1), alias, alias))


# ── 20 · Cambiar el RETURNS TABLE exige DROP antes ───────────
def _cols_returns_table(texto):
    r"""{funcion: [columnas]} de cada RETURNS TABLE del archivo.

    Se parte por comas de NIVEL SUPERIOR y se toma el primer identificador de
    cada trozo. La version anterior usaba `^\s*(\w+)\s+\w`, que coge solo el
    primero de cada LINEA: con `dia integer, ticket text` en un renglon veia
    `dia` y se perdia `ticket`. Para el aviso de `r_contrato_sql` da igual
    —enseña una muestra—, pero aqui se comparan dos listas, y una columna
    añadida al final de una linea que ya existia no cambiaba nada. La regla
    decia que todo estaba bien justo en el caso que venia a cazar.

    Los parentesis se respetan porque `numeric(12,2)` lleva su propia coma."""
    fuera = {}
    for m in re.finditer(r'FUNCTION\s+public\.(\w+)\s*\([^)]*\)\s*\n?\s*RETURNS\s+TABLE\s*\(([^;]*?)\)\s*\n\s*(?:--[^\n]*\n\s*)*LANGUAGE',
                         _sql_sin_comentarios(texto), re.I):
        cols, trozo, hondo = [], '', 0
        for ch in m.group(2):
            if ch == '(': hondo += 1
            elif ch == ')': hondo -= 1
            if ch == ',' and hondo == 0:
                cols.append(trozo); trozo = ''
            else:
                trozo += ch
        cols.append(trozo)
        nombres = []
        for c in cols:
            n = re.match(r'\s*(\w+)\s+\w', c)
            if n: nombres.append(n.group(1).lower())
        fuera[m.group(1)] = nombres
    return fuera


def r_returns_table_drop():
    """`CREATE OR REPLACE` no puede cambiar el tipo de retorno. Da 42P13 al pegar.

    24-ago-2026: a `accesorios_reporte` se le añadieron `captura_id` y
    `tiene_foto` para poder abrir el ticket desde el reporte. El archivo pasó
    todas las reglas, se dio por bueno y el error salió **en el SQL Editor**, con
    el pegado a medias:

        42P13: cannot change return type of existing function

    Es de los pocos fallos que no se pueden ver leyendo el archivo, porque
    dependen de lo que YA hay en el servidor. Pero sí se puede ver que el
    RETURNS TABLE cambió respecto al último commit, y eso basta: si cambió, hace
    falta un `DROP FUNCTION` delante.

    ⚠️ `git show` va con `encoding='utf-8'` EXPLÍCITO. Con `text=True` a secas,
    en Windows decodifica en cp1252, revienta con el primer acento del archivo y
    deja `stdout` vacío: la regla comparaba contra nada, no encontraba ningún
    cambio y decía que todo estaba bien. Una regla que calla por no saber leer el
    archivo es peor que no tenerla, porque además da permiso.

    ⚠️ El `DROP` se lleva los GRANT por delante. Por eso la regla exige también
    que el archivo vuelva a dar permisos: una función sin `GRANT` existe pero no
    la puede llamar nadie, y la pantalla dice «sin permiso» con todo bien puesto
    —que es exactamente el fallo de v199, tres días antes—."""
    staged = '--staged' in sys.argv
    for arch in [c for c in git_cambiados(staged) if c.endswith('.sql')]:
        ahora = leer(arch)
        if ahora is None: continue
        try:
            ref = 'HEAD:./' + arch
            r = subprocess.run(['git', 'show', ref], cwd=BASE,
                               capture_output=True, timeout=20,
                               encoding='utf-8', errors='replace')
            if r.returncode != 0: continue      # archivo nuevo: nada que romper
            antes = r.stdout or ''
        except (OSError, subprocess.SubprocessError):
            continue

        viejas, nuevas = _cols_returns_table(antes), _cols_returns_table(ahora)
        for fn, cols in nuevas.items():
            if fn not in viejas or viejas[fn] == cols: continue
            if not re.search(r'DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.%s\b' % re.escape(fn),
                             ahora, re.I):
                falla('drop-returns',
                      '%s: `%s` cambia sus columnas (%s -> %s) y no lleva un '
                      'DROP FUNCTION delante. Al pegarlo saldra 42P13 y el archivo '
                      'se quedara a medias.'
                      % (arch, fn, ', '.join(viejas[fn]) or 'ninguna',
                         ', '.join(cols) or 'ninguna'))
            elif not re.search(r'GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.%s\b' % re.escape(fn),
                               ahora, re.I):
                falla('drop-returns',
                      '%s: `%s` se DROPea pero el archivo no le vuelve a dar GRANT. '
                      'Quedaria existiendo y sin que nadie pueda llamarla, y la '
                      'pantalla lo ensena como falta de permiso.' % (arch, fn))


# ── 21 · La misma funcion definida en dos archivos ──────────
def r_funcion_repetida():
    """Gana la ultima que se pegue, y repegar un archivo viejo revierte en silencio.

    24-ago-2026: `accesorios_tecnico_foto` estaba definida en
    `supabase_tecnicos.sql` —solo accesorios— y otra vez en
    `supabase_reparaciones.sql`, ampliada para servir tambien los tickets de
    reparacion. Repegar el primero por cualquier motivo ajeno —dar de alta un
    tecnico, cambiar una clave— habria devuelto la version vieja y roto las
    fotos de las reparaciones, sin tocar nada relacionado y sin dar error.

    Es AVISO y no falla porque en este repo redefinir una funcion en un archivo
    posterior es el mecanismo de migracion: `ventas_detalle`, `inventario_vivo`
    y `apartados_lista` viven asi desde hace meses y funcionan. Bloquear el
    commit obligaria a limpiar todo eso de golpe.

    Solo habla de los archivos que se estan tocando en ESTE commit, que es
    cuando la pregunta sale barata: si vas a pegar este archivo, mira si te
    llevas por delante una version mas nueva de otro."""
    tocados = set(c for c in git_cambiados('--staged' in sys.argv) if c.endswith('.sql'))
    if not tocados: return

    donde = {}
    for ruta in sorted(glob.glob(os.path.join(BASE, 'supabase_*.sql'))):
        arch = os.path.basename(ruta)
        s = leer(arch)
        if s is None: continue
        for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(',
                             _sql_sin_comentarios(s), re.I):
            donde.setdefault(m.group(1), []).append(arch)

    for fn, archivos in sorted(donde.items()):
        otros = sorted(set(archivos))
        if len(otros) < 2: continue
        if not (tocados & set(otros)): continue
        aviso('duplicada',
              '`%s` se define en %d archivos: %s. Al pegar gana el ultimo, y '
              'repegar el viejo revierte al otro sin dar error. Comprueba cual '
              'es la version buena antes de pegar.'
              % (fn, len(otros), ', '.join(otros)))


def main():
    # `--solo-datos <carpeta>`: corre SOLO la regla de datos personales, pero
    # sobre otro repo. Existe porque `horario-semanal` publica en un repo
    # PUBLICO y no tiene verificador propio; escribirle uno aparte seria una
    # segunda copia de esta regla, y la version que se quede corta sera siempre
    # la que no se este mirando. Una sola regla, tres repos.
    if '--solo-datos' in sys.argv:
        global BASE
        i = sys.argv.index('--solo-datos')
        if i + 1 >= len(sys.argv):
            print('  FALLA  [datos] --solo-datos necesita la carpeta del repo.')
            return 1
        otro = os.path.abspath(sys.argv[i + 1])
        if not os.path.isdir(os.path.join(otro, '.git')):
            # FALLA, no aviso: si el puente entre carpetas hermanas se rompe,
            # callar aqui deja el repo publico sin nadie mirandolo y sin decirlo.
            print('  FALLA  [datos] %s no es un repositorio git. La revision de '
                  'nombres NO ha corrido.' % otro)
            return 1
        privado = os.path.join(BASE, PRIVADO)     # la lista vive en la 1217
        BASE = otro
        globals()['PRIVADO'] = os.path.relpath(privado, otro)
        r_personales()
        r_nombres_forma()
        for regla, msg in avisos: print('  aviso  [%s] %s' % (regla, msg))
        for regla, msg in fallas: print('  FALLA  [%s] %s' % (regla, msg))
        if fallas:
            print('\n%d problema(s). No subas esto todavía.' % len(fallas))
            return 1
        print('Nombres del equipo: nada que no deba publicarse.')
        return 0

    staged = '--staged' in sys.argv
    # Va PRIMERA: si git no contesta, las reglas que lo consultan no corren, y
    # conviene saberlo antes de leer 24 «ok» que no cubren lo que parecen.
    r_git()
    r_sintaxis(); r_helpers(); r_version(staged); r_copias(); r_puestos_gestion()
    r_sesion_prefijada(); r_cupo()
    r_preventa_sb(); r_preventa_stock(); r_cargas_sb(); r_lectura_con_escritura()
    r_porteros(); r_contrato_sql(); r_join_sql()
    r_sql_volatilidad(); r_galeria(); r_reparaciones_fuera(); r_alias_variable(); r_returns_table_drop(); r_funcion_repetida()
    r_personales(); r_nombres_forma(); r_secretos(); r_silencios(); r_cadenas(); r_precache(); r_paleta(); r_scripts_locales(); r_ejemplos_no_datos(); r_tablas_que_existen(); r_pruebas()

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
