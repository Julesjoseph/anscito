# Pruebas de envios a Haiti (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-envios.ps1
# Crea un AGENTE, un CLIENTE, una BILLETERA HTG, una CUENTA RD$ y una CAJA
# DE PRUEBA. Registra envios, los confirma o rechaza, registra la entrega del
# agente y le paga la comision. NO cambia la tasa real.
# Al final deja todo en cero y desactivado. Los envios de prueba quedan en la
# base de desarrollo (no se borran) y usan numeros E-000001...

$API = 'http://localhost:3010'
# Cualquier error inesperado detiene el script en vez de seguir en cadena.
$ErrorActionPreference = 'Stop'

function Cuerpo($datos) {
  # PowerShell 5 envia el texto en otra codificacion; se manda en UTF-8.
  # La coma evita que PowerShell desarme la lista de bytes.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($datos | ConvertTo-Json -Depth 6))
  return ,$bytes
}

function Entrar($usuario) {
  $segura = Read-Host "Contrasena de $usuario" -AsSecureString
  $clave = [System.Net.NetworkCredential]::new('', $segura).Password
  try {
    $r = Invoke-RestMethod -Method Post -Uri "$API/auth/login" `
      -ContentType 'application/json' -Body (Cuerpo @{ username = $usuario; password = $clave })
  } catch {
    Write-Host "No se pudo entrar como $usuario. Revise la contrasena y que el backend este encendido." -ForegroundColor Red
    exit 1
  }
  @{ Authorization = "Bearer $($r.token)" }
}

function Llamar($metodo, $ruta, $cabeceras, $datos) {
  $p = @{ Method = $metodo; Uri = "$API$ruta"; ContentType = 'application/json' }
  if ($cabeceras) { $p.Headers = $cabeceras }
  if ($null -ne $datos) { $p.Body = Cuerpo $datos }
  # Guardar y devolver la respuesta hace que las listas se recorran fila por fila.
  $respuesta = Invoke-RestMethod @p
  $respuesta
}

# Espera un error con un codigo concreto (400, 401, 403, 409...).
function EsperarError($nombre, $codigo, [scriptblock]$accion) {
  try {
    & $accion | Out-Null
    Write-Host "FALLO  $nombre -> no dio error (se esperaba $codigo)" -ForegroundColor Red
  } catch {
    $real = [int]$_.Exception.Response.StatusCode
    $mensaje = ''
    try { $mensaje = ($_.ErrorDetails.Message | ConvertFrom-Json).message } catch { }
    if ($real -eq $codigo) {
      Write-Host "OK     $nombre -> $real $mensaje" -ForegroundColor Green
    } else {
      Write-Host "FALLO  $nombre -> $real $mensaje (se esperaba $codigo)" -ForegroundColor Red
    }
  }
}

function Ok($nombre, $detalle) {
  Write-Host "OK     $nombre $detalle" -ForegroundColor Green
}

# Compara el valor real con el esperado y lo marca en verde o rojo.
function Comparar($nombre, $real, $esperado) {
  if ("$real" -eq "$esperado") {
    Write-Host "OK     $nombre -> $real" -ForegroundColor Green
  } else {
    Write-Host "FALLO  $nombre -> $real (se esperaba $esperado)" -ForegroundColor Red
  }
}


function VaciarCuenta($cuenta, $tasa) {
  $pend = Llamar 'Get' '/bancos/pendientes' $admin
  foreach ($m in @($pend.porConfirmar) | Where-Object { $_.cuenta_id -eq $cuenta.id }) {
    Llamar 'Post' "/bancos/movimientos/$($m.id)/confirmar" $admin @{ resultado = 'confirmado' } | Out-Null
  }
  $actual = @(Llamar 'Get' '/bancos/cuentas' $admin) | Where-Object { $_.id -eq $cuenta.id }
  if ([decimal]$actual.disponible -gt 0) {
    Llamar 'Post' "/bancos/cuentas/$($cuenta.id)/movimientos" $admin @{ tipo = 'cargo'; monto = $actual.disponible; tasa = $tasa; motivo = 'Cierre de cuenta de prueba' } | Out-Null
  }
  Llamar 'Patch' "/bancos/cuentas/$($cuenta.id)/estado" $admin @{ is_active = $false; motivo = 'Cuenta de prueba' } | Out-Null
}


Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'

Write-Host "`n== Limpiar restos de una prueba anterior ==" -ForegroundColor Cyan
foreach ($vieja in @(Llamar 'Get' '/bancos/cuentas' $admin) | Where-Object { $_.codigo -like 'PRB-*' -and $_.is_active }) {
  $t = if ($vieja.moneda -eq 'USD') { '60.50' } elseif ($vieja.moneda -eq 'HTG') { '0.48' } else { '1' }
  VaciarCuenta $vieja $t
  Ok 'cuenta de prueba anterior vaciada y desactivada:' $vieja.codigo
}
foreach ($vieja in @(Llamar 'Get' '/caja/cajas' $admin) | Where-Object { $_.codigo -like 'PRUEBA-*' -and $_.is_active }) {
  if ($vieja.sesion_id) {
    Llamar 'Post' "/caja/sesiones/$($vieja.sesion_id)/cerrar" $admin @{ conteo = @{}; motivo = 'Cierre de caja de prueba que quedo abierta' } | Out-Null
  }
  Llamar 'Patch' "/caja/cajas/$($vieja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
  Ok 'caja de prueba anterior cerrada y desactivada:' $vieja.codigo
}
foreach ($viejo in @(Llamar 'Get' '/remesas/agentes' $admin) | Where-Object { $_.codigo -like 'PRB-*' -and $_.is_active }) {
  try {
    Llamar 'Patch' "/remesas/agentes/$($viejo.id)/estado" $admin @{ is_active = $false; motivo = 'Agente de prueba' } | Out-Null
    Ok 'agente de prueba anterior desactivado:' $viejo.codigo
  } catch {
    Write-Host "AVISO  el agente de prueba $($viejo.codigo) quedo con envios o dinero pendiente; reviselo en Envios" -ForegroundColor Yellow
  }
}

Write-Host "`n== Preparar datos de prueba ==" -ForegroundColor Cyan
$nat = Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-H$sello"; tipo = 'billetera'; entidad = 'NatCash'; nombre = "NatCash prueba $sello"; moneda = 'HTG' }
Llamar 'Post' "/bancos/cuentas/$($nat.id)/saldo-inicial" $admin @{ monto = '10000'; tasa = '0.48' } | Out-Null
$pop = Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-D$sello"; tipo = 'banco'; entidad = 'Banco de prueba'; nombre = "Pesos prueba envios $sello"; tipoCuenta = 'corriente'; moneda = 'DOP' }
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-$sello"; nombre = "Caja prueba envios $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' }
$agente = Llamar 'Post' '/remesas/agentes' $admin @{ codigo = "PRB-A$sello"; nombre = "Agente prueba $sello"; tipo = 'autorizado'; frecuenciaPago = 'semanal'; grupoWhatsapp = 'Grupo de prueba' }
$tipos = Llamar 'Get' '/clientes/tipos-documento' $admin
$pasaporte = ($tipos | Where-Object { $_.codigo -eq 'pasaporte' }).id
$cliente = Llamar 'Post' '/clientes' $admin @{ tipoDocumentoId = $pasaporte; numeroDocumento = "PRB$sello"; nombre = "Remitente prueba $sello"; telefono = '829-000-0000'; esContribuyente = $false; puedeCredito = $false }
$sinDoc = Llamar 'Post' '/clientes' $admin @{ nombre = "Remitente sin documento $sello"; esContribuyente = $false; puedeCredito = $false }
Ok 'billetera HTG 10,000, cuenta RD$, caja en 0, agente, 2 clientes:' "PRB-A$sello"

$prep = Llamar 'Get' '/remesas/preparar' $admin
Ok 'tasa y comisiones vigentes:' "$($prep.tarifa.tasa) HTG por RD$, comision $($prep.tarifa.comision_pct)%, agente $($prep.tarifa.comision_agente_pct)%"
$motivo = $prep.motivos[0].id
$calc = Llamar 'Post' '/remesas/calcular' $admin @{ agenteId = $agente.id; montoEnviado = '1000' }
Ok 'calculo de RD$1,000:' "recibe HTG $($calc.monto_recibir), comision $($calc.comision), total $($calc.total_pagar), agente $($calc.comision_agente)"

function Enviar($monto, $extra) {
  $d = @{ agenteId = $agente.id; remitenteId = $cliente.id; parentesco = 'Hermana'; motivoEnvioId = $motivo; cuentaId = $nat.id; montoEnviado = $monto }
  if ($script:ben) { $d.beneficiarioId = $script:ben } else { $d.beneficiarioNuevo = @{ nombre = 'Beneficiario Script Prueba'; telefono = '509-99-99-9999' } }
  if ($extra) { foreach ($k in $extra.Keys) { $d[$k] = $extra[$k] } }
  Llamar 'Post' '/remesas/envios' $admin $d
}
$script:ben = $null

Write-Host "`n== Registrar envios (quedan pendientes) ==" -ForegroundColor Cyan
EsperarError 'remitente sin documento' 400 { Enviar '1000' @{ remitenteId = $sinDoc.id } }
EsperarError 'sin parentesco' 400 { Enviar '1000' @{ parentesco = '' } }
EsperarError 'billetera en pesos' 400 { Enviar '1000' @{ cuentaId = $pop.id } }
$e1 = Enviar '1000' $null
Comparar 'envio 1: a recibir / total a pagar' "$($e1.monto_recibir) / $($e1.total_pagar)" "$($calc.monto_recibir) / $($calc.total_pagar)"
$script:ben = (@(Llamar 'Get' '/remesas/beneficiarios?texto=509-99-99-9999' $admin))[0].id
$e2 = Enviar '500' $null
$e3 = Enviar '300' $null
$e4 = Enviar '9000' $null
Ok 'envios registrados:' "$($e1.numero), $($e2.numero), $($e3.numero), $($e4.numero)"

Write-Host "`n== Confirmar o rechazar (operador Haiti) ==" -ForegroundColor Cyan
EsperarError 'confirmar sin codigo de NatCash' 400 { Llamar 'Post' "/remesas/envios/$($e1.id)/confirmar" $admin @{ codigoExterno = '' } }
Llamar 'Post' "/remesas/envios/$($e1.id)/confirmar" $admin @{ codigoExterno = "P1$sello" } | Out-Null
EsperarError 'mismo codigo en otro envio' 409 { Llamar 'Post' "/remesas/envios/$($e2.id)/confirmar" $admin @{ codigoExterno = "P1$sello" } }
EsperarError 'confirmar otra vez el envio 1' 400 { Llamar 'Post' "/remesas/envios/$($e1.id)/confirmar" $admin @{ codigoExterno = "P9$sello" } }
Llamar 'Post' "/remesas/envios/$($e2.id)/confirmar" $admin @{ codigoExterno = "P2$sello" } | Out-Null
EsperarError 'no alcanzan las gourdes (envio de RD$9,000)' 400 { Llamar 'Post' "/remesas/envios/$($e4.id)/confirmar" $admin @{ codigoExterno = "P4$sello" } }
EsperarError 'rechazar sin motivo' 400 { Llamar 'Post' "/remesas/envios/$($e3.id)/rechazar" $admin @{ motivo = '' } }
Llamar 'Post' "/remesas/envios/$($e3.id)/rechazar" $admin @{ motivo = 'Numero de NatCash equivocado' } | Out-Null
Llamar 'Post' "/remesas/envios/$($e4.id)/rechazar" $admin @{ motivo = 'No hay saldo en la billetera' } | Out-Null
$h = @(Llamar 'Get' '/bancos/cuentas' $admin) | Where-Object { $_.id -eq $nat.id }
Comparar 'billetera: 10000 - 2050 - 1025' $h.disponible '6925.00'

Write-Host "`n== Lo que debe el agente ==" -ForegroundColor Cyan
function Cuenta { @(Llamar 'Get' '/remesas/cuentas-agentes' $admin) | Where-Object { $_.id -eq $agente.id } }
$ca = Cuenta
Comparar 'debe entregar / comision pendiente' "$($ca.debe) / $($ca.comision_pendiente)" '1650.00 / 75.00'
$rep = Llamar 'Get' '/remesas/reporte-dia' $admin
$fila = @($rep.agentes) | Where-Object { $_.id -eq $agente.id }
Comparar 'reporte del dia: confirmados / rechazados / a entregar' "$($fila.confirmados) / $($fila.rechazados) / $($fila.a_entregar)" '2 / 2 / 1650.00'
EsperarError 'entrega mayor que lo que debe' 400 { Llamar 'Post' '/remesas/entregas' $admin @{ agenteId = $agente.id; monto = '1650.01'; forma = 'efectivo'; cajaId = $caja.id } }
Llamar 'Post' '/remesas/entregas' $admin @{ agenteId = $agente.id; monto = '1000'; forma = 'efectivo'; cajaId = $caja.id } | Out-Null
Llamar 'Post' '/remesas/entregas' $admin @{ agenteId = $agente.id; monto = '650'; forma = 'deposito'; cuentaId = $pop.id; referencia = 'Boleta prueba' } | Out-Null
Comparar 'el agente ya no debe' (Cuenta).debe '0.00'
Comparar 'caja: entro la entrega en efectivo' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '1000.00'

Write-Host "`n== Pago de comision ==" -ForegroundColor Cyan
$pago = Llamar 'Post' '/remesas/pagos-comision' $admin @{ agenteId = $agente.id; forma = 'efectivo'; cajaId = $caja.id }
Comparar 'comision pagada (2 envios)' "$($pago.monto) / $($pago.envios)" '75.00 / 2'
EsperarError 'pagar otra vez' 400 { Llamar 'Post' '/remesas/pagos-comision' $admin @{ agenteId = $agente.id; forma = 'efectivo'; cajaId = $caja.id } }
Comparar 'caja: 1000 - 75' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '925.00'

Write-Host "`n== Recibo, bancos y panel ==" -ForegroundColor Cyan
$archivo = Join-Path $PSScriptRoot "recibo-$($e1.numero).pdf"
Invoke-WebRequest -Uri "$API/remesas/envios/$($e1.id)/recibo?formato=80" -Headers $admin -OutFile $archivo -UseBasicParsing
Ok 'recibo definitivo guardado en:' $archivo
$movs = Llamar 'Get' "/bancos/cuentas/$($nat.id)/movimientos" $admin
$mr = @($movs.filas) | Where-Object { $_.tipo -eq 'remesa' } | Select-Object -First 1
EsperarError 'reversar un envio desde Bancos' 400 { Llamar 'Post' "/bancos/movimientos/$($mr.id)/reversar" $admin @{ motivo = 'Prueba de reverso' } }
$panel = Llamar 'Get' '/panel?periodo=hoy' $admin
Ok 'panel de hoy:' "$($panel.remesas.confirmados) confirmados, comision SCITO RD$ $($panel.remesas.comision_scito)"

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{ '500' = 1; '200' = 2; '25' = 1 } } | Out-Null
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
VaciarCuenta $nat '0.48'
VaciarCuenta $pop '1'
Llamar 'Patch' "/remesas/agentes/$($agente.id)/estado" $admin @{ is_active = $false; motivo = 'Agente de prueba' } | Out-Null
Llamar 'Patch' "/clientes/$($cliente.id)/estado" $admin @{ is_active = $false; motivo = 'Cliente de prueba' } | Out-Null
Llamar 'Patch' "/clientes/$($sinDoc.id)/estado" $admin @{ is_active = $false; motivo = 'Cliente de prueba' } | Out-Null
Ok 'caja, cuentas, agente y clientes de prueba en cero y desactivados' ''

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de envios (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver envios sin permiso' 403 { Llamar 'Get' '/remesas/envios' $sinPermiso }
EsperarError 'registrar envio sin permiso' 403 { Llamar 'Post' '/remesas/envios' $sinPermiso @{ agenteId = $agente.id } }
EsperarError 'confirmar sin permiso' 403 { Llamar 'Post' "/remesas/envios/$($e2.id)/confirmar" $sinPermiso @{ codigoExterno = 'X1234567' } }
EsperarError 'ver lo que deben los agentes sin permiso' 403 { Llamar 'Get' '/remesas/cuentas-agentes' $sinPermiso }
EsperarError 'pagar comision sin permiso' 403 { Llamar 'Post' '/remesas/pagos-comision' $sinPermiso @{ agenteId = $agente.id; forma = 'efectivo' } }
EsperarError 'cambiar la tasa sin permiso' 403 { Llamar 'Post' '/remesas/tarifas' $sinPermiso @{ tasa = '9'; comisionPct = '10'; comisionAgentePct = '50'; motivo = 'Prueba de permiso' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
