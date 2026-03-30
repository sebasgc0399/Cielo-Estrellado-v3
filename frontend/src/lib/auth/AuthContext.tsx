import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  type User,
} from 'firebase/auth'
import { auth } from '@/lib/firebase/auth'
import { api } from '@/lib/api/client'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
  createdAt: string | null
  providers: string[]
}

interface SyncResult {
  status: string
  isNewUser?: boolean
  needsTerms?: boolean
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  needsTerms: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string, termsVersion: string) => Promise<void>
  signInWithGoogle: (termsVersion?: string) => Promise<void>
  signOut: () => Promise<void>
  acceptTerms: (termsVersion: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function toAuthUser(firebaseUser: User): AuthUser {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
    createdAt: firebaseUser.metadata.creationTime ?? null,
    providers: firebaseUser.providerData.map((p) => p.providerId),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [needsTerms, setNeedsTerms] = useState(false)
  const pendingTermsVersion = useRef<string | null>(null)

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(toAuthUser(firebaseUser))
        const tv = pendingTermsVersion.current
        pendingTermsVersion.current = null
        const options: RequestInit = { method: 'POST' }
        if (tv) {
          options.body = JSON.stringify({ termsVersion: tv })
          options.headers = { 'Content-Type': 'application/json' }
        }
        api<SyncResult>('/api/userSync', options)
          .then((result) => {
            if (result?.needsTerms && !tv) {
              setNeedsTerms(true)
            }
          })
          .catch((e) => console.error('userSync failed:', e))
      } else {
        setUser(null)
        setNeedsTerms(false)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password)
  }, [])

  const signUpWithEmail = useCallback(async (email: string, password: string, termsVersion: string) => {
    pendingTermsVersion.current = termsVersion
    await createUserWithEmailAndPassword(auth, email, password)
  }, [])

  const signInWithGoogle = useCallback(async (termsVersion?: string) => {
    if (termsVersion) pendingTermsVersion.current = termsVersion
    const provider = new GoogleAuthProvider()
    await signInWithPopup(auth, provider)
  }, [])

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth)
    setUser(null)
    setNeedsTerms(false)
  }, [])

  const acceptTermsAction = useCallback(async (termsVersion: string) => {
    await api('/api/acceptTerms', {
      method: 'POST',
      body: JSON.stringify({ termsVersion }),
      headers: { 'Content-Type': 'application/json' },
    })
    setNeedsTerms(false)
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    needsTerms,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
    acceptTerms: acceptTermsAction,
  }), [user, loading, needsTerms, signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, acceptTermsAction])

  return (
    <AuthContext value={value}>
      {children}
    </AuthContext>
  )
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
