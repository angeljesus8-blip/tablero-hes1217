/**
 * Concentrado HES 1217 — Hoja de Google
 * Pestañas: Ventas | Catalogo | Catalogo_ref | Catalogo_bak | Promos | Promos_bak | Bundles | EOL_cloud | Exhibicion
 *
 * ─────────────────────────────────────────────────────────────────────────
 * COPIA DE RESPALDO — proyecto "tablero 1217", al día 4-ago-2026
 *
 * Este archivo NO se ejecuta: es el espejo de lo que vive en Google, para que
 * exista en algún lado más. Si alguien borra el proyecto de Apps Script, sin
 * esto se perderían el tablero, Captura de Series y Admin de un golpe.
 *
 * Al cambiar el GAS, actualiza también este archivo. Si divergen, manda el
 * de Google — es el que corre. Y divergen con facilidad: entre el 2 y el
 * 4-ago se quedó 90 líneas por detrás sin que nada avisara, justo mientras se
 * le cambiaba la autenticación entera. La única señal fue contar las líneas.
 *
 * Mantenerlo al día es manual y tiene truco: la extensión de Chrome deja
 * ESCRIBIR en el editor pero no leer de él, así que el código no puede salir
 * solo. Hay que abrir el editor, Ctrl+A, Ctrl+C y pegarlo aquí.
 *
 * OJO: este repositorio es PÚBLICO. Ninguna llave va aquí adentro. Todas
 * viven en Configuración del proyecto → Propiedades del script:
 *   GAS_TOKEN · GAS_ESTRICTO · ADMIN_PIN · ONESIGNAL_APP_ID · ONESIGNAL_KEY
 * Las dos claves SINTOK_HOY y SINTOK_AYER las escribe solo el guardián.
 * ─────────────────────────────────────────────────────────────────────────
 */

var DIAS_RETENCION = 7;
var CARPETA_FOTOS  = 'Fotos Ventas HES 1217';
// El PIN de admin ya no vive en el codigo: se lee de Propiedades del script.
// Antes bastaba con '1217', que es el numero de tienda y esta publicado en el repo.
function adminPin_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '';
}

/* ===================== VENTAS ===================== */
function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Ventas');
  if (!sh) {
    sh = ss.insertSheet('Ventas');
    sh.appendRow(['Fecha','Hora','Numero de serie','SKU','Descripcion','Precio','Vendedor','id','Foto','Seguro']);
  } else if (sh.getRange(1,9).getValue() !== 'Foto') {
    sh.getRange(1,9).setValue('Foto');
  }
  if (sh.getRange(1,10).getValue() !== 'Seguro') sh.getRange(1,10).setValue('Seguro');
  return sh;
}
function carpeta_() {
  const it = DriveApp.getFoldersByName(CARPETA_FOTOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_FOTOS);
}
function guardarFoto_(dataUrl, d) {
  const m = String(dataUrl).match(/^data:(.*?);base64,(.*)$/);
  const type = m ? m[1] : 'image/jpeg';
  const bytes = Utilities.base64Decode(m ? m[2] : dataUrl);
  const nombre = String(d.fecha||'').replace(/\//g,'-')+'_'+(d.serie||'foto')+'_'+(d.id||'')+'.jpg';
  const file = carpeta_().createFile(Utilities.newBlob(bytes, type, nombre));
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
  return file.getUrl();
}
function eliminarVenta_(d) {
  const sh = sheet_();
  if (!d.id) return ok_();
  const last = sh.getLastRow();
  if (last < 2) return ok_();
  const ids = sh.getRange(2,8,last-1,1).getValues();
  for (var i=0; i<ids.length; i++) {
    if (String(ids[i][0])===String(d.id)) { sh.deleteRow(i+2); return ok_(); }
  }
  return ok_();
}
function guardarVenta_(d) {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (d.id && last>=2) {
    const ids = sh.getRange(2,8,last-1,1).getValues();
    for (let i=0; i<ids.length; i++) if (ids[i][0]===d.id) return ok_();
  }
  let fotoUrl = '';
  if (d.img) { try { fotoUrl = guardarFoto_(d.img, d); } catch(e) {} }
  sh.appendRow(["'"+(d.fecha||''), "'"+(d.hora||''), "'"+(d.serie||''), "'"+(d.sku||''),
                d.desc||'', d.precio||'', d.vend||'', d.id||'', fotoUrl,
                d.seguro === true ? 'Si' : d.seguro === false ? 'No' : '']);
  return ok_();
}
function leerVentas_() {
  const sh = sheet_();
  const v = sh.getDataRange().getValues();
  const out = [];
  for (let r=1; r<v.length; r++) {
    const x = v[r];
    if (!x[2] && !x[0]) continue;
    out.push({ fecha:fmtFecha_(x[0]), hora:String(x[1]||''), serie:String(x[2]||''),
               sku:String(x[3]||''), desc:String(x[4]||''), precio:String(x[5]||''),
               vend:String(x[6]||''), foto:String(x[8]||'') });
  }
  return out;
}

/* ===================== VENTAS DEL DIA (leaderboard Assurant) ===================== */
// Cuenta las ventas de hoy por vendedor, separando con y sin seguro, para el
// leaderboard del tablero. Antes ese leaderboard solo veia las capturas del
// propio celular; con esto ve las de toda la tienda.
function leerVentasHoy_() {
  const sh  = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Ventas');
  const out = { fecha: Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd'), vend: {} };
  if (!sh || sh.getLastRow() < 2) return out;

  // La app guarda la fecha como texto "28/7/2026" (sin ceros a la izquierda);
  // fmtFecha_ ya normaliza tanto el texto como las celdas tipo Date.
  const hoy = Utilities.formatDate(new Date(), 'America/Mexico_City', 'd/M/yyyy');
  const v = sh.getDataRange().getValues();

  for (var r = 1; r < v.length; r++) {
    if (fmtFecha_(v[r][0]) !== hoy) continue;                 // A - Fecha
    const vend = String(v[r][6] || '').trim();                // G - Vendedor
    if (!vend) continue;
    const seg = String(v[r][9] || '').trim().toLowerCase();   // J - Seguro
    if (!seg) continue;            // ventas viejas, sin el campo: no cuentan
    if (!out.vend[vend]) out.vend[vend] = { c: 0, s: 0 };
    if (seg === 'si') out.vend[vend].c++; else out.vend[vend].s++;
  }
  return out;
}

/* ===================== AUTOLLENADO MANUAL EN LA HOJA =====================
   Al escribir el SKU (col D) en la hoja Ventas, llena Descripción (E) y Precio
   (F) si están vacías, desde el catálogo. Es un disparador INSTALABLE: se activa
   corriendo instalarAutollenado() una vez (ahí pide el permiso). No se dispara
   con lo que escribe la app, solo con ediciones manuales en la hoja. */
function instalarAutollenado() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'autollenarSku_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autollenarSku_').forSpreadsheet(ss).onEdit().create();
  Logger.log('Autollenado instalado ✓');
}
function autollenarSku_(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== 'Ventas') return;
    const startCol = e.range.getColumn(), numCols = e.range.getNumColumns();
    if (startCol > 4 || startCol + numCols - 1 < 4) return;   // ¿toca la columna D (SKU)?
    const startRow = e.range.getRow(), numRows = e.range.getNumRows();
    for (var i = 0; i < numRows; i++) {
      const row = startRow + i;
      if (row < 2) continue;
      const sku = String(sh.getRange(row, 4).getValue()).trim();
      if (!sku) continue;
      const info = buscarProducto_(sku);
      if (!info) continue;
      const descCell = sh.getRange(row, 5), precioCell = sh.getRange(row, 6);
      if (info.desc   && !String(descCell.getValue()).trim())   descCell.setValue(info.desc);
      if (info.precio && !String(precioCell.getValue()).trim()) precioCell.setValue(info.precio);
    }
  } catch (err) { /* silencioso: nunca bloquear la edición */ }
}
// Busca un SKU en Catalogo (desc + precio) y, si no está, en Catalogo_ref (solo desc)
function buscarProducto_(sku) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cat = ss.getSheetByName('Catalogo');
  if (cat && cat.getLastRow() > 1) {
    const v = cat.getRange(2, 2, cat.getLastRow()-1, 4).getValues();   // B..E: SKU,Desc,OnHand,Precio
    for (var i=0; i<v.length; i++) {
      if (String(v[i][0]).trim() === sku) {
        return { desc: String(v[i][1]||'').trim(), precio: String(v[i][3]||'').replace(/[^0-9.]/g,'').trim() };
      }
    }
  }
  const ref = ss.getSheetByName('Catalogo_ref');
  if (ref && ref.getLastRow() > 1) {
    const v = ref.getRange(2, 1, ref.getLastRow()-1, 2).getValues();   // A..B: SKU,Desc
    for (var i=0; i<v.length; i++) {
      if (String(v[i][0]).trim() === sku) {
        return { desc: String(v[i][1]||'').trim(), precio: '' };
      }
    }
  }
  return null;
}

