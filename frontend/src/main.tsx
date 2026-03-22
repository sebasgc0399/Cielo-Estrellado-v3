import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { LoginPage } from '@/pages/LoginPage'
import { SkiesPage } from '@/pages/SkiesPage'
import { SkyPage } from '@/pages/SkyPage'
import { InvitePage } from '@/pages/InvitePage'
import { ProfilePage } from '@/pages/ProfilePage'
import '@/styles/globals.css'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  return <Navigate to={user ? '/skies' : '/login'} replace />
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/skies" element={<SkiesPage />} />
        <Route path="/sky/:skyId" element={<SkyPage />} />
        <Route path="/invite/:token" element={<InvitePage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Routes>
    </AuthProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
