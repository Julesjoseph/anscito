# Pruebas de la pantalla de Roles contra el backend local (npm run start:dev).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-roles.ps1
# Crea (o reutiliza) el rol de prueba "prueba_roles" y al final lo deja
# desactivado. Las contrasenas se piden ocultas y no se guardan.

$API = 'http://localhost:3000'
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

Write-Host "`n== Permisos y roles ==" -ForegroundColor Cyan
$permisos = @(Llamar 'Get' '/roles/permisos' $admin)
Ok 'permisos disponibles:' $permisos.Count
$idPermiso = @{}
foreach ($permiso in $permisos) { $idPermiso[$permiso.codigo] = $permiso.id }
$roles = @(Llamar 'Get' '/roles/gestion' $admin)
Ok 'roles:' (($roles | ForEach-Object { "$($_.nombre) ($(@($_.permisos).Count) permisos)" }) -join ', ')
$adminRol = $roles | Where-Object { $_.is_system }

Write-Host "`n== Crear rol de prueba ==" -ForegroundColor Cyan
$rol = @{ codigo = 'prueba_roles'; nombre = 'Rol de prueba'; descripcion = 'Creado por el script de pruebas'; permisos = @($idPermiso['servicios.ver']) }
$existente = $roles | Where-Object { $_.codigo -eq 'prueba_roles' }
if ($existente) {
  $id = $existente.id
  Llamar 'Patch' "/roles/$id/estado" $admin @{ is_active = $true } | Out-Null
  Llamar 'Patch' "/roles/$id" $admin $rol | Out-Null
  Ok 'prueba_roles ya existia de una prueba anterior; se reutiliza' ''
} else {
  $id = (Llamar 'Post' '/roles' $admin $rol).id
  Ok 'rol creado, id' $id
}

Write-Host "`n== Errores esperados ==" -ForegroundColor Cyan
EsperarError 'codigo repetido' 409 { Llamar 'Post' '/roles' $admin $rol }
EsperarError 'nombre vacio' 400 { Llamar 'Post' '/roles' $admin @{ codigo = 'prueba_otro'; nombre = ''; permisos = @() } }
EsperarError 'permiso inexistente' 400 { Llamar 'Post' '/roles' $admin @{ codigo = 'prueba_otro'; nombre = 'Otro'; permisos = @('11111111-1111-4111-8111-111111111111') } }
EsperarError 'quitar permisos al Administrador' 400 { Llamar 'Patch' "/roles/$($adminRol.id)" $admin @{ nombre = $adminRol.nombre; permisos = @($idPermiso['usuarios.ver']) } }
EsperarError 'desactivar el Administrador' 400 { Llamar 'Patch' "/roles/$($adminRol.id)/estado" $admin @{ is_active = $false; motivo = 'prueba de bloqueo' } }
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/roles/gestion' $null }

Write-Host "`n== Editar permisos del rol ==" -ForegroundColor Cyan
$rol.permisos = @($idPermiso['servicios.ver'], $idPermiso['impuestos.ver'])
Llamar 'Patch' "/roles/$id" $admin $rol | Out-Null
$despues = Llamar 'Get' '/roles/gestion' $admin | Where-Object { $_.id -eq $id }
Comparar 'permisos del rol de prueba despues de editar' @($despues.permisos).Count 2

Write-Host "`n== Desactivar ==" -ForegroundColor Cyan
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/roles/$id/estado" $admin @{ is_active = $false } }
Llamar 'Patch' "/roles/$id/estado" $admin @{ is_active = $false; motivo = 'Rol de prueba' } | Out-Null
$despues = Llamar 'Get' '/roles/gestion' $admin | Where-Object { $_.id -eq $id }
Comparar 'rol de prueba activo' $despues.is_active 'False'

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de roles (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver roles sin permiso' 403 { Llamar 'Get' '/roles/gestion' $sinPermiso }
EsperarError 'crear rol sin permiso' 403 { Llamar 'Post' '/roles' $sinPermiso @{ codigo = 'prueba_otro'; nombre = 'Otro'; permisos = @() } }
EsperarError 'cambiar permisos sin permiso' 403 { Llamar 'Patch' "/roles/$id" $sinPermiso $rol }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
