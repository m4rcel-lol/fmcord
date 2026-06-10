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
  EmbedBuilder,
  GuildMember,
  Message,
  VoiceBasedChannel
} from "discord.js";
import { config } from "../config";
import { logger } from "../logger";
import { formatTime } from "../utils/formatTime";
import { compactTrackLink, infoEmbed, nowPlayingEmbed, safeText, songTitlePrefix, statusPill, warningEmbed } from "../utils/embeds";
import { getMemberVoiceChannel, assertVoicePermissions, UserFacingError } from "../utils/permissions";
import { Queue } from "./Queue";
import { makeProgressBar, makeProgressCodeBlock } from "./progress";
import { LoopMode, Track } from "./Track";
import { YtdlpExtractor } from "./YtdlpExtractor";
import { fmEmoji } from "../utils/emojis";

const VOICE_STATUS_PERMISSION = 1n << 48n;
const NOW_PLAYING_UPDATE_SECONDS = config.livePanelUpdateSeconds;

interface SendableChannel {
  send: (options: { embeds: EmbedBuilder[] }) => Promise<Message | unknown>;
  messages?: {
    fetch: (messageId: string) => Promise<Message>;
  };
}

function makeVoiceStatus(title: string): string {
  const prefix = `${fmEmoji("music")} `;
  const cleanTitle = title.replace(/\s+/g, " ").trim() || "Unknown track";
  const maxLength = Math.max(prefix.length + 8, Math.min(config.voiceStatusMaxLength, 500));
  const available = maxLength - prefix.length;
  const shortened = cleanTitle.length <= available
    ? cleanTitle
    : `${cleanTitle.slice(0, Math.max(0, available - 3)).trimEnd()}...`;
  return `${prefix}${shortened}`;
}

interface GuildSession {
  guildId: string;
  queue: Queue;
  player: AudioPlayer;
  connection: VoiceConnection | null;
  current: Track | null;
  loopMode: LoopMode;
  volume: number;
  textChannelId: string | null;
  commandChannelId: string | null;
  voiceChannelId: string | null;
  lastVoiceStatus: string | null;
  nowPlayingChannelId: string | null;
  nowPlayingMessageId: string | null;
  nowPlayingTimer: NodeJS.Timeout | null;
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
  queueLength: number;
}

export interface JoinResult {
  channelId: string;
  channelName: string;
}

export interface NowPlayingInfo {
  track: Track;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  progress: string;
  loopMode: LoopMode;
  volume: number;
  queueLength: number;
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

  public async join(interaction: ChatInputCommandInteraction): Promise<JoinResult> {
    if (!interaction.guild) throw new UserFacingError("This command can only be used inside a server.");
    const voiceChannel = getMemberVoiceChannel(interaction);
    assertVoicePermissions(interaction, voiceChannel);

    const session = this.getOrCreateSession(interaction.guild.id);
    session.commandChannelId = interaction.channelId;
    session.textChannelId = voiceChannel.id;

    await this.ensureConnection(interaction, voiceChannel, session);
    this.clearIdleTimer(session);
    this.clearEmptyTimer(session);

    return { channelId: voiceChannel.id, channelName: voiceChannel.name };
  }

  public leave(guildId: string): void {
    this.disconnect(guildId);
  }

  public async play(interaction: ChatInputCommandInteraction, query: string): Promise<PlayResult> {
    if (!interaction.guild) throw new UserFacingError("This command can only be used inside a server.");
    const voiceChannel = getMemberVoiceChannel(interaction);
    assertVoicePermissions(interaction, voiceChannel);

    const session = this.getOrCreateSession(interaction.guild.id);
    session.commandChannelId = interaction.channelId;
    session.textChannelId = voiceChannel.id;

    const connectionPromise = this.ensureConnection(interaction, voiceChannel, session);
    const tracksPromise = this.extractor.resolve(query, {
      requestedBy: interaction.user.id,
      requesterTag: interaction.user.tag
    });

    const [tracks] = await Promise.all([tracksPromise, connectionPromise]);

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
    } else {
      void this.upsertNowPlayingMessage(session);
    }

