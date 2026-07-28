import { generateObject } from 'ai'
import { z } from 'zod'

const extractionSchema = z.object({
  is_payment_confirmation: z
    .boolean()
    .describe('false si el mail no es una confirmación de pago/transferencia real'),
  amount: z.number().nullable(),
  currency: z.string().nullable().describe('ISO 4217, ej ARS, USD'),
  merchant: z.string().nullable().describe('Comercio o destinatario del pago'),
  occurred_at: z.string().nullable().describe('Fecha/hora ISO 8601 si figura en el mail'),
  type: z.enum(['expense', 'income']).nullable(),
  category: z.enum([
    'Supermercado',
    'Restaurantes',
    'Transporte',
    'Servicios',
    'Salud',
    'Entretenimiento',
    'Compras',
    'Otros',
  ]),
  confidence: z.number().min(0).max(1),
})

export type ExtractedTransaction = z.infer<typeof extractionSchema>

export async function extractAndCategorize(emailText: string): Promise<ExtractedTransaction> {
  const { object } = await generateObject({
    // String plano: resuelto vía Vercel AI Gateway (no requiere SDK del
    // provider ni key propia en despliegues de Vercel).
    model: 'anthropic/claude-haiku-4-5',
    schema: extractionSchema,
    prompt: `Analizá este email de banco/billetera y extraé los datos del pago o transferencia.
Si el mail no confirma un pago real (ej. es publicidad, resumen mensual, o aviso genérico), marcá is_payment_confirmation en false.
Elegí la categoría que mejor describa el gasto según el comercio/destinatario.

---
${emailText.slice(0, 6000)}
---`,
  })

  return object
}