/* ===================== CATÁLOGO / INVENTARIO ===================== */
function actualizarCatalogo_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Catalogo');
  if (sh) {
    const bak = ss.getSheetByName('Catalogo_bak');
    if (bak) ss.deleteSheet(bak);
    sh.copyTo(ss).setName('Catalogo_bak');
    sh.clear();
  } else {
    sh = ss.insertSheet('Catalogo');
  }
  const rows = (d.rows||[]).map(function(r) {
    return ["'"+(r.upc||''), "'"+(r.sku||''), r.desc||'', r.onhand||'', r.precio||''];
  });
  sh.getRange(1,1,1,5).setValues([['UPC','SKU','Descripcion','OnHand','Precio']]);
  if (rows.length) sh.getRange(2,1,rows.length,5).setValues(rows);

  const ventasSh = ss.getSheetByName('Ventas');
  const baseline = {};
  if (ventasSh && ventasSh.getLastRow()>1) {
    const vv = ventasSh.getDataRange().getValues();
    for (var r=1; r<vv.length; r++) {
      const sku = String(vv[r][3]||'').trim();
      if (sku) baseline[sku] = (baseline[sku]||0) + 1;
    }
  }
  PropertiesService.getScriptProperties().setProperties({
    catCount: String(rows.length), catBy: String(d.by||''), catAt: new Date().toISOString(),
    ventaBaseline: JSON.stringify(baseline)
  });
  return ok_();
}
function leerCatalogo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = {};
  // Cada SKU lleva SIEMPRE su propia entrada 'sku:XXXX'.
  //
  // Antes el catalogo se indexaba SOLO por codigo de barras, y resulta que hay
  // codigos comodin compartidos por varios productos: 6942100000000 lo usan 6
  // (un MatePad y cinco FreeBuds). Al indexar por UPC se pisaban entre si y
  // sobrevivia uno solo; los demas desaparecian del catalogo entero y no se
  // autollenaban al teclear su SKU, sin ningun aviso.
  // (2-ago-2026, encontrado al migrar: le pasaba al MatePad 11.5 8/256GB, que
  //  es el unico de los seis que no esta tambien en la hoja Catalogo.)
  //
  // La entrada por codigo se conserva para el escaner. Si dos productos
  // comparten codigo el escaneo es ambiguo DE ORIGEN y no hay nada que hacer,
  // pero al menos ninguno desaparece y el tecleo por SKU siempre funciona.
  function guardar(upc, sku, datos, pisar) {
    if (!sku) return;
    out['sku:' + sku] = datos;
    if (upc && (pisar || !out[upc])) out[upc] = datos;
  }

  const ref = ss.getSheetByName('Catalogo_ref');
  if (ref && ref.getLastRow()>1) {
    const v = ref.getDataRange().getValues();
    for (let r=1; r<v.length; r++) {
      const sku = String(v[r][0]||'').trim(); if (!sku) continue;
      guardar(String(v[r][2]||'').trim(), sku,
              { s:sku, d:String(v[r][1]||'').trim(), o:'', p:'' }, false);
    }
  }
  const sh = ss.getSheetByName('Catalogo');
  if (sh && sh.getLastRow()>1) {
    const v = sh.getDataRange().getValues();
    for (let r=1; r<v.length; r++) {
      const sku = String(v[r][1]||'').trim(); if (!sku) continue;
      // El de Catalogo manda sobre el de Catalogo_ref: trae On Hand y precio.
      guardar(String(v[r][0]||'').trim(), sku,
              { s:sku, d:String(v[r][2]||''), o:String(v[r][3]||''), p:String(v[r][4]||'') }, true);
    }
  }
  return out;
}

/* ===================== CATÁLOGO DE REFERENCIA ===================== */
function actualizarCatalogoRef_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Catalogo_ref');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Catalogo_ref');
  sh.appendRow(['SKU','Descripcion','UPC']);
  // La comilla simple obliga a Sheets a guardarlo como TEXTO. Sin ella convierte
  // el codigo de barras a numero, y si viene en notacion cientifica lo redondea:
  // asi acabaron seis productos con el mismo 6942100000000. actualizarCatalogo_
  // ya lo hacia; esta funcion no. (2-ago-2026)
  const rows = (d.rows||[]).map(r => ["'"+(r.sku||''), r.desc||'', "'"+(r.upc||'')]);
  if (rows.length) sh.getRange(2,1,rows.length,3).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('catRefCount', String(rows.length));
  return ok_();
}
function leerCatalogoRef_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Catalogo_ref');
  if (!sh || sh.getLastRow()<2) return {};
  const v = sh.getDataRange().getValues();
  const out = {};
  for (let r=1; r<v.length; r++) {
    const sku = String(v[r][0]||'').trim(); if (!sku) continue;
    out[sku] = { d: String(v[r][1]||'').trim(), upc: String(v[r][2]||'').trim() };
  }
  return out;
}

