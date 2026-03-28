import type { StorageEvent } from 'firebase-functions/v2/storage'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const starUpdate = vi.fn().mockResolvedValue(undefined)
  const starGet = vi.fn()
  const userUpdate = vi.fn().mockResolvedValue(undefined)
  const userGet = vi.fn()
  const storageFileDelete = vi.fn().mockResolvedValue([undefined])
  const storageFileDownload = vi.fn().mockResolvedValue(undefined)
  const storageFile = vi.fn().mockReturnValue({
    delete: storageFileDelete,
    download: storageFileDownload,
  })
  const bucketUpload = vi.fn().mockResolvedValue(undefined)
  const runFfmpeg = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  const fsStat = vi.fn().mockResolvedValue({ size: 1_000_000 })
  const fsUnlink = vi.fn().mockResolvedValue(undefined)
  const fsMkdir = vi.fn().mockResolvedValue(undefined)

  return {
    starUpdate, starGet, userUpdate, userGet,
    storageFileDelete, storageFileDownload, storageFile,
    bucketUpload, runFfmpeg, fsStat, fsUnlink, fsMkdir,
  }
})

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'skies') {
        return {
          doc: vi.fn(() => ({
            collection: vi.fn(() => ({
              doc: vi.fn(() => ({
                get: mocks.starGet,
                update: mocks.starUpdate,
              })),
            })),
          })),
        }
      }
      if (name === 'users') {
        return {
          doc: vi.fn(() => ({
            get: mocks.userGet,
            update: mocks.userUpdate,
          })),
        }
      }
      return {}
    }),
  },
  storage: {
    bucket: vi.fn(() => ({
      file: mocks.storageFile,
      upload: mocks.bucketUpload,
    })),
  },
}))

vi.mock('../lib/ffmpeg.js', () => ({
  runFfmpeg: mocks.runFfmpeg,
}))

vi.mock('node:fs/promises', () => ({
  stat: mocks.fsStat,
  unlink: mocks.fsUnlink,
  mkdir: mocks.fsMkdir,
}))

vi.mock('firebase-functions/v2/storage', () => ({
  onObjectFinalized: vi.fn((_opts: unknown, handler: unknown) => handler),
}))

vi.mock('../logError.js', () => ({
  logError: vi.fn(),
}))

import { handleVideoProcessing } from './processVideoClip.js'

const todayUTC = new Date().toISOString().slice(0, 10)

function makeEvent(overrides: Partial<{ name: string; metadata: Record<string, string> }> = {}) {
  return {
    data: {
      name: 'temp/sky-1/star-1/raw',
      bucket: 'test-bucket',
      contentType: 'video/mp4',
      metadata: {
        skyId: 'sky-1',
        starId: 'star-1',
        userId: 'user-1',
        trimStart: '1.0',
        trimEnd: '5.0',
      },
      ...overrides,
    },
  } as unknown as StorageEvent
}

function setupStar(overrides: Record<string, unknown> = {}) {
  mocks.starGet.mockResolvedValue({
    exists: true,
    data: () => ({
      authorUserId: 'user-1',
      mediaStatus: 'processing',
      deletedAt: null,
      ...overrides,
    }),
  })
}

