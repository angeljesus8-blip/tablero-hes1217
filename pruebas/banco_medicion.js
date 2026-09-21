/* ============================================================
   Banco de escaneo: que el veredicto no se pueda ablandar
   ============================================================
   Corre en cada commit desde `verificar.py`.

   `banco_escaneo.html` mide si el escaneo con cámara en vivo le gana al
   flujo de foto en los teléfonos del equipo. Lo que se prueba aquí NO es la
   cámara —eso hay que ir a medirlo a piso— sino lo que decide con lo medido,
   que es donde un banco se vuelve inútil sin dar error:

     · una mediana de dos intentos tiene la misma pinta que una de veinte;
     · «0 % de fallos» sale igual si el modo va perfecto que si nadie lo probó;
     · el iPhone no publica el gasto de batería, y un hueco se lee como un cero,
       que es la mejor nota posible sacada de no haber medido nada;
     · medir Android y dar el veredicto es decidir sin el caso difícil, que es
       justo Safari, donde no hay BarcodeDetector nativo y todo cae en ZXing.

   Cada bloque de abajo lleva su cebo: un dato que DEBERÍA colarse si el
   umbral estuviera escrito de la manera cómoda. Si alguno deja de morder, es
   que alguien aflojó la regla.
   ============================================================ */
'use strict';
const B = require('../banco_escaneo.js');

const fallos = [];
const mal = m => fallos.push(m);

/* Un intento tal como lo anota la pantalla. */
const foto = (ms, ok, via) => ({ modo: 'foto', ok: ok !== false, ms: ms, via: via || 'codigo' });
const cont = (ms, ok) => ({ modo: 'continuo', ok: ok !== false, ms: ms, via: null });

/* Lista de N intentos de un modo, todos del mismo tiempo salvo los fallos. */
function lote(modo, n, ms, nFallos, via) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const esFallo = i < (nFallos || 0);
    out.push(modo === 'foto'
      ? { modo: 'foto', ok: !esFallo, ms: esFallo ? null : ms, via: esFallo ? null : (via || 'codigo') }
      : { modo: 'continuo', ok: !esFallo, ms: esFallo ? null : ms, via: null });
  }
  return out;
}

/* Muestras de la prueba térmica: `min` minutos, una cada 10 s. */
function termicas(min, fpsIni, fpsFin, bateriaIni, bateriaFin) {
  const n = Math.round(min * 6), out = [];
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0;
    out.push({
      t: i * 10000,
      fps: fpsIni + (fpsFin - fpsIni) * k,
      decodMs: 1000 / (fpsIni + (fpsFin - fpsIni) * k),
      bateria: bateriaIni == null ? null : bateriaIni + (bateriaFin - bateriaIni) * k
    });
  }
  return out;
}

/* Una plataforma que gana holgadamente por los cuatro lados. Los casos de
   abajo parten de aquí y estropean UNA cosa cada uno: así el que falla dice
   exactamente qué umbral dejó de morder. */
function plataformaQueGana(cambios) {
  const base = {
    foto: B.bancoResumen(lote('foto', 8, 6000, 1), 'foto'),
    continuo: B.bancoResumen(lote('continuo', 8, 2500, 1), 'continuo'),
    termico: B.bancoTermico(termicas(5, 22, 20, 74, 70), false)
  };
  return Object.assign(base, cambios || {});
}

