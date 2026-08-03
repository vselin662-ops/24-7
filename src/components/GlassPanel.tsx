import React from 'react';

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  id?: string;
  glowColor?: 'accent' | 'red' | 'none';
  children: React.ReactNode;
}

export const GlassPanel: React.FC<GlassPanelProps> = ({
  id,
  glowColor = 'none',
  children,
  className = '',
  ...props
}) => {
  let glowClasses = '';
  if (glowColor === 'accent') {
    glowClasses = 'lux-shadow border-white/25';
  } else if (glowColor === 'red') {
    glowClasses = 'shadow-[0_15px_50px_rgba(239,68,68,0.12)] border-red-500/20';
  }

  return (
    <div
      id={id}
      className={`glass-panel glass-panel-hover rounded-2xl p-6 sm:p-8 ${glowClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