/* ===================== EXHIBICIÓN ===================== */
function actualizarExhibicion_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Exhibicion');
  if (sh) ss.deleteSheet(sh);
  sh = ss.insertSheet('Exhibicion');
  sh.appendRow(['SKU','Exhibe']);
  const rows = (d.rows||[]).map(r => [String(r.sku||''), Number(r.exhibe)||0]);
  if (rows.length) sh.getRange(2,1,rows.length,2).setValues(rows);
  // Corte de exhibición: "foto" del total de ventas por SKU al subir el piso.
  // Es independiente del corte de ON HAND (que es diario), para que una pieza
  // de exhibición ya vendida no reaparezca con el ON HAND del día siguiente.
  const ventasSh = ss.getSheetByName('Ventas');
  const eb = {};
  if (ventasSh && ventasSh.getLastRow()>1) {
    const vv = ventasSh.getDataRange().getValues();
    for (var r=1; r<vv.length; r++) {
      const sku = String(vv[r][3]||'').trim();
      if (sku) eb[sku] = (eb[sku]||0) + 1;
    }
  }
  PropertiesService.getScriptProperties().setProperty('exhibBaseline', JSON.stringify(eb));
  return ok_();
}
function leerExhibicion_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Exhibicion');
  if (!sh || sh.getLastRow()<2) return {};
  const v = sh.getDataRange().getValues();
  const out = {};
  for (let r=1; r<v.length; r++) {
    const sku = String(v[r][0]||'').trim(); if (!sku) continue;
    out[sku] = Number(v[r][1])||0;
  }
  return out;
}

/* ===================== INVENTARIO EN VIVO ===================== */
function leerInventario_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inv = {};

  const catSh = ss.getSheetByName('Catalogo');
  if (catSh && catSh.getLastRow()>1) {
    const v = catSh.getDataRange().getValues();
    for (var r=1; r<v.length; r++) {
      const sku = String(v[r][1]||'').trim();
      if (sku) inv[sku] = { d:String(v[r][2]||'').trim(), o:parseInt(v[r][3])||0, v:0, e:0, ev:0, p:String(v[r][4]||'').trim() };
    }
  }

  const ref = ss.getSheetByName('Catalogo_ref');
  if (ref && ref.getLastRow()>1) {
    const v = ref.getDataRange().getValues();
    for (var r=1; r<v.length; r++) {
      const sku = String(v[r][0]||'').trim();
      if (sku && !inv[sku]) inv[sku] = { d:String(v[r][1]||'').trim(), o:0, v:0, e:0, ev:0, p:'' };
    }
  }

  const exhSh = ss.getSheetByName('Exhibicion');
  if (exhSh && exhSh.getLastRow()>1) {
    const v = exhSh.getDataRange().getValues();
    for (var r=1; r<v.length; r++) {
      const sku = String(v[r][0]||'').trim(); if (!sku) continue;
      if (inv[sku]) inv[sku].e = Number(v[r][1])||0;
      else inv[sku] = { d:'', o:0, v:0, e:Number(v[r][1])||0, ev:0, p:'' };
    }
  }

  var baseline = {};
  try { baseline = JSON.parse(PropertiesService.getScriptProperties().getProperty('ventaBaseline')||'{}'); } catch(e) {}
  var exhibBase = {};
  try { exhibBase = JSON.parse(PropertiesService.getScriptProperties().getProperty('exhibBaseline')||'{}'); } catch(e) {}

  // inv[sku].v acumula por ahora el TOTAL de ventas del SKU
  const ventasSh = ss.getSheetByName('Ventas');
  if (ventasSh && ventasSh.getLastRow()>1) {
    const v = ventasSh.getDataRange().getValues();
    for (var r=1; r<v.length; r++) {
      const sku = String(v[r][3]||'').trim();
      if (sku && inv[sku]) inv[sku].v++;
    }
  }

  Object.keys(inv).forEach(function(sku) {
    const total = inv[sku].v;                                // total de ventas del SKU
    inv[sku].v  = Math.max(0, total - (baseline[sku]||0));   // vendido desde el ON HAND (corte diario)
    inv[sku].ev = Math.max(0, total - (exhibBase[sku]||0));  // vendido desde la última subida de exhibición
  });

  return inv;
}

/* ===================== PROMOCIONES ===================== */
function actualizarPromos_(d) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Promos');
  if (sh) {
    const bak = ss.getSheetByName('Promos_bak');
    if (bak) ss.deleteSheet(bak);
    sh.copyTo(ss).setName('Promos_bak');
  } else {
    sh = ss.insertSheet('Promos');
  }
  const promoMap = {};
  const bakSh = ss.getSheetByName('Promos_bak');
  if (bakSh && bakSh.getLastRow()>1) {
    const v = bakSh.getDataRange().getValues();
    for (var r=1; r<v.length; r++) {
      const sku = String(v[r][0]||'').trim(); if (!sku) continue;
      promoMap[sku] = { sku,desc:String(v[r][1]||''),pr:String(v[r][2]||''),pp:String(v[r][3]||''),
                        est:String(v[r][4]||''),msi:String(v[r][5]||''),d1:String(v[r][6]||''),d2:String(v[r][7]||'') };
    }
  }
  (d.rows||[]).forEach(function(r) {
    promoMap[r.sku] = { sku:r.sku,desc:r.desc||'',pr:r.pr||'',pp:r.pp||'',
                        est:r.est||'',msi:r.msi||'',d1:r.d1||'',d2:r.d2||'' };
  });
  sh.clear();
  sh.getRange(1,1,1,8).setValues([['SKU','Descripcion','Precio','Promocion','Estatus','MSI','Desde','Hasta']]);
  const rows = Object.keys(promoMap).map(function(k) {
    const r=promoMap[k];
    return ["'"+r.sku, r.desc, r.pr, r.pp, r.est, r.msi, "'"+r.d1, "'"+r.d2];
  });
  if (rows.length) sh.getRange(2,1,rows.length,8).setValues(rows);
  PropertiesService.getScriptProperties().setProperties({
    promoCount:String(rows.length), promoBy:String(d.by||''),
    promoAt:new Date().toISOString(), promoVig:String(d.vig||'')
  });
  return ok_();
}
function leerPromos_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Promos');
  if (!sh) return {};
  const v = sh.getDataRange().getValues();
  const out = {};
  for (let r=1; r<v.length; r++) {
    const sku = String(v[r][0]||'').trim(); if (!sku) continue;
    out[sku] = { d:String(v[r][1]||''), pr:String(v[r][2]||''), pp:String(v[r][3]||''),
                 est:String(v[r][4]||''), msi:String(v[r][5]||''), d1:isoFecha_(v[r][6]), d2:isoFecha_(v[r][7]) };
  }
  return out;
}

