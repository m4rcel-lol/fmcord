import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { logger } from "../logger";

const execFileAsync = promisify(execFile);
const SPOTIFY_API = "https://api.spotify.com/v1";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SOUNDCLOUD_OEMBED_URL = "https://soundcloud.com/oembed";
const DEFAULT_TIMEOUT_MS = 9_000;
const SPOTIFY_REDIRECT_TIMEOUT_MS = 6_000;
const MAX_RETRY_AFTER_MS = 3_000;

const SPOTIFY_MARKET_ALIASES: Record<string, string | undefined> = {
  EN: "GB",
  UK: "GB",
  USA: "US",
  GLOBAL: undefined,
  AUTO: undefined,
  NONE: undefined
};

const SPOTIFY_MARKETS = new Set([
  "AD", "AE", "AG", "AL", "AM", "AO", "AR", "AT", "AU", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
  "BJ", "BN", "BO", "BR", "BS", "BT", "BW", "BY", "BZ", "CA", "CD", "CG", "CH", "CI", "CL", "CM", "CO", "CR",
  "CV", "CW", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "ES", "ET", "FI", "FJ", "FM",
  "FR", "GA", "GB", "GD", "GE", "GH", "GM", "GN", "GQ", "GR", "GT", "GW", "GY", "HK", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IN", "IQ", "IS", "IT", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KR", "KW",
  "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MG", "MH",
  "MK", "ML", "MN", "MO", "MR", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NE", "NG", "NI", "NL", "NO",
  "NP", "NR", "NZ", "OM", "PA", "PE", "PG", "PH", "PK", "PL", "PS", "PT", "PW", "PY", "QA", "RO", "RS", "RW",
  "SA", "SB", "SC", "SE", "SG", "SI", "SK", "SL", "SM", "SN", "SR", "ST", "SV", "SZ", "TD", "TG", "TH", "TJ",
  "TL", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "US", "UY", "UZ", "VC", "VE", "VN", "VU", "WS",
  "XK", "ZA", "ZM", "ZW"
]);

export type MetadataProvider = "Spotify" | "SoundCloud";
export type MetadataKind = "track" | "album" | "playlist" | "artist" | "set";

export interface MetadataTrackInput {
  title: string;
  artist?: string;
  url: string;
  thumbnail?: string;
  durationSeconds: number | null;
  source: string;
  playbackSearch: string;
  kind: MetadataKind;
}

export interface MetadataResolveResult {
  provider: MetadataProvider;
  kind: MetadataKind;
  tracks: MetadataTrackInput[];
  collectionTitle?: string;
  truncated?: boolean;
}

interface SpotifyToken {
  accessToken: string;
  expiresAt: number;
}

interface SpotifyImage {
  url?: string;
  height?: number | null;
  width?: number | null;
}

interface SpotifyArtist {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  external_urls?: SpotifyExternalUrls;
}

interface SpotifyExternalUrls {
  spotify?: string;
}

interface SpotifyTrack {
  id?: string;
  name?: string;
  duration_ms?: number;
  artists?: SpotifyArtist[];
  external_urls?: SpotifyExternalUrls;
  album?: { images?: SpotifyImage[] };
  is_playable?: boolean;
  linked_from?: { id?: string; external_urls?: SpotifyExternalUrls };
}

interface SpotifyAlbum {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  external_urls?: SpotifyExternalUrls;
  tracks?: SpotifyPage<SpotifyTrack>;
}

interface SpotifyPlaylist {
  id?: string;
  name?: string;
  images?: SpotifyImage[];
  external_urls?: SpotifyExternalUrls;
}

interface SpotifyPlaylistTrackItem {
  track?: SpotifyTrack | null;
  is_local?: boolean;
}

interface SpotifyPage<T> {
  items?: T[];
  next?: string | null;
  total?: number;
}

