import { Buffer } from "node:buffer";
import { config } from "../config";
import { logger } from "../logger";
import { formatTime } from "../utils/formatTime";
import { ResolveOptions } from "./Extractor";
import { Track } from "./Track";

const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

type SpotifyEntityType = "track" | "album" | "playlist";

interface ParsedSpotifyInput {
  type: SpotifyEntityType;
  id: string;
}

interface SpotifyToken {
  accessToken: string;
  expiresAt: number;
}

interface SpotifyImage {
  url?: string;
  width?: number | null;
  height?: number | null;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: SpotifyArtist[];
  external_urls?: { spotify?: string };
  album?: { images?: SpotifyImage[] };
  is_local?: boolean;
}

interface SpotifyAlbum {
  name?: string;
  external_urls?: { spotify?: string };
  images?: SpotifyImage[];
  tracks?: { items?: SpotifyTrack[] };
}

interface SpotifyPlaylistItems {
  items?: Array<{ track?: SpotifyTrack | null }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function pickLargestImage(images?: SpotifyImage[]): string | undefined {
  if (!Array.isArray(images) || images.length === 0) return undefined;
  return [...images]
    .filter((image) => typeof image.url === "string" && image.url.length > 0)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
}

function artistNames(track: SpotifyTrack): string[] {
  return Array.isArray(track.artists)
    ? track.artists.map((artist) => artist.name?.trim()).filter((name): name is string => Boolean(name))
    : [];
}

function makeYoutubeSearchQuery(track: SpotifyTrack): string {
  const artists = artistNames(track).join(", ");
  const title = track.name?.trim() || "Unknown track";
  return artists ? `${artists} - ${title} audio` : `${title} audio`;
}

function makeSpotifyUrl(type: SpotifyEntityType, id: string): string {
  return `https://open.spotify.com/${type}/${id}`;
}

function makeTrack(track: SpotifyTrack, options: ResolveOptions, fallbackUrl?: string, fallbackThumbnail?: string): Track | null {
  if (track.is_local) return null;

  const title = track.name?.trim();
  if (!title) return null;

  const artists = artistNames(track);
  const displayTitle = artists.length > 0 ? `${artists.join(", ")} - ${title}` : title;
  const seconds = typeof track.duration_ms === "number" && Number.isFinite(track.duration_ms)
    ? Math.max(0, Math.floor(track.duration_ms / 1000))
    : null;
  const url = track.external_urls?.spotify || fallbackUrl || (track.id ? makeSpotifyUrl("track", track.id) : "https://open.spotify.com");
  const thumbnail = pickLargestImage(track.album?.images) || fallbackThumbnail;

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title: displayTitle,
    url,
    duration: formatTime(seconds),
    durationSeconds: seconds,
    thumbnail,
    requestedBy: options.requestedBy,
    requesterTag: options.requesterTag,
    source: "Spotify metadata → YouTube",
    isLive: false,
    createdAt: Date.now(),
    playbackUrl: `ytsearch1:${makeYoutubeSearchQuery(track)}`,
    metadataSource: "Spotify"
  };
}

export class SpotifyResolver {
  private token: SpotifyToken | null = null;

  public isSpotifyInput(input: string): boolean {
    return this.parseInput(input) !== null;
  }

  public async resolve(input: string, options: ResolveOptions): Promise<Track[]> {
    const parsed = this.parseInput(input);
    if (!parsed) return [];

    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      throw new Error("Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env. The bot uses Spotify only for metadata, then searches a playable public source.");
    }

    switch (parsed.type) {
      case "track":
        return this.resolveTrack(parsed.id, options);
      case "album":
        return this.resolveAlbum(parsed.id, options);
      case "playlist":
        return this.resolvePlaylist(parsed.id, options);
      default:
        return [];
    }
  }

  private parseInput(input: string): ParsedSpotifyInput | null {
    const clean = input.trim();

    const uriMatch = /^spotify:(track|album|playlist):([A-Za-z0-9]+)$/i.exec(clean);
    if (uriMatch?.[1] && uriMatch[2]) {
      return { type: uriMatch[1].toLowerCase() as SpotifyEntityType, id: uriMatch[2] };
    }

    if (!isUrl(clean)) return null;

    try {
      const url = new URL(clean);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      if (host !== "open.spotify.com") return null;
      const [type, id] = url.pathname.split("/").filter(Boolean);
      if (!type || !id) return null;
      if (!["track", "album", "playlist"].includes(type)) return null;
      return { type: type as SpotifyEntityType, id };
    } catch {
      return null;
    }
  }

  private async resolveTrack(id: string, options: ResolveOptions): Promise<Track[]> {
    const track = await this.request<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}${this.marketQuery()}`);
    const converted = makeTrack(track, options, makeSpotifyUrl("track", id));
    return converted ? [converted] : [];
  }

  private async resolveAlbum(id: string, options: ResolveOptions): Promise<Track[]> {
    const album = await this.request<SpotifyAlbum>(`/albums/${encodeURIComponent(id)}${this.marketQuery()}`);
    const albumUrl = album.external_urls?.spotify || makeSpotifyUrl("album", id);
    const thumbnail = pickLargestImage(album.images);
    const tracks = Array.isArray(album.tracks?.items) ? album.tracks.items : [];

    return tracks
      .map((track) => makeTrack(track, options, albumUrl, thumbnail))
      .filter((track): track is Track => Boolean(track))
      .slice(0, config.maxPlaylistSize);
  }

  private async resolvePlaylist(id: string, options: ResolveOptions): Promise<Track[]> {
    const limit = Math.min(config.maxPlaylistSize, 100);
    const endpoint = `/playlists/${encodeURIComponent(id)}/tracks?limit=${limit}${config.spotifyMarket ? `&market=${encodeURIComponent(config.spotifyMarket)}` : ""}`;
    const payload = await this.request<SpotifyPlaylistItems>(endpoint);
    const items = Array.isArray(payload.items) ? payload.items : [];

    return items
      .map((item) => item.track ? makeTrack(item.track, options, makeSpotifyUrl("playlist", id)) : null)
      .filter((track): track is Track => Boolean(track))
      .slice(0, config.maxPlaylistSize);
  }

  private marketQuery(): string {
    return config.spotifyMarket ? `?market=${encodeURIComponent(config.spotifyMarket)}` : "";
  }

  private async request<T>(endpoint: string): Promise<T> {
    const token = await this.getAccessToken();
    const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.debug(`Spotify API error ${response.status}: ${body.slice(0, 500)}`);
      throw new Error(`Spotify API returned ${response.status}.`);
    }

    return await response.json() as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - Date.now() > TOKEN_EXPIRY_SAFETY_MS) {
      return this.token.accessToken;
    }

    const credentials = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64");
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.debug(`Spotify token error ${response.status}: ${body.slice(0, 500)}`);
      throw new Error("Could not authenticate with Spotify. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.");
    }

    const json = asRecord(await response.json());
    const accessToken = typeof json.access_token === "string" ? json.access_token : null;
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    if (!accessToken) throw new Error("Spotify did not return an access token.");

    this.token = {
      accessToken,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
    };

    return accessToken;
  }
}
