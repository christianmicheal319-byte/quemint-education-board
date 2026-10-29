import React from 'react';

export const QUEMINT_LOGO_URL = '/assets/aistudio/IMG-20261025-WA0017_5ef22d59.jpg';

interface QuemintSealProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'green' | 'white' | 'dark';
  subtitle?: string;
  showText?: boolean;
}

export const QuemintSeal: React.FC<QuemintSealProps> = ({
  size = 'md',
  variant = 'green',
  subtitle = 'Official Examination Board',
  showText = true,
}) => {
  const circleSizes = {
    sm: 'w-10 h-10',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  const titleSizes = {
    sm: 'text-sm md:text-base',
    md: 'text-base md:text-lg',
    lg: 'text-xl md:text-2xl',
  };

  const isWhite = variant === 'white';

  return (
    <div className="inline-flex items-center gap-3 select-none">
      <div
        className={`${circleSizes[size]} rounded-full bg-white flex items-center justify-center border-2 overflow-hidden shrink-0 shadow-xs ${
          isWhite ? 'border-white' : 'border-[#0a6b3c]/30'
        }`}
      >
        <img
          src={QUEMINT_LOGO_URL}
          alt="Quemint Education Board Official Logo"
          className="w-full h-full object-contain scale-110 rounded-full"
        />
      </div>
      {showText && (
        <div className="flex flex-col text-left">
          <span
            className={`${titleSizes[size]} font-extrabold tracking-tight leading-tight ${
              isWhite ? 'text-white' : 'text-[#0a6b3c]'
            }`}
          >
            Quemint Education Board
          </span>
          {subtitle && (
            <span
              className={`text-xs font-semibold leading-tight mt-0.5 ${
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
