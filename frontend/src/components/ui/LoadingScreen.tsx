export function LoadingScreen() {
  // Si el static landing de index.html todavia existe, no duplicar el titulo
  if (typeof document !== 'undefined' && document.getElementById('static-landing')) {
    return null
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(140, 180, 255, 0.03) 0%, var(--bg-void) 70%)',
      }}
    >
      <h1
        className="text-2xl font-light tracking-widest animate-fade-in-up"
        style={{
          color: 'var(--text-secondary)',
          fontFamily: "'Georgia', 'Times New Roman', serif",
        }}
      >
        Cielo Estrellado
      </h1>
    </div>
  )
}