/* ── 1 · La doble lectura ────────────────────────────────── */
(function () {
  const correr = (pares) => {
    let e = B.bancoConfirmarInicio(), veces = 0, valor = null;
    pares.forEach(p => {
      e = B.bancoConfirmar(e, p[0], p[1]);
      if (e.confirmado) { veces++; valor = e.valor; }
    });
    return { veces, valor };
  };

  let r = correr([['ABC123', 'code_128'], ['ABC123', 'code_128']]);
  if (r.veces !== 1 || r.valor !== 'ABC123') mal('doble: dos lecturas iguales no confirmaron');

  // CEBO · entre dos lecturas buenas SIEMPRE hay fotogramas movidos que no
  // decodifican nada. Si el hueco reiniciara, el continuo no confirmaría casi
  // nunca y el banco culparía al teléfono de un fallo del medidor.
  r = correr([['ABC123', 'code_128'], ['', ''], [null, 'code_128'], ['ABC123', 'code_128']]);
  if (r.veces !== 1) mal('doble: un fotograma vacío reinició la cuenta');

  // CEBO · la caja de al lado. Dos códigos alternándose no son una lectura.
  r = correr([['AAA', 'code_128'], ['BBB', 'code_128'], ['AAA', 'code_128'], ['BBB', 'code_128']]);
  if (r.veces !== 0) mal('doble: dos códigos distintos alternándose dieron una confirmación');

  // Una vez bueno, no se dispara otra vez: la caja sigue delante de la cámara.
  r = correr([['AAA', 'code_128'], ['AAA', 'code_128'], ['AAA', 'code_128'], ['AAA', 'code_128']]);
  if (r.veces !== 1) mal('doble: confirmó ' + r.veces + ' veces el mismo código');

  // CEBO · un QR leído dos veces no es un número de serie (mismo candado que
  // `routeCode`). Y tampoco reinicia: es ruido, no contradicción.
  r = correr([['https://x', 'qr_code'], ['https://x', 'qr_code']]);
  if (r.veces !== 0) mal('doble: un QR leído dos veces pasó como serie');
  r = correr([['AAA', 'code_128'], ['https://x', 'qr_code'], ['AAA', 'code_128']]);
  if (r.veces !== 1) mal('doble: un QR entre dos lecturas buenas reinició la cuenta');

  r = correr([[' ABC ', 'code_39'], ['ABC', 'code_39']]);
  if (r.veces !== 1) mal('doble: el mismo código con espacios contó como otro');

  let e = B.bancoConfirmar(null, 'AAA', 'code_128');
  e = B.bancoConfirmar(e, 'AAA', 'code_128');
  if (!e.confirmado) mal('doble: un estado nulo de arranque no confirma');
})();

/* ── 2 · Resumen de intentos ─────────────────────────────── */
(function () {
  // CEBO · el modo que nadie probó. Cero fallos de cero intentos es la nota
  // más alta posible sacada de la nada: tiene que salir «sin datos», no 0 %.
  const vacio = B.bancoResumen([], 'continuo');
  if (vacio.fallosPct !== null) mal('resumen: 0 intentos reportan ' + vacio.fallosPct + ' % de fallos');
  if (vacio.mediana !== null) mal('resumen: 0 intentos dieron una mediana');
  if (vacio.suficiente) mal('resumen: 0 intentos se dieron por suficientes');

  const cinco = B.bancoResumen(lote('foto', 5, 4000, 0), 'foto');
  if (cinco.suficiente) mal('resumen: 5 intentos pasaron el mínimo de ' + B.BANCO_MIN_INTENTOS);

  const pocosOk = B.bancoResumen(lote('foto', 8, 4000, 6), 'foto');
  if (pocosOk.suficiente) mal('resumen: 8 intentos con sólo 2 lecturas buenas se dieron por suficientes');

  // CEBO · un fallo no tiene tiempo, y meterlo como 0 ms bajaría la mediana:
  // el modo que MENOS lee saldría como el más rápido.
  const conFallos = B.bancoResumen(
    [foto(5000), foto(5000), foto(5000), foto(5000), { modo: 'foto', ok: false, ms: 0 }, { modo: 'foto', ok: false, ms: null }],
    'foto');
  if (conFallos.mediana !== 5000) mal('resumen: los fallos arrastraron la mediana a ' + conFallos.mediana);
  if (conFallos.fallos !== 2) mal('resumen: contó ' + conFallos.fallos + ' fallos en vez de 2');
  if (conFallos.fallosPct !== 33.3) mal('resumen: el % de fallos salió ' + conFallos.fallosPct);

  const ocr = B.bancoResumen([foto(9000, true, 'ocr'), foto(3000, true, 'codigo'),
    { modo: 'foto', ok: false, ms: null, via: 'ocr' }], 'foto');
  if (ocr.porOcr !== 1) mal('resumen: contó ' + ocr.porOcr + ' lecturas por OCR en vez de 1');

  if (B.bancoMediana([1, 2, 3, 4]) !== 3) mal('mediana: con par de datos no promedia los centrales');
  if (B.bancoMediana([]) !== null) mal('mediana: una lista vacía devolvió un número');
})();

