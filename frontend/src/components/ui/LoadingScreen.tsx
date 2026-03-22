import { BlurFade } from '@/components/ui/blur-fade'

export function LoadingScreen() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(140, 180, 255, 0.03) 0%, var(--bg-void) 70%)',
      }}
    >
      <BlurFade delay={0.2} inView>
        <h1
          className="text-2xl font-light tracking-widest"
          style={{
            color: 'var(--text-secondary)',
            fontFamily: "'Georgia', 'Times New Roman', serif",
          }}
        >
          Cielo Estrellado
        </h1>
      </BlurFade>
    </div>
  )
}
