/* ============================================================
   Entrar con el correo deja la MISMA sesión que entrar con el número
   ============================================================
   15-sep-2026. Corre en cada commit desde `verificar.py`.

   La puerta del correo es la que menos se prueba y la que más veces ha dado un
   resultado distinto al de la puerta del número, siempre sin error a la vista:
   `hoja_auth` (dos días), el puesto que `vincular_mi_cuenta` no devolvía
   (Resurtir), y las comisiones del gerente (MAPA, cadena 1-ter). Cada vez se
   arregló el caso concreto; nunca hubo una prueba de esta función.

   Lo que se vigila aquí es lo que se rompe en silencio:

     1. que el dueño recoja su ficha si la tiene — sin ella entra sin número y
        cada pantalla que identifica por número lo trata como a un desconocido
     2. que registrar su correo NO pueda degradarlo a asesor en su propia
        tienda: `esDuena` manda sobre el `admin` de la ficha
     3. que una ficha de OTRA tienda no se guarde como si fuera de ésta
     4. que sin ficha todo siga exactamente como estaba
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

/* Inventados: el repo es público. Importa la forma, no quién es. */
const UID    = 'uid-de-la-sesion';
const TIENDA = { store_id:'1217', nombre:'Angelopolis', ciudad:'Puebla', gas_url:'',
                 gas_token:'tok', sheet_url:'', hoja_auth:'', vendedores:[], sku_reparacion:'' };
const OTRA   = Object.assign({}, TIENDA, { store_id:'1300', nombre:'Otra' });

/* `duena` – la cuenta está en tiendas.user_id (el gerente dueño)
   `ficha` – lo que contesta vincular_mi_cuenta, o null para «sin ficha»  */
function supaFalso(duena, ficha){
  return { createClient: () => ({
    auth: {
      signInWithPassword: async () => ({ data:{ user:{ id: UID } }, error:null }),
      getSession: async () => ({ data:{ session:{ user:{ id: UID } } } })
    },
    from: () => ({
      select: () => ({
        eq: (campo, valor) => ({
          maybeSingle: async () => {
            if(campo === 'user_id')  return { data: duena ? TIENDA : null };
            if(campo === 'store_id') return { data: String(valor) === OTRA.store_id ? OTRA : TIENDA };
            return { data: null };
          }
        })
      })
    }),
    rpc: async (nombre) => (nombre === 'vincular_mi_cuenta'
      ? { data: ficha || { ok:false, error:'sin ficha' }, error:null }
      : { data:null, error:null })
  })};
}

async function entrar(duena, ficha){
  const ent = crearEntorno({ html, ruta:'/t/index.html', ls:{},
                             extras:{ supabase: supaFalso(duena, ficha) } });
  if(ent.err) return { error: ent.err };
  ent.correr('initSB()');
  ent.el('loginEmail').value = 'quien.sea@tienda.mx';
  ent.el('loginPass').value  = 'x';
  await ent.correr('doLogin()');
  return { ent,
           emp:  ent.lsJson('hes1217_empleado'),
           rol:  ent.LS['hes1217_role'],
           store: ent.lsJson('hes1217_store'),
           err:  ent.el('loginErr').textContent || '' };
}

(async () => {
  const fallos = [];
  const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

  /* ── 1 · El dueño CON ficha: entra siendo él ────────────────────────── */
  {
    const r = await entrar(true, { ok:true, store_id:'1217', nombre:'ANA GERENTE',
                                   admin:true, empno:'900001', puesto:'Gerente de Tienda' });
    ok('el dueño con ficha recoge su número', r.emp && r.emp.empno === '900001',
       JSON.stringify(r.emp));
    ok('y su puesto, que es con lo que se decide quién ve qué',
       r.emp && /gerente/i.test(r.emp.puesto || ''), JSON.stringify(r.emp));
    ok('y sigue entrando como gerente', r.rol === 'gerente', r.rol);
    ok('y con su tienda', r.store && r.store.store_id === '1217', JSON.stringify(r.store));
  }

  /* ── 2 · El dueño con ficha SIN admin ───────────────────────────────── */
  {
    /* El caso que hace daño de verdad. Hasta hoy el dueño nunca traía ficha, así
       que `admin` daba igual; en cuanto registra su correo empieza a contar, y
       una ficha sin `admin` marcado lo dejaría de asesor en SU tienda —sin
       Admin y sin Resurtir— por haber hecho justo lo que se le pidió. */
    const r = await entrar(true, { ok:true, store_id:'1217', nombre:'ANA GERENTE',
                                   admin:false, empno:'900001', puesto:'Gerente de Tienda' });
    ok('registrar el correo no degrada al dueño a asesor', r.rol === 'gerente', r.rol);
    ok('y aun así recoge su número', r.emp && r.emp.empno === '900001', JSON.stringify(r.emp));
  }

  /* ── 3 · Una ficha de OTRA tienda ───────────────────────────────────── */
  {
    /* Guardarla sería peor que no tener ninguna: deja en el teléfono un número
       que en esta tienda no es de nadie, y las pantallas que identifican por
       número lo usan sin dudar. */
    const r = await entrar(true, { ok:true, store_id:'1300', nombre:'BENI DE OTRA',
                                   admin:true, empno:'999999', puesto:'Gerente de Tienda' });
    ok('la ficha de otra tienda no se guarda aquí', !r.emp, JSON.stringify(r.emp));
    ok('y el dueño entra igual', r.rol === 'gerente' && r.store.store_id === '1217',
       r.rol + ' / ' + JSON.stringify(r.store && r.store.store_id));
  }

  /* ── 4 · El dueño SIN ficha: como estaba ────────────────────────────── */
  {
    const r = await entrar(true, null);
    ok('sin ficha no se inventa ninguna', !r.emp, JSON.stringify(r.emp));
    ok('y entra como gerente, igual que antes', r.rol === 'gerente', r.rol);
    ok('sin error en pantalla', !r.err, r.err);
  }

  /* ── 5 · Quien NO es dueño: el subgerente por su correo ─────────────── */
  {
    const r = await entrar(false, { ok:true, store_id:'1217', nombre:'BENI SUBGER',
                                    admin:false, empno:'900002', puesto:'Subgerente de Tienda' });
    ok('el subgerente entra por su ficha', r.emp && r.emp.empno === '900002', JSON.stringify(r.emp));
    ok('con su puesto', r.emp && /subgerente/i.test(r.emp.puesto || ''), JSON.stringify(r.emp));
    ok('y su tienda se carga por la ficha', r.store && r.store.store_id === '1217',
       JSON.stringify(r.store));
    /* Su rol NO es gerente: no es la dueña de la tienda y su ficha no tiene
       admin. Lo que ve lo decide el puesto, no esto. */
    ok('y su rol sale de la ficha, no del correo', r.rol === 'asesor', r.rol);
  }

  if(fallos.length){
    console.log('login por correo: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('login por correo: el dueño recoge su ficha sin perder la tienda, '
            + 'y una ficha ajena no entra');
})();
