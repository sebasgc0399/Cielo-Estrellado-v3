import { useEffect, useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api/client'
import { getInitials } from '@/lib/getInitials'
import { toast } from 'sonner'
import { Copy, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MemberRole, InviteRole } from '@/domain/contracts'

interface CollaboratorsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skyId: string
}

type MemberEntry = {
  userId: string
  role: MemberRole
  joinedAt: string
  displayName: string
  email: string | null
  photoURL: string | null
}

type InviteEntry = {
  inviteId: string
  role: InviteRole
  expiresAt: string
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño',
  editor: 'Editor',
  viewer: 'Lector',
}

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'Expirada'
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 24) return `${hours}h restantes`
  const days = Math.floor(hours / 24)
  return `${days}d restantes`
}

export function CollaboratorsSheet({ open, onOpenChange, skyId }: CollaboratorsSheetProps) {
  const [members, setMembers] = useState<MemberEntry[]>([])
  const [invites, setInvites] = useState<InviteEntry[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [inviteRole, setInviteRole] = useState<InviteRole>('editor')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    setGeneratedUrl(null)

    setLoadingMembers(true)
    setLoadingInvites(true)

    const fetchMembers = api<{ members: MemberEntry[] }>(`/api/skies/${skyId}/members`)
      .then((res) => setMembers(res.members))
      .catch(() => toast.error('Error al cargar miembros'))
      .finally(() => setLoadingMembers(false))

    const fetchInvites = api<{ invites: InviteEntry[] }>(`/api/skies/${skyId}/invites`)
      .then((res) => setInvites(res.invites))
      .catch(() => toast.error('Error al cargar invitaciones'))
      .finally(() => setLoadingInvites(false))

    void Promise.all([fetchMembers, fetchInvites])
  }, [open, skyId])

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId)
    try {
      await api(`/api/skies/${skyId}/invites/${inviteId}`, { method: 'DELETE' })
      setInvites((prev) => prev.filter((inv) => inv.inviteId !== inviteId))
      toast.success('Invitación revocada')
    } catch {
      toast.error('Error al revocar invitación')
    } finally {
      setRevokingId(null)
    }
  }

  async function handleGenerateInvite() {
    setGeneratingInvite(true)
    try {
      const res = await api<{ inviteUrl: string }>(`/api/skies/${skyId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: inviteRole }),
      })
      setGeneratedUrl(res.inviteUrl)
    } catch {
      toast.error('Error al generar invitación')
    } finally {
      setGeneratingInvite(false)
    }
  }

  async function handleCopy() {
    if (!generatedUrl) return
    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    toast.success('Enlace copiado')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Colaboradores">
      <div className="px-1 pb-6 pt-2 space-y-5">
        {/* Section A — Miembros */}
        <div className="space-y-3">
          <h3 className="text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
            Miembros
          </h3>
          {loadingMembers ? (
            <div className="flex justify-center py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            </div>
          ) : (
            members.map((member) => (
              <div key={member.userId} className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  {member.photoURL && <AvatarImage src={member.photoURL} alt={member.displayName} />}
                  <AvatarFallback className="text-xs">
                    {getInitials(member.displayName, member.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--text-primary)] truncate">{member.displayName}</p>
                  {member.email && (
                    <p className="text-xs text-[var(--text-muted)] truncate">{member.email}</p>
                  )}
                </div>
                <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
                  {ROLE_LABELS[member.role]}
                </Badge>
              </div>
            ))
          )}
        </div>

        <Separator className="my-4" />

        {/* Section B — Invitaciones pendientes */}
        <div className="space-y-3">
          <h3 className="text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
            Invitaciones pendientes
          </h3>
          {loadingInvites ? (
            <div className="flex justify-center py-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
            </div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No hay invitaciones pendientes</p>
          ) : (
            invites.map((invite) => (
              <div key={invite.inviteId} className="flex items-center gap-3">
                <Badge variant="outline" className="text-[10px] tracking-wider uppercase">
                  {ROLE_LABELS[invite.role]}
                </Badge>
                <span className="flex-1 text-xs text-[var(--text-muted)]">
                  {formatExpiry(invite.expiresAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-7 px-2 text-xs"
                  onClick={() => handleRevoke(invite.inviteId)}
                  disabled={revokingId === invite.inviteId}
                >
                  {revokingId === invite.inviteId ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Revocar'
                  )}
                </Button>
              </div>
            ))
          )}
        </div>

        <Separator className="my-4" />

        {/* Section C — Nueva invitación */}
        <div className="space-y-3">
          <h3 className="text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
            Nueva invitación
          </h3>

          {/* Role selector */}
          <div
            className="flex rounded-full p-1"
            style={{ background: 'rgba(255, 255, 255, 0.04)' }}
          >
            <button
              type="button"
              onClick={() => setInviteRole('editor')}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 text-xs font-light tracking-wide transition-all duration-150',
                inviteRole === 'editor'
                  ? 'bg-white/[0.12] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              Editor
            </button>
            <button
              type="button"
              onClick={() => setInviteRole('viewer')}
              className={cn(
                'flex-1 rounded-full px-3 py-1.5 text-xs font-light tracking-wide transition-all duration-150',
                inviteRole === 'viewer'
                  ? 'bg-white/[0.12] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              Lector
            </button>
          </div>

          {/* Generate invite button */}
          <Button
            className="w-full h-10"
            onClick={handleGenerateInvite}
            disabled={generatingInvite}
          >
            {generatingInvite ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Generar enlace
          </Button>

          {/* Generated URL display */}
          {generatedUrl && (
            <div className="space-y-3">
              <div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
                <p className="text-xs font-mono text-[var(--text-secondary)] break-all">
                  {generatedUrl}
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full h-10"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar enlace
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
