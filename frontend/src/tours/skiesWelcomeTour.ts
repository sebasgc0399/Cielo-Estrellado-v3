import type { DriveStep } from 'driver.js'

export const skiesWelcomeSteps: DriveStep[] = [
  {
    popover: {
      title: '¡Bienvenido a Cielo Estrellado! ✦',
      description: 'Este es tu espacio para crear cielos llenos de recuerdos. Te mostramos lo básico.',
    },
  },
  {
    element: '[data-tour="stardust-balance"]',
    popover: {
      title: 'Polvo Estelar',
      description: 'Esta es tu moneda. La ganas al crear estrellas, iniciar sesión cada día y mantener tu racha. Úsala para desbloquear temas.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="streak-indicator"]',
    popover: {
      title: 'Racha diaria',
      description: 'Inicia sesión cada día para mantener tu racha y ganar más Polvo Estelar.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="store-button"]',
    popover: {
      title: 'Tienda',
      description: 'Aquí puedes desbloquear temas para personalizar tus cielos.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="create-sky-fab"]',
    popover: {
      title: 'Crea tu primer cielo',
      description: 'Toca aquí para crear un cielo y empezar a llenarlo de estrellas.',
      side: 'top',
    },
  },
]
