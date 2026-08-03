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

export interface Loan {
  id: string
  user_id: string
  bank_id: string | null
  amount_requested: number
  amount_to_repay: number
  installments_count: number
  created_at: string
}

export interface LoanPayment {
  id: string
  user_id: string
  loan_id: string
  payment_date: string // 'YYYY-MM-DD'
  amount: number
  created_at: string
}

export interface GmailConnection {
  user_id: string
  email: string
  connected_at: string
  last_scanned_at: string | null
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
