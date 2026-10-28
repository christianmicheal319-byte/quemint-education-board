import React, { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, AlertCircle, X, ArrowRight } from 'lucide-react';
import { Candidate, ExamSettings, ExamStartFlowType } from '../types';
import { verifyPasswordMatch } from '../utils/passwordHash';

interface VerifyIdentityModalProps {
  candidate: Candidate;
  settings: ExamSettings;
  onCancel: () => void;
  onVerified: (flow: ExamStartFlowType) => void;
}

export const VerifyIdentityModal: React.FC<VerifyIdentityModalProps> = ({
  candidate,
  settings,
  onCancel,
  onVerified,
}) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [verifying, setVerifying] = useState(false);

  const fullName = `${candidate.firstName} ${
    candidate.middleName ? `${candidate.middleName} ` : ''
  }${candidate.surname}`.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanInput = passwordInput.trim();
    if (!cleanInput) {
      setErrorMsg('Incorrect password. Please try again or contact admin.');
      return;
    }

    setVerifying(true);
    try {
      // 1. Check client-side hashed comparison against personal password OR Admin Default Master Password
      const matchesPersonalLocal = await verifyPasswordMatch(
        cleanInput,
        candidate.password,
        candidate.passwordHash
      );

      const sysMap: Record<string, string> = Array.isArray(settings.systemSettings)
        ? settings.systemSettings.reduce((acc: Record<string, string>, item: any) => {
            if (item && typeof item.key === 'string') {
              acc[item.key] = String(item.value ?? '');
            }
            return acc;
          }, {})
        : settings.systemSettings && typeof settings.systemSettings === 'object'
        ? settings.systemSettings
        : {};

      const defaultMasterPlain = settings.defaultCandidatePassword || 'quemint2026';
      const defaultMasterHash =
        settings.defaultCandidatePasswordHash ||
        sysMap.default_candidate_password;

      const matchesMasterLocal = await verifyPasswordMatch(
        cleanInput,
        defaultMasterPlain,
        defaultMasterHash
      );

      // 2. Also verify against backend /api/candidate/verify-password endpoint
      let serverVerified = false;
      let serverFlow: ExamStartFlowType | undefined;
      try {
        const res = await fetch('/api/candidate/verify-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId: candidate.id,
            enteredPassword: cleanInput,
            candidatePassword: candidate.password,
            candidatePasswordHash: candidate.passwordHash,
          }),
        });
        const data = await res.json();
        if (res.ok && data?.verified) {
          serverVerified = true;
          if (data.examStartFlow === 'immediate' || data.examStartFlow === 'dashboard_first') {
            serverFlow = data.examStartFlow;
          }
        }
      } catch {
        // Fallback to local verification if offline
      }

      if (matchesPersonalLocal || matchesMasterLocal || serverVerified) {
        const configuredFlow: ExamStartFlowType =
          (settings.examStartFlow as ExamStartFlowType) ||
          (sysMap.exam_start_flow as ExamStartFlowType) ||
          serverFlow ||
          'dashboard_first';
        onVerified(configuredFlow === 'immediate' ? 'immediate' : 'dashboard_first');
      } else {
        setErrorMsg('Incorrect password. Please try again or contact admin.');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="w-full max-w-md bg-white text-black rounded-3xl border-2 border-[#0a6b3c] shadow-2xl overflow-hidden">
        {/* Top Green Header */}
        <div className="bg-[#0a6b3c] px-6 py-4 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="block text-[10px] font-extrabold uppercase tracking-widest text-white/80">
                CANDIDATE AUTHENTICATION
              </span>
              <h3 className="text-base font-extrabold tracking-tight">Verify Identity</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="p-4 rounded-2xl bg-[#0a6b3c]/5 border border-[#0a6b3c]/25 space-y-1">
            <p className="text-xs md:text-sm font-bold text-black leading-relaxed">
              Welcome, <span className="text-[#0a6b3c] font-extrabold">{fullName}</span>! Please enter your password to start your exam.
            </p>
            <div className="text-[11px] font-mono font-bold text-neutral-600">
              Reg No: {candidate.regNumber} • {candidate.category}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-neutral-700 mb-2">
              Candidate Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                value={passwordInput}
                onChange={(e) => {
                  setPasswordInput(e.target.value);
                  if (errorMsg) setErrorMsg('');
                }}
                placeholder="Enter your personal or exam password"
                className="w-full pl-10 pr-11 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-sm font-semibold text-black bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-neutral-500 hover:text-[#0a6b3c] transition-colors cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2.5 rounded-xl border border-neutral-300 hover:border-neutral-400 bg-white text-neutral-700 hover:text-black text-xs font-extrabold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={verifying}
              className="px-6 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-60"
            >
              <span>{verifying ? 'Verifying...' : 'Continue'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
