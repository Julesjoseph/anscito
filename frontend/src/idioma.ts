import { useSyncExternalStore } from 'react'

// Idioma de las pantallas: español, inglés, francés o kreyòl. Lo elige cada
// usuario y se recuerda en este equipo (localStorage), igual que el modo
// noche. Primera etapa (decisión del dueño): el menú, la entrada y los
// botones comunes; después, pantalla por pantalla. Lo que todavía no está
// traducido, y los mensajes del servidor y los PDF, siguen en español.
// Las traducciones al francés y al kreyòl las debe revisar el dueño.

export type Idioma = 'es' | 'en' | 'fr' | 'ht'

export const IDIOMAS: [Idioma, string][] = [
  ['es', 'Español'],
  ['en', 'English'],
  ['fr', 'Français'],
  ['ht', 'Kreyòl'],
]

const CLAVE = 'anscito.idioma'

type Textos = Record<Idioma, string>

const TEXTOS = {
  // ---------- Menú ----------
  'menu.panel': { es: 'Panel', en: 'Dashboard', fr: 'Tableau de bord', ht: 'Tablo de bò' },
  'menu.calculadora': { es: 'Calculadora', en: 'Calculator', fr: 'Calculatrice', ht: 'Kalkilatris' },
  'menu.envios': { es: 'SCITO TRANSFER', en: 'SCITO TRANSFER', fr: 'SCITO TRANSFER', ht: 'SCITO TRANSFER' },
  'menu.servicios': { es: 'SCITO SERVICE', en: 'SCITO SERVICE', fr: 'SCITO SERVICE', ht: 'SCITO SERVICE' },
  'menu.ventas': { es: 'Facturación', en: 'Billing', fr: 'Facturation', ht: 'Faktirasyon' },
  'menu.cxc': { es: 'Cuentas por cobrar', en: 'Accounts receivable', fr: 'Comptes clients', ht: 'Kont pou resevwa' },
  'menu.cxp': { es: 'Cuentas por pagar', en: 'Accounts payable', fr: 'Comptes fournisseurs', ht: 'Kont pou peye' },
  'menu.sanes': { es: 'SOL CASH', en: 'SOL CASH', fr: 'SOL CASH', ht: 'SOL CASH' },
  'menu.categorias': { es: 'Categorías', en: 'Categories', fr: 'Catégories', ht: 'Kategori' },
  'menu.inventario': { es: 'Inventario', en: 'Inventory', fr: 'Inventaire', ht: 'Envantè' },
  'menu.compras': {
    es: 'Reg. Facturas de Compras y Gastos',
    en: 'Purchase and expense invoices',
    fr: "Factures d'achats et de dépenses",
    ht: 'Fakti acha ak depans',
  },
  'menu.caja': { es: 'Caja', en: 'Cash register', fr: 'Caisse', ht: 'Kès' },
  'menu.bancos': { es: 'Bancos', en: 'Banks', fr: 'Banques', ht: 'Bank' },
  'menu.billeteras': { es: 'Billeteras', en: 'Wallets', fr: 'Portefeuilles', ht: 'Bous' },
  'menu.contabilidad': { es: 'Contabilidad', en: 'Accounting', fr: 'Comptabilité', ht: 'Kontablite' },
  'menu.facturacion': {
    es: 'Facturación electrónica',
    en: 'E-invoicing',
    fr: 'Facturation électronique',
    ht: 'Faktirasyon elektwonik',
  },
  'menu.fiscal': {
    es: 'Formatos DGII (606/607)',
    en: 'DGII forms (606/607)',
    fr: 'Formulaires DGII (606/607)',
    ht: 'Fòm DGII (606/607)',
  },
  'menu.nomina': { es: 'Nómina', en: 'Payroll', fr: 'Paie', ht: 'Pewòl' },
  'menu.reportes': { es: 'Reportes', en: 'Reports', fr: 'Rapports', ht: 'Rapò' },
  'menu.clientes': { es: 'Clientes', en: 'Customers', fr: 'Clients', ht: 'Kliyan' },
  'menu.proveedores': { es: 'Proveedores', en: 'Suppliers', fr: 'Fournisseurs', ht: 'Founisè' },
  'menu.empresa': { es: 'Empresa', en: 'Company', fr: 'Entreprise', ht: 'Antrepriz' },
  'menu.usuarios': { es: 'Usuarios', en: 'Users', fr: 'Utilisateurs', ht: 'Itilizatè' },
  'menu.roles': { es: 'Roles y permisos', en: 'Roles and permissions', fr: 'Rôles et autorisations', ht: 'Wòl ak pèmisyon' },
  'menu.administracion': { es: 'Administración', en: 'Administration', fr: 'Administration', ht: 'Administrasyon' },
  'menu.modo_noche': { es: 'Modo noche', en: 'Night mode', fr: 'Mode nuit', ht: 'Mòd lannwit' },
  'menu.modo_dia': { es: 'Modo día', en: 'Day mode', fr: 'Mode jour', ht: 'Mòd lajounen' },
  'menu.se_recuerda': {
    es: 'Se recuerda en este equipo',
    en: 'Remembered on this device',
    fr: 'Mémorisé sur cet appareil',
    ht: 'Aparèy sa a ap sonje li',
  },
  'menu.idioma': { es: 'Idioma', en: 'Language', fr: 'Langue', ht: 'Lang' },
  'menu.sin_rol': { es: 'Sin rol', en: 'No role', fr: 'Aucun rôle', ht: 'Pa gen wòl' },
  'menu.salir': { es: 'Salir', en: 'Sign out', fr: 'Déconnexion', ht: 'Soti' },
  'menu.abrir': { es: 'Abrir el menú', en: 'Open the menu', fr: 'Ouvrir le menu', ht: 'Louvri meni an' },
  'menu.cerrar': { es: 'Cerrar el menú', en: 'Close the menu', fr: 'Fermer le menu', ht: 'Fèmen meni an' },
  'menu.proximamente': {
    es: 'Disponible próximamente',
    en: 'Coming soon',
    fr: 'Bientôt disponible',
    ht: 'Ap vini byento',
  },

  // ---------- Entrada ----------
  'login.area': {
    es: 'Área de administración',
    en: 'Administration area',
    fr: "Espace d'administration",
    ht: 'Espas administrasyon',
  },
  'login.usuario': { es: 'Usuario', en: 'Username', fr: "Nom d'utilisateur", ht: 'Non itilizatè' },
  'login.contrasena': { es: 'Contraseña', en: 'Password', fr: 'Mot de passe', ht: 'Modpas' },
  'login.entrar': { es: 'Entrar', en: 'Sign in', fr: 'Se connecter', ht: 'Antre' },
  'login.entrando': { es: 'Entrando…', en: 'Signing in…', fr: 'Connexion…', ht: 'N ap antre…' },
  'login.faltan_datos': {
    es: 'Escriba su usuario y contraseña',
    en: 'Enter your username and password',
    fr: "Saisissez votre nom d'utilisateur et votre mot de passe",
    ht: 'Ekri non itilizatè ak modpas ou',
  },
  'login.ayuda': {
    es: '¿Problemas para entrar? Consulte al administrador.',
    en: 'Trouble signing in? Contact the administrator.',
    fr: "Un problème de connexion ? Contactez l'administrateur.",
    ht: 'Ou gen pwoblèm pou antre? Pale ak administratè a.',
  },

  // ---------- Comunes ----------
  'comun.sin_conexion': {
    es: 'No se pudo conectar con el servidor',
    en: 'Could not connect to the server',
    fr: 'Impossible de se connecter au serveur',
    ht: 'Pa t ka konekte ak sèvè a',
  },
  'comun.cerrar': { es: 'Cerrar', en: 'Close', fr: 'Fermer', ht: 'Fèmen' },
  'comun.preparando': { es: 'Preparando…', en: 'Preparing…', fr: 'Préparation…', ht: 'N ap prepare…' },
  'comun.excel_titulo': {
    es: 'Descargar la lista en Excel',
    en: 'Download the list in Excel',
    fr: 'Télécharger la liste en Excel',
    ht: 'Telechaje lis la an Excel',
  },
  'comun.pdf_titulo': {
    es: 'Descargar la lista en PDF',
    en: 'Download the list in PDF',
    fr: 'Télécharger la liste en PDF',
    ht: 'Telechaje lis la an PDF',
  },
  'comun.cargando': { es: 'Cargando…', en: 'Loading…', fr: 'Chargement…', ht: 'N ap chaje…' },
} satisfies Record<string, Textos>

