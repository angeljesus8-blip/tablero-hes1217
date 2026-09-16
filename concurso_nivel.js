/* ============================================================
   Concurso ORO y PLATA — calificar un ticket ya leído
   ============================================================
   15-sep-2026. Se apoya en `concurso_ticket.js`, que es quien lee la foto.

     ORO   = Core + Accesorio Huawei + Garantía + TechSmart/Servicio  (los 4)
     PLATA = Core + DOS de esas tres                                  (2 de 3)

   ------------------------------------------------------------
   EL CORE ES OBLIGATORIO; LOS OTROS TRES SON INTERCAMBIABLES
   ------------------------------------------------------------
   Esto se preguntó tres veces a lo largo del 15-sep-2026 y las respuestas
   PARECÍAN contradecirse. No lo hacían, y entender por qué es lo que hace que
   la regla se sostenga:

     1. «band + seguro + mica ya es plata»           → parecía que PLATA no
                                                        exigía accesorio Huawei
     2. «ese ticket NO entra en plata»               → parecía que sí lo exigía
     3. «matepad + seguro + mica sí aplica como      → y aquí se aclara todo
         plata»

   Los casos 1 y 3 son el MISMO ticket cambiando sólo el producto principal, y
   uno califica y el otro no. Lo que los separa no es el accesorio Huawei —no
   lo tiene ninguno de los dos— sino el CORE: una band no es core, un MatePad
   sí. Core son tres cosas y nada más: MatePad, teléfono y MateBook.

   Así que la tabla de la circular dibuja UNA de las tres parejas posibles —la
   que lleva accesorio Huawei— y no las tres:

     Core + Acc Huawei + Garantía            ← la que dibuja la tabla
     Core + Acc Huawei + TechSmart           ← la que dibuja la tabla
     Core + Garantía   + TechSmart           ← la que falta, y es el caso 3

   Queda escrito con las tres preguntas porque el que lea esto dentro de tres
   meses va a encontrar la tabla de la circular diciendo otra cosa, y tiene que
   saber que ya se preguntó y cómo se cerró. No se cambia sin volver a
   preguntar: es la diferencia entre que un ticket cuente o no cuente.

   ------------------------------------------------------------
   POR QUÉ SE BUSCA EL REPARTO Y NO SE CUENTAN ETIQUETAS
   ------------------------------------------------------------
   Hoy ningún producto juega dos papeles: core son tres cosas y todo lo demás
   de Huawei es accesorio. Con los papeles así de separados, buscar el reparto
   da lo mismo que contar cuántos hay de cada clase.

   El buscador se queda igualmente, y por dos razones:

   1. Lo que no se puede simplificar es que cada casilla se lleve un artículo
      DISTINTO. Un ticket con una sola band no es «tiene accesorio Huawei, tiene
      core»: es un artículo que no puede estar en dos sitios. Contar clases sin
      mirar eso daría niveles que no existen.
   2. El criterio de qué es core ya cambió dos veces en un día. Si mañana vuelve
      a admitir que un wearable haga de core cuando es lo principal del ticket,
      aquí no hay que tocar nada: se le añade el papel en `concurso_roles.js` y
      el reparto se encarga.

   Son tres papeles sobre pocos artículos, así que la búsqueda es instantánea.

   ------------------------------------------------------------
   LA GARANTÍA NO GASTA UN ARTÍCULO
   ------------------------------------------------------------
   En el ticket es una línea aparte, con su SKU y su precio (`GARANTIA Y SEGURO
   N AÑOS MAS`), pero para el concurso es una CONDICIÓN del ticket, no uno de
   los artículos que se reparten los papeles.

   Por eso MatePad + mouse Huawei + su seguro es PLATA con sólo DOS artículos:
   el MatePad es core, el mouse es el accesorio Huawei, y la garantía llena la
   tercera casilla sin ocupar a ninguno de los dos.

   Si la garantía compitiera por un papel, ese ticket necesitaría un artículo
   más para llegar a algo que la circular concede con dos.
   ============================================================ */

