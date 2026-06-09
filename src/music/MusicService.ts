import {
  AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  StreamType,
  VoiceConnection,
  VoiceConnectionStatus
} from "@discordjs/voice";
import {
  ChatInputCommandInteraction,
  Client,
  GuildMember,
  VoiceBasedChannel
} from "discord.js";
import { config } from "../config";
import { logger } from "../logger";
import { errorEmbed, infoEmbed, safeText, successEmbed, warningEmbed } from "../utils/embeds";
import { getMemberVoiceChannel, assertVoicePermissions, UserFacingError } from "../utils/permissions";
import { Queue } from "./Queue";
import { makeProgressBar } from "./progress";
import { LoopMode, Track } from "./Track";
import { YtdlpExtractor } from "./YtdlpExtractor";

interface GuildSession {
  guildId: string;
  queue: Queue;
  player: AudioPlayer;
  connection: VoiceConnection | null;
  current: Track | null;
  loopMode: LoopMode;
  volume: number;
  textChannelId: string | null;
  voiceChannelId: string | null;
  idleTimer: NodeJS.Timeout | null;
  emptyTimer: NodeJS.Timeout | null;
  cleanupStream: (() => void) | null;
  currentStartedAt: number | null;
  pausedAt: number | null;
  totalPausedMs: number;
  skipRequested: boolean;
}

export interface PlayResult {
  tracks: Track[];
  startedImmediately: boolean;
  queuePosition: number;
}

export interface NowPlayingInfo {
  track: Track;
  elapsedSeconds: number;
  progress: string;
  loopMode: LoopMode;
  volume: number;
}

export class MusicService {
  private readonly sessions = new Map<string, GuildSession>();
  private readonly extractor = new YtdlpExtractor();
  private client: Client | null = null;

  public init(client: Client): void {
    this.client = client;
  }

  public getSession(guildId: string): GuildSession | null {
    return this.sessions.get(guildId) ?? null;
  }

  public async play(interaction: ChatInputCommandInteraction, query: string): Promise<PlayResult> {
    if (!interaction.guild) throw new UserFacingError("This command can only be used inside a server.");
    const voiceChannel = getMemberVoiceChannel(interaction);
    assertVoicePermissions(interaction, voiceChannel);

    const session = this.getOrCreateSession(interaction.guild.id);
    await this.ensureConnection(interaction, voiceChannel, session);
    session.textChannelId = interaction.channelId;

    const tracks = await this.extractor.resolve(query, {
      requestedBy: interaction.user.id,
      requesterTag: interaction.user.tag
    });

    if (tracks.length === 0) throw new UserFacingError("No playable results were found.");
    if (session.queue.size() + tracks.length > config.maxQueueSize) {
      throw new UserFacingError(`The queue limit is ${config.maxQueueSize} tracks. Try a shorter playlist or clear the queue.`);
    }

    const startedImmediately = !session.current && session.queue.isEmpty() && session.player.state.status !== AudioPlayerStatus.Playing;
    const queuePosition = startedImmediately ? 0 : session.queue.size() + 1;
    session.queue.addMany(tracks);

    this.clearIdleTimer(session);
    this.clearEmptyTimer(session);

    if (!session.current && session.player.state.status !== AudioPlayerStatus.Playing) {
      await this.startNext(session);
    }

    return { tracks, startedImmediately, queuePosition };
  }

  public pause(guildId: string): boolean {
    const session = this.requireSession(guildId);
    const paused = session.player.pause(true);
    if (paused) session.pausedAt = Date.now();
    return paused;
  }

  public resume(guildId: string): boolean {
    const session = this.requireSession(guildId);
    if (session.pausedAt) {
      session.totalPausedMs += Date.now() - session.pausedAt;
      session.pausedAt = null;
    }
    return session.player.unpause();
  }

  public skip(guildId: string): void {
    const session = this.requireSession(guildId);
    if (!session.current) throw new UserFacingError("Nothing is playing right now.");
    session.skipRequested = true;
    session.player.stop(true);
  }

  public stop(guildId: string): void {
    const session = this.requireSession(guildId);
    session.queue.clear();
    session.current = null;
    session.skipRequested = true;
    session.cleanupStream?.();
    session.cleanupStream = null;
    session.player.stop(true);
    this.scheduleIdleDisconnect(session);
  }

  public disconnect(guildId: string): void {
    const session = this.requireSession(guildId);
    this.destroySession(session);
  }

  public clearQueue(guildId: string): number {
    const session = this.requireSession(guildId);
    const count = session.queue.size();
    session.queue.clear();
    return count;
  }

  public shuffle(guildId: string): number {
    const session = this.requireSession(guildId);
    const count = session.queue.size();
    session.queue.shuffle();
    return count;
  }

