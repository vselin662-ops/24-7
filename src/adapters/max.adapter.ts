import type { Adapter, InputEvent, VoiceInputEvent } from './base.adapter';
import { logger } from '../logger';

/**
 * Адаптер мессенджера Max.
 */
export class MaxAdapter implements Adapter {
  name = 'max';
  private connected = false;
  private messageHandlers: Array<(event: InputEvent) => void> = [];
  private voiceHandlers: Array<(event: VoiceInputEvent) => void> = [];

  constructor(private token: string) {}

  onMessage(handler: (event: InputEvent) => void): void {
    this.messageHandlers.push(handler);
  }

  onVoice(handler: (event: VoiceInputEvent) => void): void {
    this.voiceHandlers.push(handler);
  }

  /**
   * Метод вызова входящих событий от webhook Max Bot.
   */
  handleWebhookMessage(userId: string, text: string, metadata: Record<string, unknown> = {}): void {
    const event: InputEvent = {
      adapterName: this.name,
      userId,
      tenantId: userId,
      text,
      timestamp: Date.now(),
      metadata,
    };
    for (const handler of this.messageHandlers) {
      handler(event);
    }
  }

  /**
   * Метод вызова входящего аудиосообщения от Max Bot.
   */
  handleWebhookVoice(userId: string, audioBuffer: Buffer, duration: number = 0): void {
    const event: VoiceInputEvent = {
      adapterName: this.name,
      userId,
      tenantId: userId,
      text: '',
      audioBuffer,
      duration,
      timestamp: Date.now(),
    };
    for (const handler of this.voiceHandlers) {
      handler(event);
    }
  }

  async sendText(targetId: string, text: string): Promise<void> {
    logger.info('[MaxAdapter] Sending message to Max messenger user', { targetId, textLength: text.length });
  }

  async sendVoice(targetId: string, audioBuffer: Buffer): Promise<void> {
    logger.info('[MaxAdapter] Sending voice message to Max messenger user', { targetId, audioSize: audioBuffer.length });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    this.connected = true;
    logger.info('[MaxAdapter] Max messenger adapter started with token', { token: this.token ? 'PRESENT' : 'MISSING' });
  }

  async stop(): Promise<void> {
    this.connected = false;
    logger.info('[MaxAdapter] Max messenger adapter stopped');
  }
}
