import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useAuth } from '@/lib/auth/AuthContext'
import { api } from '@/lib/api/client'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Sparkles, Pencil, Trash2 } from 'lucide-react'
import { getInitials } from '@/lib/getInitials'
import type { SkyRecord, MemberRole } from '@/domain/contracts'
import { SKY_TITLE_MAX_LENGTH } from '@/domain/policies'

type SkyEntry = { skyId: string; sky: SkyRecord; role: MemberRole }
type SkiesResponse = { skies: SkyEntry[] }

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño',
  editor: 'Editor',
  viewer: 'Lector',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function SkiesPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  const [skies, setSkies] = useState<SkyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit state
  const [editEntry, setEditEntry] = useState<SkyEntry | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete state
  const [deleteEntry, setDeleteEntry] = useState<SkyEntry | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false

    api<SkiesResponse>('/api/skies')
      .then((res) => {
        if (!cancelled) setSkies(res.skies)
      })
      .catch(() => {
        if (!cancelled) toast.error('Error al cargar tus cielos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [user])

  if (authLoading || !user) return <LoadingScreen />

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return

    setCreating(true)
    try {
      const res = await api<{ skyId: string }>('/api/skies', {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      setSheetOpen(false)
      setNewTitle('')
      navigate(`/sky/${res.skyId}`)
    } catch {
      toast.error('Error al crear el cielo')
    } finally {
      setCreating(false)
    }
  }

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editEntry) return
    const title = editTitle.trim()
    if (!title) return

    setSaving(true)
    try {
      await api(`/api/skies/${editEntry.skyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      setSkies(prev => prev.map(s =>
        s.skyId === editEntry.skyId
          ? { ...s, sky: { ...s.sky, title } }
          : s
      ))
      toast.success('Nombre actualizado')
      setEditEntry(null)
    } catch {
      toast.error('Error al actualizar el nombre')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteEntry) return

    setDeleting(true)
    try {
      await api(`/api/skies/${deleteEntry.skyId}`, { method: 'DELETE' })
      setSkies(prev => prev.filter(s => s.skyId !== deleteEntry.skyId))
      toast.success('Cielo eliminado')
      setDeleteEntry(null)
      setDeleteConfirmText('')
    } catch {
      toast.error('Error al eliminar el cielo')
    } finally {
      setDeleting(false)
    }
  }

  const openEdit = (entry: SkyEntry) => {
    setEditTitle(entry.sky.title)
    setEditEntry(entry)
  }

  const openDelete = (entry: SkyEntry) => {
    setDeleteConfirmText('')
    setDeleteEntry(entry)
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const displayName = user.displayName || user.email?.split('@')[0] || 'Explorador'

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SkyCanvas demo />

      <div className="relative z-10 flex h-full flex-col">
        {/* Header */}
        <header className="flex items-center justify-between px-5 pt-6 pb-2 sm:px-8 sm:pt-8">
          <BlurFade delay={0.15} duration={0.5}>
            <div>
              <p
                className="text-sm font-light tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Bienvenido de vuelta
              </p>
              <h1
                className="text-xl font-light tracking-[0.08em] sm:text-2xl"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                }}
              >
                {displayName}
              </h1>
            </div>
          </BlurFade>

          <BlurFade delay={0.25} duration={0.4}>
            <button
              onClick={() => navigate('/profile')}
              className="rounded-full transition-opacity hover:opacity-80"
            >
              <Avatar size="default">
                {user.photoURL ? (
                  <AvatarImage src={user.photoURL} alt={displayName} />
                ) : null}
                <AvatarFallback>{getInitials(user.displayName, user.email)}</AvatarFallback>
              </Avatar>
            </button>
          </BlurFade>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-5 pt-4 pb-28 sm:px-8">
          {loading ? (
            <div className="flex items-center justify-center pt-24">
              <div
                className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--accent-color)', borderTopColor: 'transparent' }}
              />
            </div>
          ) : skies.length === 0 ? (
            /* Empty state */
            <BlurFade delay={0.3} duration={0.6}>
              <div className="flex flex-col items-center justify-center pt-20 text-center">
                <div
                  className="mb-6 flex h-20 w-20 items-center justify-center rounded-full"
                  style={{
                    background: 'rgba(140, 180, 255, 0.08)',
                    border: '1px solid rgba(140, 180, 255, 0.12)',
                  }}
                >
                  <Sparkles
                    className="h-8 w-8"
                    style={{ color: 'var(--accent-color)' }}
                  />
                </div>
                <h2
                  className="mb-2 text-lg font-light tracking-wide"
                  style={{
                    color: 'var(--text-primary)',
                    fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                  }}
                >
                  Tu primer cielo te espera
                </h2>
                <p
                  className="mb-8 max-w-[260px] text-sm font-light leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Crea un cielo para guardar tus estrellas y compartirlas con quienes más quieres.
                </p>
                <Button
                  size="lg"
                  className="gap-2 tracking-wide"
                  onClick={() => setSheetOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Crear mi primer cielo
                </Button>
              </div>
            </BlurFade>
          ) : (
            /* Sky grid */
            <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
              {skies.map((entry, i) => (
                <BlurFade key={entry.skyId} delay={0.2 + i * 0.08} duration={0.4}>
                  <button
                    onClick={() => navigate(`/sky/${entry.skyId}`)}
                    className="group w-full text-left transition-all duration-200"
                    style={{
                      background: 'var(--glass-bg)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 'var(--radius-card)',
                      backdropFilter: 'blur(var(--glass-blur))',
                      WebkitBackdropFilter: 'blur(var(--glass-blur))',
                      boxShadow: 'var(--shadow-elevated)',
                    }}
                  >
                    <div className="p-5">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <h3
                          className="text-base font-light tracking-wide transition-colors duration-200 group-hover:text-[var(--accent-color)]"
                          style={{
                            color: 'var(--text-primary)',
                            fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                          }}
                        >
                          {entry.sky.title}
                        </h3>
                        <Badge variant="outline" className="shrink-0 text-[10px] tracking-wider uppercase">
                          {ROLE_LABELS[entry.role]}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <p
                          className="text-xs font-light tracking-wide"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {formatDate(entry.sky.createdAt)}
                        </p>
                        {entry.role === 'owner' && (
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); openEdit(entry) }}
                              className="rounded-md p-1.5 transition-colors hover:bg-white/[0.08]"
                              aria-label="Editar nombre"
                            >
                              <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openDelete(entry) }}
                              className="rounded-md p-1.5 transition-colors hover:bg-red-400/10"
                              aria-label="Eliminar cielo"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400/70" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </BlurFade>
              ))}
            </div>
          )}
        </main>

        {/* Floating action button */}
        {skies.length > 0 && (
          <BlurFade delay={0.5} duration={0.4}>
            <button
              onClick={() => setSheetOpen(true)}
              className="fixed right-6 bottom-6 z-20 flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-200 hover:scale-105 active:scale-95"
              style={{
                background: 'var(--accent-color)',
                boxShadow: '0 4px 24px rgba(140, 180, 255, 0.3), 0 0 48px rgba(140, 180, 255, 0.1)',
              }}
              aria-label="Crear nuevo cielo"
            >
              <Plus className="h-6 w-6" style={{ color: 'var(--bg-void)' }} />
            </button>
          </BlurFade>
        )}
      </div>

      {/* Create sky bottom sheet */}
      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Nuevo cielo"
      >
        <form onSubmit={handleCreate} className="space-y-5 px-1 pt-2 pb-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="sky-title"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Nombre del cielo
            </Label>
            <Input
              id="sky-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Mi cielo estrellado"
              maxLength={SKY_TITLE_MAX_LENGTH}
              required
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
            <p
              className="text-right text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {newTitle.length}/{SKY_TITLE_MAX_LENGTH}
            </p>
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full tracking-wide"
            disabled={!newTitle.trim() || creating}
          >
            {creating ? 'Creando...' : 'Crear cielo'}
          </Button>
        </form>
      </BottomSheet>

      {/* Edit sky name bottom sheet */}
      <BottomSheet
        open={editEntry !== null}
        onOpenChange={(open) => { if (!open) setEditEntry(null) }}
        title="Editar cielo"
      >
        <form onSubmit={handleEdit} className="space-y-5 px-1 pt-2 pb-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="edit-sky-title"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Nombre del cielo
            </Label>
            <Input
              id="edit-sky-title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Mi cielo estrellado"
              maxLength={SKY_TITLE_MAX_LENGTH}
              required
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
            <p
              className="text-right text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {editTitle.length}/{SKY_TITLE_MAX_LENGTH}
            </p>
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full tracking-wide"
            disabled={!editTitle.trim() || saving}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </BottomSheet>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteEntry !== null} onOpenChange={(open) => { if (!open) { setDeleteEntry(null); setDeleteConfirmText('') } }}>
        <DialogContent
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--glass-blur))',
            WebkitBackdropFilter: 'blur(var(--glass-blur))',
            border: '1px solid var(--glass-border)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>
              Eliminar {deleteEntry?.sky.title}
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Se eliminarán todas las estrellas, miembros e invitaciones. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label
              htmlFor="delete-confirm"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Escribe <span className="font-medium text-[var(--text-primary)]">{deleteEntry?.sky.title}</span> para confirmar
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteEntry?.sky.title}
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDeleteEntry(null); setDeleteConfirmText('') }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText !== deleteEntry?.sky.title}
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