  public remove(guildId: string, position: number): Track {
    const session = this.requireSession(guildId);
    const removed = session.queue.remove(position);
    if (!removed) throw new UserFacingError("That queue position does not exist.");
    return removed;
  }

  public setVolume(guildId: string, volume: number): void {
    const session = this.requireSession(guildId);
    session.volume = volume;
    const resource = session.player.state.status !== AudioPlayerStatus.Idle ? session.player.state.resource : null;
    resource?.volume?.setVolume(volume / 100);
  }

  public setLoopMode(guildId: string, mode: LoopMode): void {
    const session = this.requireSession(guildId);
    session.loopMode = mode;
  }

  public getQueue(guildId: string): readonly Track[] {
    return this.requireSession(guildId).queue.all();
  }

  public getCurrent(guildId: string): Track | null {
    return this.sessions.get(guildId)?.current ?? null;
  }

  public getLoopMode(guildId: string): LoopMode {
    return this.sessions.get(guildId)?.loopMode ?? "off";
  }

  public getVolume(guildId: string): number {
    return this.sessions.get(guildId)?.volume ?? config.defaultVolume;
  }

  public getNowPlaying(guildId: string): NowPlayingInfo | null {
    const session = this.sessions.get(guildId);
    if (!session?.current) return null;

    const now = session.pausedAt ?? Date.now();
    const elapsedMs = session.currentStartedAt ? now - session.currentStartedAt - session.totalPausedMs : 0;
    const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

    return {
      track: session.current,
      elapsedSeconds,
      progress: makeProgressBar(elapsedSeconds, session.current.durationSeconds),
      loopMode: session.loopMode,
      volume: session.volume
    };
  }

  public ensureUserInSameVoice(interaction: ChatInputCommandInteraction): void {
    if (!interaction.guild) throw new UserFacingError("This command can only be used inside a server.");
    const session = this.sessions.get(interaction.guild.id);
    if (!session?.voiceChannelId) return;

    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const userChannelId = member?.voice.channelId;
    if (!userChannelId) throw new UserFacingError("You must be in my voice channel to control playback.");
    if (userChannelId !== session.voiceChannelId) {
      throw new UserFacingError("You must be in the same voice channel as me to control playback.");
    }
  }

  public handleVoiceStateUpdate(guildId: string): void {
    const session = this.sessions.get(guildId);
    if (!session?.voiceChannelId) return;

    const guild = this.client?.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(session.voiceChannelId);
    const members = (channel as { members?: { filter?: (predicate: (member: GuildMember) => boolean) => { size: number } } } | undefined)?.members;
    if (!members?.filter) return;

    const humans = members.filter((member: GuildMember) => !member.user.bot).size;
    if (humans === 0) {
      this.scheduleEmptyDisconnect(session);
    } else {
      this.clearEmptyTimer(session);
    }
  }

  private getOrCreateSession(guildId: string): GuildSession {
    const existing = this.sessions.get(guildId);
    if (existing) return existing;

    const session: GuildSession = {
      guildId,
      queue: new Queue(),
      player: createAudioPlayer(),
      connection: null,
      current: null,
      loopMode: "off",
      volume: config.defaultVolume,
      textChannelId: null,
      voiceChannelId: null,
      idleTimer: null,
      emptyTimer: null,
      cleanupStream: null,
      currentStartedAt: null,
      pausedAt: null,
      totalPausedMs: 0,
      skipRequested: false
    };

    session.player.on(AudioPlayerStatus.Idle, () => {
      void this.handleTrackEnd(session);
    });

    session.player.on("error", (error) => {
      logger.warn(`Audio player error in guild ${guildId}`, error.message);
      void this.sendToTextChannel(session, warningEmbed("Playback error", "The current track failed. I will try the next one."));
      session.skipRequested = true;
      session.player.stop(true);
    });

    this.sessions.set(guildId, session);
    return session;
  }

  private requireSession(guildId: string): GuildSession {
    const session = this.sessions.get(guildId);
    if (!session) throw new UserFacingError("I am not playing anything in this server.");
    return session;
  }

