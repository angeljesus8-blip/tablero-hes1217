/* ============================================================
   Fase 1 · Comparar las TRECE lecturas: Apps Script contra Supabase
   4-ago-2026
   ============================================================

   Cómo se usa
   -----------
   Abrir el tablero con sesión iniciada, consola del navegador, pegar este
   archivo entero y esperar. Tarda ~30 s: el GAS va en cola.

   Por qué desde el navegador y no desde fuera: el endpoint exige token desde el
   4-ago. Aquí el token se toma de la sesión que ya existe y no sale de la
   página — no hay que copiarlo ni pegarlo en ningún lado.

   Qué contesta
   ------------
   Para cada lectura: IGUAL, DISTINTO o FALTA, y en qué. Compara CONJUNTOS y
   VALORES, no la forma: el GAS entrega objetos indexados y Supabase filas.

   Regla: mientras haya un DISTINTO sin explicar, no se pasa a la fase 2. Un
   "casi igual" aquí es un precio mal cobrado en el mostrador.
   ============================================================ */

(async () => {
  const cfg = JSON.parse(localStorage.getItem('hes_store') || '{}');
  if (!cfg.gas_url || !cfg.gas_token) {
    console.error('No hay sesión. Entra al tablero con tu PIN y vuelve a correr esto.');
    return;
  }
  const STORE = String(cfg.store_id || '1217');
  const SB_URL = 'https://rjdrljtujbwooejrpyqv.supabase.co';
  const SB_KEY = 'sb_publishable_mELjDmCaFpNOxcwPi5MB2A_qSZ5ZA2z';

  // ── llamadas ──────────────────────────────────────────────
  const gas = (modo, extra = '') => new Promise((res) => {
    const cb = 'cmp' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { limpiar(); res({ __error: 'timeout' }); }, 25000);
    function limpiar() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = (d) => { limpiar(); res(d); };
    s.src = cfg.gas_url + '?modo=' + modo + extra +
            '&t=' + encodeURIComponent(cfg.gas_token) + '&callback=' + cb;
    s.onerror = () => { limpiar(); res({ __error: 'red' }); };
    document.body.appendChild(s);
  });

  const sb = async (fn, body = {}) => {
    const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY,
                 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_store: STORE }, body))
    });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { __error: t.slice(0, 120) }; }
  };

  // ── ayudas de comparación ─────────────────────────────────
  const num = (x) => {
    const n = parseFloat(String(x == null ? '' : x).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  };
  const setDe = (a) => new Set(a.filter(Boolean).map(String));
  const difSet = (A, B) => ({
    solo_gas: [...A].filter((x) => !B.has(x)),
    solo_sb:  [...B].filter((x) => !A.has(x))
  });

  const R = [];
  const anota = (nombre, ok, detalle) => {
    R.push({ lectura: nombre, veredicto: ok, detalle });
    console.log((ok === 'IGUAL' ? '  ok    ' : '  DIST  ') + nombre + '   ' + (detalle || ''));
  };

  console.log('Comparando trece lecturas. Tienda ' + STORE + '. Paciencia, el GAS va en cola.\n');

  // ── 1 · inventario ────────────────────────────────────────
  {
    const g = await gas('inventario');
    const s = await sb('inventario_vivo');
    if (g.__error || s.__error) anota('inventario', 'FALTA', g.__error || s.__error);
    else {
      const A = setDe(Object.keys(g)), B = setDe(s.map((x) => x.sku));
      const d = difSet(A, B);
      const malos = [];
      s.forEach((x) => {
        const y = g[x.sku]; if (!y) return;
        const gStock = Math.max(0, (parseInt(y.o) || 0) - (parseInt(y.v) || 0));
        if (gStock !== x.stock || (parseInt(y.o) || 0) !== x.onhand ||
            (parseInt(y.e) || 0) !== x.exhibicion) malos.push(x.sku);
      });
      const ok = !d.solo_gas.length && !d.solo_sb.length && !malos.length;
      anota('inventario', ok ? 'IGUAL' : 'DISTINTO',
        `${A.size} gas / ${B.size} sb · faltan_sb:${d.solo_gas.length} sobran_sb:${d.solo_sb.length} · stock_distinto:${malos.length} ${malos.slice(0,5).join(',')}`);
    }
  }

  // ── 2 · promos ────────────────────────────────────────────
  {
    const g = await gas('promos');
    const s = await sb('promos_vigentes');
    if (g.__error || s.__error) anota('promos', 'FALTA', g.__error || s.__error);
    else {
      // el GAS devuelve TODAS; vigentes se filtra en el cliente por d1/d2
      const hoy = new Date().toISOString().slice(0, 10);
      const vig = Object.keys(g).filter((k) => g[k].d2 && g[k].d2 >= hoy &&
                                               (!g[k].d1 || g[k].d1 <= hoy));
      const A = setDe(vig), B = setDe(s.map((x) => x.sku));
      const d = difSet(A, B);
      const precioMal = s.filter((x) => g[x.sku] && num(g[x.sku].pp) !== num(x.precio_pro))
                         .map((x) => x.sku);
      const ok = !d.solo_gas.length && !d.solo_sb.length && !precioMal.length;
      anota('promos', ok ? 'IGUAL' : 'DISTINTO',
        `${A.size} vigentes gas / ${B.size} sb · faltan_sb:${d.solo_gas.length} sobran_sb:${d.solo_sb.length} · precio_distinto:${precioMal.length} ${precioMal.slice(0,5).join(',')}`);
    }
  }

  // ── 3 · eol_venta (el precio que se cobra) ────────────────
  {
    const g = await gas('eol_venta');
    const s = await sb('eol_precio_venta');
    if (g.__error || s.__error) anota('eol_venta', 'FALTA', g.__error || s.__error);
    else {
      const A = setDe(Object.keys(g)), B = setDe(s.map((x) => x.sku));
      const d = difSet(A, B);
      const mal = s.filter((x) => g[x.sku] != null && num(g[x.sku]) !== num(x.precio50))
                   .map((x) => x.sku);
      const ok = !d.solo_gas.length && !d.solo_sb.length && !mal.length;
      anota('eol_venta', ok ? 'IGUAL' : 'DISTINTO',
        `${A.size} gas / ${B.size} sb · dif_conjunto:${d.solo_gas.length + d.solo_sb.length} · precio50_distinto:${mal.length} ${mal.slice(0,5).join(',')}`);
    }
  }

  // ── 4 · bundles ───────────────────────────────────────────
  {
    const g = await gas('bundles');
    const s = await sb('bundles_vigentes');
    if (g.__error || s.__error) anota('bundles', 'FALTA', g.__error || s.__error);
    else anota('bundles', (g.length === s.length) ? 'IGUAL' : 'DISTINTO',
               `${g.length} gas / ${s.length} sb`);
  }

  // ── 5 · avisos ────────────────────────────────────────────
  {
    const g = await gas('avisos_cloud');
    const s = await sb('avisos_vigentes');
    if (g.__error || s.__error) anota('avisos', 'FALTA', g.__error || s.__error);
    else anota('avisos', (g.length === s.length) ? 'IGUAL' : 'DISTINTO',
               `${g.length} gas / ${s.length} sb`);
  }

  // ── 6 · ventas_hoy ────────────────────────────────────────
  {
    const g = await gas('ventas_hoy');
    const s = await sb('ventas_hoy');
    if (g.__error || s.__error) anota('ventas_hoy', 'FALTA', g.__error || s.__error);
    else {
      const gv = g.vend || {};
      const mal = [];
      Object.keys(gv).forEach((v) => {
        const f = s.find((x) => x.vendedor === v);
        if (!f || Number(f.con_seguro) !== gv[v].c || Number(f.sin_seguro) !== gv[v].s) mal.push(v);
      });
      anota('ventas_hoy', (!mal.length && Object.keys(gv).length === s.length) ? 'IGUAL' : 'DISTINTO',
            `${Object.keys(gv).length} vendedores gas / ${s.length} sb · distintos:${mal.length}`);
    }
  }

  // ── 7 · ventas_detalle (hoy) ──────────────────────────────
  {
    const hoy = new Date();
    const dGas = hoy.getDate() + '/' + (hoy.getMonth() + 1) + '/' + hoy.getFullYear();
    const g = await gas('ventas_detalle', '&fecha=' + encodeURIComponent(dGas));
    const s = await sb('ventas_detalle', { p_fecha: hoy.toISOString().slice(0, 10) });
    if (g.__error || s.__error) anota('ventas_detalle', 'FALTA', g.__error || s.__error);
    else {
      const A = setDe((g.ventas || []).map((x) => x.serie));
      const B = setDe(s.map((x) => x.serie));
      const d = difSet(A, B);
      anota('ventas_detalle', (!d.solo_gas.length && !d.solo_sb.length) ? 'IGUAL' : 'DISTINTO',
            `${A.size} series gas / ${B.size} sb · solo_gas:${d.solo_gas.length} solo_sb:${d.solo_sb.length}`);
    }
  }

  // ── 8 · catalogo ──────────────────────────────────────────
  // El GAS indexa por código de barras Y por 'sku:XXXX'. Se comparan los SKU,
  // que es lo que no puede faltar: si falta uno, es el bug de los códigos
  // comodín otra vez (seis productos compartiendo 6942100000000).
  {
    const g = await gas('catalogo');
    const s = await sb('catalogo_completo');
    if (g.__error || s.__error) anota('catalogo', 'FALTA', g.__error || s.__error);
    else {
      const A = setDe(Object.keys(g).filter((k) => k.startsWith('sku:')).map((k) => k.slice(4)));
      const B = setDe(s.map((x) => x.sku));
      const d = difSet(A, B);
      const descMal = s.filter((x) => {
        const y = g['sku:' + x.sku];
        return y && String(y.d || '').trim() && String(y.d).trim() !== String(x.descripcion || '').trim();
      }).map((x) => x.sku);
      const ok = !d.solo_gas.length && !d.solo_sb.length;
      anota('catalogo', ok ? 'IGUAL' : 'DISTINTO',
        `${A.size} sku gas / ${B.size} sb · faltan_sb:${d.solo_gas.length} ${d.solo_gas.slice(0,5).join(',')} · desc_distinta:${descMal.length}`);
    }
  }

  // ── 9 · eol_cloud ─────────────────────────────────────────
  {
    const g = await gas('eol_cloud');
    const s = await sb('eol_lista');
    if (g.__error || s.__error) anota('eol_cloud', 'FALTA', g.__error || s.__error);
    else {
      const A = setDe(g.map((x) => x.sku)), B = setDe(s.map((x) => x.sku));
      const d = difSet(A, B);
      anota('eol_cloud', (!d.solo_gas.length && !d.solo_sb.length) ? 'IGUAL' : 'DISTINTO',
            `${A.size} gas / ${B.size} sb · solo_gas:${d.solo_gas.length} solo_sb:${d.solo_sb.length}`);
    }
  }

  // ── 10 · apartados ────────────────────────────────────────
  {
    const g = await gas('apartados');
    const s = await sb('apartados_lista');
    if (g.__error || s.__error) anota('apartados', 'FALTA', g.__error || s.__error);
    else {
      // el GAS no da cupo ni apartadas: se comparan solo campos comunes
      const A = setDe(g.map((x) => x.sku + '|' + x.cliente));
      const B = setDe(s.map((x) => x.sku + '|' + x.cliente));
      const d = difSet(A, B);
      anota('apartados', (!d.solo_gas.length && !d.solo_sb.length) ? 'IGUAL' : 'DISTINTO',
            `${A.size} gas / ${B.size} sb · solo_gas:${d.solo_gas.length} solo_sb:${d.solo_sb.length}`);
    }
  }

  // ── 11 · comisiones ───────────────────────────────────────
  {
    const g = await gas('comisiones');
    const s = await sb('comisiones_lista');
    if (g.__error || s.__error) anota('comisiones', 'FALTA', g.__error || s.__error);
    else {
      const ge = g.empleados || [];
      const mal = ge.filter((e) => {
        const f = s.find((x) => x.nombre === e.nombre);
        return !f || num(f.venta) !== num(e.venta) || num(f.alcance) !== num(e.alcance);
      }).map((e) => e.nombre);
      anota('comisiones', (!mal.length && ge.length === s.length) ? 'IGUAL' : 'DISTINTO',
            `${ge.length} gas / ${s.length} sb · distintos:${mal.length}`);
    }
  }

  // ── 12 · estado ───────────────────────────────────────────
  // No puede dar idéntico a propósito: el GAS lee contadores escritos a mano en
  // cada subida; esto cuenta filas. Si difieren, sospechar del contador viejo.
  {
    const g = await gas('estado');
    const s = (await sb('estado_datos'))[0] || {};
    if (g.__error || s.__error) anota('estado', 'FALTA', g.__error || s.__error);
    else {
      const igual = Number(g.catCount) === Number(s.cat_count) &&
                    Number(g.promoCount) === Number(s.promo_count);
      anota('estado', igual ? 'IGUAL' : 'DISTINTO',
            `catalogo ${g.catCount} gas / ${s.cat_count} sb · promos ${g.promoCount} gas / ${s.promo_count} sb`);
    }
  }

  // ── 13 · todo ─────────────────────────────────────────────
  {
    const t0 = performance.now();
    const g = await gas('todo');
    const tGas = Math.round(performance.now() - t0);
    const t1 = performance.now();
    const s = await sb('tablero_todo');
    const tSb = Math.round(performance.now() - t1);
    if (g.__error || s.__error) anota('todo', 'FALTA', g.__error || s.__error);
    else {
      const faltan = ['inventario', 'promos', 'bundles', 'avisos', 'apartados', 'ventas_hoy']
        .filter((k) => s[k] === undefined);
      const invIgual = Object.keys(g.inventario || {}).length === (s.inventario || []).length;
      anota('todo', (!faltan.length && invIgual) ? 'IGUAL' : 'DISTINTO',
            `claves_faltantes:${faltan.join(',') || 'ninguna'} · inventario ${Object.keys(g.inventario||{}).length} gas / ${(s.inventario||[]).length} sb · TIEMPO gas ${tGas}ms vs sb ${tSb}ms`);
    }
  }

  // ── veredicto ─────────────────────────────────────────────
  const malos = R.filter((x) => x.veredicto !== 'IGUAL');
  console.log('\n───────────────────────────────');
  console.log(`${R.length - malos.length} de ${R.length} iguales.`);
  if (malos.length) {
    console.log('NO se pasa a la fase 2 hasta explicar cada una de estas:');
    malos.forEach((m) => console.log('   · ' + m.lectura + ' — ' + m.detalle));
  } else {
    console.log('Las trece coinciden. La fase 1 sí está cerrada.');
  }
  window.__cmp = R;   // queda en window por si hay que mirarlo con calma
})();
