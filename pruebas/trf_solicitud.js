/* ============================================================
   Pedir piezas a otra tienda: consulta, apartado múltiple y correo
   ============================================================
   Corre en cada commit desde `verificar.py`. Los textos son los que Ángel
   aprobó línea por línea el 24-nov-2026: si cambian, que sea a propósito.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { domFalso } = require('./entorno.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'tablero.html'), 'utf8');
const js = (html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g) || [])
  .map(b => b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')).join('\n;\n');
const el = domFalso();
Object.assign(global, require('../nombres.js'));
const fallos = [];
const ok = (t, c, x) => { if(!c) fallos.push(t + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')); };
vm.runInThisContext(js, { filename:'tablero.html' });
const correr = s => vm.runInThisContext(s);

// ── Textos ──
global.__l = [{ sku:'1', producto:'Uno', piezas:2 }, { sku:'2', producto:'Dos', piezas:1 }];
ok('ASUNTO', correr('TRF_ASUNTO') === 'Solicitud de TRF · 1217 Angelópolis', correr('TRF_ASUNTO'));
ok('CORREO · varios', correr('trfTextoCorreo("1187 Parque Delta", __l, 15)') ===
`Buenas tardes, equipo Parque Delta:

Conforme a lo acordado, solicito su apoyo para generar la siguiente transferencia:

Tienda origen: 1187 Parque Delta
Tienda destino: 1217 Angelópolis

1) SKU 1
   Uno
   Piezas: 2

2) SKU 2
   Dos
   Piezas: 1

Total: 3 piezas

Pongo en copia a nuestro distrital para su conocimiento.

Saludos cordiales.`, correr('trfTextoCorreo("1187 Parque Delta", __l, 15)'));
const uno = correr('trfTextoCorreo("1187 Parque Delta", [__l[1]], 9)');
ok('CORREO · uno solo va sin numerar ni total', /^Buenos días/.test(uno) && /\nSKU 2\nDos\nPiezas: 1\n/.test(uno) && !/Total|1\)/.test(uno), uno);
ok('WA · sin saludo, solo datos', correr('trfTextoWA("", __l)') === '📦 Uno\nSKU 1 · *2 piezas*\n\n📦 Dos\nSKU 2 · *1 pieza*');
ok('WA · saludo arriba', correr('trfTextoWA(" Hola ", [__l[1]])') === 'Hola\n\n📦 Dos\nSKU 2 · *1 pieza*');

// ── Tiendas ──
for(const t of ['Delta', 'parque delta', '1187', 'de la 1187 delta'])
  ok('ORIGEN · ' + t, correr('trfOrigen(' + JSON.stringify(t) + ')') === '1187 Parque Delta');
ok('ORIGEN · acento', correr('trfOrigen("cancun")') === '1393 Las Américas Cancún');
ok('ORIGEN · desconocida se queda igual', correr('trfOrigen("Parque Puebla")') === 'Parque Puebla');
ok('ORIGEN · «galerías» a secas no adivina', correr('trfOrigen("Galerías")') === 'Galerías');

// ── Enlaces ──
ok('URL · saltos CRLF', correr('trfUrl("app","A","x\\ny")') === 'mailto:?subject=A&body=x%0D%0Ay', correr('trfUrl("app","A","x\\ny")'));
ok('URL · web', /^https:\/\/outlook\.office\.com\/mail\/deeplink\/compose\?subject=A&body=/.test(correr('trfUrl("web","A","x")')));

// ── Quién puede, y qué ──
correr('invBySku["S1"]={sku:"S1",producto:"Uno",stock:3,exhibe:0}; invBySku["S2"]={sku:"S2",producto:"Dos",stock:2,exhibe:0}; eolSkuSet.add("S2");');
ok('ACTIVO CON PIEZAS · aparta y consulta', /abrirApartado/.test(correr('botonApartar("S1","Uno",1)')) && /trfAbrir/.test(correr('botonApartar("S1","Uno",1)')));
ok('EOL · ni aparta ni consulta', correr('botonApartar("S2","Dos",1)') === '');
correr('PUEDE_GESTIONAR=false');
ok('ASESOR · no consulta', !/trfAbrir/.test(correr('botonApartar("S1","Uno",1)')) && /abrirApartado/.test(correr('botonApartar("S1","Uno",1)')));
ok('ASESOR · sin bloque de correo', correr('trfBloque()') === '');
correr('PUEDE_GESTIONAR=true');

// ── Pendientes ──
global.__a = (id, o, x) => Object.assign({ id:String(id), sku:'S1', color:'Uno', tipo:'traspaso', origen:o, serie:'', estatus:'Apartado', cliente:'C' }, x);
correr('APARTADOS=[__a(1,"Delta"),__a(2,"1187 Parque Delta"),__a(3,"1207 Parque Lindavista"),__a(4,"Delta",{serie:"X"}),__a(5,"Delta",{estatus:"Cancelado"}),__a(6,"",{}),__a(7,"Delta",{tipo:"preventa"}),__a(8,"Delta")];');
ok('PENDIENTES · agrupa por tienda y quita lo llegado y cancelado',
   correr('JSON.stringify([...trfPendientes()].map(x=>[x[0],x[1].map(a=>a.id)]))') === '[["1187 Parque Delta",["1","2","8"]],["1207 Parque Lindavista",["3"]]]',
   correr('JSON.stringify([...trfPendientes()].map(x=>[x[0],x[1].map(a=>a.id)]))'));
ok('SUMA · tres apartados del mismo SKU = 3 piezas', correr('trfSumar(trfPendientes().get("1187 Parque Delta"))[0].piezas') === 3);

correr('trfMailAbrir("1187 Parque Delta")');
ok('CORREO · varias piezas nacen sin marcar', correr('_trfMail.sel.size') === 0 && el('trfMailTxt').value === '');
correr('trfMailSel("2",true)');
ok('CORREO · solo lo marcado', /Piezas: 1$/m.test(el('trfMailTxt').value), el('trfMailTxt').value);
correr('trfMailAbrir("1207 Parque Lindavista")');
ok('CORREO · una sola nace marcada', correr('_trfMail.sel.size') === 1 && /Lindavista/.test(el('trfMailTxt').value));

// ── Guardado de varias piezas ──
(async () => {
  const prep = filas => {
    correr('APARTADOS=[]; PREVENTA=[]; _apartSku="S1"; _apartCtx={producto:"Uno",precio:10}; _apFilas=' + JSON.stringify(filas));
    el('apCliente').value = 'Cliente'; el('apPromesa').value = '2026-12-01';
  };
  global.__env = []; global.__avisos = [];
  global.alert = m => global.__avisos.push(m);
  const F = (o, s) => ({ origen:o, seguro:!!s, ok:false });
  const D = '1187 Parque Delta', L = '1207 Parque Lindavista';

  prep([F(D, true), F('')]);
  correr('sbEscribir=async function(f,p){ __env.push(p); return {ok:true,id:__env.length}; }');
  await correr('guardarApartado()');
  ok('GUARDAR · sin tienda no manda nada', global.__env.length === 0 && /tienda/.test(global.__avisos[0] || ''));

  prep([F(D, true), F(L)]); global.__avisos = [];
  await correr('guardarApartado()');
  ok('GUARDAR · un apartado por pieza, con su tienda y su seguro',
     JSON.stringify(global.__env.map(p => [p.p_origen, p.p_seguro])) === JSON.stringify([[D, true], [L, false]]), global.__env);

  // Falla la 2ª: la 1ª no se repite al reintentar
  prep([F(D), F(L)]); global.__env = []; global.__avisos = [];
  correr('sbEscribir=async function(f,p){ __env.push(p.p_origen); return __env.length===2 ? null : {ok:true,id:__env.length}; }; sbCall=async function(){ return []; }');
  await correr('guardarApartado()');
  await correr('guardarApartado()');
  ok('REINTENTO · no duplica la que ya quedó', JSON.stringify(global.__env) === JSON.stringify([D, L, L]), global.__env);

  // Se perdió el «ok» pero sí se guardó
  prep([F(D)]); global.__env = []; global.__avisos = [];
  correr('sbEscribir=async function(){ return null; }; sbCall=async function(){ return [{id:77,sku:"S1",cliente:"Cliente",origen:"' + D + '",tipo:"traspaso"}]; }');
  await correr('guardarApartado()');
  ok('OK PERDIDO · se da por guardado', global.__avisos.length === 0, global.__avisos);

  // Preventa: sin tienda sí se guarda
  prep([F('')]); global.__env = []; global.__avisos = [];
  correr('PREVENTA=[{sku:"S1",apartadas:0,quedan:2}]; sbEscribir=async function(f,p){ __env.push(p); return {ok:true,id:1}; }');
  await correr('guardarApartado()');
  ok('PREVENTA · no exige tienda', global.__env.length === 1 && global.__env[0].p_origen === null);

  if(fallos.length){ console.log('FALLAS en trf_solicitud.js:\n  - ' + fallos.join('\n  - ')); process.exit(1); }
  console.log('traspasos: textos, permisos, pendientes por tienda y guardado de varias piezas sin duplicar');
})().catch(e => { console.log('trf_solicitud.js se cayó: ' + (e && e.stack)); process.exit(1); });
