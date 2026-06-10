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
   * Optional direct media URL resolved by yt-dlp during extraction.
   * When present and fresh, playback can start without spawning yt-dlp again.
   */
  streamUrl?: string;
  streamExpiresAt?: number;
}

export type LoopMode = "off" | "track" | "queue";
