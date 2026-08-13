import { useState, useRef, useCallback, useEffect } from 'react';

export type VoiceState = 'idle' | 'recording' | 'processing' | 'speaking';

export interface UseVoiceRecorderOptions {
  onTranscript?: (text: string) => void;
  onError?: (errorMessage: string) => void;
}

export interface UseVoiceRecorderReturn {
  state: VoiceState;
  volume: number;
  duration: number;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  setState: (state: VoiceState) => void;
}

export function useVoiceRecorder(options: UseVoiceRecorderOptions = {}): UseVoiceRecorderReturn {
  const { onTranscript, onError } = options;

  const [state, setState] = useState<VoiceState>('idle');
  const [volume, setVolume] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const durationRef = useRef<number>(0);

  // Keep durationRef synced
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Clean up timers & tracks on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  const stopAudioStreams = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setVolume(0);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Запись звука не поддерживается в этом браузере';
      setError(msg);
      if (onError) onError(msg);
      return;
    }

    try {
      // 1. Request microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // 2. AudioContext + AnalyserNode for volume
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolumeLoop = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        setVolume(Math.min(1, avg / 128));
        animFrameRef.current = requestAnimationFrame(updateVolumeLoop);
      };
      updateVolumeLoop();

      // 3. MediaRecorder
      let mimeType = 'audio/webm;codecs=opus';
      if (typeof MediaRecorder !== 'undefined') {
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/webm';
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start(200);

      // 4. Timer for duration
      setDuration(0);
      durationTimerRef.current = setInterval(() => {
        setDuration((prev) => {
          const next = prev + 1;
          if (next >= 60) {
            // Auto stop at 60 seconds limit
            setTimeout(() => {
              stopRecording();
            }, 0);
          }
          return next;
        });
      }, 1000);

      setState('recording');
    } catch (err: any) {
      console.warn('Microphone error:', err);
      stopAudioStreams();
      setState('idle');

      let msg = 'Разрешите доступ к микрофону';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg = 'Разрешите доступ к микрофону в настройках браузера';
      } else if (err?.name === 'NotFoundError') {
        msg = 'Микрофон не обнаружен';
      }

      setError(msg);
      if (onError) onError(msg);
    }
  }, [onError, stopAudioStreams]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const recordedDuration = durationRef.current;

    stopAudioStreams();

    if (!recorder || recorder.state === 'inactive') {
      setState('idle');
      return;
    }

    setState('processing');

    const stopPromise = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        resolve(blob);
      };
      recorder.stop();
    });

    try {
      const audioBlob = await stopPromise;

      // Ignore recordings shorter than 1 second or empty blobs
      if (recordedDuration < 1 || audioBlob.size < 500) {
        setState('idle');
        return;
      }

      // Send to server: POST /api/voice/transcribe
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data && data.text && data.text.trim()) {
        if (onTranscript) {
          onTranscript(data.text.trim());
        }
        setState('idle');
      } else {
        const msg = 'Не удалось распознать речь';
        setError(msg);
        if (onError) onError(msg);
        setState('idle');
      }
    } catch (err: any) {
      console.error('Failed to transcribe voice:', err);
      const msg = err.message || 'Не удалось распознать речь';
      setError(msg);
      if (onError) onError(msg);
      setState('idle');
    }
  }, [onError, onTranscript, stopAudioStreams]);

  return {
    state,
    volume,
    duration,
    error,
    startRecording,
    stopRecording,
    setState,
  };
}