/* ===================== COMISIONES Y EXTRACOBERTURA ===================== */
function sheetComisiones_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Comisiones');
  if (!sh) {
    sh = ss.insertSheet('Comisiones');
    sh.appendRow(['EmpNo','Nombre','Puesto','Venta','PptoPct','Alcance','GarantiaPct','GarantiaPzas','GarantiaElegible','GarantiaMonto']);
  }
  return sh;
}
function actualizarComisiones_(d) {
  var sh = sheetComisiones_();
  sh.clear();
  sh.appendRow(['EmpNo','Nombre','Puesto','Venta','PptoPct','Alcance','GarantiaPct','GarantiaPzas','GarantiaElegible','GarantiaMonto']);
  var rows = (d.rows||[]).map(function(r){
    var g = function(v){ return (v===null||v===undefined||v==='') ? '' : Number(v); };
    return [String(r.empNo||''), String(r.nombre||''), String(r.puesto||''),
            Number(r.venta)||0, Number(r.pptoPct)||0, Number(r.alcance)||0,
            g(r.garantiaPct), g(r.garantiaPzas), g(r.garantiaElegible), g(r.garantiaMonto)];
  });
  if (rows.length) sh.getRange(2,1,rows.length,10).setValues(rows);
  PropertiesService.getScriptProperties().setProperties({
    comisAt: Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd'),
    comisPeriodo: String(d.periodoComisiones||''),
    comisPeriodoGar: String(d.periodoGarantias||'')
  });
  return ok_();
}
function leerComisiones_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Comisiones');
  var p = PropertiesService.getScriptProperties();
  var out = { actualizado: p.getProperty('comisAt')||'', periodoComisiones: p.getProperty('comisPeriodo')||'',
              periodoGarantias: p.getProperty('comisPeriodoGar')||'', empleados: [] };
  if (!sh || sh.getLastRow()<2) return out;
  var v = sh.getDataRange().getValues();
  var n = function(x){ return x===''? null : Number(x); };
  for (var r=1; r<v.length; r++) {
    var x = v[r];
    if (!x[1]) continue;
    out.empleados.push({
      nombre:String(x[1]||''), puesto:String(x[2]||''), venta:Number(x[3])||0,
      pptoPct:Number(x[4])||0, alcance:Number(x[5])||0,
      garantiaPct:n(x[6]), garantiaPzas:n(x[7]), garantiaElegible:n(x[8]), garantiaMonto:n(x[9])
    });
  }
  return out;
}

/* ===================== ADMIN — PIN ===================== */
function checkPin_(e) {
  // El token ya autentica la llamada (ver accesoPermitido_), y es lo unico que
  // el tablero puede mandar: el asesor no tiene --ni debe tener-- el PIN de
  // admin. Mas estricto que antes, no menos: antes bastaba con mandar pin=1217
  // y el numero de tienda esta en el nombre del repo, en el titulo de la app y
  // en el QR. El token solo lo recibe quien paso por el login.
  var tok = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN') || '';
  var recibido = (e && e.parameter && e.parameter.t) || '';
  if (tok && recibido === tok) return true;

  // Se conserva el PIN para llamadas hechas fuera del tablero.
  var esperado = adminPin_();
  return !!esperado && e && e.parameter && String(e.parameter.pin || '') === esperado;
}

/* ===================== BUNDLES ===================== */
function sheetBundles_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Bundles');
  if (!sh) { sh=ss.insertSheet('Bundles'); sh.appendRow(['ID','Nombre','SKUs','Precio','Desde','Hasta','Activo']); }
  return sh;
}
function agregarBundle_(p) {
  const sh = sheetBundles_();
  const id = 'B'+Date.now();
  const skus = (p.skus||'').replace(/\|/g, ',').replace(/^,+|,+$/g, '');
  sh.appendRow([id, decodeURIComponent(p.nombre||''), "'"+skus, p.precio||'', p.d1||'', p.d2||'', 'si']);
  return {ok:true, id:id};
}
function eliminarBundle_(id) {
  const sh = sheetBundles_();
  if (sh.getLastRow()<2) return {ok:true};
  const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for (var i=0; i<ids.length; i++) {
    if (String(ids[i][0])===String(id)) { sh.deleteRow(i+2); return {ok:true}; }
  }
  return {ok:true};
}
function limpiarBundles_() {
  const sh = sheetBundles_();
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow()-1);
  return {ok:true};
}
function leerBundles_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Bundles');
  if (!sh || sh.getLastRow()<2) return [];
  const v = sh.getDataRange().getValues();
  // Fecha LOCAL: con toISOString (UTC) los combos se caian 6 h antes,
  // desde las 6 pm de su ultimo dia.
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const tz = Session.getScriptTimeZone();
  const out = [];
  for (var r=1; r<v.length; r++) {
    if (String(v[r][6]||'').toLowerCase() !== 'si') continue;
    const d1 = v[r][4] instanceof Date
      ? Utilities.formatDate(v[r][4], tz, 'yyyy-MM-dd')
      : String(v[r][4]||'').slice(0,10);
    const d2 = v[r][5] instanceof Date
      ? Utilities.formatDate(v[r][5], tz, 'yyyy-MM-dd')
      : String(v[r][5]||'').slice(0,10);
    if (d1 && hoy < d1) continue;
    if (d2 && hoy > d2) continue;
    const skus = String(v[r][2]||'').replace(/^'/,'');
    out.push({ id:String(v[r][0]), nombre:String(v[r][1]), skus:skus,
               precio:String(v[r][3]), d1:d1, d2:d2 });
  }
  return out;
}

