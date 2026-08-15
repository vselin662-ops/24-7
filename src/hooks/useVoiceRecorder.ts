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
  clearError: () => void;
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
  const speechRecognitionRef = useRef<any>(null);
  const recognizedTextRef = useRef<string>('');

  // Keep durationRef synced
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Clean up timers & tracks on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (_) {}
      }
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
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (_) {}
      speechRecognitionRef.current = null;
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

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    recognizedTextRef.current = '';

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const msg = 'Запись звука не поддерживается в этом браузере или заблокирована в iframe';
      setError(msg);
      if (onError) onError(msg);
      return;
    }

    try {
      // 1. Request microphone stream with fallback for broad mobile compatibility
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (err1) {
        // Fallback without constraints for strict mobile devices
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;

      // 2. AudioContext + AnalyserNode for volume visualizer (safe & optional)
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume().catch(() => {});
          }

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateVolumeLoop = () => {
            if (!streamRef.current) return;
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
        }
      } catch (ctxErr) {
        console.warn('AudioContext visualizer skipped:', ctxErr);
      }

      // 3. Optional real-time Web Speech API recognition for instant feedback
      try {
        const SpeechRecClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecClass) {
          const recognition = new SpeechRecClass();
          recognition.lang = 'ru-RU';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event: any) => {
            let current = '';
            for (let i = 0; i < event.results.length; i++) {
              current += event.results[i][0].transcript;
            }
            if (current) recognizedTextRef.current = current;
          };
          recognition.onerror = () => {};
          recognition.start();
          speechRecognitionRef.current = recognition;
        }
      } catch (_) {}

      // 4. MediaRecorder initialization with supported MIME types
      let mimeType = '';
      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/ogg;codecs=opus',
        'audio/wav',
      ];

      if (typeof MediaRecorder !== 'undefined') {
        for (const type of candidateTypes) {
          if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) {
            mimeType = type;
            break;
          }
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

      // 5. Timer for duration
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

      let msg = 'Разрешите доступ к микрофону в настройках браузера';
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        msg = 'Разрешите доступ к микрофону в настройках браузера (или откройте сайт в отдельной вкладке)';
      } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
        msg = 'Микрофон не обнаружен на вашем устройстве';
      } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
        msg = 'Микрофон занят другим приложением';
      }

      setError(msg);
      if (onError) onError(msg);
    }
  }, [onError, stopAudioStreams]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const recordedDuration = durationRef.current;
    const clientRecognizedText = recognizedTextRef.current.trim();

    stopAudioStreams();

    if (!recorder || recorder.state === 'inactive') {
      setState('idle');
      if (clientRecognizedText && onTranscript) {
        onTranscript(clientRecognizedText);
      }
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

      // If client speech recognition already gave a good transcript, we can use it directly
      if (clientRecognizedText && (!audioBlob || audioBlob.size < 500)) {
        if (onTranscript) onTranscript(clientRecognizedText);
        setState('idle');
        return;
      }

      // Ignore recordings shorter than 1 second or empty blobs
      if (recordedDuration < 1 && audioBlob.size < 500 && !clientRecognizedText) {
        setState('idle');
        return;
      }

      // Send to server: POST /api/voice/transcribe
      let finalTranscript = '';

      try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        const res = await fetch('/api/voice/transcribe', {
          method: 'POST',
          body: formData,
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          finalTranscript = (data && data.text ? data.text.trim() : '');
        }
      } catch (postErr) {
        console.warn('Multipart transcribe fetch failed, trying base64 fallback:', postErr);
      }

      // Secondary fallback to /api/transcribe with base64 if needed
      if (!finalTranscript) {
        try {
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resReader) => {
            reader.onloadend = () => {
              const res = reader.result as string;
              resReader(res ? res.split(',')[1] || '' : '');
            };
            reader.onerror = () => resReader('');
            reader.readAsDataURL(audioBlob);
          });
          const b64Data = await base64Promise;
          if (b64Data) {
            const trRes = await fetch('/api/transcribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: b64Data, mimeType: audioBlob.type || 'audio/webm' }),
            });
            if (trRes.ok) {
              const trData = await trRes.json().catch(() => ({}));
              finalTranscript = (trData && trData.text ? trData.text.trim() : '');
            }
          }
        } catch (b64Err) {
          console.warn('Base64 transcribe fallback failed:', b64Err);
        }
      }

      finalTranscript = finalTranscript || clientRecognizedText;

      if (finalTranscript) {
        if (onTranscript) {
          onTranscript(finalTranscript);
        }
        setState('idle');
      } else {
        const msg = 'Не удалось распознать речь. Попробуйте сказать громче.';
        setError(msg);
        if (onError) onError(msg);
        setState('idle');
      }
    } catch (err: any) {
      console.error('Failed to transcribe voice:', err);
      if (clientRecognizedText && onTranscript) {
        onTranscript(clientRecognizedText);
        setState('idle');
        return;
      }
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
    clearError,
  };
}
