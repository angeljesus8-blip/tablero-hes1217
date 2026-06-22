/* ============================================================
   TABLERO DEL EQUIPO — HES 1217 Angelópolis
   Archivo de DATOS. Ángel me comparte los comunicados / inventario
   y yo actualizo este archivo. La app lee de aquí automáticamente.

   Fechas en formato AAAA-MM-DD.  prioridad: "alta" resalta la tarjeta.
   ============================================================ */

window.DATOS = {
  // Se muestra como "Actualizado: ..." en la app
  actualizado: "2026-06-22 17:05",

  // 🔥 PROMOCIONES VIGENTES  (en espera del primer comunicado real)
  promos: [],

  // 🏷️ EOL / ÚLTIMA PIEZA EXHIBIDA AL 50%  (en espera de comunicado real)
  eol: [],

  // 📦 MERCANCÍA QUE ENTRA / NOVEDADES  (en espera de comunicado real)
  novedades: [],

  // 📊 INVENTARIO / EXISTENCIAS
  //   stock  = piezas para vender (equipo cerrado, "On Hand")
  //   exhibe = piezas abiertas en exhibición ("Cantidad No Disponible")
  //   Fuente: Informe Artículos Totales + Informe Inventario No Disponible.
  //   98 productos · 187 para vender · 69 en exhibición.
  inventario: [
    { producto: "AUDIF IN EAR HW F-BUDS PRO 4 BN", sku: "100245654", stock: 1, exhibe: 0 },
    { producto: "AUDIF IN EAR HW F-BUDS PRO 4 NG", sku: "100245646", stock: 1, exhibe: 0 },
    { producto: "AUDIF IN EAR HW F-BUDS PRO 4 VD", sku: "100245689", stock: 2, exhibe: 0 },
    { producto: "AUDIF IN EAR HW FREEBUDS 6 BN", sku: "100258121", stock: 1, exhibe: 0 },
    { producto: "AUDIF IN EAR HW FREEBUDS 6 MO", sku: "100258148", stock: 1, exhibe: 1 },
    { producto: "AUDIF IN EAR HW FREEBUDS 6 NG", sku: "100258105", stock: 1, exhibe: 0 },
    { producto: "AUDIF IN EAR HW FREEBUDS 7I NG", sku: "100274412", stock: 1, exhibe: 1 },
    { producto: "AUDIF IN EAR HW FREEBUDS 7I RS", sku: "100274439", stock: 2, exhibe: 1 },
    { producto: "AUDIF IN EAR HW FREEBUDS SE4 BN", sku: "100274404", stock: 0, exhibe: 1 },
    { producto: "AUDIF IN EAR HW FREEBUDS SE4 NG", sku: "100274391", stock: 0, exhibe: 1 },
    { producto: "AUDIF OVER EAR HWEI FREEARC NG", sku: "100250541", stock: 1, exhibe: 0 },
    { producto: "AUDIF OVER EAR HWEI FREEARC VD", sku: "100250568", stock: 5, exhibe: 0 },
    { producto: "AUDÍF IN EAR HW F-BUDS PRO 5 AN", sku: "100285218", stock: 7, exhibe: 1 },
    { producto: "AUDÍF IN EAR HW F-BUDS PRO 5 BN", sku: "100285200", stock: 0, exhibe: 1 },
    { producto: "AUDÍF IN EAR HW F-BUDS PRO 5 NG", sku: "100285197", stock: 5, exhibe: 1 },
    { producto: "AUDÍF IN EAR HW FREEBUDS SE2 AZ", sku: "100301003", stock: 3, exhibe: 0 },
    { producto: "AUDÍF IN EAR HW FREEBUDS SE2 BN", sku: "100300975", stock: 5, exhibe: 0 },
    { producto: "AUDÍF OPEN EAR HW FREECLIP 2 AZ", sku: "100280863", stock: 2, exhibe: 1 },
    { producto: "AUDÍF OPEN EAR HW FREECLIP 2 BN", sku: "100280855", stock: 2, exhibe: 1 },
    { producto: "AUDÍF OPEN EAR HW FREECLIP 2 NG", sku: "100280847", stock: 0, exhibe: 1 },
    { producto: "AUDÍF OPEN EAR HW FREECLIP 2 RS", sku: "100286085", stock: 0, exhibe: 1 },
    { producto: "HUAWEI BAND 11 1.62 AMLD AL BGE", sku: "100288161", stock: 2, exhibe: 0 },
    { producto: "HUAWEI BAND 11 1.62\" AMLD AL BN", sku: "100288144", stock: 5, exhibe: 1 },
    { producto: "HUAWEI BAND 11 1.62\" AMLD AL MO", sku: "100288152", stock: 3, exhibe: 0 },
    { producto: "HUAWEI BAND 11 1.62\" AMLD AL NG", sku: "100288128", stock: 2, exhibe: 1 },
    { producto: "HUAWEI BAND 11 1.62\" AMLD AL VD", sku: "100288179", stock: 0, exhibe: 1 },
    { producto: "HUAWEI BAND 11 PRO 1.62\" AL AZ", sku: "100288283", stock: 2, exhibe: 1 },
    { producto: "HUAWEI BAND 11 PRO 1.62\" AL NG", sku: "100288187", stock: 0, exhibe: 1 },
    { producto: "HUAWEI BAND 11 PRO 1.62\" AL VD", sku: "100288195", stock: 3, exhibe: 1 },
    { producto: "HUAWEI MATE 80 PRO 16/512GB DO", sku: "100293242", stock: 1, exhibe: 1 },
    { producto: "HUAWEI MATE 80 PRO 16/512GB NG", sku: "100293226", stock: 1, exhibe: 0 },
    { producto: "HUAWEI MATE X7 16GB 512GB NEGRO", sku: "100280871", stock: 1, exhibe: 1 },
    { producto: "HUAWEI MATE X7 16GB 512GB ROJO", sku: "100280880", stock: 0, exhibe: 1 },
    { producto: "HUAWEI MATE XT ULT 16GB 1TB NG", sku: "100250162", stock: 2, exhibe: 0 },
    { producto: "HUAWEI MATE XT ULT 16GB 1TB RJ", sku: "100250138", stock: 1, exhibe: 1 },
    { producto: "HUAWEI MATEPAD 11.5\" 8/128GB GR", sku: "100270526", stock: 1, exhibe: 0 },
    { producto: "HUAWEI MATEPAD 11.5\" 8/256GB GR", sku: "100270551", stock: 2, exhibe: 0 },
    { producto: "HUAWEI NOVA 14 6.7\" 12/512GB BN", sku: "100280759", stock: 0, exhibe: 1 },
    { producto: "HUAWEI NOVA 15 MAX 8GB 256GB DO", sku: "100302479", stock: 1, exhibe: 0 },
    { producto: "HUAWEI NOVA 15 MAX 8GB 256GB NG", sku: "100302452", stock: 1, exhibe: 0 },
    { producto: "HUAWEI NOVA 15 MAX 8GB 256GB VD", sku: "100302461", stock: 3, exhibe: 0 },
    { producto: "HUAWEI PURA 80 6.6\" 12/256GB BN", sku: "100272661", stock: 3, exhibe: 0 },
    { producto: "HUAWEI PURA 80 6.6\" 12/256GB DO", sku: "100272687", stock: 2, exhibe: 0 },
    { producto: "HUAWEI PURA 80 6.6\" 12/256GB NG", sku: "100272644", stock: 2, exhibe: 0 },
    { producto: "HUAWEI PURA 80 PRO 12/512GB BN", sku: "100269154", stock: 1, exhibe: 0 },
    { producto: "HUAWEI WATCH 5 42MM 1.38\" BN", sku: "100259520", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH 5 46MM TI 1.5\" PT", sku: "100259482", stock: 1, exhibe: 0 },
    { producto: "HUAWEI WATCH D2 1.82\" AMOLED AZ", sku: "100275028", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH D2 1.82\" AMOLED DO", sku: "100229371", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH D2 1.82\" AMOLED NG", sku: "100229363", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 4 1.82\" AL NG", sku: "100259554", stock: 8, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 4 PRO 1.82\" AZ", sku: "100259634", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 4 PRO 1.82\" VD", sku: "100259651", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 5 1.82\" VID BN", sku: "100295934", stock: 5, exhibe: 0 },
    { producto: "HUAWEI WATCH FIT 5 1.82\" VID NG", sku: "100295900", stock: 7, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 5 1.82\" VID PR", sku: "100295918", stock: 13, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 5 PRO 1.92\" BN", sku: "100295951", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 5 PRO 1.92\" NG", sku: "100295942", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH FIT 5 PRO 1.92\" NJ", sku: "100296646", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH GT RUNNER2 1.32 AZ", sku: "100288742", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH GT RUNNER2 1.32 NG", sku: "100288662", stock: 3, exhibe: 1 },
    { producto: "HUAWEI WATCH GT RUNNER2 1.32 NJ", sku: "100288671", stock: 4, exhibe: 1 },
    { producto: "HUAWEI WATCH GT5 PRO 46MM NG", sku: "100229321", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 1.32\" AMLD BN", sku: "100274973", stock: 8, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 1.32\" AMLD MO", sku: "100274990", stock: 3, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 1.47\" AMLD CF", sku: "100274906", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 1.47\" AMLD NG", sku: "100274877", stock: 4, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 1.47\" AMLD VD", sku: "100274914", stock: 1, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 PRO 1.47\" CAFÉ", sku: "100274949", stock: 1, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 PRO 1.47\" NG", sku: "100274922", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH GT6 PRO 1.47\" PT", sku: "100274931", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH ULT DESIGN 1.5\" PR", sku: "100283327", stock: 1, exhibe: 0 },
    { producto: "HUAWEI WATCH ULTIMATE 2 1.5\" AZ", sku: "100275010", stock: 2, exhibe: 1 },
    { producto: "HUAWEI WATCH ULTIMATE 2 1.5\" NG", sku: "100275001", stock: 1, exhibe: 1 },
    { producto: "HUAWEI WATCH WATCH KID AZ", sku: "100074525", stock: 0, exhibe: 1 },
    { producto: "HUAWEI WATCH WATCH KID RS", sku: "100074509", stock: 0, exhibe: 1 },
    { producto: "M-PENCIL HUAWEI 3RA GEN BLANCO", sku: "100220019", stock: 4, exhibe: 1 },
    { producto: "M-PENCIL PRO HUAWEI CD56 BLANCO", sku: "100276725", stock: 3, exhibe: 1 },
    { producto: "MATEBOOK 14 CU5 16GB 1TB GRSP", sku: "100286237", stock: 0, exhibe: 1 },
    { producto: "MATEBOOK D16 CI5 16GB 1TB GRIS", sku: "100279918", stock: 2, exhibe: 1 },
    { producto: "MATEPAD 11.5\" 12/256GB VD +TCL", sku: "100280724", stock: 0, exhibe: 1 },
    { producto: "MATEPAD 11.5\" 8/128GB +TECLD GR", sku: "100270542", stock: 1, exhibe: 0 },
    { producto: "MATEPAD 11.5\" 8/256GB +TECLD GR", sku: "100270577", stock: 4, exhibe: 1 },
    { producto: "MATEPAD 11.5\" 8/256GB +TECLD MO", sku: "100270585", stock: 1, exhibe: 0 },
    { producto: "MATEPAD 12X 12/256GB BN + TECLD", sku: "100276717", stock: 2, exhibe: 0 },
    { producto: "MATEPAD 12X 12/256GB VD + TECLD", sku: "100276696", stock: 0, exhibe: 1 },
    { producto: "MATEPAD MIN 8.8 12/256GB VD+FDA", sku: "100295475", stock: 7, exhibe: 1 },
    { producto: "MATEPAD PRO 12.2\" 12GB 512GB VD", sku: "100270593", stock: 0, exhibe: 1 },
    { producto: "MATEPAD PRO 13.2\" 12/512GB DO", sku: "100250576", stock: 0, exhibe: 1 },
    { producto: "MATEPAD SE KEY 11\" 8GB 128GB AZ", sku: "100219940", stock: 1, exhibe: 1 },
    { producto: "MATEPAD SE KEY 11\" 8GB 128GB GR", sku: "100219923", stock: 2, exhibe: 1 },
    { producto: "MESH HUAWEI 3 WS8100-32 2PZ", sku: "100102207", stock: 0, exhibe: 1 },
    { producto: "MESH HUAWEI X1PRO AC3600 NG PK", sku: "100276661", stock: 1, exhibe: 1 },
    { producto: "MESH HW X3PRO AC3600 +EXT NG PK", sku: "100282252", stock: 0, exhibe: 1 },
    { producto: "MOUSE HUAWEI CD26 SENSOR TOG GR", sku: "100256417", stock: 1, exhibe: 1 },
    { producto: "ROUTER HUAWEI AX2 WI-FI6 1500MB", sku: "100261822", stock: 0, exhibe: 1 },
    { producto: "ROUTER HUAWEI AX3S 3000MB NEGRO", sku: "100278940", stock: 2, exhibe: 1 },
    { producto: "ROUTER HUAWEI BE3 PRO 3600MB NG", sku: "100278931", stock: 3, exhibe: 0 }
  ],

  // 📢 AVISOS GENERALES / META DEL DÍA
  avisos: [
    {
      titulo: "Meta Assurant Attach: >25%",
      detalle: "Ofrecer garantía Assurant en CADA venta de smartphone y wearable. Es el KPI crítico de la tienda.",
      fecha: "2026-06-22",
      prioridad: "alta"
    }
  ]
};