/* ===================== APARTADOS DE PREVENTA ===================== */
function sheetApartados_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('Apartados');
  if (!sh) { sh=ss.insertSheet('Apartados'); sh.appendRow(['ID','Fecha','SKU','Color','Cliente','Telefono','Precio','Seguro','Vendedor','Estatus','Transaccion']); }
  return sh;
}
function agregarApartado_(p) {
  const sh = sheetApartados_();
  const id = 'A'+Date.now();
  const tz = Session.getScriptTimeZone();
  const fecha = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  sh.appendRow([id, "'"+fecha, "'"+(p.sku||''), decodeURIComponent(p.color||''),
                decodeURIComponent(p.cliente||''), "'"+(p.telefono||''), p.precio||'',
                p.seguro||'', decodeURIComponent(p.vend||''), 'Apartado', "'"+(p.transaccion||'')]);
  return {ok:true, id:id};
}
function apartadoEstatus_(id, estatus) {
  const sh = sheetApartados_();
  if (sh.getLastRow()<2) return {ok:false,error:'vacio'};
  const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for (var i=0;i<ids.length;i++){
    if (String(ids[i][0])===String(id)) { sh.getRange(i+2,10).setValue(estatus||'Entregado'); return {ok:true}; }
  }
  return {ok:false,error:'no encontrado'};
}
function eliminarApartado_(id) {
  const sh = sheetApartados_();
  if (sh.getLastRow()<2) return {ok:true};
  const ids = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for (var i=0;i<ids.length;i++){
    if (String(ids[i][0])===String(id)) { sh.deleteRow(i+2); return {ok:true}; }
  }
  return {ok:true};
}
function leerApartados_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Apartados');
  if (!sh || sh.getLastRow()<2) return [];
  const v = sh.getDataRange().getValues();
  const out = [];
  for (var r=1;r<v.length;r++){
    if (!v[r][0]) continue;
    out.push({ id:String(v[r][0]), fecha:String(v[r][1]||'').replace(/^'/,''),
               sku:String(v[r][2]||'').replace(/^'/,''), color:String(v[r][3]||''),
               cliente:String(v[r][4]||''), telefono:String(v[r][5]||'').replace(/^'/,''),
               precio:String(v[r][6]||''), seguro:String(v[r][7]||''),
               vend:String(v[r][8]||''), estatus:String(v[r][9]||'Apartado'),
               transaccion:String(v[r][10]||'').replace(/^'/,'') });
  }
  return out;
}

/* ===================== EOL EN LA NUBE ===================== */
function sheetEolCloud_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('EOL_cloud');
  if (!sh) { sh=ss.insertSheet('EOL_cloud'); sh.appendRow(['SKU','Precio','Activo']); }
  return sh;
}
function agregarEol_(p) {
  const sh = sheetEolCloud_();
  if (sh.getLastRow()>1) {
    const skus = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
    for (var i=0; i<skus.length; i++) {
      if (String(skus[i][0])===String(p.sku)) return {ok:true,existe:true};
    }
  }
  let precio = String(p.precio||'').trim();
  if (!precio) {
    const catSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Catalogo');
    if (catSh && catSh.getLastRow()>1) {
      const v = catSh.getDataRange().getValues();
      for (var r=1; r<v.length; r++) {
        if (String(v[r][1]||'').trim() === String(p.sku)) {
          precio = String(v[r][4]||'').trim();
          break;
        }
      }
    }
  }
  sh.appendRow([p.sku, precio, 'si']);
  return {ok:true};
}
function eliminarEol_(sku) {
  const sh = sheetEolCloud_();
  if (sh.getLastRow()<2) return {ok:true};
  const skus = sh.getRange(2,1,sh.getLastRow()-1,1).getValues();
  for (var i=0; i<skus.length; i++) {
    if (String(skus[i][0])===String(sku)) { sh.deleteRow(i+2); return {ok:true}; }
  }
  return {ok:true};
}
function leerEolCloud_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EOL_cloud');
  if (!sh || sh.getLastRow()<2) return [];
  const v = sh.getDataRange().getValues();
  const out = [];
  for (var r=1; r<v.length; r++) {
    if (String(v[r][2]||'').toLowerCase() !== 'si') continue;
    const sku = String(v[r][0]||''); if (!sku) continue;
    out.push({ sku:sku, precio:String(v[r][1]||'') });
  }
  return out;
}
// Precio 50% para los EOL cuya venta al 50% YA está activa (estado "listo":
// stock cerrado en 0 y aún queda pieza de exhibición). { sku: precio50 }
function leerEolVenta_() {
  const inv = leerInventario_();
  const eol = leerEolCloud_();
  const out = {};
  eol.forEach(function(item) {
    const cl = inv[item.sku];
    if (!cl) return;
    const stockCerrado  = Math.max(0, (cl.o||0) - (cl.v||0));
    const exhibRestante = Math.max(0, (cl.e||0) - Math.max(0, (cl.ev||0) - (cl.o||0)));
    if (stockCerrado === 0 && exhibRestante > 0) {          // estado "listo" → 50% activo
      const normal = parseFloat(String(item.precio||'').replace(/[^0-9.]/g,''))
                  || parseFloat(String(cl.p||'').replace(/[^0-9.]/g,'')) || 0;
      if (normal > 0) out[item.sku] = Math.round(normal / 2 * 100) / 100;
    }
  });
  return out;
}

/* ===================== NOTIFICACIONES PUSH (OneSignal) ===================== */
function notificar_(p) {
  var props  = PropertiesService.getScriptProperties();
  var appId  = props.getProperty('ONESIGNAL_APP_ID');
  var apiKey = props.getProperty('ONESIGNAL_KEY');
  if (!appId || !apiKey) return {ok:false, error:'OneSignal no configurado'};
  var res = UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', {
    method:          'post',
    contentType:     'application/json',
    headers:         { 'Authorization': 'Basic ' + apiKey },
    payload:         JSON.stringify({
      app_id:            appId,
      included_segments: ['All'],
      headings:          { es: 'HES Angelópolis 1217' },
      contents:          { es: decodeURIComponent(p.msg || 'Nueva información en el tablero') },
      url:               'https://angeljesus8-blip.github.io/tablero-hes1217/tablero.html'
    }),
    muteHttpExceptions: true
  });
  var r = JSON.parse(res.getContentText());
  Logger.log(r);
  return { ok: !r.errors, id: r.id };
}

function configurarOneSignal() {
  PropertiesService.getScriptProperties().setProperties({
    'ONESIGNAL_APP_ID': '',   // <- vaciado 2-ago-2026; ya vive en Propiedades del script
    'ONESIGNAL_KEY':    ''   // <- vaciado 2-ago-2026; ya vive en Propiedades del script
  });
  Logger.log('OneSignal configurado ✓');
}

/* ===================== AVISOS ===================== */
function sheetAvisos_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Avisos');
  if (!sh) {
    sh = ss.insertSheet('Avisos');
    sh.appendRow(['id','titulo','detalle','fecha','d2','prioridad','tipo']);
  }
  return sh;
}
function leerAvisos_() {
  var sh = sheetAvisos_();
  var v = sh.getDataRange().getValues();
  var hoy = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var d2 = String(v[r][4]||'');
    if (d2 && d2 < hoy) continue;
    out.push({ id:String(v[r][0]||''), titulo:String(v[r][1]||''),
      detalle:String(v[r][2]||''), fecha:String(v[r][3]||''),
      d2:d2, prioridad:String(v[r][5]||'normal'), tipo:String(v[r][6]||'manual') });
  }
  return out;
}
function guardarAviso_(d) {
  var sh = sheetAvisos_();
  var id = String(Date.now());
  var hoy = Utilities.formatDate(new Date(), 'America/Mexico_City', 'yyyy-MM-dd');
  var d2 = d.d2 || '';
  if (!d2) {
    var f7 = new Date(Date.now() + 7*24*60*60*1000);
    d2 = Utilities.formatDate(f7, 'America/Mexico_City', 'yyyy-MM-dd');
  }
  sh.appendRow([id, d.titulo||'', d.detalle||'', hoy, d2, d.prioridad||'normal', d.tipo_doc||'manual']);
  return {ok:true, id:id};
}
function eliminarAviso_(id) {
  var sh = sheetAvisos_();
  var v = sh.getDataRange().getValues();
  for (var r = v.length - 1; r >= 1; r--) {
    if (String(v[r][0]) === String(id)) { sh.deleteRow(r+1); return {ok:true}; }
  }
  return {ok:false, error:'No encontrado'};
}

