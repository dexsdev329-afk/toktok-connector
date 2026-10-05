import { TikTokLiveConnection } from 'tiktok-live-connector';
import type { TikTokClientFactory, TikTokClientLike } from './tiktok-connector';

/** Real client factory (tiktok-live-connector, AGPL-3.0 — see THIRD_PARTY_LICENSES.md). */
export const createTikTokClient: TikTokClientFactory = (username, options) => {
  const connection = new TikTokLiveConnection(username, {
    ...(options.signApiKey ? { signApiKey: options.signApiKey } : {}),
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
  });
  return connection as unknown as TikTokClientLike;
};
