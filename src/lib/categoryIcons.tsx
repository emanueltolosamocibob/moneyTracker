import type { ReactNode } from 'react'
import {
  IconCar,
  IconFilm,
  IconHeartPulse,
  IconHelpCircle,
  IconHome,
  IconReceipt,
  IconShoppingBag,
  IconShoppingCart,
  IconTrendingUp,
  IconUtensils,
  IconWallet,
  IconZap,
} from '../components/icons'

// Set fijo de íconos elegibles desde el picker de Configuración. La `key` es
// lo que se guarda en categories.icon — nunca el nombre de la categoría, así
// que renombrar una categoría no le hace perder el ícono elegido.
export const ICON_OPTIONS: { key: string; icon: ReactNode }[] = [
  { key: 'shopping-cart', icon: <IconShoppingCart /> },
  { key: 'utensils', icon: <IconUtensils /> },
  { key: 'car', icon: <IconCar /> },
  { key: 'zap', icon: <IconZap /> },
  { key: 'heart-pulse', icon: <IconHeartPulse /> },
  { key: 'film', icon: <IconFilm /> },
  { key: 'shopping-bag', icon: <IconShoppingBag /> },
  { key: 'home', icon: <IconHome /> },
  { key: 'wallet', icon: <IconWallet /> },
  { key: 'receipt', icon: <IconReceipt /> },
  { key: 'trending-up', icon: <IconTrendingUp /> },
  { key: 'help-circle', icon: <IconHelpCircle /> },
]

const ICON_BY_KEY: Record<string, ReactNode> = Object.fromEntries(ICON_OPTIONS.map((o) => [o.key, o.icon]))

// Categorías creadas antes de que existiera el picker (o las seed por
// defecto, ver 0001_init.sql) no tienen un `icon` con una de las keys de
// arriba — las por defecto ni siquiera tienen texto plano ahí, tienen un
// emoji que esta UI de íconos de línea nunca llegó a usar. Para esas,
// mantenemos el mapeo histórico por nombre en vez de mostrar un ícono vacío.
const ICON_BY_NAME: Record<string, ReactNode> = {
  Supermercado: <IconShoppingCart />,
  Restaurantes: <IconUtensils />,
  Transporte: <IconCar />,
  Servicios: <IconZap />,
  Salud: <IconHeartPulse />,
  Entretenimiento: <IconFilm />,
  Compras: <IconShoppingBag />,
  Alquiler: <IconHome />,
  Otros: <IconHelpCircle />,
}

export function getCategoryIcon(name: string | undefined, icon?: string | null): ReactNode {
  if (icon && ICON_BY_KEY[icon]) return ICON_BY_KEY[icon]
  if (name && ICON_BY_NAME[name]) return ICON_BY_NAME[name]
  return <IconHelpCircle />
}
