# ============================================================
#  RESPALDO DE LO QUE GITHUB NO GUARDA
#  28-ago-2026
# ============================================================
#
#  El codigo del tablero ya esta respaldado: son 386 commits en GitHub y se
#  recupera entero con un `git clone`. Lo que NO esta ahi es justo lo que se
#  decidio no publicar, y de eso no habia ninguna copia.
#
#    _privado\   12 KB   los nombres del equipo y el mapeo al Excel regional.
#                        Sin datos_equipo.txt `verificar.py` falla; sin
#                        mapeo_nombres.sql no se puede repegar el mapeo y las
#                        comisiones dejan de sumarse. IRRECUPERABLE.
#    eol\       0.8 MB   los PDF del CEA. Se pueden volver a pedir, pero cuesta.
#
#  Se usa la variable $env:OneDrive y no una ruta escrita: este archivo se
#  versiona en un repo publico y la ruta lleva el nombre de usuario de Windows.
#
#  Uso:   .\respaldar_privado.ps1
#         .\respaldar_privado.ps1 -Revisar     (solo dice como esta, no copia)
# ============================================================

param([switch]$Revisar)

$ErrorActionPreference = 'Stop'
$origen  = $PSScriptRoot
$CARPETAS = @('_privado', 'eol')

if (-not $env:OneDrive -or -not (Test-Path $env:OneDrive)) {
  Write-Host "  No encuentro OneDrive." -ForegroundColor Red
  Write-Host "  Este script lo localiza con la variable OneDrive, y aqui esta vacia."
  exit 1
}
$destino = Join-Path $env:OneDrive 'Documentos\Respaldos HES 1217'

Write-Host ""
Write-Host "  Origen : $origen"
Write-Host "  Destino: $destino"
Write-Host ""

# Se compara por HASH y no por fecha de modificacion. Copiar un archivo le pone
# fecha nueva, asi que la fecha dice cuando se copio, no si el contenido es el
# mismo — y un respaldo que dice estar al dia sin estarlo es peor que no tenerlo.
$copiados = 0; $aldia = 0; $faltaban = 0

foreach ($carpeta in $CARPETAS) {
  $src = Join-Path $origen $carpeta
  if (-not (Test-Path $src)) {
    Write-Host "  [--]  $carpeta  no existe en el tablero, se salta" -ForegroundColor DarkGray
    continue
  }
  $dst = Join-Path $destino $carpeta
  if (-not $Revisar -and -not (Test-Path $dst)) {
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
  }

  foreach ($f in (Get-ChildItem $src -File)) {
    $copia = Join-Path $dst $f.Name
    $hayCopia = Test-Path $copia
    $igual = $hayCopia -and ((Get-FileHash $f.FullName).Hash -eq (Get-FileHash $copia).Hash)

    if ($igual) {
      $aldia++
      Write-Host ("  [ok]  {0}\{1}" -f $carpeta, $f.Name) -ForegroundColor DarkGray
    } elseif ($Revisar) {
      $faltaban++
      $que = if ($hayCopia) { 'la copia esta VIEJA' } else { 'NO hay copia' }
      Write-Host ("  [!!]  {0}\{1}  -  {2}" -f $carpeta, $f.Name, $que) -ForegroundColor Yellow
    } else {
      Copy-Item $f.FullName $copia -Force
      $copiados++
      Write-Host ("  [->]  {0}\{1}" -f $carpeta, $f.Name) -ForegroundColor Green
    }
  }
}

Write-Host ""
if ($Revisar) {
  if ($faltaban -gt 0) {
    Write-Host "  $faltaban archivo(s) sin respaldar. Corre el script sin -Revisar." -ForegroundColor Yellow
    exit 1
  }
  Write-Host "  Respaldo al dia ($aldia archivos)." -ForegroundColor Green
  exit 0
}

# COMPROBAR DESPUES DE COPIAR, no dar por hecho que Copy-Item funciono: un disco
# lleno o OneDrive a medio sincronizar dejan el archivo a medias sin dar error.
$mal = @()
foreach ($carpeta in $CARPETAS) {
  $src = Join-Path $origen $carpeta
  if (-not (Test-Path $src)) { continue }
  foreach ($f in (Get-ChildItem $src -File)) {
    $copia = Join-Path (Join-Path $destino $carpeta) $f.Name
    if (-not (Test-Path $copia) -or
        (Get-FileHash $f.FullName).Hash -ne (Get-FileHash $copia).Hash) {
      $mal += "$carpeta\$($f.Name)"
    }
  }
}

if ($mal.Count -gt 0) {
  Write-Host "  NO quedo bien copiado:" -ForegroundColor Red
  $mal | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  exit 1
}

Write-Host "  Respaldo completo: $copiados copiado(s), $aldia ya estaba(n) al dia." -ForegroundColor Green
Write-Host "  Comprobado archivo por archivo contra el original."
Write-Host ""
Write-Host "  OneDrive tarda un momento en subirlo. Mira que el icono de la" -ForegroundColor DarkGray
Write-Host "  carpeta tenga la palomita verde antes de apagar la maquina." -ForegroundColor DarkGray
Write-Host ""
