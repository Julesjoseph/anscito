# Deja el DEMO como nuevo: borra SOLO la base anscito_demo y la vuelve a
# llenar con los catalogos del sistema real y datos inventados.
# El sistema real NO se toca.

$backend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$config = Join-Path (Split-Path -Parent $backend) 'publicado.json'
if (Test-Path $config) {
  $env:DOTENV_CONFIG_PATH = (Get-Content $config -Raw | ConvertFrom-Json).envPath
}

Write-Host ''
Write-Host 'REINICIAR ANSCITO DEMO' -ForegroundColor Yellow
Write-Host 'Se borran TODOS los datos del DEMO (las practicas) y se crean de nuevo.'
Write-Host 'El sistema REAL no se toca.'
$r = Read-Host 'Escriba SI para continuar'
if ($r -ne 'SI') {
  Write-Host 'No se hizo nada.'
  Read-Host 'Pulse Enter para cerrar'
  exit
}

# Si el servidor DEMO esta encendido, se apaga (se vuelve a abrir con "Iniciar DEMO").
$c = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($c) {
  Stop-Process -Id $c.OwningProcess -Force -Confirm:$false
  Write-Host 'Servidor DEMO apagado.'
}

Push-Location $backend
node scripts/demo/reiniciar-demo.js
$ok = $LASTEXITCODE -eq 0
Pop-Location

if ($ok) {
  Write-Host ''
  Write-Host 'DEMO reiniciado. Abralo con el acceso "ANSCITO DEMO".' -ForegroundColor Green
  Write-Host 'La nueva contrasena esta en el escritorio: "ANSCITO DEMO - usuarios.txt"'
}
Read-Host 'Pulse Enter para cerrar'