/* ── 3 · La prueba térmica ───────────────────────────────── */
(function () {
  const cortada = B.bancoTermico(termicas(5, 22, 12, 80, 74), true);
  if (cortada.suficiente) mal('térmica: una corrida interrumpida se dio por buena');

  const corta = B.bancoTermico(termicas(2, 22, 20, 80, 78), false);
  if (corta.suficiente) mal('térmica: dos minutos pasaron como cinco');

  // CEBO · Safari no publica la batería. Un hueco NO es un cero.
  const iphone = B.bancoTermico(termicas(5, 20, 18, null, null), false);
  if (iphone.bateriaPct !== null) mal('térmica: sin API de batería reportó ' + iphone.bateriaPct + ' %');
  if (!iphone.suficiente) mal('térmica: 5 minutos sin batería no cuentan como corrida hecha');

  const caida = B.bancoTermico(termicas(5, 20, 8, 90, 84), false);
  if (caida.caidaFpsPct == null || caida.caidaFpsPct < 40) {
    mal('térmica: 20→8 fps se reportó como una caída de ' + caida.caidaFpsPct + ' %');
  }
  if (Math.round(caida.bateriaPct) !== 6) mal('térmica: 90→84 % dio ' + caida.bateriaPct);

  const revueltas = termicas(5, 20, 10, 90, 85).slice().reverse();
  const ordenada = B.bancoTermico(revueltas, false);
  if (ordenada.caidaFpsPct == null || ordenada.caidaFpsPct <= 0) {
    mal('térmica: con las muestras desordenadas la caída salió ' + ordenada.caidaFpsPct);
  }
})();

