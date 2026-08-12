import { generateObject, generateText, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
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

// Gemini free tier ("generate_content_free_tier_requests") es cuota por
// proyecto, no un saldo en dólares — límites de RPM (requests/minuto), TPM
// (tokens/minuto) y RPD (requests/día), visibles en aistudio.google.com.
// gemini-3.6-flash daba apenas 5 RPM / 20 RPD (confirmado por el error real
// de Google la primera vez que esto se probó con un catch-up grande). Se
// cambió a gemini-3.5-flash-lite: 15 RPM / 500 RPD con el mismo TPM
// (250K) — el RPD es lo que más importa acá, un scan de backlog puede
// necesitar bastantes más de 20 llamadas en total (1 a 3 por mail). Sin
// espaciar las llamadas, un scan de más de un puñado de mails agota la
// cuota igual y el SDK tira AI_APICallError tras sus 3 reintentos internos,
// abortando el resto del loop en scanGmailForUser.ts. Estado a nivel de
// módulo a propósito: en Fluid Compute la misma instancia puede atender
// múltiples invocaciones, así que esto también frena llamadas de corridas
// concurrentes, no solo dentro de un mismo scan.
const MIN_GEMINI_CALL_INTERVAL_MS = 4_500
let lastGeminiCallAt = 0

// Exportada porque la cuota de Gemini es por proyecto, no por ruta: cualquier
// otra función que llame al mismo modelo (hoy api/vehicles/info.ts) tiene que
// compartir este contador o se pisan entre sí.
export async function throttleGeminiCall() {
  const wait = lastGeminiCallAt + MIN_GEMINI_CALL_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastGeminiCallAt = Date.now()
}

const LOW_CONFIDENCE_THRESHOLD = 0.6

// Umbral más exigente que el de revisión manual: crear una categoría nueva
// es una acción "destructiva" en el sentido de que ensucia la lista del
// usuario si el LLM se equivoca, así que pedimos bastante más confianza que
// para simplemente asignar una ya existente.
export const NEW_CATEGORY_CONFIDENCE_THRESHOLD = 0.85

async function runExtraction(emailText: string, categoryNames: string[], merchantResearch?: string) {
  await throttleGeminiCall()
  const { object } = await generateObject({
    // Provider directo de Google (no pasa por Vercel AI Gateway): la cuenta
    // de AI Gateway está en el plan free, que además de bloquear modelos de
    // Anthropic ("Free tier users do not have access to this model") tiene
    // un rate limit de requests/minuto muy bajo que un escaneo con varios
    // mails supera fácil. Gemini vía API key propia de Google AI Studio
    // (GOOGLE_GENERATIVE_AI_API_KEY) tiene un free tier real, sin tarjeta —
    // ver el comentario sobre MIN_GEMINI_CALL_INTERVAL_MS más arriba para
    // los límites reales y por qué se eligió este modelo puntual.
    model: google('gemini-3.5-flash-lite'),
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
    await throttleGeminiCall()
    const { text } = await generateText({
      model: google('gemini-3.5-flash-lite'),
      tools: {
        web_search: google.tools.googleSearch({}),
      },
      // Cada "step" de este loop es una llamada a Gemini aparte, disparada
      // por el SDK sin pasar por throttleGeminiCall (que solo frena el
      // punto de entrada de generateText/generateObject) — con
      // stepCountIs(4) un solo mail ambiguo podía ráfagar hasta 4 requests
      // casi simultáneas y comerse la cuota de un saque. 2 alcanza para
      // "buscar + responder" sin ese riesgo de ráfaga.
      stopWhen: stepCountIs(2),
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
