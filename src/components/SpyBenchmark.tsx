import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface Benchmark {
  changePct: number | null
  fromDate: string | null
  toDate: string | null
}

// Reemplaza al portfolio simulado (eliminado por decisión de producto): solo
// una referencia de mercado, cuánto lleva el SPY en el año, para comparar a
// ojo contra las alertas del canal sin mantener un motor de simulación.
export default function SpyBenchmark() {
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const { data } = await supabase.auth.getSession()
      try {
        const res = await fetch('/api/investments/spy-benchmark', {
          headers: { Authorization: `Bearer ${data.session?.access_token}` },
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'No se pudo obtener el benchmark de SPY.')
        if (!cancelled) setBenchmark(json)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="tg-section">
      <div className="tx-header">
        <h3>Benchmark</h3>
      </div>
      {loading ? (
        <p className="empty-state">Cargando...</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : benchmark?.changePct == null ? (
        <p className="empty-state">No se consiguió la cotización del SPY.</p>
      ) : (
        <p>
          SPY en {new Date().getFullYear()}:{' '}
          <span className={benchmark.changePct >= 0 ? 'tg-hit' : 'tg-miss'}>
            {benchmark.changePct > 0 ? '+' : ''}
            {benchmark.changePct.toFixed(1)}%
          </span>
        </p>
      )}
    </section>
  )
}
