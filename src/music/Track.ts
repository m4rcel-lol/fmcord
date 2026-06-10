export interface Track {
  id: string;
  title: string;
  url: string;
  duration: string;
  durationSeconds: number | null;
  thumbnail?: string;
  requestedBy: string;
  requesterTag: string;
  source: string;
  isLive: boolean;
  createdAt: number;

  /**
   * Optional direct media URL resolved by yt-dlp during search/metadata extraction.
   * When present and fresh, playback can start with FFmpeg directly instead of
   * spawning yt-dlp a second time.
   */
  streamUrl?: string;
  streamExpiresAt?: number;

  /**
   * Optional extractor/search target used for playback when the public display URL
   * points to a metadata source such as Spotify.
   */
  playbackUrl?: string;

  /** Original metadata provider for display/debugging, e.g. Spotify. */
  metadataSource?: string;
}

export type LoopMode = "off" | "track" | "queue";
