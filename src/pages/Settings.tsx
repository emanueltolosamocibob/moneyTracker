import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import type { Category, IncomeSource } from '../types/database'
import { IconPencil, IconPlus, IconTrash } from '../components/icons'
import Modal from '../components/Modal'
import { getCategoryIcon, ICON_OPTIONS } from '../lib/categoryIcons'

type PendingDelete = { kind: 'category' | 'income_source'; id: string; name: string }

export default function Settings() {
  const { user } = useAuth()
  const [categories, setCategories] = useState<Category[]>([])
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [categoryModal, setCategoryModal] = useState<Category | 'new' | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryIcon, setCategoryIcon] = useState(ICON_OPTIONS[0].key)
  const [categoryFormError, setCategoryFormError] = useState<string | null>(null)
  const [categorySaving, setCategorySaving] = useState(false)

  const [sourceModal, setSourceModal] = useState<IncomeSource | 'new' | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [sourceFormError, setSourceFormError] = useState<string | null>(null)
  const [sourceSaving, setSourceSaving] = useState(false)

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Vaciar transacciones: dos pantallas de confirmación antes de borrar todo
  // (ver openClearTransactions/confirmClearTransactions más abajo).
  const [clearStep, setClearStep] = useState<'confirm1' | 'confirm2' | null>(null)
  const [clearTransactionCount, setClearTransactionCount] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: cats, error: catError }, { data: sources, error: sourceError }] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('income_sources').select('*').order('name'),
    ])
    if (catError) setError(catError.message)
    else if (sourceError) setError(sourceError.message)
    setCategories(cats ?? [])
    setIncomeSources(sources ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openNewCategory() {
    setCategoryName('')
    setCategoryIcon(ICON_OPTIONS[0].key)
    setCategoryFormError(null)
    setCategoryModal('new')
  }

  function openEditCategory(c: Category) {
    setCategoryName(c.name)
    setCategoryIcon(c.icon && ICON_OPTIONS.some((o) => o.key === c.icon) ? c.icon : ICON_OPTIONS[0].key)
    setCategoryFormError(null)
    setCategoryModal(c)
  }

  async function handleCategorySubmit(e: FormEvent) {
    e.preventDefault()
    const name = categoryName.trim()
    if (!name) {
      setCategoryFormError('Rellená este campo.')
      return
    }
    if (!user) return
    setCategorySaving(true)
    const { error: saveError } =
      categoryModal === 'new'
        ? await supabase.from('categories').insert({ user_id: user.id, name, icon: categoryIcon, is_default: false })
        : await supabase.from('categories').update({ name, icon: categoryIcon }).eq('id', categoryModal!.id)
    setCategorySaving(false)
    if (saveError) {
      setCategoryFormError(saveError.message)
      return
    }
    setCategoryModal(null)
    load()
  }

  function openNewSource() {
    setSourceName('')
    setSourceFormError(null)
    setSourceModal('new')
  }

  function openEditSource(s: IncomeSource) {
    setSourceName(s.name)
    setSourceFormError(null)
    setSourceModal(s)
  }

  async function handleSourceSubmit(e: FormEvent) {
    e.preventDefault()
    const name = sourceName.trim()
    if (!name) {
      setSourceFormError('Rellená este campo.')
      return
    }
    if (!user) return
    setSourceSaving(true)
    const { error: saveError } =
      sourceModal === 'new'
        ? await supabase.from('income_sources').insert({ user_id: user.id, name })
        : await supabase.from('income_sources').update({ name }).eq('id', sourceModal!.id)
    setSourceSaving(false)
    if (saveError) {
      setSourceFormError(saveError.message)
      return
    }
    setSourceModal(null)
    load()
  }

  async function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    setDeleting(true)
    const table = target.kind === 'category' ? 'categories' : 'income_sources'
    const { error: deleteError } = await supabase.from(table).delete().eq('id', target.id)
    setDeleting(false)
    if (deleteError) {
      setError(deleteError.message)
      setPendingDelete(null)
      return
    }
    setPendingDelete(null)
    load()
  }

  async function openClearTransactions() {
    if (!user) return
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    setClearTransactionCount(count ?? 0)
    setClearStep('confirm1')
  }

  function closeClearTransactions() {
    setClearStep(null)
    setClearTransactionCount(null)
  }

  async function confirmClearTransactions() {
    if (!user) return
    setClearing(true)
    const { error: deleteError } = await supabase.from('transactions').delete().eq('user_id', user.id)
    setClearing(false)
    if (deleteError) {
      setError(deleteError.message)
      closeClearTransactions()
      return
    }
    closeClearTransactions()
  }

  return (
    <div>
      <h2>Configuración</h2>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : (
        <div className="settings-grid">
          <section className="settings-panel">
            <div className="settings-panel-header">
              <h3>Categorías</h3>
              <button type="button" className="gmail-scan-btn" onClick={openNewCategory}>
                <IconPlus size={14} /> Agregar
              </button>
            </div>
            {categories.length === 0 ? (
              <p className="empty-state">Todavía no tenés categorías.</p>
            ) : (
              <div className="tx-table-scroll">
                <table className="tx-table">
                  <thead>
                    <tr>
                      <th>Categoría</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr key={c.id}>
                        <td className="tx-category">
                          <span className="tx-category-inner">
                            {getCategoryIcon(c.name, c.icon)} {c.name}
                          </span>
                        </td>
                        <td className="tx-actions">
                          <button
                            type="button"
                            className="tx-edit-btn"
                            aria-label={`Editar ${c.name}`}
                            onClick={() => openEditCategory(c)}
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="tx-delete-btn"
                            aria-label={`Eliminar ${c.name}`}
                            onClick={() => setPendingDelete({ kind: 'category', id: c.id, name: c.name })}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="settings-panel">
            <div className="settings-panel-header">
              <h3>Fuentes de ingreso</h3>
              <button type="button" className="gmail-scan-btn" onClick={openNewSource}>
                <IconPlus size={14} /> Agregar
              </button>
            </div>
            {incomeSources.length === 0 ? (
              <p className="empty-state">Todavía no tenés fuentes de ingreso.</p>
            ) : (
              <div className="tx-table-scroll">
                <table className="tx-table">
                  <thead>
                    <tr>
                      <th>Fuente</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeSources.map((s) => (
                      <tr key={s.id}>
                        <td className="tx-merchant">{s.name}</td>
                        <td className="tx-actions">
                          <button
                            type="button"
                            className="tx-edit-btn"
                            aria-label={`Editar ${s.name}`}
                            onClick={() => openEditSource(s)}
                          >
                            <IconPencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="tx-delete-btn"
                            aria-label={`Eliminar ${s.name}`}
                            onClick={() => setPendingDelete({ kind: 'income_source', id: s.id, name: s.name })}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <section className="settings-panel settings-danger-zone">
        <div className="settings-panel-header">
          <h3>Transacciones</h3>
        </div>
        <p className="empty-state">
          Elimina todas tus transacciones (manuales y las traídas de Gmail) de forma permanente. Las de Gmail no
          vuelven a traerse solas en el próximo escaneo.
        </p>
        <button type="button" className="gmail-scan-btn danger" onClick={openClearTransactions}>
          <IconTrash size={14} /> Vaciar
        </button>
      </section>

      {categoryModal && (
        <Modal>
          <h3>{categoryModal === 'new' ? 'Nueva categoría' : 'Editar categoría'}</h3>
          <form className="tx-edit-form" onSubmit={handleCategorySubmit} noValidate>
            <div className="tx-field">
              <input
                type="text"
                placeholder="Nombre"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="icon-picker" role="group" aria-label="Ícono">
              {ICON_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`icon-picker-option${opt.key === categoryIcon ? ' active' : ''}`}
                  aria-label={opt.key}
                  aria-pressed={opt.key === categoryIcon}
                  onClick={() => setCategoryIcon(opt.key)}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
            {categoryFormError && <p className="error">{categoryFormError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setCategoryModal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={categorySaving}>
                {categorySaving ? 'Guardando...' : categoryModal === 'new' ? 'Crear categoría' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {sourceModal && (
        <Modal>
          <h3>{sourceModal === 'new' ? 'Nueva fuente de ingreso' : 'Editar fuente de ingreso'}</h3>
          <form className="tx-edit-form" onSubmit={handleSourceSubmit} noValidate>
            <div className="tx-field">
              <input
                type="text"
                placeholder="Nombre"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                autoFocus
              />
            </div>
            {sourceFormError && <p className="error">{sourceFormError}</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setSourceModal(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={sourceSaving}>
                {sourceSaving ? 'Guardando...' : sourceModal === 'new' ? 'Crear fuente' : 'Guardar cambios'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDelete && (
        <Modal>
          <h3>Eliminar {pendingDelete.kind === 'category' ? 'categoría' : 'fuente de ingreso'}</h3>
          <p>
            Se va a eliminar &quot;{pendingDelete.name}&quot;.{' '}
            {pendingDelete.kind === 'category'
              ? 'Las transacciones que la usan quedan sin categoría, y se borra cualquier tope de presupuesto definido para ella.'
              : 'Las transacciones que la usan quedan sin fuente de ingreso.'}{' '}
            Esta acción no se puede deshacer.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setPendingDelete(null)}>
              Cancelar
            </button>
            <button type="button" className="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </button>
          </div>
        </Modal>
      )}

      {clearStep === 'confirm1' && (
        <Modal>
          <h3>Vaciar transacciones</h3>
          <p>
            Se van a eliminar {clearTransactionCount ?? 0} transacciones (manuales y de Gmail) de forma permanente.
            Las de Gmail no vuelven a traerse solas en el próximo escaneo — el mail queda fuera de la ventana de
            sincronización para siempre.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={closeClearTransactions}>
              Cancelar
            </button>
            <button type="button" className="primary" onClick={() => setClearStep('confirm2')}>
              Continuar
            </button>
          </div>
        </Modal>
      )}

      {clearStep === 'confirm2' && (
        <Modal>
          <h3>¿Confirmás definitivamente?</h3>
          <p>
            Esta acción no se puede deshacer. Se van a eliminar las {clearTransactionCount ?? 0} transacciones de tu
            cuenta ahora mismo.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={closeClearTransactions}>
              Cancelar
            </button>
            <button type="button" className="danger" onClick={confirmClearTransactions} disabled={clearing}>
              <IconTrash size={14} /> {clearing ? 'Vaciando...' : 'Vaciar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
