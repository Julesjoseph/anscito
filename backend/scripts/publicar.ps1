# Publica la version actual del programa para el sistema REAL y el DEMO.
#   - Compila el servidor y las pantallas (una para el real y otra para el demo).
#   - Guarda la version anterior en SCITO-publicado-anterior (para volver atras).
#   - Copia la nueva a SCITO-publicado (solo lo que cambio).
#   - Rehace los accesos del escritorio.
# Las MIGRACIONES no las aplica este script: Claude las aplica a cada base
# (real, demo) con el visto bueno del dueno, antes de publicar.
# El archivo .env (claves) NO se copia: la version publicada lo lee de aqui.

# Cada paso se revisa por su resultado ($LASTEXITCODE); los avisos que
# imprimen las herramientas no detienen la publicacion.
$ErrorActionPreference = 'Continue'
$backend = Split-Path -Parent $PSScriptRoot
$fuente = Split-Path -Parent $backend
$frontend = Join-Path $fuente 'frontend'
$destino = Join-Path (Split-Path -Parent $fuente) 'SCITO-publicado'
$anterior = "$destino-anterior"

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Copiar($desde, $hasta, $extra) {
  $parametros = @($desde, $hasta, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') + $extra
  robocopy @parametros | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudo copiar $desde" }
}

# La version publicada no debe estar en uso mientras se reemplaza.
$enUso = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*SCITO-publicado*' -and $_.Name -eq 'node.exe' }
if ($enUso) {
  Write-Host 'ANSCITO o el DEMO estan abiertos. Cierre sus ventanas "ANSCITO REAL" y "ANSCITO DEMO" y vuelva a publicar.' -ForegroundColor Red
  exit 1
}

$tmp = Join-Path $env:TEMP 'scito-publicar'
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

# Se compila en una carpeta temporal: backend\dist lo usa el servidor de pruebas.
Paso 'Compilando el servidor'
Push-Location $backend
npx tsc -p tsconfig.build.json --outDir (Join-Path $tmp 'backend-dist')
if ($LASTEXITCODE -ne 0) { throw 'El servidor no compila' }
Pop-Location

Paso 'Compilando las pantallas (real y demo)'
Push-Location $frontend
npx tsc -b
if ($LASTEXITCODE -ne 0) { throw 'Las pantallas no compilan' }
$env:VITE_MODO = ''
$env:VITE_API_URL = 'http://localhost:3000'
npx vite build --outDir (Join-Path $tmp 'pantallas-real') --emptyOutDir
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las pantallas del real' }
$env:VITE_MODO = 'demo'
$env:VITE_API_URL = 'http://localhost:3001'
npx vite build --outDir (Join-Path $tmp 'pantallas-demo') --emptyOutDir
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar las pantallas del demo' }
Remove-Item Env:VITE_MODO, Env:VITE_API_URL -ErrorAction SilentlyContinue
Pop-Location

if (Test-Path $destino) {
  Paso 'Guardando la version anterior (SCITO-publicado-anterior)'
  Copiar $destino $anterior @()
}

Paso "Copiando la version nueva a $destino"
New-Item -ItemType Directory -Force $destino | Out-Null
Copiar (Join-Path $tmp 'backend-dist') (Join-Path $destino 'backend\dist') @()
Copiar (Join-Path $backend 'node_modules') (Join-Path $destino 'backend\node_modules') @()
Copiar (Join-Path $backend 'scripts') (Join-Path $destino 'backend\scripts') @('/XF', '*.pdf', 'probar-*.ps1')
Copy-Item (Join-Path $backend 'package.json') (Join-Path $destino 'backend\package.json') -Force
Copiar (Join-Path $fuente 'database') (Join-Path $destino 'database') @()
Copiar (Join-Path $tmp 'pantallas-real') (Join-Path $destino 'pantallas-real') @()
Copiar (Join-Path $tmp 'pantallas-demo') (Join-Path $destino 'pantallas-demo') @()

Push-Location $fuente
$version = (git log -1 --format='%h %cd' --date=format:'%Y-%m-%d %H:%M' 2>$null)
Pop-Location
@{
  envPath = (Join-Path $backend '.env')
  version = $version
  publicado = (Get-Date -Format 'yyyy-MM-dd HH:mm')
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $destino 'publicado.json')

Paso 'Rehaciendo los accesos del escritorio'
& (Join-Path $destino 'backend\scripts\crear-accesos-escritorio.ps1')

Write-Host "`nPublicado: version $version" -ForegroundColor Green
Write-Host 'Abra ANSCITO desde el escritorio para usar la version nueva.'
