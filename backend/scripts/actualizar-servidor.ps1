# Pone al dia OTRA laptop servidor (por ejemplo SCITO-Server, con su propia
# base real) con lo ultimo que se publico en GitHub:
#   1. Revisa que ANSCITO este cerrado y que esta carpeta no tenga cambios.
#   2. Trae el codigo nuevo (git pull).
#   3. Revisa que migraciones le faltan a cada base (anscito y anscito_demo).
#   4. Con su confirmacion (y su copia de seguridad), las aplica en orden.
#   5. Publica la version nueva (publicar.ps1).
# Se detiene ante cualquier problema, sin seguir con los pasos siguientes.
# Uso (desde la carpeta SCITO):
#   powershell -ExecutionPolicy Bypass -File .\backend\scripts\actualizar-servidor.ps1

$ErrorActionPreference = 'Continue'
$backend = Split-Path -Parent $PSScriptRoot
$fuente = Split-Path -Parent $backend

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Parar($t) { Write-Host "`n$t" -ForegroundColor Red; exit 1 }

Paso 'Revisando que ANSCITO este cerrado'
$enUso = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*SCITO-publicado*' -and $_.Name -eq 'node.exe' }
if ($enUso) { Parar 'ANSCITO o el DEMO estan abiertos. Cierre sus ventanas y vuelva a ejecutar.' }

Paso 'Revisando que esta carpeta no tenga cambios propios'
Push-Location $fuente
$cambios = git status --porcelain
if ($cambios) {
  git status --short
  Pop-Location
  Parar 'Esta carpeta tiene cambios sin subir. No se actualiza: consulte con Claude antes.'
}

Paso 'Trayendo el codigo nuevo (git pull)'
$antes = git log -1 --format='%h'
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Pop-Location; Parar 'git pull fallo. No se cambio nada.' }
$despues = git log -1 --format='%h'
Write-Host "Version: $antes -> $despues"
Pop-Location

Paso 'Revisando las migraciones de cada base'
Push-Location $backend
$porAplicar = @()
foreach ($base in @('anscito', 'anscito_demo')) {
  $salida = node scripts\migraciones-pendientes.js $base 2>&1 | Out-String
  if ($salida -match 'does not exist|no existe') {
    Write-Host "${base}: esta laptop no tiene esa base (se omite)."
    continue
  }
  Write-Host $salida
  if ($LASTEXITCODE -ne 0) { Pop-Location; Parar "La revision de $base encontro un problema. No se cambio nada: consulte con Claude." }
  if ($salida -match 'Pendientes, en orden') { $porAplicar += $base }
}

if ($porAplicar.Count -gt 0) {
  Write-Host "`nBases con migraciones pendientes: $($porAplicar -join ', ')" -ForegroundColor Yellow
  $copia = Read-Host 'Hizo la copia de seguridad de esas bases en pgAdmin (Backup)? (s/n)'
  if ($copia -ne 's') { Pop-Location; Parar 'Haga primero la copia de seguridad y vuelva a ejecutar. El codigo ya se trajo; no se aplico nada.' }
  $ok = Read-Host 'Aplicar las migraciones pendientes ahora? (s/n)'
  if ($ok -ne 's') { Pop-Location; Parar 'No se aplico nada. No publique esta version hasta aplicarlas.' }
  foreach ($base in $porAplicar) {
    Paso "Aplicando migraciones en $base"
    node scripts\migraciones-pendientes.js $base aplicar
    if ($LASTEXITCODE -ne 0) { Pop-Location; Parar "Fallo una migracion en $base. NO se publico. Consulte con Claude (la copia de seguridad esta a salvo)." }
  }
} else {
  Write-Host "`nNinguna base tiene migraciones pendientes."
}
Pop-Location

Paso 'Publicando la version nueva'
& (Join-Path $PSScriptRoot 'publicar.ps1')
if ($LASTEXITCODE -ne 0) { Parar 'La publicacion fallo. Consulte con Claude.' }

Write-Host "`nServidor actualizado a la version $despues." -ForegroundColor Green
