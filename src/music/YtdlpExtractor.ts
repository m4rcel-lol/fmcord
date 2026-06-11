import { execFile, spawn } from "node:child_process";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { config } from "../config";
import { logger } from "../logger";
import { formatTime } from "../utils/formatTime";
import { Extractor, PlaybackStream, ResolveOptions } from "./Extractor";
import { Track } from "./Track";
import { MetadataTrackInput, UrlMetadataResolver } from "./UrlMetadataResolver";

const execFileAsync = promisify(execFile);
const DIRECT_AUDIO_RE = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)(\?.*)?$/i;
const CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_REFRESH_SAFETY_MS = 60 * 1000;
const STREAM_FALLBACK_EXPIRY_MS = 5 * 60 * 60 * 1000;
const YOUTUBE_SEARCH_CANDIDATES = 12;
const YOUTUBE_SEARCH_TIMEOUT_MS = 12_000;

interface YtdlpInfo {
  id?: string;
  title?: string;
  fulltitle?: string;
  webpage_url?: string;
  original_url?: string;
  url?: string;
  duration?: number;
  duration_string?: string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string; width?: number; height?: number }>;
  extractor?: string;
  extractor_key?: string;
  ie_key?: string;
  live_status?: string;
  is_live?: boolean;
  entries?: YtdlpInfo[];
  requested_downloads?: Array<{ url?: string; protocol?: string; ext?: string }>;
  uploader?: string;
  channel?: string;
  creator?: string;
  artist?: string;
  view_count?: number;
  availability?: string;
}

interface CachedResult {
  expiresAt: number;
  tracks: Track[];
}

function isUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isSoundCloudUrl(value: string): boolean {
  if (!isUrl(value)) return false;
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return host === "soundcloud.com" || host.endsWith(".soundcloud.com");
  } catch {
    return false;
  }
}

function isSoundCloudPlaylistUrl(value: string): boolean {
  if (!isSoundCloudUrl(value)) return false;
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return pathname.includes("/sets/") || pathname.includes("/playlists/");
  } catch {
    return false;
  }
}

function parseSoundCloudSearch(value: string): string | null {
  const match = /^(?:sc|soundcloud)\s*:\s*(.+)$/i.exec(value.trim());
  const query = match?.[1]?.trim();
  return query || null;
}

function looksLikePlaylist(value: string): boolean {
  if (!isUrl(value)) return false;
  const lowered = value.toLowerCase();
  return lowered.includes("list=") || lowered.includes("/playlist") || lowered.includes("/sets/");
}

function extractorSearchTarget(value: string): boolean {
  return /^(?:ytsearch|ytsearchdate)\d*:/i.test(value);
}

function isYoutubeExtractor(info: YtdlpInfo): boolean {
  return [info.extractor_key, info.extractor, info.ie_key].some((value) => value?.toLowerCase() === "youtube");
}