interface SoundCloudOEmbed {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

interface SoundCloudYtdlpInfo {
  id?: string;
  title?: string;
  fulltitle?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  artist?: string;
  uploader_url?: string;
  extractor?: string;
  extractor_key?: string;
  entries?: SoundCloudYtdlpInfo[];
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
}

interface ParsedSpotifyInput {
  kind: "track" | "album" | "playlist" | "artist";
  id: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripNoise(value: string): string {
  return normalizeSpaces(
    value
      .replace(/[|｜].*$/u, "")
      .replace(/\((?:official\s+)?(?:music\s+)?video\)/gi, "")
      .replace(/\[(?:official\s+)?(?:music\s+)?video\]/gi, "")
      .replace(/\((?:official\s+)?audio\)/gi, "")
      .replace(/\[(?:official\s+)?audio\]/gi, "")
  );
}

function bestImage(images: SpotifyImage[] | SoundCloudYtdlpInfo["thumbnails"] | undefined): string | undefined {
  const usable = images?.filter((image) => image.url) ?? [];
  usable.sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)));
  return usable[0]?.url;
}

function spotifyMarket(): string | undefined {
  const raw = config.spotifyMarket.trim().toUpperCase();
  const aliased = Object.prototype.hasOwnProperty.call(SPOTIFY_MARKET_ALIASES, raw)
    ? SPOTIFY_MARKET_ALIASES[raw]
    : raw;

  if (!aliased) return undefined;

  if (!SPOTIFY_MARKETS.has(aliased)) {
    logger.warn(`Invalid SPOTIFY_MARKET=${raw}; omitting the market parameter for Spotify metadata requests.`);
    return undefined;
  }

  if (raw !== aliased) {
    logger.debug(`Mapped SPOTIFY_MARKET=${raw} to Spotify country market ${aliased}.`);
  }

  return aliased;
}

function withMarket(path: string): string {
  const market = spotifyMarket();
  if (!market) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}market=${encodeURIComponent(market)}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", "FMCord/2.12 metadata resolver");

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, init, timeoutMs);
      if (response.status === 429 || response.status >= 500) {
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        const retryAfterMs = Number.isFinite(retryAfterSeconds)
          ? Math.min(MAX_RETRY_AFTER_MS, Math.max(500, retryAfterSeconds * 1000))
          : 750;
        if (attempt === 0) {
          await sleep(retryAfterMs);
          continue;
        }
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 240)}` : ""}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
    }
  }

  throw lastError ?? new Error("Request failed.");
}

function parseSpotifyInput(input: string): ParsedSpotifyInput | null {
  const clean = input.trim();
  const uriMatch = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]{22})$/i.exec(clean);
  if (uriMatch) {
    const kind = uriMatch[1];
    const id = uriMatch[2];
    if (kind && id) return { kind: kind as ParsedSpotifyInput["kind"], id };
  }

  if (!isHttpUrl(clean)) return null;

  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "open.spotify.com" && !host.endsWith(".spotify.com")) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const typeIndex = parts.findIndex((part) => ["track", "album", "playlist", "artist"].includes(part.toLowerCase()));
  if (typeIndex < 0) return null;

  const kind = parts[typeIndex]?.toLowerCase() as ParsedSpotifyInput["kind"] | undefined;
  const id = parts[typeIndex + 1]?.match(/[A-Za-z0-9]{22}/)?.[0];
  if (!kind || !id) return null;
  return { kind, id };
}

function isSpotifyShortLink(input: string): boolean {
  if (!isHttpUrl(input)) return false;
  try {
    const host = new URL(input).hostname.replace(/^www\./, "").toLowerCase();
    return host === "spotify.link" || host === "spoti.fi" || host === "spotify.app.link";
  } catch {
    return false;
  }
}

function isSoundCloudUrl(input: string): boolean {
  if (!isHttpUrl(input)) return false;
  try {
    const host = new URL(input).hostname.replace(/^www\./, "").toLowerCase();
    return host === "soundcloud.com" || host.endsWith(".soundcloud.com");
  } catch {
    return false;
  }
}

function isSoundCloudSetUrl(input: string): boolean {
  if (!isSoundCloudUrl(input)) return false;
  try {
    return /\/sets\//i.test(new URL(input).pathname);
  } catch {
    return false;
  }
}

function spotifyTrackToInput(track: SpotifyTrack, fallbackImage: string | undefined, kind: MetadataKind): MetadataTrackInput | null {
  const name = stripNoise(track.name ?? "");
  const artists = track.artists?.map((artist) => artist.name).filter((name): name is string => Boolean(name?.trim())) ?? [];
  const artist = normalizeSpaces(artists.join(", "));
  const linkedUrl = track.linked_from?.external_urls?.spotify;
  const url = track.external_urls?.spotify ?? linkedUrl ?? (track.id ? `https://open.spotify.com/track/${track.id}` : "");
  if (!name || !artist || !url) return null;

  const title = name;
  return {
    title,
    artist,
    url,
    thumbnail: bestImage(track.album?.images) ?? fallbackImage,
    durationSeconds: typeof track.duration_ms === "number" ? Math.max(0, Math.round(track.duration_ms / 1000)) : null,
    source: "Spotify → YouTube",
    playbackSearch: buildPlaybackSearch(artist, title),
    kind
  };
}

