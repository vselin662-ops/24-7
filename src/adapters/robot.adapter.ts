import type { Adapter, InputEvent, VoiceInputEvent, SensorEvent, RobotAction } from './base.adapter';
import { logger } from '../logger';

/**
 * Адаптер для физического робота-ассистента.
 * Реализует интерфейс взаимодействия с аппаратным комплексом (камера, экран, динамик, сенсоры).
 */
export class RobotAdapter implements Adapter {
  name = 'robot';
  private connected = false;
  private messageHandlers: Array<(event: InputEvent) => void> = [];
  private voiceHandlers: Array<(event: VoiceInputEvent) => void> = [];
  private sensorHandlers: Array<(event: SensorEvent) => void> = [];

  onMessage(handler: (event: InputEvent) => void): void {
    this.messageHandlers.push(handler);
  }

  onVoice(handler: (event: VoiceInputEvent) => void): void {
    this.voiceHandlers.push(handler);
  }

  onSensor(handler: (event: SensorEvent) => void): void {
    this.sensorHandlers.push(handler);
  }

  async sendText(targetId: string, text: string): Promise<void> {
    logger.info('[RobotAdapter] Display text on robot screen', { targetId, text });
  }

  async sendVoice(targetId: string, audioBuffer: Buffer): Promise<void> {
    logger.info('[RobotAdapter] Play audio through robot speaker', { targetId, size: audioBuffer.length });
  }

  async sendAction(targetId: string, action: RobotAction): Promise<void> {
    logger.info('[RobotAdapter] Execute physical robot action', { targetId, action });
  }

  /**
   * Имитация срабатывания сенсора робота (для гибридного тестирования).
   */
  emitSensorEvent(event: SensorEvent): void {
    for (const h of this.sensorHandlers) {
      h(event);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async start(): Promise<void> {
    this.connected = true;
    logger.info('[RobotAdapter] Robot interface adapter started successfully');
  }

  async stop(): Promise<void> {
    this.connected = false;
    logger.info('[RobotAdapter] Robot interface adapter stopped');
  }
}
