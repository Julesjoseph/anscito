import { useState } from 'react'
import {
  BookOpen,
  Calculator,
  Briefcase,
  Building2,
  ClipboardList,
  FileText,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Tags,
  Truck,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Marca, Perfil } from './api'
import Empresa from './Empresa'
import Envios from './Envios'
import Panel from './Panel'
import Reportes from './Reportes'
import { LogoMarca } from './marca'
import Bancos from './Bancos'
import Caja from './Caja'
import Calculadora from './Calculadora'
import Categorias from './Categorias'
import Inventario from './Inventario'
import Roles from './Roles'
import Sanes from './Sanes'
import Servicios from './Servicios'
import Terceros from './Terceros'
import Usuarios from './Usuarios'
import Ventas from './Ventas'

type Modulo = {
  id: string
  nombre: string
  Icono: LucideIcon
  listo: boolean
  // Se muestra si el usuario tiene alguno de estos permisos.
  permiso?: string | string[]
}

const MODULOS: Modulo[] = [
  { id: 'panel', nombre: 'Panel', Icono: LayoutDashboard, listo: true },
  {
    id: 'calculadora',
    nombre: 'Calculadora',
    Icono: Calculator,
    listo: true,
    permiso: 'remesas.ver',
  },
  {
    id: 'ventas',
    nombre: 'Ventas',
    Icono: ShoppingCart,
    listo: true,
    permiso: 'ventas.ver',
  },
  {
    id: 'servicios',
    nombre: 'SCITO SERVICE',
    Icono: ClipboardList,
    listo: true,
    permiso: 'servicios.ver',
  },
  {
    id: 'categorias',
    nombre: 'Categorías',
    Icono: Tags,
    listo: true,
    permiso: 'categorias.ver',
  },
  {
    id: 'inventario',
    nombre: 'Inventario',
    Icono: Package,
    listo: true,
    permiso: 'inventario.ver',
  },
  {
    id: 'caja',
    nombre: 'Caja',
    Icono: Wallet,
    listo: true,
    permiso: 'caja.ver',
  },
  {
    id: 'bancos',
    nombre: 'Bancos',
    Icono: Landmark,
    listo: true,
    permiso: 'bancos.ver',
  },
  {
    id: 'sanes',
    nombre: 'SAN',
    Icono: HandCoins,
    listo: true,
    permiso: 'sanes.ver',
  },
  { id: 'finanzas', nombre: 'Finanzas', Icono: Landmark, listo: false },
  {
    id: 'envios',
    nombre: 'SCITO TRANSFER',
    Icono: Smartphone,
    listo: true,
    permiso: 'remesas.ver',
  },
  { id: 'contabilidad', nombre: 'Contabilidad', Icono: BookOpen, listo: false },
  { id: 'nomina', nombre: 'Nómina', Icono: Briefcase, listo: false },
  {
    id: 'reportes',
    nombre: 'Reportes',
    Icono: FileText,
    listo: true,
    // Cada reporte revisa su permiso en el servidor.
    permiso: [
      'reportes.ventas',
      'reportes.envios',
      'reportes.caja_bancos',
      'reportes.inventario',
    ],
  },
  {
    id: 'clientes',
    nombre: 'Clientes',
    Icono: UserRound,
    listo: true,
    permiso: 'clientes.ver',
  },
  {
    id: 'proveedores',
    nombre: 'Proveedores',
    Icono: Truck,
    listo: true,
    permiso: 'proveedores.ver',
  },
  {
    id: 'empresa',
    nombre: 'Empresa',
    Icono: Building2,
    listo: true,
    permiso: 'empresa.ver',
  },
  {
    id: 'usuarios',
    nombre: 'Usuarios',
    Icono: Users,
    listo: true,
    permiso: 'usuarios.ver',
  },
  {
    id: 'roles',
    nombre: 'Roles y permisos',
    Icono: ShieldCheck,
    listo: true,
    permiso: 'roles.ver',
  },
]

type Props = {
  perfil: Perfil
  token: string
  marca: Marca
  onMarcaCambiada: () => void
  onSalir: () => void
}

export default function Layout({
  perfil,
  token,
  marca,
  onMarcaCambiada,
  onSalir,
}: Props) {
  const [pagina, setPagina] = useState('panel')

  const visibles = MODULOS.filter(
    (m) =>
      !m.permiso ||
      [m.permiso].flat().some((p) => perfil.permisos.includes(p)),
  )

  return (
    <div className="min-h-screen flex bg-gray-100">
      <aside className="w-60 shrink-0 bg-white border-r border-gray-200 flex flex-col">
        <div className="flex items-center gap-2 px-4 py-4">
          <LogoMarca marca={marca} tamano="chico" />
          <div className="leading-tight">
            <div className="text-sm font-medium">{marca.nombre_comercial}</div>
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
     <Usuarios
  token={token}
  permisos={perfil.permisos}
  usuarioId={perfil.id}
  onSesionVencida={onSalir}
/>
        ) : pagina === 'ventas' ? (
          <Ventas
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'empresa' ? (
          <Empresa
            token={token}
            permisos={perfil.permisos}
            marca={marca}
            onMarcaCambiada={onMarcaCambiada}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'clientes' || pagina === 'proveedores' ? (
          <Terceros
            key={pagina}
            rol={pagina}
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'inventario' ? (
          <Inventario
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'categorias' ? (
          <Categorias
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'roles' ? (
          <Roles
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'reportes' ? (
          <Reportes token={token} onSesionVencida={onSalir} />
        ) : pagina === 'calculadora' ? (
          <Calculadora token={token} onSesionVencida={onSalir} />
        ) : pagina === 'envios' ? (
          <Envios
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'bancos' ? (
          <Bancos
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'sanes' ? (
          <Sanes
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'caja' ? (
          <Caja
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'servicios' ? (
          <Servicios
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : (
          <Panel token={token} onIr={setPagina} onSesionVencida={onSalir} />
        )}
      </main>
    </div>
  )
}