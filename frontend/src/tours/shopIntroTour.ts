import type { DriveStep } from 'driver.js'

export const shopIntroSteps: DriveStep[] = [
  {
    element: '[data-tour="shop-balance"]',
    popover: {
      title: 'Tu Polvo Estelar',
      description: 'Este es tu balance actual. Puedes ganar más creando estrellas o comprando paquetes.',
      side: 'bottom',
    },
  },
  {
    element: '[data-tour="theme-grid"]',
    popover: {
      title: 'Temas disponibles',
      description: 'Desbloquea temas para cambiar la apariencia de tus cielos. Los que ya tienes están marcados.',
      side: 'top',
    },
  },
  {
    element: '[data-tour="buy-stardust-cta"]',
    popover: {
      title: 'Obtener más Polvo Estelar',
      description: 'Si quieres más Polvo Estelar, puedes comprar paquetes aquí.',
      side: 'top',
    },
  },
]