/* ── 4 · El veredicto ────────────────────────────────────── */
(function () {
  const v = (plats) => B.bancoVeredicto(plats).estado;
  /* Los umbrales se comprueban TELÉFONO POR TELÉFONO. Mirar sólo el veredicto
     global aquí escondería el fallo: con un Android roto y un iPhone bueno el
     global es «parcial» —que es lo correcto— y una comprobación contra
     «no_entra» pasaría por el motivo equivocado. */
  const vp = (plat) => B.bancoVeredictoPlataforma(plat).estado;

  const gana = plataformaQueGana();
  if (v({ android: gana, iphone: plataformaQueGana() }) !== 'entra') {
    mal('veredicto: ganando por los cuatro lados en los dos teléfonos, no dijo «entra»');
  }

  // CEBO · la mejora que se nota en la hoja y no en el piso.
  const pocoRel = plataformaQueGana({ continuo: B.bancoResumen(lote('continuo', 8, 5500, 1), 'continuo') });
  if (vp(pocoRel) !== 'no_gana') mal('veredicto: un 8 % más rápido pasó como victoria');

  // CEBO · el porcentaje grande sobre un tiempo chico. 45 % de 1.8 s son
  // 0.8 s: nadie los nota de pie y con el cliente enfrente.
  const pocoAbs = plataformaQueGana({
    foto: B.bancoResumen(lote('foto', 8, 1800, 1), 'foto'),
    continuo: B.bancoResumen(lote('continuo', 8, 1000, 1), 'continuo')
  });
  if (vp(pocoAbs) !== 'no_gana') mal('veredicto: 0.8 s de ventaja pasaron como victoria por ser un 44 %');

  const falla = plataformaQueGana({ continuo: B.bancoResumen(lote('continuo', 8, 2500, 4), 'continuo') });
  if (vp(falla) !== 'no_gana') mal('veredicto: rápido pero fallando 1 de cada 2 veces, entró igual');

  const bateria = plataformaQueGana({ termico: B.bancoTermico(termicas(5, 22, 20, 80, 68), false) });
  if (vp(bateria) !== 'no_gana') mal('veredicto: 12 % de batería en 5 minutos no frenó nada');

  const frena = plataformaQueGana({ termico: B.bancoTermico(termicas(5, 22, 9, 80, 76), false) });
  if (vp(frena) !== 'no_gana') mal('veredicto: el teléfono cayendo a la mitad de fotogramas entró igual');

  // CEBO · sin prueba térmica no hay verde. No es que salga mal: es que el
  // coste de tener la cámara abierta todo el turno no se midió.
  const sinTermica = plataformaQueGana({ termico: B.bancoTermico([], false) });
  const rSinT = B.bancoVeredictoPlataforma(sinTermica);
  if (rSinT.estado !== 'no_gana') mal('veredicto: sin prueba térmica dio ' + rSinT.estado);
  if (!/térmica/.test(rSinT.motivos.join(' '))) mal('veredicto: no dijo que faltaba la térmica');
  // Y los dos teléfonos sin térmica no son «parcial»: no entra y punto.
  if (v({ android: sinTermica, iphone: plataformaQueGana({ termico: B.bancoTermico([], false) }) }) !== 'no_entra') {
    mal('veredicto: sin térmica en ninguno de los dos, no dijo «no_entra»');
  }

  // CEBO · iPhone sin API de batería y nadie la anotó a mano: no es verde.
  const sinBat = plataformaQueGana({ termico: B.bancoTermico(termicas(5, 20, 19, null, null), false) });
  if (vp(sinBat) !== 'no_gana') mal('veredicto: la batería no medida del iPhone pasó como batería buena');
  if (!/batería no medida/.test(B.bancoVeredictoPlataforma(sinBat).motivos.join(' '))) {
    mal('veredicto: no explicó que la batería del iPhone no se midió');
  }

  // CEBO GORDO · gana en Android, no en iPhone. No es «entra en Android»:
  // son dos caminos que mantener en el paso 1, y eso lo decide Ángel.
  const noGana = plataformaQueGana({ continuo: B.bancoResumen(lote('continuo', 8, 5800, 1), 'continuo') });
  if (v({ android: plataformaQueGana(), iphone: noGana }) !== 'parcial') {
    mal('veredicto: ganando sólo en Android no salió «parcial»');
  }

  // CEBO GORDO · medir Android y decidir es decidir sin el caso difícil.
  const sinMedir = { foto: B.bancoResumen([], 'foto'), continuo: B.bancoResumen([], 'continuo'), termico: B.bancoTermico([], false) };
  const rParcial = B.bancoVeredicto({ android: plataformaQueGana(), iphone: sinMedir });
  if (rParcial.estado !== 'sin_datos') {
    mal('veredicto: con el iPhone sin medir dio «' + rParcial.estado + '» en vez de «sin_datos»');
  }
  if (!/iphone/i.test(rParcial.resumen)) mal('veredicto: no nombró el teléfono que falta medir');

  if (B.bancoVeredicto({}).estado !== 'sin_datos') mal('veredicto: sin teléfonos dio un veredicto');

  /* CEBO GORDO · el iPhone que NO ESTÁ. No vacío: ausente del objeto, que es
     como llega si nadie pegó su resultado. Se vio probando la página en el
     navegador el 21-sep-2026: con sólo el Android cargado, el veredicto decía
     «entra». La regla estaba escrita para un hueco y el caso real era una
     ausencia. */
  const soloAndroid = B.bancoVeredicto({ android: plataformaQueGana() });
  if (soloAndroid.estado !== 'sin_datos') {
    mal('veredicto: midiendo sólo Android dijo «' + soloAndroid.estado + '»');
  }
  if (!/iphone/i.test(soloAndroid.resumen)) mal('veredicto: no dijo que falta el iPhone');
  if (B.bancoVeredicto({ iphone: plataformaQueGana() }).estado !== 'sin_datos') {
    mal('veredicto: midiendo sólo iPhone dio un veredicto');
  }
  // Y un teléfono de más (una tablet, otro sistema) no impide decidir si los
  // dos que importan están medidos.
  const conExtra = B.bancoVeredicto({ android: plataformaQueGana(), iphone: plataformaQueGana(),
    otro: plataformaQueGana() });
  if (conExtra.estado !== 'entra') mal('veredicto: un tercer aparato medido bloqueó la decisión');

  // El aviso del OCR sale aunque el continuo gane: son las lecturas que
  // perdería, y hay que verlas antes de decidir.
  const conOcr = plataformaQueGana({
    foto: B.bancoResumen(lote('foto', 6, 6000, 0, 'ocr').concat(lote('foto', 2, 6000, 0, 'codigo')), 'foto')
  });
  const rOcr = B.bancoVeredicto({ android: conOcr, iphone: plataformaQueGana() });
  if (!/OCR/.test(rOcr.plataformas.android.motivos.join(' '))) {
    mal('veredicto: no avisó de las lecturas que sólo salieron por OCR');
  }
})();

