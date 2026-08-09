/* ============================================================
   Captura de Series: quién puede empezar a capturar
   ============================================================
   Corre en cada commit desde `verificar.py`.

   Existe porque esta pantalla dejó tirados a los asesores dos veces
   seguidas (8-ago-2026) y en ninguna de las dos lo vio una prueba: no
   había ninguna. El bloqueo no se ve leyendo el código —depende de qué
   trae la sesión guardada en ESE teléfono— así que hay que ejecutarla con
   cada combinación.

   Cada escenario dice lo que DEBE pasar. Si cambias el comportamiento a
   propósito, cambia aquí lo esperado en el mismo commit.

   Solo se cargan los <script> clásicos: el bloque type="module" (el
   decodificador de códigos de barras) corre aparte en el navegador y su
   `await` de nivel superior no puede mezclarse con estos.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const RUTA = path.join(__dirname, '..', 'captura_series.html');
const html = fs.readFileSync(RUTA, 'utf8');

const bloques = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];
const js = bloques
  .filter(b => !/\ssrc=/.test(b.slice(0, b.indexOf('>'))))
  .filter(b => !/type="module"/.test(b.slice(0, b.indexOf('>'))))
  .map(b => b.slice(b.indexOf('>') + 1, b.lastIndexOf('</script>')))
  .join('\n;\n');

function escenario(store, empleado) {
  const LS = {};
  if (store) LS['hes_store'] = JSON.stringify(store);
  if (empleado) LS['hes_empleado'] = JSON.stringify(empleado);
  const els = {};
  let gateOculto = null, gateHTML = '';
  function el(id) {
    if (!els[id]) els[id] = {
      id, style: {}, dataset: {}, value: '', textContent: '', children: [],
      set innerHTML(v) { if (id === 'gateNames') gateHTML = v; },
      get innerHTML() { return id === 'gateNames' ? gateHTML : ''; },
      classList: {
        add: () => { if (id === 'gate') gateOculto = true; },
        remove: () => { if (id === 'gate') gateOculto = false; },
        toggle() {}, contains() { return false; }
      },
      querySelectorAll: () => [], addEventListener() {}, appendChild() {},
      closest: () => null, focus() {}, remove() {}, onclick: null,
      insertBefore() {}, scrollIntoView() {}
    };
    return els[id];
  }
  const caja = {
    console,
    location: { href: '', search: '', hash: '', pathname: '/t/captura_series.html', replace() {}, reload() {} },
    navigator: { serviceWorker: { addEventListener() {}, ready: { then() { return { catch() {} }; } },
                                  register() { return { catch() {} }; } } },
    document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null,
      createElement: () => el('t' + Math.random()), head: el('head'), body: el('body'),
      readyState: 'complete', addEventListener() {} },
    localStorage: { getItem: k => (k in LS ? LS[k] : null),
      setItem: (k, v) => { LS[k] = String(v); }, removeItem: k => { delete LS[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: () => Promise.reject(new Error('sin red')),
    alert: () => {}, confirm: () => true, prompt: () => null,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
    scrollTo: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} },
    Image: class {}, FileReader: class {}, requestAnimationFrame: () => 0,
    URLSearchParams, TextEncoder, TextDecoder, Date, JSON, Math, RegExp,
    Promise, Array, Object, String, Number, Boolean, Error, Set, Map, isNaN, parseFloat, parseInt,
    encodeURIComponent, decodeURIComponent, btoa: s => Buffer.from(s,'binary').toString('base64'),
  };
  caja.window = caja;
  caja.globalThis = caja;
  vm.createContext(caja);

  let err = null;
  try { vm.runInContext(js, caja, { filename: 'captura.js' }); } catch (e) { err = e.message; }

  if (err) return { error: err };
  const nombres = (gateHTML.match(/gate-name/g) || []).length;
  const resultado = (gateOculto !== false) ? 'captura' : (nombres ? 'elegir' : 'atascado');
  return { resultado, nombres, vendedor: el('vendLabel').textContent,
           tieneSalida: gateHTML.indexOf('index.html') >= 0 };
}

const EQUIPO = ['Arnulfo Gonzalez Arrieta', 'Miguel Angel Garcia Gutierrez', 'Angel de jesus Perea arias'];
const conLista = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'t', vendedores:EQUIPO };
const sinLista = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'t', vendedores:[] };
const EMP      = { empno:'2', nombre:'Miguel Angel Garcia Gutierrez', puesto:'asesor' };
const EMP_FUERA= { empno:'9', nombre:'Alguien Que No Vende', puesto:'gerente' };

/* `captura` = entra directo a capturar.  `elegir` = pregunta con la lista.
   `atascado` = el gate sin nombres; solo se admite cuando de verdad no hay
   forma de saber quién es, y aun así tiene que ofrecer salida. */
const CASOS = [
  ['gerente con todo',                    conLista, EMP,       'captura'],
  ['asesor sin la lista pero con sesion', sinLista, EMP,       'captura'],
  ['empleado que no esta en la lista',    conLista, EMP_FUERA, 'captura'],
  ['con lista y sin saber quien entro',   conLista, null,      'elegir'],
  ['sin lista y sin saber quien entro',   sinLista, null,      'atascado'],
  ['sin sesion de tienda',                null,     null,      'atascado'],
];

const fallos = [];
for(const [titulo, store, emp, espera] of CASOS){
  const r = escenario(store, emp);
  if(r.error){ fallos.push(titulo + ': la pantalla se cae -> ' + r.error); continue; }
  if(r.resultado !== espera){
    fallos.push(titulo + ': esperaba "' + espera + '" y hace "' + r.resultado + '"');
  }
  // Atascado sin salida es lo que dejo a la gente sin poder trabajar
  if(r.resultado === 'atascado' && !r.tieneSalida){
    fallos.push(titulo + ': el gate se queda sin nombres Y SIN SALIDA');
  }
}

if(fallos.length){
  console.log('captura: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('captura: ' + CASOS.length + ' formas de entrar, todas dejan trabajar o explican por que no');
