import React from 'react';
import { VoiceState } from '../hooks/useVoiceRecorder';

export interface VoiceButtonProps {
  state: VoiceState;
  volume?: number;
  duration?: number;
  onClick?: () => void;
  error?: string | null;
  onOpenPermissionGuide?: () => void;
  variant?: 'embedded' | 'hero' | 'floating' | 'compact';
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  state = 'idle',
  volume = 0,
  duration = 0,
  onClick,
  error,
  onOpenPermissionGuide,
  variant = 'embedded',
}) => {
  // Format duration into MM:SS e.g. "0:05"
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Determine button inline style based on state
  const getButtonStyle = () => {
    switch (state) {
      case 'recording':
        return {
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          boxShadow: '0 4px 25px rgba(239, 68, 68, 0.6), 0 0 50px rgba(239, 68, 68, 0.3)',
          animation: 'voice-pulse-scale 1s ease-in-out infinite',
        };
      case 'processing':
        return {
          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
          boxShadow: '0 4px 25px rgba(124, 58, 237, 0.6), 0 0 50px rgba(124, 58, 237, 0.3)',
        };
      case 'speaking':
        return {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          boxShadow: '0 4px 25px rgba(16, 185, 129, 0.6), 0 0 50px rgba(16, 185, 129, 0.3)',
          transform: `scale(${1 + Math.min(volume, 1) * 0.12})`,
        };
      case 'idle':
      default:
        return {
          background: 'linear-gradient(135deg, #C5A059 0%, #9E7D3B 100%)',
          boxShadow: '0 4px 20px rgba(197, 160, 89, 0.35), 0 0 35px rgba(197, 160, 89, 0.15)',
          animation: 'voice-gold-pulse 2s infinite ease-in-out',
        };
    }
  };

  // Status caption
  const getStatusText = () => {
    if (error) {
      return error.length > 45 ? error.substring(0, 42) + '...' : error;
    }
    switch (state) {
      case 'recording':
        return 'Идёт запись... Нажмите, чтобы завершить';
      case 'processing':
        return 'Распознаю речь и думаю...';
      case 'speaking':
        return 'Selin говорит... (нажмите, чтобы остановить)';
      case 'idle':
      default:
        return 'Нажмите на микрофон и скажите запрос';
    }
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        style={getButtonStyle()}
        className="w-9 h-9 rounded-xl border border-[#C5A059]/40 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 outline-none shadow-md"
        title={state === 'recording' ? 'Остановить запись' : 'Голосовой ввод'}
        aria-label="Голосовой ввод"
      >
        <svg
          className="w-4 h-4 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </button>
    );
  }

  const containerClasses = variant === 'floating'
    ? 'fixed bottom-[85px] sm:bottom-[90px] left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center pointer-events-auto select-none'
    : 'w-full flex flex-col items-center justify-center p-6 rounded-2xl bg-[#1A1412] border border-[#332822] shadow-xl relative overflow-hidden select-none my-6';

  return (
    <div className={containerClasses}>
      {/* CSS Keyframe Animations */}
      <style>{`
        @keyframes voice-gold-pulse {
          0%, 100% {
            box-shadow: 0 4px 20px rgba(197, 160, 89, 0.35), 0 0 35px rgba(197, 160, 89, 0.15);
          }
          50% {
            box-shadow: 0 4px 28px rgba(197, 160, 89, 0.65), 0 0 45px rgba(197, 160, 89, 0.3);
          }
        }
        @keyframes voice-pulse-scale {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.08);
          }
        }
        @keyframes voice-ripple-expand {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(2.2);
            opacity: 0;
          }
        }
        @keyframes voice-spin-ring {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes voice-bounce-dot {
          0%, 80%, 100% {
            transform: scale(0.3);
            opacity: 0.3;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes voice-wave-bar {
          0%, 100% {
            transform: scaleY(0.4);
          }
          50% {
            transform: scaleY(1.3);
          }
        }
      `}</style>

      {/* Button Wrapper with ripples and rotating rings */}
      <div className="relative flex items-center justify-center">
        {/* Recording Ripples */}
        {state === 'recording' && (
          <>
            <div
              className="absolute inset-0 rounded-full border-2 border-red-500/60 pointer-events-none"
              style={{ animation: 'voice-ripple-expand 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite' }}
            />
            <div
              className="absolute inset-0 rounded-full border-2 border-red-500/60 pointer-events-none"
              style={{
                animation: 'voice-ripple-expand 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite',
                animationDelay: '0.5s',
              }}
            />
          </>
        )}

        {/* Processing Rotating Ring */}
        {state === 'processing' && (
          <div
            className="absolute -inset-2.5 rounded-full border-2 border-transparent border-t-purple-500/90 pointer-events-none"
            style={{ animation: 'voice-spin-ring 1s linear infinite' }}
          />
        )}

        {/* Main Circle Button */}
        <button
          type="button"
          onClick={onClick}
          onTouchEnd={(e) => {
            e.stopPropagation();
          }}
          style={getButtonStyle()}
          className="w-[72px] h-[72px] rounded-full border-2 border-[#C5A059]/40 flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 relative z-10 outline-none shadow-2xl"
          title={state === 'recording' ? 'Остановить запись' : 'Нажмите, чтобы говорить'}
          aria-label="Голосовой ввод"
        >
          {/* STATE 1 & 2: Microphone SVG Icon */}
          {(state === 'idle' || state === 'recording') && (
            <svg
              className={`w-7 h-7 text-white transition-transform duration-200 ${state === 'recording' ? 'scale-110' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}

          {/* STATE 3: Processing - 3 Bouncing Dots */}
          {state === 'processing' && (
            <div className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0s' }}
              />
              <span
                className="w-2.5 h-2.5 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0.2s' }}
              />
              <span
                className="w-2.5 h-2.5 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0.4s' }}
              />
            </div>
          )}

          {/* STATE 4: Speaking - Sound Wave Bars */}
          {state === 'speaking' && (
            <div className="flex items-center gap-1.5 h-6">
              <span
                className="w-1.5 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0s' }}
              />
              <span
                className="w-1.5 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0.2s' }}
              />
              <span
                className="w-1.5 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0.4s' }}
              />
            </div>
          )}
        </button>

        {/* Timer floating badge during recording */}
        {state === 'recording' && (
          <div className="absolute -right-16 top-1/2 -translate-y-1/2 bg-red-950/90 border border-red-500/50 text-red-100 text-xs font-mono px-3 py-1 rounded-full backdrop-blur-md shadow-lg animate-pulse">
            {formatTime(duration)}
          </div>
        )}
      </div>

      {/* Sub-caption under button */}
      <div 
        onClick={error && onOpenPermissionGuide ? onOpenPermissionGuide : onClick}
        className={`mt-4 text-center text-xs font-medium tracking-wide max-w-sm px-4 py-2 rounded-full cursor-pointer transition-all ${
          error 
            ? 'text-amber-300 bg-amber-950/60 border border-amber-500/30 hover:bg-amber-900/80 shadow-md' 
            : 'text-[#EAE6DF] bg-[#241C18] border border-[#382B24] hover:border-[#C5A059]/40 hover:bg-[#2C221D]'
        }`}
      >
        <div className="flex items-center justify-center gap-2">
          {state === 'recording' && <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />}
          {state === 'speaking' && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
          <span>{getStatusText()}</span>
        </div>
        {error && <span className="block text-[11px] text-amber-200 underline mt-1 font-bold">Нажмите для подсказки по микрофону ℹ️</span>}
      </div>
    </div>
  );
};


