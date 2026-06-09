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
}

export type LoopMode = "off" | "track" | "queue";
