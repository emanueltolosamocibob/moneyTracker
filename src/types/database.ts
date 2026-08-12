export type TransactionSource = 'gmail' | 'manual'
export type TransactionType = 'expense' | 'income'
export type PaymentMethod = 'credit_card' | 'debit_card' | 'transfer' | 'cash' | 'other'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  created_at: string
}

export interface Category {
  id: string
  user_id: string
  name: string
  icon: string | null
  color: string
  is_default: boolean
  created_at: string
}

export interface IncomeSource {
  id: string
  user_id: string
  name: string
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  category_id: string | null
  income_source_id: string | null
  amount: number
  currency: string
  merchant: string | null
  description: string | null
  occurred_at: string
  type: TransactionType
  source: TransactionSource
  source_email_id: string | null
  payment_method: PaymentMethod | null
  card_last4: string | null
  category_confidence: number | null
  needs_review: boolean
  seen: boolean
  // Cuota de préstamo que generó esta transacción (ver Loans.tsx), null para
  // cualquier otra transacción. on delete cascade en la FK: borrar el
  // loan_payment (o el préstamo entero) borra también esta fila.
  loan_payment_id: string | null
  // Igual que loan_payment_id pero para un service o visita al mecánico
  // (ver Vehicles.tsx) — mismo cascade, misma exclusividad de hecho: una
  // transacción nunca tiene los dos.
  vehicle_expense_id: string | null
  created_at: string
}

export type BudgetPeriodType = 'monthly' | 'custom'

export interface BudgetPeriod {
  id: string
  user_id: string
  period_type: BudgetPeriodType
  period_start: string // 'YYYY-MM-DD'
  period_end: string // 'YYYY-MM-DD'
  auto_renew: boolean
  created_at: string
}

export interface BudgetItem {
  id: string
  budget_period_id: string
  user_id: string
  category_id: string
  amount: number
  created_at: string
}

export type InvestmentMarket = 'ar' | 'world'

export interface InvestmentLot {
  id: string
  user_id: string
  symbol: string
  // Nombre de la compañía capturado al elegir el símbolo en el buscador —
  // null cuando vino de ByMA/data912 (no lo trae) o para lotes cargados
  // antes de que existiera este campo.
  name: string | null
  market: InvestmentMarket
  buy_date: string // 'YYYY-MM-DD'
  buy_quantity: number
  buy_price: number
  remaining_quantity: number
  created_at: string
}

export interface InvestmentSale {
  id: string
  user_id: string
  lot_id: string
  sell_date: string // 'YYYY-MM-DD'
  sell_quantity: number
  sell_price: number
  created_at: string
}

export interface Bank {
  id: string
  user_id: string
  name: string
  created_at: string
}

export type LoanCurrency = 'ARS' | 'UVA'

export interface Loan {
  id: string
  user_id: string
  bank_id: string | null
  // Cantidad de pesos si currency='ARS', cantidad de UVAs si currency='UVA'
  // — la conversión a pesos de un préstamo en UVA se hace pago a pago (ver
  // LoanPayment.uva_value), no acá.
  amount_requested: number
  amount_to_repay: number
  installments_count: number
  currency: LoanCurrency
  created_at: string
}

export interface LoanPayment {
  id: string
  user_id: string
  loan_id: string
  payment_date: string // 'YYYY-MM-DD'
  // Mismo criterio que Loan.amount_*: pesos o UVAs según la moneda del
  // préstamo dueño de este pago.
  amount: number
  // Valor de la UVA en pesos el día de este pago (null para préstamos en
  // ARS, o para pagos UVA cargados antes de que existiera esta columna).
  uva_value: number | null
  created_at: string
}

export type VehicleType = 'car' | 'suv' | 'pickup' | 'van' | 'moto'

export interface Vehicle {
  id: string
  user_id: string
  type: VehicleType
  brand: string
  model: string
  year: number
  /** Hex '#rrggbb' — con esto se tiñe la silueta de la tarjeta. */
  color: string
  license_plate: string | null
  current_km: number | null
  // Los tres de abajo los completa /api/vehicles/info (estimados por LLM) y
  // se pueden corregir a mano. null = todavía no se consultó.
  consumption_l100km: number | null
  service_interval_km: number | null
  fuel_type: string | null
  insurance_company: string | null
  /** Path dentro del bucket privado 'vehicle-docs', no una URL. */
  insurance_pdf_path: string | null
  insurance_expires_on: string | null // 'YYYY-MM-DD'
  vtv_expires_on: string | null // 'YYYY-MM-DD'
  created_at: string
}

export type VehicleExpenseKind = 'service' | 'mechanic'

/** Un service o una visita al mecánico — misma tabla, ver migración 0022. */
export interface VehicleExpense {
  id: string
  user_id: string
  vehicle_id: string
  kind: VehicleExpenseKind
  occurred_on: string // 'YYYY-MM-DD'
  title: string
  description: string | null
  odometer_km: number | null
  cost: number
  place: string | null
  created_at: string
}

export interface Goal {
  id: string
  user_id: string
  title: string
  target_amount: number
  target_date: string // 'YYYY-MM-DD'
  // Solo un objetivo por usuario puede tener is_active=true (índice único
  // parcial en la migración 0021) — decide el orden de las tarjetas, no
  // habilita/bloquea nada funcional.
  is_active: boolean
  created_at: string
}

export interface GoalContribution {
  id: string
  user_id: string
  goal_id: string
  contribution_date: string // 'YYYY-MM-DD'
  amount: number
  created_at: string
}

export interface GmailConnection {
  user_id: string
  email: string
  connected_at: string
  last_scanned_at: string | null
}

