export type TransactionSource = 'gmail' | 'manual'
export type TransactionType = 'expense' | 'income'

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
  is_default: boolean
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  category_id: string | null
  amount: number
  currency: string
  merchant: string | null
  description: string | null
  occurred_at: string
  type: TransactionType
  source: TransactionSource
  source_email_id: string | null
  category_confidence: number | null
  needs_review: boolean
  created_at: string
}

export interface Budget {
  id: string
  user_id: string
  category_id: string | null
  month: string // 'YYYY-MM-01'
  amount: number
  created_at: string
}

export interface Investment {
  id: string
  user_id: string
  name: string
  kind: string
  quantity: number
  unit_cost: number
  currency: string
  created_at: string
}

export interface GmailConnection {
  user_id: string
  email: string
  connected_at: string
  last_scanned_at: string | null
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
      budgets: {
        Row: Budget
        Insert: Partial<Budget>
        Update: Partial<Budget>
        Relationships: []
      }
      investments: {
        Row: Investment
        Insert: Partial<Investment>
        Update: Partial<Investment>
        Relationships: []
      }
      gmail_connections: {
        Row: GmailConnection
        Insert: Partial<GmailConnection>
        Update: Partial<GmailConnection>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