/* ===================== ENTRADAS HTTP ===================== */
function doPost(e) {
  if (!accesoPermitido_(e)) return rechazar_(e);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.tipo === 'catalogo')     return actualizarCatalogo_(d);
    if (d.tipo === 'catalogo_ref') return actualizarCatalogoRef_(d);
    if (d.tipo === 'exhibicion')   return actualizarExhibicion_(d);
    if (d.tipo === 'comisiones')   return actualizarComisiones_(d);
    if (d.tipo === 'promos') {
      const r = actualizarPromos_(d);
      (d.rows||[]).forEach(function(row) {
        if (String(row.est||'').toUpperCase()==='EOL') {
          agregarEol_({sku:row.sku, precio:row.pp||''});
        }
      });
      return r;
    }
    if (d.tipo === 'eliminar') return eliminarVenta_(d);
    return guardarVenta_(d);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (!accesoPermitido_(e)) return rechazar_(e);
  const modo = e && e.parameter && e.parameter.modo;
  const cb   = e && e.parameter && e.parameter.callback;
  let payload;

  if      (modo === 'catalogo')      { payload = leerCatalogo_(); }
  else if (modo === 'catalogo_ref')  { payload = leerCatalogoRef_(); }
  else if (modo === 'exhibicion')    { payload = leerExhibicion_(); }
  else if (modo === 'promos')        { payload = leerPromos_(); }
  else if (modo === 'inventario')    { payload = leerInventario_(); }
  else if (modo === 'bundles')       { payload = leerBundles_(); }
  else if (modo === 'eol_cloud')     { payload = leerEolCloud_(); }
  else if (modo === 'eol_venta')     { payload = leerEolVenta_(); }
  else if (modo === 'avisos_cloud')  { payload = leerAvisos_(); }
  else if (modo === 'apartados')     { payload = leerApartados_(); }
  else if (modo === 'comisiones')    { payload = leerComisiones_(); }
  else if (modo === 'ventas_hoy')    { payload = leerVentasHoy_(); }
  else if (modo === 'todo') {
    // Todo en un solo viaje: Apps Script descarta las llamadas encimadas, asi que
    // el tablero las manda de una en una y seis viajes son ~20 s. Aqui es uno.
    payload = {
      inventario: leerInventario_(),
      eol:        leerEolCloud_(),
      promos:     leerPromos_(),
      bundles:    leerBundles_(),
      avisos:     leerAvisos_(),
      apartados:  leerApartados_(),
      ventas_hoy: leerVentasHoy_()
    };
  }
  else if (modo === 'bundle_add') {
    payload = checkPin_(e)
      ? agregarBundle_({nombre:e.parameter.nombre||'', skus:e.parameter.skus||'',
                        precio:e.parameter.precio||'', d1:e.parameter.d1||'', d2:e.parameter.d2||''})
      : {ok:false, error:'PIN incorrecto'};
  } else if (modo === 'bundle_del') {
    payload = checkPin_(e) ? eliminarBundle_(e.parameter.id||'') : {ok:false,error:'PIN incorrecto'};
  } else if (modo === 'bundle_clear') {
    payload = checkPin_(e) ? limpiarBundles_() : {ok:false,error:'PIN incorrecto'};
  } else if (modo === 'eol_add') {
    payload = checkPin_(e)
      ? agregarEol_({sku:e.parameter.sku||'', precio:e.parameter.precio||''})
      : {ok:false, error:'PIN incorrecto'};
  } else if (modo === 'eol_del') {
    payload = checkPin_(e) ? eliminarEol_(e.parameter.sku||'') : {ok:false,error:'PIN incorrecto'};
  /* PREVENTA — se mudó a Supabase el 7-ago-2026.
     Estos tres modos NO se borran: se cierran con un mensaje. Un asesor con la
     app vieja en la caché del service worker las sigue llamando, y si aquí se
     aceptara el apartado, entraría en una hoja que ya nadie lee: no saldría en
     el tablero, no contaría para el cupo y su pieza se vendería otra vez.
     Devolver el error hace que la app diga "no se guardó" —que es la verdad— en
     vez de guardarlo en el vacío.
     Se retiran del todo junto con el resto del script, en la etapa 5. */
  } else if (modo === 'apartado_add' || modo === 'apartado_estatus' || modo === 'apartado_del') {
    payload = {ok:false, error:'La preventa ya no se guarda aquí. Cierra la app y vuelve a abrirla para actualizarla.'};
  } else if (modo === 'aviso_add') {
    payload = checkPin_(e)
      ? guardarAviso_({titulo:e.parameter.titulo||'', detalle:e.parameter.detalle||'',
                       d2:e.parameter.d2||'', prioridad:e.parameter.prioridad||'normal',
                       tipo_doc:e.parameter.tipo_doc||'manual'})
      : {ok:false, error:'PIN incorrecto'};
  } else if (modo === 'aviso_del') {
    payload = checkPin_(e) ? eliminarAviso_(e.parameter.id||'') : {ok:false,error:'PIN incorrecto'};
  } else if (modo === 'notificar') {
    payload = checkPin_(e) ? notificar_(e.parameter) : {ok:false,error:'PIN incorrecto'};
  } else if (modo === 'estado') {
    const p = PropertiesService.getScriptProperties();
    payload = { catCount:Number(p.getProperty('catCount')||0), catBy:p.getProperty('catBy')||'',
                catAt:p.getProperty('catAt')||'', promoCount:Number(p.getProperty('promoCount')||0),
                promoBy:p.getProperty('promoBy')||'', promoAt:p.getProperty('promoAt')||'',
                promoVig:p.getProperty('promoVig')||'', ventasGid:String(sheet_().getSheetId()) };
  } else if (modo === 'ventas_detalle') {
    payload = leerVentasDetalle_(e.parameter.fecha || '');
  } else if (modo === 'exportar') {
    payload = exportarHoja_(e.parameter.hoja || '');
  } else {
    // Antes devolvia la hoja Ventas completa ante cualquier modo desconocido.
    return rechazar_(e);
  }

  const json = JSON.stringify(payload);
  return ContentService.createTextOutput(cb ? cb+'('+json+')' : json)
    .setMimeType(cb ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

/* ===================== UTILES ===================== */
function fmtFecha_(val) {
  if (val instanceof Date) return val.getDate()+'/'+(val.getMonth()+1)+'/'+val.getFullYear();
  return String(val||'');
}
function ok_() {
  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================== BORRADO DE FOTOS A 7 DÍAS ===================== */
function limpiarFotosViejas() {
  const limite = new Date(Date.now() - DIAS_RETENCION*24*60*60*1000);
  const files = carpeta_().getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getDateCreated() < limite) f.setTrashed(true);
  }
}
function instalarLimpieza() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction()==='limpiarFotosViejas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('limpiarFotosViejas').timeBased().everyDays(1).atHour(3).create();
}