function buildPlaybackSearch(artist: string | undefined, title: string): string {
  const cleanTitle = stripNoise(title);
  const cleanArtist = artist ? stripNoise(artist) : "";
  const base = cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())
    ? `${cleanArtist} - ${cleanTitle}`
    : cleanTitle;
  return `${base} official audio`;
}

function cleanSoundCloudTitle(title: string, author: string | undefined): string {
  let clean = stripNoise(title);
  if (author) {
    const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(`\\s+by\\s+${escaped}$`, "i"), "").trim();
  }
  return clean;
}

function soundCloudAuthor(info: SoundCloudYtdlpInfo): string | undefined {
  return normalizeSpaces(info.uploader ?? info.artist ?? info.creator ?? info.channel ?? "") || undefined;
}

function soundCloudEntryUrl(entry: SoundCloudYtdlpInfo, fallbackUrl: string): string {
  for (const candidate of [entry.webpage_url, entry.original_url, entry.url]) {
    if (candidate && isHttpUrl(candidate)) return candidate;
  }
  return fallbackUrl;
}

function soundCloudEntryToInput(entry: SoundCloudYtdlpInfo, fallbackUrl: string, fallbackImage: string | undefined): MetadataTrackInput | null {
  const artist = soundCloudAuthor(entry);
  const title = cleanSoundCloudTitle(entry.title ?? entry.fulltitle ?? "", artist);
  if (!title) return null;

  const url = soundCloudEntryUrl(entry, fallbackUrl);
  return {
    title,
    artist,
    url,
    thumbnail: entry.thumbnail ?? bestImage(entry.thumbnails) ?? fallbackImage,
    durationSeconds: typeof entry.duration === "number" && Number.isFinite(entry.duration) ? Math.max(0, Math.floor(entry.duration)) : null,
    source: "SoundCloud → YouTube",
    playbackSearch: buildPlaybackSearch(artist, title),
    kind: "set"
  };
}

export class UrlMetadataResolver {
  private spotifyToken: SpotifyToken | null = null;

  public async resolve(input: string): Promise<MetadataResolveResult | null> {
    const spotifyInput = await this.parseSpotifyInputOrRedirect(input);
    if (spotifyInput) return this.resolveSpotify(spotifyInput);
    if (isSoundCloudUrl(input)) return this.resolveSoundCloud(input.trim());
    return null;
  }

  private async parseSpotifyInputOrRedirect(input: string): Promise<ParsedSpotifyInput | null> {
    const direct = parseSpotifyInput(input);
    if (direct) return direct;

    if (!isSpotifyShortLink(input)) return null;

    try {
      const response = await fetchWithTimeout(input.trim(), {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml"
        }
      }, SPOTIFY_REDIRECT_TIMEOUT_MS);

      const redirected = response.url && response.url !== input ? parseSpotifyInput(response.url) : null;
      if (redirected) return redirected;
    } catch (error) {
      logger.debug("Could not resolve Spotify short/share link", error instanceof Error ? error.message : String(error));
    }