    return { tracks, startedImmediately, queuePosition, queueLength: session.queue.size() };
  }

  public pause(guildId: string): boolean {
    const session = this.requireSession(guildId);
    const paused = session.player.pause(true);
    if (paused) {
      session.pausedAt = Date.now();
      void this.upsertNowPlayingMessage(session);
    }
    return paused;
  }

  public resume(guildId: string): boolean {
    const session = this.requireSession(guildId);
    if (session.pausedAt) {
      session.totalPausedMs += Date.now() - session.pausedAt;
      session.pausedAt = null;
    }
    const resumed = session.player.unpause();
    if (resumed) void this.upsertNowPlayingMessage(session);
    return resumed;
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
    this.clearNowPlayingTimer(session);
    session.player.stop(true);
    void this.setVoiceChannelStatus(session, null);
    void this.editNowPlayingNotice(session, "Playback stopped", "Playback stopped and the queue was cleared.");
    this.scheduleIdleDisconnect(session);
  }

  public disconnect(guildId: string): void {
    const session = this.requireSession(guildId);
    void this.editNowPlayingNotice(session, "Disconnected", "I left the voice channel and cleared the queue.");
    this.destroySession(session);
  }

  public clearQueue(guildId: string): number {
    const session = this.requireSession(guildId);
    const count = session.queue.size();
    session.queue.clear();
    void this.upsertNowPlayingMessage(session);
    return count;
  }

  public shuffle(guildId: string): number {
    const session = this.requireSession(guildId);
    const count = session.queue.size();
    session.queue.shuffle();
    void this.upsertNowPlayingMessage(session);
    return count;
  }

  public remove(guildId: string, position: number): Track {
    const session = this.requireSession(guildId);
    const removed = session.queue.remove(position);
    if (!removed) throw new UserFacingError("That queue position does not exist.");
    void this.upsertNowPlayingMessage(session);
    return removed;
  }

  public setVolume(guildId: string, volume: number): void {
    const session = this.requireSession(guildId);
    session.volume = volume;
    const resource = session.player.state.status !== AudioPlayerStatus.Idle ? session.player.state.resource : null;
    resource?.volume?.setVolume(volume / 100);
    void this.upsertNowPlayingMessage(session);
  }

  public setLoopMode(guildId: string, mode: LoopMode): void {
    const session = this.requireSession(guildId);
    session.loopMode = mode;
    void this.upsertNowPlayingMessage(session);
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

    const elapsedSeconds = this.getElapsedSeconds(session);
    const remainingSeconds = session.current.durationSeconds
      ? Math.max(0, session.current.durationSeconds - elapsedSeconds)
      : null;

    return {
      track: session.current,
      elapsedSeconds,
      remainingSeconds,
      progress: makeProgressBar(elapsedSeconds, session.current.durationSeconds),
      loopMode: session.loopMode,
      volume: session.volume,
      queueLength: session.queue.size()
    };
  }

  public createNowPlayingEmbed(guildId: string): EmbedBuilder | null {
    const session = this.sessions.get(guildId);
    if (!session?.current) return null;
    return this.buildNowPlayingEmbed(session);
  }

  public async refreshNowPlayingPanel(guildId: string): Promise<void> {
    const session = this.requireSession(guildId);
    if (!session.current) throw new UserFacingError("Nothing is playing right now.");
    await this.upsertNowPlayingMessage(session);
  }

  public ensureUserInSameVoice(interaction: ChatInputCommandInteraction): void {
    if (!interaction.guild) throw new UserFacingError("This command can only be used inside a server.");
    const session = this.sessions.get(interaction.guild.id);
    if (!session?.voiceChannelId) return;

    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    const userChannelId = member?.voice.channelId;
    if (!userChannelId) throw new UserFacingError("You must be in my voice channel to control playback.");
    if (userChannelId !== session.voiceChannelId) {
      throw new UserFacingError("You must be in the same voice channel as me to control playback. FMCord is limited to one voice channel per server.");
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
      commandChannelId: null,
      voiceChannelId: null,
      lastVoiceStatus: null,
      nowPlayingChannelId: null,
      nowPlayingMessageId: null,
      nowPlayingTimer: null,
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
    if (!session) throw new UserFacingError("I am not connected or playing anything in this server.");
    return session;
  }

  private async ensureConnection(
    interaction: ChatInputCommandInteraction,
    channel: VoiceBasedChannel,
    session: GuildSession
  ): Promise<void> {
    const existing = session.connection ?? getVoiceConnection(channel.guild.id) ?? null;
    if (existing && session.voiceChannelId && session.voiceChannelId !== channel.id) {
      throw new UserFacingError("I am already connected to another voice channel in this server. Use `/leave` from my current channel first.");
    }

    if (existing && existing.state.status !== VoiceConnectionStatus.Destroyed) {
      session.connection = existing;
      session.voiceChannelId = channel.id;
      session.textChannelId = channel.id;
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
      this.clearNowPlayingTimer(session);
      void this.setVoiceChannelStatus(session, null);
      void this.editNowPlayingNotice(session, "Queue finished", "There are no upcoming tracks. I will leave after the idle timeout unless more music is added.");
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
      await this.setVoiceChannelStatus(session, makeVoiceStatus(next.title));
      await this.upsertNowPlayingMessage(session);
      this.startNowPlayingTimer(session);
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
      this.clearNowPlayingTimer(session);
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

  private getElapsedSeconds(session: GuildSession): number {
    if (!session.currentStartedAt) return 0;
    const now = session.pausedAt ?? Date.now();
    const elapsedMs = now - session.currentStartedAt - session.totalPausedMs;
    return Math.max(0, Math.floor(elapsedMs / 1000));
  }

  private buildNowPlayingEmbed(session: GuildSession): EmbedBuilder {
    const current = session.current;
    if (!current) return infoEmbed("Nothing playing", "There is no active track right now.");

    const elapsedSeconds = this.getElapsedSeconds(session);
    const remainingSeconds = current.durationSeconds
      ? Math.max(0, current.durationSeconds - elapsedSeconds)
      : null;
    const remaining = current.isLive ? "Live" : remainingSeconds === null ? "Unknown" : formatTime(remainingSeconds);
    const state = session.pausedAt || session.player.state.status === AudioPlayerStatus.Paused ? "Paused" : "Playing";

    const embed = nowPlayingEmbed(`### ${songTitlePrefix(session.guildId)} ${compactTrackLink(current.title, current.url, 180)}`, session.guildId)
      .addFields(
        { name: `${fmEmoji("music", session.guildId)} Progress`, value: makeProgressCodeBlock(elapsedSeconds, current.durationSeconds), inline: false },
        { name: `${fmEmoji("note_information", session.guildId)} Time left`, value: statusPill(remaining), inline: true },
        { name: `${fmEmoji("note_information", session.guildId)} Duration`, value: statusPill(current.duration), inline: true },
        { name: `${fmEmoji("note_information", session.guildId)} Upcoming`, value: statusPill(`${session.queue.size()} song${session.queue.size() === 1 ? "" : "s"}`), inline: true },
        { name: `${fmEmoji("music", session.guildId)} Loop`, value: statusPill(session.loopMode), inline: true },
        { name: `${fmEmoji("music", session.guildId)} Volume`, value: statusPill(`${session.volume}%`), inline: true },
        { name: `${fmEmoji("nowplaying", session.guildId)} State`, value: statusPill(state), inline: true },
        { name: `${fmEmoji("note_information", session.guildId)} Requested by`, value: `<@${current.requestedBy}>`, inline: true },
        { name: `${fmEmoji("note_information", session.guildId)} Source`, value: statusPill(safeText(current.source, 64)), inline: true },
        { name: `${fmEmoji("note_information", session.guildId)} Voice`, value: session.voiceChannelId ? `<#${session.voiceChannelId}>` : "Unknown", inline: true }
      );

    if (current.thumbnail) embed.setThumbnail(current.thumbnail);
    embed.setFooter({ text: "FMCord • single live panel • edits every second" });
    return embed;
  }

  private async upsertNowPlayingMessage(session: GuildSession): Promise<void> {
    if (!session.current || !this.client) return;

    const embed = this.buildNowPlayingEmbed(session);

    // First choice: edit the live panel already created during this bot runtime.
    // This is what prevents loop-track / next-track spam.
    if (session.nowPlayingChannelId && session.nowPlayingMessageId) {
      const edited = await this.tryEditMessage(session.nowPlayingChannelId, session.nowPlayingMessageId, embed);
      if (edited) return;
      session.nowPlayingChannelId = null;
      session.nowPlayingMessageId = null;
    }

    // Do NOT adopt old historical messages before sending. v1.4 could silently edit an
    // old panel buried in chat history, which made it look like no Now Playing panel
    // was sent. If there is no saved live panel, create exactly one visible panel now.
    const channelIds = [session.textChannelId, session.commandChannelId].filter(
      (channelId, index, all): channelId is string => Boolean(channelId) && all.indexOf(channelId) === index
    );

    for (const channelId of channelIds) {
      try {
        const channel = await this.fetchSendableChannel(channelId);
        if (!channel) continue;
        const sent = await channel.send({ embeds: [embed] });
        if (this.isDiscordMessage(sent)) {
          session.nowPlayingChannelId = sent.channelId;
          session.nowPlayingMessageId = sent.id;
          void this.deleteDuplicateNowPlayingMessagesInChannel(sent.channelId, sent.id);
        }
        return;
      } catch (error) {
        logger.debug(`Could not send now-playing panel to channel ${channelId}`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async deleteDuplicateNowPlayingMessagesInChannel(channelId: string, keepId: string): Promise<void> {
    try {
      const channel = await this.fetchSendableChannel(channelId);
      const messagesApi = (channel as { messages?: { fetch?: (options: unknown) => Promise<unknown> } } | null)?.messages;
      if (!messagesApi?.fetch) return;

      const result = await messagesApi.fetch({ limit: 25 });
      const duplicates = this.messageArray(result).filter(
        (message) => message.id !== keepId && this.isFMCordNowPlayingMessage(message)
      );
      await this.deleteDuplicateNowPlayingMessages(duplicates, keepId);
    } catch (error) {
      logger.debug(`Could not clean duplicate now-playing panels in channel ${channelId}`, error instanceof Error ? error.message : String(error));
    }
  }

  private async tryAdoptExistingNowPlayingMessage(session: GuildSession, channelId: string, embed: EmbedBuilder): Promise<boolean> {
    try {
      const channel = await this.fetchSendableChannel(channelId);
      const messagesApi = (channel as { messages?: { fetch?: (options: unknown) => Promise<unknown> } } | null)?.messages;
      if (!messagesApi?.fetch) return false;

      const result = await messagesApi.fetch({ limit: 25 });
      const candidates = this.messageArray(result).filter((message) => this.isFMCordNowPlayingMessage(message));
      const target = candidates[0];
      if (!target) return false;

      await target.edit({ embeds: [embed] });
      session.nowPlayingChannelId = target.channelId;
      session.nowPlayingMessageId = target.id;

      void this.deleteDuplicateNowPlayingMessages(candidates.slice(1), target.id);
      return true;
    } catch (error) {
      logger.debug(`Could not adopt existing now-playing panel in channel ${channelId}`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private messageArray(value: unknown): Message[] {
    if (this.isDiscordMessage(value)) return [value];
    if (value && typeof value === "object" && "values" in value && typeof (value as { values?: unknown }).values === "function") {
      return Array.from((value as { values: () => Iterable<unknown> }).values()).filter((message): message is Message => this.isDiscordMessage(message));
    }
    return [];
  }

  private isDiscordMessage(value: unknown): value is Message {
    return typeof value === "object" && value !== null && "id" in value && "channelId" in value && "edit" in value && "embeds" in value;
  }

  private isFMCordNowPlayingMessage(message: Message): boolean {
    if (message.author.id !== this.client?.user?.id) return false;

    return message.embeds.some((embed) => {
      const title = embed.title?.toLowerCase() ?? "";
      const footer = embed.footer?.text?.toLowerCase() ?? "";
      const description = embed.description?.toLowerCase() ?? "";
      const isNowPlaying = title.includes("now playing") || description.includes("now playing");
      const isFMCord = footer.includes("fmcord") || message.author.username.toLowerCase().includes("fmcord");
      return isNowPlaying && isFMCord;
    });
  }

  private async deleteDuplicateNowPlayingMessages(messages: Message[], keepId: string): Promise<void> {
    for (const message of messages) {
      if (message.id === keepId) continue;
      try {
        await message.delete();
      } catch (error) {
        logger.debug(`Could not delete duplicate now-playing panel ${message.id}`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async editNowPlayingNotice(session: GuildSession, title: string, description: string): Promise<void> {
    this.clearNowPlayingTimer(session);
    if (!session.nowPlayingChannelId || !session.nowPlayingMessageId) return;
    const embed = infoEmbed(title, description);
    await this.tryEditMessage(session.nowPlayingChannelId, session.nowPlayingMessageId, embed);
  }

  private async tryEditMessage(channelId: string, messageId: string, embed: EmbedBuilder): Promise<boolean> {
    try {
      const channel = await this.fetchSendableChannel(channelId);
      const message = await channel?.messages?.fetch(messageId);
      if (!this.isDiscordMessage(message)) return false;
      await message.edit({ embeds: [embed] });
      return true;
    } catch (error) {
      logger.debug(`Could not edit now-playing message ${messageId}`, error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private startNowPlayingTimer(session: GuildSession): void {
    this.clearNowPlayingTimer(session);
    session.nowPlayingTimer = setInterval(() => {
      if (!session.current) {
        this.clearNowPlayingTimer(session);
        return;
      }
      void this.upsertNowPlayingMessage(session);
    }, NOW_PLAYING_UPDATE_SECONDS * 1000);
  }

  private clearNowPlayingTimer(session: GuildSession): void {
    if (session.nowPlayingTimer) clearInterval(session.nowPlayingTimer);
    session.nowPlayingTimer = null;
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
    this.clearNowPlayingTimer(session);
    session.queue.clear();
    session.current = null;
    session.cleanupStream?.();
    session.cleanupStream = null;
    try {
      session.player.stop(true);
    } catch {
      // Already stopped.
    }
    void this.setVoiceChannelStatus(session, null);
    try {
      session.connection?.destroy();
    } catch {
      // Already destroyed.
    }
    this.sessions.delete(session.guildId);
  }

  private async sendToTextChannel(session: GuildSession, embed: EmbedBuilder): Promise<void> {
    if (!this.client) return;

    const channelIds = [session.textChannelId, session.commandChannelId].filter(
      (channelId, index, all): channelId is string => Boolean(channelId) && all.indexOf(channelId) === index
    );

    for (const channelId of channelIds) {
      try {
        const channel = await this.fetchSendableChannel(channelId);
        if (!channel) continue;
        await channel.send({ embeds: [embed] });
        return;
      } catch (error) {
        logger.debug(`Could not send music update to channel ${channelId}`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  private async setVoiceChannelStatus(session: GuildSession, status: string | null): Promise<void> {
    if (!config.enableVoiceStatus || !this.client || !session.voiceChannelId) return;

    const normalizedStatus = status?.slice(0, 500) ?? null;
    if (session.lastVoiceStatus === normalizedStatus) return;

    try {
      const guild = this.client.guilds.cache.get(session.guildId);
      const voiceChannel = guild?.channels.cache.get(session.voiceChannelId);
      const me = guild?.members.me ?? null;
      const permissions = me && voiceChannel ? voiceChannel.permissionsFor(me) : null;

      if (permissions && !permissions.has(VOICE_STATUS_PERMISSION)) {
        logger.debug(`Skipping voice status update in guild ${session.guildId}: missing SET_VOICE_CHANNEL_STATUS permission`);
        return;
      }

      await this.client.rest.put(`/channels/${session.voiceChannelId}/voice-status` as `/${string}`, {
        body: { status: normalizedStatus }
      });
      session.lastVoiceStatus = normalizedStatus;
    } catch (error) {
      logger.debug("Could not update voice channel status", error instanceof Error ? error.message : String(error));
    }
  }

  private async fetchSendableChannel(channelId: string): Promise<SendableChannel | null> {
    if (!this.client) return null;
    const channel = await this.client.channels.fetch(channelId);
    if (!this.canSend(channel)) return null;
    return channel;
  }

  private canSend(channel: unknown): channel is SendableChannel {
    return typeof channel === "object" && channel !== null && "send" in channel && typeof (channel as { send?: unknown }).send === "function";
  }
}

export const musicService = new MusicService();
