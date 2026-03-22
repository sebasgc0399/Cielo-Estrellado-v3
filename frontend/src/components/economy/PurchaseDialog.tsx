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
    } catch {
      toast.error('Error al realizar la compra')
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
            <p
              className="text-sm font-light tracking-wide"
              style={{ color: 'rgba(248, 113, 113, 0.8)' }}
            >
              No tienes suficiente Polvo Estelar
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={purchasing}
          >
            Cancelar
          </Button>
          <Button
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
