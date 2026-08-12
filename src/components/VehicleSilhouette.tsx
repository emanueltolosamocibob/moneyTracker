import type { VehicleType } from '../types/database'

// Silueta de perfil por tipo de vehículo, teñida con el color cargado.
//
// Reemplaza a la idea original de bajar un modelo 3D del vehículo: no existe
// ninguna API gratuita que devuelva un GLB por marca/modelo/año (Sketchfab
// requiere OAuth por modelo y la mayoría no son descargables; el resto son
// marketplaces pagos), y aun con una, three.js + un GLB de varios MB por
// tarjeta es mucho peso para algo decorativo. Esto es SVG inline: cero red,
// cero dependencias, y el mismo lenguaje de line-art que icons.tsx.
interface Shape {
  /** Carrocería — se rellena con el color del vehículo. */
  body: string
  /** Vidrios/detalle, dibujado encima en blanco translúcido. */
  glass?: string
  /**
   * Trazos sin relleno, en el color del vehículo. Los usa solo la moto: su
   * horquilla, manubrio y basculante son barras finas, no superficie — con
   * un único path relleno queda un borrón entre las dos ruedas en vez de
   * algo que se lea como una moto.
   */
  strokes?: string[]
  /** [cx, cy, r] de cada rueda. */
  wheels: [number, number, number][]
}

const SHAPES: Record<VehicleType, Shape> = {
  car: {
    body: 'M4 42 L8 31 Q9 28 14 28 L38 28 L50 16 Q52 14 56 14 L78 14 Q82 14 85 17 L96 28 L112 31 Q117 32 117 36 L117 42 Z',
    glass: 'M42 27 L53 18 Q54 17 57 17 L66 17 L66 27 Z M70 17 L77 17 Q80 17 82 19 L89 27 L70 27 Z',
    wheels: [
      [32, 42, 8],
      [90, 42, 8],
    ],
  },
  suv: {
    body: 'M4 42 L4 27 Q4 23 9 23 L28 23 L38 8 Q40 6 44 6 L102 6 Q107 6 109 9 L115 24 Q118 27 118 32 L118 42 Z',
    glass: 'M33 22 L42 9 L60 9 L60 22 Z M64 9 L100 9 Q103 9 105 11 L112 22 L64 22 Z',
    wheels: [
      [30, 42, 9],
      [92, 42, 9],
    ],
  },
  pickup: {
    body: 'M4 42 L4 27 Q4 24 9 24 L30 24 L40 9 Q42 7 46 7 L68 7 Q72 7 74 10 L80 24 L80 27 L112 27 Q117 27 117 31 L117 42 Z',
    glass: 'M35 23 L43 10 L56 10 L56 23 Z M60 10 L67 10 Q70 10 71 12 L76 23 L60 23 Z',
    wheels: [
      [28, 42, 9],
      [96, 42, 9],
    ],
  },
  van: {
    body: 'M4 42 L4 16 Q4 12 9 12 L84 12 Q88 12 91 15 L110 29 L116 31 Q118 32 118 35 L118 42 Z',
    glass: 'M10 18 L40 18 L40 28 L10 28 Z M46 18 L82 18 Q85 18 87 20 L94 28 L46 28 Z',
    wheels: [
      [28, 42, 9],
      [96, 42, 9],
    ],
  },
  moto: {
    // Dos subpaths: tanque + asiento arriba, bloque del motor abajo.
    body: 'M40 28 Q44 20 56 19 L70 18 Q82 17 90 21 L96 26 L86 26 L74 23 L58 25 Z M52 26 L70 25 L72 34 L56 35 Z',
    strokes: ['M27 36 L37 13', 'M30 12 L46 10', 'M96 36 L74 30', 'M40 28 L58 25'],
    wheels: [
      [26, 36, 13],
      [96, 36, 13],
    ],
  },
}

export default function VehicleSilhouette({
  type,
  color,
  size = 120,
}: {
  type: VehicleType
  color: string
  size?: number
}) {
  const shape = SHAPES[type] ?? SHAPES.car

  return (
    <svg className="vehicle-silhouette" viewBox="0 0 122 54" width={size} height={size * (54 / 122)} aria-hidden="true">
      <path d={shape.body} fill={color} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinejoin="round" />
      {shape.glass && <path d={shape.glass} fill="rgba(255,255,255,0.28)" />}
      {shape.strokes?.map((d) => (
        <path key={d} d={d} fill="none" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
      ))}
      {shape.wheels.map(([cx, cy, r]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={r} fill="#15161c" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
          <circle cx={cx} cy={cy} r={r / 2.6} fill="rgba(255,255,255,0.35)" />
        </g>
      ))}
    </svg>
  )
}
