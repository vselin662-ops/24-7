import React from 'react';

interface NeonButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  id?: string;
  variant?: 'accent' | 'red' | 'glass';
  glow?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export const NeonButton: React.FC<NeonButtonProps> = ({
  id,
  variant = 'accent',
  glow = true,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  let baseStyle = 'relative px-6 py-3 rounded-xl transition-all duration-300 active:scale-95 hover:scale-[1.02] flex items-center justify-center gap-2.5 text-sm font-medium font-modern';
  let variantStyle = '';

  // map 'accent' to luxury white button style
  if (variant === 'accent') {
    variantStyle = `bg-white text-black border border-white hover:bg-slate-100 cursor-pointer ${
      glow ? 'shadow-[0_0_25px_rgba(255,255,255,0.3)] hover:shadow-[0_0_35px_rgba(255,255,255,0.5)]' : ''
    }`;
  } else if (variant === 'red') {
    variantStyle = `bg-red-500/10 border border-red-500/25 text-red-400 hover:bg-red-500/20 hover:border-red-500/40 cursor-pointer ${
      glow ? 'shadow-[0_0_20px_rgba(239,68,68,0.2)]' : ''
    }`;
  } else {
    variantStyle = 'bg-white/5 border border-white/12 text-white hover:bg-white/10 hover:border-white/25 cursor-pointer backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.2)]';
  }

  const isDisabled = disabled || loading;

  return (
    <button
      id={id}
      className={`${baseStyle} ${variantStyle} ${isDisabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-white' : ''} ${className}`}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  );
};