    return null;
  }

  private async resolveSpotify(input: ParsedSpotifyInput): Promise<MetadataResolveResult> {
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      throw new Error("Spotify links need SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env. The bot still does not stream Spotify audio; it only reads metadata.");
    }

    if (input.kind === "track") {
      const track = await this.spotifyGet<SpotifyTrack>(withMarket(`/tracks/${input.id}`));
      const converted = spotifyTrackToInput(track, undefined, "track");
      if (!converted) throw new Error("Spotify returned incomplete track metadata.");
      return { provider: "Spotify", kind: "track", tracks: [converted], collectionTitle: converted.title };
    }

    if (input.kind === "album") {
      const album = await this.spotifyGet<SpotifyAlbum>(withMarket(`/albums/${input.id}`));
      const fallbackImage = bestImage(album.images);
      const items = await this.collectSpotifyPage(album.tracks, config.maxPlaylistSize, async (next) => this.spotifyGet<SpotifyPage<SpotifyTrack>>(next));
      const tracks = items
        .map((track) => spotifyTrackToInput({ ...track, album: { images: album.images } }, fallbackImage, "album"))
        .filter((track): track is MetadataTrackInput => Boolean(track))
        .slice(0, config.maxPlaylistSize);
      if (tracks.length === 0) throw new Error("Spotify returned no playable album tracks.");
      return {
        provider: "Spotify",
        kind: "album",
        tracks,
        collectionTitle: album.name,
        truncated: typeof album.tracks?.total === "number" ? album.tracks.total > tracks.length : false
      };
    }

    if (input.kind === "artist") {
      const artist = await this.spotifyGet<SpotifyArtist>(`/artists/${input.id}`);
      const topTracks = await this.spotifyGet<{ tracks?: SpotifyTrack[] }>(withMarket(`/artists/${input.id}/top-tracks`));
      const fallbackImage = bestImage(artist.images);
      const tracks = (topTracks.tracks ?? [])
        .map((track) => spotifyTrackToInput(track, fallbackImage, "artist"))
        .filter((track): track is MetadataTrackInput => Boolean(track))
        .slice(0, Math.min(config.maxPlaylistSize, 10));
      if (tracks.length === 0) throw new Error("Spotify returned no readable top tracks for that artist.");
      return {
        provider: "Spotify",
        kind: "artist",
        tracks,
        collectionTitle: artist.name,
        truncated: false
      };
    }

    const playlist = await this.spotifyGet<SpotifyPlaylist>(`/playlists/${input.id}?fields=name,external_urls,images`);
    const fallbackImage = bestImage(playlist.images);
    const firstPage = await this.spotifyGet<SpotifyPage<SpotifyPlaylistTrackItem>>(
      withMarket(`/playlists/${input.id}/tracks?limit=50&fields=items(is_local,track(id,name,duration_ms,artists(name),external_urls,album(images),is_playable,linked_from)),next,total`)
    );
    const items = await this.collectSpotifyPage(
      firstPage,
      config.maxPlaylistSize,
      async (next) => this.spotifyGet<SpotifyPage<SpotifyPlaylistTrackItem>>(next)
    );
    const tracks = items
      .filter((item) => !item.is_local && item.track)
      .map((item) => spotifyTrackToInput(item.track as SpotifyTrack, fallbackImage, "playlist"))
      .filter((track): track is MetadataTrackInput => Boolean(track))
      .slice(0, config.maxPlaylistSize);
    if (tracks.length === 0) throw new Error("Spotify returned no readable playlist tracks. Private, local, or restricted playlist items cannot be resolved by this bot.");
    return {
      provider: "Spotify",
      kind: "playlist",
      tracks,
      collectionTitle: playlist.name,
      truncated: typeof firstPage.total === "number" ? firstPage.total > tracks.length : false
    };
  }

  private async resolveSoundCloud(url: string): Promise<MetadataResolveResult> {
    if (isSoundCloudSetUrl(url)) {
      try {
        const setResult = await this.resolveSoundCloudSet(url);
        if (setResult.tracks.length > 0) return setResult;
      } catch (error) {
        logger.debug("SoundCloud set metadata extraction failed; falling back to oEmbed", error instanceof Error ? error.message : String(error));
      }
    }

    const requestUrl = `${SOUNDCLOUD_OEMBED_URL}?format=json&url=${encodeURIComponent(url)}`;
    const metadata = await fetchJson<SoundCloudOEmbed>(requestUrl, {}, DEFAULT_TIMEOUT_MS);
    const author = normalizeSpaces(metadata.author_name ?? "");
    const title = cleanSoundCloudTitle(metadata.title ?? "", author || undefined);
    if (!title) throw new Error("SoundCloud returned incomplete metadata for that URL.");

    const isSet = isSoundCloudSetUrl(url);
    const playbackSearch = buildPlaybackSearch(author || undefined, title);
    return {
      provider: "SoundCloud",
      kind: isSet ? "set" : "track",
      collectionTitle: title,
      tracks: [
        {
          title,
          artist: author || undefined,
          url,
          thumbnail: metadata.thumbnail_url,
          durationSeconds: null,
          source: "SoundCloud → YouTube",
          playbackSearch,
          kind: isSet ? "set" : "track"
        }
      ]
    };
  }

  private async resolveSoundCloudSet(url: string): Promise<MetadataResolveResult> {
    const info = await this.runYtdlpJson([
      "--flat-playlist",
      "--playlist-end",
      String(config.maxPlaylistSize),
      "--dump-single-json",
      url
    ]);

    const fallbackImage = info.thumbnail ?? bestImage(info.thumbnails);
    const entries = Array.isArray(info.entries) ? info.entries : [];
    const tracks = entries
      .map((entry) => soundCloudEntryToInput(entry, url, fallbackImage))
      .filter((track): track is MetadataTrackInput => Boolean(track))
      .slice(0, config.maxPlaylistSize);

    if (tracks.length === 0) throw new Error("SoundCloud returned no readable playlist tracks.");

    return {
      provider: "SoundCloud",
      kind: "set",
      tracks,
      collectionTitle: cleanSoundCloudTitle(info.title ?? info.fulltitle ?? "SoundCloud playlist", soundCloudAuthor(info)),
      truncated: entries.length >= config.maxPlaylistSize
    };
  }

  private async getSpotifyAccessToken(): Promise<string> {
    if (this.spotifyToken && this.spotifyToken.expiresAt - Date.now() > 60_000) {
      return this.spotifyToken.accessToken;
    }

    const basic = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64");
    const response = await fetchJson<{ access_token?: string; expires_in?: number }>(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString()
    }, DEFAULT_TIMEOUT_MS);

    if (!response.access_token) throw new Error("Spotify did not return an access token. Check your client ID and secret.");
    const expiresIn = typeof response.expires_in === "number" ? response.expires_in : 3600;
    this.spotifyToken = {
      accessToken: response.access_token,
      expiresAt: Date.now() + expiresIn * 1000
    };
    return response.access_token;
  }

  private async spotifyGet<T>(pathOrUrl: string): Promise<T> {
    const accessToken = await this.getSpotifyAccessToken();
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${SPOTIFY_API}${pathOrUrl}`;
    try {
      return await fetchJson<T>(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }, DEFAULT_TIMEOUT_MS);
    } catch (error) {
      logger.debug("Spotify metadata request failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async collectSpotifyPage<T>(
    firstPage: SpotifyPage<T> | undefined,
    limit: number,
    fetchNext: (url: string) => Promise<SpotifyPage<T>>
  ): Promise<T[]> {
    const items: T[] = [];
    let page = firstPage;

    while (page && items.length < limit) {
      items.push(...(page.items ?? []).slice(0, limit - items.length));
      if (!page.next || items.length >= limit) break;
      page = await fetchNext(page.next);
    }

    return items;
  }

  private async runYtdlpJson(args: string[]): Promise<SoundCloudYtdlpInfo> {
    const { stdout } = await execFileAsync(config.ytdlpBinary, [
      "--no-warnings",
      "--quiet",
      "--force-ipv4",
      "--socket-timeout",
      "12",
      ...args
    ], {
      timeout: 25_000,
      maxBuffer: 20 * 1024 * 1024
    });

    const trimmed = stdout.trim();
    if (!trimmed) throw new Error("yt-dlp returned no SoundCloud playlist metadata.");
    return JSON.parse(trimmed) as SoundCloudYtdlpInfo;
  }
}
