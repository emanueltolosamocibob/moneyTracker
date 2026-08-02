import type { ReactNode } from 'react'
import {
  IconBaby,
  IconBank,
  IconBed,
  IconBeer,
  IconBike,
  IconBook,
  IconBriefcase,
  IconCar,
  IconCoffee,
  IconDumbbell,
  IconFilm,
  IconFuel,
  IconGamepad,
  IconGift,
  IconHeart,
  IconHeartPulse,
  IconHelpCircle,
  IconHome,
  IconLaptop,
  IconMusic,
  IconParking,
  IconPaw,
  IconPhone,
  IconPiggyBank,
  IconPill,
  IconPlane,
  IconReceipt,
  IconScissors,
  IconShield,
  IconShirt,
  IconShoppingBag,
  IconShoppingCart,
  IconTrendingUp,
  IconTruck,
  IconTv,
  IconUtensils,
  IconWallet,
  IconWifi,
  IconWrench,
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
  { key: 'plane', icon: <IconPlane /> },
  { key: 'gift', icon: <IconGift /> },
  { key: 'book', icon: <IconBook /> },
  { key: 'paw', icon: <IconPaw /> },
  { key: 'baby', icon: <IconBaby /> },
  { key: 'dumbbell', icon: <IconDumbbell /> },
  { key: 'coffee', icon: <IconCoffee /> },
  { key: 'phone', icon: <IconPhone /> },
  { key: 'wifi', icon: <IconWifi /> },
  { key: 'shield', icon: <IconShield /> },
  { key: 'briefcase', icon: <IconBriefcase /> },
  { key: 'piggy-bank', icon: <IconPiggyBank /> },
  { key: 'fuel', icon: <IconFuel /> },
  { key: 'bed', icon: <IconBed /> },
  { key: 'shirt', icon: <IconShirt /> },
  { key: 'scissors', icon: <IconScissors /> },
  { key: 'laptop', icon: <IconLaptop /> },
  { key: 'music', icon: <IconMusic /> },
  { key: 'gamepad', icon: <IconGamepad /> },
  { key: 'heart', icon: <IconHeart /> },
  { key: 'wrench', icon: <IconWrench /> },
  { key: 'truck', icon: <IconTruck /> },
  { key: 'parking', icon: <IconParking /> },
  { key: 'bike', icon: <IconBike /> },
  { key: 'pill', icon: <IconPill /> },
  { key: 'beer', icon: <IconBeer /> },
  { key: 'tv', icon: <IconTv /> },
  { key: 'bank', icon: <IconBank /> },
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
