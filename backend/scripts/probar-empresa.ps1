# Pruebas de empresa y sucursales (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-empresa.ps1
# NO cambia los datos reales de la empresa ni el logo: solo comprueba que se
# rechacen los datos invalidos. Crea una sucursal de prueba y la desactiva.

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

Write-Host "`n== Marca publica (sin iniciar sesion) ==" -ForegroundColor Cyan
$marca = Llamar 'Get' '/marca' $null
Ok 'nombre comercial visible en la pantalla de entrada:' $marca.nombre_comercial
EsperarError 'datos completos de la empresa sin sesion' 401 { Llamar 'Get' '/empresa' $null }

Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'

Write-Host "`n== Datos de la empresa (solo errores; no se guarda nada) ==" -ForegroundColor Cyan
$emp = Llamar 'Get' '/empresa' $admin
Ok 'datos actuales leidos; nombre comercial:' $emp.nombre_comercial
EsperarError 'RNC de 8 digitos' 400 { Llamar 'Patch' '/empresa' $admin @{ nombreComercial = $emp.nombre_comercial; rnc = '1-3000000' } }
EsperarError 'sin nombre comercial' 400 { Llamar 'Patch' '/empresa' $admin @{ nombreComercial = '' } }
EsperarError 'correo mal escrito' 400 { Llamar 'Patch' '/empresa' $admin @{ nombreComercial = $emp.nombre_comercial; correo = 'info@empresa' } }
$falso = 'data:image/png;base64,' + [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes('esto no es una imagen'))
EsperarError 'logo que no es una imagen de verdad' 400 { Llamar 'Put' '/empresa/logo' $admin @{ imagen = $falso } }
EsperarError 'archivo PDF como logo' 400 { Llamar 'Put' '/empresa/logo' $admin @{ imagen = 'data:application/pdf;base64,JVBERi0=' } }

Write-Host "`n== Sucursales ==" -ForegroundColor Cyan
$sucursales = @(Llamar 'Get' '/sucursales' $admin)
$principal = $sucursales | Where-Object { $_.es_principal }
Ok 'sucursal principal:' $principal.nombre
$s = Llamar 'Post' '/sucursales' $admin @{ codigo = "prb-$sello"; nombre = "Sucursal prueba $sello"; direccion = 'Calle de prueba'; telefono = '809-555-0000'; encargado = '' }
$creada = @(Llamar 'Get' '/sucursales' $admin) | Where-Object { $_.id -eq $s.id }
Comparar 'codigo guardado en mayusculas' $creada.codigo "PRB-$sello"
EsperarError 'codigo repetido' 409 { Llamar 'Post' '/sucursales' $admin @{ codigo = "PRB-$sello"; nombre = 'Otra' } }
EsperarError 'nombre repetido' 409 { Llamar 'Post' '/sucursales' $admin @{ codigo = "PRC-$sello"; nombre = $principal.nombre.ToUpper() } }
EsperarError 'desactivar la sucursal principal' 400 { Llamar 'Patch' "/sucursales/$($principal.id)/estado" $admin @{ is_active = $false; motivo = 'Prueba de bloqueo' } }
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/sucursales/$($s.id)/estado" $admin @{ is_active = $false } }
$paraUsuarios = @(Llamar 'Get' '/usuarios/sucursales' $admin)
Comparar 'la sucursal nueva aparece al crear usuarios' @($paraUsuarios | Where-Object { $_.id -eq $s.id }).Count 1
Llamar 'Patch' "/sucursales/$($s.id)/estado" $admin @{ is_active = $false; motivo = 'Sucursal de prueba' } | Out-Null
$paraUsuarios = @(Llamar 'Get' '/usuarios/sucursales' $admin)
Comparar 'desactivada, ya no aparece al crear usuarios' @($paraUsuarios | Where-Object { $_.id -eq $s.id }).Count 0

Write-Host "`n== Usuario sin permisos (debe dar 403) ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de empresa (ej: pedro)'
$sinPermiso = Entrar $otro
EsperarError 'ver datos de la empresa sin permiso' 403 { Llamar 'Get' '/empresa' $sinPermiso }
EsperarError 'cambiar datos de la empresa sin permiso' 403 { Llamar 'Patch' '/empresa' $sinPermiso @{ nombreComercial = 'Otro nombre' } }
EsperarError 'crear sucursal sin permiso' 403 { Llamar 'Post' '/sucursales' $sinPermiso @{ codigo = 'PRX-01'; nombre = 'X' } }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
