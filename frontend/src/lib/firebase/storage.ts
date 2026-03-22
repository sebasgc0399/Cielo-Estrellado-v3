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
