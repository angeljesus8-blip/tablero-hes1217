/* ============================================================
   Cada quien ve SU comisión
   ============================================================
   6-sep-2026. Corre en cada commit desde `verificar.py`.

   Pedido en piso: «solamente cada integrante pudiera ver el suyo, a excepcion
   del gerente que podria ver el de todos».

   El filtro de verdad vive en el SERVIDOR (`supabase_comisiones_privadas.sql`).
   Lo que se prueba aquí es todo lo que el servidor NO puede cubrir, que es
   justo donde se cuela el dato:

     1. la caché del teléfono, escrita cuando la pantalla enseñaba a todos
     2. el respaldo por Apps Script, que lee una hoja y no sabe filtrar
     3. el rato entre publicar la app y pegar el SQL, con la función vieja
        devolviendo el equipo entero
     4. quién es «yo» cuando se entró con el PIN de la tienda y no con el número

   Los tres primeros son la misma trampa: el filtro parece puesto porque la
   ruta principal filtra, y sigue habiendo puertas que devuelven todo.

   15-sep-2026 · Y una quinta, que es la contraria y también es un fallo: el
   gerente DUEÑO entra con su correo, no tiene ficha de empleado y la pantalla
   lo trataba como a un desconocido —«entra con tu número»— en su propia tienda.
   Se añaden los casos 6 a 8. Lo que se vigila ahí no es solo que vea al equipo,
   sino que lo vea porque el SERVIDOR lo autorizó: si la pantalla pinta el
   equipo pero pregunta con la clave publicable, el servidor real devuelve cero
   filas y lo que se ha construido es una pantalla que miente.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'comisiones.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

/* Nombres inventados: el repo es público. Importa la forma, no quién es. */
const STORE = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'tok-de-64-o-lo-que-sea',
                vendedores:[] };
const GERENTE = { empno:'900001', nombre:'ANA GERENTE',  puesto:'Gerente de Tienda' };
const ASESOR  = { empno:'900003', nombre:'CARO ASESORA', puesto:'Asesor de Tienda' };

/* Lo que devuelve la RPC. Cuatro personas: el caso que hay que apagar. */
const FILAS_TODAS = [
  { empno:'900001', nombre:'ANA GERENTE',  puesto:'Gerente de Tienda',    venta:200000, ppto_pct:35, alcance:120,
    gar_pct:30, gar_pzas:6, gar_elegible:20, gar_monto:9000, periodo:'AGO', periodo_gar:'AGO', actualizado:'2026-09-06T16:00:00Z' },
  { empno:'900002', nombre:'BENI SUBGER',  puesto:'Subgerente de Tienda', venta:150000, ppto_pct:35, alcance:90,
    gar_pct:25, gar_pzas:4, gar_elegible:16, gar_monto:7000, periodo:'AGO', periodo_gar:'AGO', actualizado:'2026-09-06T16:00:00Z' },
  { empno:'900003', nombre:'CARO ASESORA', puesto:'Asesor de Tienda',     venta:100000, ppto_pct:35, alcance:60,
    gar_pct:50, gar_pzas:6, gar_elegible:12, gar_monto:9494, periodo:'AGO', periodo_gar:'AGO', actualizado:'2026-09-06T16:00:00Z' },
  { empno:'900004', nombre:'DANI ASESOR',  puesto:'Asesor de Tienda',     venta:90000,  ppto_pct:35, alcance:55,
    gar_pct:20, gar_pzas:2, gar_elegible:10, gar_monto:3000, periodo:'AGO', periodo_gar:'AGO', actualizado:'2026-09-06T16:00:00Z' }
];

const AJENOS = ['ANA GERENTE', 'BENI SUBGER', 'DANI ASESOR'];
const esperar = () => new Promise(r => setTimeout(r, 30));

/* Abre la pantalla. `servidor` decide qué contesta la RPC:
     'viejo'  – la función de un solo argumento: devuelve a TODOS (es el estado
                real mientras el SQL no esté pegado)
     'nuevo'  – 404 a la firma vieja y filtrado de verdad a la nueva  */
