/* ==========================================================
   BANCO DE MEDICIÓN DEL ESCANEO — la parte que DECIDE
   ==========================================================
   21-sep-2026. Acompaña a `banco_escaneo.html`, que es la página suelta de
   medición (no entra en la app ni en el service worker).

   Aquí vive lo que no se puede probar con la cámara enfrente: la regla de la
   doble lectura, los resúmenes y —sobre todo— EL VEREDICTO, escrito ANTES de
   ver un solo dato para que la meta no se mueva cuando lleguen.

   Nada de esto toca el DOM ni pide permisos: se ejecuta igual en el teléfono
   que en `node pruebas/banco_medicion.js`. Esa es la razón de que sea un
   archivo aparte y no un <script> dentro del HTML.
   ========================================================== */
(function (raiz) {
  'use strict';

  /* ── 1 · La doble lectura ───────────────────────────────
     En continuo la cámara no lee "la foto que tomaste": lee lo que tiene
     delante veinte veces por segundo, y lo que tiene delante incluye la caja
     de al lado. Por eso hace falta ver el MISMO valor dos veces seguidas
     antes de darlo por bueno.

     Dos decisiones que parecen detalle y son el centro:

     · Un fotograma SIN código no reinicia la cuenta. Entre dos lecturas
       buenas casi siempre hay fotogramas movidos que no decodifican nada; si
       eso contara como contradicción, la confirmación no llegaría nunca y el
       continuo parecería peor de lo que es por culpa del medidor, no del
       teléfono.
     · Un QR tampoco cuenta ni reinicia: aquí no son números de serie. Es el
       mismo candado que `routeCode` en captura_series.html, repetido a
       propósito — esto es un banco desechable y no debe crear una dependencia
       nueva con la app que luego haya que recordar al borrarlo. */
  var BANCO_CONFIRMA = 2;
  var BANCO_2D = /qr|matrix|aztec|pdf417|maxi/i;

  function bancoAcepta(fmt) { return !BANCO_2D.test(fmt || ''); }

  function bancoConfirmarInicio() {
    return { ultimo: null, veces: 0, hecho: false };
  }

  function bancoConfirmar(estado, valor, fmt) {
    var e = (estado && typeof estado === 'object') ? estado : bancoConfirmarInicio();
    var quieto = {
      ultimo: e.ultimo, veces: e.veces || 0, hecho: !!e.hecho,
      confirmado: false, valor: null
    };
    var v = (valor == null ? '' : String(valor)).trim();
    if (!v) return quieto;                 // fotograma sin código: no contradice nada
    if (!bancoAcepta(fmt)) return quieto;  // 2D: ni suma ni reinicia
    /* Ya confirmado: no se dispara dos veces. Sin esto, el fotograma siguiente
       —que trae el mismo código, porque la caja sigue ahí— saltaría otra vez al
       paso 2 y contaría un segundo intento que nadie hizo. */
    if (e.hecho) return quieto;
    if (v !== e.ultimo) {
      return { ultimo: v, veces: 1, hecho: false, confirmado: false, valor: null };
    }
    var veces = (e.veces || 0) + 1;
    if (veces < BANCO_CONFIRMA) {
      return { ultimo: v, veces: veces, hecho: false, confirmado: false, valor: null };
    }
    return { ultimo: v, veces: veces, hecho: true, confirmado: true, valor: v };
  }

  /* ── 2 · Resumen de intentos ────────────────────────────
     Un intento es {modo, ok, ms, via}. `via` sólo la llena el modo foto:
     'codigo' si lo leyó el código de barras, 'ocr' si hubo que leer el texto
     "S/N". Esa distinción es media medición: cada lectura que SÓLO salió por
     OCR es una que el escaneo continuo habría perdido, porque el OCR tarda
     segundos y en continuo no cabe.

     Con pocos intentos no se devuelve una mediana: se devuelve `suficiente:
     false`. Una mediana de dos datos tiene la misma pinta que una de veinte y
     no dice lo mismo. */
  var BANCO_MIN_INTENTOS = 6;
  var BANCO_MIN_OK = 3;

  function bancoMediana(xs) {
    if (!xs || !xs.length) return null;
    var a = xs.slice().sort(function (p, q) { return p - q; });
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
  }

  function bancoPercentil(xs, pc) {
    if (!xs || !xs.length) return null;
    var a = xs.slice().sort(function (p, q) { return p - q; });
    var i = Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * pc / 100) - 1));
    return a[i];
  }

  function bancoResumen(intentos, modo) {
    var todos = (intentos || []).filter(function (x) { return x && x.modo === modo; });
    var buenos = todos.filter(function (x) {
      return x.ok && typeof x.ms === 'number' && isFinite(x.ms) && x.ms > 0;
    });
    var tiempos = buenos.map(function (x) { return x.ms; });
    return {
      modo: modo,
      n: todos.length,
      ok: buenos.length,
      fallos: todos.length - buenos.length,
      /* null, NO 0, cuando no hay intentos. Un 0 % de fallos pintado en
         verde para un modo que nadie probó es el error que este banco existe
         para no cometer. */
      fallosPct: todos.length ? Math.round((todos.length - buenos.length) * 1000 / todos.length) / 10 : null,
      mediana: bancoMediana(tiempos),
      p80: bancoPercentil(tiempos, 80),
      porOcr: todos.filter(function (x) { return x.ok && x.via === 'ocr'; }).length,
      suficiente: todos.length >= BANCO_MIN_INTENTOS && buenos.length >= BANCO_MIN_OK
    };
  }

  /* ── 3 · La prueba térmica ──────────────────────────────
     «Cuánto calienta» no se puede leer del navegador: ningún teléfono publica
     su temperatura. Lo que SÍ se mide es lo que la temperatura provoca —el
     sistema baja el reloj y la cámara entrega menos fotogramas— y lo que
     cuesta: la batería.

     Tres números, entonces: la caída de fps entre el primer minuto y el
     último, la deriva del tiempo de decodificación, y el gasto de batería. Y
     uno a mano, porque es el que el asesor siente: si el teléfono quema.

     Una corrida interrumpida NO es una corrida de cinco minutos. Si el asesor
     se cambió de app a los dos minutos, la cámara se apagó (es la regla) y lo
     medido es otra cosa. */
  var BANCO_TERMICO_MIN_MIN = 4;
  var BANCO_TERMICO_MIN_MUESTRAS = 8;

  function _prom(xs) {
    if (!xs.length) return null;
    var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i];
    return Math.round(s * 10 / xs.length) / 10;
  }

  function bancoTermico(muestras, interrumpido) {
    var m = (muestras || []).filter(function (x) { return x && typeof x.t === 'number'; })
      .sort(function (p, q) { return p.t - q.t; });
    if (!m.length) {
      return {
        minutos: 0, muestras: 0, interrumpido: !!interrumpido, suficiente: false,
        fpsIni: null, fpsFin: null, caidaFpsPct: null,
        msIni: null, msFin: null, derivaMsPct: null,
        bateriaPct: null, calor: null
      };
    }
    var t0 = m[0].t, tN = m[m.length - 1].t;
    var dur = tN - t0;
    var ini = m.filter(function (x) { return x.t - t0 <= 60000; });
    var fin = m.filter(function (x) { return tN - x.t <= 60000; });
    var fpsIni = _prom(ini.map(function (x) { return x.fps; }).filter(isFinite));
    var fpsFin = _prom(fin.map(function (x) { return x.fps; }).filter(isFinite));
    var msIni = _prom(ini.map(function (x) { return x.decodMs; }).filter(isFinite));
    var msFin = _prom(fin.map(function (x) { return x.decodMs; }).filter(isFinite));
    /* La batería: si el teléfono no la publica —Safari no trae la API— se
       devuelve null y el veredicto lo trata como NO medido. Un 0 % de gasto
       sería la mejor nota posible sacada de no haber medido nada. */
    var conBat = m.filter(function (x) { return typeof x.bateria === 'number' && isFinite(x.bateria); });
    var bat = conBat.length >= 2
      ? Math.round((conBat[0].bateria - conBat[conBat.length - 1].bateria) * 10) / 10
      : null;
    return {
      minutos: Math.round(dur / 600) / 100,
      muestras: m.length,
      interrumpido: !!interrumpido,
      suficiente: !interrumpido && dur >= BANCO_TERMICO_MIN_MIN * 60000 &&
        m.length >= BANCO_TERMICO_MIN_MUESTRAS,
      fpsIni: fpsIni, fpsFin: fpsFin,
      caidaFpsPct: (fpsIni && fpsFin != null) ? Math.round((fpsIni - fpsFin) * 1000 / fpsIni) / 10 : null,
      msIni: msIni, msFin: msFin,
      derivaMsPct: (msIni && msFin != null) ? Math.round((msFin - msIni) * 1000 / msIni) / 10 : null,
      bateriaPct: bat,
      calor: null   // lo pone la pantalla con lo que conteste el asesor
    };
  }

  /* ── 4 · EL VEREDICTO ───────────────────────────────────
     Escrito antes de tener los datos, y por eso vale. Los umbrales:

     · ≤70 % del tiempo de la foto Y al menos 1.5 s menos. Los dos, porque uno
       solo se engaña: un 40 % de mejora sobre 1.2 s son 0.5 s que nadie nota
       de pie y con el cliente enfrente, y dos segundos menos sobre veinte no
       cambian nada tampoco.
     · No más de 10 puntos de fallos por encima de la foto. El continuo va a
       fallar más —no lleva OCR— y eso está presupuestado; lo que no cabe es
       que el asesor tenga que intentarlo dos veces de cada tres.
     · La cámara no puede tirar el teléfono: menos de 40 % de caída de fps y
       menos de 8 % de batería en cinco minutos. Un teléfono que se arrastra a
       media tarde no es un escáner más rápido, es un turno peor.

     Y la regla que decide de verdad: **hacen falta los dos, Android e
     iPhone**. Si sólo gana en uno, el resultado no es "entra en Android" — es
     `parcial`, y eso significa mantener dos caminos en el paso 1, que es
     precisamente lo que el flujo de foto evita hoy. Lo decide Ángel, no el
     umbral. */
  var BANCO_UMBRAL = {
    ganaRel: 0.70,     // fracción del tiempo de la foto
    ganaAbs: 1500,     // ms de ventaja mínima
    fallosMax: 10,     // puntos porcentuales por encima de la foto
    caidaFpsMax: 40,   // % de caída entre el primer minuto y el último
    bateriaMax: 8      // % de batería en 5 minutos
  };

  function bancoVeredictoPlataforma(p) {
    var motivos = [];
    var foto = p && p.foto, cont = p && p.continuo, term = p && p.termico;
    if (!p) {
      motivos.push('este teléfono no se ha medido todavía');
      return { estado: 'sin_datos', motivos: motivos };
    }
    if (!foto || !cont || !foto.suficiente || !cont.suficiente) {
      motivos.push('faltan intentos: ' + (foto ? foto.n : 0) + ' con foto y ' +
        (cont ? cont.n : 0) + ' en continuo, hacen falta ' + BANCO_MIN_INTENTOS + ' de cada uno');
      return { estado: 'sin_datos', motivos: motivos };
    }
    if (foto.mediana == null || cont.mediana == null) {
      motivos.push('no hay lecturas buenas que cronometrar en los dos modos');
      return { estado: 'sin_datos', motivos: motivos };
    }

    var gana = true;
    var rel = cont.mediana / foto.mediana;
    var abs = foto.mediana - cont.mediana;
    if (rel > BANCO_UMBRAL.ganaRel || abs < BANCO_UMBRAL.ganaAbs) {
      gana = false;
      motivos.push('velocidad: ' + (cont.mediana / 1000).toFixed(1) + ' s contra ' +
        (foto.mediana / 1000).toFixed(1) + ' s (' + Math.round(rel * 100) + ' % del tiempo, ' +
        (abs / 1000).toFixed(1) + ' s menos) — hace falta ≤' +
        Math.round(BANCO_UMBRAL.ganaRel * 100) + ' % y ≥' + (BANCO_UMBRAL.ganaAbs / 1000).toFixed(1) + ' s');
    } else {
      motivos.push('velocidad: ' + (abs / 1000).toFixed(1) + ' s más rápido (' +
        Math.round(rel * 100) + ' % del tiempo de la foto) ✓');
    }

    var dif = cont.fallosPct - foto.fallosPct;
    if (dif > BANCO_UMBRAL.fallosMax) {
      gana = false;
      motivos.push('fallos: ' + cont.fallosPct + ' % contra ' + foto.fallosPct +
        ' % de la foto (+' + Math.round(dif * 10) / 10 + ' puntos, el tope son ' +
        BANCO_UMBRAL.fallosMax + ')');
    }
    if (foto.porOcr > 0) {
      motivos.push('aviso: ' + foto.porOcr + ' de ' + foto.ok +
        ' lecturas buenas salieron por OCR del texto S/N — ésas el continuo las pierde');
    }

    /* Sin prueba térmica no hay verde. No es que salga mal: es que no se
       midió, y la cámara abierta todo el turno es justo el coste que no se ve
       hasta que el teléfono va lento a las seis de la tarde. */
    if (!term || !term.suficiente) {
      gana = false;
      motivos.push('falta la prueba térmica de 5 minutos' +
        (term && term.interrumpido ? ' (la corrida se interrumpió)' : ''));
    } else {
      if (term.caidaFpsPct != null && term.caidaFpsPct > BANCO_UMBRAL.caidaFpsMax) {
        gana = false;
        motivos.push('el teléfono se frena: ' + term.caidaFpsPct +
          ' % menos de fotogramas al quinto minuto (tope ' + BANCO_UMBRAL.caidaFpsMax + ' %)');
      }
      if (term.bateriaPct == null) {
        gana = false;
        motivos.push('batería no medida en este teléfono (Safari no la publica): ' +
          'hay que anotarla a mano antes y después, o no cuenta');
      } else if (term.bateriaPct > BANCO_UMBRAL.bateriaMax) {
        gana = false;
        motivos.push('batería: ' + term.bateriaPct + ' % en 5 minutos (tope ' +
          BANCO_UMBRAL.bateriaMax + ' %)');
      }
      if (term.calor === 'quema') {
        gana = false;
        motivos.push('el asesor reportó que el teléfono quema al terminar');
      }
    }

    return { estado: gana ? 'gana' : 'no_gana', motivos: motivos };
  }

  /* Los dos teléfonos que hay que medir. No es una lista de las que existen:
     es la lista de las que TIENEN que estar. 21-sep-2026, probándolo en el
     navegador: con sólo el Android cargado el veredicto decía «entra» tan
     tranquilo, porque `iphone` no aparecía en el objeto y no había nada que
     contar como «sin datos». La regla existía —sin los dos no se decide— y se
     saltaba sola por no estar escrita como una ausencia. */
  var BANCO_PLATAFORMAS = ['android', 'iphone'];

  function bancoVeredicto(plataformas) {
    var dadas = plataformas || {};
    var nombres = Object.keys(dadas).slice();
    BANCO_PLATAFORMAS.forEach(function (k) { if (nombres.indexOf(k) < 0) nombres.push(k); });
    var porPlata = {}, gana = 0, noGana = 0, sinDatos = 0;
    nombres.forEach(function (k) {
      var v = bancoVeredictoPlataforma(dadas[k]);
      porPlata[k] = v;
      if (v.estado === 'gana') gana++;
      else if (v.estado === 'no_gana') noGana++;
      else sinDatos++;
    });

    var estado, resumen;
    if (!nombres.length || sinDatos === nombres.length) {
      estado = 'sin_datos';
      resumen = 'Todavía no hay con qué decidir.';
    } else if (sinDatos) {
      /* Medido en Android y no en iPhone no es medio veredicto: el iPhone es
         justo el caso difícil (Safari no trae BarcodeDetector nativo y todo
         cae sobre ZXing-WASM). Decidir sin él sería decidir sin el dato que
         importa. */
      estado = 'sin_datos';
      resumen = 'Falta medir: ' + nombres.filter(function (k) {
        return porPlata[k].estado === 'sin_datos';
      }).join(', ') + '. Sin los dos no se decide.';
    } else if (noGana === 0) {
      estado = 'entra';
      resumen = 'El escaneo continuo gana en todos los teléfonos medidos.';
    } else if (gana === 0) {
      estado = 'no_entra';
      resumen = 'El escaneo continuo NO gana. Se queda el flujo de foto.';
    } else {
      estado = 'parcial';
      resumen = 'Gana en ' + nombres.filter(function (k) { return porPlata[k].estado === 'gana'; }).join(', ') +
        ' y no en ' + nombres.filter(function (k) { return porPlata[k].estado === 'no_gana'; }).join(', ') +
        '. Eso son dos caminos que mantener en el paso 1: lo decide Ángel, no el umbral.';
    }
    return { estado: estado, resumen: resumen, plataformas: porPlata };
  }

  /* ── 4-bis · Juntar varios teléfonos ────────────────────
     Cada teléfono manda su ficha y se juntan por sistema. Dos reglas, las dos
     conservadoras a propósito:

     · Los intentos se SUMAN. Ocho de un Android y ocho de otro son dieciséis
       intentos de Android, que es justo lo que se quiere saber: cómo va en
       los teléfonos del equipo, no en el mejor de ellos.
     · De las corridas térmicas se queda LA PEOR, no el promedio. Promediar
       un teléfono que aguanta con uno que se arrastra da un número que no le
       pasa a nadie, y el asesor que se queda con el que se arrastra es el que
       va a dejar de usar la app. Si ninguna sirve, se pasa la primera tal
       cual para que el veredicto diga que falta la térmica. */
  function _malaTermica(t) {
    if (!t) return -1;
    var p = 0;
    if (t.caidaFpsPct != null) p += t.caidaFpsPct;
    if (t.bateriaPct != null) p += t.bateriaPct * 5;
    if (t.calor === 'quema') p += 1000;
    else if (t.calor === 'caliente') p += 100;
    return p;
  }

  function bancoAgrupar(fichas) {
    var porPlata = {};
    (fichas || []).forEach(function (f) {
      if (!f || !f.plataforma) return;
      var k = f.plataforma;
      if (!porPlata[k]) porPlata[k] = { intentos: [], termicos: [] };
      porPlata[k].intentos = porPlata[k].intentos.concat(f.intentos || []);
      if (f.termico) {
        var t = f.termico;
        /* El calor lo contesta el asesor al terminar y se guarda junto a la
           ficha; si la corrida no lo trae encima, se toma de ahí. Sin esto,
           «quema» no llegaría nunca al veredicto. */
        if (t.calor == null && f.calor != null) t = Object.assign({}, t, { calor: f.calor });
        porPlata[k].termicos.push(t);
      }
    });
    var out = {};
    Object.keys(porPlata).forEach(function (k) {
      var g = porPlata[k];
      var buenas = g.termicos.filter(function (t) { return t && t.suficiente; });
      var elegidas = buenas.length ? buenas : g.termicos;
      var peor = null;
      elegidas.forEach(function (t) {
        if (peor === null || _malaTermica(t) > _malaTermica(peor)) peor = t;
      });
      out[k] = {
        foto: bancoResumen(g.intentos, 'foto'),
        continuo: bancoResumen(g.intentos, 'continuo'),
        termico: peor
      };
    });
    return out;
  }

  /* ── 5 · El código de barras de prueba (Code 39) ────────
     El bloque 0 del banco mide cuánto tarda el teléfono en decodificar UN
     fotograma, y para eso hace falta un código que no dependa de tener una
     caja a mano ni de dar permiso de cámara. Se dibuja aquí.

     Code 39 y no Code 128 porque cabe en una tabla legible: cada carácter son
     nueve elementos —cinco barras y cuatro espacios— de los que exactamente
     tres son anchos, y no lleva dígito de control. La app ya lo acepta
     (`FORMATOS` incluye `code_39`).

     La tabla se escribe a mano, así que la prueba la audita: nueve elementos,
     tres anchos y ningún patrón repetido. Un patrón duplicado no daría error
     —daría OTRA LETRA, leída con toda confianza. */
  var BANCO_C39 = {
    '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
    '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
    '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
    'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw', 'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw',
    'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn', 'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn',
    'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn', 'K': 'wnnnnnnww', 'L': 'nnwnnnnww',
    'M': 'wnwnnnnwn', 'N': 'nnnnwnnww', 'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn',
    'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn', 'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn',
    'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw', 'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw',
    'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
    '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'
  };

  /* Devuelve la lista de elementos {barra, modulos} lista para dibujar, con
     el `*` de apertura y cierre y el espacio estrecho entre caracteres.
     Devuelve null si el texto trae algo que Code 39 no sabe escribir: mejor
     no dibujar nada que dibujar un código que dice otra cosa. */
  function bancoCode39(texto) {
    var t = String(texto || '').toUpperCase();
    if (!t) return null;
    var chars = ('*' + t + '*').split('');
    var fuera = chars.filter(function (c) { return !BANCO_C39[c]; });
    if (fuera.length) return null;
    var out = [];
    chars.forEach(function (c, i) {
      var pat = BANCO_C39[c];
      for (var j = 0; j < pat.length; j++) {
        out.push({ barra: j % 2 === 0, modulos: pat[j] === 'w' ? 3 : 1 });
      }
      if (i < chars.length - 1) out.push({ barra: false, modulos: 1 });  // separador
    });
    return out;
  }

  var api = {
    BANCO_CONFIRMA: BANCO_CONFIRMA,
    BANCO_MIN_INTENTOS: BANCO_MIN_INTENTOS,
    BANCO_UMBRAL: BANCO_UMBRAL,
    BANCO_C39: BANCO_C39,
    BANCO_PLATAFORMAS: BANCO_PLATAFORMAS,
    bancoAcepta: bancoAcepta,
    bancoConfirmarInicio: bancoConfirmarInicio,
    bancoConfirmar: bancoConfirmar,
    bancoMediana: bancoMediana,
    bancoPercentil: bancoPercentil,
    bancoResumen: bancoResumen,
    bancoTermico: bancoTermico,
    bancoAgrupar: bancoAgrupar,
    bancoVeredictoPlataforma: bancoVeredictoPlataforma,
    bancoVeredicto: bancoVeredicto,
    bancoCode39: bancoCode39
  };

  Object.keys(api).forEach(function (k) { raiz[k] = api[k]; });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
