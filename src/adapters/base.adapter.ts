export interface InputEvent {
  adapterName: string;
  userId: string;
  tenantId: string;
  text: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface VoiceInputEvent extends InputEvent {
  audioBuffer: Buffer;
  duration: number;
  transcription?: string;
}

export interface SensorEvent {
  type: 'face_detected' | 'motion' | 'sound' | 'touch' | 'proximity' | 'guest_arrived';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface RobotAction {
  type: 'move_head' | 'show_emotion' | 'display_text' | 'play_sound' | 'navigate_to';
  params: Record<string, unknown>;
}

/**
 * Абстрактный адаптер интерфейса.
 * Ядро (Core) не знает, через какой интерфейс оно общается с пользователем.
 */
export interface Adapter {
  name: string;

  // Входные события
  onMessage(handler: (event: InputEvent) => void): void;
  onVoice(handler: (event: VoiceInputEvent) => void): void;
  onSensor?(handler: (event: SensorEvent) => void): void;

  // Выходные действия
  sendText(targetId: string, text: string): Promise<void>;
  sendVoice(targetId: string, audioBuffer: Buffer): Promise<void>;
  sendImage?(targetId: string, imageBuffer: Buffer): Promise<void>;
  sendAction?(targetId: string, action: RobotAction): Promise<void>;

  // Состояние
  isConnected(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}