/* La sesión de correo y contraseña, como la sirve supabase-js. `manda` es lo
   que contestará `admin_de` EN EL SERVIDOR: no lo decide el navegador. */
const JWT = 'jwt-de-la-sesion';
function supaFalso(manda){
  return {
    createClient: () => ({
      auth: { getSession: () => Promise.resolve({ data:{ session:{ access_token: JWT,
                                                                   user:{ email:'gerente@tienda.mx' } } } }) },
      rpc: (nombre, args) => Promise.resolve({ data: nombre === 'admin_de' ? manda : null })
    })
  };
}

async function abrir(quien, servidor, cacheVieja, sesion){
  const llamadas = [];
  const fetchFalso = (url, opciones) => {
    let body = {};
    try{ body = JSON.parse((opciones && opciones.body) || '{}'); }catch(e){}
    const auth = ((opciones && opciones.headers) || {}).Authorization || '';
    llamadas.push(Object.assign({ _auth: auth }, body));

    const esNueva = ('p_empno' in body);
    if(servidor === 'nuevo' && !esNueva)
      return Promise.resolve({ ok:false, status:404, json:()=>Promise.resolve({}) });

    let filas = FILAS_TODAS;
    if(servidor === 'nuevo'){
      // Lo que hará el SQL: manda quien lo demuestre, cualquier otro solo su fila.
      const mando = String(body.p_empno || '');
      /* `admin_de(p_store)` mira `auth.uid()`, y `auth.uid()` sale del JWT. Con
         la clave publicable no hay uid y responde que no — aunque la pantalla
         crea que sí. Por eso aquí se mira la cabecera y no lo que diga el body:
         es la diferencia entre proteger y aparentar. */
      const porSesion = (sesion === 'manda') && auth === 'Bearer ' + JWT;
      const gestor = porSesion
        || FILAS_TODAS.some(f => f.empno === mando && /gerente/i.test(f.puesto));
      filas = gestor ? FILAS_TODAS : FILAS_TODAS.filter(f => f.empno === mando);
      if(!body.p_token) filas = [];          // sin token, nada
    }
    return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve(filas) });
  };

  const ls = { hes1217_store: JSON.stringify(STORE) };
  if(quien) ls.hes1217_empleado = JSON.stringify(quien);
  if(cacheVieja){
    /* Tal cual la dejó la versión anterior: el equipo entero, ya mapeado a las
       claves de la pantalla, dentro del teléfono de un asesor. */
    ls['hes1217_comisiones'] = JSON.stringify({
      actualizado:'2026-08-01', periodoComisiones:'JUL', periodoGarantias:'JUL',
      empleados: FILAS_TODAS.map(f => ({ empNo:f.empno, nombre:f.nombre, puesto:f.puesto,
        venta:f.venta, pptoPct:35, alcance:f.alcance, garantiaPct:f.gar_pct,
        garantiaPzas:f.gar_pzas, garantiaElegible:f.gar_elegible, garantiaMonto:f.gar_monto }))
    });
  }

  /* Sin `extras` no hay supabase-js, que es lo que pasa cuando el CDN no
     responde: la pantalla tiene que seguir funcionando y caer del lado seguro. */
  const extras = sesion ? { supabase: supaFalso(sesion === 'manda') } : {};
  const ent = crearEntorno({ html, ruta:'/t/comisiones.html', fetch: fetchFalso, ls, extras });
  if(ent.err) return { error: ent.err };
  return { ent, llamadas, pantalla: () => ent.htmlDe('app'),
           cache: () => ent.lsJson('hes1217_comisiones') };
}

