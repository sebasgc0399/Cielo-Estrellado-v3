import { toast } from 'sonner'

const REASON_LABELS: Record<string, string> = {
  star_creation: 'Estrella creada',
  first_star_bonus: '¡Primera estrella!',
  invite_accepted: 'Invitación aceptada',
  purchase: 'Compra de Polvo Estelar',
}

export function showStardustToast(amount: number, reason: string): void {
  toast.custom(() => (
    <div
      className="flex items-center gap-2 rounded-full px-4 py-2"
      style={{
        background: 'rgba(10, 15, 30, 0.85)',
        border: '1px solid rgba(255, 215, 0, 0.2)',
      }}
    >
      <span style={{ color: '#FFD700' }}>✦</span>
      <span
        className="text-sm tabular-nums"
        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
      >
        +{amount}
      </span>
      <span
        className="text-xs"
        style={{ color: 'rgba(255, 255, 255, 0.5)' }}
      >
        {REASON_LABELS[reason] ?? reason}
      </span>
    </div>
  ), { duration: 3000 })
}
