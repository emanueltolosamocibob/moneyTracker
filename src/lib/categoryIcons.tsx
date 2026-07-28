import type { ReactNode } from 'react'
import {
  IconCar,
  IconFilm,
  IconHeartPulse,
  IconHelpCircle,
  IconHome,
  IconShoppingBag,
  IconShoppingCart,
  IconUtensils,
  IconZap,
} from '../components/icons'

const CATEGORY_ICONS: Record<string, ReactNode> = {
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

export function getCategoryIcon(name: string | undefined): ReactNode {
  if (!name) return null
  return CATEGORY_ICONS[name] ?? <IconHelpCircle />
}
