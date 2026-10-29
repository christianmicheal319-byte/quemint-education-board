import React, { useState } from 'react';
import { Lock, ShieldCheck, X, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { Candidate, ExamSettings, ExamStartFlowType } from '../types';
import { verifyCandidatePassword } from '../utils/passwordHash';

interface VerifyIdentityModalProps {
  candidate: Candidate;
  settings: ExamSettings;
  onCancel: () => void;
  onVerified: (examStartFlow: ExamStartFlowType) => void;
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
    candidate.middleName ? candidate.middleName + ' ' : ''
  }${candidate.surname}`.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!passwordInput.trim()) {
      setErrorMsg('Please enter your password to verify your identity.');
      return;
    }

    setVerifying(true);
    try {
      const response = await fetch('/api/exam/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: candidate.id,
          enteredPassword: passwordInput,
          candidatePassword: candidate.password,
          candidatePasswordHash: candidate.passwordHash,
        }),
      });
      const data = await response.json();
      if (response.ok && data?.verified) {
        const flow: ExamStartFlowType =
          data.examStartFlow || settings.examStartFlow || 'dashboard_first';
        onVerified(flow);
        return;
      }
      // Fallback local verification in case server state hasn't synced yet
      const localCheck = await verifyCandidatePassword({
        enteredPassword: passwordInput,
        candidatePassword: candidate.password,
        candidatePasswordHash: candidate.passwordHash,
        masterPassword: settings.defaultCandidatePassword || 'quemint2026',
        masterPasswordHash: settings.defaultCandidatePasswordHash,
      });
      if (localCheck.verified) {
        onVerified(settings.examStartFlow || 'dashboard_first');
      } else {
        setErrorMsg(
          data?.message || 'Incorrect password. Please try again or contact admin.'
        );
      }
    } catch {
      const localCheck = await verifyCandidatePassword({
        enteredPassword: passwordInput,
        candidatePassword: candidate.password,
        candidatePasswordHash: candidate.passwordHash,
        masterPassword: settings.defaultCandidatePassword || 'quemint2026',
        masterPasswordHash: settings.defaultCandidatePasswordHash,
      });
      if (localCheck.verified) {
        onVerified(settings.examStartFlow || 'dashboard_first');
      } else {
        setErrorMsg('Incorrect password. Please try again or contact admin.');
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] overflow-hidden shadow-2xl">
        <div className="bg-[#0a6b3c] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5" />
            <div>
              <h3 className="text-base font-extrabold tracking-tight">Verify Identity</h3>
              <p className="text-[11px] text-white/85">
                Candidate Security Authentication
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-white/15 text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 font-semibold">Candidate:</span>
              <span className="font-extrabold text-black">{fullName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 font-semibold">Reg Number:</span>
              <span className="font-mono font-extrabold text-[#0a6b3c]">
                {candidate.regNumber}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-500 font-semibold">Category:</span>
              <span className="font-bold text-black">{candidate.category}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-neutral-700 mb-1.5">
              Enter Your Candidate Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter your registration password"
                className="w-full pl-10 pr-10 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-sm font-semibold text-black bg-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black cursor-pointer"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl border border-neutral-300 hover:border-black text-xs font-bold text-neutral-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={verifying}
              className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify &amp; Continue</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
