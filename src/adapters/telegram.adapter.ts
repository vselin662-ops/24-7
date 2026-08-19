import { Adapter, InputEvent, VoiceInputEvent } from './base.adapter';
import { logger } from '../logger';

/**
 * Адаптер для взаимодействия через Telegram Bot API.
 * Отвечает за:
 * - Прием текстовых сообщений и голосовых заметок через Webhook/Long Polling
 * - Отправку форматированных сообщений MarkdownV2
 * - Отправку аудио-ответов (voice/audio)
 */
export class TelegramAdapter implements Adapter {
  public readonly name = 'telegram';
  private connected = false;
  private messageHandlers: Array<(event: InputEvent) => void> = [];
  private voiceHandlers: Array<(event: VoiceInputEvent) => void> = [];

  constructor(private token?: string) {}

  public onMessage(handler: (event: InputEvent) => void): void {
    this.messageHandlers.push(handler);
  }

  public onVoice(handler: (event: VoiceInputEvent) => void): void {
    this.voiceHandlers.push(handler);
  }

  public async sendText(targetId: string, text: string): Promise<void> {
    logger.info(`[TelegramAdapter] Send text to ${targetId}: ${text.slice(0, 50)}...`);
  }

  public async sendVoice(targetId: string, audioBuffer: Buffer): Promise<void> {
    logger.info(`[TelegramAdapter] Send voice to ${targetId}, buffer size: ${audioBuffer.length}`);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async start(): Promise<void> {
    this.connected = true;
    logger.info('[TelegramAdapter] Telegram adapter started.');
  }

  public async stop(): Promise<void> {
    this.connected = false;
    logger.info('[TelegramAdapter] Telegram adapter stopped.');
  }
}
