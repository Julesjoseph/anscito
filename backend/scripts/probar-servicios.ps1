# Pruebas del modulo Servicios contra el backend local (npm run start:dev).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-servicios.ps1
# Crea (o reutiliza) el servicio de prueba PRUEBA-01 y al final lo deja
# desactivado. Las contrasenas se piden ocultas y no se guardan.

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

Write-Host "`n== Catalogos ==" -ForegroundColor Cyan
$cat = Llamar 'Get' '/servicios/catalogos' $admin
Ok 'unidades de negocio:' (($cat.unidadesNegocio | ForEach-Object { $_.nombre }) -join ', ')
Ok 'unidades de medida:' (($cat.unidadesMedida | ForEach-Object { $_.nombre }) -join ', ')
Ok 'impuestos:' (($cat.impuestos | ForEach-Object { "$($_.nombre) $($_.tasa)%" }) -join ', ')

$imprenta = ($cat.unidadesNegocio | Where-Object { $_.codigo -eq 'imprenta' }).id
$pagina = ($cat.unidadesMedida | Where-Object { $_.codigo -eq 'pagina' }).id
$itbis = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id

$servicio = @{
  codigo = 'PRUEBA-01'; nombre = 'Servicio de prueba'
  unidadNegocioId = $imprenta; unidadMedidaId = $pagina
  impuestoId = $itbis; precio = '100'; precioIncluyeItbis = $false
}

Write-Host "`n== Crear ==" -ForegroundColor Cyan
$existente = Llamar 'Get' '/servicios?texto=PRUEBA-01&estado=todos' $admin |
  Where-Object { $_.codigo -eq 'PRUEBA-01' }
if ($existente) {
  $id = $existente.id
  Llamar 'Patch' "/servicios/$id/estado" $admin @{ is_active = $true } | Out-Null
  Llamar 'Patch' "/servicios/$id" $admin $servicio | Out-Null
  Ok 'PRUEBA-01 ya existia de una prueba anterior; se reutiliza' ''
} else {
  $id = (Llamar 'Post' '/servicios' $admin $servicio).id
  Ok 'servicio creado, id' $id
}

Write-Host "`n== Errores esperados ==" -ForegroundColor Cyan
EsperarError 'codigo repetido' 409 { Llamar 'Post' '/servicios' $admin $servicio }
$negativo = $servicio.Clone(); $negativo.codigo = 'PRUEBA-02'; $negativo.precio = '-5'
EsperarError 'precio negativo' 400 { Llamar 'Post' '/servicios' $admin $negativo }
$sinNombre = $servicio.Clone(); $sinNombre.codigo = 'PRUEBA-03'; $sinNombre.nombre = ''
EsperarError 'nombre vacio' 400 { Llamar 'Post' '/servicios' $admin $sinNombre }
$costoMal = $servicio.Clone(); $costoMal.codigo = 'PRUEBA-04'; $costoMal.costo = '-1'
EsperarError 'costo negativo' 400 { Llamar 'Post' '/servicios' $admin $costoMal }
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/servicios' $null }

Write-Host "`n== Calculo del ITBIS en el servidor ==" -ForegroundColor Cyan
$c1 = Llamar 'Post' '/servicios/calcular' $admin @{ precio = '100'; impuestoId = $itbis; precioIncluyeItbis = $false }
Comparar 'RD$100 sin ITBIS incluido (base / ITBIS / total)' "$($c1.base) / $($c1.itbis) / $($c1.total)" '100.00 / 18.00 / 118.00'
$c2 = Llamar 'Post' '/servicios/calcular' $admin @{ precio = '118'; impuestoId = $itbis; precioIncluyeItbis = $true }
Comparar 'RD$118 con ITBIS incluido (base / ITBIS / total)' "$($c2.base) / $($c2.itbis) / $($c2.total)" '100.00 / 18.00 / 118.00'

Write-Host "`n== Editar precio y costo ==" -ForegroundColor Cyan
$editado = $servicio.Clone(); $editado.precio = '150'; $editado.costo = '20'
Llamar 'Patch' "/servicios/$id" $admin $editado | Out-Null
$fila = Llamar 'Get' '/servicios?texto=PRUEBA-01' $admin | Where-Object { $_.codigo -eq 'PRUEBA-01' }
Comparar 'despues de editar (precio / costo / total con ITBIS)' "$($fila.precio) / $($fila.costo) / $($fila.calculo.total)" '150.00 / 20.00 / 177.00'

Write-Host "`n== Desactivar ==" -ForegroundColor Cyan
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/servicios/$id/estado" $admin @{ is_active = $false } }
Llamar 'Patch' "/servicios/$id/estado" $admin @{ is_active = $false; motivo = 'Servicio de prueba' } | Out-Null
$activos = @(Llamar 'Get' '/servicios?texto=PRUEBA-01' $admin).Count
Comparar 'servicios PRUEBA-01 activos despues de desactivar' $activos 0

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de servicios (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver servicios sin permiso' 403 { Llamar 'Get' '/servicios' $sinPermiso }
EsperarError 'crear servicio sin permiso' 403 { Llamar 'Post' '/servicios' $sinPermiso $servicio }
EsperarError 'cambiar tasa sin permiso' 403 { Llamar 'Post' "/impuestos/$itbis/tasas" $sinPermiso @{ tasa = '16'; vigenteDesde = '2099-01-01'; motivo = 'prueba' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