/* ============================================================
   GUARDIAN DE ACCESO — agregado 30-jul-2026
   La URL /exec esta en tablero.html, que es publico. Sin esto cualquiera
   leia el inventario en vivo, las ventas por vendedor y la hoja Ventas
   completa con numeros de serie.
   Propiedades del script necesarias: GAS_TOKEN, GAS_ESTRICTO, ADMIN_PIN
   ============================================================ */

function accesoPermitido_(e) {
  var props    = PropertiesService.getScriptProperties();
  var esperado = props.getProperty('GAS_TOKEN') || '';
  var estricto = String(props.getProperty('GAS_ESTRICTO')).toLowerCase() === 'true';
  var recibido = (e && e.parameter && e.parameter.t) || '';
  if (esperado && recibido === esperado) return true;
  var modo = (e && e.parameter && e.parameter.modo) || '(sin modo)';
  Logger.log('SIN TOKEN VALIDO - modo=' + modo + ' estricto=' + estricto);
  contarSinToken_(props, modo);
  if (!esperado) {
    Logger.log('GAS_TOKEN no esta configurado en Propiedades del script.');
    return true;
  }
  return !estricto;
}

/** Cuenta las llamadas sin token donde si se puedan leer despues.
 *
 *  Por que no basta el Logger.log de arriba (3-ago-2026): el proyecto usa el
 *  GCP Predeterminado, asi que los registros de una aplicacion web se retienen
 *  muy poco. Al ir a comprobar la condicion para cerrar el candado, las 50
 *  ejecuciones del dia decian "No hay ningun registro disponible". Buscar la
 *  marca ahi devuelve cero, que es lo mismo que se ve cuando todo esta bien:
 *  la senal desaparecia antes de servir para decidir.
 *
 *  Propiedades del script no caduca y se lee desde Configuracion del proyecto.
 *
 *  Son dos claves fijas y no crecen: al cambiar el dia, lo de ayer se archiva
 *  en SINTOK_AYER y hoy empieza de cero.
 *
 *  El conteo puede quedarse corto si dos llamadas caen en el mismo instante
 *  (se pisan al escribir). No importa para lo que decide: interesa si hay
 *  alguna, no cuantas exactamente.
 *
 *  COMO SE LEE, que tiene trampa: un dia sin llamadas malas no escribe nada,
 *  asi que SINTOK_HOY se queda con la fecha del ultimo dia que si las tuvo.
 *  Lo que dice "hoy, cero" es que la fecha de dentro NO sea la de hoy. Mirar
 *  siempre el campo `dia` antes que los numeros.
 */
function contarSinToken_(props, modo) {
  try {
    var hoy = Utilities.formatDate(new Date(), 'GMT-6', 'yyyy-MM-dd');
    var d = {};
    try { d = JSON.parse(props.getProperty('SINTOK_HOY') || '{}'); } catch (err) { d = {}; }
    if (d.dia !== hoy) {
      if (d.dia) props.setProperty('SINTOK_AYER', JSON.stringify(d));
      d = { dia: hoy };
    }
    d[modo] = (d[modo] || 0) + 1;
    props.setProperty('SINTOK_HOY', JSON.stringify(d));
  } catch (err) {
    // Contar es diagnostico: si falla, la peticion tiene que seguir su curso
    // igual. Perder la cuenta no puede costarle una venta a nadie.
  }
}

function rechazar_(e) {
  var cb     = (e && e.parameter && e.parameter.callback) || '';
  var cuerpo = JSON.stringify({ error: 'no_autorizado' });
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + cuerpo + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(cuerpo)
    .setMimeType(ContentService.MimeType.JSON);
}

function probarGuardian() {
  var p = PropertiesService.getScriptProperties();
  var tok = p.getProperty('GAS_TOKEN');
  Logger.log('GAS_TOKEN: %s', tok ? 'configurado (' + tok.length + ' chars)' : 'FALTA');
  Logger.log('GAS_ESTRICTO: %s', p.getProperty('GAS_ESTRICTO'));
  Logger.log('ADMIN_PIN: %s', p.getProperty('ADMIN_PIN') ? 'configurado' : 'FALTA');
  Logger.log('token bueno -> %s', accesoPermitido_({parameter:{t:tok}}));
  Logger.log('token malo  -> %s', accesoPermitido_({parameter:{t:'xx'}}));
  Logger.log('sin token   -> %s', accesoPermitido_({parameter:{}}));
}


/* Normaliza una celda de fecha a yyyy-MM-dd, venga como Date, dd/MM/yyyy o ISO.
   Google Sheets convierte solo a tipo fecha lo que parece fecha al pegarlo, y
   entonces String(celda) daba 'Sat Aug 01 2026 00:00:00 GMT-0600...'. El tablero
   compara contra '2026-08-01' letra por letra y la promo nunca entraba. */
function isoFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + ('0'+m[2]).slice(-2) + '-' + ('0'+m[1]).slice(-2);
  return s.slice(0,10);
}


