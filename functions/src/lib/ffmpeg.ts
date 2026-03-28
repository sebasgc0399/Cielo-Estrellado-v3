import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const esmRequire = createRequire(__filename)
const ffmpegInstaller = esmRequire('@ffmpeg-installer/ffmpeg') as { path: string }

const execFileAsync = promisify(execFile)

export async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(ffmpegInstaller.path, args, { timeout: 120_000 })
}
