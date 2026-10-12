# Abre ANSCITO DEMO (entrenamiento) sin tocar el sistema real:
#   servidor en el puerto 3001 con la base anscito_demo,
#   pantallas en el puerto 5174 con la franja amarilla "DEMO".
# Uso: clic derecho > Ejecutar con PowerShell (o el acceso directo del escritorio).

$backend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$frontend = Join-Path (Split-Path -Parent $backend) 'frontend'

function Escuchando($puerto) {
  return [bool](Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Path (Join-Path $backend 'dist\main.js'))) {
  Write-Host 'Preparando el servidor por primera vez (npm run build)...' -ForegroundColor Cyan
  Push-Location $backend
  npm run build
  Pop-Location
}

if (Escuchando 3001) {
  Write-Host 'El servidor DEMO ya estaba encendido.' -ForegroundColor Green
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = 'ANSCITO DEMO - servidor (no cerrar)'; " +
    "`$env:DB_NAME = 'anscito_demo'; `$env:PORT = '3001'; `$env:CORS_ORIGENES = 'http://localhost:5174'; " +
    "Set-Location '$backend'; node dist/main.js"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}

if (Escuchando 5174) {
  Write-Host 'Las pantallas DEMO ya estaban encendidas.' -ForegroundColor Green
} else {
  $cmd = "`$Host.UI.RawUI.WindowTitle = 'ANSCITO DEMO - pantallas (no cerrar)'; " +
    "`$env:VITE_MODO = 'demo'; `$env:VITE_API_URL = 'http://localhost:3001'; " +
    "Set-Location '$frontend'; npx vite --port 5174 --strictPort"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd -WindowStyle Minimized
}

# Espera a que las dos partes respondan (hasta 60 segundos).
for ($i = 0; $i -lt 30 -and -not ((Escuchando 3001) -and (Escuchando 5174)); $i++) {
  Start-Sleep -Seconds 2
}
if ((Escuchando 3001) -and (Escuchando 5174)) {
  Start-Process 'http://localhost:5174'
  Write-Host 'ANSCITO DEMO abierto en http://localhost:5174' -ForegroundColor Green
  Write-Host 'Los usuarios y la contrasena estan en el escritorio: "ANSCITO DEMO - usuarios.txt"'
} else {
  Write-Host 'El DEMO no arranco. Revise las ventanas minimizadas "ANSCITO DEMO" para ver el error.' -ForegroundColor Red
  Read-Host 'Pulse Enter para cerrar'
}
