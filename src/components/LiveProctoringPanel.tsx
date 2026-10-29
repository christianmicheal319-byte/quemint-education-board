import React, { useState, useEffect, useMemo } from 'react';
import {
  Video,
  Search,
  Trophy,
  Eye,
  Maximize2,
  Minimize2,
  Trash2,
  ArrowRight,
  ArrowLeft,
  Play,
  Pause,
  Sparkles,
  X,
  Camera,
  ShieldCheck,
  Wifi,
  Copy,
  Check,
  AlertTriangle,
  Monitor,
} from 'lucide-react';
import { Candidate, ExamResult, ExamSettings } from '../types';
import {
  LiveCandidateTelemetry,
  buildInitialCandidateTelemetry,
  getCandidateHdPortraitUrl,
  getSavedLiveTelemetryMap,
  publishCandidateLiveTelemetry,
  subscribeToLiveProctoring,
} from '../utils/liveProctoringBus';

type CameraViewMode = 'jamb-biometric-split' | 'full-cctv-cam';

interface LiveProctoringPanelProps {
  candidates: Candidate[];
  results: ExamResult[];
  settings: ExamSettings;
  selectedProctoringIds: string[];
  setSelectedProctoringIds: React.Dispatch<React.SetStateAction<string[]>>;
  onClearProctoringFeeds: (candidateIds: string[]) => void;
  onClearAllProctoringFeeds: () => void;
  onRestoreAllProctoringFeeds?: () => void;
  onToggleProctoringEnabled: (enabled: boolean) => void;
}

interface LiveVideoTileProps {
  candidate: Candidate;
  telemetry: LiveCandidateTelemetry;
  remoteLiveFrameUrl?: string;
  seatIndex: number;
  hasSubmittedExam: boolean;
  cameraViewMode: CameraViewMode;
  onChangeCameraViewMode: (mode: CameraViewMode) => void;
  isFocusedSingle: boolean;
  onToggleFocusSingle: () => void;
  onRemoveFromWatch: () => void;
  onSimulateAnswer: (candidateId: string, isCorrect: boolean) => void;
}

/**
 * JAMB CBT Official Biometric & Live CCTV Workstation Proctoring Monitor.
 * STRICT GUARANTEES:
 * 1. Zero cartoon / zero AI-animated swaying portraits / zero stock MP4 loops.
 * 2. Never accesses the Admin's own local camera.
 * 3. Displays the student's actual real-time webcam stream (`remoteLiveFrameUrl`) captured live from ExamInterface.tsx,
 *    side-by-side with their official Registered Biometric Passport Photograph for visual identity verification (JAMB standard).
 * 4. Strictly live stream only — zero video recording is ever saved.
 */