function setupUser(overrides: Record<string, unknown> = {}) {
  mocks.userGet.mockResolvedValue({
    exists: true,
    data: () => ({
      videoProcessedToday: 0,
      lastVideoProcessDate: null,
      ...overrides,
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.storageFileDelete.mockResolvedValue([undefined])
  mocks.storageFileDownload.mockResolvedValue(undefined)
  mocks.bucketUpload.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue({ stdout: '', stderr: '' })
  mocks.fsStat.mockResolvedValue({ size: 1_000_000 })
  mocks.fsUnlink.mockResolvedValue(undefined)
  mocks.fsMkdir.mockResolvedValue(undefined)
})

describe('handleVideoProcessing', () => {
  it('ignora paths que no son temp/', async () => {
    await handleVideoProcessing(makeEvent({ name: 'stars/x/y/image' }))
    expect(mocks.starGet).not.toHaveBeenCalled()
    expect(mocks.storageFile).not.toHaveBeenCalled()
  })

  it('ignora paths malformados', async () => {
    await handleVideoProcessing(makeEvent({ name: 'temp/sky-1' }))
    expect(mocks.starGet).not.toHaveBeenCalled()
    expect(mocks.storageFile).not.toHaveBeenCalled()
  })

  it('aborta y borra raw si metadata falta', async () => {
    await handleVideoProcessing(makeEvent({ metadata: undefined as unknown as Record<string, string> }))
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('aborta si star no existe', async () => {
    mocks.starGet.mockResolvedValue({ exists: false, data: () => undefined })
    setupUser()
    await handleVideoProcessing(makeEvent())
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('aborta si star eliminada', async () => {
    setupStar({ deletedAt: '2026-01-01' })
    setupUser()
    await handleVideoProcessing(makeEvent())
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('aborta si mediaStatus no es processing', async () => {
    setupStar({ mediaStatus: 'ready' })
    setupUser()
    await handleVideoProcessing(makeEvent())
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('aborta si userId no coincide', async () => {
    setupStar({ authorUserId: 'other-user' })
    setupUser()
    await handleVideoProcessing(makeEvent())
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFileDelete).toHaveBeenCalled()
  })

  it('escribe error si rate limit excedido', async () => {
    setupStar()
    setupUser({ videoProcessedToday: 5, lastVideoProcessDate: todayUTC })
    await handleVideoProcessing(makeEvent())
    expect(mocks.starUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStatus: 'error' }),
    )
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
  })

  it('escribe error si raw excede 50MB', async () => {
    setupStar()
    setupUser()
    mocks.fsStat.mockResolvedValueOnce({ size: 60_000_000 })
    await handleVideoProcessing(makeEvent())
    expect(mocks.starUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStatus: 'error' }),
    )
  })

  it('happy path completo', async () => {
    setupStar()
    setupUser()
    await handleVideoProcessing(makeEvent())

    // trim+compress
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    // thumbnail generation
    expect(mocks.runFfmpeg).toHaveBeenCalledWith(
      expect.arrayContaining(['-frames:v', '1']),
    )

    // upload video and thumbnail
    expect(mocks.bucketUpload).toHaveBeenCalledWith(
      expect.stringContaining('output.mp4'),
      expect.objectContaining({ destination: 'stars/sky-1/star-1/video' }),
    )
    expect(mocks.bucketUpload).toHaveBeenCalledWith(
      expect.stringContaining('thumb.jpg'),
      expect.objectContaining({ destination: 'stars/sky-1/star-1/thumb' }),
    )

    // star updated with success
    expect(mocks.starUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: 'video',
        mediaStatus: 'ready',
        mediaPath: 'stars/sky-1/star-1/video',
        thumbnailPath: 'stars/sky-1/star-1/thumb',
        mediaDuration: 4,
      }),
    )

    // user rate limit updated
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      videoProcessedToday: 1,
      lastVideoProcessDate: todayUTC,
    })

    // raw deleted from storage
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
  })

  it('retry con CRF 35 si primer intento excede 3MB', async () => {
    setupStar()
    setupUser()
    // stat calls: input size, first output (>3MB), retry output (ok)
    mocks.fsStat
      .mockResolvedValueOnce({ size: 1_000_000 })   // input size check
      .mockResolvedValueOnce({ size: 4_000_000 })    // first output > 3MB
      .mockResolvedValueOnce({ size: 2_000_000 })    // retry output ok

    await handleVideoProcessing(makeEvent())

    // 2 trim calls (CRF 28 then CRF 35) + 1 thumbnail
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(3)
    expect(mocks.starUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStatus: 'ready' }),
    )
  })

  it('escribe error y limpia parciales si FFmpeg falla', async () => {
    setupStar()
    setupUser()
    mocks.runFfmpeg.mockRejectedValueOnce(new Error('ffmpeg crash'))

    await handleVideoProcessing(makeEvent())

    // star marked as error
    expect(mocks.starUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ mediaStatus: 'error' }),
    )

    // partial files cleaned: raw + video + thumb
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/video')
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/thumb')
  })

  it('limpia /tmp siempre', async () => {
    setupStar()
    setupUser()
    await handleVideoProcessing(makeEvent())

    // 3 local files cleaned: raw, output.mp4, thumb.jpg
    expect(mocks.fsUnlink).toHaveBeenCalledTimes(3)
  })

  it('incrementa videoProcessedToday correctamente', async () => {
    setupStar()
    setupUser({ videoProcessedToday: 3, lastVideoProcessDate: todayUTC })

    await handleVideoProcessing(makeEvent())

    expect(mocks.userUpdate).toHaveBeenCalledWith({
      videoProcessedToday: 4,
      lastVideoProcessDate: todayUTC,
    })
  })
})
