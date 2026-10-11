# Pruebas de bancos (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-bancos.ps1
# Crea 3 CUENTAS DE PRUEBA (RD$, US$ y MonCash en HTG), una caja de prueba y
# un producto de prueba. Registra saldos iniciales, pagos, cargos, intereses,
# ventas por transferencia (confirmada y "no llego"), deposito de caja,
# recargas de MonCash con tasa, un reverso y los errores esperados.
# Al final deja las cuentas en cero (un cargo "Cierre de cuenta de prueba")
# y desactiva todo. Los movimientos quedan en la base de desarrollo
# (no se borran, como en la vida real).

$API = 'http://localhost:3000'
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
  $t = if ($vieja.moneda -eq 'USD') { '60.50' } elseif ($vieja.moneda -eq 'HTG') { '0.47' } else { '1' }
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
foreach ($viejo in @((Llamar 'Get' '/productos?texto=Banco%20prueba' $admin).filas)) {
  Llamar 'Patch' "/productos/$($viejo.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
  Ok 'producto de prueba anterior desactivado:' $viejo.codigo
}

Write-Host "`n== Crear cuentas de prueba ==" -ForegroundColor Cyan
$pop = Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-D$sello"; tipo = 'banco'; entidad = 'Banco de prueba'; nombre = "Prueba pesos $sello"; tipoCuenta = 'corriente'; moneda = 'DOP'; ultimosDigitos = '1234'; recibeVentas = $true }
$usd = Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-U$sello"; tipo = 'banco'; entidad = 'Banco de prueba'; nombre = "Prueba dolares $sello"; tipoCuenta = 'ahorro'; moneda = 'USD' }
$mc = Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-H$sello"; tipo = 'billetera'; entidad = 'MonCash'; nombre = "Prueba MonCash $sello"; moneda = 'HTG' }
Ok 'cuentas creadas:' "PRB-D$sello (RD$), PRB-U$sello (US$), PRB-H$sello (HTG)"
EsperarError 'cuenta en US$ que recibe ventas' 400 { Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-X$sello"; tipo = 'banco'; entidad = 'B'; nombre = "X $sello"; tipoCuenta = 'ahorro'; moneda = 'USD'; recibeVentas = $true } }
EsperarError 'numero de cuenta completo (solo 4 digitos)' 400 { Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-X$sello"; tipo = 'banco'; entidad = 'B'; nombre = "X $sello"; tipoCuenta = 'ahorro'; moneda = 'DOP'; ultimosDigitos = '123456789' } }
EsperarError 'billetera con tipo de cuenta' 400 { Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-X$sello"; tipo = 'billetera'; entidad = 'B'; nombre = "X $sello"; tipoCuenta = 'ahorro'; moneda = 'HTG' } }
EsperarError 'codigo repetido' 409 { Llamar 'Post' '/bancos/cuentas' $admin @{ codigo = "PRB-D$sello"; tipo = 'banco'; entidad = 'B'; nombre = "Otra $sello"; tipoCuenta = 'ahorro'; moneda = 'DOP' } }

function Cuenta($c) { @(Llamar 'Get' '/bancos/cuentas' $admin) | Where-Object { $_.id -eq $c.id } }

Write-Host "`n== Saldo inicial, pagos, cargos, intereses ==" -ForegroundColor Cyan
EsperarError 'cargo sin saldo inicial' 400 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'cargo'; monto = '10'; motivo = 'Comision mensual' } }
Llamar 'Post' "/bancos/cuentas/$($pop.id)/saldo-inicial" $admin @{ monto = '10000' } | Out-Null
EsperarError 'saldo inicial en US$ sin tasa' 400 { Llamar 'Post' "/bancos/cuentas/$($usd.id)/saldo-inicial" $admin @{ monto = '100' } }
Llamar 'Post' "/bancos/cuentas/$($usd.id)/saldo-inicial" $admin @{ monto = '100'; tasa = '60.50' } | Out-Null
EsperarError 'segundo saldo inicial' 409 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/saldo-inicial" $admin @{ monto = '5' } }
$prepB = Llamar 'Get' '/bancos/preparar' $admin
$servicios = ($prepB.categoriasGasto | Where-Object { $_.codigo -eq 'servicios_basicos' }).id
$luz = Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'pago'; monto = '500'; categoriaGastoId = $servicios; beneficiario = 'EDESUR'; motivo = 'Luz de prueba' }
EsperarError 'pago sin categoria' 400 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'pago'; monto = '5'; motivo = 'Pago sin categoria' } }
EsperarError 'pago mayor que el saldo' 400 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'cargo'; monto = '99999'; motivo = 'Demasiado dinero' } }
EsperarError 'fecha en el futuro' 400 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'cargo'; monto = '1'; fecha = '2099-01-01'; motivo = 'Fecha futura' } }
Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'cargo'; monto = '15'; motivo = 'Impuesto 0.15%' } | Out-Null
Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'interes'; monto = '5'; motivo = 'Intereses del mes' } | Out-Null
Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $admin @{ tipo = 'ingreso'; monto = '100'; motivo = 'Ingreso de prueba' } | Out-Null
EsperarError 'interes en US$ sin tasa' 400 { Llamar 'Post' "/bancos/cuentas/$($usd.id)/movimientos" $admin @{ tipo = 'interes'; monto = '1'; motivo = 'Intereses del mes' } }
Comparar 'pesos: 10000 - 500 - 15 + 5 + 100' (Cuenta $pop).confirmado '9590.00'

