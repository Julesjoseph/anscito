# Abre ANSCITO REAL (version publicada): servidor en el puerto 3000 con la
# base "anscito" y pantallas en el puerto 5173.
# Uso: el acceso directo "ANSCITO" del escritorio.

$backend = Split-Path -Parent $PSScriptRoot
$raiz = Split-Path -Parent $backend
$config = Join-Path $raiz 'publicado.json'
$titulo = 'ANSCITO REAL - servidor (no cerrar)'

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
$origenes = @('http://localhost:5173', "http://${equipo}:5173")
try { $ipTs = (& tailscale ip -4 2>$null | Select-Object -First 1) } catch { $ipTs = $null }
if ($ipTs) { $origenes += "http://${ipTs}:5173" }
try { $dns = ((& tailscale status --json 2>$null) | ConvertFrom-Json).Self.DNSName.TrimEnd('.') } catch { $dns = $null }
if ($dns) { $origenes += "http://${dns}:5173" }
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

if (Escuchando 3000) {
  if (-not (EsPublicado 3000)) { Ocupado 3000 'ANSCITO' }
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$titulo'; " +
    "`$env:DOTENV_CONFIG_PATH = '$envPath'; `$env:DB_NAME = 'anscito'; `$env:PORT = '3000'; " +
    "`$env:CORS_ORIGENES ='$cors'; Set-Location '$backend'; node dist/main.js"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}

if (Escuchando 5173) {
  if (-not (EsPublicado 5173)) { Ocupado 5173 'ANSCITO' }
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = 'ANSCITO REAL - pantallas (no cerrar)'; " +
    "node '$PSScriptRoot\servir-pantallas.js' '$raiz\pantallas-real' 5173"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}

for ($i = 0; $i -lt 30 -and -not ((Escuchando 3000) -and (Escuchando 5173)); $i++) {
  Start-Sleep -Seconds 2
}
if ((Escuchando 3000) -and (Escuchando 5173)) {
  Start-Process 'http://localhost:5173'
} else {
  Write-Host 'ANSCITO no arranco. Revise las ventanas minimizadas "ANSCITO REAL" para ver el error.' -ForegroundColor Red
  Read-Host 'Pulse Enter para cerrar'
}
