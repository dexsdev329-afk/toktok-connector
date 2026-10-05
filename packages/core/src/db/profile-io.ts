import {
  PROFILE_EXPORT_FORMAT_VERSION,
  ProfileExportSchema,
  type Profile,
  type ProfileExport,
} from '@toktok/shared';
import type { Db } from './database';
import type { ActionsRepo, ProfilesRepo } from './repositories';

export function exportProfile(profiles: ProfilesRepo, actions: ActionsRepo, profileId: string): ProfileExport {
  const profile = profiles.get(profileId);
  if (!profile) throw new Error(`Unknown profile ${profileId}`);
  return {
    formatVersion: PROFILE_EXPORT_FORMAT_VERSION,
    app: 'toktok-game-connector-live',
    exportedAt: new Date().toISOString(),
    profile: { name: profile.name, game: profile.game },
    actions: actions.listByProfile(profileId).map(({ id: _id, profileId: _p, ...rest }) => rest),
  };
}

/**
 * Validates and imports an exported profile as a NEW profile (never overwrites).
 * Throws a ZodError with details when the file is invalid.
 */
export function importProfile(db: Db, profiles: ProfilesRepo, actions: ActionsRepo, raw: unknown): Profile {
  const data = ProfileExportSchema.parse(raw);
  const tx = db.transaction(() => {
    const profile = profiles.create({ name: data.profile.name, game: data.profile.game });
    for (const a of data.actions) actions.save({ ...a, profileId: profile.id });
    return profile;
  });
  return tx();
}