Write-Host "`n== Ventas por transferencia ==" -ForegroundColor Cyan
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Banco prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'exento' }).id
  precioVenta = '50'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '10'
}
$prep = Llamar 'Get' '/ventas/preparar' $admin
$transferencia = ($prep.formasPago | Where-Object { $_.codigo -eq 'transferencia' }).id
function VenderTransferencia($ref) {
  Llamar 'Post' '/ventas' $admin @{ clienteId = $prep.consumidorFinal.id; lineas = @(@{ tipo = 'producto'; id = $prod.id; cantidad = '1' }); pago = @{ formaPagoId = $transferencia; referencia = $ref; cuentaId = $pop.id } }
}
EsperarError 'transferencia a cuenta en US$' 400 { Llamar 'Post' '/ventas' $admin @{ clienteId = $prep.consumidorFinal.id; lineas = @(@{ tipo = 'producto'; id = $prod.id; cantidad = '1' }); pago = @{ formaPagoId = $transferencia; referencia = 'X'; cuentaId = $usd.id } } }
$v1 = VenderTransferencia "PRB1-$sello"
$v2 = VenderTransferencia "PRB2-$sello"
Comparar 'dos ventas de RD$50 por confirmar' (Cuenta $pop).por_confirmar '100.00'
$pend = Llamar 'Get' '/bancos/pendientes' $admin
$m1 = @($pend.porConfirmar) | Where-Object { $_.venta -eq $v1.numero }
$m2 = @($pend.porConfirmar) | Where-Object { $_.venta -eq $v2.numero }
Llamar 'Post' "/bancos/movimientos/$($m1.id)/confirmar" $admin @{ resultado = 'confirmado' } | Out-Null
EsperarError 'confirmar dos veces' 400 { Llamar 'Post' "/bancos/movimientos/$($m1.id)/confirmar" $admin @{ resultado = 'confirmado' } }
EsperarError '"no llego" sin motivo' 400 { Llamar 'Post' "/bancos/movimientos/$($m2.id)/confirmar" $admin @{ resultado = 'no_llego' } }
Llamar 'Post' "/bancos/movimientos/$($m2.id)/confirmar" $admin @{ resultado = 'no_llego'; motivo = 'No aparece en el estado de cuenta' } | Out-Null
$c = Cuenta $pop
Comparar 'confirmado / por confirmar / no llegaron' "$($c.confirmado) / $($c.por_confirmar) / $($c.no_llegaron)" '9640.00 / 0.00 / 1'
Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'El cliente nunca pago' } | Out-Null
Comparar 'anular la venta que no llego no devuelve nada' (Cuenta $pop).confirmado '9640.00'

