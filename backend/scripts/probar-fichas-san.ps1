# Pruebas de la ficha del SAN, referencias, fiador, fotos y contratos
# (npm run start:dev encendido). Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-fichas-san.ps1
# Registra una PERSONA DE PRUEBA con CIN de Haiti, un SAN DE PRUEBA en
# preparacion, sube una "foto" de prueba, confirma fiador y referencia,
# genera el contrato en espanol y en criollo y los ABRE en el navegador.
# Al final cancela el SAN de prueba y desactiva a la persona.

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

# Descarga el PDF del contrato a la carpeta temporal y lo abre.
function AbrirContrato($id, $nombre) {
  $ruta = Join-Path $env:TEMP $nombre
  Invoke-WebRequest -Uri "$API/sanes/contratos/$id/pdf" -Headers $admin -OutFile $ruta -UseBasicParsing
  Start-Process $ruta
  Ok 'contrato abierto:' $ruta
}

Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'
$tipos = @(Llamar 'Get' '/clientes/tipos-documento' $admin)
$cin = ($tipos | Where-Object { $_.codigo -eq 'cin_haiti' }).id
$cedula = ($tipos | Where-Object { $_.codigo -eq 'cedula' }).id
Comparar 'existe el tipo CIN / NIU (Haiti)' ([bool]$cin) 'True'

# Una "foto" minima: los primeros bytes de un JPG (solo para la prueba).
$foto = [Convert]::ToBase64String([byte[]](@(0xFF, 0xD8, 0xFF, 0xE0) + (@(7) * 2000)))

Write-Host "`n== Registrar a la persona desde el SAN ==" -ForegroundColor Cyan
$persona = @{
  nombre = "Jean Prueba $sello"; tipoDocumentoId = $cin; numeroDocumento = "HT$sello" + '00'
  telefono = ''; whatsapp = '829-555-0000'; direccion = 'Calle 3 #45'
  fechaNacimiento = '1988-03-12'; ocupacion = 'Comerciante'; lugarTrabajo = 'Mercado'
  sector = 'Los Mina'; municipio = 'Santo Domingo Este'; provincia = 'Santo Domingo'
  referenciaDireccion = 'Frente al colmado'; idioma = 'ht'
  emergenciaNombre = 'Ana Prueba'; emergenciaTelefono = '829-555-4444'; emergenciaRelacion = 'Esposa'
  referencias = @(@{ nombre = 'Marie Prueba'; telefono = '849-555-2222'; relacion = 'Vecina' })
  fiador = @{ nombre = 'Pierre Fiador'; telefono = '829-555-1111'; relacion = 'Hermano'; tipoDocumentoId = $cedula; numeroDocumento = '00112345678'; direccion = 'Calle 5 #12, Los Mina' }
}
$sinProvincia = $persona.Clone(); $sinProvincia.provincia = ''
EsperarError 'sin provincia' 400 { Llamar 'Post' '/sanes/personas' $admin $sinProvincia }
$cinCorto = $persona.Clone(); $cinCorto.numeroDocumento = 'AB1'
EsperarError 'CIN de Haiti muy corto' 400 { Llamar 'Post' '/sanes/personas' $admin $cinCorto }
$p = Llamar 'Post' '/sanes/personas' $admin $persona
Ok 'persona registrada con CIN de Haiti:' $persona.nombre
EsperarError 'el mismo documento otra vez' 409 { Llamar 'Post' '/sanes/personas' $admin $persona }
$ficha = Llamar 'Get' "/sanes/fichas/$($p.id)" $admin
Ok 'le falta:' (@($ficha.falta) -join ', ')

Write-Host "`n== Entrar a un SAN sin la ficha completa ==" -ForegroundColor Cyan
$san = Llamar 'Post' '/sanes' $admin @{ nombre = "SAN prueba contratos $sello"; frecuencia = 'quincenal'; cuota = '1000'; cantidadNumeros = '2'; fechaInicio = '2026-12-15'; comisionPct = '5'; moraPct = '10'; diasGracia = '3'; notas = '' }
EsperarError 'asignar sin foto ni confirmaciones' 400 { Llamar 'Post' "/sanes/$($san.id)/numeros" $admin @{ numero = '1'; terceroId = $p.id; parte = 'completo' } }

