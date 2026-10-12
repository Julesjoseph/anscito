# Crea en el escritorio los accesos directos de ANSCITO:
#   ANSCITO (real), ANSCITO DEMO (entrenamiento) y Reiniciar ANSCITO DEMO.
# Se puede volver a ejecutar sin problema (reemplaza los accesos).

$scripts = $PSScriptRoot
$escritorio = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Acceso($nombre, $script, $icono, $descripcion) {
  $lnk = $shell.CreateShortcut((Join-Path $escritorio "$nombre.lnk"))
  $lnk.TargetPath = $ps
  $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
  $lnk.WorkingDirectory = Split-Path -Parent $script
  $lnk.IconLocation = $icono
  $lnk.Description = $descripcion
  $lnk.Save()
  Write-Host "Creado: $nombre" -ForegroundColor Green
}

Acceso 'ANSCITO' (Join-Path $scripts 'iniciar-anscito.ps1') `
  "$env:SystemRoot\System32\shell32.dll,15" 'Sistema real de SCITO ENTREPRISE'
Acceso 'ANSCITO DEMO' (Join-Path $scripts 'demo\iniciar-demo.ps1') `
  "$env:SystemRoot\System32\shell32.dll,23" 'Entrenamiento: datos inventados'
Acceso 'Reiniciar ANSCITO DEMO' (Join-Path $scripts 'demo\reiniciar-demo.ps1') `
  "$env:SystemRoot\System32\shell32.dll,238" 'Deja el DEMO como nuevo (no toca el sistema real)'
