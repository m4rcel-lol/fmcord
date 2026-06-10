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

function looksLikePlaylist(value: string): boolean {
  if (!isUrl(value)) return false;
  const lowered = value.toLowerCase();
  return lowered.includes("list=") || lowered.includes("/playlist");
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

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !["the", "and", "official", "audio", "video", "lyrics", "lyric"].includes(token));
}

function scoreSearchCandidate(query: string, info: YtdlpInfo): number {
  const title = (info.title || info.fulltitle || "").toLowerCase();
  const tokens = searchTokens(query);
  const matched = tokens.filter((token) => title.includes(token)).length;
  let score = matched * 10;

  if (/official audio|topic|provided to youtube/i.test(title)) score += 4;
  if (/lyrics?|sped up|slowed|nightcore|8d|bass boosted|remix|cover|karaoke/i.test(title)) score -= 3;
  if (info.is_live || info.live_status === "is_live") score -= 20;
  if (typeof info.duration === "number" && info.duration > 0) {
    if (info.duration > 20 * 60) score -= 10;
    if (info.duration < 45) score -= 3;
  }

  return score;
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

function createTrack(info: YtdlpInfo, options: ResolveOptions): Track | null {
  const url = makeTrackUrl(info);
  if (!url) return null;

  const title = info.title || info.fulltitle || basename(url).replaceAll("%20", " ") || "Unknown title";
  const seconds = typeof info.duration === "number" && Number.isFinite(info.duration) ? Math.max(0, Math.floor(info.duration)) : null;
  const source = info.extractor_key || info.extractor || info.ie_key || new URL(url).hostname.replace(/^www\./, "");
  const isLive = Boolean(info.is_live || info.live_status === "is_live");
  const streamUrl = getDirectStreamUrl(info);

  return {
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

  private async resolveYoutubeSearch(query: string, options: ResolveOptions): Promise<Track[]> {
    try {
      const info = await this.runJson([
        "--flat-playlist",
        "--playlist-end",
        "5",
        "--dump-single-json",
        `ytsearch5:${query}`
      ]);

      const entries = Array.isArray(info.entries) ? info.entries : [];
      const ranked = entries
        .filter((entry) => !entry.is_live && entry.live_status !== "is_live")
        .sort((a, b) => scoreSearchCandidate(query, b) - scoreSearchCandidate(query, a));

      const selected = ranked[0] ?? entries[0];
      const track = selected ? createTrack(selected, options) : null;
      if (track) return [track];
    } catch (error) {
      logger.debug("Fast YouTube search failed; falling back to detailed search", error instanceof Error ? error.message : String(error));
    }

    return this.resolveSingle(query, options);
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
      playbackTarget: `ytsearch1:${input.playbackSearch}`,
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

    const playbackTarget = track.playbackTarget ?? track.url;

    if (DIRECT_AUDIO_RE.test(playbackTarget)) return playbackTarget;

    const { stdout } = await execFileAsync(config.ytdlpBinary, [
      "--no-warnings",
      "--no-playlist",
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

  private async runJson(args: string[]): Promise<YtdlpInfo> {
    const { stdout } = await execFileAsync(config.ytdlpBinary, [
      "--no-warnings",
      "--quiet",
      "--force-ipv4",
      "--socket-timeout",
      "12",
      ...args
    ], {
      timeout: 20_000,
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