/* ===================== VENTAS DEL DIA — DETALLE ===================== */
// 2-ago-2026. Laura sube a otra plataforma la serie de cada equipo, una por una.
// leerVentasHoy_ no sirve: devuelve conteos por vendedor para el leaderboard,
// no las series. De ahi este modo, que usa Captura de Series.
function leerVentasDetalle_(fecha) {
  var sh = sheet_();
  if (!sh || sh.getLastRow() < 2) return { fecha: fecha || '', ventas: [] };
  var v = sh.getDataRange().getValues();
  // fmtFecha_ normaliza texto y Date: la hoja guarda "2/8/2026" sin ceros a la
  // izquierda, asi que comparar contra dd/MM/yyyy nunca coincidiria.
  var objetivo = fecha ? String(fecha).trim() : fmtFecha_(new Date());
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (fmtFecha_(v[r][0]) !== objetivo) continue;
    var serie = String(v[r][2] || '').trim();
    if (!serie) continue;                       // filas sin serie no le sirven
    out.push({
      serie:  serie,
      sku:    String(v[r][3] || '').trim(),
      desc:   String(v[r][4] || '').trim(),
      precio: String(v[r][5] || '').trim(),
      vend:   String(v[r][6] || '').trim(),
      seguro: String(v[r][9] || '').trim()
    });
  }
  return { fecha: objetivo, ventas: out };
}


/* ===================== EXPORTACION PARA MIGRAR ===================== */
// 2-ago-2026. TEMPORAL: existe solo para volcar las hojas a Supabase y se
// quita cuando termine la migracion.
//
// Devuelve filas como objetos usando la primera fila como nombres de columna,
// asi que si se agrega una columna a la hoja no hay que tocar esto.
//
// Lista blanca a proposito: este modo entrega TODO el historico, incluidos
// numeros de serie. Aunque el guardian ya exige token, no se deja abierto a
// cualquier hoja.
function exportarHoja_(nombre) {
  var PERMITIDAS = ['Ventas', 'Apartados', 'Comisiones'];
  if (PERMITIDAS.indexOf(nombre) < 0) {
    return { error: 'hoja no permitida', permitidas: PERMITIDAS };
  }
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return { hoja: nombre, filas: [] };

  var v   = sh.getDataRange().getValues();
  var cab = v[0].map(function (c) { return String(c || '').trim(); });
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var o = {}, vacia = true;
    for (var c = 0; c < cab.length; c++) {
      if (!cab[c]) continue;
      var val = v[r][c];
      // Sheets convierte a Date lo que le parece fecha; fmtFecha_ lo devuelve
      // al texto d/M/yyyy que es como lo guarda la app.
      o[cab[c]] = (val instanceof Date) ? fmtFecha_(val)
                : String(val === null || val === undefined ? '' : val);
      if (o[cab[c]] !== '') vacia = false;
    }
    if (vacia) continue;                      // filas en blanco al final
    // Fecha y hora van en columnas distintas y como texto. Se juntan aqui, del
    // lado que SI sabe la zona horaria: si esto se armara en la base, una venta
    // de las 8 pm se guardaria con la fecha del dia siguiente.
    if (nombre === 'Ventas') o._iso = isoVenta_(o['Fecha'], o['Hora']);
    out.push(o);
  }
  return { hoja: nombre, filas: out };
}

// '2/8/2026' + '03:16 p.m.'  ->  '2026-08-02T15:16:00-06:00'
// Sin hora reconocible cae a mediodia, que no se pasa de dia en ninguna zona.
function isoVenta_(fecha, hora) {
  var f = String(fecha || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!f) return '';
  var h = 12, mi = 0;
  var mh = String(hora || '').match(/(\d{1,2}):(\d{2})\s*([ap])/i);
  if (mh) {
    h  = parseInt(mh[1], 10) % 12;
    if (/p/i.test(mh[3])) h += 12;
    mi = parseInt(mh[2], 10);
  }
  var d = new Date(Number(f[3]), Number(f[2]) - 1, Number(f[1]), h, mi);
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}


/* Diagnóstico manual del candado. Vivía suelta en GAS_guardian.gs; se integra
   aquí el 7-ago-2026 para que este archivo sea el proyecto ENTERO y se pueda
   pegar completo sin perder nada.

   OJO al ejecutarla: en Apps Script una función que termina en `_` es privada y
   **no sale en el desplegable de Ejecutar**. Por eso existe el envoltorio
   `probarGuardian` de abajo, que sí aparece. El comentario original de
   `GAS_guardian.gs` decía "pruébalo desde el editor" sin avisar de esto, y
   quien lo intentó no encontró la función. */
function probarGuardian_() {
  var props = PropertiesService.getScriptProperties();
  var tok = props.getProperty('GAS_TOKEN');
  Logger.log('GAS_TOKEN configurado: %s', tok ? 'sí (' + tok.length + ' chars)' : 'NO');
  Logger.log('GAS_ESTRICTO: %s', props.getProperty('GAS_ESTRICTO'));
  Logger.log('con token bueno  → %s', accesoPermitido_({ parameter: { t: tok } }));
  Logger.log('con token malo   → %s', accesoPermitido_({ parameter: { t: 'xx' } }));
  Logger.log('sin token        → %s', accesoPermitido_({ parameter: {} }));
}

/* Envoltorio ejecutable de las pruebas manuales.
   Sin guion bajo A PROPÓSITO: es la única forma de que salgan en el desplegable
   de Ejecutar del editor. No las llama el router ni ningún cliente. */
function probarGuardian() { probarGuardian_(); }

/* Comprueba que la preventa quedó cerrada aquí (7-ago-2026). Debe registrar
   ok:false con el mensaje de "ya no se guarda aquí". Si registra ok:true, el
   bloqueo NO entró y además habrá dejado una fila 'PRUEBA BORRAR' en la hoja
   Apartados que hay que quitar a mano. */
function probarPreventaCerrada() {
  var tok = PropertiesService.getScriptProperties().getProperty('GAS_TOKEN');
  var r = doGet({ parameter: { modo:'apartado_add', t:tok, sku:'PRUEBA', cliente:'PRUEBA BORRAR' } });
  Logger.log(r.getContent());
}

/* Enseña la REST API Key de OneSignal en el registro, para poder copiarla.
   Sin guion bajo A PROPÓSITO: con él no saldría en el desplegable de Ejecutar.

   Existe porque las claves se sacaron del código el 2-ago y quedaron solo en
   Propiedades del script; cuando hizo falta moverlas a Supabase, no había forma
   cómoda de leerlas. NO compartas la salida ni una captura de ella: el app_id
   es público, la key no. */
function verClaveOneSignal() {
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty('ONESIGNAL_KEY') || '';
  Logger.log('ONESIGNAL_APP_ID: %s', p.getProperty('ONESIGNAL_APP_ID') || '(vacío)');
  Logger.log('ONESIGNAL_KEY:    %s', k || '(vacío)');
  Logger.log('largo de la key: %s caracteres', k.length);
}
