import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { LoadingScreen } from '@/components/ui/LoadingScreen'

export function ProfilePage() {
  const { user, loading } = useRequireAuth()
  if (loading || !user) return <LoadingScreen />

  return (
    <div className="flex h-full items-center justify-center text-[var(--text-secondary)]">
      Profile — {user.email}
    </div>
  )
}
