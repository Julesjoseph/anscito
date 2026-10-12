# Pruebas de entradas, salidas, ajustes y kardex (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-movimientos.ps1
# Usa la categoria "Productos de prueba" (PRB). Cada ejecucion crea un
# producto de prueba nuevo y al final deja todo desactivado.

$API = 'http://localhost:3010'
# Cualquier error inesperado detiene el script en vez de seguir en cadena.
$ErrorActionPreference = 'Stop'

function Cuerpo($datos) {
  # PowerShell 5 envia el texto en otra codificacion; se manda en UTF-8.
  # La coma evita que PowerShell desarme la lista de bytes.
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($datos | ConvertTo-Json))
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
$producto = @{
  nombre = "Agua prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id
  precioVenta = '50'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '20'
}
$p = Llamar 'Post' '/productos' $admin $producto
Ok 'producto creado con 20 a RD$30:' $p.codigo

Write-Host "`n== Entrada: llegan 50 a RD$32 ==" -ForegroundColor Cyan
$e = Llamar 'Post' "/productos/$($p.id)/entradas" $admin @{ cantidad = '50'; costoUnitario = '32'; proveedor = 'Proveedor de prueba'; referencia = 'B0100000001'; nota = '' }
Comparar 'existencia despues de la entrada' $e.existencia '70.000'
Comparar 'costo promedio (20x30 + 50x32) / 70' $e.costo '31.43'
EsperarError 'entrada con decimales en Unidad' 400 { Llamar 'Post' "/productos/$($p.id)/entradas" $admin @{ cantidad = '1.5'; costoUnitario = '30' } }
EsperarError 'entrada con cantidad 0' 400 { Llamar 'Post' "/productos/$($p.id)/entradas" $admin @{ cantidad = '0'; costoUnitario = '30' } }

Write-Host "`n== Salida: se danan 2 ==" -ForegroundColor Cyan
$s = Llamar 'Post' "/productos/$($p.id)/salidas" $admin @{ cantidad = '2'; causa = 'dano'; motivo = 'Botellas rotas al descargar'; referencia = '' }
Comparar 'existencia despues de la salida' $s.existencia '68.000'
EsperarError 'salida mayor que el stock' 400 { Llamar 'Post' "/productos/$($p.id)/salidas" $admin @{ cantidad = '100'; causa = 'vencido'; motivo = 'Prueba de stock' } }
EsperarError 'salida sin causa' 400 { Llamar 'Post' "/productos/$($p.id)/salidas" $admin @{ cantidad = '1'; motivo = 'Prueba de causa' } }
EsperarError 'salida sin motivo' 400 { Llamar 'Post' "/productos/$($p.id)/salidas" $admin @{ cantidad = '1'; causa = 'otro'; motivo = '' } }

Write-Host "`n== Ajuste por conteo: se cuentan 65 ==" -ForegroundColor Cyan
$a = Llamar 'Post' "/productos/$($p.id)/ajustes" $admin @{ conteo = '65'; motivo = 'Conteo fisico de prueba' }
Comparar 'existencia despues del ajuste' $a.existencia '65.000'
Comparar 'tipo de ajuste (faltaban 3)' "$($a.tipo) $($a.diferencia)" 'ajuste_salida 3.000'
EsperarError 'ajuste igual al stock' 400 { Llamar 'Post' "/productos/$($p.id)/ajustes" $admin @{ conteo = '65'; motivo = 'Conteo repetido' } }

Write-Host "`n== La fila queda como la hoja de calculo ==" -ForegroundColor Cyan
$f = (Llamar 'Get' "/productos?texto=$($p.codigo)" $admin).filas | Where-Object { $_.id -eq $p.id }
Comparar 'inicial / entradas / salidas / actual' "$($f.existencia_inicial) / $($f.entradas) / $($f.salidas) / $($f.existencia)" '20.000 / 50.000 / 5.000 / 65.000'
$k = Llamar 'Get' "/productos/$($p.id)/kardex" $admin
Comparar 'movimientos en el kardex' @($k.movimientos).Count 4
Comparar 'saldo del ultimo movimiento' @($k.movimientos)[0].saldo '65.000'
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' "/productos/$($p.id)/kardex" $null }

Write-Host "`n== Desactivar (no se borra nada) ==" -ForegroundColor Cyan
Llamar 'Patch' "/productos/$($p.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
EsperarError 'entrada en producto desactivado' 400 { Llamar 'Post' "/productos/$($p.id)/entradas" $admin @{ cantidad = '1'; costoUnitario = '30' } }
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'producto, categoria y unidad de prueba desactivados' ''

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de inventario (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'registrar entrada sin permiso' 403 { Llamar 'Post' "/productos/$($p.id)/entradas" $sinPermiso @{ cantidad = '1'; costoUnitario = '30' } }
EsperarError 'registrar salida sin permiso' 403 { Llamar 'Post' "/productos/$($p.id)/salidas" $sinPermiso @{ cantidad = '1'; causa = 'dano'; motivo = 'Prueba de permiso' } }
EsperarError 'ajustar sin permiso' 403 { Llamar 'Post' "/productos/$($p.id)/ajustes" $sinPermiso @{ conteo = '1'; motivo = 'Prueba de permiso' } }
EsperarError 'ver kardex sin permiso' 403 { Llamar 'Get' "/productos/$($p.id)/kardex" $sinPermiso }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
