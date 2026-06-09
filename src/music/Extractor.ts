import { Readable } from "node:stream";
import { Track } from "./Track";

export interface ResolveOptions {
  requestedBy: string;
  requesterTag: string;
}

export interface PlaybackStream {
  stream: Readable;
  cleanup: () => void;
}

export interface Extractor {
  resolve(query: string, options: ResolveOptions): Promise<Track[]>;
  createPlaybackStream(track: Track): Promise<PlaybackStream>;
}
