/* ============================================================
   Concurso ORO y PLATA: leer el ticket y calificarlo
   ============================================================
   Corre en cada commit desde `verificar.py`.

   El concurso se juega sobre UNA foto. No hay segunda fuente contra la que
   cuadrar: si la lectura se come una línea o el reparto de papeles se equivoca,
   el ticket baja de nivel y **no pasa nada visible**. El asesor ve PLATA donde
   le tocaba ORO, no tiene a qué atribuirlo, y para cuando alguien lo note el
   concurso ya habrá terminado.

   Por eso estas pruebas miran las dos cosas que pueden fallar calladas:

     1. Que la lectura del ticket esté COMPLETA — y que cuando no lo esté,
        lo diga.
     2. Que el reparto de papeles busque el mejor, no el primero.

   El caso base es el ticket 34140 de verdad (14-sep-2026, 7 artículos, 5
   garantías, 3 descuentos), con los nombres cambiados: el repo es público.
   Ángel confirmó a mano que ese ticket es ORO.
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..');

const { leerTicket, fechaISO } = require(path.join(BASE, 'concurso_ticket.js'));
const { aplicarRoles, rolesDe } = require(path.join(BASE, 'concurso_roles.js'));
const { calificar } = require(path.join(BASE, 'concurso_nivel.js'));

const TICKET = fs.readFileSync(path.join(__dirname, 'ocr_ticket_multi.txt'), 'utf8');

const fallos = [];
function ok(que, cond, visto) {
  if (!cond) fallos.push(que + (visto !== undefined ? ' — se vio: ' + visto : ''));
}

/* Arma un ticket de mentira a partir de líneas sueltas, para los casos que no
   tienen foto. `g` marca la línea como garantía. */
const L = (nombre, roles, g) => ({ desc: nombre, nombre: nombre, sku: '',
                                   roles: roles || [], es_garantia: !!g });
const nivelDe = (...lineas) => calificar(lineas).nivel;


/* ── 1 · El ticket real se lee entero ──────────────────────────────────── */
{
  const t = leerTicket(TICKET);

  ok('se lee el número de ticket', t.ticket === '34140', t.ticket);
  /* El vendedor es «Atendido por», NO el número del final del pie. Ese otro es
     quien cobró en caja: confundirlos le da el oro al gerente en vez de a quien
     vendió. Ya pasó con los accesorios (MAPA, 18-ago-2026). */
  ok('el vendedor sale de «Atendido por»', t.vendedor === 'RAMIREZ SOTO, LUIS', t.vendedor);
  ok('el último número del pie NO se toma por vendedor',
     !/900001/.test(t.vendedor), t.vendedor);
  ok('se leen las 12 líneas', t.lineas.length === 12, t.lineas.length);
  ok('7 artículos y 5 garantías',
     t.lineas.filter(l => !l.es_garantia).length === 7 &&
     t.lineas.filter(l => l.es_garantia).length === 5);
  ok('el total es el del ticket', t.total === 26302, t.total);
  ok('no protesta por un ticket que está bien',
     t.avisos.length === 0, JSON.stringify(t.avisos));

  /* Los tres formatos de número del ticket, que NO son el mismo:
     precio 3 decimales · importe 2 decimales con coma · descuento negativo. */
  const mate = t.lineas[0];
  ok('el precio de 3 decimales son pesos, no miles', mate.precio === 29990, mate.precio);
  ok('el importe con coma de miles se lee bien', mate.importe === 29990, mate.importe);
  ok('el descuento se cuelga del artículo de ARRIBA', mate.descuento === 14995,
     mate.descuento);

  /* La promoción va DESPUÉS del renglón de cifras igual que el descuento, así
     que si se colgara del artículo de abajo, el watch perdería sus $1,500 y se
     los comería su garantía. */
  const watch = t.lineas[2];
  ok('la promoción es del artículo de arriba, no del de abajo',
     watch.descuento === 1500 && t.lineas[3].descuento === 0,
     watch.descuento + ' / ' + t.lineas[3].descuento);

  ok('la serie se pega a su línea', mate.serie === '49Z0225217000589', mate.serie);
}


