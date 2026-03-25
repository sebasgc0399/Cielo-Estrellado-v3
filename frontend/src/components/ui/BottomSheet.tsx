import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ReactNode } from 'react'

interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  children: ReactNode
}

export function BottomSheet({ open, onOpenChange, title, children }: BottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        initialFocus={false}
        className="rounded-t-[var(--radius-sheet)] border-t border-[var(--glass-border)]"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(var(--glass-blur))',
          WebkitBackdropFilter: 'blur(var(--glass-blur))',
        }}
      >
        {title && (
          <SheetHeader>
            <SheetTitle className="text-[var(--text-primary)]">{title}</SheetTitle>
          </SheetHeader>
        )}
        <div className="max-h-[70vh] overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
