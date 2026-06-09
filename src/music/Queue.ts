import { Track } from "./Track";

export class Queue {
  private readonly tracks: Track[] = [];

  public add(track: Track): void {
    this.tracks.push(track);
  }

  public prepend(track: Track): void {
    this.tracks.unshift(track);
  }

  public addMany(tracks: Track[]): void {
    this.tracks.push(...tracks);
  }

  public shift(): Track | undefined {
    return this.tracks.shift();
  }

  public clear(): void {
    this.tracks.length = 0;
  }

  public remove(position: number): Track | null {
    const index = position - 1;
    if (index < 0 || index >= this.tracks.length) return null;
    const [removed] = this.tracks.splice(index, 1);
    return removed ?? null;
  }

  public shuffle(): void {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j]!, this.tracks[i]!];
    }
  }

  public all(): readonly Track[] {
    return this.tracks;
  }

  public size(): number {
    return this.tracks.length;
  }

  public isEmpty(): boolean {
    return this.tracks.length === 0;
  }
}
