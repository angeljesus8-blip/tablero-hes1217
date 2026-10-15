/* ============================================================
   Captura: la fecha de la venta (15-oct-2026, v295)
   ============================================================
   Corre en cada commit desde `verificar.py`.

   Para subir una venta de días anteriores. Lo que, roto, no da error:

   1. La fecha elegida no viaja: la venta se guarda hoy y nadie lo nota hasta
      el corte. Se mira `p_fecha` en lo que sube a Supabase.
   2. El campo se queda en el día viejo después de guardar: todas las ventas
      siguientes caerían en ese día. Tiene que volver a hoy.
   3. Un valor que el asesor NO tocó (la app abierta desde ayer) manda la
      venta a ayer. Sin tocarlo, manda el reloj.
   4. Fechas del futuro o de más de 30 días atrás: `venta_guardar` las acepta,
      así que el tope es éste.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'captura_series.html'), 'utf8');
const { crearEntorno } = require('./dom.js');

const STORE = { store_id:'1217', nombre:'Angelopolis', gas_url:'', gas_token:'t',
                vendedores:['Prueba Uno'] };
const EMP   = { empno:'1', nombre:'Prueba Uno', puesto:'asesor' };
const fallos = [];

const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const dmy = d => d.getDate()+'/'+(d.getMonth()+1)+'/'+d.getFullYear();
const haceDias = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

function abrir(){
  return crearEntorno({ html, ruta:'/t/captura_series.html',
    ls: { hes1217_store: JSON.stringify(STORE), hes1217_empleado: JSON.stringify(EMP),
          hes1217_vend: 'Prueba Uno' } });
}

/* Intenta una venta con la fecha dada (null = no tocar el campo).
   Devuelve el cuerpo que subiría a Supabase, o null si no se registró. */
function vender(ent, fechaISO, serie){
  const antes = ent.correr('sbPend.length');
  ent.correr(`irPaso(2); $('serie').value = ${JSON.stringify(serie)};`);
  if(fechaISO !== null)
    ent.correr(`$('fechaVenta').value = ${JSON.stringify(fechaISO)}; marcarFechaVenta(true);`);
  ent.correr(`$('btnAdd').onclick()`);
  if(!ent.correr('_pendingVenta')) return null;
  ent.correr('finalizarVenta(false)');
  return ent.correr('sbPend.length') > antes ? ent.correr('sbPend[sbPend.length - 1]') : null;
}

const ent = abrir();
if(ent.err){ fallos.push('la pantalla se cae al cargar -> ' + ent.err); }
else {
  const hoy = new Date();
  if(!ent.el('fechaVenta')) fallos.push('no existe el campo #fechaVenta en el paso 2');
  else {
    if(ent.el('fechaVenta').value !== iso(hoy))
      fallos.push('al abrir, la fecha no arranca en hoy (' + ent.el('fechaVenta').value + ')');

    // 1 · Sin tocarla: hoy.
    let c = vender(ent, null, 'SERIE-HOY');
    if(!c || c.p_fecha !== dmy(hoy)) fallos.push('sin tocar la fecha, la venta no sale con la de hoy (' + (c && c.p_fecha) + ')');

    // 2 · Hace 3 días: viaja esa fecha, y el campo vuelve a hoy.
    const d3 = haceDias(3);
    c = vender(ent, iso(d3), 'SERIE-ATRAS');
    if(!c || c.p_fecha !== dmy(d3)) fallos.push('una venta de hace 3 días no sube con su fecha (' + (c && c.p_fecha) + ', esperaba ' + dmy(d3) + ')');
    if(ent.el('fechaVenta').value !== iso(hoy)) fallos.push('tras guardar una venta vieja, el campo no volvió a hoy');
    if(ent.correr('_fechaElegida') !== false) fallos.push('tras guardar, la fecha sigue marcada como elegida');
    const item = ent.correr('items[0]');
    if(!item || item.fecha !== dmy(d3)) fallos.push('la copia del teléfono no lleva la fecha elegida');
    if(ent.htmlDe('lista').indexOf('SERIE-ATRAS') >= 0) fallos.push('la venta de otro día aparece en «Capturadas hoy»');

    // 3 · Un valor viejo que nadie eligió no manda la venta a ese día.
    ent.correr(`$('fechaVenta').value = ${JSON.stringify(iso(haceDias(1)))};`);
    c = vender(ent, null, 'SERIE-NOELEGIDA');
    if(!c || c.p_fecha !== dmy(hoy)) fallos.push('un valor viejo que el asesor no tocó mandó la venta a otro día (' + (c && c.p_fecha) + ')');

    // 4 · Futuro y más de 30 días: no se registra.
    const manana = new Date(); manana.setDate(manana.getDate() + 1);
    if(vender(ent, iso(manana), 'SERIE-FUTURO')) fallos.push('se registró una venta con fecha de mañana');
    ent.correr('fechaVentaAHoy()');
    if(vender(ent, iso(haceDias(31)), 'SERIE-VIEJA')) fallos.push('se registró una venta de hace 31 días');
    ent.correr('fechaVentaAHoy()');
    if(!vender(ent, iso(haceDias(30)), 'SERIE-30')) fallos.push('una venta de hace 30 días (el tope) no se registró');

    // El aviso del precio sale solo con otro día.
    ent.correr(`$('fechaVenta').value = ${JSON.stringify(iso(haceDias(2)))}; marcarFechaVenta(true);`);
    if(!ent.el('fechaAviso').classList.contains('show')) fallos.push('con otro día no sale el aviso de comprobar el precio');
    ent.correr('fechaVentaAHoy()');
    if(ent.el('fechaAviso').classList.contains('show')) fallos.push('con la fecha de hoy sigue el aviso de otro día');
  }
}

if(fallos.length){
  console.log('captura fecha: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('captura fecha: la venta viaja con el día elegido, el campo vuelve a hoy, '
          + 'un valor no elegido no cuenta, y ni futuro ni más de 30 días entran');
