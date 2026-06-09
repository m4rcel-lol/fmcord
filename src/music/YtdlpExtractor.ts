import { execFile, spawn } from "node:child_process";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { config } from "../config";
import { logger } from "../logger";
import { formatTime } from "../utils/formatTime";
import { Extractor, PlaybackStream, ResolveOptions } from "./Extractor";
import { Track } from "./Track";

const execFileAsync = promisify(execFile);
const DIRECT_AUDIO_RE = /\.(mp3|wav|flac|m4a|aac|ogg|opus|webm)(\?.*)?$/i;

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
  extractor?: string;
  extractor_key?: string;
  live_status?: string;
  is_live?: boolean;
  entries?: YtdlpInfo[];
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
  return lowered.includes("list=") || lowered.includes("/playlist") || lowered.includes("/sets/");
}

function makeTrackUrl(info: YtdlpInfo): string | null {
  if (info.webpage_url) return info.webpage_url;
  if (info.original_url && isUrl(info.original_url)) return info.original_url;
  if (info.url && isUrl(info.url)) return info.url;
  if (info.id && (info.extractor_key?.toLowerCase() === "youtube" || info.extractor?.toLowerCase() === "youtube")) {
    return `https://www.youtube.com/watch?v=${info.id}`;
  }
  return null;
}

function createTrack(info: YtdlpInfo, options: ResolveOptions): Track | null {
  const url = makeTrackUrl(info);
  if (!url) return null;

  const title = info.title || info.fulltitle || basename(url).replaceAll("%20", " ") || "Unknown title";
  const seconds = typeof info.duration === "number" && Number.isFinite(info.duration) ? Math.max(0, Math.floor(info.duration)) : null;
  const source = info.extractor_key || info.extractor || new URL(url).hostname.replace(/^www\./, "");
  const isLive = Boolean(info.is_live || info.live_status === "is_live");

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    url,
    duration: isLive ? "Live" : formatTime(seconds),
    durationSeconds: isLive ? null : seconds,
    thumbnail: info.thumbnail,
    requestedBy: options.requestedBy,
    requesterTag: options.requesterTag,
    source,
    isLive,
    createdAt: Date.now()
  };
}

export class YtdlpExtractor implements Extractor {
  public async resolve(query: string, options: ResolveOptions): Promise<Track[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) throw new Error("Search query cannot be empty.");

    if (isUrl(cleanQuery) && DIRECT_AUDIO_RE.test(cleanQuery)) {
      return [this.directTrack(cleanQuery, options)];
    }

    if (looksLikePlaylist(cleanQuery)) {
      const playlist = await this.resolvePlaylist(cleanQuery, options);
      if (playlist.length > 0) return playlist;
    }

    return this.resolveSingle(cleanQuery, options);
  }

  public async createPlaybackStream(track: Track): Promise<PlaybackStream> {
    const ytdlp = spawn(config.ytdlpBinary, [
      "--no-warnings",
      "--no-playlist",
      "--quiet",
      "--force-ipv4",
      "-f",
      "bestaudio/best",
      "-o",
      "-",
      track.url
    ], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const ffmpeg = spawn(config.ffmpegBinary, [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-i",
      "pipe:0",
      "-vn",
      "-f",
      "s16le",
      "-ar",
      "48000",
      "-ac",
      "2",
      "pipe:1"
    ], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stderrChunks: string[] = [];
    this.captureErrors(ytdlp, "yt-dlp", stderrChunks);
    this.captureErrors(ffmpeg, "ffmpeg", stderrChunks);

    ytdlp.stdout.pipe(ffmpeg.stdin);
    ytdlp.stdout.on("error", () => undefined);
    ffmpeg.stdin.on("error", () => undefined);

    const cleanup = (): void => {
      ytdlp.stdout.unpipe(ffmpeg.stdin);
      this.killProcess(ytdlp);
      this.killProcess(ffmpeg);
    };

    ffmpeg.once("spawn", () => logger.debug(`Started FFmpeg stream for ${track.title}`));
    ffmpeg.once("error", cleanup);
    ytdlp.once("error", cleanup);

    return {
      stream: ffmpeg.stdout as Readable,
      cleanup
    };
  }

  private async resolveSingle(query: string, options: ResolveOptions): Promise<Track[]> {
    const target = isUrl(query) ? query : `ytsearch1:${query}`;
    const info = await this.runJson([
      "--no-warnings",
      "--no-playlist",
      "--default-search",
      "ytsearch",
      "-J",
      target
    ]);

    const candidate = Array.isArray(info.entries) ? info.entries[0] : info;
    if (!candidate) return [];

    const track = createTrack(candidate, options);
    return track ? [track] : [];
  }

  private async resolvePlaylist(query: string, options: ResolveOptions): Promise<Track[]> {
    try {
      const info = await this.runJson([
        "--no-warnings",
        "--flat-playlist",
        "--playlist-end",
        String(config.maxPlaylistSize),
        "-J",
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
      createdAt: Date.now()
    };
  }

  private async runJson(args: string[]): Promise<YtdlpInfo> {
    const { stdout } = await execFileAsync(config.ytdlpBinary, args, {
      timeout: 30_000,
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