function youtubeVideoId(value: string | undefined): string | null {
  if (!value) return null;
  return /^[a-zA-Z0-9_-]{11}$/.test(value) ? value : null;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSearchNoise(value: string): string {
  return value
    .replace(/[|｜].*$/u, " ")
    .replace(/\b(?:official\s+)?(?:music\s+)?video\b/gi, " ")
    .replace(/\b(?:official\s+)?audio\b/gi, " ")
    .replace(/\blyrics?\b/gi, " ")
    .replace(/\bhd\b|\b4k\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTokens(value: string): string[] {
  const stopWords = new Set(["the", "and", "official", "audio", "video", "lyrics", "lyric", "music", "feat", "ft", "with"]);
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function queryWants(query: string, pattern: RegExp): boolean {
  return pattern.test(normalizeSearchText(query));
}

function scoreSearchCandidate(query: string, info: YtdlpInfo, expectedDurationSeconds?: number | null): number {
  const rawTitle = info.title || info.fulltitle || "";
  const title = normalizeSearchText(rawTitle);
  const channel = normalizeSearchText([info.uploader, info.channel, info.creator, info.artist].filter(Boolean).join(" "));
  const normalizedQuery = normalizeSearchText(query);
  const strippedQuery = normalizeSearchText(stripSearchNoise(query));
  const tokens = searchTokens(strippedQuery || normalizedQuery);
  const matched = tokens.filter((token) => title.includes(token) || channel.includes(token)).length;
  let score = matched * 18;

  if (tokens.length > 0) score += (matched / tokens.length) * 90;
  if (strippedQuery && title.includes(strippedQuery)) score += 75;
  if (normalizedQuery && title.includes(normalizedQuery)) score += 55;

  const artistTitle = /^(.*?)\s+-\s+(.*)$/.exec(stripSearchNoise(query));
  if (artistTitle?.[1] && artistTitle[2]) {
    const artist = normalizeSearchText(artistTitle[1]);
    const song = normalizeSearchText(artistTitle[2]);
    if (artist && (title.includes(artist) || channel.includes(artist))) score += 35;
    if (song && title.includes(song)) score += 45;
  }

  if (/\bofficial audio\b|\baudio only\b/.test(title)) score += 14;
  if (/\btopic\b/.test(channel)) score += 22;
  if (/\bprovided to youtube\b/.test(title)) score += 10;

  if (!queryWants(query, /\blyrics?\b/) && /\blyrics?\b|lyric video/.test(title)) score -= 10;
  if (!queryWants(query, /\bremix\b/) && /\bremix\b/.test(title)) score -= 18;
  if (!queryWants(query, /\bcover\b/) && /\bcover\b|karaoke|instrumental/.test(title)) score -= 28;
  if (!queryWants(query, /\blive\b/) && /\blive\b|concert|performance/.test(title)) score -= 22;
  if (!queryWants(query, /sped|slowed|nightcore|8d|bass/) && /sped up|slowed|nightcore|8d|bass boosted|reverb/.test(title)) score -= 35;
  if (!queryWants(query, /extended|hour|loop/) && /1 hour|10 hours|looped|extended/.test(title)) score -= 35;
  if (/reaction|tutorial|how to|review|full album/.test(title)) score -= 45;

  if (info.is_live || info.live_status === "is_live") score -= 120;
  if (info.availability && info.availability !== "public") score -= 25;

  if (typeof info.duration === "number" && info.duration > 0) {
    if (expectedDurationSeconds && expectedDurationSeconds > 0) {
      const diff = Math.abs(info.duration - expectedDurationSeconds);
      if (diff <= 2) score += 55;
      else if (diff <= 5) score += 45;
      else if (diff <= 15) score += 25;
      else if (diff <= 30) score += 10;
      else score -= Math.min(55, diff / 4);
    }

    if (info.duration > 12 * 60 && !queryWants(query, /mix|album|extended|hour|loop/)) score -= 30;
    if (info.duration < 45 && !queryWants(query, /short|intro|interlude/)) score -= 12;
  }

  if (typeof info.view_count === "number" && info.view_count > 0) {
    score += Math.min(14, Math.log10(info.view_count));
  }

  return score;
}

function parseExtractorSearchQuery(value: string): string | null {
  const match = /^(?:ytsearch|ytsearchdate)\d*:(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function uniqueInfos(entries: YtdlpInfo[]): YtdlpInfo[] {
  const seen = new Set<string>();
  const unique: YtdlpInfo[] = [];

  for (const entry of entries) {
    const key = youtubeVideoId(entry.id) ?? entry.webpage_url ?? entry.url ?? entry.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function looksLikeWebpageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  } catch {
    return true;
  }
}

function makeTrackUrl(info: YtdlpInfo): string | null {
  if (info.webpage_url) return info.webpage_url;
  if (info.original_url && isUrl(info.original_url)) return info.original_url;
  const id = youtubeVideoId(info.id) ?? (isYoutubeExtractor(info) ? youtubeVideoId(info.url) : null);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  if (info.url && isUrl(info.url)) return info.url;
  return null;
}

function getStreamExpiry(streamUrl: string): number | undefined {
  try {
    const parsed = new URL(streamUrl);
    const expire = parsed.searchParams.get("expire");
    if (!expire) return Date.now() + STREAM_FALLBACK_EXPIRY_MS;
    const seconds = Number(expire);
    return Number.isFinite(seconds) ? seconds * 1000 : Date.now() + STREAM_FALLBACK_EXPIRY_MS;
  } catch {
    return undefined;
  }
}

function getBestThumbnail(info: YtdlpInfo): string | undefined {
  if (info.thumbnail) return info.thumbnail;
  const thumbnails = info.thumbnails?.filter((thumbnail) => thumbnail.url) ?? [];
  thumbnails.sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)));
  return thumbnails[0]?.url;
}

function getDirectStreamUrl(info: YtdlpInfo): string | undefined {
  const requested = info.requested_downloads?.find((download) => download.url && isUrl(download.url));
  if (requested?.url) return requested.url;

  if (info.url && isUrl(info.url) && !looksLikeWebpageUrl(info.url)) {
    return info.url;
  }

  return undefined;
}

function cloneForRequester(track: Track, options: ResolveOptions): Track {
  return {
    ...track,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    requestedBy: options.requestedBy,
    requesterTag: options.requesterTag,
    createdAt: Date.now()
  };
}

interface CreateTrackOverrides {
  source?: string;
  playbackTarget?: string;
  originProvider?: "Spotify" | "SoundCloud";
}

function createTrack(info: YtdlpInfo, options: ResolveOptions, overrides: CreateTrackOverrides = {}): Track | null {
  const url = makeTrackUrl(info);
  if (!url) return null;

  const title = info.title || info.fulltitle || basename(url).replaceAll("%20", " ") || "Unknown title";
  const seconds = typeof info.duration === "number" && Number.isFinite(info.duration) ? Math.max(0, Math.floor(info.duration)) : null;
  const rawSource = info.extractor_key || info.extractor || info.ie_key || new URL(url).hostname.replace(/^www\./, "");
  const lowerSource = rawSource.toLowerCase();
  const source = overrides.source ?? (lowerSource.includes("soundcloud") ? "SoundCloud" : lowerSource.includes("youtube") ? "YouTube" : rawSource);
  const isLive = Boolean(info.is_live || info.live_status === "is_live");
  const streamUrl = getDirectStreamUrl(info);

  const track: Track = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    url,
    duration: isLive ? "Live" : formatTime(seconds),
    durationSeconds: isLive ? null : seconds,
    thumbnail: getBestThumbnail(info),
    requestedBy: options.requestedBy,
    requesterTag: options.requesterTag,
    source,
    isLive,
    createdAt: Date.now(),
    streamUrl,
    streamExpiresAt: streamUrl ? getStreamExpiry(streamUrl) : undefined
  };

  const playbackTarget = overrides.playbackTarget ?? (source === "SoundCloud" && isSoundCloudUrl(url) ? url : undefined);
  if (playbackTarget) track.playbackTarget = playbackTarget;
  if (overrides.originProvider) track.originProvider = overrides.originProvider;

  return track;
}

export class YtdlpExtractor implements Extractor {
  private readonly cache = new Map<string, CachedResult>();
  private readonly metadataResolver = new UrlMetadataResolver();

  public async resolve(query: string, options: ResolveOptions): Promise<Track[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) throw new Error("Search query cannot be empty.");

    if (isUrl(cleanQuery) && DIRECT_AUDIO_RE.test(cleanQuery)) {
      return [this.directTrack(cleanQuery, options)];
    }

    const cacheKey = cleanQuery.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.tracks.map((track) => cloneForRequester(track, options));
    }

    const soundCloudSearch = parseSoundCloudSearch(cleanQuery);
    if (soundCloudSearch) {
      try {
        const tracks = await this.resolveSoundCloudSearch(soundCloudSearch, options);
        if (tracks.length === 0) throw new Error("No playable SoundCloud results were found.");
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          tracks
        });
        return tracks;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Native SoundCloud search failed", message);
        throw new Error(`I could not find a playable SoundCloud result for that search. ${message}`);
      }
    }

    if (isSoundCloudUrl(cleanQuery)) {
      try {
        const tracks = await this.resolveSoundCloudUrl(cleanQuery, options);
        if (tracks.length === 0) throw new Error("SoundCloud returned no playable public tracks.");
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          tracks
        });
        return tracks;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("Native SoundCloud extraction failed", message);
        throw new Error(`I could not resolve that public SoundCloud URL directly with yt-dlp. ${message}`);
      }
    }

    const metadataResult = await this.metadataResolver.resolve(cleanQuery);
    if (metadataResult) {
      const tracks = metadataResult.tracks
        .map((track) => this.metadataTrack(track, options))
        .slice(0, config.maxPlaylistSize);
      if (tracks.length === 0) throw new Error(`${metadataResult.provider} returned no usable metadata.`);
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        tracks
      });
      return tracks;
    }

    const tracks = looksLikePlaylist(cleanQuery)
      ? await this.resolvePlaylistThenFallback(cleanQuery, options)
      : isUrl(cleanQuery) || extractorSearchTarget(cleanQuery)
        ? await this.resolveSingle(cleanQuery, options)
        : await this.resolveYoutubeSearch(cleanQuery, options);

    if (tracks.length > 0 && !looksLikePlaylist(cleanQuery)) {
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        tracks
      });
    }

    return tracks;
  }

  public async createPlaybackStream(track: Track): Promise<PlaybackStream> {
    const streamUrl = await this.getFreshStreamUrl(track);

    const ffmpeg = spawn(config.ffmpegBinary, [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-nostdin",
      "-fflags",
      "+genpts+discardcorrupt",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_at_eof",
      "1",
      "-reconnect_delay_max",
      "10",
      "-rw_timeout",
      "15000000",
      "-i",
      streamUrl,
      "-vn",
      "-map",
      "0:a:0",
      "-af",
      "aresample=async=1000:first_pts=0",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-vbr",
      "on",
      "-compression_level",
      "5",
      "-application",
      "audio",
      "-frame_duration",
      "20",
      "-f",
      "opus",
      "pipe:1"
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stderrChunks: string[] = [];
    this.captureErrors(ffmpeg, "ffmpeg", stderrChunks);

    const cleanup = (): void => {
      this.killProcess(ffmpeg);
    };

    ffmpeg.once("spawn", () => logger.debug(`Started FFmpeg Opus stream for ${track.title}`));
    ffmpeg.once("error", cleanup);

    return {
      stream: ffmpeg.stdout as Readable,
      cleanup
    };
  }

  private async resolveSoundCloudSearch(query: string, options: ResolveOptions): Promise<Track[]> {
    const info = await this.runJson([
      "--flat-playlist",
      "--playlist-end",
      "10",
      "--dump-single-json",
      `scsearch10:${query}`
    ], 30_000);

    const entries = Array.isArray(info.entries) ? info.entries : [];
    const ranked = entries
      .filter((entry) => !entry.is_live && entry.live_status !== "is_live")
      .sort((a, b) => scoreSearchCandidate(query, b) - scoreSearchCandidate(query, a));

    const selected = ranked[0] ?? entries[0];
    if (!selected) return [];

    const selectedTarget = makeTrackUrl(selected);
    if (selectedTarget && isSoundCloudUrl(selectedTarget)) {
      try {
        return await this.resolveSoundCloudUrl(selectedTarget, options);
      } catch (error) {
        logger.debug("Could not hydrate SoundCloud search result before playback", error instanceof Error ? error.message : String(error));
      }
    }

    const track = createTrack(selected, options, {
      source: "SoundCloud",
      playbackTarget: selectedTarget ?? undefined,
      originProvider: "SoundCloud"
    });
    return track ? [track] : [];
  }

  private async resolveSoundCloudUrl(query: string, options: ResolveOptions): Promise<Track[]> {
    if (isSoundCloudPlaylistUrl(query)) {
      const playlist = await this.resolveSoundCloudPlaylist(query, options);
      if (playlist.length > 0) return playlist;
    }

    const info = await this.runJson([
      "--no-playlist",
      "--skip-download",
      "--format",
      "bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
      "--dump-single-json",
      query
    ], 25_000);

    const candidate = Array.isArray(info.entries) ? info.entries[0] : info;
    const track = candidate ? createTrack(candidate, options, {
      source: "SoundCloud",
      playbackTarget: query,
      originProvider: "SoundCloud"
    }) : null;
    return track ? [track] : [];
  }

  private async resolveSoundCloudPlaylist(query: string, options: ResolveOptions): Promise<Track[]> {
    try {
      const info = await this.runJson([
        "--flat-playlist",
        "--playlist-end",
        String(config.maxPlaylistSize),
        "--dump-single-json",
        query
      ], 45_000);

      const entries = Array.isArray(info.entries) ? info.entries : [];
      return entries
        .map((entry) => createTrack(entry, options, {
          source: "SoundCloud",
          playbackTarget: makeTrackUrl(entry) ?? query,
          originProvider: "SoundCloud"
        }))
        .filter((track): track is Track => Boolean(track))
        .slice(0, config.maxPlaylistSize);
    } catch (error) {
      logger.warn("SoundCloud playlist extraction failed; falling back to single track mode", error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private async resolveYoutubeSearch(query: string, options: ResolveOptions): Promise<Track[]> {
    try {
      const selected = await this.selectBestYoutubeCandidate(query);
      const selectedUrl = selected ? makeTrackUrl(selected) : null;
      const track = selected ? createTrack(selected, options, { playbackTarget: selectedUrl ?? undefined }) : null;
      if (track) return [track];
    } catch (error) {
      logger.debug("Smart YouTube search failed; falling back to detailed search", error instanceof Error ? error.message : String(error));
    }

    return this.resolveSingle(query, options);
  }

  private async selectBestYoutubeCandidate(query: string, expectedDurationSeconds?: number | null): Promise<YtdlpInfo | null> {
    const variants = this.youtubeSearchVariants(query);
    const results = await Promise.allSettled(
      variants.map((variant) => this.runJson([
        "--flat-playlist",
        "--playlist-end",
        String(YOUTUBE_SEARCH_CANDIDATES),
        "--dump-single-json",
        `ytsearch${YOUTUBE_SEARCH_CANDIDATES}:${variant}`
      ], YOUTUBE_SEARCH_TIMEOUT_MS))
    );

    const entries = uniqueInfos(results.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      return Array.isArray(result.value.entries) ? result.value.entries : [];
    }));

    const ranked = entries
      .filter((entry) => !entry.is_live && entry.live_status !== "is_live")
      .sort((a, b) => scoreSearchCandidate(query, b, expectedDurationSeconds) - scoreSearchCandidate(query, a, expectedDurationSeconds));

    return ranked[0] ?? entries[0] ?? null;
  }

  private youtubeSearchVariants(query: string): string[] {
    const base = query.replace(/^ytsearch\d*:/i, "").trim();
    const stripped = stripSearchNoise(base);
    const variants = [base];

    if (stripped && normalizeSearchText(stripped) !== normalizeSearchText(base)) variants.push(stripped);
    if (stripped && !/\bofficial\b|\baudio\b|\blyrics?\b|\bvideo\b/i.test(base)) variants.push(`${stripped} official audio`);

    const artistTitle = /^(.*?)\s+-\s+(.*)$/.exec(stripped);
    if (artistTitle?.[1] && artistTitle[2]) {
      variants.push(`${artistTitle[1]} ${artistTitle[2]}`.trim());
    }

    const seen = new Set<string>();
    return variants
      .map((variant) => variant.replace(/\s+/g, " ").trim())
      .filter((variant) => {
        const key = normalizeSearchText(variant);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }

  private async resolveSingle(query: string, options: ResolveOptions): Promise<Track[]> {
    const target = isUrl(query) || extractorSearchTarget(query) ? query : `ytsearch1:${query}`;
    const info = await this.runJson([
      "--no-playlist",
      "--default-search",
      "ytsearch",
      "--skip-download",
      "--format",
      "bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
      "--dump-single-json",
      target
    ]);

    const candidate = Array.isArray(info.entries) ? info.entries[0] : info;
    if (!candidate) return [];

    const track = createTrack(candidate, options);
    return track ? [track] : [];
  }

  private async resolvePlaylistThenFallback(query: string, options: ResolveOptions): Promise<Track[]> {
    const playlist = await this.resolvePlaylist(query, options);
    if (playlist.length > 0) return playlist;
    return this.resolveSingle(query, options);
  }

  private async resolvePlaylist(query: string, options: ResolveOptions): Promise<Track[]> {
    try {
      const info = await this.runJson([
        "--flat-playlist",
        "--playlist-end",
        String(config.maxPlaylistSize),
        "--dump-single-json",
        query
      ]);

      const entries = Array.isArray(info.entries) ? info.entries : [];
      return entries
        .map((entry) => createTrack(entry, options))
        .filter((track): track is Track => Boolean(track))
        .slice(0, config.maxPlaylistSize);
    } catch (error) {
      logger.warn("Playlist extraction failed; falling back to single track mode", error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  private metadataTrack(input: MetadataTrackInput, options: ResolveOptions): Track {
    const displayTitle = input.artist && !input.title.toLowerCase().includes(input.artist.toLowerCase())
      ? `${input.artist} - ${input.title}`
      : input.title;

    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      title: displayTitle,
      url: input.url,
      duration: formatTime(input.durationSeconds),
      durationSeconds: input.durationSeconds,
      thumbnail: input.thumbnail,
      requestedBy: options.requestedBy,
      requesterTag: options.requesterTag,
      source: input.source,
      isLive: false,
      createdAt: Date.now(),
      playbackTarget: `ytsearch${YOUTUBE_SEARCH_CANDIDATES}:${input.playbackSearch}`,
      originProvider: input.source.startsWith("Spotify") ? "Spotify" : "SoundCloud"
    };
  }

  private directTrack(url: string, options: ResolveOptions): Track {
    const parsed = new URL(url);
    const title = decodeURIComponent(basename(parsed.pathname)) || parsed.hostname;
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      title,
      url,
      duration: "Live / unknown",
      durationSeconds: null,
      requestedBy: options.requestedBy,
      requesterTag: options.requesterTag,
      source: parsed.hostname.replace(/^www\./, ""),
      isLive: false,
      createdAt: Date.now(),
      streamUrl: url
    };
  }

  private async getFreshStreamUrl(track: Track): Promise<string> {
    if (track.streamUrl && (!track.streamExpiresAt || track.streamExpiresAt - Date.now() > STREAM_REFRESH_SAFETY_MS)) {
      return track.streamUrl;
    }

    let playbackTarget = track.playbackTarget ?? track.url;
    const youtubeSearch = parseExtractorSearchQuery(playbackTarget);
    if (youtubeSearch) {
      const selected = await this.selectBestYoutubeCandidate(youtubeSearch, track.durationSeconds);
      const selectedUrl = selected ? makeTrackUrl(selected) : null;
      if (selectedUrl) {
        playbackTarget = selectedUrl;
        track.playbackTarget = selectedUrl;
      }
    }

    if (DIRECT_AUDIO_RE.test(playbackTarget)) return playbackTarget;

    const { stdout } = await execFileAsync(config.ytdlpBinary, [
      "--no-warnings",
      "--no-playlist",
      "--playlist-items",
      "1",
      "--quiet",
      "--force-ipv4",
      "--socket-timeout",
      "12",
      "--format",
      "bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
      "--get-url",
      playbackTarget
    ], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024
    });

    const streamUrl = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => isUrl(line));
    if (!streamUrl) throw new Error("yt-dlp did not return a playable stream URL.");

    track.streamUrl = streamUrl;
    track.streamExpiresAt = getStreamExpiry(streamUrl);
    return streamUrl;
  }

  private async runJson(args: string[], timeoutMs = 20_000): Promise<YtdlpInfo> {
    const { stdout } = await execFileAsync(config.ytdlpBinary, [
      "--no-warnings",
      "--quiet",
      "--force-ipv4",
      "--socket-timeout",
      "12",
      ...args
    ], {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024
    });

    const trimmed = stdout.trim();
    if (!trimmed) throw new Error("yt-dlp returned no data.");
    return JSON.parse(trimmed) as YtdlpInfo;
  }

  private captureErrors(child: { stderr: Readable }, name: string, chunks: string[]): void {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (!text) return;
      chunks.push(text);
      logger.debug(`${name}: ${text}`);
    });
  }

  private killProcess(child: { killed: boolean; kill: (signal: NodeJS.Signals) => boolean }): void {
    if (child.killed) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }
}
