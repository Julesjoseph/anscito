import { useState } from 'react'
import {
  BookOpen,
  Briefcase,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  ShoppingCart,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Perfil } from './api'
import Usuarios from './Usuarios'

type Modulo = {
  id: string
  nombre: string
  Icono: LucideIcon
  listo: boolean
  permiso?: string
}

const MODULOS: Modulo[] = [
  { id: 'panel', nombre: 'Panel', Icono: LayoutDashboard, listo: true },
  { id: 'ventas', nombre: 'Ventas', Icono: ShoppingCart, listo: false },
  { id: 'inventario', nombre: 'Inventario', Icono: Package, listo: false },
  { id: 'caja', nombre: 'Caja y bancos', Icono: Wallet, listo: false },
  { id: 'finanzas', nombre: 'Finanzas', Icono: Landmark, listo: false },
  { id: 'moncash', nombre: 'MonCash / NatCash', Icono: Smartphone, listo: false },
  { id: 'contabilidad', nombre: 'Contabilidad', Icono: BookOpen, listo: false },
  { id: 'nomina', nombre: 'Nómina', Icono: Briefcase, listo: false },
  { id: 'reportes', nombre: 'Reportes', Icono: FileText, listo: false },
  {
    id: 'usuarios',
    nombre: 'Usuarios',
    Icono: Users,
    listo: true,
    permiso: 'usuarios.ver',
  },
]

type Props = { perfil: Perfil; token: string; onSalir: () => void }

function Panel() {
  const tarjetas = [
    'Ventas del día',
    'Efectivo en caja',
    'Comisiones MonCash / NatCash',
    'Cuentas por cobrar',
  ]
  return (
    <div>
      <h1 className="text-xl font-medium mb-1">Resumen de hoy</h1>
      <p className="text-sm text-gray-500 mb-4">
        Los indicadores aparecerán cuando existan los módulos de ventas y caja.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        {tarjetas.map((t) => (
          <div key={t} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-sm text-gray-500">{t}</div>
            <div className="text-2xl font-medium text-gray-300">—</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Layout({ perfil, token, onSalir }: Props) {
  const [pagina, setPagina] = useState('panel')

  const visibles = MODULOS.filter(
    (m) => !m.permiso || perfil.permisos.includes(m.permiso),
  )

  return (
    <div className="min-h-screen flex bg-gray-100">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="w-9 h-9 rounded-lg bg-[#C8102E] text-white flex items-center justify-center font-medium">
            S
          </div>
          <div className="leading-tight">
            <div className="text-sm font-medium">SCITO ENTREPRISE</div>
            <div className="text-xs text-gray-500">Administración</div>
          </div>
        </div>

        <nav className="flex-1 px-2 py-2 flex flex-col gap-1">
          {visibles.map(({ id, nombre, Icono, listo }) => {
            const activo = pagina === id
            return (
              <button
                key={id}
                type="button"
                disabled={!listo}
                onClick={() => setPagina(id)}
                title={listo ? undefined : 'Disponible próximamente'}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left border-l-4 ${
                  activo
                    ? 'border-[#C8102E] bg-gray-100 font-medium text-gray-900'
                    : listo
                      ? 'border-transparent text-gray-600 hover:bg-gray-50'
                      : 'border-transparent text-gray-300 cursor-not-allowed'
                }`}
              >
                <Icono size={18} />
                {nombre}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="text-sm font-medium">
            {perfil.nombre} {perfil.apellido}
          </div>
          <div className="text-xs text-gray-500 mb-3">
            {perfil.roles.join(', ') || 'Sin rol'}
          </div>
          <button
            type="button"
            onClick={onSalir}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <LogOut size={16} />
            Salir
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-6">
        {pagina === 'usuarios' ? (
          <Usuarios token={token} onSesionVencida={onSalir} />
        ) : (
          <Panel />
        )}
      </main>
    </div>
  )
}