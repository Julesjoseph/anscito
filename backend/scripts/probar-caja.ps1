# Pruebas de caja (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-caja.ps1
# Crea una CAJA DE PRUEBA y un producto de prueba, abre la caja con RD$1,000,
# vende en efectivo, registra un gasto, un retiro y un ingreso, anula una
# venta (devuelve el efectivo), cierra contando billetes con un faltante de
# RD$10 y guarda el cuadre en PDF en la carpeta backend\scripts.
# Al final desactiva la caja y el producto. Las sesiones y movimientos quedan
# en la base de desarrollo (no se borran, como en la vida real).

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

Write-Host "`n== Preparar caja y producto de prueba ==" -ForegroundColor Cyan
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-$sello"; nombre = "Caja prueba $sello" }
Ok 'caja de prueba creada:' "PRUEBA-$sello"
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Caja prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'exento' }).id
  precioVenta = '50'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '20'
}
Ok 'producto exento a RD$50 con 20 unidades:' $prod.codigo
$prep = Llamar 'Get' '/ventas/preparar' $admin
$efectivo = ($prep.formasPago | Where-Object { $_.codigo -eq 'efectivo' }).id
$cf = $prep.consumidorFinal.id
$cp = Llamar 'Get' '/caja/preparar' $admin
$limpieza = ($cp.categoriasGasto | Where-Object { $_.codigo -eq 'limpieza' }).id
Ok 'billetes y monedas:' ($cp.denominaciones -join ', ')

function Vender($cantidad) {
  Llamar 'Post' '/ventas' $admin @{ clienteId = $cf; lineas = ,@(@{ tipo = 'producto'; id = $prod.id; cantidad = $cantidad }); pago = @{ formaPagoId = $efectivo; recibido = '1000'; cajaId = $caja.id } }
}
function Esperado { (Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin).esperado }

Write-Host "`n== Abrir ==" -ForegroundColor Cyan
EsperarError 'vender en efectivo con la caja cerrada' 400 { Vender '1' }
EsperarError 'abrir con fondo negativo' 400 { Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '-5' } }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '1000'; notas = 'Prueba' }
Ok 'caja abierta con RD$1,000:' $sesion.sesion
EsperarError 'abrir otra vez la misma caja' 409 { Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' } }

Write-Host "`n== Ventas en efectivo ==" -ForegroundColor Cyan
$v1 = Vender '4'
$v2 = Vender '2'
Ok 'ventas:' "$($v1.numero) (RD$200) y $($v2.numero) (RD$100)"
Comparar 'debe haber 1000 + 300' (Esperado) '1300.00'

Write-Host "`n== Gasto, retiro e ingreso ==" -ForegroundColor Cyan
$mov = "/caja/sesiones/$($sesion.id)/movimientos"
EsperarError 'gasto sin categoria' 400 { Llamar 'Post' $mov $admin @{ tipo = 'gasto'; monto = '75'; motivo = 'Cloro y jabon' } }
EsperarError 'retiro sin motivo' 400 { Llamar 'Post' $mov $admin @{ tipo = 'retiro'; monto = '50' } }
EsperarError 'retiro mayor que lo que hay' 400 { Llamar 'Post' $mov $admin @{ tipo = 'retiro'; monto = '1300.01'; motivo = 'Deposito al banco' } }
EsperarError 'monto en cero' 400 { Llamar 'Post' $mov $admin @{ tipo = 'ingreso'; monto = '0'; motivo = 'Prueba de cero' } }
Llamar 'Post' $mov $admin @{ tipo = 'gasto'; monto = '75'; categoriaGastoId = $limpieza; comprobante = 'B0200000001'; motivo = 'Cloro y jabon' } | Out-Null
Llamar 'Post' $mov $admin @{ tipo = 'retiro'; monto = '500'; motivo = 'Deposito al banco' } | Out-Null
Llamar 'Post' $mov $admin @{ tipo = 'ingreso'; monto = '25'; motivo = 'Cambio que trajo el dueno' } | Out-Null
Comparar 'debe haber 1300 - 75 - 500 + 25' (Esperado) '750.00'

Write-Host "`n== Anular venta en efectivo (sale de la caja) ==" -ForegroundColor Cyan
EsperarError 'anular sin decir la caja' 400 { Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'Cliente devolvio' } }
Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'Cliente devolvio'; cajaId = $caja.id } | Out-Null
Comparar 'debe haber 750 - 100 devueltos' (Esperado) '650.00'
$det = Llamar 'Get' "/caja/sesiones/$($sesion.id)" $admin
Comparar 'totales: ventas / gastos / retiros / ingresos / devoluciones' "$($det.totales.ventas) / $($det.totales.gastos) / $($det.totales.retiros) / $($det.totales.ingresos) / $($det.totales.devoluciones)" '300.00 / 75.00 / 500.00 / 25.00 / 100.00'

Write-Host "`n== Panel ==" -ForegroundColor Cyan
$panel = Llamar 'Get' '/panel?periodo=hoy' $admin
$enPanel = ($panel.caja.abiertas | Where-Object { $_.caja -eq "Caja prueba $sello" }).esperado
Comparar 'el panel muestra el efectivo de la caja de prueba' $enPanel '650.00'

Write-Host "`n== Cerrar contando billetes (faltan RD$10) ==" -ForegroundColor Cyan
$conteo = @{ '500' = 1; '100' = 1; '25' = 1; '10' = 1; '5' = 1 }
EsperarError 'billete que no existe (RD$3)' 400 { Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{ '3' = 1 } } }
EsperarError 'cerrar con faltante sin motivo' 400 { Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = $conteo } }
$cierre = Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = $conteo; motivo = 'Se dio devuelta de mas'; notas = 'Prueba' }
Comparar 'debia haber / contado / diferencia' "$($cierre.esperado) / $($cierre.contado) / $($cierre.diferencia)" '650.00 / 640.00 / -10.00'
EsperarError 'cerrar otra vez' 400 { Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = $conteo; motivo = 'Otra vez' } }
EsperarError 'gasto con la caja cerrada' 400 { Llamar 'Post' $mov $admin @{ tipo = 'ingreso'; monto = '5'; motivo = 'Despues de cerrar' } }
EsperarError 'vender en efectivo con la caja cerrada' 400 { Vender '1' }

$archivo = Join-Path $PSScriptRoot "cuadre-$($sesion.sesion).pdf"
Invoke-WebRequest -Uri "$API/caja/sesiones/$($sesion.id)/cuadre?formato=80" -Headers $admin -OutFile $archivo -UseBasicParsing
Ok 'cuadre en PDF guardado en:' $archivo

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'caja, producto, categoria y unidad de prueba desactivados' ''

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de caja (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver cajas sin permiso' 403 { Llamar 'Get' '/caja/cajas' $sinPermiso }
EsperarError 'abrir caja sin permiso' 403 { Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $sinPermiso @{ fondoInicial = '0' } }
EsperarError 'registrar gasto sin permiso' 403 { Llamar 'Post' $mov $sinPermiso @{ tipo = 'retiro'; monto = '5'; motivo = 'Prueba de permiso' } }
EsperarError 'cerrar caja sin permiso' 403 { Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $sinPermiso @{ conteo = @{} } }
EsperarError 'crear caja sin permiso' 403 { Llamar 'Post' '/caja/cajas' $sinPermiso @{ codigo = 'NO-PUEDE'; nombre = 'No puede' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
