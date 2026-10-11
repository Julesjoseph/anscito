# Pruebas de ventas (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-ventas.ps1
# Crea un producto de prueba con 5 unidades, registra 2 ventas de prueba y
# luego las ANULA (la mercancia vuelve). Las ventas anuladas quedan en la
# base de desarrollo (nada se borra) y usan 2 numeros de venta.

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

Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'

Write-Host "`n== Preparar producto de prueba ==" -ForegroundColor Cyan
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Venta prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id
  precioVenta = '50'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '5'
}
Ok 'producto con 5 unidades a RD$50 + ITBIS:' $prod.codigo

$prep = Llamar 'Get' '/ventas/preparar' $admin
$efectivo = ($prep.formasPago | Where-Object { $_.codigo -eq 'efectivo' }).id
$transferencia = ($prep.formasPago | Where-Object { $_.codigo -eq 'transferencia' }).id
$cf = $prep.consumidorFinal.id
Ok 'formas de pago:' (($prep.formasPago | ForEach-Object { $_.nombre }) -join ', ')
Ok 'descuento maximo:' "$($prep.descuentoMaximoPct)%"

# La coma evita que PowerShell desarme la lista de un solo elemento.
function Linea($cantidad, $descuento) { return ,@(@{ tipo = 'producto'; id = $prod.id; cantidad = $cantidad; descuento = $descuento }) }
function Existencia { ((Llamar 'Get' "/productos?texto=$($prod.codigo)" $admin).filas | Where-Object { $_.id -eq $prod.id }).existencia }

Write-Host "`n== Venta 1: 3 unidades en efectivo ==" -ForegroundColor Cyan
$venta1 = @{ clienteId = $cf; lineas = (Linea '3' ''); pago = @{ formaPagoId = $efectivo; recibido = '200' } }
$previa = Llamar 'Post' '/ventas/calcular' $admin $venta1
Comparar 'vista previa: base / ITBIS / total' "$($previa.totales.base_imponible) / $($previa.totales.itbis) / $($previa.totales.total)" '150.00 / 27.00 / 177.00'
$v1 = Llamar 'Post' '/ventas' $admin $venta1
Ok 'venta registrada:' $v1.numero
Comparar 'devuelta de RD$200' $v1.devuelta '23.00'
Comparar 'existencia despues de vender 3 (habia 5)' (Existencia) '2.000'

Write-Host "`n== Errores esperados ==" -ForegroundColor Cyan
EsperarError 'vender 3 cuando quedan 2' 400 { Llamar 'Post' '/ventas' $admin $venta1 }
EsperarError 'efectivo recibido menor que el total' 400 { Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = (Linea '1' ''); pago = @{ formaPagoId = $efectivo; recibido = '10' } } }
EsperarError 'transferencia sin referencia' 400 { Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = (Linea '1' ''); pago = @{ formaPagoId = $transferencia } } }
EsperarError 'descuento de 11% (maximo 10%)' 400 { Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = (Linea '1' '5.50'); motivoDescuento = 'Prueba de descuento'; pago = @{ formaPagoId = $transferencia; referencia = 'X1' } } }
EsperarError 'descuento sin motivo' 400 { Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = (Linea '1' '5'); pago = @{ formaPagoId = $transferencia; referencia = 'X1' } } }
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/ventas' $null }

Write-Host "`n== Venta 2: 1 unidad con 10% de descuento, por transferencia ==" -ForegroundColor Cyan
$v2 = Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = (Linea '1' '5'); motivoDescuento = 'Prueba de descuento del 10%'; pago = @{ formaPagoId = $transferencia; referencia = "PRUEBA-$sello" } }
Comparar 'total: (50 - 5) + 18% ITBIS' $v2.total '53.10'
$n1 = [int]($v1.numero -replace '\D', ''); $n2 = [int]($v2.numero -replace '\D', '')
Comparar 'numero seguido aunque hubo errores en medio' ($n2 - $n1) 1
Llamar 'Patch' "/ventas/$($v2.id)/comprobante" $admin @{ comprobante = 'prueba-001' } | Out-Null
$d2 = Llamar 'Get' "/ventas/$($v2.id)" $admin
Comparar 'comprobante fiscal anotado (en mayusculas)' $d2.comprobante_fiscal 'PRUEBA-001'
Comparar 'existencia (quedaba 2, se vendio 1)' (Existencia) '1.000'

Write-Host "`n== Anular (la mercancia vuelve) ==" -ForegroundColor Cyan
EsperarError 'anular sin motivo' 400 { Llamar 'Post' "/ventas/$($v1.id)/anular" $admin @{ motivo = '' } }
Llamar 'Post' "/ventas/$($v1.id)/anular" $admin @{ motivo = 'Venta de prueba' } | Out-Null
Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'Venta de prueba' } | Out-Null
Comparar 'existencia despues de anular las dos (vuelve a 5)' (Existencia) '5.000'
EsperarError 'anular otra vez' 400 { Llamar 'Post' "/ventas/$($v1.id)/anular" $admin @{ motivo = 'Otra vez' } }
$d1 = Llamar 'Get' "/ventas/$($v1.id)" $admin
Comparar 'estado de la venta 1' $d1.estado 'anulada'

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'producto, categoria y unidad de prueba desactivados' ''

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de ventas (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver ventas sin permiso' 403 { Llamar 'Get' '/ventas' $sinPermiso }
EsperarError 'registrar venta sin permiso' 403 { Llamar 'Post' '/ventas' $sinPermiso $venta1 }
EsperarError 'anular venta sin permiso' 403 { Llamar 'Post' "/ventas/$($v1.id)/anular" $sinPermiso @{ motivo = 'Prueba de permiso' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
