# Abre ANSCITO DEMO (entrenamiento, version publicada) sin tocar el real:
#   servidor en el puerto 3001 con la base anscito_demo,
#   pantallas en el puerto 5174 con la franja amarilla "DEMO".
# Uso: el acceso directo "ANSCITO DEMO" del escritorio.

$scripts = Split-Path -Parent $PSScriptRoot
$backend = Split-Path -Parent $scripts
$raiz = Split-Path -Parent $backend
$config = Join-Path $raiz 'publicado.json'
$titulo = 'ANSCITO DEMO - servidor (no cerrar)'

if (-not (Test-Path $config)) {
  Write-Host 'Este acceso debe usarse desde la version publicada (SCITO-publicado).' -ForegroundColor Red
  Write-Host 'Publique primero con backend\scripts\publicar.ps1.'
  Read-Host 'Pulse Enter para cerrar'
  exit
}
$envPath = (Get-Content $config -Raw | ConvertFrom-Json).envPath


# Direcciones desde donde se pueden abrir las pantallas: esta laptop y,
# por Tailscale, su nombre y su IP (celulares y PCs autorizadas).
$equipo = $env:COMPUTERNAME.ToLower()
$origenes = @('http://localhost:5174', "http://${equipo}:5174")
try { $ipTs = (& tailscale ip -4 2>$null | Select-Object -First 1) } catch { $ipTs = $null }
if ($ipTs) { $origenes += "http://${ipTs}:5174" }
try { $dns = ((& tailscale status --json 2>$null) | ConvertFrom-Json).Self.DNSName.TrimEnd('.') } catch { $dns = $null }
if ($dns) { $origenes += "http://${dns}:5174" }
$cors = $origenes -join ','

function Escuchando($puerto) {
  return [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue)
}

# Verdadero si el programa que ocupa el puerto es de esta version publicada
# (lo dice su linea de comando o la de la ventana que lo abrio).
function EsPublicado($puerto) {
  $c = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $false }
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $($c.OwningProcess)"
  $padre = Get-CimInstance Win32_Process -Filter "ProcessId = $($p.ParentProcessId)"
  return ("$($p.CommandLine) $($padre.CommandLine)" -like "*$raiz*")
}
function Ocupado($puerto, $nombre) {
  Write-Host ''
  Write-Host "El puerto $puerto lo esta usando otro programa (una version anterior o el de PRUEBAS)." -ForegroundColor Red
  Write-Host "Cierre las ventanas de $nombre que esten abiertas y vuelva a abrir el acceso." -ForegroundColor Red
  Read-Host 'Pulse Enter para cerrar'
  exit
}

if (Escuchando 3001) {
  if (-not (EsPublicado 3001)) { Ocupado 3001 'ANSCITO DEMO' }
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$titulo'; " +
    "`$env:DOTENV_CONFIG_PATH = '$envPath'; `$env:DB_NAME = 'anscito_demo'; `$env:PORT = '3001'; " +
    "`$env:CORS_ORIGENES = '$cors'; Set-Location '$backend'; node dist/main.js"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}
if (Escuchando 5174) {
  if (-not (EsPublicado 5174)) { Ocupado 5174 'ANSCITO DEMO' }
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = 'ANSCITO DEMO - pantallas (no cerrar)'; " +
    "node '$scripts\servir-pantallas.js' '$raiz\pantallas-demo' 5174"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}

for ($i = 0; $i -lt 30 -and -not ((Escuchando 3001) -and (Escuchando 5174)); $i++) {
  Start-Sleep -Seconds 2
}
if ((Escuchando 3001) -and (Escuchando 5174)) {
  Start-Process 'http://localhost:5174'
  Write-Host 'Los usuarios y la contrasena estan en el escritorio: "ANSCITO DEMO - usuarios.txt"'
} else {
  Write-Host 'El DEMO no arranco. Revise las ventanas minimizadas "ANSCITO DEMO" para ver el error.' -ForegroundColor Red
  Read-Host 'Pulse Enter para cerrar'
}