/* ── 4-bis · Juntar varios teléfonos ─────────────────────── */
(function () {
  const ficha = (plataforma, intentos, termico, calor) => ({
    id: 'x' + Math.random(), plataforma, intentos, termico, calor: calor || null
  });

  // Los intentos de dos Android se suman: 4 y 4 no son «pocos datos» dos
  // veces, son 8 intentos de Android.
  const g = B.bancoAgrupar([
    ficha('android', lote('foto', 4, 6000, 0).concat(lote('continuo', 4, 2500, 0)),
      B.bancoTermico(termicas(5, 22, 21, 80, 77), false)),
    ficha('android', lote('foto', 4, 6000, 0).concat(lote('continuo', 4, 2500, 0)),
      B.bancoTermico(termicas(5, 22, 20, 80, 78), false))
  ]);
  if (g.android.foto.n !== 8) mal('agrupar: sumó ' + g.android.foto.n + ' intentos de foto en vez de 8');
  if (!g.android.foto.suficiente) mal('agrupar: 4+4 intentos no alcanzaron el mínimo');

  // CEBO · un teléfono aguanta y el otro se arrastra. Si se promediara, el
  // veredicto saldría con un número que no le pasa a nadie — y el asesor que
  // se queda con el que se arrastra es el que deja de usar la app.
  const mezcla = B.bancoAgrupar([
    ficha('android', [], B.bancoTermico(termicas(5, 22, 21, 80, 78), false)),
    ficha('android', [], B.bancoTermico(termicas(5, 22, 7, 80, 66), false))
  ]);
  if (!mezcla.android.termico || mezcla.android.termico.caidaFpsPct < 40) {
    mal('agrupar: se quedó con la corrida térmica buena y no con la peor');
  }

  // CEBO · «quema» lo contesta el asesor y se guarda junto a la ficha, no
  // dentro de la corrida. Si no se recogiera de ahí, no llegaría al veredicto.
  const quema = B.bancoAgrupar([
    ficha('iphone', [], B.bancoTermico(termicas(5, 20, 19, 80, 78), false), 'templado'),
    ficha('iphone', [], B.bancoTermico(termicas(5, 20, 19, 80, 78), false), 'quema')
  ]);
  if (!quema.iphone.termico || quema.iphone.termico.calor !== 'quema') {
    mal('agrupar: el teléfono que quema no llegó al veredicto');
  }

  // Una corrida interrumpida no desplaza a una buena, pero si es la única se
  // pasa igual: el veredicto tiene que poder decir que falta la térmica.
  const cortada = B.bancoAgrupar([
    ficha('android', [], B.bancoTermico(termicas(5, 22, 5, 80, 70), true)),
    ficha('android', [], B.bancoTermico(termicas(5, 22, 20, 80, 78), false))
  ]);
  if (!cortada.android.termico.suficiente) {
    mal('agrupar: una corrida interrumpida tapó a la buena');
  }
  const soloCortada = B.bancoAgrupar([ficha('android', [], B.bancoTermico(termicas(2, 22, 20, 80, 79), true))]);
  if (soloCortada.android.termico == null) mal('agrupar: sin corrida buena dejó la térmica en nada');
  if (soloCortada.android.termico.suficiente) mal('agrupar: dio por buena la única corrida, que estaba cortada');

  // Un teléfono sin sistema marcado no inventa una plataforma.
  const sinPlata = B.bancoAgrupar([{ id: 'z', plataforma: '', intentos: lote('foto', 8, 5000, 0) }]);
  if (Object.keys(sinPlata).length) mal('agrupar: una ficha sin sistema creó una plataforma');
  if (Object.keys(B.bancoAgrupar([])).length) mal('agrupar: sin fichas devolvió plataformas');
})();

