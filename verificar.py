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
        'comisiones.html', 'actualizar_datos.html', 'horarios.html']
# horarios.html no se edita aquí: es copia de 02_Equipo/horario_semanal.html, que
# se publica también en el repo planeador-odemas para las demás tiendas.
COPIAS = {'horarios.html': os.path.join('..', '02_Equipo', 'horario_semanal.html')}
# Páginas que se PUBLICAN pero no son la app: no las sirve el service worker ni
# se enlazan desde el menú. No entran en HTML porque no deben obligar a subir
# VERSION —no llegan a ningún celular por esa vía— pero sí tienen que pasar por
# sintaxis, secretos y datos personales: se publican igual de expuestas.
# (20-ago-2026: `accesorios_tecnico.html` se subió sin que nada la revisara.)
SUELTOS = ['prueba_ticket.html', 'accesorios_tecnico.html']
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
    # `prueba_ticket.html`, que es una página suelta de medición.)
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
        if b is None: continue   # la fuente no está en esta máquina
        if a != b:
            aviso('copia', '%s no es igual a %s. Vuelve a copiarla o el horario '
                           'del tablero se queda atrás.' % (copia, origen))


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
    for archivo in ('actualizar_datos.html', 'admin.html'):
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
             'comisiones.html', 'actualizar_datos.html']
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
        # El (?<![#\w]) es por los colores hex: horarios.html trae #777777 y
        # #827717, que sin eso se reportaban como números de empleado.
        (r'(?<![#\w])\d{6}\b(?!\s*(?:pieza|pzas|MSI))', 'número de empleado'),
        (r'(?i)\b(Ramirez Solis|Ortega Vidal|ortega vidal|Fuentes Bravo|'
         r'Medina Rejon|medina rejon|navarro gal)', 'apellidos del equipo'),
    ]
    for p in HTML + SUELTOS + ['datos.js']:
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
    # Laura, la única que lo usa— sin que nada fallara a la vista. El 1-ago se
    # arregló el nombre del campo en el cliente y se dio por cerrado; el lado
    # del servidor nunca se tocó.
    if idx:
        m = re.search(r'const cfg\s*=\s*\{([^}]*)\}', idx)
        pedidos = set(re.findall(r'data\.(\w+)', m.group(1))) if m else set()
        entregados, hay_sql = set(), False
        for d in (BASE, os.path.dirname(BASE)):
            try: archivos = [x for x in os.listdir(d) if x.endswith('.sql')]
            except OSError: continue
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
                   'admin.html', 'comisiones.html', 'horarios.html',
                   'actualizar_datos.html'):
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
               'cola_ventas.js', 'catalogo_accesorios.js')

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


def main():
    staged = '--staged' in sys.argv
    r_sintaxis(); r_helpers(); r_version(staged); r_copias(); r_cupo()
    r_preventa_sb(); r_preventa_stock(); r_cargas_sb(); r_lectura_con_escritura()
    r_porteros(); r_contrato_sql(); r_join_sql()
    r_personales(); r_secretos(); r_silencios(); r_cadenas(); r_precache(); r_scripts_locales(); r_pruebas()

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
