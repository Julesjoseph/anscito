# Pruebas de clientes y proveedores (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-clientes.ps1
# Cada ejecucion crea un cliente y un proveedor de prueba con una cedula
# inventada distinta, y al final los deja desactivados.

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
$sello = Get-Date -Format 'HHmmss'
# Cedula inventada de 11 digitos, distinta en cada ejecucion.
$cedula = "999$($sello)00"
$cedulaConGuiones = "$($cedula.Substring(0,3))-$($cedula.Substring(3,7))-$($cedula.Substring(10,1))"

$tipos = @(Llamar 'Get' '/clientes/tipos-documento' $admin)
Ok 'tipos de documento:' (($tipos | ForEach-Object { $_.nombre }) -join ', ')
$T = @{}
foreach ($tipo in $tipos) { $T[$tipo.codigo] = $tipo.id }

$cliente = @{
  tipoDocumentoId = $T['cedula']; numeroDocumento = $cedulaConGuiones
  nombre = "Cliente prueba $sello"; nombreComercial = ''; esContribuyente = $false
  direccion = 'Calle de prueba 1'; telefono = '809-555-1234'; whatsapp = '829-555-9876'
  correo = 'prueba@ejemplo.com'; notas = ''; puedeCredito = $true
}

Write-Host "`n== Crear cliente (cedula con guiones) ==" -ForegroundColor Cyan
$c1 = Llamar 'Post' '/clientes' $admin $cliente
Ok 'cliente creado con cedula' $cedulaConGuiones
$fila = (Llamar 'Get' "/clientes?texto=$cedula" $admin).filas | Where-Object { $_.id -eq $c1.id }
Comparar 'la cedula se guardo sin guiones' $fila.numero_documento $cedula

Write-Host "`n== Errores esperados ==" -ForegroundColor Cyan
$dup = $cliente.Clone(); $dup.nombre = 'Otra persona'; $dup.numeroDocumento = $cedula
EsperarError 'cedula repetida en clientes' 409 { Llamar 'Post' '/clientes' $admin $dup }
$mal = $cliente.Clone(); $mal.numeroDocumento = '001-123456-8'
EsperarError 'cedula de 10 digitos' 400 { Llamar 'Post' '/clientes' $admin $mal }
$mal = $cliente.Clone(); $mal.tipoDocumentoId = $T['rnc']; $mal.numeroDocumento = '1-3000000'
EsperarError 'RNC de 8 digitos' 400 { Llamar 'Post' '/clientes' $admin $mal }
$mal = @{ nombre = 'Sin documento'; esContribuyente = $true; puedeCredito = $false }
EsperarError 'contribuyente sin documento' 400 { Llamar 'Post' '/clientes' $admin $mal }
$mal = @{ nombre = 'Telefono malo'; esContribuyente = $false; puedeCredito = $false; telefono = '809-55A-1234' }
EsperarError 'telefono con letras' 400 { Llamar 'Post' '/clientes' $admin $mal }
$mal = @{ nombre = 'Correo malo'; esContribuyente = $false; puedeCredito = $false; correo = 'juan@gmail' }
EsperarError 'correo mal escrito' 400 { Llamar 'Post' '/clientes' $admin $mal }
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/clientes' $null }

Write-Host "`n== Proveedor con la misma cedula (lista separada) ==" -ForegroundColor Cyan
$proveedor = @{
  tipoDocumentoId = $T['cedula']; numeroDocumento = $cedula
  nombre = "Proveedor prueba $sello"; esContribuyente = $true
  personaContacto = 'Contacto de prueba'; diasCredito = '30'; telefono = '809-555-0000'
}
$p1 = Llamar 'Post' '/proveedores' $admin $proveedor
Ok 'proveedor creado con la misma cedula: permitido' ''
$mal = $proveedor.Clone(); $mal.nombre = 'Plazo malo'; $mal.numeroDocumento = ''; $mal.tipoDocumentoId = ''; $mal.esContribuyente = $false; $mal.diasCredito = '400'
EsperarError 'dias de plazo 400' 400 { Llamar 'Post' '/proveedores' $admin $mal }

Write-Host "`n== Consumidor final protegido ==" -ForegroundColor Cyan
$cf = (Llamar 'Get' '/clientes?texto=Consumidor' $admin).filas | Where-Object { $_.es_protegido }
EsperarError 'editar Consumidor final' 400 { Llamar 'Patch' "/clientes/$($cf.id)" $admin @{ nombre = 'Otro'; esContribuyente = $false; puedeCredito = $false } }
EsperarError 'desactivar Consumidor final' 400 { Llamar 'Patch' "/clientes/$($cf.id)/estado" $admin @{ is_active = $false; motivo = 'Prueba de bloqueo' } }

Write-Host "`n== Desactivar (no se borra nada) ==" -ForegroundColor Cyan
EsperarError 'desactivar sin motivo' 400 { Llamar 'Patch' "/clientes/$($c1.id)/estado" $admin @{ is_active = $false } }
Llamar 'Patch' "/clientes/$($c1.id)/estado" $admin @{ is_active = $false; motivo = 'Cliente de prueba' } | Out-Null
Llamar 'Patch' "/proveedores/$($p1.id)/estado" $admin @{ is_active = $false; motivo = 'Proveedor de prueba' } | Out-Null
EsperarError 'crear otra vez la cedula del cliente desactivado' 409 { Llamar 'Post' '/clientes' $admin $cliente }

Write-Host "`n== Usuario sin permisos ==" -ForegroundColor Cyan
$otro = Read-Host 'Usuario SIN permisos de clientes (ej: pedro)'
$sinPermiso = Entrar $otro
try {
  $lista = Llamar 'Get' "/clientes?texto=$sello&estado=todos" $sinPermiso
  # Si este usuario SI puede ver clientes, la cedula debe salir oculta.
  $vista = $lista.filas | Where-Object { $_.id -eq $c1.id }
  if ($lista.verDocumento) {
    Write-Host "AVISO  $otro tiene el permiso de ver documentos completos; no sirve para probar el enmascarado" -ForegroundColor Yellow
  } else {
    Comparar 'cedula enmascarada para quien no tiene el permiso' $vista.numero_documento ('********' + $cedula.Substring(8))
  }
} catch {
  $codigo = [int]$_.Exception.Response.StatusCode
  Comparar 'ver clientes sin permiso' $codigo 403
  Write-Host "       (Para probar el enmascarado, dele a su rol solo 'Ver clientes' y ejecute otra vez)" -ForegroundColor DarkGray
}
EsperarError 'crear cliente sin permiso' 403 { Llamar 'Post' '/clientes' $sinPermiso $cliente }
EsperarError 'crear proveedor sin permiso' 403 { Llamar 'Post' '/proveedores' $sinPermiso $proveedor }

Remove-Variable admin, sinPermiso -ErrorAction SilentlyContinue
Write-Host "`nFin de las pruebas." -ForegroundColor Cyan
