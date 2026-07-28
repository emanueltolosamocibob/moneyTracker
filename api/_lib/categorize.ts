import { generateObject, generateText, stepCountIs } from 'ai'
import { openai } from '@ai-sdk/openai'
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
  category: z
    .string()
    .describe('Una de las categorías existentes del usuario, o un nombre nuevo corto si ninguna encaja'),
  is_new_category: z.boolean().describe('true si "category" no es una de las existentes que se le pasaron'),
  confidence: z.number().min(0).max(1),
  payment_method: z
    .enum(['credit_card', 'debit_card', 'transfer', 'cash', 'other'])
    .nullable()
    .describe(
      'credit_card = tarjeta de crédito, debit_card = tarjeta de débito, transfer = transferencia/pago con CVU-CBU o QR, cash = efectivo, other = no se puede determinar',
    ),
  card_last4: z
    .string()
    .nullable()
    .describe('Últimos 4 dígitos de la tarjeta si el mail los menciona (ej. "terminada en 0268"), si no null'),
})

export type ExtractedTransaction = z.infer<typeof extractionSchema>

const LOW_CONFIDENCE_THRESHOLD = 0.6

// Umbral más exigente que el de revisión manual: crear una categoría nueva
// es una acción "destructiva" en el sentido de que ensucia la lista del
// usuario si el LLM se equivoca, así que pedimos bastante más confianza que
// para simplemente asignar una ya existente.
export const NEW_CATEGORY_CONFIDENCE_THRESHOLD = 0.85

async function runExtraction(emailText: string, categoryNames: string[], merchantResearch?: string) {
  const { object } = await generateObject({
    // String plano: resuelto vía Vercel AI Gateway (no requiere SDK del
    // provider ni key propia en despliegues de Vercel).
    model: 'anthropic/claude-haiku-4.5',
    schema: extractionSchema,
    prompt: `Analizá este email de banco/billetera y extraé los datos del pago o transferencia.
Si el mail no confirma un pago real (ej. es publicidad, resumen mensual, o aviso genérico), marcá is_payment_confirmation en false.

Las categorías que ya tiene este usuario son: ${categoryNames.join(', ')}.
Elegí la que mejor describa el gasto. Si ninguna encaja razonablemente, proponé un nombre de categoría nuevo — corto, específico y reutilizable (ej. "Mascotas", "Educación"), nunca un cajón de sastre genérico — y marcá is_new_category en true. Usá "Otros" solo cuando de verdad no se pueda determinar el rubro.

Identificá también el medio de pago (tarjeta de crédito, débito, transferencia o efectivo) y, si el mail menciona una tarjeta terminada en algún número, extraé esos 4 dígitos en card_last4.

---
${emailText.slice(0, 6000)}
---
${merchantResearch ? `\nInformación adicional sobre el comercio (de una búsqueda web):\n${merchantResearch}\n` : ''}`,
  })

  return object
}

// Los nombres de comercio que llegan en estos mails suelen venir truncados o
// con el prefijo del procesador de pago (ej. "MERPAGO*MASTROSMINIMA"), así
// que un solo LLM call no siempre tiene con qué categorizar bien. Cuando la
// primera pasada queda en 'Otros' o con confianza baja, buscamos el nombre
// en la web para intentar identificar el rubro real antes de categorizar.
async function researchMerchant(merchant: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model: 'openai/gpt-5.4-mini',
      tools: {
        web_search: openai.tools.webSearch({}),
      },
      stopWhen: stepCountIs(4),
      prompt: `El texto "${merchant}" es el nombre de un comercio tal como aparece en un resumen de tarjeta o billetera argentina (puede venir truncado, o con el prefijo de un procesador de pagos como MERPAGO/MP). Buscá en internet a qué comercio corresponde y a qué rubro pertenece (ej: supermercado, restaurante, farmacia, transporte, streaming, etc). Respondé en 2-3 líneas, en español, con el nombre real del comercio si lo identificás y su rubro. Si no encontrás nada confiable, decilo explícitamente.`,
    })
    return text
  } catch (err) {
    // La búsqueda web es un best-effort: si falla (rate limit, no habilitada
    // en la cuenta, etc.) seguimos con la categorización original.
    console.error('researchMerchant falló', err)
    return null
  }
}

export async function extractAndCategorize(
  emailText: string,
  categoryNames: string[],
): Promise<ExtractedTransaction> {
  const initial = await runExtraction(emailText, categoryNames)

  const isAmbiguous = initial.category === 'Otros' || initial.confidence < LOW_CONFIDENCE_THRESHOLD
  if (!isAmbiguous || !initial.merchant) {
    return initial
  }

  const research = await researchMerchant(initial.merchant)
  if (!research) {
    return initial
  }

  const refined = await runExtraction(emailText, categoryNames, research)
  // Si la segunda pasada no mejoró nada, nos quedamos con la primera.
  return refined.confidence >= initial.confidence ? refined : initial
}
