import React, { useState, useRef, useEffect } from 'react';
import { GlassPanel } from './GlassPanel';
import { NeonButton } from './NeonButton';
import { Mic, Square, Check, RefreshCw, Volume2, Shield, Lock } from 'lucide-react';

interface VoiceRecorderProps {
  onCloned: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onCloned }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0); // in tenths of a second
  const [recordings, setRecordings] = useState<number[]>([]);
  const [cloningState, setCloningState] = useState<'idle' | 'recording_done' | 'processing' | 'done'>('idle');
  const [processingStep, setProcessingStep] = useState(0);
  const [selectedBaseVoice, setSelectedBaseVoice] = useState('v1');
  const [aesToken, setAesToken] = useState('');
  const [vectorString, setVectorString] = useState('');

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const animationRef = useRef<number | null>(null);

  const baseVoices = [
    { id: 'v1', name: 'Дмитрий (Нейтральный)', description: 'Спокойный мужской баритон, отлично для консалтинга' },
    { id: 'v2', name: 'Анна (Мягкий)', description: 'Приятный женский сопрано, идеально для бьюти и услуг' },
    { id: 'v3', name: 'Михаил (Энергичный)', description: 'Харизматичный голос, превосходно для активных продаж' },
    { id: 'v4', name: 'Елена (Деловой)', description: 'Уверенный и строгий тембр, идеален для B2B услуг' }
  ];

  const steps = [
    'Очистка фонового шума и эха (Demucs)...',
    'Нормализация громкости аудио (pydub)...',
    'Сегментация и транскрибирование (Whisper large-v3)...',
    'Извлечение спектрального вектора голоса (Gemini TTS)...',
    'Симметричное шифрование вектора ключом AES-256...',
    'Сохранение зашифрованного вектора в базу данных Firebase Firestore...'
  ];

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const startRecording = () => {
    setIsRecording(true);
    setRecordTime(0);
    setRecordings([]);
    
    // Simulate audio visualization bars
    const simulateBars = () => {
      const bars = [];
      for (let i = 0; i < 40; i++) {
        bars.push(Math.random() * 80 + 10);
      }
      setRecordings(bars);
      animationRef.current = requestAnimationFrame(simulateBars);
    };
    simulateBars();

    timerRef.current = setInterval(() => {
      setRecordTime(prev => {
        if (prev >= 150) { // Limit to 15 seconds
          stopRecording();
          return 150;
        }
        return prev + 1;
      });
    }, 100);
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    setCloningState('recording_done');
  };

  const startCloningProcess = () => {
    setCloningState('processing');
    setProcessingStep(0);

    const stepInterval = setInterval(() => {
      setProcessingStep(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(stepInterval);
          setTimeout(() => {
            // Generate some plausible tokens
            const randomHex = () => Math.floor(Math.random() * 16).toString(16);
            const token = 'AES-' + Array.from({ length: 16 }, randomHex).join('').toUpperCase();
            const vec = 'VEC_ST_US_' + Array.from({ length: 12 }, randomHex).join('').toUpperCase();
            
            setAesToken(token);
            setVectorString(vec);
            setCloningState('done');
            onCloned();
          }, 600);
          return steps.length;
        }
        return prev + 1;
      });
    }, 1200);
  };

  const handleReset = () => {
    setCloningState('idle');
    setRecordTime(0);
    setRecordings([]);
    setProcessingStep(0);
  };

  return (
    <GlassPanel id="voice-cloner" className="relative overflow-hidden border-accent/20 shadow-lg">
      <div className="flex items-center gap-3 mb-5">
        <div className="bg-accent/10 p-2 rounded-lg text-accent">
          <Volume2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-display text-lg font-semibold text-white">Модуль голосового клона</h3>
          <p className="text-xs text-slate-400">Создайте ИИ-клон вашего голоса для автоответчика за 15 секунд</p>
        </div>
      </div>

      {cloningState === 'idle' && (
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              1. Выберите базовый тембр для калибровки:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {baseVoices.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedBaseVoice(v.id)}
                  className={`text-left p-3 rounded-xl border text-sm transition-all duration-300 ${
                    selectedBaseVoice === v.id
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-white/5 bg-white/2 hover:bg-white/5 text-slate-300'
                  }`}
                >
                  <p className="font-medium">{v.name}</p>
                  <p className="text-xxs text-slate-400 truncate mt-0.5">{v.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-white/5 bg-slate-950/40 rounded-xl p-5 text-center flex flex-col items-center justify-center">
            {isRecording ? (
              <div className="space-y-4 w-full">
                <div className="flex items-center justify-center gap-1.5 h-12">
                  {recordings.slice(-30).map((height, i) => (
                    <div
                      key={i}
                      className="w-1 bg-accent rounded-full"
                      style={{
                        height: `${height}%`,
                        transition: 'height 0.1s ease'
                      }}
                    />
                  ))}
                </div>
                <div className="text-accent text-sm tracking-wider font-bold">
                  Идет запись... 00:{(recordTime / 10).toFixed(1)}с
                </div>
                <p className="text-xs text-slate-300 italic max-w-sm mx-auto">
                  «Здравствуйте, я подключаю автономного сотрудника для моего бизнеса, чтобы отвечать клиентам 24/7»
                </p>
                <NeonButton variant="red" onClick={stopRecording} className="mx-auto mt-2" glow={false}>
                  <Square className="h-4 w-4 fill-current" /> Остановить
                </NeonButton>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="h-12 flex items-center justify-center text-slate-500">
                  <Mic className="h-8 w-8 animate-pulse text-accent/60" />
                </div>
                <p className="text-xs text-slate-300 max-w-sm">
                  Нажмите кнопку ниже и прочитайте вслух предложение в кавычках (рекомендуется записать от 5 до 10 секунд).
                </p>
                <NeonButton variant="accent" onClick={startRecording} className="mx-auto" glow={false}>
                  <Mic className="h-4 w-4" /> Начать запись голоса
                </NeonButton>
              </div>
            )}
          </div>
        </div>
      )}

      {cloningState === 'recording_done' && (
        <div className="space-y-5 text-center py-4">
          <div className="flex items-center justify-center gap-2 text-accent">
            <Check className="h-5 w-5 bg-accent/20 p-0.5 rounded-full" />
            <span className="text-sm font-semibold">Аудио успешно записано ({(recordTime / 10).toFixed(1)} сек)</span>
          </div>
          <div className="flex gap-3 justify-center">
            <NeonButton variant="glass" onClick={handleReset} glow={false}>
              <RefreshCw className="h-4 w-4" /> Записать заново
            </NeonButton>
            <NeonButton variant="accent" onClick={startCloningProcess} glow={false}>
              Склонировать мой голос
            </NeonButton>
          </div>
        </div>
      )}

      {cloningState === 'processing' && (
        <div className="space-y-4 py-4">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>Обработка ML-алгоритмами Gemini TTS...</span>
            <span>{Math.round((processingStep / steps.length) * 100)}%</span>
          </div>
          <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden border border-white/5">
            <div
              className="bg-accent h-full transition-all duration-500"
              style={{ width: `${(processingStep / steps.length) * 100}%` }}
            />
          </div>
          <div className="space-y-1 bg-slate-950/40 p-4 rounded-xl border border-white/5">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`text-xs flex items-center gap-2 ${
                  idx < processingStep
                    ? 'text-accent font-medium'
                    : idx === processingStep
                    ? 'text-white animate-pulse'
                    : 'text-slate-600'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                <span>{step}</span>
                {idx < processingStep && <Check className="h-3 w-3 text-accent ml-auto" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {cloningState === 'done' && (
        <div className="space-y-4 pt-2">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex gap-3 items-start">
            <div className="bg-emerald-950 text-emerald-400 p-2 rounded-lg mt-0.5">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-emerald-300">Голосовой клон успешно запущен!</h4>
              <p className="text-xs text-slate-300 mt-1">
                Голосовой вектор извлечен и зашифрован. Ваши сотрудники готовы озвучивать свои ответы вашим голосом.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/40 p-3 rounded-xl border border-white/5 flex flex-col justify-between">
              <div className="text-slate-400">Ключ дешифрации (AES-256):</div>
              <div className="text-accent font-bold mt-1 flex items-center gap-1">
                <Lock className="h-3 w-3 text-accent" />
                {aesToken}
              </div>
            </div>
            <div className="bg-slate-950/40 p-3 rounded-xl border border-white/5 flex flex-col justify-between">
              <div className="text-slate-400">Вектор голоса (Database ID):</div>
              <div className="text-slate-300 font-medium truncate mt-1">
                {vectorString}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <NeonButton variant="glass" onClick={handleReset} className="text-xs px-3 py-1.5" glow={false}>
              Сбросить клон
            </NeonButton>
          </div>
        </div>
      )}
    </GlassPanel>
  );
};
