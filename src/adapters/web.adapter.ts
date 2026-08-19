import { Adapter, InputEvent, VoiceInputEvent } from './base.adapter';
import { logger } from '../logger';

/**
 * Адаптер для взаимодействия через Web UI / WebSocket / REST API.
 * Отвечает за:
 * - Подключение браузерных клиентов в реальном времени
 * - Передачу текстовых запросов и аудиопотоков
 * - Отправку стриминг-ответов и статусов агентов
 */
export class WebAdapter implements Adapter {
  public readonly name = 'web';
  private connected = false;
  private messageHandlers: Array<(event: InputEvent) => void> = [];
  private voiceHandlers: Array<(event: VoiceInputEvent) => void> = [];

  public onMessage(handler: (event: InputEvent) => void): void {
    this.messageHandlers.push(handler);
  }

  public onVoice(handler: (event: VoiceInputEvent) => void): void {
    this.voiceHandlers.push(handler);
  }

  public async sendText(targetId: string, text: string): Promise<void> {
    logger.info(`[WebAdapter] Send text to web user ${targetId}: ${text.slice(0, 50)}...`);
  }

  public async sendVoice(targetId: string, audioBuffer: Buffer): Promise<void> {
    logger.info(`[WebAdapter] Send audio stream to web user ${targetId}, buffer size: ${audioBuffer.length}`);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async start(): Promise<void> {
    this.connected = true;
    logger.info('[WebAdapter] Web adapter initialized and listening.');
  }

  public async stop(): Promise<void> {
    this.connected = false;
    logger.info('[WebAdapter] Web adapter stopped.');
  }
}
