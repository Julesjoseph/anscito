# Pruebas de facturacion electronica en modo manual (npm run start:dev encendido).
# Uso, desde la carpeta backend:
#   powershell -ExecutionPolicy Bypass -File .\scripts\probar-facturacion.ps1
# Pone la fecha de inicio en HOY (solo durante la prueba), crea un CLIENTE
# contribuyente, un PRODUCTO y una CAJA DE PRUEBA, registra ventas, anota
# e-NCF inventados (no se envia nada a la DGII), anula y revisa la nota de
# credito. Al final devuelve la configuracion como estaba y desactiva todo.
# Los comprobantes de prueba quedan en la base de desarrollo (no se borran).

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

function Ok($nombre, $detalle) {
  Write-Host "OK     $nombre $detalle" -ForegroundColor Green
}

function Comparar($nombre, $real, $esperado) {
  if ("$real" -eq "$esperado") {
    Write-Host "OK     $nombre -> $real" -ForegroundColor Green
  } else {
    Write-Host "FALLO  $nombre -> $real (se esperaba $esperado)" -ForegroundColor Red
  }
}

# El e-CF de una venta (el que no esta cancelado), buscado en la lista.
function EcfDe($venta, $tipo) {
  $lista = Llamar 'Get' "/facturacion?estado=todos&texto=$([int]$venta.numero.Substring(2))" $admin
  @($lista.filas) | Where-Object { $_.venta_id -eq $venta.id -and $_.tipo -eq $tipo -and $_.estado -ne 'cancelado' } | Select-Object -First 1
}

Write-Host "`n== Entrar como administrador ==" -ForegroundColor Cyan
$admin = Entrar 'anscito'
$sello = Get-Date -Format 'HHmmss'
# Secuencia de 10 digitos distinta en cada prueba (los e-NCF no se repiten).
$sec = Get-Date -Format 'MMddHHmmss'

Write-Host "`n== Configuracion ==" -ForegroundColor Cyan
$antes = Llamar 'Get' '/facturacion/preparar' $admin
Ok 'configuracion actual:' "modo $($antes.modo), inicio '$($antes.inicio)', consumo identificado desde RD$($antes.umbral)"
EsperarError 'fecha de inicio invalida' 400 { Llamar 'Patch' '/facturacion/configuracion' $admin @{ inicio = '2026-02-30'; umbral = '250000' } }
Llamar 'Patch' '/facturacion/configuracion' $admin @{ inicio = $antes.hoy; umbral = '250000' } | Out-Null
Comparar 'facturacion activa desde hoy' (Llamar 'Get' '/facturacion/preparar' $admin).activa 'True'

# Pase lo que pase, al final la configuracion vuelve a como estaba.
try {

Write-Host "`n== Preparar producto, cliente y caja de prueba ==" -ForegroundColor Cyan
$unidad = @(Llamar 'Get' '/unidades-negocio' $admin) | Where-Object { $_.nombre -eq 'Unidad de prueba' }
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $true } | Out-Null
$catId = (@($unidad.categorias) | Where-Object { $_.nombre -eq 'Productos de prueba' }).id
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $true } | Out-Null
$cat = Llamar 'Get' '/productos/catalogos' $admin
$prod = Llamar 'Post' '/productos' $admin @{
  nombre = "Factura prueba $sello"; categoriaId = $catId
  unidadId = ($cat.unidades | Where-Object { $_.codigo -eq 'unidad' }).id
  costo = '30'; impuestoId = ($cat.impuestos | Where-Object { $_.codigo -eq 'itbis' }).id
  precioVenta = '100'; precioIncluyeItbis = $false; stockMinimo = ''; existenciaInicial = '10'
}
Ok 'producto a RD$100 + ITBIS:' $prod.codigo
$rnc = (Get-Random -Minimum 100000000 -Maximum 199999999).ToString()
$tipoRnc = (@(Llamar 'Get' '/clientes/tipos-documento' $admin) | Where-Object { $_.codigo -eq 'rnc' }).id
$empresa = Llamar 'Post' '/clientes' $admin @{
  tipoDocumentoId = $tipoRnc; numeroDocumento = $rnc; nombre = "Empresa prueba $sello SRL"
  nombreComercial = ''; esContribuyente = $true; direccion = ''; telefono = ''; whatsapp = ''
  correo = ''; notas = ''; puedeCredito = $false; personaContacto = ''; diasCredito = ''
}
Ok 'cliente contribuyente con RNC:' $rnc
$prep = Llamar 'Get' '/ventas/preparar' $admin
$efectivo = ($prep.formasPago | Where-Object { $_.codigo -eq 'efectivo' }).id
$cf = $prep.consumidorFinal.id
Comparar 'Ventas sabe que la facturacion esta activa' $prep.facturacion.activa 'True'
$caja = Llamar 'Post' '/caja/cajas' $admin @{ codigo = "PRUEBA-F$sello"; nombre = "Caja prueba factura $sello" }
$sesion = Llamar 'Post' "/caja/cajas/$($caja.id)/abrir" $admin @{ fondoInicial = '0' }

