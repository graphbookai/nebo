import { api } from '@/lib/api'

/**
 * Resolve the URL for a media blob. The daemon serves raw bytes with an
 * immutable content-addressed ETag, so <img>/<audio> can point straight at
 * the endpoint and the browser handles loading, caching and eviction —
 * no in-store base64 cache.
 */
export function useMedia(runId: string, mediaId: string): string {
  return api.mediaUrl(runId, mediaId)
}
