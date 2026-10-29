import React from 'react';

export const QUEMINT_LOGO_URL = '/assets/aistudio/IMG-20261025-WA0017_5ef22d59.jpg';

interface QuemintSealProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'green' | 'white';
  showText?: boolean;
  subtitle?: string;
}

export const QuemintSeal: React.FC<QuemintSealProps> = ({
  size = 'md',
  variant = 'green',
  showText = true,
  subtitle = 'Official Examination & Assessment Board',
}) => {
  const dimensions = {
    sm: 'w-9 h-9',
    md: 'w-11 h-11',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  }[size];

  const isWhite = variant === 'white';

  return (
    <div className="inline-flex items-center gap-3 select-none shrink-0">
      <div
        className={`${dimensions} relative flex items-center justify-center rounded-full shrink-0 overflow-hidden bg-white ${
          isWhite
            ? 'border-2 border-white shadow-sm'
            : 'border-2 border-[#0a6b3c]/25 shadow-sm'
        }`}
        title="Quemint Education Board Official Logo"
      >
        <img
          src={QUEMINT_LOGO_URL}
          alt="Quemint Education Board Official Logo"
          className="w-full h-full object-contain rounded-full bg-white"
        />
      </div>

      {showText && (
        <div className="flex flex-col">
          <span
            className={`font-extrabold tracking-tight leading-tight whitespace-nowrap ${
              size === 'lg' || size === 'xl' ? 'text-xl' : 'text-base'
            } ${isWhite ? 'text-white' : 'text-[#0a6b3c]'}`}
          >
            Quemint Education Board
          </span>
          {subtitle && (
            <span
              className={`text-xs font-medium whitespace-nowrap ${
                isWhite ? 'text-white/85' : 'text-neutral-600'
              }`}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

