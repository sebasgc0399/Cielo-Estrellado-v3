import { useEffect, useRef, useCallback, useState } from 'react'
import type { DriveStep } from 'driver.js'

interface UseTourOptions {
  tourId: string
  steps: DriveStep[]
  enabled?: boolean
  delay?: number
  onComplete?: () => void
}

const STORAGE_PREFIX = 'cielo-estrellado:tour-completed:'

export function useTour({ tourId, steps, enabled = true, delay = 500, onComplete }: UseTourOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driverRef = useRef<any>(null)
  const [isActive, setIsActive] = useState(false)

  const startTour = useCallback(async () => {
    const key = `${STORAGE_PREFIX}${tourId}`
    if (localStorage.getItem(key) === 'true') return
    if (steps.length === 0) return

    const { driver } = await import('driver.js')
    await import('driver.js/dist/driver.css')

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Entendido',
      allowClose: true,
      overlayColor: '#05080f',
      overlayOpacity: 0.75,
      stagePadding: 8,
      stageRadius: 12,
      popoverClass: 'cielo-tour-popover',
      smoothScroll: true,
      animate: true,
      steps,
      onDestroyed: () => {
        localStorage.setItem(key, 'true')
        setIsActive(false)
        onComplete?.()
      },
    })

    driverRef.current = driverObj
    setIsActive(true)
    driverObj.drive()
  }, [tourId, steps, onComplete])

  useEffect(() => {
    if (!enabled) return

    const key = `${STORAGE_PREFIX}${tourId}`
    if (localStorage.getItem(key) === 'true') return

    const timer = setTimeout(startTour, delay)
    return () => {
      clearTimeout(timer)
      driverRef.current?.destroy()
      driverRef.current = null
      setIsActive(false)
    }
  }, [enabled, tourId, delay, startTour])

  return {
    isActive,
    restart: () => {
      localStorage.removeItem(`${STORAGE_PREFIX}${tourId}`)
      startTour()
    },
    isCompleted: () => localStorage.getItem(`${STORAGE_PREFIX}${tourId}`) === 'true',
  }
}