// Estado de sincronización del grupo de alertas de Telegram. Los mensajes en
// sí (telegram_messages) no tienen interfaz acá a propósito: el frontend nunca
// los lee, solo el análisis derivado — ver api/_lib/telegramSync.ts.
export interface TelegramSyncState {
  user_id: string
  chat_id: string
  chat_title: string | null
  last_message_id: number | null
  backfill_cursor: number | null
  backfill_done: boolean
  last_synced_at: string | null
  created_at: string
}

export interface TelegramSignalOutcome {
  entryDate: string
  entryPrice: number
  lastDate: string
  lastPrice: number
  changePct: number
  worked: boolean
}

export interface TelegramSignal {
  symbol: string
  action: 'buy' | 'sell' | 'hold'
  date: string
  target_price: number | null
  stop_loss: number | null
  rationale: string
  confidence: number
  in_portfolio: boolean
  // null cuando no se consiguió serie de precios para el símbolo, o cuando la
  // señal es 'hold' (no hay entrada que evaluar) — ver api/_lib/priceHistory.ts.
  outcome: TelegramSignalOutcome | null
}

export interface TelegramAnalysis {
  id: string
  user_id: string
  chat_id: string
  from_date: string
  to_date: string
  message_count: number
  summary: string
  signals: TelegramSignal[]
  created_at: string
}

// Alertas de compra/venta del canal de Telegram, parseadas por regex al
// sincronizar (ver api/_lib/signalIngest.ts, api/_lib/parseSignal.ts).
// Originalmente pensada también para alimentar un portfolio simulado
// (paper trading, 0016_paper_trading.sql) que se eliminó por decisión de
// producto (0020_drop_paper_trading.sql) — esta tabla sigue siendo la
// fuente de la tabla "Alertas de Telegram" en Inversiones.

export type TradeSignalKind = 'buy' | 'sell'

export interface TradeSignal {
  id: string
  user_id: string
  chat_id: string
  message_id: number
  posted_at: string
  kind: TradeSignalKind
  ticker: string | null
  take_profit: number | null
  stop_loss: number | null
  possible_gain_pct: number | null
  possible_loss_pct: number | null
  risk_benefit: number | null
  reported_result_pct: number | null
  raw_text: string
  // Cierre manual desde el modal de edición de "Alertas de Telegram" (ver
  // api/telegram/buy-alerts.ts), solo relevante en kind='buy' — una alerta
  // de venta real del canal para el mismo símbolo tiene prioridad sobre esto
  // al mostrar "Fecha de venta".
  manual_sell_date: string | null // 'YYYY-MM-DD'
  // true para una alerta de compra cargada a mano desde la tabla de
  // "Alertas de Telegram" (ver api/telegram/buy-alerts.ts POST), sin
  // mensaje real de Telegram detrás.
  is_manual: boolean
  created_at: string
}

// "Foto" de lo gastado por categoría en un mes — ver la migración
// 0008_category_spend_tracking.sql para por qué category_name/category_color
// se graban como texto plano en vez de resolverse siempre desde `categories`.
export interface CategoryMonthSpend {
  id: string
  user_id: string
  month_start: string // 'YYYY-MM-DD', siempre el día 1 del mes
  category_id: string | null
  category_name: string
  category_color: string
  amount: number
  created_at: string
}

// Tipado mínimo estilo "Database" de supabase-js. Se puede regenerar con
// `supabase gen types typescript` una vez creado el proyecto real.
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Partial<Profile>
        Update: Partial<Profile>
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: Partial<Category>
        Update: Partial<Category>
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: Partial<Transaction>
        Update: Partial<Transaction>
        Relationships: []
      }
      budget_periods: {
        Row: BudgetPeriod
        Insert: Partial<BudgetPeriod>
        Update: Partial<BudgetPeriod>
        Relationships: []
      }
      budget_items: {
        Row: BudgetItem
        Insert: Partial<BudgetItem>
        Update: Partial<BudgetItem>
        Relationships: []
      }
      investment_lots: {
        Row: InvestmentLot
        Insert: Partial<InvestmentLot>
        Update: Partial<InvestmentLot>
        Relationships: []
      }
      investment_sales: {
        Row: InvestmentSale
        Insert: Partial<InvestmentSale>
        Update: Partial<InvestmentSale>
        Relationships: []
      }
      banks: {
        Row: Bank
        Insert: Partial<Bank>
        Update: Partial<Bank>
        Relationships: []
      }
      loans: {
        Row: Loan
        Insert: Partial<Loan>
        Update: Partial<Loan>
        Relationships: []
      }
      loan_payments: {
        Row: LoanPayment
        Insert: Partial<LoanPayment>
        Update: Partial<LoanPayment>
        Relationships: []
      }
      gmail_connections: {
        Row: GmailConnection
        Insert: Partial<GmailConnection>
        Update: Partial<GmailConnection>
        Relationships: []
      }
      category_month_spend: {
        Row: CategoryMonthSpend
        Insert: Partial<CategoryMonthSpend>
        Update: Partial<CategoryMonthSpend>
        Relationships: []
      }
      telegram_sync_state: {
        Row: TelegramSyncState
        Insert: Partial<TelegramSyncState>
        Update: Partial<TelegramSyncState>
        Relationships: []
      }
      telegram_analyses: {
        Row: TelegramAnalysis
        Insert: Partial<TelegramAnalysis>
        Update: Partial<TelegramAnalysis>
        Relationships: []
      }
      trade_signals: {
        Row: TradeSignal
        Insert: Partial<TradeSignal>
        Update: Partial<TradeSignal>
        Relationships: []
      }
      vehicles: {
        Row: Vehicle
        Insert: Partial<Vehicle>
        Update: Partial<Vehicle>
        Relationships: []
      }
      vehicle_expenses: {
        Row: VehicleExpense
        Insert: Partial<VehicleExpense>
        Update: Partial<VehicleExpense>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
