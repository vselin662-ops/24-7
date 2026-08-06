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
    <GlassPanel id="voice-cloner" className="relative overflow-hidden border-[#DCD6CD]/15 shadow-2xl rounded-3xl bg-[#181412]/85 p-6 md:p-8 font-serif-geos">
      <div className="flex items-center gap-3.5 mb-6">
        <div className="bg-[#28221F] p-3 rounded-2xl border border-[#C5A059]/30 text-[#C5A059] shadow-md">
          <Volume2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-xl font-light text-[#EAE6DF] tracking-wide">Модуль Голосового Клона</h3>
          <p className="text-xs text-[#B0A79E] font-sans font-light mt-0.5">Создайте ИИ-клон вашего голоса для автоответчика за 15 секунд</p>
        </div>
      </div>

      {cloningState === 'idle' && (
        <div className="space-y-6 font-sans">
          <div className="space-y-2.5">
            <label className="text-xs font-medium text-[#C5A059] uppercase tracking-wider font-serif-geos">
              1. Выберите базовый тембр для калибровки:
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {baseVoices.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedBaseVoice(v.id)}
                  className={`text-left p-3.5 rounded-2xl border text-sm transition-all duration-300 cursor-pointer ${
                    selectedBaseVoice === v.id
                      ? 'border-[#C5A059]/50 bg-[#C5A059]/15 text-[#EAE6DF] shadow-md font-medium'
                      : 'border-[#DCD6CD]/10 bg-[#231E1B] text-[#B0A79E] hover:border-[#DCD6CD]/25'
                  }`}
                >
                  <p className="font-medium text-[#EAE6DF]">{v.name}</p>
                  <p className="text-xs text-[#8E847A] font-light truncate mt-0.5">{v.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="border border-[#DCD6CD]/15 bg-[#1C1816]/70 rounded-2xl p-6 text-center flex flex-col items-center justify-center">
            {isRecording ? (
              <div className="space-y-4 w-full">
                <div className="flex items-center justify-center gap-1.5 h-14">
                  {recordings.slice(-30).map((height, i) => (
                    <div
                      key={i}
                      className="w-1 bg-[#C5A059] rounded-full transition-all duration-100"
                      style={{
                        height: `${height}%`
                      }}
                    />
                  ))}
                </div>
                <div className="text-[#C5A059] text-sm tracking-wider font-medium font-serif-geos">
                  Идет запись... 00:{(recordTime / 10).toFixed(1)}с
                </div>
                <p className="text-xs text-[#B0A79E] italic max-w-sm mx-auto font-light leading-relaxed">
                  «Здравствуйте, я подключаю автономного сотрудника для моего бизнеса, чтобы отвечать клиентам 24/7»
                </p>
                <button 
                  onClick={stopRecording} 
                  className="mx-auto mt-2 px-5 py-2.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 font-medium text-xs uppercase tracking-widest transition-all cursor-pointer flex items-center gap-2 font-serif-geos"
                >
                  <Square className="h-3.5 w-3.5 fill-current" /> Остановить
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="relative flex items-center justify-center mx-auto w-16 h-16">
                  <span className="absolute inset-0 rounded-full bg-[#C5A059]/20 animate-mic-wave" />
                  <div className="relative w-14 h-14 rounded-full bg-[#28221F] border border-[#C5A059]/40 flex items-center justify-center text-[#C5A059] shadow-lg">
                    <Mic className="h-6 w-6" />
                  </div>
                </div>
                <p className="text-xs text-[#B0A79E] max-w-sm mx-auto font-light leading-relaxed">
                  Нажмите кнопку ниже и прочитайте вслух предложение в кавычках (рекомендуется записать от 5 до 10 секунд).
                </p>
                <button 
                  onClick={startRecording} 
                  className="mx-auto px-6 py-3 rounded-full bg-[#DCD6CD] hover:bg-[#EAE6DF] text-[#1A1614] font-medium text-xs uppercase tracking-widest transition-all duration-300 shadow-md flex items-center gap-2 cursor-pointer font-serif-geos"
                >
                  <Mic className="h-4 w-4" /> Начать запись голоса
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {cloningState === 'recording_done' && (
        <div className="space-y-5 text-center py-4 font-sans">
          <div className="flex items-center justify-center gap-2 text-[#C5A059]">
            <Check className="h-5 w-5 bg-[#C5A059]/20 p-0.5 rounded-full" />
            <span className="text-sm font-medium text-[#EAE6DF]">Аудио успешно записано ({(recordTime / 10).toFixed(1)} сек)</span>
          </div>
          <div className="flex gap-3 justify-center">
            <button 
              onClick={handleReset} 
              className="px-5 py-2.5 rounded-full bg-[#28221F] border border-[#DCD6CD]/20 text-[#DCD6CD] hover:bg-[#322B27] text-xs font-serif-geos uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Записать заново
            </button>
            <button 
              onClick={startCloningProcess} 
              className="px-6 py-2.5 rounded-full bg-[#DCD6CD] hover:bg-[#EAE6DF] text-[#1A1614] text-xs font-serif-geos font-medium uppercase tracking-widest transition-all cursor-pointer shadow-md"
            >
              Склонировать мой голос
            </button>
          </div>
        </div>
      )}

      {cloningState === 'processing' && (
        <div className="space-y-4 py-4 font-sans">
          <div className="flex justify-between items-center text-xs text-[#B0A79E]">
            <span>Обработка ML-алгоритмами Gemini TTS...</span>
            <span className="text-[#C5A059] font-bold">{Math.round((processingStep / steps.length) * 100)}%</span>
          </div>
          <div className="w-full bg-[#1C1816] rounded-full h-1.5 overflow-hidden border border-[#DCD6CD]/10">
            <div
              className="bg-gradient-to-r from-[#C5A059] to-[#D8B46E] h-full transition-all duration-500 shadow-[0_0_10px_rgba(197,160,89,0.5)]"
              style={{ width: `${(processingStep / steps.length) * 100}%` }}
            />
          </div>
          <div className="space-y-2 bg-[#231E1B] p-4 rounded-2xl border border-[#DCD6CD]/10">
            {steps.map((step, idx) => (
              <div
                key={idx}
                className={`text-xs flex items-center gap-2 ${
                  idx < processingStep
                    ? 'text-[#C5A059] font-medium'
                    : idx === processingStep
                    ? 'text-[#EAE6DF] animate-pulse'
                    : 'text-[#787068]'
                }`}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
                <span>{step}</span>
                {idx < processingStep && <Check className="h-3.5 w-3.5 text-[#C5A059] ml-auto" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {cloningState === 'done' && (
        <div className="space-y-4 pt-2 font-sans">
          <div className="selin-status-mint rounded-2xl p-4 flex gap-3.5 items-start">
            <div className="bg-[#30D158]/20 text-[#30D158] p-2 rounded-xl mt-0.5">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-[#EAE6DF] font-serif-geos">Голосовой клон успешно запущен!</h4>
              <p className="text-xs text-[#B0A79E] mt-1 font-light leading-relaxed">
                Голосовой вектор извлечен и зашифрован. Ваши сотрудники готовы озвучивать свои ответы вашим голосом.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-[#231E1B] p-3.5 rounded-2xl border border-[#DCD6CD]/10 flex flex-col justify-between">
              <div className="text-[#8E847A]">Ключ дешифрации (AES-256):</div>
              <div className="text-[#C5A059] font-medium mt-1 flex items-center gap-1.5 font-mono">
                <Lock className="h-3.5 w-3.5 text-[#C5A059]" />
                {aesToken}
              </div>
            </div>
            <div className="bg-[#231E1B] p-3.5 rounded-2xl border border-[#DCD6CD]/10 flex flex-col justify-between">
              <div className="text-[#8E847A]">Вектор голоса (Database ID):</div>
              <div className="text-[#EAE6DF] font-medium truncate mt-1 font-mono">
                {vectorString}
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button 
              onClick={handleReset} 
              className="text-xs px-4 py-2 rounded-full bg-[#28221F] border border-[#DCD6CD]/20 text-[#DCD6CD] hover:bg-[#322B27] transition-all cursor-pointer font-serif-geos uppercase tracking-wider"
            >
              Сбросить клон
            </button>
          </div>
        </div>
      )}
    </GlassPanel>
  );
};
