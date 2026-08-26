// src/services/VoiceService.ts
import { TTSService, TTSSynthesisOptions, synthesizeForChat } from './TTSService';
import { STTService } from './stt.service';
import { logger } from '../logger';

export class VoiceService {
  private tts: TTSService;
  private stt: STTService;

  constructor(ttsService?: TTSService, sttServiceInstance?: STTService) {
    this.tts = ttsService || new TTSService();
    this.stt = sttServiceInstance || new STTService();
  }

  public async synthesize(text: string, options?: TTSSynthesisOptions): Promise<Buffer> {
    return this.tts.synthesize(text, options);
  }

  public async synthesizeForChat(chatId: string | number | null | undefined, text: string): Promise<Buffer> {
    return synthesizeForChat(chatId, text);
  }

  public async transcribe(audioBuffer: Buffer, language: string = 'ru'): Promise<string> {
    return this.stt.transcribe(audioBuffer, language);
  }
}

export const voiceService = new VoiceService();
export { synthesizeForChat };
