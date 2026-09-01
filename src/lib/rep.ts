import type { Profile } from './database.types'

/**
 * A rep is either a team member with a login or a name someone typed.
 *
 * The linked profile wins when both are somehow set: it is the one row-level
 * security actually acts on, so showing the free text there would describe the
 * record inaccurately.
 */
export function repLabel(
  profiles: Profile[],
  profileId: string | null,
  typedName: string | null,
  fallback = '—'
) {
  const profile = profileId ? profiles.find((p) => p.id === profileId) : undefined
  return profile?.full_name || profile?.email || typedName?.trim() || fallback
}
