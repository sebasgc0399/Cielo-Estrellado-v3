import { ref, uploadBytes } from 'firebase/storage'
import { storage } from './client'

export async function uploadStarImage(
  skyId: string,
  starId: string,
  file: File,
): Promise<string> {
  const path = `stars/${skyId}/${starId}/image`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, { contentType: file.type })
  return path
}

export async function uploadStarVideo(
  skyId: string,
  starId: string,
  file: File,
  trimStart: number,
  trimEnd: number,
  userId: string,
): Promise<void> {
  const path = `temp/${skyId}/${starId}/raw`
  const storageRef = ref(storage, path)
  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: {
      skyId,
      starId,
      trimStart: String(trimStart),
      trimEnd: String(trimEnd),
      userId,
    },
  })
}