/* ── 2 · La red: las líneas tienen que sumar el Total ───────────────────── */
{
  /* Ésta es LA prueba del archivo. Una línea que el OCR se saltó no rompe nada
     visible; sólo baja el nivel. Y el «Recuento de artículos vendidos» no
     sirve como red, porque este ticket —el largo, el que importa— NO lo trae.

     Las tres se comprueban rompiendo el ticket a propósito. */

  const sinMouse = TICKET.split('\n')
    .filter(l => !/MOUSE HUAWEI|100256417/.test(l)).join('\n');
  const a = leerTicket(sinMouse);
  ok('una línea que falta se caza por la suma',
     a.avisos.some(v => /suman/.test(v)), JSON.stringify(a.avisos));

  /* Esto antes sólo se avisaba dos veces —por la línea y por la suma— y desde
     el 19-sep-2026 se REPARA: el precio unitario y el Total coinciden entre sí
     y desmienten al importe. Lo que la prueba cuida sigue siendo lo mismo, que
     el error no pase; lo que cambió es que ahora además se recupera el dato. */
  const micaMal = TICKET.replace('$149.00', '$14.90');
  const b = leerTicket(micaMal);
  const mica = b.lineas.find(l => l.sku === '43739');
  ok('un importe mal leído se corrige con el precio', mica.importe === 149, mica.importe);
  ok('y el que salió de la foto queda a la vista', mica.importe_ocr === 14.9, mica.importe_ocr);
  ok('la corrección se dice en pantalla',
     b.avisos.some(v => /14\.90/.test(v) && /149/.test(v)), JSON.stringify(b.avisos));

  const sinTotal = TICKET.replace(/^ *Total .*$/m, '');
  const c = leerTicket(sinTotal);
  ok('sin Total se avisa, no se da por bueno',
     c.avisos.some(v => /No se leyó el Total/.test(v)), JSON.stringify(c.avisos));

  /* Un peso de margen por el redondeo del OCR; dos pesos de diferencia real
     tienen que seguir cazándose. La mica de $149 leída como $14.90 es el caso
     que esto protege. */
  const casi = TICKET.replace('$149.00', '$148.00');
  ok('una diferencia pequeña pero real no se perdona',
     leerTicket(casi).avisos.some(v => /suman/.test(v)));
}


/* ── 3 · Todo el 43739 es TechSmart ────────────────────────────────────── */
{
  /* Lo dice el SKU y no el nombre, y ésa es la decisión que sostiene el
     concurso: el POS imprime «PRODUCTOS VARIOS» para las siete cosas que se
     cobran con el genérico, y el nombre de verdad va en el campo de serie,
     que es donde el OCR más falla. */
  const r = rolesDe({ sku: '43739', desc: 'PRODUCTOS VARIOS', serie: 'MICAHIDROGEL' }, null);
  ok('la mica del 43739 es TechSmart',
     r.roles.length === 1 && r.roles[0] === 'ts_serv', JSON.stringify(r.roles));

  /* Un accesorio del 43739 que nadie ha visto nunca tiene que clasificarse
     igual. Si dependiera de reconocer el nombre, el primero que entrara
     quedaría sin rol y empezaría a bajar tickets de ORO a PLATA. */
  const nuevo = rolesDe({ sku: '43739', desc: 'PRODUCTOS VARIOS', serie: 'LOQUESEA77' }, null);
  ok('un accesorio nuevo del 43739 también es TechSmart',
     nuevo.roles[0] === 'ts_serv' && nuevo.clase === 'techsmart',
     JSON.stringify(nuevo));

  /* El cargador de 100 W parece Huawei y no lo es: se cobra con el genérico.
     Se comprueba porque fue una suposición equivocada que ya estuvo escrita. */
  const carga = rolesDe({ sku: '43739', desc: 'PRODUCTOS VARIOS', serie: 'CARGADOR100' }, null);
  ok('el cargador del 43739 es TechSmart, no accesorio Huawei',
     carga.roles[0] === 'ts_serv', JSON.stringify(carga.roles));

  /* El SKU manda sobre el texto, pero la tabla de Supabase manda sobre el SKU:
     es la que el gerente edita cuando cambie la circular. */
  const tabla = { '43739': { roles: ['acc_hw'], clase: 'acc_hw', nota: 'editado' } };
  ok('la tabla de Supabase gana sobre la regla del SKU',
     rolesDe({ sku: '43739', desc: 'PRODUCTOS VARIOS' }, tabla).roles[0] === 'acc_hw');

  ok('la garantía no juega ningún papel de artículo',
     rolesDe({ sku: '100272290', desc: 'GARANTIA Y SEGURO 2 ANOS MAS',
               es_garantia: true }, null).roles.length === 0);
}


/* ── 4 · Lo que no se reconoce se DICE ─────────────────────────────────── */
{
  /* La regla más importante de `concurso_roles.js`. Si un producto nuevo se
     tratara como «no cuenta», bajaría tickets de nivel sin dar un solo error.
     Tiene que salir marcado para que el asesor lo resuelva. */
  const r = rolesDe({ sku: '100999999', desc: 'APARATO QUE NADIE HA VISTO' }, null);
  ok('un producto desconocido se marca, no se descarta',
     r.clase === 'sin_rol' && r.roles.length === 0, JSON.stringify(r));
  ok('y se explica qué hacer con él', /a mano/.test(r.nota), r.nota);
}


