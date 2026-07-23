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
  let baseStyle = 'relative px-6 py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2.5 text-sm font-medium';
  let variantStyle = '';

  // map 'accent' to premium gold outline/translucent luxury style
  if (variant === 'accent') {
    variantStyle = `bg-[#F5A623]/5 text-[#F5A623] border border-[#F5A623]/40 hover:bg-[#F5A623]/10 hover:border-[#F5A623]/60 cursor-pointer ${
      glow ? 'shadow-[0_4px_20px_rgba(245,166,35,0.06)]' : ''
    }`;
  } else if (variant === 'red') {
    variantStyle = `bg-red-500/5 border border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/35 cursor-pointer ${
      glow ? 'shadow-[0_4px_20px_rgba(239,68,68,0.04)]' : ''
    }`;
  } else {
    variantStyle = 'bg-white/[0.02] border border-white/[0.08] text-white hover:bg-white/[0.06] hover:border-white/20 cursor-pointer backdrop-blur-md';
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