/* ── 5 · La tabla de Code 39, auditada ───────────────────── */
(function () {
  /* La tabla se escribió a mano. Un patrón con un elemento de más no dibuja
     nada raro: dibuja OTRA LETRA, que ZXing lee con toda confianza, y el
     bloque 0 del banco mediría la velocidad leyendo algo que no es lo que se
     escribió. Por eso se audita en vez de confiar. */
  function auditar(tabla) {
    const quejas = [], vistos = {};
    Object.keys(tabla).forEach(c => {
      const p = tabla[c];
      if (p.length !== 9) quejas.push(c + ': ' + p.length + ' elementos');
      const anchos = (p.match(/w/g) || []).length;
      if (anchos !== 3) quejas.push(c + ': ' + anchos + ' elementos anchos');
      if (vistos[p]) quejas.push(c + ' y ' + vistos[p] + ' comparten patrón');
      vistos[p] = c;
    });
    return quejas;
  }

  const quejas = auditar(B.BANCO_C39);
  if (quejas.length) mal('code39: ' + quejas.join('; '));
  if (Object.keys(B.BANCO_C39).length < 38) mal('code39: la tabla no cubre dígitos y letras');

  // META-CEBO · el auditor de arriba tiene que morder. Se le da una tabla con
  // una `Z` copiada de la `Y`: si dijera que está bien, las comprobaciones de
  // este bloque serían decorado.
  const corrupta = Object.assign({}, B.BANCO_C39, { 'Z': B.BANCO_C39['Y'] });
  if (!auditar(corrupta).length) mal('code39: el auditor no detecta dos letras con el mismo patrón');
  const larga = Object.assign({}, B.BANCO_C39, { 'Z': 'nwwnwnnnnn' });
  if (!auditar(larga).length) mal('code39: el auditor no detecta un patrón de 10 elementos');

  const barras = B.bancoCode39('AB');
  // 4 caracteres (*AB*) × 9 elementos + 3 separadores
  if (!barras || barras.length !== 39) mal('code39: "AB" dio ' + (barras ? barras.length : 'null') + ' elementos');
  if (!barras[0].barra) mal('code39: no empieza por barra');
  if (!barras[barras.length - 1].barra) mal('code39: no termina en barra');

  // CEBO · un carácter que Code 39 no sabe escribir. Mejor no dibujar nada
  // que dibujar un código que dice otra cosa.
  if (B.bancoCode39('AB#1') !== null) mal('code39: aceptó un carácter que no sabe escribir');
  if (B.bancoCode39('') !== null) mal('code39: aceptó un texto vacío');
  if (B.bancoCode39('ab') === null) mal('code39: no aceptó minúsculas (se pasan a mayúscula)');
})();

if (fallos.length) {
  console.log('banco: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('banco de escaneo: el veredicto no se ablanda — 5 bloques, cebos incluidos');
