import { createContext } from 'react'
import type { Ambito } from './api'

// Módulo de la pantalla de cuentas: Bancos o Billeteras (MonCash / NatCash).
// Lo leen los formularios para llamar a su ruta y revisar sus permisos.
export const AmbitoCtx = createContext<Ambito>('banco')

export const permisoDe = (ambito: Ambito, accion: string) =>
  `${ambito === 'billetera' ? 'billeteras' : 'bancos'}.${accion}`
