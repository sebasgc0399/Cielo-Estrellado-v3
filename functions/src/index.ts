import { onRequest } from 'firebase-functions/v2/https'
import { handleCors } from './middleware/cors.js'
import { createRouter } from './router.js'
import { userSync } from './handlers/userSync.js'
import { getUserSkies, createSky, getSky, updateSky } from './handlers/skies.js'
import { createStar, updateStar, deleteStar } from './handlers/stars.js'
import { createInviteHandler, listInvites, revokeInviteHandler } from './handlers/invites.js'
import { previewInvite, acceptInviteHandler } from './handlers/invitePublic.js'
import { listMembers, updateMember, leaveSky } from './handlers/members.js'

const router = createRouter([
  { method: 'POST', pattern: '/userSync', handler: userSync },
  { method: 'GET', pattern: '/skies', handler: getUserSkies },
  { method: 'POST', pattern: '/skies', handler: createSky },
  { method: 'GET', pattern: '/skies/:skyId', handler: getSky },
  { method: 'PATCH', pattern: '/skies/:skyId', handler: updateSky },
  { method: 'POST', pattern: '/skies/:skyId/stars', handler: createStar },
  { method: 'PATCH', pattern: '/skies/:skyId/stars/:starId', handler: updateStar },
  { method: 'DELETE', pattern: '/skies/:skyId/stars/:starId', handler: deleteStar },
  { method: 'GET', pattern: '/skies/:skyId/members', handler: listMembers },
  { method: 'POST', pattern: '/skies/:skyId/members/leave', handler: leaveSky },
  { method: 'PATCH', pattern: '/skies/:skyId/members/:userId', handler: updateMember },
  { method: 'POST', pattern: '/skies/:skyId/invites', handler: createInviteHandler },
  { method: 'GET', pattern: '/skies/:skyId/invites', handler: listInvites },
  { method: 'DELETE', pattern: '/skies/:skyId/invites/:inviteId', handler: revokeInviteHandler },
  { method: 'GET', pattern: '/invites/:token/preview', handler: previewInvite },
  { method: 'POST', pattern: '/invites/:token/accept', handler: acceptInviteHandler },
])

export const api = onRequest(async (req, res) => {
  if (handleCors(req, res)) return
  await router(req, res)
})