/* ── 5 · El ticket 34140 es ORO ────────────────────────────────────────── */
{
  const t = leerTicket(TICKET);
  const lineas = aplicarRoles(t.lineas, null);
  const c = calificar(lineas);

  ok('el ticket real da ORO', c.nivel === 'oro', c.nivel + ' · ' + c.porque);
  ok('ninguna línea del ticket real queda sin clasificar',
     lineas.every(l => l.clase !== 'sin_rol'),
     lineas.filter(l => l.clase === 'sin_rol').map(l => l.nombre).join(', '));

  /* La casilla de TechSmart la tiene que llenar la mica: es el único 43739 del
     ticket. Si la llenara otra cosa, la regla del SKU no estaría haciendo nada
     y el ORO sería una casualidad. */
  ok('la casilla TechSmart la llena la mica',
     lineas[c.roles.ts_serv].nombre === 'MICAHIDROGEL',
     lineas[c.roles.ts_serv] && lineas[c.roles.ts_serv].nombre);

  /* Y la mica se enseña por su nombre, no como «PRODUCTOS VARIOS». La pantalla
     existe para validar: siete líneas iguales no se pueden validar. */
  ok('el accesorio genérico se enseña por su nombre real',
     lineas.some(l => l.nombre === 'MICAHIDROGEL' && l.desc === 'PRODUCTOS VARIOS'));

  ok('el core es el MatePad', /MATEPAD/.test(lineas[c.roles.core].nombre),
     lineas[c.roles.core].nombre);
  ok('las 5 garantías se cuentan', c.garantias.length === 5, c.garantias.length);

  /* Sin la mica —quitando el único TechSmart— el mismo ticket cae a PLATA.
     Es la diferencia que Ángel corrigió a mano el 15-sep-2026. */
  const sinMica = lineas.filter(l => l.clase !== 'techsmart');
  ok('sin el TechSmart, el mismo ticket es PLATA',
     calificar(sinMica).nivel === 'plata', calificar(sinMica).nivel);
}


