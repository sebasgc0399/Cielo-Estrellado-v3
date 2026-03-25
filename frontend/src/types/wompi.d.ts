interface WompiWidgetConfig {
  currency: 'COP'
  amountInCents: number
  reference: string
  publicKey: string
  signature: { integrity: string }
  redirectUrl?: string
}

interface WompiWidgetInstance {
  open: (callback: (result: { transaction?: { id: string; status: string } }) => void) => void
}

declare global {
  interface Window {
    WidgetCheckout?: new (config: WompiWidgetConfig) => WompiWidgetInstance
  }
}

export {}
