# Pruebas de productos de inventario (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-productos.ps1
# Usa "Unidad de prueba" y crea (o reutiliza) las categorias "Productos de
# prueba" (prefijo PRB) y "Sin prefijo prueba". Cada ejecucion crea dos
# productos de prueba nuevos y al final deja todo desactivado.

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

Write-Host "`n== Preparar categorias de prueba ==" -ForegroundColor Cyan
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
if (-not $unidad) { $unidad = @{ id = (Llamar 'Post' '/unidades-negocio' $admin @{ nombre = 'Unidad de prueba' }).id; categorias = @() } }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
function Categoria($nombre, $prefijo) {
  $existe = @($unidad.categorias) | Where-Object { $_.nombre -eq $nombre }
  $datos = @{ unidadNegocioId = $unidad.id; nombre = $nombre; descripcion = ''; prefijo = $prefijo }
  if ($existe) {
    Llamar 'Patch' "/categorias/$($existe.id)/estado" $admin @{ is_active = $true } | Out-Null
    return $existe.id
  }
  return (Llamar 'Post' '/categorias' $admin $datos).id
}
$catId = Categoria 'Productos de prueba' 'PRB'
$sinPrefijoId = Categoria 'Sin prefijo prueba' ''
Ok 'categorias listas' ''

$cat = Llamar 'Get' '/productos/catalogos' $admin
$enCatalogo = $cat.categorias | Where-Object { $_.id -eq $catId }
Ok 'proximo codigo segun la pantalla:' $enCatalogo.proximo
$unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
$libraId = ($cat.unidades | Where-Object { $_.codigo -eq 'libra' }).id
$itbisId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id

$producto = @{
  nombre = "Producto prueba A $sello"; categoriaId = $catId; unidadId = $unidadId
  costo = '100'; impuestoId = $itbisId; precioVenta = '150'; precioIncluyeItbis = $true
  stockMinimo = '5'; existenciaInicial = '10'
}

Write-Host "`n== Crear dos productos seguidos ==" -ForegroundColor Cyan
$p1 = Llamar 'Post' '/productos' $admin $producto
$segundo = $producto.Clone(); $segundo.nombre = "Producto prueba B $sello"; $segundo.existenciaInicial = ''
$p2 = Llamar 'Post' '/productos' $admin $segundo
Ok 'codigos asignados:' "$($p1.codigo) y $($p2.codigo)"
Comparar 'el primero recibio el codigo que mostraba la pantalla' $p1.codigo $enCatalogo.proximo
$n1 = [int]($p1.codigo -split '-')[1]; $n2 = [int]($p2.codigo -split '-')[1]
Comparar 'el segundo codigo es el siguiente numero' ($n2 - $n1) 1

Write-Host "`n== Errores esperados ==" -ForegroundColor Cyan
EsperarError 'nombre repetido en la categoria' 409 { Llamar 'Post' '/productos' $admin $producto }
$mal = $producto.Clone(); $mal.nombre = "X $sello"; $mal.costo = '-1'
EsperarError 'costo negativo' 400 { Llamar 'Post' '/productos' $admin $mal }
$mal = $producto.Clone(); $mal.nombre = "X $sello"; $mal.existenciaInicial = '2.5'
EsperarError 'decimales en una unidad entera' 400 { Llamar 'Post' '/productos' $admin $mal }
$mal = $producto.Clone(); $mal.nombre = "X $sello"; $mal.categoriaId = $sinPrefijoId
EsperarError 'categoria sin prefijo' 400 { Llamar 'Post' '/productos' $admin $mal }
EsperarError 'cambiar el prefijo de una categoria con productos' 400 { Llamar 'Patch' "/categorias/$catId" $admin @{ unidadNegocioId = $unidad.id; nombre = 'Productos de prueba'; prefijo = 'PRZ' } }
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/productos' $null }

Write-Host "`n== Lista: existencia inicial y costo como factura ==" -ForegroundColor Cyan
$fila = (Llamar 'Get' "/productos?texto=$($p1.codigo)" $admin).filas | Where-Object { $_.codigo -eq $p1.codigo }
Comparar 'existencia inicial' $fila.existencia_inicial '10.000'
Comparar 'costo / ITBIS / costo con ITBIS' "$($fila.calculo_costo.base) / $($fila.calculo_costo.itbis) / $($fila.calculo_costo.total)" '100.00 / 18.00 / 118.00'

Write-Host "`n== Editar costo (el codigo no cambia) ==" -ForegroundColor Cyan
$editado = $producto.Clone(); $editado.costo = '110'
Llamar 'Patch' "/productos/$($p1.id)" $admin $editado | Out-Null
$fila = (Llamar 'Get' "/productos?texto=$($p1.codigo)" $admin).filas | Where-Object { $_.id -eq $p1.id }
Comparar 'codigo despues de editar' $fila.codigo $p1.codigo
Comparar 'costo despues de editar' $fila.costo '110.00'
$libra = $producto.Clone(); $libra.unidadId = $libraId
EsperarError 'cambiar la unidad con existencia registrada' 400 { Llamar 'Patch' "/productos/$($p1.id)" $admin $libra }

Write-Host "`n== Desactivar (no se borra nada) ==" -ForegroundColor Cyan
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/productos/$($p1.id)/estado" $admin @{ is_active = $false } }
EsperarError 'desactivar categoria con productos activos' 400 { Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Prueba de bloqueo' } }
foreach ($p in @($p1, $p2)) { Llamar 'Patch' "/productos/$($p.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null }
foreach ($c in @($catId, $sinPrefijoId)) { Llamar 'Patch' "/categorias/$c/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
$activos = (Llamar 'Get' "/productos?texto=$sello" $admin).total
Comparar 'productos de prueba activos al final' $activos 0

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de inventario (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver productos sin permiso' 403 { Llamar 'Get' '/productos' $sinPermiso }
EsperarError 'crear producto sin permiso' 403 { Llamar 'Post' '/productos' $sinPermiso $producto }
EsperarError 'editar producto sin permiso' 403 { Llamar 'Patch' "/productos/$($p1.id)" $sinPermiso $producto }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