function Vender($cliente, $tipo) {
  Llamar 'Post' '/ventas' $admin @{
    clienteId = $cliente; tipoEcf = $tipo
    lineas = @(@{ tipo = 'producto'; id = $prod.id; cantidad = '1'; descuento = '' })
    pago = @{ formaPagoId = $efectivo; recibido = '200'; cajaId = $caja.id }
  }
}

Write-Host "`n== Ventas: cada una deja su e-CF por emitir ==" -ForegroundColor Cyan
$v1 = Vender $cf ''
Comparar 'consumidor final -> tipo' $v1.ecf '32'
$v2 = Vender $empresa.id ''
Comparar 'cliente contribuyente -> tipo' $v2.ecf '31'
$v3 = Vender $cf ''
EsperarError 'consumidor final pide Credito Fiscal (31)' 400 { Vender $cf '31' }
EsperarError 'tipo 34 en una venta' 400 { Vender $cf '34' }
$pend = Llamar 'Get' '/facturacion' $admin
Ok 'por emitir en la lista:' $pend.total

Write-Host "`n== Anotar el e-NCF ==" -ForegroundColor Cyan
$e1 = EcfDe $v1 '32'
EsperarError 'e-NCF de otro tipo (E31 en un Consumo)' 400 { Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = "E31$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'AB12cd' } }
EsperarError 'e-NCF corto' 400 { Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = 'E3200001'; fechaEmision = $antes.hoy; codigoSeguridad = 'AB12cd' } }
EsperarError 'sin codigo de seguridad' 400 { Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = '' } }
EsperarError 'fecha de emision futura' 400 { Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = "E32$sec"; fechaEmision = '2099-01-01'; codigoSeguridad = 'AB12cd' } }
$r = Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = "e32 $sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'AB12cd' }
Comparar 'emitido (acepta espacios y minuscula)' $r.encf "E32$sec"
EsperarError 'emitir otra vez el mismo' 400 { Llamar 'Post' "/facturacion/$($e1.id)/emitir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'AB12cd' } }
$e3 = EcfDe $v3 '32'
EsperarError 'el mismo e-NCF en otra factura' 409 { Llamar 'Post' "/facturacion/$($e3.id)/emitir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'AB12cd' } }
EsperarError 'corregir sin motivo' 400 { Llamar 'Post' "/facturacion/$($e1.id)/corregir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'ZZ99zz' } }
Llamar 'Post' "/facturacion/$($e1.id)/corregir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'ZZ99zz'; motivo = 'Codigo mal copiado' } | Out-Null
Comparar 'codigo de seguridad corregido' (EcfDe $v1 '32').codigo_seguridad 'ZZ99zz'

Write-Host "`n== Cambiar el tipo antes de emitir ==" -ForegroundColor Cyan
EsperarError 'pasar a Credito Fiscal una venta de consumidor final' 400 { Llamar 'Post' "/facturacion/$($e3.id)/tipo" $admin @{ tipo = '31' } }
$e2 = EcfDe $v2 '31'
Llamar 'Post' "/facturacion/$($e2.id)/tipo" $admin @{ tipo = '32' } | Out-Null
Comparar 'la venta de la empresa ahora es Consumo' (EcfDe $v2 '32').estado 'por_emitir'

Write-Host "`n== Anular ventas ==" -ForegroundColor Cyan
$a2 = Llamar 'Post' "/ventas/$($v2.id)/anular" $admin @{ motivo = 'Venta de prueba'; cajaId = $caja.id }
Ok 'anular venta con e-CF sin emitir:' $a2.ecf
$a1 = Llamar 'Post' "/ventas/$($v1.id)/anular" $admin @{ motivo = 'Venta de prueba'; cajaId = $caja.id }
Ok 'anular venta con e-CF emitido:' $a1.ecf
$nota = EcfDe $v1 '34'
Comparar 'nota de credito por emitir que modifica' $nota.modifica_encf "E32$sec"
EsperarError 'nota de credito con e-NCF E32' 400 { Llamar 'Post' "/facturacion/$($nota.id)/emitir" $admin @{ encf = "E32$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'XY98zw' } }
Llamar 'Post' "/facturacion/$($nota.id)/emitir" $admin @{ encf = "E34$sec"; fechaEmision = $antes.hoy; codigoSeguridad = 'XY98zw' } | Out-Null
$d1 = Llamar 'Get' "/ventas/$($v1.id)" $admin
Ok 'la venta 1 muestra sus comprobantes:' ((@($d1.ecf) | ForEach-Object { "$($_.tipo) $($_.encf)" }) -join ' y ')
Llamar 'Post' "/ventas/$($v3.id)/anular" $admin @{ motivo = 'Venta de prueba'; cajaId = $caja.id } | Out-Null

Write-Host "`n== Permisos ==" -ForegroundColor Cyan
EsperarError 'sin iniciar sesion' 401 { Llamar 'Get' '/facturacion' $null }

} finally {
  Llamar 'Patch' '/facturacion/configuracion' $admin @{ inicio = $antes.inicio; umbral = $antes.umbral } | Out-Null
}

Write-Host "`n== Limpiar ==" -ForegroundColor Cyan
Comparar 'configuracion devuelta a como estaba (inicio)' "'$((Llamar 'Get' '/facturacion/preparar' $admin).inicio)'" "'$($antes.inicio)'"
$cierre = Llamar 'Post' "/caja/sesiones/$($sesion.id)/cerrar" $admin @{ conteo = @{} }
Comparar 'caja de prueba cerrada sin diferencia' $cierre.diferencia '0.00'
Llamar 'Patch' "/caja/cajas/$($caja.id)/estado" $admin @{ is_active = $false; motivo = 'Caja de prueba' } | Out-Null
Llamar 'Patch' "/clientes/$($empresa.id)/estado" $admin @{ is_active = $false; motivo = 'Cliente de prueba' } | Out-Null
Llamar 'Patch' "/productos/$($prod.id)/estado" $admin @{ is_active = $false; motivo = 'Producto de prueba' } | Out-Null
Llamar 'Patch' "/categorias/$catId/estado" $admin @{ is_active = $false; motivo = 'Categoria de prueba' } | Out-Null
Llamar 'Patch' "/unidades-negocio/$($unidad.id)/estado" $admin @{ is_active = $false; motivo = 'Unidad de prueba' } | Out-Null
Ok 'caja, cliente, producto, categoria y unidad de prueba desactivados' ''
Write-Host "`nListo. Todas las lineas deben decir OK en verde." -ForegroundColor Cyan