(async () => {
  const fallos = [];
  const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

  /* ── 1 · La caché vieja del teléfono, filtrada al abrir ─────────────── */
  {
    const r = await abrir(ASESOR, 'nuevo', true);
    ok('la pantalla arranca', !r.error, r.error);
    if(!r.error){
      /* Antes de que conteste la nube ya se pinta desde la caché. Si no se
         filtrara ahí, el asesor abre la app sin red y ve el sueldo de todos —y
         el dato seguiría en su teléfono para siempre. */
      const guardada = r.cache();
      ok('la caché se reescribe solo con lo suyo',
         guardada && guardada.empleados.length === 1 && guardada.empleados[0].empNo === '900003',
         JSON.stringify(guardada && guardada.empleados.map(e => e.empNo)));
      await esperar();
      for(const n of AJENOS) ok('no aparece ' + n, r.pantalla().indexOf(n) < 0);
      ok('sí aparece la suya', r.pantalla().indexOf('CARO ASESORA') >= 0, r.pantalla().slice(0, 200));
      ok('y se titula como suya', r.pantalla().indexOf('Tu comisión') >= 0);
    }
  }

  /* ── 2 · Con el SQL sin pegar, la pantalla no la enseña igual ───────── */
  {
    /* El servidor devuelve a los cuatro —es lo que hace hoy—. Es el rato entre
       publicar la app y pegar el SQL, y es cuando el filtro parece puesto. */
    const r = await abrir(ASESOR, 'viejo', false);
    if(!r.error){
      await esperar();
      for(const n of AJENOS) ok('con el SQL viejo tampoco enseña a ' + n, r.pantalla().indexOf(n) < 0,
                                r.pantalla().slice(0, 200));
      ok('y sigue enseñando la suya', r.pantalla().indexOf('CARO ASESORA') >= 0);
    }
  }

  /* ── 3 · El gerente ve al equipo ────────────────────────────────────── */
  {
    const r = await abrir(GERENTE, 'nuevo', false);
    if(!r.error){
      await esperar();
      for(const n of AJENOS) ok('el gerente ve a ' + n, r.pantalla().indexOf(n) >= 0);
      ok('y se titula como equipo', r.pantalla().indexOf('Equipo') >= 0);
    }
  }

  /* ── 4 · Quien entró con el PIN de la tienda ────────────────────────── */
  {
    /* Sin `hes1217_empleado` no se sabe quién es. Enseñarle todo sería el agujero
       más fácil de abrir —basta borrar una clave del localStorage—, y enseñarle
       «no hay comisiones» sería mentira y le haría pedirle al gerente que suba
       algo que ya está subido. */
    const r = await abrir(null, 'nuevo', false);
    if(!r.error){
      await esperar();
      ok('sin número, no se enseña ninguna comisión',
         AJENOS.concat('CARO ASESORA').every(n => r.pantalla().indexOf(n) < 0),
         r.pantalla().slice(0, 200));
      ok('y se le dice que entre con su número',
         r.pantalla().indexOf('número de empleado') >= 0, r.pantalla().slice(0, 200));
    }
  }

  /* ── 5 · Lo que se le pide al servidor ──────────────────────────────── */
  {
    const r = await abrir(ASESOR, 'nuevo', false);
    if(!r.error){
      await esperar();
      const primera = r.llamadas[0] || {};
      ok('se pide con el número de quien mira', primera.p_empno === '900003', JSON.stringify(primera));
      /* El token es lo que saca las comisiones de estar al alcance de cualquiera
         que lea la clave publicable en el HTML. Sin él, la RPC nueva no devuelve
         nada — y sería un fallo mudo: la pantalla se vería «sin datos». */
      ok('y con el token de la tienda', !!primera.p_token, JSON.stringify(primera));
    }
  }

  /* ── 6 · El gerente dueño, que entra con su CORREO ──────────────────── */
  {
    /* No tiene ficha de empleado —su cuenta vive en `tiendas.user_id`—, así que
       llega SIN `hes1217_empleado`: exactamente igual que un desconocido. La
       diferencia la pone la sesión, y quién manda lo dice el servidor. */
    const r = await abrir(null, 'nuevo', false, 'manda');
    if(!r.error){
      await esperar();
      for(const n of AJENOS) ok('el gerente por correo ve a ' + n, r.pantalla().indexOf(n) >= 0,
                                r.pantalla().slice(0, 200));
      ok('y se titula como equipo', r.pantalla().indexOf('Equipo') >= 0);
      ok('ya no se le pide el número', r.pantalla().indexOf('número de empleado') < 0);
      ok('y no se queda en «comprobando»', r.pantalla().indexOf('Comprobando') < 0,
         r.pantalla().slice(0, 200));
      /* Lo que de verdad sostiene el caso: la consulta viaja FIRMADA con la
         sesión. Si fuera con la clave publicable, el servidor no sabría quién
         pregunta y devolvería cero filas — y esta prueba estaría comprobando
         una pantalla que en producción sale vacía. */
      const pedida = r.llamadas.find(l => 'p_empno' in l) || {};
      ok('la consulta se firma con la sesión, no con la clave publicable',
         pedida._auth === 'Bearer ' + JWT, JSON.stringify(pedida._auth));
    }
  }

  /* ── 7 · Una sesión que NO manda en esta tienda ─────────────────────── */
  {
    /* Tener sesión abierta no es mandar aquí: `localStorage` lo comparten todas
       las apps del mismo origen y una sesión de otra tienda llega igual. Es el
       fallo que ya se cerró en el horario (`horario_sesion_ajena.js`), y aquí
       tiene la misma respuesta: manda quien diga `admin_de`, no el navegador. */
    /* Con caché vieja a propósito: es donde se vería. Si la pantalla se fiara de
       «hay sesión» en vez de preguntar, el servidor no le daría una sola fila
       —no manda— pero el teléfono ya tiene guardado el equipo entero de antes, y
       lo pintaría sin que nada fallara. */
    const r = await abrir(null, 'nuevo', true, 'ajena');
    if(!r.error){
      await esperar();
      ok('con sesión ajena no se enseña ninguna comisión',
         AJENOS.concat('CARO ASESORA').every(n => r.pantalla().indexOf(n) < 0),
         r.pantalla().slice(0, 200));
      ok('y tampoco se le deja la caché entera',
         (r.cache() || {}).empleados.length === 0,
         JSON.stringify((r.cache() || {}).empleados));
      ok('y se le dice que entre con su número',
         r.pantalla().indexOf('número de empleado') >= 0, r.pantalla().slice(0, 200));
    }
  }

  /* ── 8 · La caché del teléfono, según quién resulte ser ─────────────── */
  {
    // Del gerente: es suya, y sin señal es lo único que le queda. No se tira.
    const r = await abrir(null, 'nuevo', true, 'manda');
    if(!r.error){
      await esperar();
      const g = r.cache();
      ok('al gerente no se le vacía su caché',
         g && g.empleados.length === FILAS_TODAS.length,
         JSON.stringify(g && g.empleados.map(e => e.empNo)));
    }
  }
  {
    // De quien no se sabe quién es: se limpia, como siempre. Que ahora se
    // pregunte antes no puede convertirse en una excusa para dejarla entera.
    const r = await abrir(null, 'nuevo', true, null);
    if(!r.error){
      await esperar();
      const g = r.cache();
      ok('sin sesión y sin número, la caché se queda vacía',
         g && g.empleados.length === 0,
         JSON.stringify(g && g.empleados.map(e => e.empNo)));
      ok('y no se pinta nada de lo que traía',
         AJENOS.concat('CARO ASESORA').every(n => r.pantalla().indexOf(n) < 0),
         r.pantalla().slice(0, 200));
    }
  }

  if(fallos.length){
    console.log('comisiones · solo la mía: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('comisiones · solo la mía: caché, respaldo y SQL sin pegar — por ninguna de las tres se cuela; '
            + 'y el gerente por correo sí ve al equipo, firmando con su sesión');

})();
