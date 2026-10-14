# Pruebas de Cuentas por Cobrar (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-cxc.ps1
# Crea un CLIENTE, un PRODUCTO (RD$100 + ITBIS) y una CAJA DE PRUEBA, le da
# credito al cliente (limite RD$500), vende a credito (con y sin inicial),
# recibe abonos, anula uno y anula una venta. Al final deja la caja en cero,
# la cierra y desactiva todo lo de prueba (aunque algo falle a la mitad).
# Los recargos por atraso se probaron aparte: necesitan facturas de hace meses.

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

Write-Host "`n== Preparar cliente, producto y caja de prueba ==" -ForegroundColor Cyan
$cli = Llamar 'Post' '/clientes' $admin @{
  tipoDocumentoId = ''; numeroDocumento = ''; nombre = "Cliente credito $sello"; nombreComercial = ''
  esContribuyente = $false; direccion = ''; telefono = ''; whatsapp = ''; correo = ''; notas = ''
  puedeCredito = $false; personaContacto = ''; diasCredito = ''
}
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Credito prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '50'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id
  precioVenta = '100'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '20'
}
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-K$sello"; nombre = "Caja prueba credito $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' }
$prep = Llamar 'Get' '/ventas/preparar' $admin
$efectivo = ($prep.formasPago | Where-Object { $_.codigo -eq 'efectivo' }).id
Comparar '"Credito" no sale como forma de pago normal' (@($prep.formasPago | Where-Object { $_.codigo -eq 'credito' }).Count) '0'
Comparar 'el administrador puede vender a credito' $prep.credito.puedeVender 'True'
Ok 'cliente, producto (RD$100 + ITBIS = RD$118) y caja listos' ''

function Vender($cantidad, $inicial) {
  Llamar 'Post' '/ventas' $admin @{
    clienteId = $cli.id
    lineas = @(@{ tipo = 'producto'; id = $prod.id; cantidad = "$cantidad"; descuento = '' })
    pago = @{ formaPagoId = $efectivo; recibido = '1000'; cajaId = $caja.id }
    credito = @{ inicial = $inicial }
  }
}

try {

Write-Host "`n== Dar credito al cliente ==" -ForegroundColor Cyan
EsperarError 'vender a credito sin tener credito' 400 { Vender 1 '0' }
EsperarError 'limite en cero' 400 { Llamar 'Put' "/cxc/clientes/$($cli.id)/credito" $admin @{ limite = '0'; plazoDias = '30' } }
Llamar 'Put' "/cxc/clientes/$($cli.id)/credito" $admin @{ limite = '500'; plazoDias = '30' } | Out-Null
Ok 'credito dado: limite RD$500, 30 dias' ''

Write-Host "`n== Ventas a credito ==" -ForegroundColor Cyan
$v1 = Vender 1 '0'
Comparar 'venta 1: todo a credito' $v1.credito.monto '118.00'
$v2 = Vender 1 '18'
Comparar 'venta 2: inicial RD$18, a credito' $v2.credito.monto '100.00'
EsperarError 'venta que pasa del limite (4 x 118)' 400 { Vender 4 '0' }
EsperarError 'inicial igual al total' 400 { Vender 1 '118' }
$d = Llamar 'Get' "/cxc/clientes/$($cli.id)" $admin
Comparar 'debe (118 + 100)' $d.totales.total '218.00'
Comparar 'disponible (500 - 218)' $d.disponible '282.00'
Comparar 'caja: solo entro el inicial' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '18.00'

Write-Host "`n== Abonos ==" -ForegroundColor Cyan
EsperarError 'abono mayor que la deuda' 400 { Llamar 'Post' '/cxc/abonos' $admin @{ clienteId = $cli.id; monto = '500'; forma = 'efectivo'; cajaId = $caja.id } }
$a1 = Llamar 'Post' '/cxc/abonos' $admin @{ clienteId = $cli.id; monto = '100'; forma = 'efectivo'; cajaId = $caja.id }
Ok "abono $($a1.codigo) automatico (lo mas viejo primero):" ((@($a1.aplicado) | ForEach-Object { "$($_.venta) capital $($_.capital)" }) -join ', ')
$cta2 = (@($d.cuentas) | Where-Object { $_.venta_id -eq $v2.id }).id
$a2 = Llamar 'Post' '/cxc/abonos' $admin @{ clienteId = $cli.id; monto = '50'; forma = 'efectivo'; cajaId = $caja.id; distribucion = @(@{ cuentaId = $cta2; monto = '50' }) }
Ok "abono $($a2.codigo) elegido para la venta 2:" ((@($a2.aplicado) | ForEach-Object { "$($_.venta) capital $($_.capital)" }) -join ', ')
Comparar 'debe ahora (218 - 150)' $a2.debeAhora '68.00'
$t = Llamar 'Get' "/cxc/abonos/$($a1.id)/ticket" $admin
Ok 'recibo para imprimir:' $t.documento
Comparar 'caja (18 + 100 + 50)' (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado '168.00'

Write-Host "`n== Anular ==" -ForegroundColor Cyan
EsperarError 'anular abono sin decir la caja' 400 { Llamar 'Post' "/cxc/abonos/$($a2.id)/anular" $admin @{ motivo = 'Abono de prueba' } }
Llamar 'Post' "/cxc/abonos/$($a2.id)/anular" $admin @{ motivo = 'Abono de prueba'; cajaId = $caja.id } | Out-Null
Comparar 'debe de nuevo (68 + 50)' (Llamar 'Get' "/cxc/clientes/$($cli.id)" $admin).totales.total '118.00'
EsperarError 'anular la venta 1 (tiene un abono)' 400 { Llamar 'Post' "/ventas/$($v1.id)/anular" $admin @{ motivo = 'Venta de prueba'; cajaId = $caja.id } }
Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'Venta de prueba'; cajaId = $caja.id } | Out-Null
Ok 'venta 2 anulada (su abono ya estaba anulado): su cuenta tambien se anula' ''
Comparar 'debe (solo la venta 1: 118 - 100)' (Llamar 'Get' "/cxc/clientes/$($cli.id)" $admin).totales.total '18.00'

Write-Host "`n== Permisos ==" -ForegroundColor Cyan
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/cxc/clientes' $null }

} finally {
Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
$hay = (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado
if ($hay -ne '0.00') { Llamar 'Post' "/caja/sesiones/$($sesion.id)/movimientos" $admin @{ tipo = 'retiro'; monto = $hay; motivo = 'Fin de la prueba de credito' } | Out-Null }
$cierre = Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{} }
Comparar 'caja de prueba cerrada sin diferencia' $cierre.diferencia '0.00'
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
Llamar 'Put' "/cxc/clientes/$($cli.id)/credito" $admin @{ limite = '500'; plazoDias = '30'; activo = $false } | Out-Null
Llamar 'Patch' "/clientes/$($cli.id)/estado" $admin @{ is_active = $false; motivo = 'Cliente de prueba' } | Out-Null
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'caja, cliente, producto, categoria y unidad de prueba desactivados' ''
}
Write-Host "`nListo. Todas las lineas deben decir OK en verde." -ForegroundColor Cyan
