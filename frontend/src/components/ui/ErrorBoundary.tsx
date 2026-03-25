import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-void, #05080f)',
            color: 'var(--text-primary, rgba(255,255,255,0.95))',
            padding: '2rem',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✦</span>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 500, marginBottom: '0.5rem' }}>
            Algo salió mal
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, rgba(255,255,255,0.4))', marginBottom: '1.5rem' }}>
            Ha ocurrido un error inesperado.
          </p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.href = '/skies' }}
            style={{
              padding: '0.625rem 1.5rem',
              borderRadius: '0.75rem',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'var(--text-primary, rgba(255,255,255,0.95))',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            Volver al inicio
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
