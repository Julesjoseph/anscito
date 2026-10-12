# Pruebas de unidades de negocio y categorias (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-categorias.ps1
# Crea (o reutiliza) "Unidad de prueba", su categoria "Categoria de prueba" y
# el servicio PRUEBA-CAT; al final deja los tres desactivados.

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

function Arbol { @(Llamar 'Get' '/unidades-negocio' $admin) }

Write-Host "`n== Unidades de negocio ==" -ForegroundColor Cyan
Ok 'unidades:' ((Arbol | ForEach-Object { $_.nombre }) -join ', ')
$unidad = Arbol | Where-Object { $_.nombre -eq 'Unidad de prueba' }
if ($unidad) {
  $unidadId = $unidad.id
  Llamar 'Patch' "/unidades-negocio/$unidadId/estado" $admin @{ is_active = $true } | Out-Null
  Ok 'Unidad de prueba ya existia; se reactiva' ''
} else {
  $unidadId = (Llamar 'Post' '/unidades-negocio' $admin @{ nombre = 'Unidad de prueba' }).id
  Ok 'unidad creada, id' $unidadId
}
EsperarError 'unidad con nombre repetido' 409 { Llamar 'Post' '/unidades-negocio' $admin @{ nombre = 'UNIDAD DE PRUEBA' } }
EsperarError 'unidad sin nombre' 400 { Llamar 'Post' '/unidades-negocio' $admin @{ nombre = '' } }

Write-Host "`n== Categorias ==" -ForegroundColor Cyan
$categoria = (Arbol | Where-Object { $_.id -eq $unidadId }).categorias |
  Where-Object { $_.nombre -like 'Categoria de prueba*' }
$datosCategoria = @{ unidadNegocioId = $unidadId; nombre = 'Categoria de prueba'; descripcion = '' }
if ($categoria) {
  $categoriaId = $categoria.id
  Llamar 'Patch' "/categorias/$categoriaId/estado" $admin @{ is_active = $true } | Out-Null
  Llamar 'Patch' "/categorias/$categoriaId" $admin $datosCategoria | Out-Null
  Ok 'Categoria de prueba ya existia; se reactiva' ''
} else {
  $categoriaId = (Llamar 'Post' '/categorias' $admin $datosCategoria).id
  Ok 'categoria creada, id' $categoriaId
}
EsperarError 'categoria repetida en la misma unidad' 409 { Llamar 'Post' '/categorias' $admin @{ unidadNegocioId = $unidadId; nombre = 'categoria de prueba' } }
$datosCategoria.nombre = 'Categoria de prueba editada'
Llamar 'Patch' "/categorias/$categoriaId" $admin $datosCategoria | Out-Null
$nombre = ((Arbol | Where-Object { $_.id -eq $unidadId }).categorias | Where-Object { $_.id -eq $categoriaId }).nombre
Comparar 'nombre despues de editar' $nombre 'Categoria de prueba editada'

Write-Host "`n== Servicio con categoria ==" -ForegroundColor Cyan
$cat = Llamar 'Get' '/servicios/catalogos' $admin
Comparar 'la categoria aparece al crear servicios' @($cat.categorias | Where-Object { $_.id -eq $categoriaId }).Count 1
$servicio = @{
  codigo = 'PRUEBA-CAT'; nombre = 'Servicio de prueba con categoria'
  unidadNegocioId = $unidadId; categoriaId = $categoriaId
  unidadMedidaId = $cat.unidadesMedida[0].id
  impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'exento' }).id
  precio = '10'; precioIncluyeItbis = $false
}
$existente = Llamar 'Get' '/servicios?texto=PRUEBA-CAT&estado=todos' $admin | Where-Object { $_.codigo -eq 'PRUEBA-CAT' }
if ($existente) {
  $servicioId = $existente.id
  Llamar 'Patch' "/servicios/$servicioId/estado" $admin @{ is_active = $true } | Out-Null
  Llamar 'Patch' "/servicios/$servicioId" $admin $servicio | Out-Null
  Ok 'PRUEBA-CAT ya existia; se reactiva' ''
} else {
  $servicioId = (Llamar 'Post' '/servicios' $admin $servicio).id
  Ok 'servicio creado, id' $servicioId
}
$fila = Llamar 'Get' "/servicios?categoriaId=$categoriaId" $admin | Where-Object { $_.codigo -eq 'PRUEBA-CAT' }
Comparar 'filtro por categoria encuentra PRUEBA-CAT' $fila.categoria 'Categoria de prueba editada'
$otraUnidad = ($cat.unidadesNegocio | Where-Object { $_.id -ne $unidadId })[0].id
$mal = $servicio.Clone(); $mal.codigo = 'PRUEBA-CAT2'; $mal.unidadNegocioId = $otraUnidad
EsperarError 'servicio con categoria de otra unidad' 400 { Llamar 'Post' '/servicios' $admin $mal }

Write-Host "`n== Desactivar (no se borra nada) ==" -ForegroundColor Cyan
EsperarError 'desactivar categoria con servicio activo' 400 { Llamar 'Patch' "/categorias/$categoriaId/estado" $admin @{ is_active = $false; motivo = 'Prueba de bloqueo' } }
EsperarError 'desactivar unidad con servicio activo' 400 { Llamar 'Patch' "/unidades-negocio/$unidadId/estado" $admin @{ is_active = $false; motivo = 'Prueba de bloqueo' } }
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/categorias/$categoriaId/estado" $admin @{ is_active = $false } }
Llamar 'Patch' "/servicios/$servicioId/estado" $admin @{ is_active = $false; motivo = 'Servicio de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$categoriaId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$unidadId/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
$cat = Llamar 'Get' '/servicios/catalogos' $admin
Comparar 'la unidad ya no aparece al crear servicios' @($cat.unidadesNegocio | Where-Object { $_.id -eq $unidadId }).Count 0
Comparar 'la categoria ya no aparece al crear servicios' @($cat.categorias | Where-Object { $_.id -eq $categoriaId }).Count 0
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/unidades-negocio' $null }

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de categorias (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver categorias sin permiso' 403 { Llamar 'Get' '/unidades-negocio' $sinPermiso }
EsperarError 'crear unidad sin permiso' 403 { Llamar 'Post' '/unidades-negocio' $sinPermiso @{ nombre = 'Otra' } }
EsperarError 'crear categoria sin permiso' 403 { Llamar 'Post' '/categorias' $sinPermiso @{ unidadNegocioId = $unidadId; nombre = 'Otra' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
