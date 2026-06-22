# Deploy automatico a Netlify — HES 1217 Tablero del Equipo
# Ejecutar desde esta carpeta: ./deploy.ps1   (opcional: ./deploy.ps1 "mensaje")
$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
Set-Location $PSScriptRoot
$msg = if ($args[0]) { $args[0] } else { "Actualizacion tablero $(Get-Date -Format 'dd/MM/yyyy HH:mm')" }
netlify deploy --prod --dir . --message $msg