  private async ensureConnection(
    interaction: ChatInputCommandInteraction,
    channel: VoiceBasedChannel,
    session: GuildSession
  ): Promise<void> {
    const existing = session.connection ?? getVoiceConnection(channel.guild.id) ?? null;
    if (existing && session.voiceChannelId && session.voiceChannelId !== channel.id) {
      throw new UserFacingError("I am already connected to another voice channel in this server.");
    }

    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      session.connection = existing;
      session.connection.subscribe(session.player);
      return;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true
    });

    session.connection = connection;
    session.voiceChannelId = channel.id;
    connection.subscribe(session.player);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
        ]);
      } catch {
        this.destroySession(session);
      }
    });

    connection.on("error", (error) => {
      logger.warn(`Voice connection error in guild ${interaction.guildId}`, error.message);
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      this.destroySession(session);
      throw new UserFacingError("I could not connect to the voice channel. Check my permissions and try again.");
    }
  }

  private async startNext(session: GuildSession): Promise<void> {
    this.clearIdleTimer(session);
    this.clearEmptyTimer(session);

    const next = session.queue.shift();
    if (!next) {
      session.current = null;
      this.scheduleIdleDisconnect(session);
      return;
    }

    session.current = next;
    session.currentStartedAt = Date.now();
    session.totalPausedMs = 0;
    session.pausedAt = null;
    session.skipRequested = false;

    try {
      session.cleanupStream?.();
      const playback = await this.extractor.createPlaybackStream(next);
      session.cleanupStream = playback.cleanup;
      const resource = createAudioResource(playback.stream, {
        inputType: StreamType.Raw,
        inlineVolume: true
      });
      resource.volume?.setVolume(session.volume / 100);
      session.player.play(resource);

      await this.sendToTextChannel(
        session,
        infoEmbed("Now playing", `[${safeText(next.title, 180)}](${next.url})`)
          .addFields(
            { name: "Duration", value: next.duration, inline: true },
            { name: "Requested by", value: `<@${next.requestedBy}>`, inline: true },
            { name: "Source", value: safeText(next.source, 64), inline: true }
          )
          .setThumbnail(next.thumbnail ?? null)
      );
    } catch (error) {
      logger.warn(`Could not start track in guild ${session.guildId}`, error instanceof Error ? error.message : String(error));
      await this.sendToTextChannel(
        session,
        warningEmbed("Track failed", `I could not play **${safeText(next.title, 120)}**. Trying the next track.`)
      );
      session.current = null;
      await this.startNext(session);
    }
  }

  private async handleTrackEnd(session: GuildSession): Promise<void> {
    const finished = session.current;
    session.cleanupStream?.();
    session.cleanupStream = null;

    if (!finished) {
      this.scheduleIdleDisconnect(session);
      return;
    }

    if (!session.skipRequested) {
      if (session.loopMode === "track") {
        session.queue.prepend({ ...finished, id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` });
      } else if (session.loopMode === "queue") {
        session.queue.add({ ...finished, id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` });
      }
    }

    session.current = null;
    session.skipRequested = false;
    await this.startNext(session);
  }

  private scheduleIdleDisconnect(session: GuildSession): void {
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      void this.sendToTextChannel(session, infoEmbed("Disconnected", "Queue ended and I was idle for too long."));
      this.destroySession(session);
    }, config.idleTimeoutSeconds * 1000);
  }

  private scheduleEmptyDisconnect(session: GuildSession): void {
    this.clearEmptyTimer(session);
    session.emptyTimer = setTimeout(() => {
      void this.sendToTextChannel(session, infoEmbed("Disconnected", "Everyone left the voice channel."));
      this.destroySession(session);
    }, config.leaveEmptyChannelSeconds * 1000);
  }

  private clearIdleTimer(session: GuildSession): void {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  private clearEmptyTimer(session: GuildSession): void {
    if (session.emptyTimer) clearTimeout(session.emptyTimer);
    session.emptyTimer = null;
  }

  private destroySession(session: GuildSession): void {
    this.clearIdleTimer(session);
    this.clearEmptyTimer(session);
    session.queue.clear();
    session.current = null;
    session.cleanupStream?.();
    session.cleanupStream = null;
    try {
      session.player.stop(true);
    } catch {
      // Already stopped.
    }
    try {
      session.connection?.destroy();
    } catch {
      // Already destroyed.
    }
    this.sessions.delete(session.guildId);
  }

  private async sendToTextChannel(session: GuildSession, embed: ReturnType<typeof successEmbed>): Promise<void> {
    if (!this.client || !session.textChannelId) return;

    try {
      const channel = await this.client.channels.fetch(session.textChannelId);
      if (!channel || !this.canSend(channel)) return;
      await channel.send({ embeds: [embed] });
    } catch (error) {
      logger.debug("Could not send music update", error instanceof Error ? error.message : String(error));
    }
  }

  private canSend(channel: unknown): channel is { send: (options: { embeds: ReturnType<typeof successEmbed>[] }) => Promise<unknown> } {
    return typeof channel === "object" && channel !== null && "send" in channel && typeof (channel as { send?: unknown }).send === "function";
  }
}

export const musicService = new MusicService();
