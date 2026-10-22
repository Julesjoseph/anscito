import { useEffect, useState } from 'react'
import {
  BookOpen,
  Calculator,
  CreditCard,
  Briefcase,
  Building2,
  ClipboardList,
  FileCheck2,
  FileText,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PackagePlus,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Sun,
  Smartphone,
  Tags,
  Truck,
  UserRound,
  Users,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AvisoGastoFijo, Marca, Perfil } from './api'
import Empresa from './Empresa'
import Envios from './Envios'
import Facturacion from './Facturacion'
import Fiscal from './Fiscal'
import Panel from './Panel'
import Reportes from './Reportes'
import { LogoMarca } from './marca'
import { aplicarTema, leerTema } from './tema'
import { useIdioma } from './idioma'
import type { ClaveTexto } from './idioma'
import type { Tema } from './tema'
import Bancos from './Bancos'
import Caja from './Caja'
import Calculadora from './Calculadora'
import Categorias from './Categorias'
import Compras from './Compras'
import CuentasCobrar from './CuentasCobrar'
import CuentasPagar from './CuentasPagar'
import Contabilidad from './Contabilidad'
import Inventario from './Inventario'
import Nomina from './Nomina'
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
    id: 'envios',
    nombre: 'SCITO TRANSFER',
    Icono: Smartphone,
    listo: true,
    permiso: 'remesas.ver',
  },
  {
    id: 'servicios',
    nombre: 'SCITO SERVICE',
    Icono: ClipboardList,
    listo: true,
    permiso: 'servicios.ver',
  },
  {
    id: 'ventas',
    nombre: 'Facturación',
    Icono: ShoppingCart,
    listo: true,
    permiso: 'ventas.ver',
  },
  {
    id: 'cxc',
    nombre: 'Cuentas por cobrar',
    Icono: CreditCard,
    listo: true,
    permiso: 'cxc.ver',
  },
  {
    id: 'cxp',
    nombre: 'Cuentas por pagar',
    Icono: Receipt,
    listo: true,
    permiso: 'cxp.ver',
  },
  {
    id: 'sanes',
    nombre: 'SOL CASH',
    Icono: HandCoins,
    listo: true,
    permiso: 'sanes.ver',
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
    id: 'compras',
    nombre: 'Reg. Facturas de Compras y Gastos',
    Icono: PackagePlus,
    listo: true,
    permiso: 'compras.ver',
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
    id: 'billeteras',
    nombre: 'Billeteras',
    Icono: WalletCards,
    listo: true,
    permiso: 'billeteras.ver',
  },
  {
    id: 'contabilidad',
    nombre: 'Contabilidad',
    Icono: BookOpen,
    listo: true,
    permiso: 'contabilidad.ver',
  },
  {
    id: 'facturacion',
    nombre: 'Facturación electrónica',
    Icono: FileCheck2,
    listo: true,
    permiso: 'facturacion.ver',
  },
  {
    id: 'fiscal',
    nombre: 'Formatos DGII (606/607)',
    Icono: FileSpreadsheet,
    listo: true,
    permiso: 'fiscal.ver',
  },
  {
    id: 'nomina',
    nombre: 'Nómina',
    Icono: Briefcase,
    listo: true,
    permiso: 'nomina.ver',
  },
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
      'reportes.clientes',
      'cxc.ver',
      'cxp.ver',
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
  const [tema, setTema] = useState<Tema>(leerTema)
  const { t } = useIdioma()
  // En el celular (menos de 768 px) el menú es un cajón que se abre con ☰.
  const [menuAbierto, setMenuAbierto] = useState(false)
  useEffect(() => {
    if (!menuAbierto) return
    const cerrar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuAbierto(false)
    }
    window.addEventListener('keydown', cerrar)
    return () => window.removeEventListener('keydown', cerrar)
  }, [menuAbierto])
  function ir(id: string) {
    setPagina(id)
    setMenuAbierto(false)
    window.scrollTo(0, 0)
  }
  function cambiarTema() {
    const nuevo = tema === 'noche' ? 'dia' : 'noche'
    aplicarTema(nuevo)
    setTema(nuevo)
  }
  // Gasto fijo que se va a registrar en "Reg. Facturas de Compras y Gastos".
  const [gastoFijo, setGastoFijo] = useState<AvisoGastoFijo | null>(null)

  const visibles = MODULOS.filter(
    (m) =>
      !m.permiso ||
      [m.permiso].flat().some((p) => perfil.permisos.includes(p)),
  )

  return (
    <div className="min-h-screen bg-gray-100 md:flex">
      {/* Celular: barra de arriba con el botón del menú y la pantalla actual. */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-3 md:hidden">
        <button
          type="button"
          onClick={() => setMenuAbierto(true)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
          aria-label={t('menu.abrir')}
          aria-expanded={menuAbierto}
        >
          <Menu size={22} />
        </button>
        <LogoMarca marca={marca} tamano="chico" />
        <div className="min-w-0 truncate text-sm font-medium">
          {(() => {
            const m = visibles.find((x) => x.id === pagina)
            return m ? t(`menu.${m.id}` as ClaveTexto) || m.nombre : marca.nombre_comercial
          })()}
        </div>
      </header>
      {menuAbierto && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuAbierto(false)} aria-hidden="true" />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white transition-transform duration-200 md:static md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:overflow-visible md:transition-none ${
          menuAbierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <LogoMarca marca={marca} tamano="chico" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-sm font-medium">{marca.nombre_comercial}</div>
            <div className="text-xs text-gray-500">{t('menu.administracion')}</div>
          </div>
          <button
            type="button"
            onClick={() => setMenuAbierto(false)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 md:hidden"
            aria-label={t('menu.cerrar')}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-2 py-2 flex flex-col gap-1">
          <button
            type="button"
            onClick={cambiarTema}
            title={t('menu.se_recuerda')}
            className="flex min-h-10 items-center gap-3 px-3 py-2 rounded-lg text-sm text-left border-l-4 border-transparent text-gray-600 hover:bg-gray-50"
          >
            {tema === 'noche' ? <Sun size={18} /> : <Moon size={18} />}
            {tema === 'noche' ? t('menu.modo_dia') : t('menu.modo_noche')}
          </button>
          {visibles.map(({ id, nombre, Icono, listo }) => {
            const activo = pagina === id
            return (
              <button
                key={id}
                type="button"
                disabled={!listo}
                onClick={() => ir(id)}
                title={listo ? undefined : t('menu.proximamente')}
                className={`flex min-h-10 items-center gap-3 px-3 py-2 rounded-lg text-sm text-left border-l-4 ${
                  activo
                    ? 'border-[#C8102E] bg-gray-100 font-medium text-gray-900'
                    : listo
                      ? 'border-transparent text-gray-600 hover:bg-gray-50'
                      : 'border-transparent text-gray-300 cursor-not-allowed'
                }`}
              >
                <Icono size={18} />
                {t(`menu.${id}` as ClaveTexto) || nombre}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-gray-200 p-4">
          <div className="text-sm font-medium">
            {perfil.nombre} {perfil.apellido}
          </div>
          <div className="text-xs text-gray-500 mb-3">
            {perfil.roles.join(', ') || t('menu.sin_rol')}
          </div>
          <button
            type="button"
            onClick={onSalir}
            className="flex min-h-10 items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <LogOut size={16} />
            {t('menu.salir')}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">
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
        ) : pagina === 'billeteras' ? (
          <Bancos
            key="billeteras"
            ambito="billetera"
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'fiscal' ? (
          <Fiscal token={token} onSesionVencida={onSalir} />
        ) : pagina === 'facturacion' ? (
          <Facturacion
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
        ) : pagina === 'cxc' ? (
          <CuentasCobrar
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'cxp' ? (
          <CuentasPagar
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
            onRegistrarGasto={(aviso) => {
              setGastoFijo(aviso)
              setPagina('compras')
            }}
          />
        ) : pagina === 'contabilidad' ? (
          <Contabilidad
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
          />
        ) : pagina === 'compras' ? (
          <Compras
            token={token}
            permisos={perfil.permisos}
            onSesionVencida={onSalir}
            gastoFijo={gastoFijo}
            onGastoFijoUsado={() => setGastoFijo(null)}
          />
        ) : pagina === 'nomina' ? (
          <Nomina
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