Write-Host "`n== Caja, depositos y recargas MonCash ==" -ForegroundColor Cyan
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-$sello"; nombre = "Caja prueba bancos $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '1000' }
EsperarError 'depositar mas de lo que hay en la caja' 400 { Llamar 'Post' "/caja/cajas/$($caja.id)/depositar" $admin @{ cuentaId = $pop.id; monto = '1000.01' } }
$dep = Llamar 'Post' "/caja/cajas/$($caja.id)/depositar" $admin @{ cuentaId = $pop.id; monto = '600'; referencia = 'Boleta 55' }
Ok 'deposito de la caja al banco:' $dep.numero
Comparar 'deposito por confirmar en la cuenta' (Cuenta $pop).por_confirmar '600.00'
EsperarError 'recarga sin decir quien cambio' 400 { Llamar 'Post' '/bancos/transferencias' $admin @{ origenCuentaId = $pop.id; destinoCuentaId = $mc.id; montoSale = '1000'; montoEntra = '2150' } }
$rec = Llamar 'Post' '/bancos/transferencias' $admin @{ origenCuentaId = $pop.id; destinoCuentaId = $mc.id; montoSale = '1000'; montoEntra = '2150'; cambiadoPor = 'casa_cambio'; motivo = 'Recarga MonCash de prueba' }
Ok 'recarga MonCash RD$1,000 -> HTG 2,150:' $rec.numero
EsperarError 'de US$ a HTG sin tasa' 400 { Llamar 'Post' '/bancos/transferencias' $admin @{ origenCuentaId = $usd.id; destinoCuentaId = $mc.id; montoSale = '10'; montoEntra = '1300'; cambiadoPor = 'agente' } }
Llamar 'Post' '/bancos/transferencias' $admin @{ origenCuentaId = $usd.id; destinoCuentaId = $mc.id; montoSale = '10'; montoEntra = '1300'; cambiadoPor = 'agente'; tasa = '60.80' } | Out-Null
Llamar 'Post' "/caja/cajas/$($caja.id)/depositar" $admin @{ cuentaId = $mc.id; monto = '200'; montoEntra = '430'; cambiadoPor = 'agente' } | Out-Null
Llamar 'Post' "/caja/cajas/$($caja.id)/traer" $admin @{ cuentaId = $pop.id; monto = '100'; motivo = 'Cambio para la caja' } | Out-Null
EsperarError 'transferir a la misma cuenta' 400 { Llamar 'Post' '/bancos/transferencias' $admin @{ origenCuentaId = $pop.id; destinoCuentaId = $pop.id; montoSale = '5' } }
$h = Cuenta $mc
Comparar 'MonCash: HTG por confirmar / valor en RD$' "$($h.por_confirmar) / $($h.disponible_dop)" '3880.00 / 1808.00'
Comparar 'dolares: 100 - 10' (Cuenta $usd).confirmado '90.00'
$det = Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin
Comparar 'caja: 1000 - 600 - 200 + 100' $det.esperado '300.00'

Write-Host "`n== Reversos ==" -ForegroundColor Cyan
Llamar 'Post' "/bancos/movimientos/$($luz.id)/reversar" $admin @{ motivo = 'Se pago con otra cuenta' } | Out-Null
EsperarError 'reversar dos veces' 400 { Llamar 'Post' "/bancos/movimientos/$($luz.id)/reversar" $admin @{ motivo = 'Otra vez' } }
EsperarError 'reversar el cobro de una venta' 400 { Llamar 'Post' "/bancos/movimientos/$($m1.id)/reversar" $admin @{ motivo = 'Equivocado' } }
Comparar 'pesos confirmado: 9640 - 1000 - 100 + 500' (Cuenta $pop).confirmado '9040.00'
EsperarError 'desactivar cuenta con saldo' 400 { Llamar 'Patch' "/bancos/cuentas/$($pop.id)/estado" $admin @{ is_active = $false; motivo = 'Ya no se usa' } }

Write-Host "`n== Panel ==" -ForegroundColor Cyan
$panel = Llamar 'Get' '/panel?periodo=hoy' $admin
Ok 'saldos por moneda en el panel:' ((@($panel.bancos.monedas) | ForEach-Object { "$($_.simbolo) $($_.confirmado)" }) -join ' | ')

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{ '200' = 1; '100' = 1 } } | Out-Null
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
VaciarCuenta $pop '1'
VaciarCuenta $usd '60.50'
VaciarCuenta $mc '0.47'
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'cuentas, caja, producto, categoria y unidad de prueba en cero y desactivados' ''

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de bancos (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver cuentas sin permiso' 403 { Llamar 'Get' '/bancos/cuentas' $sinPermiso }
EsperarError 'crear cuenta sin permiso' 403 { Llamar 'Post' '/bancos/cuentas' $sinPermiso @{ codigo = 'NO-PUEDE'; tipo = 'banco'; entidad = 'B'; nombre = 'No puede'; tipoCuenta = 'ahorro'; moneda = 'DOP' } }
EsperarError 'registrar pago sin permiso' 403 { Llamar 'Post' "/bancos/cuentas/$($pop.id)/movimientos" $sinPermiso @{ tipo = 'cargo'; monto = '1'; motivo = 'Prueba de permiso' } }
EsperarError 'transferir sin permiso' 403 { Llamar 'Post' '/bancos/transferencias' $sinPermiso @{ origenCuentaId = $pop.id; destinoCuentaId = $mc.id; montoSale = '1' } }
EsperarError 'confirmar sin permiso' 403 { Llamar 'Post' "/bancos/movimientos/$($m1.id)/confirmar" $sinPermiso @{ resultado = 'confirmado' } }
EsperarError 'reversar sin permiso' 403 { Llamar 'Post' "/bancos/movimientos/$($m1.id)/reversar" $sinPermiso @{ motivo = 'Prueba de permiso' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
