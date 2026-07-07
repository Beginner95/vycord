import { apiService } from './api';

// Fallback when the API is unreachable or TURN is not configured on the server.
export const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface CachedIceServers {
  servers: RTCIceServer[];
  expiresAt: number;
}

let cache: CachedIceServers | null = null;

// Returns STUN + TURN ICE servers for RTCPeerConnection. TURN credentials are
// ephemeral (HMAC of an expiry timestamp, coturn REST API scheme), so they are
// fetched from the API and cached until shortly before they expire. Without a
// TURN relay, clients behind symmetric NAT or VPN never establish media.
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.servers;
  }

  try {
    const res = await apiService.getTurnCredentials();
    const turnServers: RTCIceServer[] = (res.ice_servers ?? [])
      .filter((s) => s.urls && s.urls.length > 0)
      .map((s) => ({ urls: s.urls, username: s.username, credential: s.credential }));

    const servers = [...STUN_SERVERS, ...turnServers];
    // Refresh 5 minutes before credential expiry; if TURN is not configured
    // (empty list, ttl=0), re-check in 5 minutes in case it gets enabled.
    const ttlMs = res.ttl > 0 ? Math.max((res.ttl - 300) * 1000, 60_000) : 5 * 60_000;
    cache = { servers, expiresAt: Date.now() + ttlMs };
    return servers;
  } catch (err) {
    console.warn('[ICE] failed to fetch TURN credentials, using STUN only:', err);
    return STUN_SERVERS;
  }
}
