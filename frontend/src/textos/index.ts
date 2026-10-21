import { FRASES_COMUNES, PATRONES_COMUNES } from './comun'
import { FRASES_ADMIN, PATRONES_ADMIN } from './admin'
import { FRASES_BANCOS, PATRONES_BANCOS } from './bancos'
import { FRASES_CAJA, PATRONES_CAJA } from './caja'
import { FRASES_CATALOGO, PATRONES_CATALOGO } from './catalogo'
import { FRASES_COMPRAS, PATRONES_COMPRAS } from './compras'
import { FRASES_CONTABILIDAD, PATRONES_CONTABILIDAD } from './contabilidad'
import { FRASES_CXC, PATRONES_CXC } from './cxc'
import { FRASES_ENVIOS, PATRONES_ENVIOS } from './envios'
import { FRASES_FISCAL, PATRONES_FISCAL } from './fiscal'
import { FRASES_INVENTARIO, PATRONES_INVENTARIO } from './inventario'
import { FRASES_NOMINA, PATRONES_NOMINA } from './nomina'
import { FRASES_REPORTES, PATRONES_REPORTES } from './reportes'
import { FRASES_SANES, PATRONES_SANES } from './sanes'
import { FRASES_SANFICHA, PATRONES_SANFICHA } from './sanficha'
import { FRASES_SERVICIOS, PATRONES_SERVICIOS } from './servicios'
import { FRASES_VENTAS, PATRONES_VENTAS } from './ventas'
import type { Frase, Patron } from './tipos'

// Diccionario del traductor de pantalla: un archivo por módulo (este índice
// se arma solo con todos). Si una frase está en dos módulos, gana la primera.
export const FRASES: Frase[] = [
  ...FRASES_COMUNES,
  ...FRASES_ADMIN,
  ...FRASES_BANCOS,
  ...FRASES_CAJA,
  ...FRASES_CATALOGO,
  ...FRASES_COMPRAS,
  ...FRASES_CONTABILIDAD,
  ...FRASES_CXC,
  ...FRASES_ENVIOS,
  ...FRASES_FISCAL,
  ...FRASES_INVENTARIO,
  ...FRASES_NOMINA,
  ...FRASES_REPORTES,
  ...FRASES_SANES,
  ...FRASES_SANFICHA,
  ...FRASES_SERVICIOS,
  ...FRASES_VENTAS,
]

export const PATRONES: Patron[] = [
  ...PATRONES_COMUNES,
  ...PATRONES_ADMIN,
  ...PATRONES_BANCOS,
  ...PATRONES_CAJA,
  ...PATRONES_CATALOGO,
  ...PATRONES_COMPRAS,
  ...PATRONES_CONTABILIDAD,
  ...PATRONES_CXC,
  ...PATRONES_ENVIOS,
  ...PATRONES_FISCAL,
  ...PATRONES_INVENTARIO,
  ...PATRONES_NOMINA,
  ...PATRONES_REPORTES,
  ...PATRONES_SANES,
  ...PATRONES_SANFICHA,
  ...PATRONES_SERVICIOS,
  ...PATRONES_VENTAS,
]