/* ── 6 · El reparto busca el MEJOR papel, no el primero ────────────────── */
{
  /* LOS DOS CASOS QUE FIJAN LA REGLA, Y QUE SON EL MISMO TICKET.

     Se preguntó tres veces el 15-sep-2026 y las respuestas parecían
     contradecirse. Estas dos pruebas son la razón de que no:

       band    + seguro + mica  → NO califica
       matepad + seguro + mica  → PLATA

     Cambia UN producto y cambia el resultado. Lo que los separa no es el
     accesorio Huawei —no lo tiene ninguno de los dos— sino el CORE. Una band
     no es core; un MatePad sí.

     Van juntas y en este orden a propósito: separadas, cada una parece
     defender una regla distinta, y la primera invita a «arreglar» la segunda. */
  ok('band + seguro + mica NO califica: la band no es core',
     nivelDe(L('HUAWEI BAND 10', ['acc_hw']),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true),
             L('MICA HR', ['ts_serv'])) === 'ninguno');
  ok('matepad + seguro + mica SÍ es PLATA: mismo ticket, con core',
     nivelDe(L('MATEPAD PRO', ['core']),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true),
             L('MICA HR', ['ts_serv'])) === 'plata');

  /* Y el que no califica tiene que decir que le falta el CORE, no otra cosa.
     Si dijera «falta un accesorio Huawei», el asesor cambiaría la mica por un
     mouse y seguiría sin calificar, sin entender por qué. */
  {
    const c = calificar([L('HUAWEI BAND 10', ['acc_hw']),
                         L('GARANTIA Y SEGURO 1 ANO MAS', [], true),
                         L('MICA HR', ['ts_serv'])]);
    ok('y dice que lo que falta es el core', /Core/.test(c.porque), c.porque);
  }

  /* Las otras dos parejas, que son las que sí dibuja la tabla de la circular.
     Las tres tienen que dar plata o la regla estaría escrita a medias. */
  ok('core + accesorio Huawei + garantía es PLATA',
     nivelDe(L('MATEPAD PRO', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true)) === 'plata');
  ok('core + accesorio Huawei + TechSmart es PLATA',
     nivelDe(L('MATEPAD PRO', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
             L('MICA HR', ['ts_serv'])) === 'plata');

  /* El ticket de la band, con un teléfono delante, llega a ORO: la band pasa a
     hacer de accesorio Huawei y el teléfono pone el core. Aísla que lo que
     faltaba era el core. */
  ok('teléfono + band + garantía + mica es ORO',
     nivelDe(L('PURA 90S', ['core']), L('HUAWEI BAND 10', ['acc_hw']),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true),
             L('MICA HR', ['ts_serv'])) === 'oro');

  /* Un core con UN solo acompañante no llega. Si bastara con uno, casi
     cualquier venta con seguro sería plata y el concurso no distinguiría nada. */
  ok('core + garantía a secas no califica',
     nivelDe(L('PURA 90S', ['core']),
             L('GARANTIA Y SEGURO 2 ANOS MAS', [], true)) === 'ninguno');
  ok('core + accesorio Huawei a secas no califica',
     nivelDe(L('PURA 90S', ['core']), L('MOUSE HUAWEI', ['acc_hw'])) === 'ninguno');
  ok('core + mica a secas no califica',
     nivelDe(L('PURA 90S', ['core']), L('MICA HR', ['ts_serv'])) === 'ninguno');

  /* ── Un producto con DOS papeles ──
     Hoy no hay ninguno: core son tres cosas y el resto de Huawei es accesorio.
     Estas dos prueban el mecanismo con un producto inventado que sí los tiene,
     porque el criterio de qué es core ya cambió dos veces en un día y el
     reparto tiene que seguir siendo correcto si vuelve a cambiar.

     `DOBLE` no es ningún producto real, y está escrito así para que nadie lo
     lea como que una band hace de core. */
  const DOBLE = ['core', 'acc_hw'];

  /* Con un core de verdad delante, el de dos papeles tiene que CEDER el de
     core y hacer de accesorio. Si se quedara con el primero que le toca, el
     MatePad se quedaría sin sitio y el ticket no calificaría — con los dos
     productos delante y sin ningún error. */
  ok('con un core delante, el de dos papeles hace de accesorio',
     nivelDe(L('MATEPAD PRO', ['core']),
             L('PRODUCTO DOBLE', DOBLE),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true)) === 'plata');

  /* Y un solo artículo no llena dos casillas por mucho que pueda jugar los dos
     papeles. */
  ok('un solo artículo no llena dos casillas',
     nivelDe(L('PRODUCTO DOBLE', DOBLE),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true)) === 'ninguno');

  /* La garantía NO gasta artículo: es una condición del ticket. Si compitiera
     por un papel, un ORO necesitaría cuatro artículos en vez de tres. */
  ok('la garantía no ocupa el sitio de un artículo',
     nivelDe(L('PURA 90S', ['core']), L('MICA HR', ['ts_serv']),
             L('GARANTIA Y SEGURO 2 ANOS MAS', [], true),
             L('MOUSE HUAWEI', ['acc_hw'])) === 'oro');

  ok('cuatro casillas llenas es ORO',
     nivelDe(L('MATEPAD', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
             L('MICA HR', ['ts_serv']),
             L('GARANTIA Y SEGURO 1 ANO MAS', [], true)) === 'oro');

  ok('sin garantía pero con TechSmart es PLATA',
     nivelDe(L('MATEPAD', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
             L('MICA HR', ['ts_serv'])) === 'plata');

  /* Dos TechSmart no valen por una garantía: la circular pide «1 Garantía»
     Y «1 TechSmart y/o Servicio», no dos de lo mismo. */
  ok('dos TechSmart no sustituyen a la garantía',
     nivelDe(L('MATEPAD', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
             L('MICA HR', ['ts_serv']), L('MICA MATTE', ['ts_serv'])) === 'plata');
}


/* ── 7 · Cuando no califica, se dice POR QUÉ ───────────────────────────── */
{
  /* Es la pantalla que pidió Ángel: poder validar si el ticket calificaba o no.
     «No califica» a secas no se puede discutir con un asesor. */
  const sinAcc = calificar([L('PURA 90S', ['core']),
                            L('GARANTIA Y SEGURO 2 ANOS MAS', [], true)]);
  ok('dice que falta el accesorio Huawei', /accesorio huawei/i.test(sinAcc.porque),
     sinAcc.porque);

  const sinCore = calificar([L('MICA HR', ['ts_serv']), L('MOUSE HUAWEI', ['acc_hw'])]);
  ok('dice que falta el core', /core/i.test(sinCore.porque), sinCore.porque);

  /* Cuando el producto que llenaría la casilla SÍ está pero ya se gastó en la
     otra, decir «falta un accesorio Huawei» es una explicación que el asesor
     puede desmentir mirando su propio ticket — lo tiene delante. Y quien pilla
     a la pantalla en un error deja de creerle lo demás.

     Con un producto de dos papeles, igual que en el bloque 6: hoy no hay
     ninguno, pero el mensaje tiene que ser correcto el día que lo haya. */
  const ocupado = calificar([L('PRODUCTO DOBLE', ['core', 'acc_hw']),
                             L('GARANTIA Y SEGURO 1 ANO MAS', [], true)]);
  ok('si el candidato ya llenó la otra casilla, se dice eso y no «falta»',
     /otro producto/.test(ocupado.porque) && /haciendo de core/.test(ocupado.porque),
     ocupado.porque);

  /* Y cuando de verdad no hay ninguno, se nombra lo que falta. */
  const faltaDeVerdad = calificar([L('MATEPAD PRO', ['core']),
                                   L('GARANTIA Y SEGURO 1 ANO MAS', [], true)]);
  ok('cuando no hay candidato, se nombra la casilla vacía',
     /accesorio huawei/i.test(faltaDeVerdad.porque), faltaDeVerdad.porque);

  /* A un PLATA se le dice qué le faltó para ser ORO: es lo que convierte el
     marcador en algo que enseña a vender. */
  const plata = calificar([L('MATEPAD', ['core']), L('MOUSE HUAWEI', ['acc_hw']),
                           L('GARANTIA Y SEGURO 1 ANO MAS', [], true)]);
  ok('al plata se le dice qué le faltó para el oro',
     /habría sido ORO/.test(plata.porque), plata.porque);
}


/* ── 8 · Un ticket de un solo artículo no se rompe ─────────────────────── */
{
  /* Los 9 tickets viejos de `pruebas/` son de un artículo, y ésos SÍ traen
     «Recuento de artículos vendidos». Tienen que seguir leyéndose. */
  const uno = leerTicket(fs.readFileSync(path.join(__dirname, 'ocr_ticket_real7.txt'), 'utf8'));
  ok('el ticket de un artículo sigue leyéndose', uno.ticket === '33679', uno.ticket);
  ok('y su recuento se aprovecha cuando está', uno.recuento === 1, uno.recuento);
  ok('un cargador solo no califica',
     calificar(aplicarRoles(uno.lineas, null)).nivel === 'ninguno');
}


/* ── 9 · La fecha: DÍA primero, no mes ─────────────────────────────────── */
{
  /* Es la puerta por la que un ticket entra o no al concurso, y se equivoca
     sin ruido: leído como mes/día, el 10 de septiembre se convierte en el 9 de
     octubre, cae fuera de fechas, y el asesor recibe un rechazo que no puede
     discutir mirando su papel. */
  ok('14/09/26 es el 14 de septiembre', fechaISO('14/09/26') === '2026-09-14',
     fechaISO('14/09/26'));

  /* EL CASO QUE LO DESTAPA. Con día y mes intercambiables, las dos lecturas
     son fechas válidas y ninguna comprobación las distingue: la única forma de
     cazarlo es una fecha donde las dos den días distintos DENTRO del concurso
     y fuera de él. */
  ok('09/10/26 es el 9 de OCTUBRE, no el 10 de septiembre',
     fechaISO('09/10/26') === '2026-10-09', fechaISO('09/10/26'));

  ok('el año de cuatro cifras se respeta', fechaISO('01/10/2026') === '2026-10-01',
     fechaISO('01/10/2026'));

  /* Lo que NO se puede interpretar vuelve null, y quien llama manda NULL para
     que el servidor ponga la de hoy. Rechazar el ticket por una fecha que el
     OCR leyó torcida sería peor. */
  ok('una fecha ilegible no se inventa', fechaISO('1?/09/26') === null);
  ok('el mes 13 no existe',              fechaISO('01/13/26') === null);
  ok('el 31 de febrero tampoco',         fechaISO('31/02/26') === null,
     fechaISO('31/02/26'));
  ok('y una cadena vacía tampoco',       fechaISO('') === null);

  /* La que lee el ticket de verdad tiene que pasar por aquí sin tropezar. */
  const t = leerTicket(TICKET);
  ok('la fecha del 34140 se convierte', fechaISO(t.fecha) === '2026-09-14',
     t.fecha + ' → ' + fechaISO(t.fecha));
}


/* ── 10 · El ticket fotografiado sobre el teclado ──────────────── */
{
  /* 19-sep-2026, ticket 34273, foto de Ángel. El papel iba sobre el teclado y
     con otro ticket al lado, y el OCR metió los márgenes dentro de los
     renglones: `4 1217 2 19/9/26…`, `8 Y GARANTÍA Y SEGURO`, `( )) Promoción`,
     `PRODUCTOS VARIOS Intro`.

     Cada mota tiraba un dato entero y sin ruido. El texto de `ocr_ticket_real10`
     es el que salió de `cnLeerFoto` con esa foto —literal, salvo los nombres—,
     así que si alguien vuelve a anclar una expresión en `^`, esto se cae. */
  const su = leerTicket(fs.readFileSync(path.join(__dirname, 'ocr_ticket_real10.txt'), 'utf8'));

  ok('el número de ticket sobrevive al `4` de más del pie', su.ticket === '34273', su.ticket);
  ok('y la fecha también', fechaISO(su.fecha) === '2026-09-19', su.fecha);

  const gar = su.lineas.filter(l => l.es_garantia);
  ok('la garantía con basura delante sigue siendo garantía',
     gar.length === 1 && gar[0].sku === '100272100',
     su.lineas.map(l => l.sku + (l.es_garantia ? ' (gar)' : '')).join(' | '));

  /* La promoción traia `( ))` delante Y el menos separado de la cifra. Si
     cualquiera de las dos cosas no se admite, la suma no cierra. */
  const suma = su.lineas.reduce((a, l) => a + (l.importe || 0) - (l.descuento || 0), 0);
  ok('la promoción de -$1,000 se descuenta y la suma cierra contra el Total',
     Math.abs(suma - su.total) < 0.5, suma + ' vs ' + su.total);

  /* La red de avisos es lo que el asesor ve. Con el papel bien leído tiene que
     estar VACÍA: tres avisos sobre un ticket correcto enseñan a ignorarlos. */
  ok('un ticket bien leído no deja ningún aviso', su.avisos.length === 0,
     su.avisos.join(' // '));

  /* Y la mica recupera su nombre: `PRODUCTOS VARIOS` con la tecla `Intro`
     pegada seguía siendo el genérico. Sin esto, validar es imposible. */
  ok('la mica se llama por su código y no «PRODUCTOS VARIOS»',
     su.lineas.some(l => l.nombre === 'MICATRANSP'),
     su.lineas.map(l => l.nombre).join(' | '));

  /* LO QUE EL TICKET ES DE VERDAD, bien leído: celular + garantía + mica del
     43739 (TechSmart entero, por regla de Ángel en concurso_roles.js). Eso es
     la TERCERA pareja de `concurso_nivel.js` —Core + Garantía + TechSmart—,
     así que el ticket es PLATA.

     Y ahí está lo que costaba de verdad: mal leído decía «No califica». El
     asesor se queda sin su plata y nadie tiene forma de notarlo, porque la
     pantalla da una razón que suena correcta. */
  const cal = calificar(aplicarRoles(su.lineas, null));
  ok('bien leído, el 34273 es PLATA', cal.nivel === 'plata',
     cal.nivel + ': ' + cal.porque);
  ok('y se le dice qué le faltó para el oro', /ORO/.test(cal.porque), cal.porque);
}


/* ── 11 · La mota puede caer en CUALQUIER renglón ─────────────── */
{
  /* El volcado del 34273 trae la basura en cuatro renglones, pero no en todos.
     En la foto que Ángel subió desde el celular cayó en otros: su pantalla
     leyó DOS artículos de tres y sumó $149 —o sea que la mota le tocó al
     renglón de cifras de la garantía, que aquí salió limpio—.

     Que la prueba dependa de dónde cayó la basura ESE día es no tener prueba:
     se comprobó con cebos y, volviendo a anclar en `^`, estas tres no las
     cazaba nadie. Así que van a mano, una por ancla. */
  const sucio = [
    'K PRODUCTOS VARIOS',
    '| 000043739 1 149.000 $149.00 I',
    'M Total 149.00',
    ') Atendido por :LOPEZ, CARLOS'
  ].join('\n');
  const s = leerTicket(sucio);

  ok('un artículo con basura delante del SKU se lee igual',
     s.lineas.length === 1 && s.lineas[0].sku === '43739' && s.lineas[0].importe === 149,
     JSON.stringify(s.lineas));
  ok('el Total con basura delante se lee igual', s.total === 149, s.total);
  ok('y el asesor también', s.vendedor === 'LOPEZ, CARLOS', s.vendedor);

  /* Y la suma cierra, que es la red que protege el concurso: si alguna de las
     tres se hubiera perdido, esto avisaría. */
  ok('con los tres datos, el ticket sucio no deja avisos de suma',
     !s.avisos.some(a => /suman/.test(a)), s.avisos.join(' // '));
}


/* ── 12 · La segunda foto del mismo ticket ────────────────── */
{
  /* 19-sep-2026, 5:39 PM. Ángel volvió a fotografiar el 34273 con v249 ya
     publicada y la pantalla seguía sin número de ticket y sin fecha, más dos
     avisos por el mismo dígito. El volcado de esa toma no se guardó, así que
     el caso NO finge ser uno real: parte del volcado real de la primera foto y
     le aplica las dos únicas diferencias que su pantalla demostraba.

     1) Basura a la DERECHA del pie. En v249 la cabeza del renglón admitía
        motas y la cola seguía clavada en `\s*$`. Contado sobre el volcado
        real: 18 renglones ensuciados por la derecha contra 9 por la izquierda.
     2) El importe de la garantía leído `1673` con el precio en `1679.000`. */
  const crudo = fs.readFileSync(path.join(__dirname, 'ocr_ticket_real10.txt'), 'utf8');
  const segunda = crudo
    .replace('4:45 PM 34273 900001', '4:45 PM 34273 9O000l | Ctrl')
    .replace('$1,679.00', '$1,673.00');
  const g = leerTicket(segunda);

  /* El cajero salió ilegible Y el margen metió basura detrás. Ninguna de las
     dos cosas es asunto del TICKET, que es el único dato que impide registrar
     dos veces la misma venta. */
  ok('el ticket sobrevive a la basura de la cola', g.ticket === '34273', g.ticket);
  ok('y la fecha, que sale del mismo renglón', fechaISO(g.fecha) === '2026-09-19', g.fecha);

  /* El ticket sigue siendo el PENÚLTIMO campo, no «el último número». Si el
     pie sólo trae uno no se sabe cuál de los dos sobrevivió, y guardar el
     número de empleado del cajero como folio rechazaría por duplicado la venta
     siguiente de ese mismo cajero. Mejor sin folio: eso sí avisa. */
  const solo = leerTicket('1217 2 19/9/26 4:45 PM 900001');
  ok('con un solo campo en el pie no se inventa folio', solo.ticket === '', solo.ticket);

  /* La reparación del importe: el precio y el Total coinciden entre sí y
     desmienten al importe. Se repara, y el original queda a la vista. */
  const gar = g.lineas.filter(l => l.es_garantia)[0];
  ok('el importe mal leído se corrige con el precio', gar.importe === 1679, gar.importe);
  ok('y el número que salió de la foto no se pierde', gar.importe_ocr === 1673, gar.importe_ocr);
  ok('la corrección se dice, no se hace callando',
     g.avisos.some(a => /1673/.test(a) && /1679/.test(a)), g.avisos.join(' // '));
  ok('y ya no quedan dos avisos por el mismo dígito',
     !g.avisos.some(a => /suman/.test(a)), g.avisos.join(' // '));
  ok('bien leído sigue siendo PLATA',
     calificar(aplicarRoles(g.lineas, null)).nivel === 'plata');

  /* Y la red no se afloja: si lo que falta es una LÍNEA ENTERA, cambiar el
     importe por el precio no hace cerrar la cuenta, y entonces no se toca
     nada. Aquí se borra la mica ($149) además de ensuciar el importe. */
  const rota = segunda.replace('000043739 1 149.000 $149.00 1', '');
  const r = leerTicket(rota);
  ok('si reparar no hace cuadrar, el importe NO se toca',
     r.lineas.filter(l => l.es_garantia)[0].importe === 1673);
  ok('y el aviso de la suma sigue ahí', r.avisos.some(a => /suman/.test(a)),
     r.avisos.join(' // '));
}


/* ── 13 · El margen derecho, en los otros tres renglones ────── */
{
  /* 19-sep-2026, 5:53 PM, tercera foto del 34273 ya con v250. El pie ya
     aguantaba la basura de la cola, pero en v250 sólo se soltó EL PIE, y otras
     tres expresiones seguían clavadas en `$`. Su pantalla las enseñó las tres
     a la vez:

       · el celular en «$0.00» y sin su promoción de −$1,000;
       · la mica llamándose «MICATRANSP =»;
       · el asesor como «APELLIDO, NOMBRE EA».

     Y un cuarto, que era el que enseñaba el $0.00: un importe ilegible valía
     CERO. Cero es un número que miente —se ve como un precio de verdad—, así
     que ahora es `null` y la línea se repara desde el precio. */
  const crudo = fs.readFileSync(path.join(__dirname, 'ocr_ticket_real10.txt'), 'utf8');
  const tercera = crudo
    .replace('- 1,000.00', '- 1,000.00 |')
    .replace('$9,999,00 I', '$.. I')
    .replace('SERVICIO: MICATRANSP', 'SERVICIO: MICATRANSP =')
    .replace('LOPEZ, CARLOS', 'LOPEZ, CARLOS EA');
  const x = leerTicket(tercera);

  /* La promoción trae DOS números que no son el descuento
     («Promoción 117935 - 2146243 - 1,000.00»). Mientras la expresión acababa en
     `$` daba igual cuál se buscara; al admitir basura detrás hay que quedarse
     con el ÚLTIMO, o el ticket sale con un descuento de dos millones. */
  ok('la promoción con basura detrás sigue descontando $1,000',
     x.lineas[0].descuento === 1000, x.lineas[0].descuento);

  ok('la mica no se queda llamándose «MICATRANSP =»',
     x.lineas.some(l => l.nombre === 'MICATRANSP'),
     x.lineas.map(l => l.nombre).join(' | '));

  ok('el asesor llega sin el pedazo del margen',
     x.vendedor === 'LOPEZ, CARLOS', x.vendedor);

  /* El importe destrozado: con la promoción bien leída, precio y Total vuelven
     a coincidir y la línea se repara sola. */
  ok('un importe ilegible se repara desde el precio',
     x.lineas[0].importe === 9999, x.lineas[0].importe);
  ok('y se dice que no se pudo leer, no que valía cero',
     x.avisos.some(a => /no se pudo leer/.test(a)), x.avisos.join(' // '));
  ok('la suma cierra y no quedan avisos de cuadre',
     !x.avisos.some(a => /suman/.test(a)), x.avisos.join(' // '));
  ok('y el ticket sigue siendo PLATA',
     calificar(aplicarRoles(x.lineas, null)).nivel === 'plata');

  /* Cero no es lo mismo que «no lo leí», y de ahí salió todo esto. */
  ok('un importe ilegible ya no vale cero', leerTicket('K\n000043739 1 149.000 $..')
       .lineas[0].importe === null);
}


/* ── 14 · El ticket 34330: la cantidad y el SKU del genérico ── */
{
  /* 21-sep-2026. Ángel subió una foto buena —enfocada, plana, con luz— y la
     pantalla no enseñó NADA: tres artículos impresos, cero leídos. Dos causas
     encadenadas, y ninguna daba error.

     1) El realce de contraste, que rescata las fotos apagadas, BORRA la letra
        de las bien iluminadas: la impresión térmica es gris claro y el
        contraste la manda a blanco. Eso se arregló en `captura_series.html`,
        que ahora prueba la foto cruda primero y sólo realza si la cuenta no
        cierra. El volcado de abajo es el de la foto cruda.

     2) Los tratamientos que SÍ leen el renglón pierden la cantidad: un `1`
        suelto entre dos columnas de espacios no tiene con qué sostenerse.
        Y sin cantidad, la línea entera desaparecía del ticket. */
  const t = fs.readFileSync(path.join(__dirname, 'ocr_ticket_real11.txt'), 'utf8');
  const y = leerTicket(t);

  ok('el 34330 da su número de ticket', y.ticket === '34330', y.ticket);
  ok('y su fecha', fechaISO(y.fecha) === '2026-09-21', y.fecha);
  ok('y su vendedor', y.vendedor === 'LOPEZ, CARLOS', y.vendedor);
  ok('las tres líneas del papel llegan a la pantalla', y.lineas.length === 3,
     y.lineas.length);
  ok('la suma cierra contra el Total', !y.avisos.some(a => /suman/.test(a)),
     y.avisos.join(' // '));
  ok('y el ticket es PLATA: core, garantía y TechSmart',
     calificar(aplicarRoles(y.lineas, null)).nivel === 'plata');

  /* El SKU del genérico con un dígito cambiado (`43733`). Sin repararlo la
     línea no es TechSmart, se queda `sin_rol`, y el ticket pasa de PLATA a
     «no califica» por un dígito. */
  const gen = y.lineas.filter(l => l.sku === '43739')[0];
  ok('el genérico mal leído se reconoce', !!gen,
     y.lineas.map(l => l.sku).join(' | '));
  ok('y el número que salió de la foto no se pierde', gen && gen.sku_ocr === '43733',
     gen && gen.sku_ocr);
  ok('la corrección del SKU se dice, no se hace callando',
     y.avisos.some(a => /43733/.test(a) && /43739/.test(a)), y.avisos.join(' // '));

  /* Las dos condiciones van juntas: parecido Y nombre. Sólo por parecido se
     machacaría cualquier SKU de caja; sólo por el nombre, el de un producto
     nuevo que el POS imprimiera igual. */
  const otro = leerTicket('HUAWEI WATCH FIT 4\n100043733 1 169.000 $169.00 I\nTotal 169.00');
  ok('sin «VARIOS» en el nombre, el SKU no se toca',
     otro.lineas[0].sku === '100043733', otro.lineas[0].sku);
  const lejos = leerTicket('PRODUCTOS VARIOS\n000043311 1 169.000 $169.00 I\nTotal 169.00');
  ok('y a dos dígitos de distancia tampoco',
     lejos.lineas[0].sku === '43311', lejos.lineas[0].sku);

  /* La cantidad que el OCR no leyó. Los dos destrozos son reales, medidos
     sobre las mismas fotos con otros tratamientos: el `1` se evapora o sale
     como una barra. */
  const sinCant = leerTicket('PRODUCTOS VARIOS\n000043739 169.000 $169.00 I\nTotal 169.00');
  ok('una línea sin cantidad ya no desaparece', sinCant.lineas.length === 1,
     sinCant.lineas.length);
  ok('y la cantidad se deduce del precio y el importe',
     sinCant.lineas[0].cantidad === 1 && sinCant.lineas[0].cantidad_deducida === true,
     sinCant.lineas[0].cantidad);
  const barra = leerTicket('PRODUCTOS VARIOS\n000043739 | 149.000 $149.00 I\nTotal 149.00');
  ok('la cantidad leída como barra tampoco tira la línea',
     barra.lineas.length === 1 && barra.lineas[0].cantidad === 1,
     barra.lineas.length);

  /* Deducir no es suponer: dos piezas al mismo precio dan cantidad 2. */
  const dos = leerTicket('PRODUCTOS VARIOS\n000043739 149.000 $298.00 I\nTotal 298.00');
  ok('dos piezas se deducen como dos', dos.lineas[0].cantidad === 2,
     dos.lineas[0].cantidad);

  /* Y cuando la división no cierra, no se inventa: se toma 1 y se avisa. */
  const raro = leerTicket('PRODUCTOS VARIOS\n000043739 149.000 $370.00 I\nTotal 370.00');
  ok('una cantidad que no se puede deducir se dice',
     raro.lineas[0].cantidad === 1 &&
     raro.avisos.some(a => /no se leyó la cantidad/.test(a)),
     raro.avisos.join(' // '));

  /* ── La letra pegada a la descripción ──
     El mismo 34330, probado en el navegador con la foto real: el margen dejó
     «UU CMATEPAD 12X 12/256GB BN + TECLD». Con la frontera `\b` a la
     izquierda, esa `C` tiraba el core —y sin core no hay nivel—, aunque el
     ticket se hubiera leído entero y la cuenta cerrara. */
  ok('una letra pegada no le quita el core al MatePad',
     rolesDe({ desc: 'UU CMATEPAD 12X 12/256GB BN + TECLD' }, null).clase === 'core',
     rolesDe({ desc: 'UU CMATEPAD 12X 12/256GB BN + TECLD' }, null).clase);
  ok('y tampoco al teléfono',
     rolesDe({ desc: 'E HUAWEI NOVA 15 MAX 8GB' }, null).clase === 'core',
     rolesDe({ desc: 'E HUAWEI NOVA 15 MAX 8GB' }, null).clase);

  /* Lo que NO se afloja: la frontera derecha, que es la que separa dos cosas
     distintas. Quitar las dos sería cambiar un fallo callado por otro. */
  ok('«BANDA» no se cuela como una Band',
     rolesDe({ desc: 'BANDA ELASTICA GENERICA' }, null).clase === 'sin_rol',
     rolesDe({ desc: 'BANDA ELASTICA GENERICA' }, null).clase);
  ok('«OUTFIT 4» no se cuela como un Fit 4',
     rolesDe({ desc: 'OUTFIT 4 ROPA' }, null).clase === 'sin_rol',
     rolesDe({ desc: 'OUTFIT 4 ROPA' }, null).clase);

  /* EL GUARDARRAÍL. Admitir renglones sin cantidad abre la puerta a leer
     «SKU precio importe» donde hay «SKU cantidad precio»: el MatePad
     costaría UN PESO y el ticket cuadraría solo con el Total equivocado.
     Por eso los dos números que quedan tienen que traer su decimal. */
  const trampa = leerTicket('MATEPAD 12X\n100276717 1 14999.000\nTotal 14999.00');
  ok('«SKU cantidad precio» sin importe no se lee como precio de un peso',
     trampa.lineas.length === 0 ||
     (trampa.lineas[0].precio !== 1 && trampa.lineas[0].importe !== 14999),
     trampa.lineas.map(l => l.precio + '/' + l.importe).join(' | '));
}


if (fallos.length) {
  console.log('concurso oro/plata: ' + fallos.length + ' fallo(s)');
  fallos.forEach(f => console.log('   · ' + f));
  process.exit(1);
}
console.log('concurso oro/plata: el 34140 da ORO, una línea que falte se caza por la suma, y la fecha es día/mes');
