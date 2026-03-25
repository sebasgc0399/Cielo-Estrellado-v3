import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api/client'
import {
  DAILY_LOGIN_REWARD,
  STAR_CREATION_REWARD,
  STREAK_7_BONUS,
  INVITE_ACCEPTED_REWARD,
} from '@/domain/economy'

interface PurchaseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  price: number
  currentBalance: number
  onConfirm: () => Promise<void>
}

export function PurchaseDialog({
  open,
  onOpenChange,
  itemName,
  price,
  currentBalance,
  onConfirm,
}: PurchaseDialogProps) {
  const [purchasing, setPurchasing] = useState(false)
  const canAfford = currentBalance >= price

  const handleConfirm = async () => {
    setPurchasing(true)
    try {
      await onConfirm()
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 400) {
          toast.error(error.message || 'Error al comprar')
        } else {
          toast.error('Error al realizar la compra')
        }
      } else {
        toast.error('Error de conexión')
      }
    } finally {
      setPurchasing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            Comprar {itemName}
          </DialogTitle>
          <DialogDescription style={{ color: 'var(--text-secondary)' }}>
            Confirma tu compra con Polvo Estelar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <p
            className="flex items-center gap-1.5 text-sm font-light tracking-wide"
            style={{ color: 'var(--text-primary)' }}
          >
            Precio:
            <span style={{ color: '#FFD700' }}>✦</span>
            <span className="tabular-nums">{price}</span>
            Polvo Estelar
          </p>
          <p
            className="flex items-center gap-1.5 text-sm font-light tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Tu balance:
            <span style={{ color: '#FFD700' }}>✦</span>
            <span className="tabular-nums">{currentBalance}</span>
          </p>
          {!canAfford && (
            <>
              <p
                className="text-sm font-light tracking-wide"
                style={{ color: 'rgba(248, 113, 113, 0.8)' }}
              >
                No tienes suficiente Polvo Estelar
              </p>
              <div className="mt-3">
                <div className="flex justify-between text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                  <span>Progreso</span>
                  <span>{Math.round((currentBalance / price) * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((currentBalance / price) * 100, 100)}%`,
                      background: 'linear-gradient(90deg, #FFD700, #FFA500)',
                    }}
                  />
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Te faltan ✦ {price - currentBalance}
                </p>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Formas de ganar Polvo Estelar:
                </p>
                <ul className="text-[11px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                  <li>• Login diario: +{DAILY_LOGIN_REWARD} ✦</li>
                  <li>• Crear estrellas: +{STAR_CREATION_REWARD} ✦ cada una</li>
                  <li>• Racha de 7 días: +{STREAK_7_BONUS} ✦</li>
                  <li>• Invitar amigos: +{INVITE_ACCEPTED_REWARD} ✦</li>
                </ul>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={purchasing}
          >
            Cancelar
          </Button>
          <Button
            variant="glass-gold"
            onClick={handleConfirm}
            disabled={!canAfford || purchasing}
          >
            {purchasing ? 'Comprando...' : 'Comprar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
