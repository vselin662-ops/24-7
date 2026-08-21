// src/lib/audioConvert.ts
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { logger } from '../logger';

/**
 * Проверяет аудио буфер и при необходимости конвертирует WAV / другой формат в MP3 через ffmpeg-static
 */
export async function ensureMp3Buffer(buffer: Buffer): Promise<Buffer> {
  if (!buffer || buffer.length === 0) return buffer;

  // Проверка на WAV (сигнатура RIFF)
  const isWav = buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'RIFF';
  const isMp3 = (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') ||
                (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0);

  if (isMp3 && !isWav) {
    return buffer;
  }

  if (ffmpegPath) {
    try {
      return await new Promise<Buffer>((resolve) => {
        const proc = spawn(ffmpegPath, [
          '-i', 'pipe:0',
          '-f', 'mp3',
          '-acodec', 'libmp3lame',
          '-ab', '48k',
          '-ar', '24000',
          '-ac', '1',
          'pipe:1'
        ]);

        const outChunks: Buffer[] = [];
        let errStr = '';

        proc.stdout.on('data', (chunk) => outChunks.push(chunk));
        proc.stderr.on('data', (chunk) => {
          errStr += chunk.toString();
        });

        proc.on('close', (code) => {
          if (code === 0 && outChunks.length > 0) {
            const mp3Buf = Buffer.concat(outChunks);
            logger.info(`🎵 [audioConvert] Аудио успешно сконвертировано в MP3 (${mp3Buf.length} байт)`);
            resolve(mp3Buf);
          } else {
            logger.warn(`⚠️ [audioConvert] ffmpeg завершился с кодом ${code}: ${errStr.slice(-200)}`);
            resolve(buffer);
          }
        });

        proc.on('error', (err) => {
          logger.warn(`⚠️ [audioConvert] Ошибка ffmpeg: ${err.message}`);
          resolve(buffer);
        });

        proc.stdin.write(buffer);
        proc.stdin.end();
      });
    } catch (err: any) {
      logger.warn(`⚠️ [audioConvert] Исключение при запуске ffmpeg: ${err?.message || err}`);
      return buffer;
    }
  }

  return buffer;
}
