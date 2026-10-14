# Pruebas de Compras (facturas de proveedor) con npm run start:dev encendido.
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-compras.ps1
# Crea un PROVEEDOR, un PRODUCTO y una CAJA DE PRUEBA (con RD$2,000 de
# ingreso), registra facturas de contado y a credito, revisa el inventario y
# la caja, y anula. Al final deja la caja en cero, la cierra y desactiva todo.
# Las compras de prueba quedan en la base de desarrollo (no se borran).

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
# NCF de prueba distintos en cada corrida: B01 + 8 numeros = B + 10 numeros.
$ncf1 = 'B01' + (Get-Date -Format 'MMddHHmm')
$ncf2 = 'B01' + (Get-Date -Format 'ddHHmmss')
$prep = Llamar 'Get' '/compras/preparar' $admin
Ok 'tipos de gasto del 606:' (@($prep.tiposGasto).Count)

Write-Host "`n== Preparar proveedor, producto y caja de prueba ==" -ForegroundColor Cyan
$prov = Llamar 'Post' '/proveedores' $admin @{
  tipoDocumentoId = ''; numeroDocumento = ''; nombre = "Proveedor prueba $sello"; nombreComercial = ''
  esContribuyente = $false; direccion = ''; telefono = ''; whatsapp = ''; correo = ''; notas = ''
  personaContacto = ''; diasCredito = '30'
}
Ok 'proveedor con 30 dias de credito:' "Proveedor prueba $sello"
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Compra prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id
  precioVenta = '60'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '5'
}
Ok 'producto con 5 unidades a RD$30:' $prod.codigo
function Producto { (Llamar 'Get' "/productos?texto=$($prod.codigo)" $admin).filas | Where-Object { $_.id -eq $prod.id } }
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-C$sello"; nombre = "Caja prueba compras $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' }
Llamar 'Post' "/caja/sesiones/$($sesion.id)/movimientos" $admin @{ tipo = 'ingreso'; monto = '2000'; motivo = 'Efectivo para la prueba de compras' } | Out-Null
Comparar 'caja de prueba con' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '2000.00'

try {

$factura = @{
  proveedorId = $prov.id; ncf = $ncf1; fechaComprobante = $prep.hoy; tipoGasto = '09'; condicion = 'contado'
  lineas = @(@{ productoId = $prod.id; cantidad = '10'; costoUnitario = '50' })
  itbis = '90'; pago = @{ forma = 'efectivo'; cajaId = $caja.id }
}

Write-Host "`n== Validaciones ==" -ForegroundColor Cyan
$x = $factura.Clone(); $x.ncf = 'B01-123'
EsperarError 'NCF mal escrito' 400 { Llamar 'Post' '/compras' $admin $x }
$x = $factura.Clone(); $x.fechaComprobante = '2099-01-01'
EsperarError 'fecha futura' 400 { Llamar 'Post' '/compras' $admin $x }
$x = $factura.Clone(); $x.lineas = @(@{ productoId = $prod.id; cantidad = '1.5'; costoUnitario = '50' })
EsperarError 'decimales en un producto por unidad' 400 { Llamar 'Post' '/compras' $admin $x }
$x = $factura.Clone(); $x.lineas = @(@{ productoId = $prod.id; cantidad = '100'; costoUnitario = '50' })
EsperarError 'no alcanza el efectivo de la caja' 400 { Llamar 'Post' '/compras' $admin $x }

Write-Host "`n== Factura de contado: 10 unidades a RD`$50 + ITBIS 90 ==" -ForegroundColor Cyan
$c1 = Llamar 'Post' '/compras' $admin $factura
Comparar 'factura registrada, total' $c1.total '590.00'
Comparar 'existencia (5 + 10)' (Producto).existencia '15.000'
Comparar 'costo promedio (5 a 30 + 10 a 50)' (Producto).costo '43.33'
Comparar 'caja (2000 - 590)' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '1410.00'
EsperarError 'la misma factura otra vez' 409 { Llamar 'Post' '/compras' $admin $factura }

Write-Host "`n== Factura a credito de un servicio, con retenciones ==" -ForegroundColor Cyan
$c2 = Llamar 'Post' '/compras' $admin @{
  proveedorId = $prov.id; ncf = $ncf2; fechaComprobante = $prep.hoy; tipoGasto = '02'; condicion = 'credito'
  lineas = @(); servicios = '1000'; itbis = '180'; itbisRetenido = '180'; isrRetenido = '100'; descripcion = 'Mantenimiento'
}
$d2 = Llamar 'Get' "/compras/$($c2.id)" $admin
Comparar 'a pagar (1180 - 180 - 100)' $d2.a_pagar '900.00'
Comparar 'saldo pendiente' $d2.saldo '900.00'
Ok 'vence (30 dias del proveedor):' $d2.vence
$pend = Llamar 'Get' '/compras?estado=pendientes' $admin
Ok 'en la lista de pendientes:' ((@($pend.filas) | ForEach-Object { "$($_.codigo) saldo $($_.saldo)" }) -join ', ')

Write-Host "`n== Anular la de contado ==" -ForegroundColor Cyan
EsperarError 'anular sin motivo' 400 { Llamar 'Post' "/compras/$($c1.id)/anular" $admin @{ motivo = '' } }
EsperarError 'anular sin decir la caja' 400 { Llamar 'Post' "/compras/$($c1.id)/anular" $admin @{ motivo = 'Factura de prueba' } }
Llamar 'Post' "/compras/$($c1.id)/anular" $admin @{ motivo = 'Factura de prueba'; cajaId = $caja.id } | Out-Null
Comparar 'existencia de vuelta' (Producto).existencia '5.000'
Comparar 'caja de vuelta' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '2000.00'
Llamar 'Post' "/compras/$($c2.id)/anular" $admin @{ motivo = 'Factura de prueba' } | Out-Null
Ok 'la de credito tambien anulada (no tenia pagos)' ''

Write-Host "`n== Permisos ==" -ForegroundColor Cyan
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/compras' $null }

} finally {
Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
# Se retira lo que haya quedado en la caja de prueba (normalmente RD$2,000).
$hay = (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado
if ($hay -ne '0.00') { Llamar 'Post' "/caja/sesiones/$($sesion.id)/movimientos" $admin @{ tipo = 'retiro'; monto = $hay; motivo = 'Fin de la prueba de compras' } | Out-Null }
$cierre = Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{} }
Comparar 'caja de prueba cerrada sin diferencia' $cierre.diferencia '0.00'
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
Llamar 'Patch' "/proveedores/$($prov.id)/estado" $admin @{ is_active = $false; motivo = 'Proveedor de prueba' } | Out-Null
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'caja, proveedor, producto, categoria y unidad de prueba desactivados' ''
}
Write-Host "`nListo. Todas las lineas deben decir OK en verde." -ForegroundColor Cyan