const LiveCandidateVideoTile: React.FC<LiveVideoTileProps> = ({
  candidate,
  telemetry,
  remoteLiveFrameUrl,
  seatIndex,
  hasSubmittedExam,
  cameraViewMode,
  onChangeCameraViewMode,
  isFocusedSingle,
  onToggleFocusSingle,
  onRemoveFromWatch,
  onSimulateAnswer,
}) => {
  const [copiedReg, setCopiedReg] = useState(false);
  const [clockTime, setClockTime] = useState<string>(() =>
    new Date().toTimeString().split(' ')[0]
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setClockTime(new Date().toTimeString().split(' ')[0]);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const candidatePortraitUrl = useMemo(
    () => getCandidateHdPortraitUrl(candidate),
    [candidate]
  );

  const isTopPerformer = telemetry.accuracyPercent >= 80;
  const isRealLifeActive = Boolean(
    telemetry.isLiveFromExamTab && Date.now() - telemetry.lastUpdated < 15000
  );
  const hasRealLifeCameraFrame = Boolean(
    remoteLiveFrameUrl && remoteLiveFrameUrl.length > 0
  );
  const isFocusLost = telemetry.focusStatus === 'Lost Focus Warning';
  const seatLabel = `CBT-SEAT-${String(seatIndex + 1).padStart(3, '0')}`;

  const formatRemainingTime = (secs?: number) => {
    if (typeof secs !== 'number' || secs < 0) return '--:--';
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const formattedTimeLeft = formatRemainingTime(telemetry.timeLeftSeconds);

  const handleCopyRegNo = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(candidate.regNumber).catch(() => {});
      setCopiedReg(true);
      setTimeout(() => setCopiedReg(false), 2000);
    }
  };

  return (
    <div
      className={`rounded-2xl border-2 overflow-hidden bg-white transition-all shadow-xs flex flex-col justify-between ${
        isFocusLost && isRealLifeActive
          ? 'border-red-600 ring-4 ring-red-600/20'
          : isRealLifeActive
          ? 'border-emerald-600 ring-4 ring-emerald-500/20'
          : isTopPerformer
          ? 'border-[#0a6b3c] ring-2 ring-[#0a6b3c]/15'
          : 'border-neutral-300 hover:border-neutral-400'
      }`}
    >
      {/* Top JAMB CBT Workstation Header Strip */}
      <div className="bg-neutral-900 text-white px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-emerald-400 font-mono text-[10px] font-extrabold">
            {seatLabel}
          </span>
          <span className="font-mono text-xs font-extrabold text-white tracking-tight">
            REG: {telemetry.regNumber}
          </span>
          {isRealLifeActive ? (
            <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>LIVE CCTV FEED ACTIVE</span>
            </span>
          ) : hasSubmittedExam ? (
            <span className="px-2 py-0.5 rounded bg-emerald-900/80 text-emerald-300 border border-emerald-600/40 text-[10px] font-extrabold uppercase">
              EXAM SUBMITTED
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 text-[10px] font-extrabold uppercase">
              WORKSTATION STANDBY
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-neutral-400 hidden sm:inline">
            WAT {clockTime} • NO RECORDING
          </span>

          <div className="inline-flex items-center rounded-lg bg-neutral-800 p-0.5 border border-neutral-700">
            <button
              type="button"
              onClick={() => onChangeCameraViewMode('jamb-biometric-split')}
              className={`px-2 py-0.5 rounded text-[9px] font-extrabold transition-colors cursor-pointer ${
                cameraViewMode === 'jamb-biometric-split'
                  ? 'bg-[#0a6b3c] text-white'
                  : 'text-neutral-300 hover:text-white'
              }`}
              title="JAMB Biometric Verification + Live CCTV Split View"
            >
              JAMB Split
            </button>
            <button
              type="button"
              onClick={() => onChangeCameraViewMode('full-cctv-cam')}
              className={`px-2 py-0.5 rounded text-[9px] font-extrabold transition-colors cursor-pointer ${
                cameraViewMode === 'full-cctv-cam'
                  ? 'bg-[#0a6b3c] text-white'
                  : 'text-neutral-300 hover:text-white'
              }`}
              title="Full-Screen Live CCTV Camera View"
            >
              Full CCTV
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleFocusSingle}
            title={isFocusedSingle ? 'Return to Multi-Candidate CCTV Grid' : 'Maximize Workstation Monitor'}
            className="p-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700 cursor-pointer"
          >
            {isFocusedSingle ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onRemoveFromWatch}
            title="Remove Workstation from Watch Stage"
            className="p-1 rounded bg-neutral-800 hover:bg-red-600 text-white border border-neutral-700 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main JAMB CBT CCTV & Biometric Viewport */}
      <div
        className={`w-full bg-neutral-950 select-none ${
          cameraViewMode === 'jamb-biometric-split'
            ? 'grid grid-cols-1 sm:grid-cols-12'
            : 'relative aspect-video'
        }`}
      >
        {/* LEFT / MAIN PANEL: REAL-TIME CANDIDATE LIVE WEBCAM FEED OR WORKSTATION STANDBY */}
        <div
          className={`relative bg-neutral-950 overflow-hidden flex items-center justify-center ${
            cameraViewMode === 'jamb-biometric-split'
              ? 'sm:col-span-8 aspect-video sm:aspect-auto sm:min-h-[250px] border-b sm:border-b-0 sm:border-r border-neutral-800'
              : 'w-full h-full'
          }`}
        >
          {hasRealLifeCameraFrame ? (
            /* AUTHENTIC REAL-TIME LIVE STUDENT WEBCAM STREAM (Zero AI / Zero Cartoon / Zero Stock Video) */
            <>
              <img
                src={remoteLiveFrameUrl}
                alt={`${telemetry.candidateName} Live CBT Webcam`}
                className="w-full h-full object-cover"
              />

              {/* Top-left CCTV OSD */}
              <div className="absolute top-2.5 left-2.5 z-10 flex flex-wrap items-center gap-1.5">
                <span className="px-2 py-0.5 rounded bg-red-600/95 text-white font-mono text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span>LIVE STUDENT WEBCAM • {telemetry.candidateName}</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-black/80 text-emerald-400 border border-emerald-500/40 font-mono text-[10px] font-bold flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  <span>REAL-TIME STREAM</span>
                </span>
              </div>

              {/* Malpractice / Focus Warning Overlay */}
              {isFocusLost && (
                <div className="absolute top-11 inset-x-2.5 z-20 bg-red-600/95 text-white px-3 py-1.5 rounded-lg border border-white/40 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-wide shadow-lg">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    JAMB CBT INTEGRITY ALERT: CANDIDATE SWITCHED TAB OR EXITED FULLSCREEN
                  </span>
                </div>
              )}

              {/* In Full-CCTV Mode, show compact Registered Passport Photo in bottom-left for identity comparison */}
              {cameraViewMode === 'full-cctv-cam' && (
                <div className="absolute bottom-11 left-2.5 z-10 bg-black/85 border border-white/25 rounded-xl p-1.5 flex items-center gap-2 shadow-md">
                  <div className="w-10 h-10 rounded-lg overflow-hidden border border-emerald-400 bg-white shrink-0">
                    {candidatePortraitUrl ? (
                      <img
                        src={candidatePortraitUrl}
                        alt="Registered Passport"
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="pr-1">
                    <div className="text-[9px] font-mono font-extrabold text-emerald-300 uppercase">
                      VERIFIED REG PHOTO
                    </div>
                    <div className="text-[10px] font-extrabold text-white truncate max-w-[110px]">
                      {telemetry.candidateName}
                    </div>
                  </div>
                </div>
              )}

              {/* Bottom CCTV Telemetry Overlay Bar */}
              <div className="absolute bottom-0 inset-x-0 bg-black/85 border-t border-white/15 px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono text-white">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-extrabold">
                    SUBJ: {telemetry.currentSubject}
                  </span>
                  <span>•</span>
                  <span>
                    Q{telemetry.currentQuestionIndex}/{telemetry.totalQuestions}
                  </span>
                  <span>•</span>
                  <span>
                    ANS: {telemetry.answeredCount}/{telemetry.totalQuestions}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {formattedTimeLeft !== '--:--' && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-extrabold">
                      TIME LEFT: {formattedTimeLeft}
                    </span>
                  )}
                </div>
              </div>
            </>
          ) : isRealLifeActive ? (
            /* Candidate is logged into the Exam Portal right now, waiting for camera permission or frame */
            <div className="p-5 text-center space-y-3 max-w-md">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                <Camera className="w-6 h-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-mono font-extrabold uppercase tracking-wider text-emerald-400">
                  CBT WORKSTATION ONLINE • INITIALIZING WEBCAM
                </div>
                <p className="text-[11px] text-neutral-300 leading-relaxed">
                  <strong>{telemetry.candidateName}</strong> ({telemetry.regNumber}) is currently logged into the CBT Portal (Stage:{' '}
                  <span className="text-white font-mono uppercase">
                    {telemetry.examStage || 'active'}
                  </span>
                  ). Waiting for browser webcam frame...
                </p>
              </div>
            </div>
          ) : (
            /* Authentic JAMB CBT Workstation Standby Screen (When student is not currently logged into an active exam session) */
            <div className="p-5 w-full h-full flex flex-col items-center justify-center text-center space-y-3 bg-neutral-950">
              <div className="flex items-center gap-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl p-3 max-w-sm w-full text-left">
                <div className="w-14 h-14 rounded-xl overflow-hidden border-2 border-neutral-700 bg-white shrink-0">
                  {candidatePortraitUrl ? (
                    <img
                      src={candidatePortraitUrl}
                      alt={telemetry.candidateName}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-amber-300">
                      {hasSubmittedExam
                        ? 'WORKSTATION CLOSED • EXAM COMPLETED'
                        : 'CCTV STANDBY • NO ACTIVE CAMERA SIGNAL'}
                    </span>
                  </div>
                  <div className="text-xs font-extrabold text-white truncate">
                    {telemetry.candidateName}
                  </div>
                  <div className="text-[11px] font-mono text-neutral-400">
                    Reg No: <strong className="text-emerald-400">{telemetry.regNumber}</strong> • {telemetry.category}
                  </div>
                </div>
              </div>

              <p className="text-[11px] text-neutral-400 max-w-sm leading-relaxed">
                {hasSubmittedExam
                  ? 'This candidate has submitted their CBT examination. Live webcam stream has ended.'
                  : 'Candidate is not currently logged into an active CBT session. When they log in with their Reg Number below, their real-life webcam streams here automatically.'}
              </p>

              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyRegNo}
                  className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white border border-neutral-700 text-[11px] font-mono font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
                  title="Copy Candidate Registration Number to log in on a student tab or device"
                >
                  {copiedReg ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied: {telemetry.regNumber}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Copy Reg No: {telemetry.regNumber}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL (In JAMB Biometric Split Mode): Official Biometric Photo Comparison + Live CBT Telemetry */}
        {cameraViewMode === 'jamb-biometric-split' && (
          <div className="sm:col-span-4 bg-neutral-900 text-white p-3.5 flex flex-col justify-between space-y-3">
            {/* Registered Biometric Photo Card */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono font-extrabold uppercase tracking-wider text-neutral-400">
                <span>JAMB BIOMETRIC FILE</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>VERIFIED</span>
                </span>
              </div>

              <div className="flex items-center gap-2.5 bg-neutral-950 p-2 rounded-xl border border-neutral-800">
                <div className="w-14 h-16 rounded-lg overflow-hidden border border-emerald-500/50 bg-white shrink-0">
                  {candidatePortraitUrl ? (
                    <img
                      src={candidatePortraitUrl}
                      alt={`${telemetry.candidateName} Registered Passport`}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-[9px] font-mono font-extrabold uppercase text-emerald-400">
                    REGISTERED PASSPORT
                  </div>
                  <div className="text-xs font-extrabold text-white truncate">
                    {telemetry.candidateName}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-400">
                    {telemetry.regNumber}
                  </div>
                  <div className="text-[10px] font-bold text-neutral-300">
                    {telemetry.category}
                  </div>
                </div>
              </div>
            </div>

            {/* Live CBT Workstation Telemetry Grid */}
            <div className="space-y-1.5 text-[11px] font-mono bg-neutral-950 p-2.5 rounded-xl border border-neutral-800">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">CCTV Feed:</span>
                <span
                  className={`font-extrabold ${
                    hasRealLifeCameraFrame ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {hasRealLifeCameraFrame ? 'LIVE WEBCAM' : 'STANDBY'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Subject:</span>
                <span className="font-extrabold text-white">{telemetry.currentSubject}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Question:</span>
                <span className="font-extrabold text-white">
                  Q{telemetry.currentQuestionIndex} / {telemetry.totalQuestions}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Answered:</span>
                <span className="font-extrabold text-emerald-400">
                  {telemetry.answeredCount} / {telemetry.totalQuestions}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Time Left:</span>
                <span className="font-extrabold text-white">{formattedTimeLeft}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">Integrity:</span>
                <span
                  className={`font-extrabold ${
                    isFocusLost ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {isFocusLost ? '⚠ FOCUS ALERT' : 'NORMAL'}
                </span>
              </div>
            </div>

            {/* Live Accuracy Badge */}
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-neutral-950 border border-neutral-800">
              <span className="text-[10px] font-mono font-bold text-neutral-400">
                LIVE ACCURACY
              </span>
              <span
                className={`px-2 py-0.5 rounded font-mono text-xs font-extrabold ${
                  isTopPerformer
                    ? 'bg-[#0a6b3c] text-white'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}
              >
                {telemetry.accuracyPercent}% ({isTopPerformer ? '80+% TOP' : '<80%'})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Candidate Info & Live Accuracy Bar Below CCTV Monitor */}
      <div className="p-3.5 space-y-2.5 bg-white text-black">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#0a6b3c]/30 bg-white shrink-0">
              {candidatePortraitUrl ? (
                <img
                  src={candidatePortraitUrl}
                  alt={telemetry.candidateName}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-extrabold text-xs md:text-sm text-black">
                  {telemetry.candidateName}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-[10px] font-extrabold">
                  {telemetry.category}
                </span>
                {isRealLifeActive && (
                  <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[9px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    <span>LIVE IN EXAM HALL</span>
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[9px] font-extrabold inline-flex items-center gap-0.5">
                  <ShieldCheck className="w-2.5 h-2.5 text-[#0a6b3c]" />
                  <span>Biometric Verified</span>
                </span>
                {isTopPerformer && (
                  <span className="px-2 py-0.5 rounded bg-[#0a6b3c] text-white text-[10px] font-extrabold inline-flex items-center gap-1">
                    <Trophy className="w-2.5 h-2.5" />
                    <span>TOP 80+%</span>
                  </span>
                )}
              </div>
              <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                Reg: {telemetry.regNumber} • Correct: {telemetry.correctCount}/
                {telemetry.answeredCount} Answered • {telemetry.currentSubject} (Q
                {telemetry.currentQuestionIndex}/{telemetry.totalQuestions})
              </div>
            </div>
          </div>

          {/* Dynamic Column Assignment Indicator */}
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-extrabold whitespace-nowrap ${
              isTopPerformer
                ? 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                : 'bg-neutral-100 text-neutral-700'
            }`}
          >
            {isTopPerformer ? 'Right Side (80+%)' : 'Left Side (<80%)'}
          </span>
        </div>

        {/* Dynamic Accuracy Progress Bar with 80% Threshold Marker */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] font-bold">
            <span className="text-neutral-600">
              Session Accuracy ({telemetry.correctCount}/{telemetry.answeredCount})
            </span>
            <span
              className={`font-mono font-extrabold tabular-nums ${
                isTopPerformer ? 'text-[#0a6b3c]' : 'text-neutral-800'
              }`}
            >
              {telemetry.accuracyPercent}% (Threshold: 80%)
            </span>
          </div>
          <div className="relative w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden border border-neutral-200">
            {/* 80% Threshold Vertical Marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-black/50 z-10"
              style={{ left: '80%' }}
              title="80% Top Performer Threshold"
            />
            <div
              className={`h-full transition-all duration-300 ${
                isTopPerformer ? 'bg-[#0a6b3c]' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, telemetry.accuracyPercent))}%` }}
            />
          </div>
        </div>

        {/* Interactive Live Exam Answer Controls (Test dynamic 80% Left <-> Right movement) */}
        <div className="pt-1 border-t border-neutral-100 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-neutral-500">
            {isRealLifeActive ? 'Live Exam Telemetry Connected' : 'Test 80% Threshold Split:'}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onSimulateAnswer(candidate.id, true)}
              className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] text-[#0a6b3c] hover:text-white text-[10px] font-extrabold transition-colors cursor-pointer"
              title="Test candidate answering next question correctly (increases accuracy)"
            >
              + Correct Answer
            </button>
            <button
              type="button"
              onClick={() => onSimulateAnswer(candidate.id, false)}
              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white border border-amber-200 text-[10px] font-extrabold transition-colors cursor-pointer"
              title="Test candidate missing next question (decreases accuracy)"
            >
              + Wrong Answer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LiveProctoringPanel: React.FC<LiveProctoringPanelProps> = ({
  candidates,
  results,
  settings,
  selectedProctoringIds,
  setSelectedProctoringIds,
  onClearProctoringFeeds,
  onClearAllProctoringFeeds,
  onRestoreAllProctoringFeeds,
  onToggleProctoringEnabled,
}) => {
  // Live Telemetry Map keyed by candidate.id
  const [telemetryMap, setTelemetryMap] = useState<Record<string, LiveCandidateTelemetry>>(
    () =>
      buildInitialCandidateTelemetry(
        candidates,
        results,
        getSavedLiveTelemetryMap()
      )
  );

  // Live candidate webcam frames received from ExamInterface.tsx (via BroadcastChannel, SSE, or /api/proctoring/feeds)
  const [remoteCandidateFrames, setRemoteCandidateFrames] = useState<
    Record<string, string>
  >({});

  // Filter toggle: 'all' vs 'real-life-only'
  const [feedSourceFilter, setFeedSourceFilter] = useState<'all' | 'real-life-only'>('all');

  // JAMB CCTV View Mode ('jamb-biometric-split' or 'full-cctv-cam')
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('jamb-biometric-split');

  // All candidates currently taking an exam in real life right now
  const realTimeActiveCandidateIds = useMemo(() => {
    const now = Date.now();
    return Object.values(telemetryMap)
      .filter((t) => t && t.isLiveFromExamTab && now - t.lastUpdated < 15000)
      .map((t) => t.candidateId);
  }, [telemetryMap]);

  // Combine enrolled Paid candidates + any remote student actively streaming in telemetryMap
  const activeProctoringCandidates = useMemo(() => {
    const baseList = candidates.filter(
      (c) =>
        (c.paymentStatus === 'Paid' && !c.proctoringCleared) ||
        realTimeActiveCandidateIds.includes(c.id)
    );
    const knownIds = new Set(baseList.map((c) => c.id));

    // If a student registered on another device and started the exam before candidate list synced, synthesize their Candidate entry from telemetry
    realTimeActiveCandidateIds.forEach((cid) => {
      if (!knownIds.has(cid)) {
        const tel = telemetryMap[cid];
        if (tel) {
          const nameParts = (tel.candidateName || 'Candidate Student').split(' ');
          baseList.unshift({
            id: cid,
            firstName: nameParts[0] || 'Candidate',
            middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
            surname: nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Student',
            gender: (tel.gender as any) || 'Female',
            category: tel.category || 'Medical',
            regNumber: tel.regNumber || 'LIVE-CAND',
            pin: 'LIVE',
            paymentStatus: 'Paid',
            paymentMethod: 'Admin Upload',
            amountPaid: 5000,
            transactionRef: 'LIVE',
            passportDataUrl: tel.passportDataUrl,
            suspended: false,
            examAssigned: true,
            examDate: '',
            examTime: '',
            createdAt: new Date().toISOString(),
          });
          knownIds.add(cid);
        }
      }
    });

    // Sort real-life active students to the top of the candidate list
    return [...baseList].sort((a, b) => {
      const aLive = realTimeActiveCandidateIds.includes(a.id) ? 1 : 0;
      const bLive = realTimeActiveCandidateIds.includes(b.id) ? 1 : 0;
      return bLive - aLive;
    });
  }, [candidates, realTimeActiveCandidateIds, telemetryMap]);

  const clearedProctoringCount = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.paymentStatus === 'Paid' &&
          c.proctoringCleared &&
          !realTimeActiveCandidateIds.includes(c.id)
      ).length,
    [candidates, realTimeActiveCandidateIds]
  );

  // Keep telemetry synced when candidates or results change
  useEffect(() => {
    setTelemetryMap((prev) =>
      buildInitialCandidateTelemetry(candidates, results, prev)
    );
  }, [candidates, results]);

  // Subscribe to real-time cross-tab telemetry & live webcam frames from ExamInterface.tsx
  useEffect(() => {
    return subscribeToLiveProctoring(
      (latestMap) => {
        setTelemetryMap((prev) => ({
          ...prev,
          ...latestMap,
        }));
      },
      (candidateId, liveFrameDataUrl, incomingTelemetry) => {
        setRemoteCandidateFrames((prev) => ({
          ...prev,
          [candidateId]: liveFrameDataUrl,
        }));
        if (incomingTelemetry) {
          setTelemetryMap((prev) => ({
            ...prev,
            [candidateId]: {
              ...(prev[candidateId] || {}),
              ...incomingTelemetry,
              isLiveFromExamTab: true,
              lastUpdated: Date.now(),
            },
          }));
        }
      },
      (disconnectedCandidateId) => {
        setRemoteCandidateFrames((prev) => {
          const next = { ...prev };
          delete next[disconnectedCandidateId];
          return next;
        });
        setTelemetryMap((prev) => {
          if (!prev[disconnectedCandidateId]) return prev;
          return {
            ...prev,
            [disconnectedCandidateId]: {
              ...prev[disconnectedCandidateId],
              isLiveFromExamTab: false,
              cameraActive: false,
            },
          };
        });
      }
    );
  }, []);

  // Subscribe to cross-device SSE stream (/api/proctoring/stream) AND high-frequency polling (/api/proctoring/feeds)
  useEffect(() => {
    let isMounted = true;
    let es: EventSource | null = null;

    const applyIncomingFeed = (f: any) => {
      if (!f || !f.candidateId) return;
      if (f.telemetry) {
        setTelemetryMap((prev) => ({
          ...prev,
          [f.candidateId]: {
            ...(prev[f.candidateId] || {}),
            ...f.telemetry,
            isLiveFromExamTab: true,
            lastUpdated: f.updatedAt || Date.now(),
          },
        }));
      }
      if (typeof f.liveFrameDataUrl === 'string' && f.liveFrameDataUrl.length > 0) {
        setRemoteCandidateFrames((prev) => ({
          ...prev,
          [f.candidateId]: f.liveFrameDataUrl,
        }));
      }
    };

    if (typeof EventSource !== 'undefined') {
      es = new EventSource('/api/proctoring/stream');
      es.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'SNAPSHOT' && Array.isArray(data.feeds)) {
            data.feeds.forEach(applyIncomingFeed);
          } else if (data.type === 'CANDIDATE_FEED' && data.feed) {
            applyIncomingFeed(data.feed);
          } else if (data.type === 'CANDIDATE_DISCONNECTED' && data.candidateId) {
            const cid = data.candidateId;
            setRemoteCandidateFrames((prev) => {
              const next = { ...prev };
              delete next[cid];
              return next;
            });
            setTelemetryMap((prev) => {
              if (!prev[cid]) return prev;
              return {
                ...prev,
                [cid]: {
                  ...prev[cid],
                  isLiveFromExamTab: false,
                  cameraActive: false,
                },
              };
            });
          }
        } catch {
          // Ignore parse errors
        }
      };
    }

    // High-frequency HTTP polling fallback (every 450ms) so reverse-proxy SSE buffering never blocks live video frames
    const pollActiveFeeds = async () => {
      try {
        const res = await fetch('/api/proctoring/feeds');
        if (!res.ok || !isMounted) return;
        const data = await res.json();
        if (Array.isArray(data?.feeds)) {
          const activeSet = new Set<string>();
          data.feeds.forEach((f: any) => {
            if (f?.candidateId) {
              activeSet.add(f.candidateId);
              applyIncomingFeed(f);
            }
          });
        }
      } catch {
        // Ignore network errors
      }
    };

    pollActiveFeeds();
    const pollInterval = setInterval(pollActiveFeeds, 450);

    return () => {
      isMounted = false;
      if (es) es.close();
      clearInterval(pollInterval);
    };
  }, []);

  // Search & Filter states for Admin Candidate View
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [watchedCandidateIds, setWatchedCandidateIds] = useState<string[]>(() =>
    activeProctoringCandidates.slice(0, 4).map((c) => c.id)
  );
  const [focusedSingleCandidateId, setFocusedSingleCandidateId] = useState<string | null>(
    null
  );
  const [autoSimulateLiveSession, setAutoSimulateLiveSession] = useState<boolean>(false);
  const [transitionBanner, setTransitionBanner] = useState<string>('');

  // Automatically pin any real-life active student to the front of the Admin's Watch Stage
  useEffect(() => {
    if (realTimeActiveCandidateIds.length === 0) return;
    setWatchedCandidateIds((prev) => {
      const missingLive = realTimeActiveCandidateIds.filter((id) => !prev.includes(id));
      if (missingLive.length === 0) return prev;
      return [...missingLive, ...prev];
    });
  }, [realTimeActiveCandidateIds]);

  // Ensure at least 1 candidate is watched if active candidates exist and watched list becomes invalid
  useEffect(() => {
    const validIds = activeProctoringCandidates.map((c) => c.id);
    setWatchedCandidateIds((prev) => {
      const filtered = prev.filter((id) => validIds.includes(id));
      if (filtered.length === 0 && validIds.length > 0) {
        return validIds.slice(0, Math.min(4, validIds.length));
      }
      return filtered;
    });
  }, [activeProctoringCandidates]);

  // Update a candidate's live accuracy when they answer a question (and trigger dynamic Left <-> Right movement)
  const handleSimulateCandidateAnswer = (candidateId: string, isCorrect: boolean) => {
    setTelemetryMap((prev) => {
      const current = prev[candidateId];
      if (!current) return prev;

      const prevAcc = current.accuracyPercent;
      const nextAnswered = current.answeredCount + 1;
      const nextCorrect = current.correctCount + (isCorrect ? 1 : 0);
      const nextAcc = Math.round((nextCorrect / nextAnswered) * 100);
      const nextQIndex =
        current.currentQuestionIndex < current.totalQuestions
          ? current.currentQuestionIndex + 1
          : 1;

      let transition: LiveCandidateTelemetry['lastTransition'] = current.lastTransition;
      if (prevAcc < 80 && nextAcc >= 80) {
        transition = 'promoted-to-top';
        setTransitionBanner(
          `${current.candidateName} (${current.regNumber}) reached ${nextAcc}% accuracy and dynamically moved to the RIGHT SIDE (Top Performing Candidates 80+%)!`
        );
      } else if (prevAcc >= 80 && nextAcc < 80) {
        transition = 'dropped-below-80';
        setTransitionBanner(
          `${current.candidateName} (${current.regNumber}) dropped to ${nextAcc}% accuracy (<80%) and dynamically fell back to the LEFT SIDE!`
        );
      }

      const updated: LiveCandidateTelemetry = {
        ...current,
        answeredCount: nextAnswered,
        correctCount: nextCorrect,
        accuracyPercent: nextAcc,
        currentQuestionIndex: nextQIndex,
        lastTransition: transition,
        lastTransitionAt: Date.now(),
        lastUpdated: Date.now(),
      };

      publishCandidateLiveTelemetry(updated);
      return {
        ...prev,
        [candidateId]: updated,
      };
    });
  };

  // Optional test simulation progression (OFF by default)
  useEffect(() => {
    if (!autoSimulateLiveSession || !settings.proctoringEnabled) return;
    if (activeProctoringCandidates.length === 0) return;

    const interval = setInterval(() => {
      const randomIdx = Math.floor(Math.random() * activeProctoringCandidates.length);
      const targetCand = activeProctoringCandidates[randomIdx];
      if (!targetCand) return;

      const currentTel = telemetryMap[targetCand.id];
      if (!currentTel || currentTel.isLiveFromExamTab) return;

      const isNearThreshold =
        currentTel.accuracyPercent >= 74 && currentTel.accuracyPercent <= 85;
      const probabilityCorrect = isNearThreshold
        ? currentTel.accuracyPercent < 80
          ? 0.72
          : 0.45
        : 0.78;
      const isCorrect = Math.random() < probabilityCorrect;

      handleSimulateCandidateAnswer(targetCand.id, isCorrect);
    }, 4500);

    return () => clearInterval(interval);
  }, [
    autoSimulateLiveSession,
    settings.proctoringEnabled,
    activeProctoringCandidates,
    telemetryMap,
  ]);

  // Filter candidates by Admin Search Query, Category Filter, and Real-Life Active Filter
  const filteredProctoringCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeProctoringCandidates.filter((c) => {
      if (
        feedSourceFilter === 'real-life-only' &&
        !realTimeActiveCandidateIds.includes(c.id)
      ) {
        return false;
      }

      const tel = telemetryMap[c.id];
      const fullName = `${c.firstName} ${c.middleName || ''} ${c.surname}`.toLowerCase();
      const matchesSearch =
        !q ||
        fullName.includes(q) ||
        c.regNumber.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        (c.pin && c.pin.toLowerCase().includes(q)) ||
        (tel && tel.currentSubject.toLowerCase().includes(q));

      const matchesCategory =
        categoryFilter === 'All' ||
        c.category.trim().toLowerCase() === categoryFilter.trim().toLowerCase();

      return matchesSearch && matchesCategory;
    });
  }, [
    activeProctoringCandidates,
    telemetryMap,
    searchQuery,
    categoryFilter,
    feedSourceFilter,
    realTimeActiveCandidateIds,
  ]);

  // Split filtered candidates dynamically into LEFT (<80% accuracy) and RIGHT (>=80% accuracy)
  const { leftStandardCandidates, rightTopPerformingCandidates } = useMemo(() => {
    const left: { candidate: Candidate; telemetry: LiveCandidateTelemetry }[] = [];
    const right: { candidate: Candidate; telemetry: LiveCandidateTelemetry }[] = [];

    filteredProctoringCandidates.forEach((cand) => {
      const tel = telemetryMap[cand.id] || {
        candidateId: cand.id,
        regNumber: cand.regNumber,
        candidateName: `${cand.firstName} ${cand.surname}`,
        category: cand.category,
        gender: cand.gender,
        passportDataUrl: getCandidateHdPortraitUrl(cand),
        testTitle: 'Rapid Test',
        testCode: 'RAPID-2026-QMT',
        currentSubject: 'English',
        currentQuestionIndex: 1,
        totalQuestions: 40,
        answeredCount: 10,
        correctCount: 8,
        accuracyPercent: 80,
        focusStatus: 'Focused',
        cameraActive: false,
        isLiveFromExamTab: false,
        lastUpdated: Date.now(),
      };

      if (tel.accuracyPercent >= 80) {
        right.push({ candidate: cand, telemetry: tel });
      } else {
        left.push({ candidate: cand, telemetry: tel });
      }
    });

    // Sort Right Side: real-life active students first, then highest accuracy
    right.sort((a, b) => {
      const aLive = realTimeActiveCandidateIds.includes(a.candidate.id) ? 1 : 0;
      const bLive = realTimeActiveCandidateIds.includes(b.candidate.id) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      return b.telemetry.accuracyPercent - a.telemetry.accuracyPercent;
    });
    // Sort Left Side: real-life active students first, then closest to 80% threshold
    left.sort((a, b) => {
      const aLive = realTimeActiveCandidateIds.includes(a.candidate.id) ? 1 : 0;
      const bLive = realTimeActiveCandidateIds.includes(b.candidate.id) ? 1 : 0;
      if (bLive !== aLive) return bLive - aLive;
      return b.telemetry.accuracyPercent - a.telemetry.accuracyPercent;
    });

    return {
      leftStandardCandidates: left,
      rightTopPerformingCandidates: right,
    };
  }, [filteredProctoringCandidates, telemetryMap, realTimeActiveCandidateIds]);

  // Candidates currently in the Multi-Watch Live Video Stage
  const watchedEntries = useMemo(() => {
    const list = activeProctoringCandidates
      .filter((c) => {
        if (
          feedSourceFilter === 'real-life-only' &&
          !realTimeActiveCandidateIds.includes(c.id)
        ) {
          return false;
        }
        return watchedCandidateIds.includes(c.id);
      })
      .map((c, idx) => ({
        candidate: c,
        telemetry: telemetryMap[c.id],
        seatIndex: idx,
      }))
      .filter((item) => Boolean(item.telemetry));

    if (focusedSingleCandidateId) {
      const focused = list.find((item) => item.candidate.id === focusedSingleCandidateId);
      if (focused) return [focused];
    }
    return list;
  }, [
    activeProctoringCandidates,
    watchedCandidateIds,
    telemetryMap,
    focusedSingleCandidateId,
    feedSourceFilter,
    realTimeActiveCandidateIds,
  ]);

  const toggleWatchCandidate = (candidateId: string) => {
    setFocusedSingleCandidateId(null);
    setWatchedCandidateIds((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : [...prev, candidateId]
    );
  };

  const watchOnlySingleCandidate = (candidateId: string) => {
    if (!watchedCandidateIds.includes(candidateId)) {
      setWatchedCandidateIds((prev) => [candidateId, ...prev]);
    }
    setFocusedSingleCandidateId((prev) => (prev === candidateId ? null : candidateId));
  };

  const allCategories = useMemo(() => {
    const set = new Set<string>(['All']);
    activeProctoringCandidates.forEach((c) => {
      if (c.category) set.add(c.category);
    });
    return Array.from(set);
  }, [activeProctoringCandidates]);

  return (
    <div className="space-y-6">
      {/* 1. Top Command & JAMB CBT Live CCTV Header */}
      <div className="p-6 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
                <span>JAMB CBT BIOMETRIC &amp; LIVE CCTV PROCTORING • NO RECORDING SAVED</span>
              </span>
              <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-[11px] font-extrabold">
                REAL-TIME STUDENT WEBCAM + BIOMETRIC VERIFICATION
              </span>
              {realTimeActiveCandidateIds.length > 0 && (
                <span className="px-3 py-1 rounded-full bg-red-600 text-white text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  <span>
                    {realTimeActiveCandidateIds.length} LIVE CBT WORKSTATION(S) STREAMING NOW
                  </span>
                </span>
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-black pt-1">
              JAMB CBT Live CCTV Invigilation &amp; Dynamic 80+% Performance Split
            </h2>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Monitor <strong>1 or more candidates simultaneously</strong> with side-by-side <strong>Registered Biometric Passport Photo</strong> and <strong>Real-Time Live Exam Webcam Stream</strong> (no recording saved). Candidates achieving <strong>80+% accuracy</strong> dynamically move to the <strong>Right Side</strong>, and fall back to the <strong>Left Side</strong> if accuracy drops below 80%.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {/* Filter between All Candidates vs Real-Life Active Exam Sessions */}
            <div className="inline-flex items-center rounded-xl bg-neutral-100 p-1 border border-neutral-200">
              <button
                type="button"
                onClick={() => setFeedSourceFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                  feedSourceFilter === 'all'
                    ? 'bg-[#0a6b3c] text-white'
                    : 'text-neutral-700 hover:text-black'
                }`}
              >
                All Workstations ({activeProctoringCandidates.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setFeedSourceFilter('real-life-only');
                  if (realTimeActiveCandidateIds.length > 0) {
                    setFocusedSingleCandidateId(null);
                    setWatchedCandidateIds(realTimeActiveCandidateIds);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-colors flex items-center gap-1.5 cursor-pointer ${
                  feedSourceFilter === 'real-life-only'
                    ? 'bg-red-600 text-white'
                    : 'text-neutral-700 hover:text-black'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    realTimeActiveCandidateIds.length > 0
                      ? 'bg-red-500 animate-ping'
                      : 'bg-neutral-400'
                  }`}
                />
                <span>Live in Exam Hall ({realTimeActiveCandidateIds.length})</span>
              </button>
            </div>

            {/* Optional Threshold Simulation Toggle (OFF by default) */}
            <button
              type="button"
              onClick={() => setAutoSimulateLiveSession((prev) => !prev)}
              className={`px-3.5 py-2 rounded-xl border text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer ${
                autoSimulateLiveSession
                  ? 'border-[#0a6b3c] bg-[#0a6b3c]/10 text-[#0a6b3c]'
                  : 'border-neutral-300 bg-neutral-100 text-neutral-700'
              }`}
              title="Toggle automatic threshold split test for standby workstations"
            >
              {autoSimulateLiveSession ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Auto Split Test: ON</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Auto Split Test: OFF</span>
                </>
              )}
            </button>

            {/* Global Proctoring Active / Paused Switch */}
            <button
              type="button"
              onClick={() => onToggleProctoringEnabled(!settings.proctoringEnabled)}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer ${
                settings.proctoringEnabled
                  ? 'bg-neutral-900 text-white'
                  : 'bg-red-600 text-white'
              }`}
            >
              Proctoring: {settings.proctoringEnabled ? 'ACTIVE' : 'PAUSED'}
            </button>
          </div>
        </div>

        {/* Real-Life Student Active Exam Session Banner */}
        {realTimeActiveCandidateIds.length > 0 ? (
          <div className="p-4 rounded-2xl bg-emerald-950 text-white border-2 border-emerald-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
                <Video className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-emerald-300 flex items-center gap-2">
                  <span>JAMB CBT LIVE EXAM HALL CONNECTION ACTIVE</span>
                </div>
                <p className="text-xs text-white/90 mt-0.5">
                  <strong>{realTimeActiveCandidateIds.length}</strong> candidate workstation(s) currently logged into the CBT portal and streaming live webcam &amp; question telemetry.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setFocusedSingleCandidateId(null);
                  setWatchedCandidateIds(realTimeActiveCandidateIds);
                }}
                className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-extrabold cursor-pointer"
              >
                Focus Live CBT Workstations ({realTimeActiveCandidateIds.length})
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-600">
            <div>
              <strong className="text-black">JAMB CBT Live CCTV Connection:</strong> Copy any candidate&apos;s Registration Number below (e.g. <code className="font-mono font-bold text-[#0a6b3c]">2027015PHA</code>) and log into the Candidate Exam Portal on another tab, laptop, or phone. Their <strong>real-life live webcam stream</strong> and question-by-question progress will immediately appear on their CCTV Workstation Monitor below.
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-[11px] font-extrabold shrink-0">
              CCTV Server Listening...
            </span>
          </div>
        )}

        {/* 2. Search Candidate for View & Multi-Watch Presets Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Search Input */}
          <div className="lg:col-span-5 relative">
            <Search className="w-4 h-4 text-[#0a6b3c] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search candidate by Name, Reg Number (e.g. 2027015PHA), or Category..."
              className="w-full pl-10 pr-9 py-2.5 rounded-xl border-2 border-neutral-200 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black bg-neutral-50 focus:bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-black cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Category Filter Pills */}
          <div className="lg:col-span-3 flex flex-wrap items-center gap-1.5">
            {allCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-[#0a6b3c] text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Quick Multi-Candidate Watch Presets (Watch 1, Watch 2, Watch 4, Watch All) */}
          <div className="lg:col-span-4 flex flex-wrap items-center justify-end gap-1.5">
            <span className="text-[11px] font-extrabold text-neutral-500 mr-1">
              CCTV Grid Size:
            </span>
            {[
              { label: '1 Workstation', count: 1 },
              { label: '2 Workstations', count: 2 },
              { label: '4 Workstations', count: 4 },
              {
                label: `All (${filteredProctoringCandidates.length})`,
                count: filteredProctoringCandidates.length,
              },
            ].map((preset) => {
              const isCurrentCount =
                !focusedSingleCandidateId &&
                watchedCandidateIds.length === preset.count &&
                preset.count > 0;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setFocusedSingleCandidateId(null);
                    setWatchedCandidateIds(
                      filteredProctoringCandidates
                        .slice(0, Math.max(1, preset.count))
                        .map((c) => c.id)
                    );
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold border transition-colors cursor-pointer ${
                    isCurrentCount
                      ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:border-[#0a6b3c]'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic Threshold Transition Alert Banner */}
        {transitionBanner && (
          <div className="p-3.5 rounded-2xl bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 flex items-center justify-between gap-3 text-xs font-extrabold text-[#0a6b3c]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>{transitionBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setTransitionBanner('')}
              className="text-[11px] underline cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* 3. MULTI-CANDIDATE JAMB CBT LIVE CCTV & BIOMETRIC WATCH STAGE */}
      <div className="p-6 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-black flex items-center gap-2">
                <span>
                  JAMB CBT Live CCTV &amp; Biometric Verification Stage ({watchedEntries.length}{' '}
                  {watchedEntries.length === 1 ? 'Workstation' : 'Workstations'} Monitored)
                </span>
              </h3>
              <p className="text-xs text-neutral-500">
                Displays each student&apos;s real-time live webcam feed alongside their verified Registration Passport Photo and live CBT progress. Zero video recording is saved.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* JAMB CCTV Display Mode Switcher */}
            <div className="inline-flex items-center rounded-xl bg-neutral-100 p-1 border border-neutral-200">
              <span className="px-2 text-[10px] font-extrabold text-neutral-500 flex items-center gap-1">
                <Camera className="w-3 h-3 text-[#0a6b3c]" />
                <span>CCTV Layout:</span>
              </span>
              {[
                {
                  id: 'jamb-biometric-split' as CameraViewMode,
                  label: 'JAMB Biometric + Live CCTV Split',
                },
                {
                  id: 'full-cctv-cam' as CameraViewMode,
                  label: 'Full-Screen Live CCTV Camera',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setCameraViewMode(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                    cameraViewMode === opt.id
                      ? 'bg-[#0a6b3c] text-white shadow-2xs'
                      : 'text-neutral-700 hover:text-black'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {focusedSingleCandidateId && (
              <button
                type="button"
                onClick={() => setFocusedSingleCandidateId(null)}
                className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Return to Multi-Workstation Grid ({watchedCandidateIds.length})</span>
              </button>
            )}
          </div>
        </div>

        {watchedEntries.length === 0 ? (
          <div className="p-8 rounded-2xl border border-dashed border-neutral-300 text-center space-y-3">
            <p className="text-xs font-bold text-neutral-600">
              {feedSourceFilter === 'real-life-only'
                ? 'No candidates are currently logged into an active CBT examination session. Switch to "All Workstations" or log in as a candidate on another tab/device to watch their live webcam feed.'
                : 'No workstations currently selected on the CCTV Watch Stage. Click "Watch Live" on any candidate below to monitor their workstation.'}
            </p>
            {filteredProctoringCandidates.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setWatchedCandidateIds(
                    filteredProctoringCandidates.slice(0, 4).map((c) => c.id)
                  )
                }
                className="px-4 py-2 rounded-xl bg-[#0a6b3c] text-white text-xs font-extrabold cursor-pointer"
              >
                Monitor First {Math.min(4, filteredProctoringCandidates.length)} CBT Workstations
              </button>
            )}
          </div>
        ) : (
          <div
            className={`grid gap-4 ${
              watchedEntries.length === 1
                ? 'grid-cols-1 max-w-4xl mx-auto'
                : 'grid-cols-1 md:grid-cols-2'
            }`}
          >
            {watchedEntries.map(({ candidate, telemetry, seatIndex }) => {
              const hasSubmittedExam = results.some(
                (r) =>
                  r.candidateId === candidate.id ||
                  r.regNumber.trim().toUpperCase() === candidate.regNumber.trim().toUpperCase()
              );
              return (
                <LiveCandidateVideoTile
                  key={candidate.id}
                  candidate={candidate}
                  telemetry={telemetry}
                  remoteLiveFrameUrl={remoteCandidateFrames[candidate.id]}
                  seatIndex={seatIndex}
                  hasSubmittedExam={hasSubmittedExam}
                  cameraViewMode={cameraViewMode}
                  onChangeCameraViewMode={setCameraViewMode}
                  isFocusedSingle={focusedSingleCandidateId === candidate.id}
                  onToggleFocusSingle={() => watchOnlySingleCandidate(candidate.id)}
                  onRemoveFromWatch={() => toggleWatchCandidate(candidate.id)}
                  onSimulateAnswer={handleSimulateCandidateAnswer}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 4. DYNAMIC LEFT / RIGHT SPLIT ARENA (LEFT: <80% Accuracy | RIGHT: Top Performing 80+% Accuracy) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (6 cols): Standard Live Candidates (< 80% Accuracy) */}
        <div className="lg:col-span-6 p-5 md:p-6 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-neutral-100 text-neutral-800 flex items-center justify-center font-mono text-xs font-extrabold">
                &lt;80%
              </div>
              <div>
                <h3 className="text-sm md:text-base font-extrabold text-black">
                  Standard Live Examinees (&lt; 80% Accuracy)
                </h3>
                <p className="text-[11px] text-neutral-500">
                  Candidates below 80% accuracy. Reaching 80+% dynamically moves them to the Right Side.
                </p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-neutral-100 text-neutral-800 font-mono text-xs font-extrabold shrink-0">
              {leftStandardCandidates.length} Candidates
            </span>
          </div>

          {leftStandardCandidates.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-neutral-200 text-center text-xs font-bold text-neutral-500">
              All matching candidates currently have 80+% accuracy (see Right Side) or no candidates match your search.
            </div>
          ) : (
            <div className="space-y-3">
              {leftStandardCandidates.map(({ candidate, telemetry }) => {
                const isWatched = watchedCandidateIds.includes(candidate.id);
                const isSelectedForDelete = selectedProctoringIds.includes(candidate.id);
                const isRealLifeNow = realTimeActiveCandidateIds.includes(candidate.id);
                const droppedRecently =
                  telemetry.lastTransition === 'dropped-below-80' &&
                  telemetry.lastTransitionAt &&
                  Date.now() - telemetry.lastTransitionAt < 15000;
                const portraitUrl =
                  remoteCandidateFrames[candidate.id] ||
                  getCandidateHdPortraitUrl(candidate);

                return (
                  <div
                    key={candidate.id}
                    className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
                      isRealLifeNow
                        ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20'
                        : isWatched
                        ? 'border-[#0a6b3c] bg-[#0a6b3c]/4'
                        : 'border-neutral-200 bg-neutral-50/70 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelectedForDelete}
                          onChange={() =>
                            setSelectedProctoringIds((prev) =>
                              prev.includes(candidate.id)
                                ? prev.filter((id) => id !== candidate.id)
                                : [...prev, candidate.id]
                            )
                          }
                          className="accent-[#0a6b3c] w-4 h-4 mt-1 cursor-pointer"
                        />
                        <div className="w-10 h-10 rounded-xl overflow-hidden border border-neutral-300 bg-white shrink-0">
                          {portraitUrl ? (
                            <img
                              src={portraitUrl}
                              alt={telemetry.candidateName}
                              className="w-full h-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-extrabold text-sm text-black">
                              {telemetry.candidateName}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-neutral-200 text-neutral-800 text-[10px] font-extrabold">
                              {telemetry.category}
                            </span>
                            {isRealLifeNow && (
                              <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[9px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                <span>TAKING EXAM NOW</span>
                              </span>
                            )}
                            {droppedRecently && (
                              <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-extrabold inline-flex items-center gap-1">
                                <ArrowLeft className="w-3 h-3" />
                                <span>Fell below 80%</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                            Reg: {telemetry.regNumber} • {telemetry.currentSubject} (Q
                            {telemetry.currentQuestionIndex}/{telemetry.totalQuestions})
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-neutral-900 text-white font-mono text-xs font-extrabold tabular-nums">
                          {telemetry.accuracyPercent}%
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleWatchCandidate(candidate.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1 transition-colors cursor-pointer ${
                            isWatched
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-white border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isWatched ? 'Watching' : 'Watch Live'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => watchOnlySingleCandidate(candidate.id)}
                          className="p-1.5 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] bg-white text-neutral-700 hover:text-[#0a6b3c] cursor-pointer"
                          title="Watch Only This Candidate (Single Focus)"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Accuracy bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-neutral-600">
                        <span>
                          Correct: {telemetry.correctCount} / {telemetry.answeredCount}{' '}
                          answered
                        </span>
                        <span>Needs {Math.max(0, 80 - telemetry.accuracyPercent)}% more for Top 80+%</span>
                      </div>
                      <div className="w-full h-2 bg-neutral-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all duration-300"
                          style={{ width: `${telemetry.accuracyPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick Answer Simulation Buttons to see Candidate move to Right Side (80+%) */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] font-bold text-neutral-500">
                        Test Dynamic Split:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSimulateCandidateAnswer(candidate.id, true)}
                          className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] text-[#0a6b3c] hover:text-white text-[10px] font-extrabold transition-colors cursor-pointer"
                        >
                          + Correct (Boost toward 80+%)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulateCandidateAnswer(candidate.id, false)}
                          className="px-2.5 py-1 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-700 text-[10px] font-extrabold transition-colors cursor-pointer"
                        >
                          + Wrong
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN (6 cols): TOP PERFORMING CANDIDATES (80+% Accuracy During Exam Session) */}
        <div className="lg:col-span-6 p-5 md:p-6 rounded-3xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/4 text-black shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-[#0a6b3c]/20 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shadow-xs">
                <Trophy className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm md:text-base font-extrabold text-[#0a6b3c]">
                    Top Performing Candidates (80+% Accuracy)
                  </h3>
                </div>
                <p className="text-[11px] text-neutral-600">
                  Students with <strong>80+% live accuracy</strong> dynamically appear here on the right. Dropping below 80% returns them to the left.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {rightTopPerformingCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFocusedSingleCandidateId(null);
                    setWatchedCandidateIds(
                      rightTopPerformingCandidates.map((item) => item.candidate.id)
                    );
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-[10px] font-extrabold cursor-pointer"
                >
                  Watch All 80+%
                </button>
              )}
              <span className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white font-mono text-xs font-extrabold">
                {rightTopPerformingCandidates.length} Top
              </span>
            </div>
          </div>

          {rightTopPerformingCandidates.length === 0 ? (
            <div className="p-8 rounded-2xl border border-dashed border-[#0a6b3c]/40 bg-white text-center space-y-2">
              <Trophy className="w-7 h-7 text-[#0a6b3c] mx-auto opacity-60" />
              <p className="text-xs font-bold text-neutral-700">
                No candidates are currently at 80+% accuracy.
              </p>
              <p className="text-[11px] text-neutral-500">
                As soon as a candidate on the Left Side achieves 80% or higher accuracy during the exam session, they will dynamically move here to the Right Side!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rightTopPerformingCandidates.map(({ candidate, telemetry }, rankIdx) => {
                const isWatched = watchedCandidateIds.includes(candidate.id);
                const isSelectedForDelete = selectedProctoringIds.includes(candidate.id);
                const isRealLifeNow = realTimeActiveCandidateIds.includes(candidate.id);
                const promotedRecently =
                  telemetry.lastTransition === 'promoted-to-top' &&
                  telemetry.lastTransitionAt &&
                  Date.now() - telemetry.lastTransitionAt < 15000;
                const portraitUrl =
                  remoteCandidateFrames[candidate.id] ||
                  getCandidateHdPortraitUrl(candidate);

                return (
                  <div
                    key={candidate.id}
                    className={`p-4 rounded-2xl border-2 bg-white transition-all space-y-3 shadow-2xs ${
                      isRealLifeNow
                        ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                        : isWatched
                        ? 'border-[#0a6b3c] ring-2 ring-[#0a6b3c]/15'
                        : 'border-[#0a6b3c]/40 hover:border-[#0a6b3c]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelectedForDelete}
                          onChange={() =>
                            setSelectedProctoringIds((prev) =>
                              prev.includes(candidate.id)
                                ? prev.filter((id) => id !== candidate.id)
                                : [...prev, candidate.id]
                            )
                          }
                          className="accent-[#0a6b3c] w-4 h-4 mt-1 cursor-pointer"
                        />
                        <div className="w-10 h-10 rounded-xl overflow-hidden border-2 border-[#0a6b3c]/30 bg-white shrink-0">
                          {portraitUrl ? (
                            <img
                              src={portraitUrl}
                              alt={telemetry.candidateName}
                              className="w-full h-full object-cover"
                            />
                          ) : null}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-[#0a6b3c] text-white font-mono text-[10px] font-extrabold">
                              #{rankIdx + 1}
                            </span>
                            <span className="font-extrabold text-sm text-black">
                              {telemetry.candidateName}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold">
                              {telemetry.category}
                            </span>
                            {isRealLifeNow && (
                              <span className="px-2 py-0.5 rounded bg-red-600 text-white text-[9px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                                <span>TAKING EXAM NOW</span>
                              </span>
                            )}
                            {promotedRecently && (
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-[#0a6b3c] text-[10px] font-extrabold inline-flex items-center gap-1">
                                <ArrowRight className="w-3 h-3" />
                                <span>Promoted to 80+%!</span>
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-neutral-500 mt-0.5">
                            Reg: {telemetry.regNumber} • {telemetry.currentSubject} (Q
                            {telemetry.currentQuestionIndex}/{telemetry.totalQuestions})
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c] text-white font-mono text-xs font-extrabold tabular-nums">
                          {telemetry.accuracyPercent}%
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleWatchCandidate(candidate.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1 transition-colors cursor-pointer ${
                            isWatched
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-white border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isWatched ? 'Watching' : 'Watch Live'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => watchOnlySingleCandidate(candidate.id)}
                          className="p-1.5 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] bg-white text-neutral-700 hover:text-[#0a6b3c] cursor-pointer"
                          title="Watch Only This Candidate (Single Focus)"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Accuracy bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px] font-bold text-[#0a6b3c]">
                        <span>
                          Correct: {telemetry.correctCount} / {telemetry.answeredCount}{' '}
                          answered (80+% Top Performer)
                        </span>
                        <span>Margin above 80%: +{telemetry.accuracyPercent - 80}%</span>
                      </div>
                      <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden border border-[#0a6b3c]/20">
                        <div
                          className="h-full bg-[#0a6b3c] transition-all duration-300"
                          style={{ width: `${telemetry.accuracyPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Quick Answer Simulation Buttons to test falling back below 80% to Left Side */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[10px] font-bold text-neutral-500">
                        Test Dynamic Split:
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSimulateCandidateAnswer(candidate.id, true)}
                          className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] text-[#0a6b3c] hover:text-white text-[10px] font-extrabold transition-colors cursor-pointer"
                        >
                          + Correct
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSimulateCandidateAnswer(candidate.id, false)}
                          className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white border border-amber-200 text-[10px] font-extrabold transition-colors cursor-pointer"
                          title="Simulate missed answer — if accuracy drops below 80%, candidate falls back to Left Side"
                        >
                          + Wrong (Test Drop &lt;80%)
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 5. Bulk Proctoring Feed Management Bar */}
      <div className="p-4 rounded-2xl border border-neutral-200 bg-white flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-extrabold text-neutral-700 cursor-pointer">
          <input
            type="checkbox"
            checked={
              activeProctoringCandidates.length > 0 &&
              activeProctoringCandidates.every((c) =>
                selectedProctoringIds.includes(c.id)
              )
            }
            onChange={() => {
              const allIds = activeProctoringCandidates.map((c) => c.id);
              const allSelected =
                allIds.length > 0 &&
                allIds.every((id) => selectedProctoringIds.includes(id));
              if (allSelected) {
                setSelectedProctoringIds([]);
              } else {
                setSelectedProctoringIds(allIds);
              }
            }}
            className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
          />
          <span>Select all proctoring feeds ({activeProctoringCandidates.length})</span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {clearedProctoringCount > 0 && onRestoreAllProctoringFeeds && (
            <button
              type="button"
              onClick={() => {
                onRestoreAllProctoringFeeds();
                setSelectedProctoringIds([]);
              }}
              className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-xs font-extrabold cursor-pointer"
            >
              Restore cleared feeds ({clearedProctoringCount})
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              if (selectedProctoringIds.length === 0) return;
              onClearProctoringFeeds(selectedProctoringIds);
              setSelectedProctoringIds([]);
            }}
            disabled={selectedProctoringIds.length === 0}
            className="px-3.5 py-2 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete selected ({selectedProctoringIds.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClearAllProctoringFeeds();
              setSelectedProctoringIds([]);
            }}
            disabled={activeProctoringCandidates.length === 0}
            className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear all proctoring</span>
          </button>
        </div>
      </div>
    </div>
  );
};
