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
    glowClasses = 'shadow-[0_0_20px_rgba(245,166,35,0.15)] border-accent/20';
  } else if (glowColor === 'red') {
    glowClasses = 'shadow-[0_0_15px_rgba(239,68,68,0.15)] border-red-500/20';
  }

  return (
    <div
      id={id}
      className={`premium-card rounded-2xl p-8 ${glowClasses} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

