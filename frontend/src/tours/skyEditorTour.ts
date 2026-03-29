import type { DriveStep } from 'driver.js'

export const skyEditorSteps: DriveStep[] = [
  {
    popover: {
      title: 'Tu cielo estrellado',
      description: 'Este es tu cielo. Cada punto de luz es una estrella — un recuerdo, un momento, una persona.',
    },
  },
  {
    element: '[aria-label="Crear estrella"]',
    popover: {
      title: 'Crear una estrella',
      description: 'Toca aquí para activar el modo de creación. Luego toca cualquier parte del cielo para colocar tu estrella.',
      side: 'right',
    },
  },
  {
    element: '[aria-label="Configuración"]',
    popover: {
      title: 'Personaliza tu cielo',
      description: 'Cambia el tema, la densidad de estrellas y los efectos visuales.',
      side: 'right',
    },
  },
  {
    element: '[aria-label="Volver"]',
    popover: {
      title: 'Volver',
      description: 'Desde aquí puedes regresar a tu lista de cielos.',
      side: 'right',
    },
  },
]
