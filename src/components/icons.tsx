// Íconos de línea, minimalistas, sin dependencias externas (evita sumar una
// librería de íconos completa para media docena de usos).
type IconProps = { size?: number }

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  // Un <svg> inline por defecto es display:inline, que le deja unos px de
  // hueco "fantasma" abajo (espacio para descendentes de texto). Con eso
  // mezclado en una tabla, las filas con ícono terminan un pelo más altas
  // que las que muestran "—", y la tabla se ve descolocada entre filas.
  display: 'block' as const,
}

export function IconReceipt({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  )
}

export function IconWallet({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3" />
      <path d="M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-4a2 2 0 0 1 0-4h4a1 1 0 0 0 1-1" />
      <circle cx="16" cy="13" r="0.6" fill="currentColor" />
    </svg>
  )
}

export function IconTrendingUp({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 6h6v6" />
    </svg>
  )
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconLogout({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

export function IconChevronDown({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconMenu({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  )
}

export function IconX({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function IconRefresh({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 4v5h-5" />
    </svg>
  )
}

export function IconShoppingCart({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="9" cy="21" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="21" r="1" fill="currentColor" stroke="none" />
      <path d="M2.5 3h2l2.6 12.6a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  )
}

export function IconUtensils({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 2v8a2 2 0 0 0 4 0V2M8 10v12" />
      <path d="M17 2c-1.5 2-1.5 6 0 8v12" />
    </svg>
  )
}

export function IconCar({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 13l1.6-5.2A2 2 0 0 1 6.5 6.5h11a2 2 0 0 1 1.9 1.3L21 13" />
      <path d="M3 13h18v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z" />
      <circle cx="7.5" cy="16.5" r="0.6" fill="currentColor" />
      <circle cx="16.5" cy="16.5" r="0.6" fill="currentColor" />
    </svg>
  )
}

export function IconZap({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </svg>
  )
}

export function IconHeartPulse({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20.5 8.5c0 4.5-8.5 10.5-8.5 10.5S3.5 13 3.5 8.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 9 2.8Z" />
      <path d="M6 10h2.5l1.5-3 2 6 1.5-3H16" />
    </svg>
  )
}

export function IconFilm({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" />
    </svg>
  )
}

export function IconShoppingBag({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 8h12l1 13H5L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  )
}

export function IconHome({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1v-9" />
    </svg>
  )
}

export function IconHelpCircle({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.5 2.5 0 1 1 3.5 2.3c-.9.5-1 1-1 1.8" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  )
}

export function IconPencil({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

export function IconHistory({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  )
}

export function IconSettings({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

export function IconTrash({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

export function IconPlane({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
    </svg>
  )
}

export function IconGift({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="4" y="8" width="16" height="12" rx="1" />
      <path d="M4 8h16M12 8v12" />
      <path d="M8 8a2.5 2.5 0 0 1 0-5c2 0 4 2 4 5M16 8a2.5 2.5 0 0 0 0-5c-2 0-4 2-4 5" />
    </svg>
  )
}

export function IconBook({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5Z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    </svg>
  )
}

export function IconPaw({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="16" r="4" />
      <circle cx="6" cy="9" r="2" fill="currentColor" stroke="none" />
      <circle cx="10" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="9" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconBaby({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="8" r="4" />
      <path d="M8 12c-2 1-3 3-3 5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2c0-2-1-4-3-5" />
      <path d="M9.5 8c.5.8 1.4 1.3 2.5 1.3s2-.5 2.5-1.3" />
    </svg>
  )
}

export function IconDumbbell({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6.5 7v10M17.5 7v10" />
      <rect x="3" y="9" width="3" height="6" rx="1" />
      <rect x="18" y="9" width="3" height="6" rx="1" />
      <path d="M6.5 12h11" />
    </svg>
  )
}

export function IconCoffee({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
      <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M7 4c0 1-1 1-1 2M11 4c0 1-1 1-1 2" />
    </svg>
  )
}

export function IconPhone({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 18h4" />
    </svg>
  )
}

export function IconWifi({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M2 9a16 16 0 0 1 20 0" />
      <path d="M5.5 13a11 11 0 0 1 13 0" />
      <path d="M9 17a6 6 0 0 1 6 0" />
      <circle cx="12" cy="20" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconShield({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5l-8-3Z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

export function IconBriefcase({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 12h18" />
    </svg>
  )
}

export function IconPiggyBank({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M5 12a6 6 0 0 1 6-5.5c2 0 3.6.8 4.7 2L18 8v4l-2 .5c-.3 1-1 2-2 2.6V17h-2v-1h-2v1H8v-2c-1.8-1-3-2.8-3-4Z" />
      <circle cx="14.5" cy="9.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M3 11h2" />
    </svg>
  )
}

export function IconFuel({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16" />
      <path d="M3 21h10" />
      <path d="M12 10h2.5l2.5 2.5V18a1.5 1.5 0 0 1-3 0v-1" />
      <path d="M4 13h8" />
    </svg>
  )
}

export function IconBed({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" />
      <path d="M3 18v2M21 18v2" />
      <path d="M3 12V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
      <path d="M11 10h6a2 2 0 0 1 2 2" />
    </svg>
  )
}

export function IconShirt({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M7 4 3 8l3 3 2-2v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9l2 2 3-3-4-4h-3a2 2 0 0 1-4 0H7Z" />
    </svg>
  )
}

export function IconScissors({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M20 4 8.5 12M8.5 12 20 20" />
    </svg>
  )
}

export function IconLaptop({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="4" y="4" width="16" height="10" rx="1" />
      <path d="M2 19h20l-2-3H4l-2 3Z" />
    </svg>
  )
}

export function IconMusic({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </svg>
  )
}

export function IconGamepad({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 9h12a4 4 0 0 1 4 4.5l-1 4a2 2 0 0 1-3.6.9L16 16H8l-1.4 2.4A2 2 0 0 1 3 17.5l-1-4A4 4 0 0 1 6 9Z" />
      <path d="M9 12v3M7.5 13.5h3" />
      <circle cx="16" cy="12.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="18" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconHeart({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20.5 7.5c0 4.5-8.5 10.5-8.5 10.5S3.5 12 3.5 7.5a4.5 4.5 0 0 1 8.5-2 4.5 4.5 0 0 1 8.5 2Z" />
    </svg>
  )
}

export function IconWrench({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2 2.8-2.8Z" />
    </svg>
  )
}

export function IconTruck({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="1" y="7" width="13" height="9" rx="1" />
      <path d="M14 10h4l3 3v3h-3" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </svg>
  )
}

export function IconParking({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
    </svg>
  )
}

export function IconBike({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="5.5" cy="17.5" r="3" />
      <circle cx="18.5" cy="17.5" r="3" />
      <path d="M5.5 17.5 10 8h3l3 5.5M10 8l3 5.5h5.5" />
    </svg>
  )
}

export function IconPill({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="2" y="9" width="20" height="6" rx="3" />
      <path d="M12 9v6" />
    </svg>
  )
}

export function IconBeer({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 9h9v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z" />
      <path d="M15 10h2a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
      <path d="M6 9c0-2 1-3 1-5M9 9c0-2 1-3 1-5" />
    </svg>
  )
}

export function IconTv({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="5" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </svg>
  )
}

export function IconBank({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v9M9 10v9M15 10v9M19 10v9" />
      <path d="M3 19h18" />
    </svg>
  )
}

export function IconDownload({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  )
}

export function IconGoogle({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47c-.28 1.5-1.13 2.78-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3.02c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.26a12 12 0 0 0 0 10.75l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.26 6.62l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}
