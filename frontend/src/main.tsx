import { StrictMode, lazy, Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { Toaster } from '@/components/ui/sonner'
import { TermsAcceptanceModal } from '@/components/legal/TermsAcceptanceModal'
import '@/styles/globals.css'

const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })))
const SkiesPage = lazy(() => import('./pages/SkiesPage').then(m => ({ default: m.SkiesPage })))
const SkyPage = lazy(() => import('./pages/SkyPage').then(m => ({ default: m.SkyPage })))
const InvitePage = lazy(() => import('./pages/InvitePage').then(m => ({ default: m.InvitePage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const ShopPage = lazy(() => import('./pages/ShopPage').then(m => ({ default: m.ShopPage })))

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return <Navigate to={user ? '/skies' : '/login'} replace />
}

function App() {
  useEffect(() => {
    const el = document.getElementById('static-landing')
    if (el) {
      el.style.transition = 'opacity 0.3s'
      el.style.opacity = '0'
      setTimeout(() => el.remove(), 300)
    }
  }, [])

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/skies" element={<SkiesPage />} />
            <Route path="/sky/:skyId" element={<SkyPage />} />
            <Route path="/invite/:token" element={<InvitePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/shop" element={<ShopPage />} />
          </Routes>
        </Suspense>
        <TermsAcceptanceModal />
        <Toaster />
      </AuthProvider>
    </ErrorBoundary>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
