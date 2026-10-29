import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Clock,
  Camera,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Send,
  Play,
  LogOut,
  FileText,
  Lock,
  Sparkles,
  Loader2,
  MapPin,
  Calendar,
} from 'lucide-react';
import {
  AttemptedQuestionItem,
  Candidate,
  ExamResult,
  ExamSettings,
  PublishedTest,
  Question,
  SubjectScoreDetail,
} from '../types';
import {
  calculateSetScore,
  calculateSetScoreDetailed,
} from '../utils/calculateScore';
import {
  formatCountdownDuration,
  formatLagosDateShort,
  formatLagosTime12h,
  useExamSchedule,
} from '../utils/examSchedule';
import {
  LiveCandidateTelemetry,
  publishCandidateLiveFrame,
  publishCandidateLiveTelemetry,
  unpublishCandidateLiveStream,
} from '../utils/liveProctoringBus';
import { evaluateTyaBatchWithServer } from '../utils/tyaEvaluator';
import { QuemintSeal } from './QuemintSeal';

interface ExamInterfaceProps {
  candidate: Candidate;
  questions: Question[];
  settings: ExamSettings;
  results: ExamResult[];
  initialStage?: 'portal' | 'live-exam';
  onUpdateCandidate: (updated: Candidate) => void;
  onSubmitExam: (result: ExamResult) => void;
  onViewResult: (result: ExamResult) => void;
  onExitExam: () => void;
}

