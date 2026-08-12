import type { VercelRequest, VercelResponse } from '@vercel/node'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { z } from 'zod'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'
import { throttleGeminiCall } from '../_lib/categorize.js'

// Consumo promedio e intervalo de service de un modelo concreto. No existe
// una API gratis que devuelva esto por marca/modelo/año (las de specs de
// autos son todas pagas o de cobertura solo yanqui), así que se lo pedimos
// al mismo Gemini que ya usa la categorización de Gmail.
//
// El resultado se guarda en la fila del vehículo, no en una tabla de caché:
// se consulta una vez al crear el vehículo y queda editable a mano. Todo
// nullable a propósito — un modelo que no conoce el auto tiene que poder
// decir "no sé" en vez de inventar un número, y la UI muestra los datos
// marcados como estimados justamente porque puede equivocarse igual.
const specSchema = z.object({
  consumption_l100km: z
    .number()
    .nullable()
    .describe('Consumo mixto promedio en litros cada 100 km. null si no se conoce el modelo.'),
  service_interval_km: z
    .number()
    .int()
    .nullable()
    .describe('Cada cuántos kilómetros corresponde el service de mantenimiento. null si no se conoce.'),
  fuel_type: z
    .string()
    .nullable()
    .describe('Combustible: nafta, diésel, híbrido, eléctrico, GNC. null si no se conoce.'),
  notes: z.string().nullable().describe('Una línea con cualquier salvedad relevante del mantenimiento.'),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const brand = typeof req.query.brand === 'string' ? req.query.brand.trim() : ''
  const model = typeof req.query.model === 'string' ? req.query.model.trim() : ''
  const year = typeof req.query.year === 'string' ? req.query.year.trim() : ''

  if (!brand || !model) {
    res.status(400).json({ error: 'Faltan marca y modelo' })
    return
  }

  // Mismo criterio que priceHistory.ts y logo.ts: cualquier falla acá
  // devuelve campos en null en vez de un error, así el vehículo se crea
  // igual y el panel muestra "sin datos" en vez de romper la página.
  try {
    await throttleGeminiCall()
    const { object } = await generateObject({
      model: google('gemini-3.5-flash-lite'),
      schema: specSchema,
      prompt: `Datos de mantenimiento del vehículo ${brand} ${model}${year ? ` ${year}` : ''}, tal como se vende en Argentina.

Respondé el consumo mixto promedio real (litros cada 100 km) y cada cuántos kilómetros el fabricante recomienda el service.
Si no conocés este modelo con razonable certeza, devolvé null en los campos que no sepas — no estimes por analogía con otro auto.`,
    })
    res.status(200).json(object)
  } catch (err) {
    console.error('vehicles/info falló', err)
    res.status(200).json({ consumption_l100km: null, service_interval_km: null, fuel_type: null, notes: null })
  }
}
