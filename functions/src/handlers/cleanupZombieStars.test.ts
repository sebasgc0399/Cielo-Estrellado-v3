import type { ScheduledEvent } from 'firebase-functions/v2/scheduler'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const queryGet = vi.fn()
  const docUpdate = vi.fn().mockResolvedValue(undefined)
  const storageFileDelete = vi.fn().mockResolvedValue([undefined])
  const storageFile = vi.fn().mockReturnValue({ delete: storageFileDelete })

  return { queryGet, docUpdate, storageFileDelete, storageFile }
})

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collectionGroup: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      get: mocks.queryGet,
    })),
  },
  storage: {
    bucket: vi.fn(() => ({
      file: mocks.storageFile,
    })),
  },
}))

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}))

vi.mock('../logError.js', () => ({
  logError: vi.fn(),
}))

import { handleCleanupZombieStars } from './cleanupZombieStars.js'
import { logError } from '../logError.js'

function makeZombieDoc(skyId: string, starId: string) {
  return {
    id: starId,
    ref: {
      path: `skies/${skyId}/stars/${starId}`,
      parent: {
        parent: { id: skyId },
      },
      update: mocks.docUpdate,
    },
    data: () => ({
      mediaStatus: 'processing',
      updatedAt: '2026-03-28T10:00:00.000Z',
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storageFileDelete.mockResolvedValue([undefined])
  mocks.docUpdate.mockResolvedValue(undefined)
})

describe('handleCleanupZombieStars', () => {
  it('no hace nada si no hay zombies', async () => {
    mocks.queryGet.mockResolvedValue({ empty: true, docs: [] })

    await handleCleanupZombieStars({} as ScheduledEvent)

    expect(mocks.docUpdate).not.toHaveBeenCalled()
    expect(mocks.storageFile).not.toHaveBeenCalled()
  })

  it('resetea mediaStatus a null', async () => {
    const doc = makeZombieDoc('sky-1', 'star-1')
    mocks.queryGet.mockResolvedValue({ empty: false, size: 1, docs: [doc] })

    await handleCleanupZombieStars({} as ScheduledEvent)

    expect(mocks.docUpdate).toHaveBeenCalledWith({
      mediaStatus: null,
      updatedAt: expect.any(String),
    })
  })

  it('borra archivos temp', async () => {
    const doc = makeZombieDoc('sky-1', 'star-1')
    mocks.queryGet.mockResolvedValue({ empty: false, size: 1, docs: [doc] })

    await handleCleanupZombieStars({} as ScheduledEvent)

    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('continua si un zombie falla', async () => {
    const doc1 = makeZombieDoc('sky-1', 'star-1')
    const doc2 = makeZombieDoc('sky-2', 'star-2')

    // First doc.ref.update throws, second succeeds
    doc1.ref.update = vi.fn().mockRejectedValue(new Error('Firestore error'))

    mocks.queryGet.mockResolvedValue({ empty: false, size: 2, docs: [doc1, doc2] })

    await handleCleanupZombieStars({} as ScheduledEvent)

    // Second zombie still processed
    expect(mocks.docUpdate).toHaveBeenCalled()
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-2/star-2/raw')
  })

  it('maneja skyId faltante', async () => {
    const doc = makeZombieDoc('sky-1', 'star-1')
    doc.ref.parent.parent = null as unknown as { id: string }

    mocks.queryGet.mockResolvedValue({ empty: false, size: 1, docs: [doc] })

    await handleCleanupZombieStars({} as ScheduledEvent)

    expect(logError).toHaveBeenCalled()
    expect(mocks.docUpdate).not.toHaveBeenCalled()
  })
})
