# Pruebas de Cuentas por Pagar (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-cxp.ps1
# Crea un PROVEEDOR y una CAJA DE PRUEBA (con RD$2,000), registra 2 facturas
# a credito, paga (automatico y eligiendo facturas), anula los pagos, prueba
# un gasto fijo y su aviso. Al final anula las facturas, deja la caja en cero,
# la cierra y desactiva todo lo de prueba (aunque algo falle a la mitad).
# El pago por banco se probo aparte (sin tocar cuentas reales).

$API = 'http://localhost:3010'
$ErrorActionPreference = 'Stop'

function Cuerpo($datos) {
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
  $respuesta = Invoke-RestMethod @p
  $respuesta
}

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

function Ok($nombre, $detalle) { Write-Host "OK     $nombre $detalle" -ForegroundColor Green }

function Comparar($nombre, $real, $esperado) {
  if ("$real" -eq "$esperado") {
    Write-Host "OK     $nombre -> $real" -ForegroundColor Green
  } else {
    Write-Host "FALLO  $nombre -> $real (se esperaba $esperado)" -ForegroundColor Red
  }
}

Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'
# NCF de prueba distintos en cada corrida: B01 + 8 numeros.
$ncf1 = 'B01' + (Get-Date -Format 'MMddHHmm')
$ncf2 = 'B01' + (Get-Date -Format 'ddHHmmss')
$ncf3 = 'B01' + (Get-Date -Format 'HHmmss') + '77'
$prep = Llamar 'Get' '/cxp/preparar' $admin
$hoy = $prep.hoy

Write-Host "`n== Preparar proveedor y caja de prueba ==" -ForegroundColor Cyan
$prov = Llamar 'Post' '/proveedores' $admin @{
  tipoDocumentoId = ''; numeroDocumento = ''; nombre = "Proveedor CxP $sello"; nombreComercial = ''
  esContribuyente = $false; direccion = ''; telefono = ''; whatsapp = ''; correo = ''; notas = ''
  personaContacto = ''; diasCredito = '30'
}
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-P$sello"; nombre = "Caja prueba CxP $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' }
Llamar 'Post' "/caja/sesiones/$($sesion.id)/movimientos" $admin @{ tipo = 'ingreso'; monto = '2000'; motivo = 'Efectivo para la prueba de CxP' } | Out-Null
Comparar 'caja de prueba con' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '2000.00'
$facturas = @()
$gasto = $null

function Factura($ncf, $monto, $gastoFijoId) {
  Llamar 'Post' '/compras' $admin @{
    proveedorId = $prov.id; ncf = $ncf; fechaComprobante = $hoy; tipoGasto = '02'; condicion = 'credito'
    lineas = @(); servicios = $monto; itbis = '0'; gastoFijoId = $gastoFijoId
  }
}

try {

Write-Host "`n== Facturas a credito ==" -ForegroundColor Cyan
$f1 = Factura $ncf1 '1000' ''
$f2 = Factura $ncf2 '500' ''
$facturas += $f1, $f2
$d = Llamar 'Get' "/cxp/proveedores/$($prov.id)" $admin
Comparar 'se le debe al proveedor (1000 + 500)' $d.totales.debe '1500.00'
Ok 'facturas pendientes:' ((@($d.facturas) | ForEach-Object { "$($_.codigo) vence $($_.vencimiento)" }) -join ', ')

Write-Host "`n== Validaciones al pagar ==" -ForegroundColor Cyan
EsperarError 'pagar mas de lo que se debe' 400 { Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '1500.01'; forma = 'efectivo'; cajaId = $caja.id } }
EsperarError 'a la factura 2 mas que su saldo' 400 { Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '1000'; forma = 'efectivo'; cajaId = $caja.id; distribucion = @(@{ compraId = $f2.id; monto = '1000' }) } }
EsperarError 'reparto que no suma el pago' 400 { Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '300'; forma = 'efectivo'; cajaId = $caja.id; distribucion = @(@{ compraId = $f1.id; monto = '100' }) } }
EsperarError 'sin caja' 400 { Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '100'; forma = 'efectivo' } }