Write-Host "`n== Foto del documento ==" -ForegroundColor Cyan
EsperarError 'un archivo que no es foto' 400 { Llamar 'Post' "/sanes/fichas/$($p.id)/fotos" $admin @{ tipo = 'documento_frente'; datos = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes('hola')) } }
Llamar 'Post' "/sanes/fichas/$($p.id)/fotos" $admin @{ tipo = 'documento_frente'; datos = $foto } | Out-Null
Ok 'foto del frente subida' ''

Write-Host "`n== Confirmar fiador y referencia ==" -ForegroundColor Cyan
$ficha = Llamar 'Get' "/sanes/fichas/$($p.id)" $admin
$fiador = @($ficha.garantes) | Where-Object { $_.tipo -eq 'fiador' }
$ref = @($ficha.garantes) | Where-Object { $_.tipo -eq 'referencia' } | Select-Object -First 1
EsperarError 'confirmar sin nota' 400 { Llamar 'Post' "/sanes/garantes/$($fiador.id)/confirmar" $admin @{ nota = '' } }
Llamar 'Post' "/sanes/garantes/$($fiador.id)/confirmar" $admin @{ nota = 'Llame y confirma que acepta ser fiador' } | Out-Null
Llamar 'Post' "/sanes/garantes/$($ref.id)/confirmar" $admin @{ nota = 'La vecina lo conoce hace 5 anos' } | Out-Null
$ficha = Llamar 'Get' "/sanes/fichas/$($p.id)" $admin
Comparar 'ya no le falta nada' (@($ficha.falta).Count) '0'

Write-Host "`n== Asignar y contratos ==" -ForegroundColor Cyan
$num = Llamar 'Post' "/sanes/$($san.id)/numeros" $admin @{ numero = '1'; terceroId = $p.id; parte = 'completo' }
Ok 'asignado al numero 1' ''
$c1 = Llamar 'Post' '/sanes/contratos' $admin @{ participacionId = $num.id; idioma = 'es'; lugar = 'Santo Domingo' }
Ok 'contrato en espanol:' $c1.codigo
AbrirContrato $c1.id "contrato-prueba-es-$sello.pdf"
EsperarError 'segundo contrato para el mismo numero' 409 { Llamar 'Post' '/sanes/contratos' $admin @{ participacionId = $num.id; idioma = 'fr'; lugar = 'Santo Domingo' } }
Llamar 'Post' "/sanes/contratos/$($c1.id)/anular" $admin @{ motivo = 'Prefiere el contrato en criollo' } | Out-Null
$c2 = Llamar 'Post' '/sanes/contratos' $admin @{ participacionId = $num.id; idioma = 'ht'; lugar = 'Santo Domingo' }
Ok 'contrato en criollo:' $c2.codigo
AbrirContrato $c2.id "contrato-prueba-ht-$sello.pdf"
Llamar 'Post' "/sanes/contratos/$($c2.id)/firmado" $admin @{ datos = $foto } | Out-Null
$ficha = Llamar 'Get' "/sanes/fichas/$($p.id)" $admin
Ok 'contratos de la persona:' ((@($ficha.contratos) | ForEach-Object { "$($_.codigo) $($_.idioma) $($_.estado)" }) -join ' | ')

Write-Host "`n== Permisos ==" -ForegroundColor Cyan
EsperarError 'ver la ficha sin iniciar sesion' 401 { Llamar 'Get' "/sanes/fichas/$($p.id)" $null }

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Llamar 'Post' "/sanes/contratos/$($c2.id)/anular" $admin @{ motivo = 'Contrato de prueba' } | Out-Null
EsperarError 'quitar del SAN a quien ya tiene contrato' 400 { Llamar 'Post' "/sanes/$($san.id)/numeros/$($num.id)/quitar" $admin }
Llamar 'Patch' "/sanes/$($san.id)/estado" $admin @{ estado = 'cancelado'; motivo = 'SAN de prueba' } | Out-Null
Llamar 'Patch' "/clientes/$($p.id)/estado" $admin @{ is_active = $false; motivo = 'Persona de prueba' } | Out-Null
Ok 'SAN de prueba cancelado y persona de prueba desactivada' ''
Write-Host "`nListo. Todas las lineas deben decir OK en verde y se abren 2 contratos en PDF." -ForegroundColor Cyan
