/* ============================================================
   Códigos de artículo de accesorios — la regla, en un solo sitio
   ============================================================
   20-ago-2026.

   Dos pantallas usan esto y tienen que estar de acuerdo:

     · captura_series.html — ADIVINA el producto a partir del código que el OCR
       leyó del ticket.
     · admin.html — AVISA al gerente cuando el código que está escribiendo va a
       empatar con otro que ya existe.

   Si fueran dos copias, el aviso podría dar por bueno un código que la
   adivinanza va a empatar. Nadie lo notaría al guardar: se vería meses después,
   como un producto que «dejó de proponerse solo» sin motivo aparente.
   ============================================================ */

/* Las confusiones del OCR en matriz de puntos, aplanadas.

   Medido en piso: `CARGA100WTS` se leyó `CARGATOONTS 2 77`. O sea 1→T, 0→O,
   W→N. Con `CARGA` coincidiendo pero `100W` no, empataba con CARGADOR 66W y no
   proponía nada — correcto pero inútil.

   La clave es aplicar el mismo mapa a LOS DOS lados: así las confusiones se
   cancelan en vez de tener que acertarlas. `CARGA100W` y `CARGATOONTS` acaban
   los dos en `CAR6A100W…` y el prefijo común pasa de 5 a 9.

   Se aplanan solo los pares que de verdad se confunden en esta impresora. Meter
   más no es más listo: dos artículos distintos podrían acabar iguales, y ahí la
   propuesta sería peor que no proponer. */
var ACC_OCR = { O:'0', D:'0', Q:'0', I:'1', L:'1', T:'1', '|':'1', ']':'1',
                Z:'2', S:'5', B:'8', G:'6', N:'W', M:'W' };

function accClave(s){
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
           .replace(/^43739/, '')           // el prefijo lo llevan casi todos
           .replace(/[ODQILT|\]ZSBGNM]/g, function(c){ return ACC_OCR[c] || c; });
}

/* UN PRODUCTO PUEDE TENER VARIOS CÓDIGOS, separados por coma *(6-sep-2026)*.

   No es una comodidad: el POS imprime el MISMO producto con códigos distintos.
   Medido sobre tickets reales de la tienda, el cargador de 100W —$999, un solo
   producto— sale como `CARGA100WTS` en unos tickets y como `CARGADOR100` en
   otros. El catálogo solo admitía uno, así que la mitad de sus tickets no
   coincidía con nada.

   Y no coincidir no era callarse: `CARGADOR100` empata en OCHO letras con
   `43739 CARGADOR KIDS` y en cinco con `43739-CARGA-100W`, así que la
   adivinanza proponía CARGADOR KIDS —$330— con toda confianza para una venta de
   $999. La regla hacía exactamente lo que se le pidió; el catálogo era el que no
   podía decir la verdad.

   Se elige la coma porque ninguno de los 24 códigos de la tienda la lleva, y
   porque es lo que un gerente teclea sin que nadie se lo explique. Se parte
   ANTES de normalizar: `accClave` convierte `|` en `1`, así que un separador
   que ella pueda tocar sería un separador que a veces desaparece. */
function accCodigosDe(articulo){
  return String(articulo || '').split(',')
           .map(function(s){ return s.trim(); })
           .filter(Boolean);
}

/* El prefijo más largo entre CUALQUIER código de un producto y lo leído. Es el
   único sitio donde los varios códigos de un producto se juntan otra vez: para
   todo lo demás, un producto sigue siendo un producto. */
function accPrefijoMax(articulo, leido){
  var codigos = accCodigosDe(articulo), mejor = 0;
  for(var i = 0; i < codigos.length; i++){
    var c = accClave(codigos[i]);
    if(!c || c.length < 4) continue;
    var n = accPrefijo(c, leido);
    if(n > mejor) mejor = n;
  }
  return mejor;
}

/* Cuántas letras comparten dos códigos DESDE EL PRINCIPIO. */
function accPrefijo(a, b){
  var corto = Math.min(a.length, b.length);
  var i = 0; while(i < corto && a[i] === b[i]) i++;
  return i;
}

/* Por debajo de esto no se propone nada: con cinco letras comunes, CARGADOR
   100W y CARGADOR 66W serían indistinguibles. */
var ACC_MIN_PREFIJO = 6;

/* ¿Este código va a empatar con alguno de la lista?

   Devuelve el producto con el que choca, o null. Lo usan el aviso de Admin y
   —por la misma regla— es lo que hace que la adivinanza calle: dos códigos que
   comparten el prefijo mínimo no se pueden distinguir cuando el ticket trae el
   más corto de los dos.

   ⚠️ LO QUE ROMPE ES QUE UNO SEA EL PRINCIPIO DEL OTRO, no que se parezcan
   *(6-sep-2026)*. `MICAHR` y `MICAHRPLUS` sí chocan: cuando llega un ticket de
   MICA HR los dos puntúan seis y la adivinanza calla. `CARGADOR100` y
   `CARGADORKIDS` comparten ocho letras y NO chocan: cada uno sigue por su lado,
   así que el ticket que trae uno completo lo distingue del otro.

   Mirar solo las letras comunes avisaba de los dos casos por igual, y eso no es
   avisar de más y ya: el segundo es exactamente el alias que hay que dar de alta
   para que el cargador de 100W se proponga solo. El aviso habría dicho «no hagas
   esto» justo en el cambio que arregla el fallo — y quien lo lee no tiene cómo
   saber que esa vez el aviso se equivoca.

   `saltarId` es el producto que se está editando: no choca consigo mismo.

   Con varios códigos por producto se miran TODOS contra TODOS: basta que un
   código del nuevo empate con un código de otro producto para que la propuesta
   quede rota, y avisar solo del primero de cada lado dejaría pasar justo el
   alias que se acaba de añadir. */
function accChoca(codigo, lista, saltarId){
  var nuevos = accCodigosDe(codigo)
                 .map(accClave)
                 .filter(function(c){ return c.length >= 4; });
  if(!nuevos.length) return null;
  for(var i = 0; i < lista.length; i++){
    var c = lista[i];
    if(!c || !c.activo || !c.articulo) continue;
    if(saltarId != null && c.id === saltarId) continue;
    var viejos = accCodigosDe(c.articulo).map(accClave);
    for(var j = 0; j < nuevos.length; j++){
      for(var k = 0; k < viejos.length; k++){
        if(viejos[k].length < 4) continue;
        var n = accPrefijo(viejos[k], nuevos[j]);
        // Uno es el principio del otro: el ticket que traiga el corto no los separa.
        if(n >= ACC_MIN_PREFIJO && (n === viejos[k].length || n === nuevos[j].length)) return c;
      }
    }
  }
  return null;
}

/* Para que las pruebas puedan cargarlo con require() sin navegador. */
if(typeof module !== 'undefined' && module.exports){
  module.exports = { ACC_OCR: ACC_OCR, accClave: accClave, accPrefijo: accPrefijo,
                     ACC_MIN_PREFIJO: ACC_MIN_PREFIJO, accChoca: accChoca,
                     accCodigosDe: accCodigosDe, accPrefijoMax: accPrefijoMax };
}
