import React from 'react';
import { VoiceState } from '../hooks/useVoiceRecorder';

export interface VoiceButtonProps {
  state: VoiceState;
  volume?: number;
  duration?: number;
  onClick?: () => void;
  error?: string | null;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  state = 'idle',
  volume = 0,
  duration = 0,
  onClick,
  error,
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
          boxShadow: '0 4px 20px rgba(239, 68, 68, 0.5), 0 0 40px rgba(239, 68, 68, 0.2)',
          animation: 'voice-pulse-scale 1s ease-in-out infinite',
        };
      case 'processing':
        return {
          background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
          boxShadow: '0 4px 20px rgba(124, 58, 237, 0.5), 0 0 40px rgba(124, 58, 237, 0.2)',
        };
      case 'speaking':
        return {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          boxShadow: '0 4px 20px rgba(16, 185, 129, 0.5), 0 0 40px rgba(16, 185, 129, 0.2)',
          transform: `scale(${1 + Math.min(volume, 1) * 0.12})`,
        };
      case 'idle':
      default:
        return {
          background: 'linear-gradient(135deg, #C5A059 0%, #8C6F38 100%)',
          boxShadow: '0 4px 20px rgba(197, 160, 89, 0.4), 0 0 40px rgba(197, 160, 89, 0.1)',
          animation: 'voice-gold-pulse 2s infinite ease-in-out',
        };
    }
  };

  // Status caption under button
  const getStatusText = () => {
    if (error) return error;
    switch (state) {
      case 'recording':
        return 'Слушаю...';
      case 'processing':
        return 'Думаю...';
      case 'speaking':
        return 'Говорю...';
      case 'idle':
      default:
        return 'Нажми чтобы говорить';
    }
  };

  return (
    <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center pointer-events-auto select-none">
      {/* CSS Keyframe Animations */}
      <style>{`
        @keyframes voice-gold-pulse {
          0%, 100% {
            box-shadow: 0 4px 20px rgba(197, 160, 89, 0.4), 0 0 40px rgba(197, 160, 89, 0.1);
          }
          50% {
            box-shadow: 0 4px 28px rgba(197, 160, 89, 0.75), 0 0 50px rgba(197, 160, 89, 0.35);
          }
        }
        @keyframes voice-pulse-scale {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        @keyframes voice-ripple-expand {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(2);
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
              className="absolute inset-0 rounded-full border-2 border-red-500/50 pointer-events-none"
              style={{ animation: 'voice-ripple-expand 1.5s cubic-bezier(0, 0.2, 0.8, 1) infinite' }}
            />
            <div
              className="absolute inset-0 rounded-full border-2 border-red-500/50 pointer-events-none"
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
            className="absolute -inset-2.5 rounded-full border-2 border-transparent border-t-purple-500/80 pointer-events-none"
            style={{ animation: 'voice-spin-ring 1s linear infinite' }}
          />
        )}

        {/* Main 64x64px Circle Button */}
        <button
          type="button"
          onClick={onClick}
          style={getButtonStyle()}
          className="w-[64px] h-[64px] rounded-full border-none flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-95 active:scale-90 relative z-10 outline-none"
          title={state === 'recording' ? 'Остановить запись' : 'Нажмите, чтобы говорить'}
        >
          {/* STATE 1 & 2: Microphone SVG Icon (white, 24x24px) */}
          {(state === 'idle' || state === 'recording') && (
            <svg
              className="w-6 h-6 text-white transition-transform duration-200"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
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
                className="w-2 h-2 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0s' }}
              />
              <span
                className="w-2 h-2 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0.2s' }}
              />
              <span
                className="w-2 h-2 bg-white rounded-full"
                style={{ animation: 'voice-bounce-dot 1.2s infinite ease-in-out', animationDelay: '0.4s' }}
              />
            </div>
          )}

          {/* STATE 4: Speaking - Sound Wave Bars */}
          {state === 'speaking' && (
            <div className="flex items-center gap-1 h-5">
              <span
                className="w-1 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0s' }}
              />
              <span
                className="w-1 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0.2s' }}
              />
              <span
                className="w-1 bg-white rounded-full h-full"
                style={{ animation: 'voice-wave-bar 0.8s infinite ease-in-out', animationDelay: '0.4s' }}
              />
            </div>
          )}
        </button>

        {/* Timer floating badge during recording */}
        {state === 'recording' && (
          <div className="absolute -right-12 top-1/2 -translate-y-1/2 bg-black/80 border border-red-500/40 text-white/90 text-[11px] font-mono px-2 py-0.5 rounded-md backdrop-blur-md shadow-lg">
            {formatTime(duration)}
          </div>
        )}
      </div>

      {/* Sub-caption under button */}
      <div className="mt-2 text-center text-[11px] font-medium tracking-wide text-white/40">
        {getStatusText()}
      </div>
    </div>
  );
};
