import { useEffect, useState, useRef, type FormEvent } from 'react'
import { motion } from 'motion/react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api/client'
import { showStardustToast } from '@/components/economy/StardustToast'
import { uploadStarImage } from '@/lib/firebase/storage'
import { STAR_TITLE_MAX_LENGTH, STAR_MESSAGE_MAX_LENGTH, STAR_IMAGE_MAX_SIZE_BYTES, STAR_IMAGE_ALLOWED_TYPES } from '@/domain/policies'
import { Trash2, ImagePlus } from 'lucide-react'
import type { StarRecord } from '@/domain/contracts'

interface StarFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skyId: string
  mode: 'create' | 'edit'
  star?: StarRecord & { starId: string }
  position?: { x: number; y: number }
  onSuccess: () => void
}

export function StarFormSheet({
  open,
  onOpenChange,
  skyId,
  mode,
  star,
  position,
  onSuccess,
}: StarFormSheetProps) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [year, setYear] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Pre-fill on edit
  useEffect(() => {
    if (mode === 'edit' && star) {
      setTitle(star.title ?? '')
      setMessage(star.message ?? '')
      setYear(star.year != null ? String(star.year) : '')
    } else {
      setTitle('')
      setMessage('')
      setYear('')
    }
    setImageFile(null)
    setImagePreview(null)
  }, [mode, star, open])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > STAR_IMAGE_MAX_SIZE_BYTES) {
      toast.error(`La imagen no puede superar ${STAR_IMAGE_MAX_SIZE_BYTES / 1024 / 1024}MB`)
      return
    }
    if (!STAR_IMAGE_ALLOWED_TYPES.includes(file.type)) {
      toast.error('Solo se permiten imágenes JPEG, PNG o WebP')
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setImagePreview(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimTitle = title.trim()
    if (!trimTitle) return

    setSubmitting(true)
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = { title: trimTitle }
        if (message.trim()) body.message = message.trim()
        if (year) body.year = Number(year)
        if (position) {
          body.xNormalized = position.x
          body.yNormalized = position.y
        }

        const res = await api<{ starId: string; rewards?: { stardustEarned: number } }>(`/api/skies/${skyId}/stars`, {
          method: 'POST',
          body: JSON.stringify(body),
        })

        if (imageFile) {
          let uploadedPath: string | null = null
          try {
            uploadedPath = await uploadStarImage(skyId, res.starId, imageFile)
          } catch {
            toast.warning('Estrella creada pero la imagen no se pudo subir')
            onSuccess()
            return
          }

          const patchUrl = `/api/skies/${skyId}/stars/${res.starId}`
          const patchOpts = {
            method: 'PATCH' as const,
            body: JSON.stringify({ imagePath: uploadedPath, title: trimTitle }),
          }

          try {
            await api(patchUrl, patchOpts)
          } catch {
            try {
              await api(patchUrl, patchOpts)
            } catch (retryError) {
              if (retryError instanceof ApiError && retryError.status === 409) {
                // 409 = el primer PATCH SI tuvo exito (respuesta perdida en red)
              } else {
                toast.warning(
                  'Estrella creada pero la imagen no se pudo vincular. '
                  + 'Puedes agregarla editando la estrella.'
                )
                onSuccess()
                return
              }
            }
          }
        }

        toast.success('Estrella creada')
        if (res.rewards?.stardustEarned) {
          showStardustToast(res.rewards.stardustEarned, 'star_creation')
        }
      } else if (star) {
        const body: Record<string, unknown> = { title: trimTitle }
        if (message.trim()) body.message = message.trim()
        else body.message = null
        if (year) body.year = Number(year)
        else body.year = null

        // Upload image first if selected and star has no image yet
        if (imageFile && !star.imagePath) {
          const path = await uploadStarImage(skyId, star.starId, imageFile)
          body.imagePath = path
        }

        await api(`/api/skies/${skyId}/stars/${star.starId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        toast.success('Estrella actualizada')
      }
      onSuccess()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 400) {
          toast.error('Datos inválidos. Revisa el título y mensaje.')
        } else if (error.status === 403) {
          toast.error('No tienes permisos para esta acción')
        } else {
          toast.error(mode === 'create' ? 'Error al crear la estrella' : 'Error al guardar cambios')
        }
      } else {
        toast.error('Error de conexión')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!star) return
    setSubmitting(true)
    try {
      await api(`/api/skies/${skyId}/stars/${star.starId}`, { method: 'DELETE' })
      toast.success('Estrella eliminada')
      setConfirmDelete(false)
      onSuccess()
    } catch {
      toast.error('Error al eliminar la estrella')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'Nueva estrella' : 'Editar estrella'}
      >
        <motion.form
          onSubmit={handleSubmit}
          className="space-y-5 px-2 pt-3 pb-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {/* Title */}
          <div className="space-y-1.5">
            <Label
              htmlFor="star-title"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)', fontFamily: "'Georgia', serif" }}
            >
              Título
            </Label>
            <Input
              id="star-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dale un nombre a tu estrella"
              maxLength={STAR_TITLE_MAX_LENGTH}
              required
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label
              htmlFor="star-message"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)', fontFamily: "'Georgia', serif" }}
            >
              Mensaje
              <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(opcional)</span>
            </Label>
            <Textarea
              id="star-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe un mensaje para esta estrella..."
              maxLength={STAR_MESSAGE_MAX_LENGTH}
              rows={3}
              className="bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
          </div>

          {/* Year */}
          <div className="space-y-1.5">
            <Label
              htmlFor="star-year"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)', fontFamily: "'Georgia', serif" }}
            >
              Año
              <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(opcional)</span>
            </Label>
            <Input
              id="star-year"
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2024"
              className="h-10 w-28 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
          </div>

          {/* Position indicator */}
          {position && mode === 'create' && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Posición: ({position.x.toFixed(2)}, {position.y.toFixed(2)})
            </p>
          )}

          {/* Image upload — edit mode only, no existing image */}
          {(mode === 'create' || (mode === 'edit' && star && !star.imagePath)) && (
            <div className="space-y-1.5">
              <Label
                className="text-xs font-normal tracking-wide"
                style={{ color: 'var(--text-secondary)' }}
              >
                Imagen
                <span className="ml-1" style={{ color: 'var(--text-muted)' }}>(opcional, max 5MB)</span>
              </Label>
              {imagePreview ? (
                <div className="relative overflow-hidden rounded-lg">
                  <img src={imagePreview} alt="Preview" className="w-full object-cover" style={{ maxHeight: 160 }} />
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(null) }}
                    className="absolute top-2 right-2 rounded-full bg-black/50 p-1 text-white/80 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-20 w-full items-center justify-center gap-2 rounded-lg border border-dashed transition-colors hover:bg-white/[0.03]"
                  style={{ borderColor: 'var(--glass-border)' }}
                >
                  <ImagePlus className="h-5 w-5" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Agregar imagen</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleImageSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="glass"
            size="lg"
            className="h-11 w-full tracking-wide"
            disabled={!title.trim() || submitting}
          >
            {submitting
              ? (mode === 'create' ? 'Creando...' : 'Guardando...')
              : (mode === 'create' ? 'Crear estrella' : 'Guardar cambios')}
          </Button>

          {/* Delete — edit mode only */}
          {mode === 'edit' && star && (
            <Button
              type="button"
              variant="glass-danger"
              size="lg"
              className="h-11 w-full gap-2 tracking-wide"
              onClick={() => setConfirmDelete(true)}
              disabled={submitting}
            >
              <Trash2 className="h-4 w-4" />
              Eliminar estrella
            </Button>
          )}
        </motion.form>
      </BottomSheet>

      {/* Delete confirmation dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
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
              Eliminar estrella
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Esta acción no se puede deshacer. La estrella desaparecerá del cielo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              variant="glass-danger"
              onClick={handleDelete}
              disabled={submitting}
            >
              {submitting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
