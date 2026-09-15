/* ============================================================
   Admin: tener sesión no es mandar en esta tienda
   ============================================================
   15-sep-2026. Corre en cada commit desde `verificar.py`.

   `verificarAcceso()` abría Admin con CUALQUIER sesión de Supabase abierta:

       const { data } = await sb.auth.getSession();
       if (data && data.session) return { ok:true, via:'sesión de gerente' };

   Y la sesión, como el resto de `localStorage`, es POR ORIGEN: todo lo que se
   publica bajo el mismo usuario de GitHub Pages la comparte. O sea que la
   sesión del tablero multi-tienda abría el Admin de la 1217 — el gerente de
   cualquier otra tienda de la red entraba tecleando la URL, sin ningún error.

   Es el mismo agujero que se cerró en el horario el 4-ago (`horario_sesion_ajena.js`)
   y se cierra igual: quién manda lo dice el servidor, `admin_de`.

   Lo que más importa de estos casos NO es el que deja fuera al de otra tienda:
   es que el subgerente y el gerente SIGAN entrando, incluso cuando la RPC no
   contesta. Una guardia que además cierra la puerta a quien tiene que pasar se
   quita a la semana, y entonces no queda ninguna.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'admin.html'), 'utf8');

const { crearEntorno } = require('./dom.js');

const STORE = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'tok', vendedores:[] };
/* Inventado: el repo es público. */
const GERENTE = { empno:'900001', nombre:'ANA GERENTE', puesto:'Gerente de Tienda', admin:true };

/* `sesion`   – hay sesión de Supabase abierta
   `mandaAqui`– lo que contesta admin_de: true, false, o 'error' para la RPC caída
   `puedeAdm` – lo que contesta puede_admin para el número de la ficha  */
function supaFalso(o, llamadas){
  return { createClient: () => ({
    auth: { getSession: async () => ({ data:{ session: o.sesion ? { user:{ id:'uid' } } : null },
                                       error:null }) },
    rpc: async (nombre, args) => {
      llamadas.push(nombre);
      if(nombre === 'admin_de'){
        return o.mandaAqui === 'error'
          ? { data:null, error:{ message:'sin red' } }
          : { data: o.mandaAqui === true, error:null };
      }
      if(nombre === 'puede_admin') return { data: o.puedeAdm === true, error:null };
      return { data:null, error:null };
    },
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: async () => ({ data:[], error:null }) }) }) }) })
  })};
}

async function abrir(o){
  const llamadas = [];
  const ls = { hes1217_store: JSON.stringify(STORE) };
  if(o.ficha) ls.hes1217_empleado = JSON.stringify(o.ficha);
  const ent = crearEntorno({ html, ruta:'/t/admin.html', ls,
                             extras:{ supabase: supaFalso(o, llamadas) } });
  if(ent.err) return { error: ent.err };
  const r = await ent.correr('verificarAcceso()');
  return { ent, llamadas, r };
}

(async () => {
  const fallos = [];
  const ok = (t, c, extra) => { if(!c) fallos.push(t + (extra ? ' -> ' + extra : '')); };

  /* ── 1 · La sesión de OTRA tienda se queda fuera ─────────────────────── */
  {
    const r = await abrir({ sesion:true, mandaAqui:false, ficha:null });
    ok('la sesión ajena no abre Admin', r.r && r.r.ok !== true, JSON.stringify(r.r));
    ok('y se le preguntó al servidor', r.llamadas.indexOf('admin_de') >= 0,
       JSON.stringify(r.llamadas));
  }

  /* ── 2 · La sesión de ESTA tienda entra ─────────────────────────────── */
  {
    const r = await abrir({ sesion:true, mandaAqui:true, ficha:null });
    ok('el gerente de esta tienda entra', r.r && r.r.ok === true, JSON.stringify(r.r));
    ok('y por su sesión', r.r && /sesión/.test(r.r.via || ''), JSON.stringify(r.r));
  }

  /* ── 3 · Sesión ajena, pero número con permiso ──────────────────────── */
  {
    /* El teléfono compartido del mostrador, con la sesión de otra tienda abierta
       de una visita, y el subgerente entrando con su número. La guardia nueva no
       puede dejarlo fuera: su permiso no tiene nada que ver con esa sesión. */
    const r = await abrir({ sesion:true, mandaAqui:false, puedeAdm:true, ficha:GERENTE });
    ok('el número con permiso entra aunque la sesión sea ajena',
       r.r && r.r.ok === true, JSON.stringify(r.r));
    ok('y entra por su número', r.r && /número/.test(r.r.via || ''), JSON.stringify(r.r));
  }

  /* ── 4 · La RPC caída no deja fuera a quien sí puede ────────────────── */
  {
    const r = await abrir({ sesion:true, mandaAqui:'error', puedeAdm:true, ficha:GERENTE });
    ok('con admin_de caído se entra por el número', r.r && r.r.ok === true, JSON.stringify(r.r));
  }

  /* ── 5 · La RPC caída tampoco abre la puerta sola ───────────────────── */
  {
    /* Lo contrario del caso 4 y la otra mitad de la misma decisión: no poder
       comprobar no puede significar «pasa». */
    const r = await abrir({ sesion:true, mandaAqui:'error', ficha:null });
    ok('sin forma de comprobar y sin número, no se entra',
       r.r && r.r.ok !== true, JSON.stringify(r.r));
  }

  /* ── 6 · Sin sesión y sin permiso: como siempre ─────────────────────── */
  {
    const r = await abrir({ sesion:false, puedeAdm:false, ficha:GERENTE });
    ok('el número sin permiso no entra', r.r && r.r.ok !== true, JSON.stringify(r.r));
    ok('y se le dice que es de permisos, no de conexión',
       r.r && r.r.motivo === 'sin_permiso', JSON.stringify(r.r));
  }

  if(fallos.length){
    console.log('admin · sesión ajena: ' + fallos.length + ' fallo(s)');
    fallos.forEach(f => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('admin · sesión ajena: la sesión de otra tienda no abre Admin, '
            + 'y el número con permiso entra igual (6 casos)');
})();