export const ExamInterface: React.FC<ExamInterfaceProps> = ({
  candidate,
  questions,
  settings,
  results,
  initialStage = 'portal',
  onSubmitExam,
  onViewResult,
  onExitExam,
}) => {
  const [stage, setStage] = useState<'portal' | 'live-exam'>(initialStage);

  const availableTests = useMemo<PublishedTest[]>(() => {
    const published = (settings.publishedTests || []).filter((pt) => pt.published);
    if (published.length > 0) return published;
    return [
      {
        id: 'test-qmt-3045b',
        title: 'UTME Mock - Batch B',
        testCode: settings.testAccessCode || 'QMT3045B',
        category: 'All',
        durationMinutes: settings.durationMinutes || 30,
        deadline: '2026-12-31',
        subjectAllocations: {
          'English Language': 10,
          Biology: 10,
          Chemistry: 10,
          Physics: 10,
        },
        totalQuestions: 40,
        published: true,
        requireFullscreen: false,
        requireCamera: true,
        maxAttempts: 3,
        createdAt: new Date().toISOString(),
      },
    ];
  }, [settings.publishedTests, settings.testAccessCode, settings.durationMinutes]);

  const [selectedTestId, setSelectedTestId] = useState<string>(
    availableTests[0]?.id || 'test-qmt-3045b'
  );

  const selectedTest = useMemo<PublishedTest>(
    () =>
      availableTests.find((t) => t.id === selectedTestId) || availableTests[0],
    [availableTests, selectedTestId]
  );

  // Enforce Exam Schedule / Time-Table (General or Per Examination Centre in Africa/Lagos WAT)
  const scheduleStatus = useExamSchedule({
    examCode: selectedTest?.testCode || settings.testAccessCode || 'QMT3045B',
    studentCenterId: candidate.examCenterId,
    studentCenterName: candidate.examCenterName,
    settings,
  });

  // Determine candidate's 4 subjects
  const examSubjects = useMemo<string[]>(() => {
    const fromCandidate = (candidate.subjectCombination || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromCandidate.length > 0) return fromCandidate;
    const fromTest = Object.keys(selectedTest?.subjectAllocations || {});
    if (fromTest.length > 0) return fromTest;
    return ['English Language', 'Biology', 'Chemistry', 'Physics'];
  }, [candidate.subjectCombination, selectedTest]);

  // Build questions grouped by subject
  const questionsBySubject = useMemo<Record<string, Question[]>>(() => {
    const map: Record<string, Question[]> = {};
    examSubjects.forEach((subj) => {
      const limit = selectedTest?.subjectAllocations?.[subj] || 10;
      const matching = questions.filter(
        (q) => q.subject.trim().toLowerCase() === subj.trim().toLowerCase()
      );
      map[subj] = (matching.length > 0 ? matching : questions).slice(0, limit);
    });
    return map;
  }, [examSubjects, questions, selectedTest]);

  const [activeSubject, setActiveSubject] = useState<string>(
    examSubjects[0] || 'English Language'
  );
  const [activeIndexBySubject, setActiveIndexBySubject] = useState<
    Record<string, number>
  >({});

  // Selected MCQ option indices: key = `${subject}::${q.id}`
  const [mcqAnswers, setMcqAnswers] = useState<Record<string, number>>({});
  // Typed TYA answers: key = `${subject}::${q.id}`
  const [tyaAnswers, setTyaAnswers] = useState<Record<string, string>>({});

  // Timer state
  const initialDurationSecs = useMemo(() => {
    const baseMins =
      selectedTest?.durationMinutes || settings.durationMinutes || 30;
    const baseSecs = baseMins * 60;
    if (
      scheduleStatus.status === 'active' &&
      scheduleStatus.remainingSeconds !== null
    ) {
      return Math.min(baseSecs, scheduleStatus.remainingSeconds);
    }
    return baseSecs;
  }, [
    selectedTest?.durationMinutes,
    settings.durationMinutes,
    scheduleStatus.status,
    scheduleStatus.remainingSeconds,
  ]);

  const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(initialDurationSecs);
  const [submittingExam, setSubmittingExam] = useState(false);
  const [showConfirmSubmitModal, setShowConfirmSubmitModal] = useState(false);
  const [autoSubmitNotice, setAutoSubmitNotice] = useState<string>('');

  // Live Camera & Persistent Re-popping Camera Access Modal
  const [cameraGranted, setCameraGranted] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const [showCameraPromptModal, setShowCameraPromptModal] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimestampRef = useRef<number>(Date.now());
  const hasSubmittedRef = useRef<boolean>(false);

  const requireCamera = Boolean(
    settings.proctoringEnabled && (selectedTest?.requireCamera ?? true)
  );

  const requestLiveCamera = useCallback(async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });
      streamRef.current = stream;
      setCameraGranted(true);
      setShowCameraPromptModal(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      // Listen for camera disconnection
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          setCameraGranted(false);
          if (requireCamera) {
            setShowCameraPromptModal(true);
          }
        };
      }
    } catch {
      setCameraGranted(false);
      setCameraError(
        'Camera permission was denied or unavailable. Please click "Grant Camera Access" and allow camera permissions in your browser.'
      );
      if (requireCamera) {
        setShowCameraPromptModal(true);
      }
    }
  }, [requireCamera]);

  // Re-pop camera modal every 3 seconds when in live-exam if camera is required and not granted
  useEffect(() => {
    if (stage !== 'live-exam' || !requireCamera) return;
    if (!cameraGranted) {
      setShowCameraPromptModal(true);
      const repopTimer = setInterval(() => {
        if (!streamRef.current || !streamRef.current.active) {
          setShowCameraPromptModal(true);
        }
      }, 3000);
      return () => clearInterval(repopTimer);
    }
  }, [stage, requireCamera, cameraGranted]);

  // Attach stream whenever videoRef mounts
  useEffect(() => {
    if (stage === 'live-exam' && streamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [stage, cameraGranted]);

  // Cleanup camera & live proctoring feed on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      unpublishCandidateLiveStream(candidate.id);
    };
  }, [candidate.id]);

  // If initialStage was 'immediate', verify schedule first; if blocked, stay on portal
  useEffect(() => {
    if (stage === 'live-exam' && !scheduleStatus.allowed) {
      setStage('portal');
    }
  }, [stage, scheduleStatus.allowed]);

  const currentSubjectQuestions = useMemo(
    () => questionsBySubject[activeSubject] || [],
    [questionsBySubject, activeSubject]
  );

  const currentQIndex = activeIndexBySubject[activeSubject] || 0;
  const currentQuestion = currentSubjectQuestions[currentQIndex] || null;

  // Broadcast live proctoring telemetry & video frames during live-exam
  const buildCurrentTelemetry = useCallback((): LiveCandidateTelemetry => {
    let totalQ = 0;
    let answered = 0;
    let correct = 0;
    let wrong = 0;

    examSubjects.forEach((subj) => {
      const list = questionsBySubject[subj] || [];
      list.forEach((q) => {
        totalQ += 1;
        const key = `${subj}::${q.id}`;
        if (q.questionType === 'TYA') {
          const typed = (tyaAnswers[key] || '').trim();
          if (typed) {
            answered += 1;
            const norm = typed.toLowerCase();
            const isMatch = (q.answerKeys || []).some(
              (k) => k.trim().toLowerCase() === norm
            );
            if (isMatch) correct += 1;
            else wrong += 1;
          }
        } else {
          const sel = mcqAnswers[key];
          if (sel !== undefined) {
            answered += 1;
            if (sel === q.correctAnswer) correct += 1;
            else wrong += 1;
          }
        }
      });
    });

    return {
      candidateId: candidate.id,
      regNumber: candidate.regNumber,
      candidateName: `${candidate.firstName} ${
        candidate.middleName ? candidate.middleName + ' ' : ''
      }${candidate.surname}`.trim(),
      category: candidate.category,
      gender: candidate.gender,
      currentSubject: activeSubject,
      currentQuestionIndex: currentQIndex,
      totalQuestions: Math.max(1, totalQ),
      answeredCount: answered,
      correctCount: correct,
      wrongCount: wrong,
      accuracyPercent: answered > 0 ? Math.round((correct / answered) * 100) : 0,
      currentStreakType: 'none',
      currentStreakCount: 0,
      timeRemainingSeconds: timeLeftSeconds,
      timeLeftSeconds,
      cameraConnected: cameraGranted,
      cameraActive: cameraGranted,
      cameraLabel: streamRef.current?.getVideoTracks()?.[0]?.label || 'Live Webcam',
      faceVerified: cameraGranted,
      focusStatus: 'Focused',
      securityFlags: 0,
      status: hasSubmittedRef.current ? 'Submitted' : 'Active',
      isLiveFromExamTab: true,
      lastUpdated: Date.now(),
    };
  }, [
    candidate,
    examSubjects,
    questionsBySubject,
    mcqAnswers,
    tyaAnswers,
    activeSubject,
    currentQIndex,
    timeLeftSeconds,
    cameraGranted,
  ]);

  useEffect(() => {
    if (stage !== 'live-exam') return;

    const sendFrameAndTelemetry = () => {
      const telemetry = buildCurrentTelemetry();
      publishCandidateLiveTelemetry(telemetry);

      if (cameraGranted && videoRef.current && videoRef.current.readyState >= 2) {
        try {
          if (!frameCanvasRef.current) {
            frameCanvasRef.current = document.createElement('canvas');
          }
          const canvas = frameCanvasRef.current;
          canvas.width = 320;
          canvas.height = 240;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            publishCandidateLiveFrame(candidate.id, dataUrl, telemetry);
          }
        } catch {
          // ignore frame capture errors
        }
      }
    };

    sendFrameAndTelemetry();
    const interval = setInterval(sendFrameAndTelemetry, 1500);
    return () => clearInterval(interval);
  }, [stage, cameraGranted, candidate.id, buildCurrentTelemetry]);

  // Finalize & submit exam (evaluates MCQ + TYA via Exact Match & Gemini AI Examiner)
  const finalizeExamSubmission = useCallback(
    async (reasonMessage?: string) => {
      if (hasSubmittedRef.current || submittingExam) return;
      hasSubmittedRef.current = true;
      setSubmittingExam(true);
      if (reasonMessage) {
        setAutoSubmitNotice(reasonMessage);
      }

      try {
        // Collect all TYA items across all subjects for batch evaluation
        const tyaBatchItems: {
          id: string;
          questionText: string;
          answerKeys: string[];
          typedAnswer: string;
          mark: number;
          allowAiEval: boolean;
        }[] = [];

        examSubjects.forEach((subj) => {
          const list = questionsBySubject[subj] || [];
          list.forEach((q) => {
            if (q.questionType === 'TYA') {
              const key = `${subj}::${q.id}`;
              tyaBatchItems.push({
                id: key,
                questionText: q.questionText,
                answerKeys: q.answerKeys || [],
                typedAnswer: tyaAnswers[key] || '',
                mark: q.mark || 1,
                allowAiEval: q.allowAiEval !== false,
              });
            }
          });
        });

        const tyaEvaluations =
          tyaBatchItems.length > 0
            ? await evaluateTyaBatchWithServer(
                tyaBatchItems,
                settings.enableAiEvaluationForTya !== false
              )
            : {};

        let aggregateScore = 0;
        let rawTotalCorrect = 0;
        let totalQuestionsCount = 0;
        const subjectBreakdown: Record<string, SubjectScoreDetail> = {};
        const attemptedRecord: AttemptedQuestionItem[] = [];

        const psycho = settings.psychometric;
        const maxSubjectCap = psycho?.enabled ? psycho.maxSubjectScoreCap : 100;

        examSubjects.forEach((subj) => {
          const list = questionsBySubject[subj] || [];
          const answersInOrder: { isCorrect: boolean }[] = [];

          list.forEach((q, idx) => {
            const key = `${subj}::${q.id}`;
            const isTya = q.questionType === 'TYA';

            if (isTya) {
              const ev = tyaEvaluations[key];
              const isCorr = Boolean(ev?.isCorrect);
              answersInOrder.push({ isCorrect: isCorr });
              if (isCorr) rawTotalCorrect += 1;

              attemptedRecord.push({
                id: q.id,
                subject: subj,
                questionNumber: idx + 1,
                questionText: q.questionText,
                options: ['', '', '', ''],
                selectedAnswer: null,
                correctAnswer: 0,
                questionType: 'TYA',
                typedAnswer: tyaAnswers[key] || '',
                answerKeys: q.answerKeys || [],
                isCorrect: isCorr,
                aiEvaluated: Boolean(ev?.aiEvaluated),
                aiExplanation: ev?.aiExplanation || '',
                aiConfidence: ev?.aiConfidence,
                marksAwarded: isCorr ? q.mark || 1 : 0,
                maxMarks: q.mark || 1,
              });
            } else {
              const sel = mcqAnswers[key] !== undefined ? mcqAnswers[key] : null;
              const isCorr = sel !== null && sel === q.correctAnswer;
              answersInOrder.push({ isCorrect: isCorr });
              if (isCorr) rawTotalCorrect += 1;

              attemptedRecord.push({
                id: q.id,
                subject: subj,
                questionNumber: idx + 1,
                questionText: q.questionText,
                options: q.options,
                selectedAnswer: sel,
                correctAnswer: q.correctAnswer,
                questionType: 'MCQ',
                isCorrect: isCorr,
                marksAwarded: isCorr ? q.mark || 1 : 0,
                maxMarks: q.mark || 1,
              });
            }
          });

          const qCount = Math.max(1, list.length);
          totalQuestionsCount += list.length;

          const subjScore = calculateSetScore(answersInOrder, qCount, psycho);
          const det = calculateSetScoreDetailed(answersInOrder, qCount, psycho);

          aggregateScore += subjScore;
          subjectBreakdown[subj] = {
            score: subjScore,
            total: maxSubjectCap,
            rawCorrect: det.rawCorrect,
            questionCount: list.length,
            failStreaks: det.failStreaksTriggered,
            passStreaks: det.passStreaksTriggered,
          };
        });

        const numSubjects = Math.max(1, examSubjects.length);
        const percentage = Math.round(aggregateScore / numSubjects);
        const timeSpentSeconds = Math.max(
          1,
          Math.round((Date.now() - startTimestampRef.current) / 1000)
        );

        const newResult: ExamResult = {
          id: `res-${Date.now()}`,
          candidateId: candidate.id,
          candidateName: `${candidate.firstName} ${
            candidate.middleName ? candidate.middleName + ' ' : ''
          }${candidate.surname}`.trim(),
          regNumber: candidate.regNumber,
          gender: candidate.gender,
          category: candidate.category,
          courseOfStudy: candidate.courseOfStudy,
          stateOfOrigin: candidate.stateOfOrigin,
          examCenterName: candidate.examCenterName || 'Q Zone 1 (Lagos Main)',
          testId: selectedTest?.id || 'test-qmt-3045b',
          testCode: selectedTest?.testCode || settings.testAccessCode || 'QMT3045B',
          testTitle: selectedTest?.title || 'UTME Mock - Batch B',
          score: aggregateScore,
          maxAggregate: numSubjects * maxSubjectCap,
          rawTotalCorrect,
          totalQuestions: totalQuestionsCount,
          percentage,
          subjectBreakdown,
          attemptedRecord,
          timeSpentSeconds,
          submittedAt: new Date().toISOString(),
        };

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        unpublishCandidateLiveStream(candidate.id);
        onSubmitExam(newResult);
      } finally {
        setSubmittingExam(false);
      }
    },
    [
      submittingExam,
      examSubjects,
      questionsBySubject,
      tyaAnswers,
      mcqAnswers,
      settings,
      candidate,
      selectedTest,
      onSubmitExam,
    ]
  );

  // Live exam countdown timer + Schedule end_time auto-submit enforcement
  useEffect(() => {
    if (stage !== 'live-exam') return;

    // If schedule just expired during live exam, auto-submit immediately!
    if (scheduleStatus.status === 'after_end') {
      finalizeExamSubmission(
        'Scheduled examination window for your centre has ended. Submitting your exam automatically...'
      );
      return;
    }

    const timer = setInterval(() => {
      setTimeLeftSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          finalizeExamSubmission('Time is up! Submitting your examination...');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [stage, scheduleStatus.status, finalizeExamSubmission]);

  const handleStartLiveExam = async () => {
    // Re-check schedule on server before starting
    if (!scheduleStatus.allowed) {
      return;
    }
    startTimestampRef.current = Date.now();
    setTimeLeftSeconds(initialDurationSecs);
    setStage('live-exam');
    if (requireCamera && !cameraGranted) {
      await requestLiveCamera();
    }
  };

  const candidatePastResults = useMemo(
    () =>
      results.filter(
        (r) =>
          r.candidateId === candidate.id ||
          r.regNumber.trim().toUpperCase() === candidate.regNumber.trim().toUpperCase()
      ),
    [results, candidate.id, candidate.regNumber]
  );

  // STAGE 1: CANDIDATE PORTAL PRE-EXAM DASHBOARD (With Exam Schedule Enforcement Banner)
  if (stage === 'portal') {
    return (
      <div className="min-h-screen bg-neutral-100 text-black flex flex-col">
        <header className="bg-white border-b border-neutral-200 px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <QuemintSeal
            size="sm"
            variant="green"
            subtitle="Candidate Examination Workstation Portal"
          />
          <button
            type="button"
            onClick={onExitExam}
            className="px-4 py-2 rounded-xl border border-neutral-300 hover:border-black text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </header>

        <main className="max-w-4xl w-full mx-auto px-4 py-8 space-y-6">
          {/* Candidate Bio Card */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[11px] font-extrabold uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified Candidate Workstation
              </span>
              <h1 className="text-2xl font-extrabold text-black">
                {candidate.firstName} {candidate.middleName} {candidate.surname}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 font-semibold">
                <span className="font-mono font-extrabold text-[#0a6b3c]">
                  Reg No: {candidate.regNumber}
                </span>
                <span>•</span>
                <span>Category: {candidate.category}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-black font-bold">
                  <MapPin className="w-3.5 h-3.5 text-[#0a6b3c]" />
                  {candidate.examCenterName || 'Q Zone 1 (Lagos Main)'}
                </span>
              </div>
            </div>

            {availableTests.length > 1 && (
              <div>
                <label className="block text-[11px] font-extrabold uppercase text-neutral-500 mb-1">
                  Select Published Exam
                </label>
                <select
                  value={selectedTestId}
                  onChange={(e) => setSelectedTestId(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl border-2 border-[#0a6b3c] text-xs font-extrabold bg-white text-black"
                >
                  {availableTests.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.title} ({pt.testCode})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* EXAM SCHEDULE / TIME-TABLE ENFORCEMENT CARD */}
          {scheduleStatus.status === 'before_start' && (
            <div className="rounded-3xl border-2 border-amber-400 bg-amber-50 p-6 space-y-3 shadow-xs">
              <div className="flex items-start gap-3">
                <Clock className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-amber-800">
                    Scheduled Examination Not Yet Open ({scheduleStatus.centreName})
                  </span>
                  <h2 className="text-lg font-extrabold text-black">
                    {scheduleStatus.reason}
                  </h2>
                  <p className="text-xs font-bold text-amber-900 font-mono">
                    Starts in: {formatCountdownDuration(scheduleStatus.secondsUntilStart)} (Africa/Lagos WAT)
                  </p>
                </div>
              </div>
            </div>
          )}

          {scheduleStatus.status === 'after_end' && (
            <div className="rounded-3xl border-2 border-red-400 bg-red-50 p-6 space-y-3 shadow-xs">
              <div className="flex items-start gap-3">
                <Lock className="w-6 h-6 text-red-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-red-700">
                    Examination Schedule Ended ({scheduleStatus.centreName})
                  </span>
                  <h2 className="text-lg font-extrabold text-black">
                    {scheduleStatus.reason}
                  </h2>
                </div>
              </div>
            </div>
          )}

          {scheduleStatus.status === 'active' && scheduleStatus.schedule && (
            <div className="rounded-3xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[#0a6b3c] shrink-0" />
                <div className="text-xs">
                  <div className="font-extrabold text-[#0a6b3c] uppercase">
                    Active Centre Schedule • {scheduleStatus.centreName}
                  </div>
                  <div className="font-bold text-black mt-0.5">
                    Window:{' '}
                    {formatLagosTime12h(scheduleStatus.schedule.start_time)} –{' '}
                    {formatLagosTime12h(scheduleStatus.schedule.end_time)} (
                    {formatLagosDateShort(scheduleStatus.schedule.start_time)})
                  </div>
                </div>
              </div>
              <div className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] text-white font-mono text-xs font-extrabold">
                Closes in: {formatCountdownDuration(scheduleStatus.remainingSeconds)}
              </div>
            </div>
          )}

          {/* Exam Details & Start Button */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-6 space-y-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-4">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  {selectedTest?.testCode || 'QMT3045B'}
                </span>
                <h2 className="text-xl font-extrabold text-black">
                  {selectedTest?.title || 'UTME Mock - Batch B'}
                </h2>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-xs font-extrabold">
                Duration: {selectedTest?.durationMinutes || settings.durationMinutes} Mins
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-1">
                <span className="text-neutral-500 font-bold uppercase">
                  Registered Subjects ({examSubjects.length})
                </span>
                <div className="font-extrabold text-black text-sm">
                  {examSubjects.join(', ')}
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-1">
                <span className="text-neutral-500 font-bold uppercase">
                  Question Formats Supported
                </span>
                <div className="font-extrabold text-[#0a6b3c] text-sm">
                  MCQ (Options A–D) &amp; TYA (Type Your Answers + AI Eval)
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              {candidatePastResults.length > 0 && (
                <button
                  type="button"
                  onClick={() => onViewResult(candidatePastResults[0])}
                  className="px-5 py-3.5 rounded-2xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/5 text-xs font-extrabold flex items-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>View Previous Result Slip</span>
                </button>
              )}

              <button
                type="button"
                disabled={!scheduleStatus.allowed}
                onClick={handleStartLiveExam}
                className="ml-auto px-8 py-4 rounded-2xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-sm font-extrabold uppercase tracking-wider flex items-center gap-2.5 shadow-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play className="w-4 h-4" />
                <span>
                  {scheduleStatus.allowed
                    ? 'Start Examination Now'
                    : scheduleStatus.status === 'before_start'
                    ? 'Scheduled (Not Yet Open)'
                    : 'Schedule Ended (Locked)'}
                </span>
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // STAGE 2: LIVE CBT EXAMINATION WORKSTATION (MCQ + TYA + Live Camera Proctoring)
  const activeKey = currentQuestion ? `${activeSubject}::${currentQuestion.id}` : '';
  const isCurrentTya = currentQuestion?.questionType === 'TYA';
  const currentMcqSelected = activeKey ? mcqAnswers[activeKey] : undefined;
  const currentTyaTyped = activeKey ? tyaAnswers[activeKey] || '' : '';

  return (
    <div className="min-h-screen bg-neutral-100 text-black flex flex-col select-none">
      {/* Top CBT Header Bar */}
      <header className="sticky top-0 z-30 bg-[#0a6b3c] text-white px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <QuemintSeal
            size="sm"
            variant="white"
            subtitle={`${candidate.firstName} ${candidate.surname} • ${candidate.regNumber}`}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* Live Camera Mini Preview */}
          <div className="flex items-center gap-2 bg-[#0e8a4e] border border-white/25 rounded-xl px-3 py-1.5">
            <div className="w-10 h-8 rounded-lg bg-black overflow-hidden border border-white/40 relative shrink-0">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="w-full h-full object-cover"
              />
            </div>
            <div className="text-[11px] leading-tight">
              <div className="font-extrabold flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    cameraGranted ? 'bg-emerald-300 animate-pulse' : 'bg-red-400'
                  }`}
                />
                <span>{cameraGranted ? 'CCTV LIVE' : 'CAM REQUIRED'}</span>
              </div>
              <span className="text-[10px] text-white/80 font-mono">
                {candidate.examCenterName || 'Q Zone 1'}
              </span>
            </div>
          </div>

          {/* Countdown Timer */}
          <div className="px-4 py-2 rounded-xl bg-white text-[#0a6b3c] font-mono font-extrabold text-base md:text-lg flex items-center gap-2 shadow-xs">
            <Clock className="w-4 h-4 text-[#0a6b3c]" />
            <span>{formatCountdownDuration(timeLeftSeconds)}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowConfirmSubmitModal(true)}
            disabled={submittingExam}
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-neutral-100 text-[#0a6b3c] font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit Exam</span>
          </button>
        </div>
      </header>

      {autoSubmitNotice && (
        <div className="bg-amber-500 text-black px-4 py-2.5 text-center text-xs font-extrabold">
          {autoSubmitNotice}
        </div>
      )}

      {/* Subject Tabs */}
      <div className="bg-white border-b border-neutral-200 px-4 md:px-8 py-2.5 flex items-center gap-2 overflow-x-auto">
        {examSubjects.map((subj) => {
          const isCurrent = subj === activeSubject;
          const subjQs = questionsBySubject[subj] || [];
          const answeredInSubj = subjQs.filter((q) => {
            const k = `${subj}::${q.id}`;
            return q.questionType === 'TYA'
              ? Boolean((tyaAnswers[k] || '').trim())
              : mcqAnswers[k] !== undefined;
          }).length;

          return (
            <button
              key={subj}
              type="button"
              onClick={() => setActiveSubject(subj)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap flex items-center gap-2 transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              <span>{subj}</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                  isCurrent
                    ? 'bg-[#0e8a4e] text-white'
                    : 'bg-white text-[#0a6b3c]'
                }`}
              >
                {answeredInSubj}/{subjQs.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Question Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-white rounded-3xl border border-neutral-200 p-6 md:p-8 shadow-xs space-y-6">
          {currentQuestion ? (
            <>
              <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="px-3 py-1 rounded-lg bg-[#0a6b3c] text-white font-mono text-xs font-extrabold">
                    Question {currentQIndex + 1} of {currentSubjectQuestions.length}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c] text-xs font-extrabold">
                    {isCurrentTya ? 'TYA • Type Your Answer' : 'MCQ • Multiple Choice'}
                  </span>
                </div>
                <span className="text-xs font-bold text-neutral-500">
                  {currentQuestion.mark || 1} Mark(s)
                </span>
              </div>

              <div className="text-base md:text-lg font-extrabold text-black leading-relaxed">
                {currentQuestion.questionText}
              </div>

              {/* Render TYA Input Box or MCQ Radio Options */}
              {isCurrentTya ? (
                <div className="space-y-3 pt-2">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    Type your answer here
                  </label>
                  <input
                    type="text"
                    value={currentTyaTyped}
                    onChange={(e) =>
                      setTyaAnswers((prev) => ({
                        ...prev,
                        [activeKey]: e.target.value,
                      }))
                    }
                    placeholder="Type your answer"
                    autoComplete="off"
                    className="w-full px-4 py-3.5 rounded-xl border-2 border-[#0a6b3c] bg-white text-black font-semibold text-base focus:outline-none focus:ring-2 focus:ring-[#0a6b3c]/25"
                  />
                  <p className="text-[11px] text-neutral-500 font-medium">
                    Your response is saved automatically as you type. Spelling variations and synonyms are evaluated automatically upon submission.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  {(currentQuestion.options || []).map((optText, optIdx) => {
                    const letter = String.fromCharCode(65 + optIdx);
                    const isSelected = currentMcqSelected === optIdx;
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() =>
                          setMcqAnswers((prev) => ({
                            ...prev,
                            [activeKey]: optIdx,
                          }))
                        }
                        className={`w-full p-4 rounded-2xl border-2 text-left flex items-center gap-3.5 transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-xs'
                            : 'bg-white text-black border-neutral-200 hover:border-[#0a6b3c]'
                        }`}
                      >
                        <span
                          className={`w-8 h-8 rounded-xl font-mono text-xs font-extrabold flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#0e8a4e] text-white'
                              : 'bg-neutral-100 text-[#0a6b3c]'
                          }`}
                        >
                          {letter}
                        </span>
                        <span className="text-sm font-bold leading-snug">
                          {optText}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Previous / Next Navigation */}
              <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
                <button
                  type="button"
                  disabled={currentQIndex <= 0}
                  onClick={() =>
                    setActiveIndexBySubject((prev) => ({
                      ...prev,
                      [activeSubject]: Math.max(0, currentQIndex - 1),
                    }))
                  }
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Previous</span>
                </button>

                {currentQIndex < currentSubjectQuestions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setActiveIndexBySubject((prev) => ({
                        ...prev,
                        [activeSubject]: currentQIndex + 1,
                      }))
                    }
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Next Question</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowConfirmSubmitModal(true)}
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Review &amp; Submit</span>
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-sm text-neutral-500">
              No questions found for this subject.
            </div>
          )}
        </div>

        {/* Question Palette Grid */}
        <div className="lg:col-span-4 bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
              {activeSubject} Palette
            </h3>
            <span className="text-[11px] font-bold text-neutral-500">
              Click number to jump
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {currentSubjectQuestions.map((q, idx) => {
              const k = `${activeSubject}::${q.id}`;
              const isAnswered =
                q.questionType === 'TYA'
                  ? Boolean((tyaAnswers[k] || '').trim())
                  : mcqAnswers[k] !== undefined;
              const isCurrent = idx === currentQIndex;

              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() =>
                    setActiveIndexBySubject((prev) => ({
                      ...prev,
                      [activeSubject]: idx,
                    }))
                  }
                  className={`h-10 rounded-xl font-mono text-xs font-extrabold transition-all cursor-pointer border ${
                    isCurrent
                      ? 'bg-[#0a6b3c] text-white border-black ring-2 ring-[#0a6b3c]/30'
                      : isAnswered
                      ? 'bg-[#0e8a4e] text-white border-[#0e8a4e]'
                      : 'bg-neutral-50 text-black border-neutral-200 hover:border-[#0a6b3c]'
                  }`}
                >
                  {idx + 1}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Persistent Re-popping Camera Access Required Modal */}
      {showCameraPromptModal && requireCamera && !cameraGranted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-2xl text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center mx-auto">
              <Camera className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-extrabold text-black">
              Live Proctoring Camera Required
            </h3>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Official Quemint CBT regulations require your webcam to remain active during the examination for live invigilation.
            </p>
            {cameraError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
                {cameraError}
              </div>
            )}
            <button
              type="button"
              onClick={requestLiveCamera}
              className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold uppercase tracking-wider cursor-pointer"
            >
              Grant Camera Access Now
            </button>
          </div>
        </div>
      )}

      {/* Confirm Submit Modal */}
      {showConfirmSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-[#0a6b3c]">
              <Sparkles className="w-5 h-5" />
              <h3 className="text-base font-extrabold">
                Submit Examination for Marking?
              </h3>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Are you sure you want to submit your examination now? Both Multiple Choice (MCQ) and Type Your Answers (TYA) responses will be evaluated immediately.
            </p>
            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={submittingExam}
                onClick={() => setShowConfirmSubmitModal(false)}
                className="px-4 py-2.5 rounded-xl border border-neutral-300 text-xs font-bold cursor-pointer"
              >
                Continue Exam
              </button>
              <button
                type="button"
                disabled={submittingExam}
                onClick={() => finalizeExamSubmission()}
                className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {submittingExam ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Evaluating &amp; Submitting...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Yes, Submit Final Exam</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