Write-Host "`n== Pagar ==" -ForegroundColor Cyan
$p1 = Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '1200'; forma = 'efectivo'; cajaId = $caja.id }
Ok "pago $($p1.codigo) automatico (lo mas viejo primero):" ((@($p1.aplicado) | ForEach-Object { "$($_.factura) $($_.monto)" }) -join ', ')
Comparar 'debe ahora (1500 - 1200)' $p1.debeAhora '300.00'
$p2 = Llamar 'Post' '/cxp/pagos' $admin @{ proveedorId = $prov.id; monto = '100'; forma = 'efectivo'; cajaId = $caja.id; distribucion = @(@{ compraId = $f2.id; monto = '100' }) }
Ok "pago $($p2.codigo) elegido para la factura 2:" ((@($p2.aplicado) | ForEach-Object { "$($_.factura) $($_.monto)" }) -join ', ')
Comparar 'caja (2000 - 1200 - 100)' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '700.00'
$t = Llamar 'Get' "/cxp/pagos/$($p1.id)/ticket" $admin
Ok 'comprobante para imprimir:' $t.documento
EsperarError 'anular la factura 1 (tiene un pago PP activo)' 400 { Llamar 'Post' "/compras/$($f1.id)/anular" $admin @{ motivo = 'Factura de prueba' } }

Write-Host "`n== Anular pagos ==" -ForegroundColor Cyan
EsperarError 'anular sin decir la caja' 400 { Llamar 'Post' "/cxp/pagos/$($p1.id)/anular" $admin @{ motivo = 'Pago de prueba' } }
Llamar 'Post' "/cxp/pagos/$($p1.id)/anular" $admin @{ motivo = 'Pago de prueba'; cajaId = $caja.id } | Out-Null
Llamar 'Post' "/cxp/pagos/$($p2.id)/anular" $admin @{ motivo = 'Pago de prueba'; cajaId = $caja.id } | Out-Null
Comparar 'caja: el dinero volvio' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '2000.00'
Comparar 'se le debe todo otra vez' (Llamar 'Get' "/cxp/proveedores/$($prov.id)" $admin).totales.debe '1500.00'
EsperarError 'anular el mismo pago otra vez' 400 { Llamar 'Post' "/cxp/pagos/$($p1.id)/anular" $admin @{ motivo = 'Otra vez'; cajaId = $caja.id } }

Write-Host "`n== Gasto fijo (vence hoy) ==" -ForegroundColor Cyan
$dia = [int]$hoy.Substring(8, 2)
EsperarError 'dia 32' 400 { Llamar 'Post' '/cxp/gastos-fijos' $admin @{ nombre = 'Alquiler prueba'; proveedorId = $prov.id; tipoGasto = '02'; diaMes = '32' } }
$gasto = Llamar 'Post' '/cxp/gastos-fijos' $admin @{ nombre = "Alquiler prueba $sello"; proveedorId = $prov.id; tipoGasto = '02'; diaMes = "$dia"; monto = '250'; itbis = '' }
function HayAviso { @((Llamar 'Get' '/cxp/alertas' $admin).gastosFijos | Where-Object { $_.id -eq $gasto.id }).Count }
Comparar 'aparece el aviso' (HayAviso) '1'
$f3 = Factura $ncf3 '250' $gasto.id
$facturas += $f3
Comparar 'con la factura registrada, el aviso se apaga' (HayAviso) '0'

} finally {
Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
foreach ($f in $facturas) {
  try { Llamar 'Post' "/compras/$($f.id)/anular" $admin @{ motivo = 'Factura de prueba CxP' } | Out-Null } catch { }
}
if ($gasto) {
  Comparar 'factura del gasto fijo anulada: el aviso vuelve' (HayAviso) '1'
  Llamar 'Put' "/cxp/gastos-fijos/$($gasto.id)" $admin @{ nombre = "Alquiler prueba $sello"; proveedorId = $prov.id; tipoGasto = '02'; diaMes = "$dia"; activo = $false } | Out-Null
}
Comparar 'al proveedor de prueba ya no se le debe' (Llamar 'Get' "/cxp/proveedores/$($prov.id)" $admin).totales.debe '0.00'
$hay = (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado
if ($hay -ne '0.00') { Llamar 'Post' "/caja/sesiones/$($sesion.id)/movimientos" $admin @{ tipo = 'retiro'; monto = $hay; motivo = 'Fin de la prueba de CxP' } | Out-Null }
$cierre = Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{} }
Comparar 'caja de prueba cerrada sin diferencia' $cierre.diferencia '0.00'
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
Llamar 'Patch' "/proveedores/$($prov.id)/estado" $admin @{ is_active = $false; motivo = 'Proveedor de prueba' } | Out-Null
Ok 'facturas anuladas; gasto fijo, caja y proveedor de prueba desactivados' ''
}
Write-Host "`nListo. Todas las lineas deben decir OK en verde." -ForegroundColor Cyan
