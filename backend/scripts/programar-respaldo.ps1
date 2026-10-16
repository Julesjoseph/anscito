# Programa en Windows el respaldo semanal de ANSCITO (base real "anscito"):
# cada domingo a las 9:00 p. m. Si a esa hora la laptop esta apagada, se hace
# en cuanto se encienda y se inicie sesion.
# Se ejecuta una sola vez en cada laptop servidor (desde la carpeta SCITO):
#   powershell -ExecutionPolicy Bypass -File .\backend\scripts\programar-respaldo.ps1
# Para quitarlo:  Unregister-ScheduledTask -TaskName 'ANSCITO respaldo semanal'

$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$script = Join-Path $PSScriptRoot 'respaldo.js'
$node = (Get-Command node).Source

$accion = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" anscito" -WorkingDirectory $backend
$cuando = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '9:00PM'
$opciones = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$usuario = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName 'ANSCITO respaldo semanal' -Action $accion -Trigger $cuando `
  -Settings $opciones -Principal $usuario `
  -Description 'Respaldo semanal de la base anscito en C:\SCITO-respaldos y OneDrive (8 semanas)' -Force | Out-Null

$t = Get-ScheduledTask -TaskName 'ANSCITO respaldo semanal'
Write-Host "Programado: $($t.TaskName) - proximo: $((Get-ScheduledTaskInfo -TaskName $t.TaskName).NextRunTime)" -ForegroundColor Green
Write-Host 'Para probarlo ahora:  Start-ScheduledTask -TaskName ''ANSCITO respaldo semanal'''
Write-Host 'Resultado de cada respaldo: C:\SCITO-respaldos\respaldos.log'