(function (raiz) {
'use strict';

/* Los cuatro papeles. `ts_serv` es uno solo a propósito: la circular dice
   «Accesorio TechSmart **y/o** Servicio», o sea que llenan la misma casilla y
   dos de ellos no valen más que uno. */
var ROLES = ['core', 'acc_hw', 'ts_serv'];

/* Con artículo delante, para que las frases se lean: «Con un Accesorio Huawei
   habría sido ORO». Sin esto salía «Con accesorio huawei», que es justo el
   detalle que hace que un mensaje parezca de máquina y nadie lo lea. */
var ARTICULO = {
  core:     'un Producto Core',
  acc_hw:   'un Accesorio Huawei',
  ts_serv:  'un Accesorio TechSmart o un Servicio',
  garantia: 'una Garantía'
};

var NOMBRE_ROL = {
  core:     'Producto Core',
  acc_hw:   'Accesorio Huawei',
  ts_serv:  'Accesorio TechSmart o Servicio',
  garantia: 'Garantía'
};

/* ── Buscar una asignación ───────────────────────────────────
   Backtracking: cada rol se lleva un artículo distinto. Devuelve el mapa
   rol → índice de línea, o null si no hay forma.

   Se prueba rol por rol y no artículo por artículo porque los roles son tres y
   los artículos pueden ser doce: se poda antes. */
function asignar(arts, rolesPedidos) {
  var usados = {};
  var mapa = {};

  function paso(k) {
    if (k >= rolesPedidos.length) return true;
    var rol = rolesPedidos[k];
    for (var i = 0; i < arts.length; i++) {
      if (usados[i]) continue;
      if (arts[i].roles.indexOf(rol) < 0) continue;
      usados[i] = true; mapa[rol] = i;
      if (paso(k + 1)) return true;
      usados[i] = false; delete mapa[rol];
    }
    return false;
  }

  return paso(0) ? mapa : null;
}

/* Si hay algún artículo que pueda hacer de `rol`. Sirve para decirle al asesor
   «te faltó un accesorio Huawei» en vez de «no califica», que es la pantalla
   que Ángel pidió para validar. */
function hayCandidato(arts, rol) {
  for (var i = 0; i < arts.length; i++) {
    if (arts[i].roles.indexOf(rol) >= 0) return true;
  }
  return false;
}

/* ------------------------------------------------------------
   CALIFICAR
   ------------------------------------------------------------
   `lineas` son las de `concurso_ticket.js`, cada una ya con su `roles` (array).
   Quien pone los roles es `concurso_roles.js`, que sale de una tabla editable:
   aquí no se decide qué es Core, sólo qué nivel alcanza el ticket. */
function calificar(lineas) {
  lineas = lineas || [];

  var garantias = [], arts = [];
  for (var i = 0; i < lineas.length; i++) {
    var l = lineas[i];
    if (l.es_garantia) { garantias.push(i); continue; }
    arts.push({ i: i, desc: l.desc, sku: l.sku, roles: l.roles || [] });
  }

  var hayGarantia = garantias.length > 0;
  var res = {
    nivel: 'ninguno',            // 'oro' | 'plata' | 'ninguno'
    roles: {},                   // rol → índice de línea
    garantias: garantias,
    porque: '',
    falta: []
  };

  /* Se busca el reparto que llene MÁS casillas, no el primero que funcione.

     Los dos roles de artículo se piden juntos antes que por separado: si los
     dos caben, cualquier reparto que deje uno fuera sería peor. Y si no caben
     juntos, se prueba cada uno solo — puede que sólo haya sitio para uno.

     La garantía no entra en el reparto: no gasta artículo. */
  /* Se busca el reparto que llene MÁS casillas, no el primero que funcione.

     Los dos papeles de artículo se piden juntos antes que por separado: si los
     dos caben, cualquier reparto que deje uno fuera sería peor. Si no caben
     juntos, se prueba cada uno solo — puede que sólo haya sitio para uno. */
  var ambos  = asignar(arts, ['core', 'acc_hw', 'ts_serv']);
  var conHW  = ambos || asignar(arts, ['core', 'acc_hw']);
  var conTS  = ambos || asignar(arts, ['core', 'ts_serv']);
  var mejor  = ambos || conHW || conTS || asignar(arts, ['core']);

  function fijar(mapa) {
    if (!mapa) return;
    for (var r in mapa) if (mapa.hasOwnProperty(r)) res.roles[r] = arts[mapa[r]].i;
  }

  /* Sin core no hay nada que discutir, por grande que sea el ticket. Es lo que
     deja fuera una venta de band, watch o audífonos: core son tres cosas. */
  if (!mejor) {
    res.falta = ['core'];
    res.porque = 'No califica: falta un Producto Core — sólo cuentan MatePad, ' +
                 'teléfono y MateBook.';
    return res;
  }

  fijar(mejor);

  var tieneHW = !!conHW;
  var tieneTS = !!conTS;
  var acompanantes = (tieneHW ? 1 : 0) + (tieneTS ? 1 : 0) + (hayGarantia ? 1 : 0);

  if (acompanantes === 3) {
    res.nivel = 'oro';
    res.porque = 'Core, accesorio Huawei, garantía y TechSmart/servicio: los cuatro.';
    return res;
  }

  /* Qué falta para el ORO. Es lo que convierte el marcador en algo que enseña
     a vender en vez de sólo contar. */
  res.falta = [];
  if (!tieneHW)     res.falta.push('acc_hw');
  if (!hayGarantia) res.falta.push('garantia');
  if (!tieneTS)     res.falta.push('ts_serv');

  var nombrarCon = function (lista) {
    return lista.map(function (x) { return ARTICULO[x] || NOMBRE_ROL[x] || x; })
                .join(' y ');
  };

  if (acompanantes === 2) {
    res.nivel = 'plata';
    var tiene = [];
    if (tieneHW)     tiene.push('accesorio Huawei');
    if (hayGarantia) tiene.push('garantía');
    if (tieneTS)     tiene.push('TechSmart/servicio');
    res.porque = 'Core con ' + tiene.join(' y ') + '. Con ' +
                 nombrarCon(res.falta) + ' habría sido ORO.';
    return res;
  }

  /* Hay core pero le falta compañía. Se dice qué le falta para PLATA —lo
     alcanzable— y no la lista entera de lo que le falta para ORO: a nadie le
     sirve que le enumeren tres cosas cuando con una llega.

     Y se distinguen dos casos que no son lo mismo:

       VACÍA    — no hay en el ticket nada que pueda llenar esa casilla.
       OCUPADA  — sí lo hay, pero ya se gastó en otra. Decirle «falta un
                  accesorio Huawei» a quien lo tiene delante es una explicación
                  que puede desmentir mirando su ticket, y quien pilla a la
                  pantalla en un error deja de creerle lo demás. */
  var vacias = [], ocupadas = [];
  for (var f = 0; f < res.falta.length; f++) {
    var rol = res.falta[f];
    if (rol !== 'garantia' && hayCandidato(arts, rol)) ocupadas.push(rol);
    else vacias.push(rol);
  }
  var nombrar = function (lista) {
    return lista.map(function (x) { return NOMBRE_ROL[x] || x; }).join(' ni ');
  };

  res.porque = 'No califica: hay core, pero para PLATA ' +
    (acompanantes === 1 ? 'falta una cosa más' : 'faltan dos de las tres') + '.' +
    (vacias.length   ? ' No hay ' + nombrar(vacias) + '.' : '') +
    (ocupadas.length ? ' El ' + nombrar(ocupadas) + ' que trae ya está ' +
                       'haciendo de core: hace falta otro producto.' : '');
  return res;
}

raiz.concursoCalificar = calificar;
raiz.CONCURSO_ROLES    = ROLES;
raiz.CONCURSO_NOMBRE_ROL = NOMBRE_ROL;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calificar: calificar, ROLES: ROLES, NOMBRE_ROL: NOMBRE_ROL };
}

})(typeof window !== 'undefined' ? window : globalThis);
