import { API_URL } from './api'
import type { Marca } from './api'

// Logo de la empresa, o un cuadro rojo con la inicial si no hay logo.
export function LogoMarca({ marca, tamano }: { marca: Marca; tamano: 'chico' | 'grande' }) {
  const caja = tamano === 'grande' ? 'h-12 w-12 text-2xl rounded-xl' : 'h-9 w-9 rounded-lg'
  if (marca.tiene_logo) {
    return (
      <img
        src={`${API_URL}/marca/logo?v=${marca.version}`}
        alt={`Logo de ${marca.nombre_comercial}`}
        className={`${caja} object-contain`}
      />
    )
  }
  return (
    <div
      className={`${caja} flex items-center justify-center bg-[#C8102E] font-medium text-white`}
    >
      {marca.nombre_comercial.trim().charAt(0).toUpperCase() || 'S'}
    </div>
  )
}