export type ClaveTexto = keyof typeof TEXTOS

// ---------- El idioma elegido ----------

function guardado(): Idioma {
  try {
    const v = localStorage.getItem(CLAVE)
    return IDIOMAS.some(([id]) => id === v) ? (v as Idioma) : 'es'
  } catch {
    return 'es'
  }
}

let actual: Idioma = guardado()
const avisar = new Set<() => void>()

export function leerIdioma(): Idioma {
  return actual
}

export function cambiarIdioma(idioma: Idioma) {
  actual = idioma
  document.documentElement.lang = idioma
  try {
    localStorage.setItem(CLAVE, idioma)
  } catch {
    // Sin almacenamiento (ventana privada): dura hasta cerrar.
  }
  avisar.forEach((f) => f())
}

// Avisa cuando cambia el idioma (lo usa el traductor de pantalla).
export function escucharIdioma(f: () => void) {
  avisar.add(f)
}

// Texto en el idioma elegido (si falta, en español).
export function tr(clave: ClaveTexto, idioma: Idioma = actual): string {
  const t = (TEXTOS as Record<string, Textos | undefined>)[clave]
  return t ? t[idioma] || t.es : ''
}

// Para las pantallas: se vuelven a dibujar al cambiar el idioma.
export function useIdioma() {
  const idioma = useSyncExternalStore(
    (f) => {
      avisar.add(f)
      return () => avisar.delete(f)
    },
    () => actual,
  )
  return { idioma, t: (clave: ClaveTexto) => tr(clave, idioma) }
}

// Formato de fechas de cada idioma (Intl no trae kreyòl: se usa el de Haití en francés).
export function localeDe(idioma: Idioma): string {
  return { es: 'es-DO', en: 'en-US', fr: 'fr-FR', ht: 'fr-HT' }[idioma]
}

// Lista para elegir el idioma (en el menú y en la entrada).
export function nombreIdioma(id: Idioma): string {
  return IDIOMAS.find(([x]) => x === id)?.[1] ?? id
}
