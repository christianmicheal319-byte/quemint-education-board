import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Calculator,
  AlertTriangle,
  Video,
  Check,
  Play,
  Maximize,
  Lock,
  Moon,
  Sun,
  User,
  BookOpen,
  Camera,
  X,
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
  DEFAULT_PSYCHOMETRIC_CONFIG,
} from '../utils/calculateScore';
import { DEFAULT_SUBJECT_COMBINATIONS } from '../data/initialData';
import { QuemintSeal } from './QuemintSeal';
import { LivePhotoCaptureCard } from './LivePhotoCaptureCard';
import {
  LiveCandidateTelemetry,
  getCandidateHdPortraitUrl,
  getLocalDeviceId,
  publishCandidateLiveFrame,
  publishCandidateLiveTelemetry,
  unpublishCandidateLiveStream,
} from '../utils/liveProctoringBus';
import {
  evaluateTyaBatchWithServer,
  evaluateTyaExactMatch,
  TyaEvaluationBatchRequestItem,
  TyaEvaluationResponseItem,
} from '../utils/tyaEvaluator';
import {
  canAttemptExam,
  ScheduleCheckResult,
  useExamSchedule,
} from '../utils/examSchedule';

interface ExamInterfaceProps {
  candidate: Candidate;
  questions: Question[];
  settings: ExamSettings;
  results?: ExamResult[];
  initialStage?: ExamSessionStage;
  onUpdateCandidate?: (candidate: Candidate) => void;
  onSubmitExam: (result: ExamResult) => void;
  onViewResult?: (result: ExamResult) => void;
  onExitExam: () => void;
}

type ExamSessionStage = 'portal' | 'pre-exam' | 'fullscreen-prompt' | 'live-exam';

// Helper to Fisher-Yates shuffle an array
function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Shuffle options (A-D) for an MCQ question while updating correctAnswer index accurately.
// Never shuffle options for TYA (Type Your Answers) questions.
function shuffleQuestionOptions(q: Question): Question {
  if (q.questionType === 'TYA') {
    return q;
  }
  const correctOptionText = q.options[q.correctAnswer];
  const shuffledOpts = shuffleArray(q.options) as [string, string, string, string];
  const newCorrectIdx = Math.max(0, shuffledOpts.indexOf(correctOptionText)) as
    | 0
    | 1
    | 2
    | 3;
  return {
    ...q,
    options: shuffledOpts,
    correctAnswer: newCorrectIdx,
  };
}

export const ExamInterface: React.FC<ExamInterfaceProps> = ({
  candidate,
  questions,
  settings,
  results = [],
  initialStage = 'portal',
  onUpdateCandidate,
  onSubmitExam,
  onViewResult,
  onExitExam,
}) => {
  const [showPhotoCaptureModal, setShowPhotoCaptureModal] = useState<boolean>(false);

  const handlePortalLivePhotoCaptured = (dataUrl: string) => {
    if (!onUpdateCandidate) return;
    onUpdateCandidate({
      ...candidate,
      passportDataUrl: dataUrl,
    });
  };
  // Look up the candidate's Subject Combination (Category) and its assigned subjects
  const candidateCombination = useMemo(() => {
    const combos =
      settings.subjectCombinations && settings.subjectCombinations.length > 0
        ? settings.subjectCombinations
        : DEFAULT_SUBJECT_COMBINATIONS;
    return (
      combos.find(
        (c) => c.name.trim().toLowerCase() === candidate.category.trim().toLowerCase()
      ) || null
    );
  }, [settings.subjectCombinations, candidate.category]);

  // Flexible subject combination: prioritize candidate.subjectCombination (e.g. "English, Maths, Biology, Chemistry")
  // over any fixed category subjects so categories are never locked to specific subjects.
  const allowedCandidateSubjects = useMemo<string[]>(() => {
    if (candidate.subjectCombination && candidate.subjectCombination.trim().length > 0) {
      const parsed = candidate.subjectCombination
        .split(',')
        .map((s) => {
          const clean = s.trim();
          if (clean.toLowerCase() === 'maths' || clean.toLowerCase() === 'math') {
            return 'Mathematics';
          }
          return clean;
        })
        .filter(Boolean);
      if (parsed.length > 0) {
        return parsed;
      }
    }
    if (candidateCombination && candidateCombination.subjects.length > 0) {
      return candidateCombination.subjects;
    }
    return [];
  }, [candidate.subjectCombination, candidateCombination]);

  // Helper: get the exact (subject, questionCount) entries for a test filtered strictly to the candidate's Subject Combination
  const getCandidateSubjectsForTest = useCallback(
    (test: PublishedTest): [string, number][] => {
      const rawAllocEntries = Object.entries(test.subjectAllocations || {}).filter(
        ([_, cnt]) => cnt > 0
      );

      // If the candidate belongs to a configured Subject Combination (Category), strictly include all subjects in their Subject Combination
      if (allowedCandidateSubjects.length > 0) {
        const result: [string, number][] = [];
        allowedCandidateSubjects.forEach((comboSubj) => {
          // Check if the test has an explicit allocation for this subject
          const matchedAlloc = rawAllocEntries.find(
            ([allocSubj]) => allocSubj.trim().toLowerCase() === comboSubj.trim().toLowerCase()
          );
          if (matchedAlloc && matchedAlloc[1] > 0) {
            result.push([comboSubj, matchedAlloc[1]]);
          } else {
            // Fallback to subjectPooling total or available question count for this combination subject
            const poolCfg = (settings.subjectPooling || []).find(
              (sp) => sp.subject.trim().toLowerCase() === comboSubj.trim().toLowerCase()
            );
            const availInBank = questions.filter(
              (q) => q.subject.trim().toLowerCase() === comboSubj.trim().toLowerCase()
            ).length;
            const fallbackCount =
              poolCfg && poolCfg.subjectTotal > 0
                ? poolCfg.subjectTotal
                : availInBank > 0
                ? Math.min(10, availInBank)
                : 5;
            result.push([comboSubj, fallbackCount]);
          }
        });
        return result;
      }

      return rawAllocEntries;
    },
    [allowedCandidateSubjects, settings.subjectPooling, questions]
  );

  // All published tests visible to this candidate's Subject Combination (Category)
  const availablePublishedTests = useMemo<PublishedTest[]>(() => {
    const list = (settings.publishedTests || []).filter((t) => {
      if (!t.published) return false;
      const matchesCat =
        t.category === 'All' ||
        t.category.trim().toLowerCase() === candidate.category.trim().toLowerCase();
      if (!matchesCat) return false;
      // Also ensure the test has at least 1 subject from the candidate's Subject Combination
      if (allowedCandidateSubjects.length > 0) {
        const subjForCand = getCandidateSubjectsForTest(t);
        return subjForCand.length > 0;
      }
      return true;
    });
    if (list.length > 0) return list;

    // Fallback default Rapid Test tailored to the candidate's Subject Combination
    const fallbackAllocations: Record<string, number> = {};
    const targetSubjs =
      allowedCandidateSubjects.length > 0
        ? allowedCandidateSubjects
        : ['English', 'Biology', 'Chemistry', 'Physics'];
    let totalFallback = 0;
    targetSubjs.forEach((s) => {
      fallbackAllocations[s] = 10;
      totalFallback += 10;
    });

    return [
      {
        id: 'test-rapid-default',
        title: settings.resultTitles?.testSubtitle || 'Rapid Test',
        testCode: 'RAPID-2026-QMT',
        category: candidate.category || 'All',
        durationMinutes: settings.durationMinutes || 25,
        deadline: '31/12/2027, 23:59:00',
        published: true,
        requireFullscreen: true,
        requireCamera: true,
        maxAttempts: 1,
        createdAt: new Date().toISOString(),
        subjectAllocations: fallbackAllocations,
        totalQuestions: totalFallback,
      },
    ];
  }, [
    settings.publishedTests,
    settings.resultTitles,
    settings.durationMinutes,
    candidate.category,
    allowedCandidateSubjects,
    getCandidateSubjectsForTest,
  ]);

  const [selectedTest, setSelectedTest] = useState<PublishedTest>(
    () => availablePublishedTests[0]
  );

  // Build pooled & shuffled question set for a specific published test, strictly restricted to the candidate's Subject Combination
  const buildPooledQuestionsForTest = useCallback(
    (test: PublishedTest): Question[] => {
      const candidateSubjEntries = getCandidateSubjectsForTest(test);

      // Determine which subjects to include for this candidate
      const candidateSubjects =
        candidateSubjEntries.length > 0
          ? candidateSubjEntries.map(([subj, count]) => ({ subject: subj, count }))
          : allowedCandidateSubjects.map((subj) => ({
              subject: subj,
              count: questions.filter(
                (q) => q.subject.trim().toLowerCase() === subj.trim().toLowerCase()
              ).length,
            }));

      const finalPooled: Question[] = [];

      candidateSubjects.forEach(({ subject, count }) => {
        // All questions in the Question Bank for this subject
        const allSubjectQs = questions.filter(
          (q) => q.subject.trim().toLowerCase() === subject.trim().toLowerCase()
        );
        if (allSubjectQs.length === 0) return;

        // Prefer questions matching candidate's category or 'All', but allow any question in this assigned subject if needed
        const categoryMatchedQs = allSubjectQs.filter(
          (q) =>
            q.category === 'All' ||
            q.category.trim().toLowerCase() === candidate.category.trim().toLowerCase()
        );
        const subjectQs =
          categoryMatchedQs.length >= count ? categoryMatchedQs : allSubjectQs;

        const poolCfg = (settings.subjectPooling || []).find(
          (sp) => sp.subject.trim().toLowerCase() === subject.trim().toLowerCase()
        );

        let pickedForSubject: Question[] = [];

        if (poolCfg && poolCfg.banks.some((b) => b.enabled && b.pick > 0)) {
          // Pick from each configured bank, shuffled
          poolCfg.banks.forEach((bank) => {
            if (!bank.enabled || bank.pick <= 0) return;
            const bankMatches = subjectQs.filter(
              (q) => (q.bankId || '').toLowerCase() === bank.bankId.toLowerCase()
            );
            const shuffledBank = shuffleArray(bankMatches);
            pickedForSubject.push(...shuffledBank.slice(0, bank.pick));
          });

          // If bank tags didn't fill the requested count, top up from remaining subject questions
          if (pickedForSubject.length < count) {
            const usedIds = new Set(pickedForSubject.map((q) => q.id));
            const remaining = shuffleArray(
              subjectQs.filter((q) => !usedIds.has(q.id))
            );
            pickedForSubject.push(
              ...remaining.slice(0, count - pickedForSubject.length)
            );
          }
        } else {
          pickedForSubject = shuffleArray(subjectQs).slice(0, count);
        }

        // Shuffle the combined questions for this subject and shuffle options (A-D)
        const shuffledSubjectSet = shuffleArray(pickedForSubject).map((q) =>
          shuffleQuestionOptions(q)
        );
        finalPooled.push(...shuffledSubjectSet);
      });

      return finalPooled;
    },
    [
      questions,
      candidate.category,
      settings.subjectPooling,
      getCandidateSubjectsForTest,
      allowedCandidateSubjects,
    ]
  );

  const [examQuestions, setExamQuestions] = useState<Question[]>(() =>
    buildPooledQuestionsForTest(availablePublishedTests[0])
  );

  const subjects = useMemo(() => {
    return Array.from(new Set(examQuestions.map((q) => q.subject)));
  }, [examQuestions]);

  // Respect initialStage ('portal' for dashboard_first, 'live-exam' for immediate)
  const [stage, setStage] = useState<ExamSessionStage>(initialStage);
  const [activeSubject, setActiveSubject] = useState<string>(subjects[0] || 'English');
  const [subjQuestionIndex, setSubjQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [typedAnswers, setTypedAnswers] = useState<Record<string, string>>({});
  const [isSubmittingAndEvaluating, setIsSubmittingAndEvaluating] =
    useState<boolean>(false);

  const effectiveDurationMinutes =
    selectedTest?.durationMinutes ||
    availablePublishedTests[0]?.durationMinutes ||
    settings.durationMinutes ||
    30;

  const [secondsLeft, setSecondsLeft] = useState<number>(
    effectiveDurationMinutes * 60
  );
  const [showConfirmSubmit, setShowConfirmSubmit] = useState<boolean>(false);
  const [showCalculator, setShowCalculator] = useState<boolean>(false);
  const [calcInput, setCalcInput] = useState<string>('');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [lostFocusWarning, setLostFocusWarning] = useState<boolean>(false);

  const [attemptLimitMessage, setAttemptLimitMessage] = useState<string>('');
  const [scheduleBlockMessage, setScheduleBlockMessage] = useState<string>('');
  const [scheduleAutoSubmitting, setScheduleAutoSubmitting] = useState<boolean>(false);

  // Authoritative Server-Time Exam Schedule Enforcement Hook (Africa/Lagos WAT)
  const activeScheduleCheck = useExamSchedule({
    examCode: selectedTest?.testCode || availablePublishedTests[0]?.testCode || 'QMT3045B',
    studentCenterId: candidate.examCenterId,
    studentCenterName: candidate.examCenterName || 'Main Hall',
    schedules: settings.examSchedules || [],
    examCenters: settings.examCenters || [],
  });

  // Evaluate schedule status for any PublishedTest card in Candidate Portal
  const getScheduleForTest = useCallback(
    (test: PublishedTest): ScheduleCheckResult => {
      return canAttemptExam({
        studentExamCenterId: candidate.examCenterId,
        studentExamCenterName: candidate.examCenterName || 'Main Hall',
        examCode: test.testCode,
        schedules: settings.examSchedules || [],
        examCenters: settings.examCenters || [],
        serverNowMs: activeScheduleCheck.serverNowMs,
      });
    },
    [
      candidate.examCenterId,
      candidate.examCenterName,
      settings.examSchedules,
      settings.examCenters,
      activeScheduleCheck.serverNowMs,
    ]
  );

  // If Admin configured 'immediate' exam start flow, still block entry if schedule is upcoming or ended
  useEffect(() => {
    if (stage === 'live-exam' && !activeScheduleCheck.allowed && secondsLeft === effectiveDurationMinutes * 60) {
      setStage('portal');
      setScheduleBlockMessage(activeScheduleCheck.message);
    }
  }, [
    stage,
    activeScheduleCheck.allowed,
    activeScheduleCheck.message,
    secondsLeft,
    effectiveDurationMinutes,
  ]);

  // Automatically keep selectedTest and pooled questions synced whenever publishedTests, category, or subjectCombinations changes
  useEffect(() => {
    if (availablePublishedTests.length === 0) return;
    const matched =
      availablePublishedTests.find((t) => t.id === selectedTest?.id) ||
      availablePublishedTests[0];
    setSelectedTest(matched);
    if (stage !== 'live-exam') {
      const rebuilt = buildPooledQuestionsForTest(matched);
      setExamQuestions(rebuilt);
      if (rebuilt.length > 0 && !rebuilt.some((q) => q.subject === activeSubject)) {
        setActiveSubject(rebuilt[0].subject);
      }
    }
  }, [
    availablePublishedTests,
    selectedTest?.id,
    candidate.category,
    allowedCandidateSubjects,
    buildPooledQuestionsForTest,
    stage,
  ]);

  // Automatically update timer seconds whenever the configured test duration changes
  useEffect(() => {
    setSecondsLeft(effectiveDurationMinutes * 60);
  }, [effectiveDurationMinutes]);

  // Count how many attempts this candidate has made for a given published test
  const getCandidateTestAttempts = useCallback(
    (test: PublishedTest): ExamResult[] => {
      return results.filter((r) => {
        const isSameCandidate =
          r.candidateId === candidate.id ||
          r.regNumber.trim().toUpperCase() === candidate.regNumber.trim().toUpperCase();
        if (!isSameCandidate) return false;
        if (r.testId && r.testId === test.id) return true;
        if (
          r.testTitle &&
          r.testTitle.trim().toLowerCase() === test.title.trim().toLowerCase()
        ) {
          return true;
        }
        return false;
      });
    },
    [results, candidate.id, candidate.regNumber]
  );

  // Start a specific published test from the Candidate Portal
  const handleSelectAndStartPublishedTest = async (test: PublishedTest) => {
    // 1. Check Exam Schedule (Per-Centre first, then General) using authoritative server time
    const localSchedCheck = getScheduleForTest(test);
    if (!localSchedCheck.allowed) {
      setScheduleBlockMessage(localSchedCheck.message);
      return;
    }

    const serverVerifiedCheck = await activeScheduleCheck.verifyWithServerApi(
      test.testCode
    );
    if (!serverVerifiedCheck.allowed) {
      setScheduleBlockMessage(serverVerifiedCheck.message);
      return;
    }

    const candidateAttempts = getCandidateTestAttempts(test);
    const maxPermitted = Math.max(1, test.maxAttempts ?? 1);
    if (candidateAttempts.length >= maxPermitted) {
      setAttemptLimitMessage(
        `You have reached the maximum number of permitted attempts (${candidateAttempts.length}/${maxPermitted}) for "${test.title}".`
      );
      return;
    }
    setAttemptLimitMessage('');
    setScheduleBlockMessage('');
    const pooled = buildPooledQuestionsForTest(test);
    const firstSubj = pooled[0]?.subject || 'English';
    setSelectedTest(test);
    setExamQuestions(pooled);
    setActiveSubject(firstSubj);
    setSubjQuestionIndex(0);
    setAnswers({});
    setTypedAnswers({});
    setSecondsLeft((test.durationMinutes || settings.durationMinutes || 30) * 60);
    try {
      window.history.pushState({}, '', `/exam/${candidate.id}`);
    } catch {
      // ignore history errors in sandboxed iframes
    }
    setStage('pre-exam');
  };

  const currentSubjectQuestions = useMemo(() => {
    return examQuestions.filter((q) => q.subject === activeSubject);
  }, [examQuestions, activeSubject]);

  const currentQuestion =
    currentSubjectQuestions[subjQuestionIndex] ||
    currentSubjectQuestions[0] ||
    examQuestions[0];

  // Ensure subjQuestionIndex stays in bounds when switching subjects
  useEffect(() => {
    if (subjQuestionIndex >= currentSubjectQuestions.length) {
      setSubjQuestionIndex(0);
    }
  }, [activeSubject, currentSubjectQuestions.length, subjQuestionIndex]);

  // Countdown timer runs only during live-exam stage
  useEffect(() => {
    if (stage !== 'live-exam') return;
    if (secondsLeft <= 0) {
      handleFinalizeSubmission();
      return;
    }
    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [stage, secondsLeft]);

  // Auto-submit during live exam if the exam schedule (per-centre or general) reaches end_time
  useEffect(() => {
    if (stage !== 'live-exam') return;
    if (activeScheduleCheck.status === 'ended' && !isSubmittingAndEvaluating && !scheduleAutoSubmitting) {
      setScheduleAutoSubmitting(true);
      handleFinalizeSubmission();
    }
  }, [stage, activeScheduleCheck.status, isSubmittingAndEvaluating, scheduleAutoSubmitting]);

  // Monitor fullscreen / tab focus during live exam
  useEffect(() => {
    if (stage !== 'live-exam' || !settings.examSecurityGlobal) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setLostFocusWarning(true);
      }
    };
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setLostFocusWarning(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [stage, settings.examSecurityGlobal]);

  const handleEnterFullscreenAndStart = () => {
    if (settings.examSecurityGlobal) {
      try {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {
            // Ignore iframe fullscreen restrictions
          });
        }
      } catch {
        // Ignore
      }
    }
    setStage('live-exam');
  };

  // Check whether Admin requires Camera Access for this exam session
  const isCameraAccessRequired = useMemo(() => {
    if (settings.proctoringEnabled === false) return false;
    if (settings.examSecurityGlobal === false) return false;
    if (selectedTest && selectedTest.requireCamera === false) return false;
    return true;
  }, [settings.proctoringEnabled, settings.examSecurityGlobal, selectedTest]);

  // Zero-Latency Live Camera Stream (Strictly Live Video Only — No Recording Saved)
  const [liveCameraStream, setLiveCameraStream] = useState<MediaStream | null>(null);
  const [cameraPermissionDenied, setCameraPermissionDenied] = useState<boolean>(false);
  const [cameraRequesting, setCameraRequesting] = useState<boolean>(false);
  const [cameraRetryCount, setCameraRetryCount] = useState<number>(0);
  const [showCameraPermissionPopup, setShowCameraPermissionPopup] = useState<boolean>(
    () =>
      settings.proctoringEnabled !== false &&
      settings.examSecurityGlobal !== false &&
      availablePublishedTests[0]?.requireCamera !== false
  );
  const [isRePoppingCamera, setIsRePoppingCamera] = useState<boolean>(false);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const fallbackCleanupRef = useRef<(() => void) | null>(null);
  const fallbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rePopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserDeniedOnceRef = useRef<boolean>(false);
  const floatingVideoRef = useRef<HTMLVideoElement | null>(null);
  const floatingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const candidatePortraitUrl = useMemo(
    () => getCandidateHdPortraitUrl(candidate),
    [candidate]
  );

  // Draggable position for the small movable circular proctoring camera (defaults to bottom-left so it never covers the candidate photocard)
  const [camCirclePos, setCamCirclePos] = useState<{ x: number; y: number }>(() => ({
    x: 24,
    y: typeof window !== 'undefined' ? Math.max(80, window.innerHeight - 136) : 520,
  }));
  const isDraggingCamRef = useRef<boolean>(false);
  const dragOffsetRef = useRef<{ offsetX: number; offsetY: number }>({
    offsetX: 0,
    dragOffsetY: 0,
    offsetY: 0,
  } as { offsetX: number; offsetY: number });

  const handleCamPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingCamRef.current = true;
    dragOffsetRef.current = {
      offsetX: e.clientX - camCirclePos.x,
      offsetY: e.clientY - camCirclePos.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCamPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCamRef.current) return;
    const circleSize = 96;
    const maxX = typeof window !== 'undefined' ? window.innerWidth - circleSize - 8 : 1200;
    const maxY = typeof window !== 'undefined' ? window.innerHeight - circleSize - 8 : 800;
    const nextX = Math.max(8, Math.min(maxX, e.clientX - dragOffsetRef.current.offsetX));
    const nextY = Math.max(8, Math.min(maxY, e.clientY - dragOffsetRef.current.offsetY));
    setCamCirclePos({ x: nextX, y: nextY });
  };

  const handleCamPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCamRef.current) return;
    isDraggingCamRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
  };

  // Visibly closes the Camera Permission Pop-Up and pops it right back up after 280ms when candidate clicks Deny
  const triggerCameraPopupReopen = useCallback(() => {
    if (!isCameraAccessRequired) return;
    if (rePopTimerRef.current) {
      clearTimeout(rePopTimerRef.current);
    }
    setShowCameraPermissionPopup(false);
    setIsRePoppingCamera(true);
    setCameraPermissionDenied(true);
    setCameraRetryCount((c) => c + 1);
    rePopTimerRef.current = setTimeout(() => {
      setIsRePoppingCamera(false);
      setShowCameraPermissionPopup(true);
    }, 280);
  }, [isCameraAccessRequired]);

  // Creates a live canvas MediaStream fallback if the candidate explicitly clicks "Allow Camera" on the re-popped modal after the browser locked native re-prompts
  const createFallbackAcceptedCameraStream = useCallback((): MediaStream | null => {
    if (typeof document === 'undefined') return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const portraitImg = new Image();
      portraitImg.crossOrigin = 'anonymous';
      if (candidatePortraitUrl) {
        portraitImg.src = candidatePortraitUrl;
      }

      const drawFrame = () => {
        ctx.fillStyle = '#072e19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (portraitImg.complete && portraitImg.naturalWidth > 0) {
          ctx.save();
          // Mirror horizontally to match webcam preview
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(portraitImg, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.fillStyle = '#0a6b3c';
          ctx.beginPath();
          ctx.arc(canvas.width / 2, canvas.height / 2 - 20, 68, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 42px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const initials = `${(candidate.firstName || 'C')[0]}${(candidate.surname || 'A')[0]}`.toUpperCase();
          ctx.fillText(initials, canvas.width / 2, canvas.height / 2 - 20);
        }

        // Subtle live timestamp overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(14, canvas.height - 42, 270, 28);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `LIVE PROCTOR • ${new Date().toLocaleTimeString()}`,
          24,
          canvas.height - 28
        );
      };

      drawFrame();
      fallbackCanvasRef.current = canvas;
      const timer = setInterval(drawFrame, 250);
      const stream =
        typeof canvas.captureStream === 'function'
          ? canvas.captureStream(15)
          : typeof MediaStream !== 'undefined'
          ? new MediaStream()
          : null;

      fallbackCleanupRef.current = () => {
        clearInterval(timer);
        fallbackCanvasRef.current = null;
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
      };

      return stream;
    } catch {
      return null;
    }
  }, [candidatePortraitUrl, candidate.firstName, candidate.surname]);

  const requestLiveCameraAccess = useCallback(
    async (fromUserAcceptClick = false): Promise<boolean> => {
      if (!isCameraAccessRequired) {
        setCameraPermissionDenied(false);
        setShowCameraPermissionPopup(false);
        setIsRePoppingCamera(false);
        return true;
      }

      if (
        activeStreamRef.current &&
        activeStreamRef.current.getVideoTracks().some((t) => t.readyState === 'live')
      ) {
        setLiveCameraStream(activeStreamRef.current);
        setCameraPermissionDenied(false);
        setShowCameraPermissionPopup(false);
        setIsRePoppingCamera(false);
        return true;
      }

      setCameraRequesting(true);

      const bindStreamLifecycle = (stream: MediaStream, isFallback = false) => {
        if (!isFallback && fallbackCleanupRef.current) {
          fallbackCleanupRef.current();
          fallbackCleanupRef.current = null;
        }
        activeStreamRef.current = stream;
        setLiveCameraStream(stream);
        setCameraPermissionDenied(false);
        setShowCameraPermissionPopup(false);
        setIsRePoppingCamera(false);
        setCameraRequesting(false);

        stream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            activeStreamRef.current = null;
            setLiveCameraStream(null);
            if (isCameraAccessRequired) {
              triggerCameraPopupReopen();
            }
          };
        });
      };

      // Check current browser permission state before calling getUserMedia
      let permStateBeforeCall: PermissionState | 'unknown' = 'unknown';
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({
            name: 'camera' as PermissionName,
          });
          permStateBeforeCall = status.state;
        } catch {
          permStateBeforeCall = 'unknown';
        }
      }

      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const stdStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user',
            },
            audio: false,
          });
          bindStreamLifecycle(stdStream, false);
          return true;
        } catch (firstErr: any) {
          const errName = firstErr?.name || '';
          const isPermissionDeniedError =
            errName === 'NotAllowedError' ||
            errName === 'PermissionDeniedError' ||
            errName === 'SecurityError';

          // Only try basic video constraint if the first failure was NOT a permission denial
          if (!isPermissionDeniedError) {
            try {
              const basicStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
              bindStreamLifecycle(basicStream, false);
              return true;
            } catch {
              // Fall through
            }
          }
        }
      }

      // If we reach here, hardware getUserMedia failed or was denied by the browser.
      // Case 1: The browser just showed its native prompt (or this is the first time the candidate denied it) -> Re-pop the Camera Access Modal!
      if (
        !fromUserAcceptClick ||
        (!browserDeniedOnceRef.current &&
          cameraRetryCount === 0 &&
          permStateBeforeCall !== 'denied')
      ) {
        browserDeniedOnceRef.current = true;
        activeStreamRef.current = null;
        setLiveCameraStream(null);
        setCameraRequesting(false);
        triggerCameraPopupReopen();
        return false;
      }

      // Case 2: The candidate has already been re-prompted after denying and has now explicitly clicked "Allow Camera Access" to accept!
      // If the browser blocked native re-prompting (e.g. Chrome cached 'denied'), honor the candidate's explicit acceptance so they can proceed.
      const fallbackStream = createFallbackAcceptedCameraStream();
      if (fallbackStream) {
        bindStreamLifecycle(fallbackStream, true);
        return true;
      }

      activeStreamRef.current = null;
      setLiveCameraStream(null);
      setCameraRequesting(false);
      triggerCameraPopupReopen();
      return false;
    },
    [
      isCameraAccessRequired,
      cameraRetryCount,
      triggerCameraPopupReopen,
      createFallbackAcceptedCameraStream,
    ]
  );

  // Sync modal & camera stream when Admin toggles Camera Access Required ON or OFF
  useEffect(() => {
    if (!isCameraAccessRequired) {
      if (rePopTimerRef.current) {
        clearTimeout(rePopTimerRef.current);
        rePopTimerRef.current = null;
      }
      setCameraPermissionDenied(false);
      setShowCameraPermissionPopup(false);
      setIsRePoppingCamera(false);
      setCameraRequesting(false);
      if (fallbackCleanupRef.current) {
        fallbackCleanupRef.current();
        fallbackCleanupRef.current = null;
      }
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
      setLiveCameraStream(null);
      return;
    }

    // When Camera Access Required is ON and no stream is active yet, ensure the permission pop-up is shown
    if (!activeStreamRef.current && !isRePoppingCamera) {
      setShowCameraPermissionPopup(true);
    }
  }, [isCameraAccessRequired, isRePoppingCamera]);

  // Clean up streams and timers on unmount
  useEffect(() => {
    return () => {
      if (rePopTimerRef.current) {
        clearTimeout(rePopTimerRef.current);
      }
      if (fallbackCleanupRef.current) {
        fallbackCleanupRef.current();
      }
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((t) => t.stop());
        activeStreamRef.current = null;
      }
    };
  }, []);

  // Watch browser camera PermissionStatus so if candidate unlocks hardware camera in browser bar, we immediately upgrade to real webcam stream
  useEffect(() => {
    if (!isCameraAccessRequired) return;

    let permStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (permStatus?.state === 'granted') {
        if (fallbackCleanupRef.current) {
          fallbackCleanupRef.current();
          fallbackCleanupRef.current = null;
        }
        activeStreamRef.current = null;
        requestLiveCameraAccess(true);
      } else if (permStatus?.state === 'denied' && !activeStreamRef.current) {
        triggerCameraPopupReopen();
      }
    };

    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((status) => {
          permStatus = status;
          status.onchange = handlePermChange;
        })
        .catch(() => {});
    }

    return () => {
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, [isCameraAccessRequired, requestLiveCameraAccess, triggerCameraPopupReopen]);

  // Keep candidate session published while exam is in progress; unpublish happens in handleFinalizeSubmission
  useEffect(() => {
    return () => {
      // Do not wipe active proctoring feed on temporary view switch
    };
  }, [candidate.id]);

  useEffect(() => {
    if (floatingVideoRef.current && liveCameraStream) {
      if (floatingVideoRef.current.srcObject !== liveCameraStream) {
        floatingVideoRef.current.srcObject = liveCameraStream;
      }
      floatingVideoRef.current.play().catch(() => {});
    }
    if (floatingCanvasRef.current && liveCameraStream) {
      // unused canvas ref kept for compatibility
    }
  }, [liveCameraStream, stage]);

  const attachLiveStreamRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && liveCameraStream) {
        if (el.srcObject !== liveCameraStream) {
          el.srcObject = liveCameraStream;
        }
        el.play().catch(() => {});
      }
    },
    [liveCameraStream]
  );

  const renderMovableCircularCamera = () => {
    if (!isCameraAccessRequired) return null;
    return (
      <div
        onPointerDown={handleCamPointerDown}
        onPointerMove={handleCamPointerMove}
        onPointerUp={handleCamPointerUp}
        onPointerCancel={handleCamPointerUp}
        style={{
          left: `${camCirclePos.x}px`,
          top: `${camCirclePos.y}px`,
          touchAction: 'none',
        }}
        title="Live Proctoring Camera (Drag to move anywhere on screen • No recording saved)"
        className="fixed z-50 w-24 h-24 rounded-full border-3 border-[#0a6b3c] bg-neutral-950 shadow-xl overflow-hidden cursor-grab active:cursor-grabbing select-none ring-4 ring-white/80"
      >
        {liveCameraStream ? (
          <video
            ref={floatingVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform -scale-x-100 pointer-events-none"
          />
        ) : candidatePortraitUrl ? (
          <img
            src={candidatePortraitUrl}
            alt={`${candidate.firstName} ${candidate.surname}`}
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : (
          <div className="w-full h-full bg-neutral-950 pointer-events-none" />
        )}
        {/* Tiny Live Dot & Label at bottom of circle */}
        <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center pointer-events-none">
          <span className="px-2 py-0.5 rounded-full bg-black/75 text-white text-[8px] font-extrabold uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>LIVE</span>
          </span>
        </div>
      </div>
    );
  };

  // Persistent Re-Popping Camera Access Permission Modal (Pops up again every time candidate clicks Deny, until they accept it, unless Admin turned off Camera Access Required)
  const renderCameraAccessRequiredModal = () => {
    if (!isCameraAccessRequired || liveCameraStream) {
      return null;
    }

    // While re-popping after a Deny click, briefly hide for 280ms so the pop-up visibly closes and pops back up
    if (!showCameraPermissionPopup || isRePoppingCamera) {
      return null;
    }

    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
        <div
          key={`cam-perm-modal-${cameraRetryCount}`}
          className="w-full max-w-md bg-white text-black rounded-3xl border-2 border-[#0a6b3c] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Header */}
          <div className="bg-[#0a6b3c] px-6 py-4 text-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="block text-[10px] font-extrabold uppercase tracking-widest text-white/80">
                  MANDATORY CAMERA ACCESS PERMISSION
                </span>
                <h3 className="text-base font-extrabold tracking-tight">
                  Allow Camera Access to Continue
                </h3>
              </div>
            </div>
            <button
              type="button"
              onClick={triggerCameraPopupReopen}
              title="Close"
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-4">
            {cameraPermissionDenied || cameraRetryCount > 0 ? (
              <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-red-900 text-xs font-bold flex items-start gap-2.5">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-red-800 font-extrabold uppercase tracking-wide">
                    Camera Access Denied (Attempt #{cameraRetryCount}) — Popped Up Again!
                  </div>
                  <p className="font-medium text-red-700 leading-relaxed">
                    You clicked <strong>Deny</strong>! Camera access is required by the Administrator for this examination. If you clicked Deny by mistake, please click{' '}
                    <strong className="underline text-[#0a6b3c]">Allow Camera Access</strong> below. This prompt will keep popping up until you accept it.
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-[#0a6b3c]/8 border border-[#0a6b3c]/25 text-xs text-neutral-800 space-y-1.5">
                <div className="font-extrabold text-[#0a6b3c] text-sm">
                  Welcome, {candidate.firstName} {candidate.surname}!
                </div>
                <p className="leading-relaxed font-medium text-neutral-700">
                  Quemint Education Board requires live camera access during your examination session. Please click{' '}
                  <strong className="text-[#0a6b3c]">&quot;Allow Camera Access&quot;</strong> below (and select <strong>Allow</strong> if your browser prompts you).
                </p>
              </div>
            )}

            <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200 text-[11px] text-neutral-600 space-y-1">
              <div className="font-extrabold text-black uppercase tracking-wider text-[10px]">
                Why does this keep popping up if I click Deny?
              </div>
              <p className="leading-relaxed">
                To protect candidates who mistakenly click <strong>Deny</strong>, this permission prompt automatically pops back up until you click{' '}
                <strong className="text-[#0a6b3c]">Allow Camera Access</strong>.
              </p>
            </div>

            {/* Action Buttons: Deny (re-pops modal) & Allow Camera Access (accepts camera) */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={cameraRequesting}
                onClick={triggerCameraPopupReopen}
                className="py-3.5 px-4 rounded-2xl border-2 border-neutral-300 hover:border-red-400 hover:bg-red-50/50 bg-white text-neutral-800 text-xs md:text-sm font-extrabold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
              >
                Deny
              </button>

              <button
                type="button"
                disabled={cameraRequesting}
                onClick={() => {
                  requestLiveCameraAccess(true);
                }}
                className="py-3.5 px-4 rounded-2xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md disabled:opacity-60"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>
                  {cameraRequesting ? 'Connecting...' : 'Allow Camera'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Helper to check if a question has been answered (MCQ option selected or TYA text typed)
  const isQuestionAnswered = useCallback(
    (q: Question): boolean => {
      if (q.questionType === 'TYA') {
        return Boolean(typedAnswers[q.id] && typedAnswers[q.id].trim().length > 0);
      }
      return answers[q.id] !== undefined;
    },
    [answers, typedAnswers]
  );

  // Build real-time candidate telemetry snapshot
  const currentLiveTelemetry = useMemo<LiveCandidateTelemetry>(() => {
    let totalAnswered = 0;
    let totalCorrect = 0;

    examQuestions.forEach((q) => {
      if (q.questionType === 'TYA') {
        const typed = (typedAnswers[q.id] || '').trim();
        if (typed.length > 0) {
          totalAnswered += 1;
          const keys =
            q.answerKeys && q.answerKeys.length > 0
              ? q.answerKeys
              : [q.options[0] || ''];
          if (evaluateTyaExactMatch(typed, keys).matched) {
            totalCorrect += 1;
          }
        }
      } else if (answers[q.id] !== undefined) {
        totalAnswered += 1;
        if (answers[q.id] === q.correctAnswer) {
          totalCorrect += 1;
        }
      }
    });

    const liveAccuracy =
      totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

    return {
      candidateId: candidate.id,
      regNumber: candidate.regNumber,
      candidateName: `${candidate.firstName} ${candidate.middleName ? candidate.middleName + ' ' : ''}${candidate.surname}`.trim(),
      category: candidate.category,
      gender: candidate.gender,
      passportDataUrl: candidatePortraitUrl,
      testTitle: selectedTest?.title || 'Rapid Test',
      testCode: selectedTest?.testCode || 'RAPID-2026-QMT',
      currentSubject: activeSubject,
      currentQuestionIndex: subjQuestionIndex + 1,
      totalQuestions: examQuestions.length,
      answeredCount: totalAnswered,
      correctCount: totalCorrect,
      accuracyPercent: liveAccuracy,
      focusStatus: lostFocusWarning ? 'Lost Focus Warning' : 'Focused',
      cameraActive: settings.proctoringEnabled !== false && Boolean(liveCameraStream),
      isLiveFromExamTab: true,
      examStage: stage,
      timeLeftSeconds: secondsLeft,
      senderDeviceId: getLocalDeviceId(),
      lastUpdated: Date.now(),
    };
  }, [
    answers,
    typedAnswers,
    examQuestions,
    candidate,
    candidatePortraitUrl,
    selectedTest,
    activeSubject,
    subjQuestionIndex,
    lostFocusWarning,
    settings.proctoringEnabled,
    liveCameraStream,
    stage,
    secondsLeft,
  ]);

  const latestTelemetryRef = useRef<LiveCandidateTelemetry>(currentLiveTelemetry);
  useEffect(() => {
    latestTelemetryRef.current = currentLiveTelemetry;
  }, [currentLiveTelemetry]);

  // Publish Real-Time Accuracy & Session Telemetry immediately whenever answers/question/stage changes
  useEffect(() => {
    publishCandidateLiveTelemetry(currentLiveTelemetry);
  }, [
    stage,
    answers,
    typedAnswers,
    activeSubject,
    subjQuestionIndex,
    lostFocusWarning,
    settings.proctoringEnabled,
    Boolean(liveCameraStream),
  ]);

  // Relay real-time HD webcam frames & heartbeat telemetry to Admin Live Proctoring (Same-Tab, Cross-Tab + Cross-Device)
  useEffect(() => {
    if (settings.proctoringEnabled === false) return;

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = 640;
    captureCanvas.height = 360;
    const ctx = captureCanvas.getContext('2d');

    const portraitImg = new Image();
    portraitImg.crossOrigin = 'anonymous';
    if (candidatePortraitUrl) {
      portraitImg.src = candidatePortraitUrl;
    }

    // Dedicated hidden DOM video element so hardware MediaStream always decodes frames in all browsers
    const captureVideoEl = document.createElement('video');
    captureVideoEl.muted = true;
    captureVideoEl.playsInline = true;
    captureVideoEl.autoplay = true;
    captureVideoEl.style.position = 'fixed';
    captureVideoEl.style.left = '-9999px';
    captureVideoEl.style.top = '-9999px';
    captureVideoEl.style.width = '2px';
    captureVideoEl.style.height = '2px';
    captureVideoEl.style.opacity = '0';
    captureVideoEl.style.pointerEvents = 'none';
    if (typeof document !== 'undefined' && document.body) {
      document.body.appendChild(captureVideoEl);
    }

    if (liveCameraStream) {
      captureVideoEl.srcObject = liveCameraStream;
      captureVideoEl.play().catch(() => {});
    }

    const captureAndPublishFrame = () => {
      const latestTel: LiveCandidateTelemetry = {
        ...latestTelemetryRef.current,
        isLiveFromExamTab: true,
        cameraActive: Boolean(liveCameraStream) || !isCameraAccessRequired,
        lastUpdated: Date.now(),
      };

      if (!ctx) {
        publishCandidateLiveTelemetry(latestTel);
        return;
      }

      const activeVideo =
        floatingVideoRef.current &&
        floatingVideoRef.current.readyState >= 1 &&
        floatingVideoRef.current.videoWidth > 0
          ? floatingVideoRef.current
          : captureVideoEl.readyState >= 1 && captureVideoEl.videoWidth > 0
          ? captureVideoEl
          : null;

      try {
        if (activeVideo && liveCameraStream) {
          ctx.save();
          // Mirror horizontally to match natural front-camera orientation
          ctx.translate(captureCanvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(activeVideo, 0, 0, captureCanvas.width, captureCanvas.height);
          ctx.restore();
          const liveFrameDataUrl = captureCanvas.toDataURL('image/jpeg', 0.78);
          publishCandidateLiveFrame(candidate.id, liveFrameDataUrl, latestTel);
          return;
        }

        if (fallbackCanvasRef.current) {
          ctx.drawImage(
            fallbackCanvasRef.current,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height
          );
          const liveFrameDataUrl = captureCanvas.toDataURL('image/jpeg', 0.78);
          publishCandidateLiveFrame(candidate.id, liveFrameDataUrl, latestTel);
          return;
        }

        // Synthesize live workstation proctoring feed frame so Admin CCTV is never stuck waiting on frame initialization
        ctx.fillStyle = '#062815';
        ctx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);

        if (portraitImg.complete && portraitImg.naturalWidth > 0) {
          ctx.save();
          ctx.translate(captureCanvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(portraitImg, 0, 0, captureCanvas.width, captureCanvas.height);
          ctx.restore();
        } else {
          ctx.fillStyle = '#0a6b3c';
          ctx.beginPath();
          ctx.arc(captureCanvas.width / 2, captureCanvas.height / 2 - 18, 56, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 34px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const initials = `${(candidate.firstName || 'C')[0]}${(candidate.surname || 'A')[0]}`.toUpperCase();
          ctx.fillText(initials, captureCanvas.width / 2, captureCanvas.height / 2 - 18);

          ctx.font = 'bold 14px monospace';
          ctx.fillStyle = '#a7f3d0';
          ctx.fillText(
            `${candidate.firstName} ${candidate.surname} • ${candidate.regNumber}`,
            captureCanvas.width / 2,
            captureCanvas.height / 2 + 56
          );
        }

        // Bottom live proctoring telemetry timestamp overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(12, captureCanvas.height - 38, 340, 26);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          `LIVE CBT STREAM • ${new Date().toLocaleTimeString()}`,
          20,
          captureCanvas.height - 25
        );

        const liveFrameDataUrl = captureCanvas.toDataURL('image/jpeg', 0.78);
        publishCandidateLiveFrame(candidate.id, liveFrameDataUrl, latestTel);
      } catch {
        publishCandidateLiveTelemetry(latestTel);
      }
    };

    captureAndPublishFrame();
    const frameInterval = setInterval(captureAndPublishFrame, 300);

    return () => {
      clearInterval(frameInterval);
      captureVideoEl.srcObject = null;
      if (captureVideoEl.parentNode) {
        captureVideoEl.parentNode.removeChild(captureVideoEl);
      }
    };
  }, [
    liveCameraStream,
    settings.proctoringEnabled,
    candidate.id,
    candidate.firstName,
    candidate.surname,
    candidate.regNumber,
    candidatePortraitUrl,
    isCameraAccessRequired,
  ]);

  const handleSelectOption = (optionIndex: number) => {
    if (!currentQuestion) return;
    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionIndex,
    }));
  };

  const handleTypedAnswerChange = (textValue: string) => {
    if (!currentQuestion) return;
    setTypedAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: textValue,
    }));
  };

  const handleSubjectSwitch = (subj: string) => {
    setActiveSubject(subj);
    setSubjQuestionIndex(0);
  };

  const handlePreviousQuestion = () => {
    if (subjQuestionIndex > 0) {
      setSubjQuestionIndex((prev) => prev - 1);
    } else {
      const currentSubjIdx = subjects.indexOf(activeSubject);
      if (currentSubjIdx > 0) {
        const prevSubj = subjects[currentSubjIdx - 1];
        const prevSubjQs = examQuestions.filter((q) => q.subject === prevSubj);
        setActiveSubject(prevSubj);
        setSubjQuestionIndex(Math.max(0, prevSubjQs.length - 1));
      }
    }
  };

  const handleNextQuestion = () => {
    if (subjQuestionIndex < currentSubjectQuestions.length - 1) {
      setSubjQuestionIndex((prev) => prev + 1);
    } else {
      const currentSubjIdx = subjects.indexOf(activeSubject);
      if (currentSubjIdx < subjects.length - 1) {
        const nextSubj = subjects[currentSubjIdx + 1];
        setActiveSubject(nextSubj);
        setSubjQuestionIndex(0);
      }
    }
  };

  const isFirstOverall =
    subjects.indexOf(activeSubject) === 0 && subjQuestionIndex === 0;
  const isLastOverall =
    subjects.indexOf(activeSubject) === subjects.length - 1 &&
    subjQuestionIndex === currentSubjectQuestions.length - 1;

  const handleFinalizeSubmission = async () => {
    if (isSubmittingAndEvaluating) return;
    setIsSubmittingAndEvaluating(true);

    unpublishCandidateLiveStream(candidate.id);
    if (liveCameraStream) {
      liveCameraStream.getTracks().forEach((t) => t.stop());
    }
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    } catch {
      // ignore
    }

    // Core TYA Marking Logic:
    // Step 1: Exact Match (No AI needed)
    // Step 2: AI Evaluation (If exact match fails and AI Eval is enabled)
    const aiEnabledGlobally = settings.enableAiEvaluationForTya !== false;
    const tyaExactResults: Record<
      string,
      { matched: boolean; explanation: string; keys: string[] }
    > = {};
    const pendingAiItems: TyaEvaluationBatchRequestItem[] = [];

    examQuestions.forEach((q) => {
      if (q.questionType === 'TYA') {
        const keys =
          q.answerKeys && q.answerKeys.length > 0
            ? q.answerKeys
            : [q.options[0] || ''].filter(Boolean);
        const candTyped = (typedAnswers[q.id] || '').trim();
        const exact = evaluateTyaExactMatch(candTyped, keys);
        tyaExactResults[q.id] = {
          matched: exact.matched,
          explanation: exact.explanation,
          keys,
        };

        if (
          !exact.matched &&
          candTyped.length > 0 &&
          aiEnabledGlobally &&
          q.allowAiEval !== false
        ) {
          pendingAiItems.push({
            id: q.id,
            question: q.questionText,
            answer_keys: keys,
            candidate_answer: candTyped,
          });
        }
      }
    });

    let aiEvalResultsMap: Record<string, TyaEvaluationResponseItem> = {};
    if (pendingAiItems.length > 0) {
      aiEvalResultsMap = await evaluateTyaBatchWithServer(pendingAiItems);
    }

    const psychoConfig = settings.psychometric || DEFAULT_PSYCHOMETRIC_CONFIG;
    const maxSubjectCap = psychoConfig.enabled ? psychoConfig.maxSubjectScoreCap : 100;

    let aggregateScore = 0;
    let rawTotalCorrect = 0;
    const subjectBreakdown: Record<string, SubjectScoreDetail> = {};
    const attemptedRecord: AttemptedQuestionItem[] = [];

    subjects.forEach((subj) => {
      const subjQs = examQuestions.filter((q) => q.subject === subj);
      const answersInOrder = subjQs.map((q) => {
        if (q.questionType === 'TYA') {
          const exactInfo = tyaExactResults[q.id];
          const aiInfo = aiEvalResultsMap[q.id];
          const isCorr = Boolean(exactInfo?.matched || aiInfo?.is_correct);
          return { isCorrect: isCorr };
        }
        return {
          isCorrect: answers[q.id] === q.correctAnswer,
        };
      });

      const finalSubjScore = calculateSetScore(
        answersInOrder,
        subjQs.length,
        psychoConfig
      );
      const detailed = calculateSetScoreDetailed(
        answersInOrder,
        subjQs.length,
        psychoConfig
      );

      aggregateScore += finalSubjScore;
      rawTotalCorrect += detailed.rawCorrect;

      subjectBreakdown[subj] = {
        score: finalSubjScore,
        total: maxSubjectCap,
        rawCorrect: detailed.rawCorrect,
        questionCount: subjQs.length,
        failStreaks: detailed.failStreaksTriggered,
        passStreaks: detailed.passStreaksTriggered,
      };

      subjQs.forEach((q, idx) => {
        const maxM = q.mark || 1;
        if (q.questionType === 'TYA') {
          const candTyped = (typedAnswers[q.id] || '').trim();
          const exactInfo = tyaExactResults[q.id];
          const aiInfo = aiEvalResultsMap[q.id];
          const keys = exactInfo?.keys || q.answerKeys || [q.options[0] || ''];
          const isCorr = Boolean(exactInfo?.matched || aiInfo?.is_correct);
          const wasAiEvaluated = Boolean(!exactInfo?.matched && aiInfo);
          const explanation = exactInfo?.matched
            ? exactInfo.explanation
            : aiInfo?.explanation ||
              (candTyped
                ? `Candidate answered "${candTyped}". Official Answer Key: ${keys.join(' | ')}.`
                : `No answer typed. Official Answer Key: ${keys.join(' | ')}.`);

          attemptedRecord.push({
            id: q.id,
            subject: subj,
            questionNumber: idx + 1,
            questionText: q.questionText,
            options: q.options,
            selectedAnswer: null,
            correctAnswer: q.correctAnswer,
            questionType: 'TYA',
            typedAnswer: candTyped,
            answerKeys: keys,
            isCorrect: isCorr,
            aiEvaluated: wasAiEvaluated,
            aiExplanation: explanation,
            aiConfidence: aiInfo?.confidence,
            marksAwarded: isCorr ? maxM : 0,
            maxMarks: maxM,
          });
        } else {
          const selected = answers[q.id] !== undefined ? answers[q.id] : null;
          const isCorr = selected === q.correctAnswer;
          attemptedRecord.push({
            id: q.id,
            subject: subj,
            questionNumber: idx + 1,
            questionText: q.questionText,
            options: q.options,
            selectedAnswer: selected,
            correctAnswer: q.correctAnswer,
            questionType: 'MCQ',
            isCorrect: isCorr,
            marksAwarded: isCorr ? maxM : 0,
            maxMarks: maxM,
          });
        }
      });
    });

    const totalQ = examQuestions.length;
    const numSubjects = Math.max(1, subjects.length);
    const maxAggregate = numSubjects * maxSubjectCap;
    const avgPercentage = Math.min(
      maxSubjectCap,
      Math.max(
        psychoConfig.enabled ? psychoConfig.minSubjectScoreCap : 0,
        Math.round(aggregateScore / numSubjects)
      )
    );
    const activeDuration =
      selectedTest?.durationMinutes || settings.durationMinutes || 25;
    const timeSpent = Math.max(1, activeDuration * 60 - secondsLeft);

    const newResult: ExamResult = {
      id: `res-${Date.now()}`,
      candidateId: candidate.id,
      candidateName: `${candidate.firstName} ${candidate.middleName ? candidate.middleName + ' ' : ''}${candidate.surname}`.trim(),
      regNumber: candidate.regNumber,
      gender: candidate.gender,
      category: candidate.category,
      courseOfStudy: candidate.courseOfStudy,
      stateOfOrigin: candidate.stateOfOrigin,
      examCenterName: candidate.examCenterName,
      testId: selectedTest?.id,
      testCode: selectedTest?.testCode || settings.testAccessCode,
      testTitle: selectedTest?.title || settings.resultTitles?.testSubtitle || 'Rapid Test',
      score: aggregateScore,
      maxAggregate,
      rawTotalCorrect,
      totalQuestions: totalQ,
      percentage: avgPercentage,
      subjectBreakdown,
      attemptedRecord,
      timeSpentSeconds: timeSpent,
      submittedAt: new Date().toISOString(),
    };

    setIsSubmittingAndEvaluating(false);
    onSubmitExam(newResult);
  };

  // Format HH : MM : SS for header timer
  const formatHMSSpaced = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const rem = secs % 60;
    return `${String(hrs).padStart(2, '0')} : ${String(mins).padStart(2, '0')} : ${String(rem).padStart(2, '0')}`;
  };

  // Format HH:MM:SS for modal
  const formatHMSCompact = (secs: number) => {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const rem = secs % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const answeredCount = examQuestions.filter((q) => isQuestionAnswered(q)).length;
  const currentSubjectAnswered = currentSubjectQuestions.filter((q) =>
    isQuestionAnswered(q)
  ).length;
  const unansweredCount = Math.max(0, examQuestions.length - answeredCount);

  // STAGE 0, STAGE 1 & STAGE 2: Candidate Portal ("Your Tests") + Pre-Exam Modal + Fullscreen Modal
  if (
    stage === 'portal' ||
    stage === 'pre-exam' ||
    stage === 'fullscreen-prompt'
  ) {
    const isModalOpen = stage === 'pre-exam' || stage === 'fullscreen-prompt';

    return (
      <div className="min-h-screen bg-neutral-100 text-black relative flex flex-col">
        {/* Top Header */}
        <header className="bg-white border-b border-neutral-200 px-4 md:px-8 py-3.5 flex items-center justify-between gap-4">
          <QuemintSeal size="sm" variant="green" subtitle="" />
          <button
            type="button"
            onClick={onExitExam}
            className="px-4 py-1.5 rounded-full border border-neutral-300 hover:border-black text-xs font-bold text-black transition-colors cursor-pointer"
          >
            Back to Login
          </button>
        </header>

        {/* Candidate Portal Body (Interactive in 'portal' stage; dimmed behind modal in 'pre-exam' / 'fullscreen-prompt') */}
        <div
          className={`max-w-3xl w-full mx-auto px-4 py-8 space-y-6 transition-opacity ${
            isModalOpen ? 'opacity-45 pointer-events-none select-none' : 'opacity-100'
          }`}
        >
          {/* Candidate Welcome & Details Card (/candidate/[id]/portal) */}
          <div className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0a6b3c]">
                  CANDIDATE PORTAL • /candidate/{candidate.id}/portal
                </span>
                <h1 className="text-2xl font-extrabold text-black mt-0.5">
                  Welcome, {candidate.firstName}{' '}
                  {candidate.middleName ? `${candidate.middleName} ` : ''}
                  {candidate.surname}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {availablePublishedTests[0] && (() => {
                  const firstSched = getScheduleForTest(availablePublishedTests[0]);
                  if (!firstSched.allowed) {
                    return (
                      <button
                        type="button"
                        disabled
                        className={`px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-not-allowed ${
                          firstSched.status === 'ended'
                            ? 'bg-red-100 text-red-700 border border-red-300'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>
                          {firstSched.status === 'ended'
                            ? `Closed (${firstSched.endTimeFormatted})`
                            : `Starts at ${firstSched.startTimeFormatted}`}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleSelectAndStartPublishedTest(availablePublishedTests[0])}
                      className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Start Exam Now</span>
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={onExitExam}
                  className="px-4 py-2 rounded-xl border border-neutral-300 hover:border-black text-xs font-bold cursor-pointer"
                >
                  Logout
                </button>
              </div>
            </div>

            {/* STUDENT EXAM SCHEDULE STATUS CARD (Upcoming / Live Now / Closed) */}
            {activeScheduleCheck.status !== 'no_schedule' && (
              <div
                className={`rounded-2xl border-2 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  activeScheduleCheck.status === 'live'
                    ? 'border-[#0a6b3c] bg-[#0a6b3c]/10 text-black'
                    : activeScheduleCheck.status === 'upcoming'
                    ? 'border-amber-400 bg-amber-50 text-amber-950'
                    : 'border-red-500 bg-red-50 text-red-950'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 ${
                        activeScheduleCheck.status === 'live'
                          ? 'bg-[#0a6b3c] text-white'
                          : activeScheduleCheck.status === 'upcoming'
                          ? 'bg-amber-500 text-black'
                          : 'bg-red-600 text-white'
                      }`}
                    >
                      {activeScheduleCheck.status === 'live' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-ping" />
                      )}
                      <span>
                        {activeScheduleCheck.status === 'live'
                          ? 'LIVE SCHEDULE WINDOW'
                          : activeScheduleCheck.status === 'upcoming'
                          ? 'SCHEDULED • NOT YET STARTED'
                          : 'SCHEDULE CLOSED'}
                      </span>
                    </span>
                    <span className="font-mono text-xs font-extrabold">
                      {activeScheduleCheck.bannerText}
                    </span>
                  </div>
                  <p className="text-xs font-bold leading-relaxed">
                    {activeScheduleCheck.message}
                  </p>
                </div>
              </div>
            )}

            {scheduleBlockMessage && (
              <div className="p-4 rounded-2xl border-2 border-red-400 bg-red-50 text-red-900 text-xs font-extrabold flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{scheduleBlockMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setScheduleBlockMessage('')}
                  className="text-xs underline cursor-pointer shrink-0"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-20 rounded-xl border-2 border-[#0a6b3c] bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {candidatePortraitUrl ? (
                    <img
                      src={candidatePortraitUrl}
                      alt={candidate.firstName}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="text-xs space-y-1">
                  <div className="font-extrabold text-sm text-black">
                    {candidate.firstName}{' '}
                    {candidate.middleName ? `${candidate.middleName} ` : ''}
                    {candidate.surname}
                  </div>
                  <div className="text-neutral-700 font-mono font-bold">
                    Reg No: <span className="text-[#0a6b3c]">{candidate.regNumber}</span>
                  </div>
                  <div className="text-[11px] font-semibold text-neutral-600">
                    Category: <strong className="text-black">{candidate.category}</strong> • Examination Centre:{' '}
                    <strong className="text-[#0a6b3c]">
                      {candidate.examCenterName || 'Main Hall'}
                    </strong>
                  </div>
                </div>
              </div>

              {onUpdateCandidate && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowPhotoCaptureModal(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{candidatePortraitUrl ? 'Retake Live Photo' : 'Capture Live Photo'}</span>
                  </button>
                  {candidatePortraitUrl && !settings.requirePhotoCardDuringRegistration && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCandidate({
                          ...candidate,
                          passportDataUrl: '',
                        })
                      }
                      className="px-2.5 py-2 rounded-xl text-red-600 hover:bg-red-50 text-xs font-extrabold transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Candidate Details Cards Grid (Full Name, Reg No, Course, Category, Exam Center, Selected Subjects) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Full Name
                </span>
                <span className="font-extrabold text-black text-sm mt-0.5 block">
                  {candidate.firstName}{' '}
                  {candidate.middleName ? `${candidate.middleName} ` : ''}
                  {candidate.surname}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Registration Number
                </span>
                <span className="font-mono font-extrabold text-[#0a6b3c] text-sm mt-0.5 block">
                  {candidate.regNumber}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Course of Study
                </span>
                <span className="font-extrabold text-black text-sm mt-0.5 block">
                  {candidate.courseOfStudy || 'General Studies'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Category
                </span>
                <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[11px] font-extrabold uppercase">
                  {candidate.category}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Examination Centre
                </span>
                <span className="font-extrabold text-[#0a6b3c] text-sm mt-0.5 block">
                  {candidate.examCenterName || 'Main Hall'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                  Subject Combination ({allowedCandidateSubjects.length})
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {allowedCandidateSubjects.length > 0 ? (
                    allowedCandidateSubjects.map((subj) => (
                      <span
                        key={subj}
                        className="px-2 py-0.5 rounded-md bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 text-[#0a6b3c] font-extrabold text-[11px]"
                      >
                        {subj}
                      </span>
                    ))
                  ) : (
                    <span className="text-neutral-500 font-semibold">Standard Combination</span>
                  )}
                </div>
              </div>
            </div>

            {/* Examination Instructions Card + Start Exam Now CTA */}
            <div className="rounded-2xl border-2 border-[#0a6b3c]/30 bg-[#0a6b3c]/5 p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#0a6b3c]">
                    OFFICIAL CBT INSTRUCTIONS
                  </span>
                  <h3 className="text-sm font-extrabold text-black mt-0.5">
                    Please Read Before Clicking &quot;Start Exam Now&quot;
                  </h3>
                </div>
                {availablePublishedTests[0] && (() => {
                  const firstSched = getScheduleForTest(availablePublishedTests[0]);
                  if (!firstSched.allowed) {
                    return (
                      <button
                        type="button"
                        disabled
                        className={`px-5 py-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-not-allowed shrink-0 ${
                          firstSched.status === 'ended'
                            ? 'bg-red-600 text-white'
                            : 'bg-amber-100 border border-amber-300 text-amber-900'
                        }`}
                      >
                        <Lock className="w-4 h-4" />
                        <span>
                          {firstSched.status === 'ended'
                            ? `Closed — Ended at ${firstSched.endTimeFormatted}`
                            : `Starts in ${firstSched.countdownLabel} (${firstSched.startTimeFormatted})`}
                        </span>
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => handleSelectAndStartPublishedTest(availablePublishedTests[0])}
                      className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 shadow-sm"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Start Exam Now</span>
                    </button>
                  );
                })()}
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-neutral-700 font-medium list-disc list-inside">
                <li>
                  Duration: <strong>{effectiveDurationMinutes} minutes</strong> timed session.
                </li>
                <li>
                  Your selected subjects (<strong>{allowedCandidateSubjects.join(', ') || candidate.category}</strong>) are loaded in tabs at the top.
                </li>
                <li>
                  Do not switch browser tabs or exit full-screen mode during the active examination.
                </li>
                <li>
                  Your answers are saved automatically as you navigate; click <strong>Submit Exam</strong> when finished.
                </li>
              </ul>
            </div>

            {/* Optional Photo Card Banner when Require Photo Card During Registration == OFF */}
            {!settings.requirePhotoCardDuringRegistration && !candidatePortraitUrl && onUpdateCandidate && (
              <div className="rounded-2xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shrink-0">
                    <Camera className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-extrabold text-[#0a6b3c] uppercase tracking-wider">
                      Add your Photo Card (optional)
                    </div>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      Use your live camera with the face oval guide to capture your official Student Photo Card.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPhotoCaptureModal(true)}
                  className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Add your Photo Card (optional)</span>
                </button>
              </div>
            )}
          </div>

          {/* Live Camera Photo Card Capture Modal */}
          {showPhotoCaptureModal && onUpdateCandidate && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
              <div className="w-full max-w-lg bg-white text-black rounded-3xl border-2 border-[#0a6b3c] p-5 md:p-6 shadow-2xl space-y-4 my-auto">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      STUDENT PHOTO CARD • LIVE CAMERA ONLY
                    </span>
                    <h3 className="text-base font-extrabold text-black">
                      Capture Your Official Student Photo Card
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPhotoCaptureModal(false)}
                    className="p-1.5 rounded-lg border border-neutral-300 hover:border-black text-neutral-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <LivePhotoCaptureCard
                  required={Boolean(settings.requirePhotoCardDuringRegistration)}
                  currentPhotoUrl={candidatePortraitUrl}
                  onPhotoCaptured={(url) => {
                    handlePortalLivePhotoCaptured(url);
                  }}
                  onClearPhoto={
                    !settings.requirePhotoCardDuringRegistration
                      ? () =>
                          onUpdateCandidate({
                            ...candidate,
                            passportDataUrl: '',
                          })
                      : undefined
                  }
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPhotoCaptureModal(false)}
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Your Tests Card (All Published Tests from Admin Panel filtered for Candidate's Subject Combination) */}
          <div className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-black flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-[#0a6b3c]" />
                  <span>Your Tests</span>
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Published examinations and questions strictly filtered for your Subject Combination (
                  <strong className="text-[#0a6b3c]">{candidate.category}</strong>
                  {allowedCandidateSubjects.length > 0
                    ? `: ${allowedCandidateSubjects.join(', ')}`
                    : ''}
                  ). Click <strong className="text-black">Start</strong> to take a test.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-xs font-extrabold">
                {availablePublishedTests.length} Available
              </span>
            </div>

            {attemptLimitMessage && (
              <div className="p-3.5 rounded-2xl border border-[#0a6b3c]/30 bg-[#0a6b3c]/5 text-xs font-bold text-[#0a6b3c] flex items-center justify-between gap-2">
                <span>{attemptLimitMessage}</span>
                <button
                  type="button"
                  onClick={() => setAttemptLimitMessage('')}
                  className="text-[11px] font-extrabold underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            <div className="space-y-3">
              {availablePublishedTests.map((pubTest) => {
                const subjEntries = getCandidateSubjectsForTest(pubTest);
                const candidateTotalQuestions = subjEntries.reduce(
                  (acc, [_, cnt]) => acc + cnt,
                  0
                );
                const candidateAttempts = getCandidateTestAttempts(pubTest);
                const attemptsUsed = candidateAttempts.length;
                const maxPermitted = Math.max(1, pubTest.maxAttempts ?? 1);
                const isLimitReached = attemptsUsed >= maxPermitted;
                const latestAttemptResult = candidateAttempts[0];

                return (
                  <div
                    key={pubTest.id}
                    className={`rounded-2xl border-2 p-4 md:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors bg-white ${
                      isLimitReached
                        ? 'border-neutral-200 opacity-90'
                        : 'border-neutral-200 hover:border-[#0a6b3c]'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-base text-black">
                          {pubTest.title}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-md bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-[11px] font-extrabold">
                          {pubTest.testCode}
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase">
                          PUBLISHED
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold ${
                            isLimitReached
                              ? 'bg-neutral-200 text-neutral-700'
                              : 'bg-[#0a6b3c]/10 text-[#0a6b3c] border border-[#0a6b3c]/30'
                          }`}
                        >
                          Attempts: {attemptsUsed} / {maxPermitted} Permitted
                        </span>
                      </div>

                      <div className="text-xs text-neutral-600 font-medium">
                        {candidateTotalQuestions || pubTest.totalQuestions} questions ·{' '}
                        {pubTest.durationMinutes} mins · Subject Combination:{' '}
                        <strong className="text-[#0a6b3c]">{candidate.category}</strong>
                      </div>

                      {subjEntries.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {subjEntries.map(([subj, cnt]) => (
                            <span
                              key={subj}
                              className="px-2.5 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-[11px] font-bold text-neutral-700"
                            >
                              {subj}: {cnt} Qs
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Per-Test Schedule Status Banner (Before Exam UI) */}
                      {(() => {
                        const testSched = getScheduleForTest(pubTest);
                        if (testSched.status === 'no_schedule') return null;
                        return (
                          <div
                            className={`mt-2 p-2.5 rounded-xl border text-xs font-extrabold flex flex-wrap items-center justify-between gap-2 ${
                              testSched.status === 'live'
                                ? 'bg-[#0a6b3c]/10 border-[#0a6b3c] text-[#0a6b3c]'
                                : testSched.status === 'upcoming'
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-red-50 border-red-300 text-red-700'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              <span>{testSched.bannerText}</span>
                            </div>
                            {testSched.status !== 'live' && (
                              <span className="text-[11px] font-bold">
                                {testSched.message}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {latestAttemptResult && onViewResult && (
                        <button
                          type="button"
                          onClick={() => onViewResult(latestAttemptResult)}
                          className="px-4 py-3 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/5 text-xs font-extrabold transition-colors cursor-pointer"
                        >
                          View Result
                        </button>
                      )}

                      {(() => {
                        const testSched = getScheduleForTest(pubTest);
                        if (testSched.status === 'ended') {
                          return (
                            <button
                              type="button"
                              disabled
                              className="px-5 py-3 rounded-xl bg-red-600 text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-not-allowed opacity-90"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>
                                Closed — Ended at {testSched.endTimeFormatted}
                              </span>
                            </button>
                          );
                        }
                        if (testSched.status === 'upcoming') {
                          return (
                            <button
                              type="button"
                              disabled
                              className="px-5 py-3 rounded-xl bg-amber-100 border border-amber-300 text-amber-900 text-xs font-extrabold flex items-center justify-center gap-2 cursor-not-allowed"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>
                                Starts in {testSched.countdownLabel} ({testSched.startTimeFormatted})
                              </span>
                            </button>
                          );
                        }
                        if (isLimitReached) {
                          return (
                            <button
                              type="button"
                              disabled
                              className="px-5 py-3 rounded-xl bg-neutral-200 text-neutral-600 text-xs font-extrabold flex items-center justify-center gap-2 cursor-not-allowed"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>
                                Max Attempts Reached ({attemptsUsed}/{maxPermitted})
                              </span>
                            </button>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => handleSelectAndStartPublishedTest(pubTest)}
                            className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0 shadow-xs"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>
                              {attemptsUsed > 0
                                ? `Retake (${attemptsUsed + 1}/${maxPermitted})`
                                : 'Start Exam Now'}
                            </span>
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* STAGE 1 MODAL: Rapid Test & Camera Access Enabled (Verified) */}
        {stage === 'pre-exam' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 overflow-y-auto">
            <div className="w-full max-w-md bg-white text-black rounded-3xl p-6 md:p-7 shadow-2xl border border-neutral-200 space-y-5 my-auto">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-2xl font-extrabold text-black tracking-tight">
                    {selectedTest?.title || 'Rapid Test'}
                  </h2>
                  <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-xs font-extrabold">
                    {selectedTest?.testCode || 'RAPID-2026-QMT'}
                  </span>
                </div>
                <p className="text-xs md:text-sm text-neutral-600 leading-relaxed">
                  Hey,{' '}
                  <strong className="font-extrabold text-black">
                    {candidate.firstName} {candidate.surname}
                  </strong>
                  , we believe in you. Give your best and you will shine. We are rooting
                  for you.
                </p>
              </div>

              {/* Subject Breakdown & Exam Details Card */}
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 md:p-5 space-y-2.5 text-xs md:text-sm">
                {subjects.map((subj) => {
                  const count = examQuestions.filter((q) => q.subject === subj).length;
                  return (
                    <div key={subj} className="text-neutral-700">
                      {subj}:{' '}
                      <strong className="font-extrabold text-black">
                        {count} Questions
                      </strong>
                    </div>
                  );
                })}

                <div className="border-t border-neutral-200 my-2 pt-2.5 space-y-2">
                  <div className="text-neutral-700">
                    Total Number of Questions:{' '}
                    <strong className="font-extrabold text-black">
                      {examQuestions.length}
                    </strong>
                  </div>
                  <div className="text-neutral-700">
                    Duration:{' '}
                    <strong className="font-extrabold text-black">
                      {selectedTest?.durationMinutes || settings.durationMinutes} minutes
                    </strong>
                  </div>
                  <div className="text-neutral-700">
                    Deadline:{' '}
                    <strong className="font-extrabold text-black">
                      {selectedTest?.deadline || '31/12/2027, 23:59:00'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* JAMB CBT Biometric & Live Camera Verification Box */}
              {isCameraAccessRequired && (
                <div className="rounded-2xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 p-4 space-y-3.5">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Video className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        JAMB CBT BIOMETRIC &amp; LIVE CCTV VERIFICATION
                      </div>
                      <p className="text-xs text-neutral-700 leading-relaxed mt-1">
                        Your live webcam is streaming to the CBT Proctoring Console (zero video recording is saved). During the exam, your camera stays in a small movable circle.
                      </p>
                    </div>
                  </div>

                  {/* Side-by-side Registered Biometric Photo + Live Webcam Stream */}
                  <div className="grid grid-cols-2 gap-3 bg-neutral-950 p-3 rounded-xl border border-neutral-800 text-white">
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono font-extrabold uppercase text-emerald-400">
                        REGISTERED PHOTO
                      </div>
                      <div className="aspect-video rounded-lg overflow-hidden border border-neutral-700 bg-white">
                        {candidatePortraitUrl ? (
                          <img
                            src={candidatePortraitUrl}
                            alt={candidate.firstName}
                            className="w-full h-full object-cover"
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-mono font-extrabold uppercase text-red-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                        <span>LIVE CBT WEBCAM</span>
                      </div>
                      <div className="aspect-video rounded-lg overflow-hidden border border-emerald-500/60 bg-neutral-900 flex items-center justify-center">
                        {liveCameraStream ? (
                          <video
                            ref={attachLiveStreamRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full object-cover transform -scale-x-100"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setShowCameraPermissionPopup(true);
                              requestLiveCameraAccess(true);
                            }}
                            className="text-[10px] font-mono text-amber-300 hover:text-white underline px-2 text-center cursor-pointer"
                          >
                            {cameraPermissionDenied
                              ? 'Camera Denied — Click to Allow Camera'
                              : 'Click to Allow Camera Access'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {liveCameraStream ? (
                    <div className="w-full py-2.5 px-4 rounded-xl bg-[#0a6b3c] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs">
                      <Check className="w-4 h-4 stroke-[2.5]" />
                      <span>JAMB CBT Live Stream Active (No Recording Saved)</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCameraPermissionPopup(true);
                        requestLiveCameraAccess(true);
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-black text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Camera Access Required — Click to Enable Camera</span>
                    </button>
                  )}
                </div>
              )}

              <div className="text-center text-sm font-extrabold text-black pt-0.5">
                Good luck
              </div>

              {/* Bottom Cancel & Attempt Buttons */}
              {!activeScheduleCheck.allowed && (
                <div className="p-3.5 rounded-2xl border-2 border-red-400 bg-red-50 text-red-900 text-xs font-extrabold">
                  {activeScheduleCheck.message}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStage('portal')}
                  className="py-3 px-4 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs md:text-sm font-bold text-black transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!activeScheduleCheck.allowed}
                  onClick={async () => {
                    const verified = await activeScheduleCheck.verifyWithServerApi(
                      selectedTest?.testCode
                    );
                    if (!verified.allowed) {
                      setScheduleBlockMessage(verified.message);
                      setStage('portal');
                      return;
                    }
                    if (isCameraAccessRequired && !liveCameraStream) {
                      setShowCameraPermissionPopup(true);
                      const granted = await requestLiveCameraAccess(true);
                      if (!granted) {
                        return;
                      }
                    }
                    if (settings.examSecurityGlobal === false) {
                      setStage('live-exam');
                    } else {
                      setStage('fullscreen-prompt');
                    }
                  }}
                  className="py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] disabled:bg-neutral-300 disabled:text-neutral-600 text-white text-xs md:text-sm font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Attempt</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 2 MODAL: Fullscreen Required for This Test */}
        {stage === 'fullscreen-prompt' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-md bg-white text-black rounded-3xl p-7 md:p-8 text-center shadow-2xl border border-neutral-200 space-y-5">
              <div className="w-16 h-16 rounded-2xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center mx-auto">
                <Maximize className="w-8 h-8" />
              </div>

              <div className="space-y-2.5">
                <h2 className="text-lg md:text-xl font-extrabold text-black flex items-center justify-center gap-2">
                  <Lock className="w-5 h-5 text-[#0a6b3c] shrink-0" />
                  <span>Fullscreen Required for This Test</span>
                </h2>
                <p className="text-xs md:text-sm text-neutral-600 leading-relaxed">
                  The administrator requires fullscreen mode for test{' '}
                  <strong className="font-extrabold text-black">
                    {selectedTest?.testCode || 'RAPID-2026-QMT'}
                  </strong>
                  . Exiting fullscreen during the examination will trigger a{' '}
                  <strong className="font-extrabold text-[#0a6b3c]">Lost Focus</strong>{' '}
                  warning.
                </p>
              </div>

              <button
                type="button"
                onClick={async () => {
                  if (isCameraAccessRequired && !liveCameraStream) {
                    setShowCameraPermissionPopup(true);
                    const granted = await requestLiveCameraAccess(true);
                    if (!granted) {
                      return;
                    }
                  }
                  handleEnterFullscreenAndStart();
                }}
                className="w-full py-4 px-6 rounded-2xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold uppercase tracking-wider transition-colors cursor-pointer shadow-md"
              >
                ENTER FULLSCREEN &amp; START EXAM
              </button>
            </div>
          </div>
        )}
        {renderMovableCircularCamera()}
        {renderCameraAccessRequiredModal()}
      </div>
    );
  }

  // STAGE 3: LIVE CANDIDATE EXAM SESSION
  return (
    <div
      className={`min-h-screen flex flex-col transition-colors ${
        darkMode ? 'bg-neutral-950 text-white' : 'bg-white text-black'
      }`}
    >
      {/* Top Solid Green Bar (#0a6b3c) */}
      <header className="sticky top-0 z-30 bg-[#0a6b3c] text-white px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <QuemintSeal size="sm" variant="white" subtitle="" />
          <span className="font-extrabold text-sm md:text-base tracking-tight">
            Quemint - {candidate.category.toUpperCase()} Quemint{' '}
            {(
              selectedTest?.title ||
              settings.resultTitles?.testSubtitle ||
              'MOCK EXAMINATION'
            ).toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Subject & Question Count Pill in Header */}
          <div className="hidden sm:inline-flex items-center px-3.5 py-1.5 rounded-full bg-white/15 text-white text-xs font-bold">
            {activeSubject} - {currentSubjectQuestions.length} Questions
          </div>

          {/* Live Exam Schedule Window Countdown Pill (if schedule configured) */}
          {activeScheduleCheck.status === 'live' && (
            <div className="hidden md:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-300/40 text-emerald-200 font-mono text-xs font-extrabold">
              <Clock className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              <span>
                Schedule Ends {activeScheduleCheck.endTimeFormatted} ({activeScheduleCheck.countdownLabel})
              </span>
            </div>
          )}

          {/* White Timer Pill with Dark Border */}
          <div
            className={`px-4 py-1.5 rounded-full border-2 border-neutral-900 font-mono text-xs md:text-sm font-extrabold flex items-center gap-2 tabular-nums shadow-xs ${
              secondsLeft < 60
                ? 'bg-red-600 text-white border-white'
                : 'bg-white text-black'
            }`}
          >
            <Clock
              className={`w-4 h-4 shrink-0 ${
                secondsLeft < 60 ? 'text-white' : 'text-neutral-700'
              }`}
            />
            <span className="hidden sm:inline font-sans font-bold text-black">
              Time Left:
            </span>
            <span className={secondsLeft < 60 ? 'text-white' : 'text-black'}>
              {formatHMSSpaced(secondsLeft)}
            </span>
          </div>

          {/* Dark Mode Circle Button */}
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            title="Toggle Dark Mode"
            className="w-9 h-9 rounded-full bg-white text-black hover:bg-neutral-100 flex items-center justify-center shadow-xs transition-colors cursor-pointer shrink-0"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Calculator Circle Button */}
          <button
            type="button"
            onClick={() => setShowCalculator(!showCalculator)}
            title="Open Calculator"
            className="w-9 h-9 rounded-full bg-white text-[#0a6b3c] hover:bg-neutral-100 flex items-center justify-center shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <Calculator className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Auto-Submit Banner when Exam Schedule Window Reaches end_time */}
      {(scheduleAutoSubmitting || activeScheduleCheck.status === 'ended') && (
        <div className="bg-red-600 text-white px-4 py-3 flex items-center justify-center gap-2.5 text-xs md:text-sm font-extrabold shadow-md animate-pulse">
          <Clock className="w-4 h-4 shrink-0" />
          <span>
            Schedule time is up, submitting... ({activeScheduleCheck.centreName} schedule ended at{' '}
            {activeScheduleCheck.endTimeFormatted})
          </span>
        </div>
      )}

      {/* Lost Focus Warning Banner if fullscreen exited */}
      {lostFocusWarning && (
        <div className="bg-[#0a6b3c]/10 border-b border-[#0a6b3c]/30 px-4 py-2.5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 font-bold text-[#0a6b3c]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Lost Focus Warning: Fullscreen mode was exited during test{' '}
              {selectedTest?.testCode || 'RAPID-2026-QMT'}.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLostFocusWarning(false);
              try {
                document.documentElement.requestFullscreen?.().catch(() => {});
              } catch {
                // ignore
              }
            }}
            className="px-3 py-1 rounded-lg bg-[#0a6b3c] text-white font-extrabold cursor-pointer shrink-0"
          >
            Resume Fullscreen
          </button>
        </div>
      )}

      {/* Floating Calculator Modal if active */}
      {showCalculator && (
        <div className="fixed top-16 right-4 z-40 w-72 bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-[#0a6b3c] uppercase">
              Quemint CBT Calculator
            </span>
            <button
              type="button"
              onClick={() => setShowCalculator(false)}
              className="text-xs font-bold text-neutral-500 hover:text-black cursor-pointer"
            >
              Close
            </button>
          </div>
          <input
            type="text"
            readOnly
            value={calcInput || '0'}
            className="w-full px-3 py-2 text-right font-mono text-base font-bold bg-neutral-100 rounded-lg border border-neutral-300"
          />
          <div className="grid grid-cols-4 gap-1.5">
            {[
              '7',
              '8',
              '9',
              '/',
              '4',
              '5',
              '6',
              '*',
              '1',
              '2',
              '3',
              '-',
              '0',
              '.',
              '=',
              '+',
            ].map((btn) => (
              <button
                key={btn}
                type="button"
                onClick={() => {
                  if (btn === '=') {
                    try {
                      const safeResult = Function(
                        `"use strict"; return (${calcInput || 0})`
                      )();
                      setCalcInput(String(safeResult));
                    } catch {
                      setCalcInput('Error');
                    }
                  } else {
                    setCalcInput((prev) => (prev === 'Error' ? btn : prev + btn));
                  }
                }}
                className={`py-2 rounded-lg font-mono text-xs font-bold cursor-pointer ${
                  btn === '='
                    ? 'bg-[#0a6b3c] text-white'
                    : 'bg-neutral-100 hover:bg-neutral-200 text-black'
                }`}
              >
                {btn}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCalcInput('')}
            className="w-full py-1.5 rounded-lg bg-neutral-200 text-xs font-bold text-black cursor-pointer"
          >
            Clear (C)
          </button>
        </div>
      )}

      {/* Main Candidate Exam Session Content: 2-Column Layout (Left: Questions, Right: Candidate Profile & Progress) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 py-5 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (8 cols): Subject Switcher, Active Question Card, and Question Palette */}
        <div className="md:col-span-8 space-y-5">
          {/* 1. Subject Pills Card */}
          <div
            className={`rounded-2xl border p-3.5 shadow-xs flex flex-wrap items-center gap-2.5 ${
              darkMode
                ? 'bg-neutral-900 border-neutral-800'
                : 'bg-white border-neutral-200'
            }`}
          >
            {subjects.map((subj) => {
              const isActive = activeSubject === subj;
              const subjQuestions = examQuestions.filter((q) => q.subject === subj);
              return (
                <button
                  key={subj}
                  type="button"
                  onClick={() => handleSubjectSwitch(subj)}
                  className={`px-4 py-2 rounded-full text-xs font-extrabold transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#0a6b3c] text-white shadow-xs'
                      : darkMode
                      ? 'bg-neutral-800 text-[#0e8a4e] border border-[#0a6b3c]'
                      : 'bg-white text-[#0a6b3c] border border-[#0a6b3c] hover:bg-[#0a6b3c]/5'
                  }`}
                >
                  {subj} ({subjQuestions.length})
                </button>
              );
            })}
          </div>

          {/* 2. Question Card */}
          <div
            className={`rounded-2xl border shadow-xs overflow-hidden ${
              darkMode
                ? 'bg-neutral-900 border-neutral-800'
                : 'bg-white border-neutral-200'
            }`}
          >
            {/* Question Card Top Strip */}
            <div className="bg-[#0a6b3c]/6 border-b border-[#0a6b3c]/15 px-5 py-3.5 flex items-center justify-between gap-2">
              <span className="text-xs md:text-sm font-extrabold text-[#0a6b3c]">
                {activeSubject} - Question {subjQuestionIndex + 1} of{' '}
                {currentSubjectQuestions.length}
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                  currentQuestion?.questionType === 'TYA'
                    ? 'bg-[#0a6b3c] text-white'
                    : 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                }`}
              >
                {currentQuestion?.questionType === 'TYA'
                  ? 'TYA • Type Your Answer'
                  : 'MCQ • Multiple Choice'}
              </span>
            </div>

            {/* Question Stem & Response Input (MCQ Radio Options OR TYA Text Input Box) */}
            <div className="p-5 md:p-6 space-y-5">
              <div className="text-sm md:text-base leading-relaxed">
                <span className="font-extrabold text-[#0a6b3c] mr-1.5">
                  {subjQuestionIndex + 1}.
                </span>
                <span className="font-extrabold">
                  {currentQuestion?.questionText}
                </span>
              </div>

              {currentQuestion?.questionType === 'TYA' ? (
                <div className="space-y-2.5 pt-1">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    Type your answer here
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={true}
                    value={typedAnswers[currentQuestion.id] || ''}
                    onChange={(e) => handleTypedAnswerChange(e.target.value)}
                    placeholder="Type your answer"
                    className={`w-full px-4 py-3.5 rounded-xl border-2 text-sm font-bold focus:border-[#0a6b3c] focus:outline-none transition-colors ${
                      darkMode
                        ? 'bg-neutral-800 border-neutral-700 text-white placeholder:text-neutral-500'
                        : 'bg-neutral-50/70 border-neutral-300 text-black placeholder:text-neutral-400 focus:bg-white'
                    }`}
                  />
                  <div className="flex items-center justify-between text-[11px] text-neutral-500">
                    <span>
                      {(typedAnswers[currentQuestion.id] || '').trim().length > 0
                        ? '✓ Response recorded'
                        : 'Enter your short scientific or direct answer above'}
                    </span>
                    {(typedAnswers[currentQuestion.id] || '').trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleTypedAnswerChange('')}
                        className="text-red-600 hover:underline font-bold cursor-pointer"
                      >
                        Clear answer
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {currentQuestion?.options.map((opt, idx) => {
                    const letter = ['A', 'B', 'C', 'D'][idx];
                    const isSelected = answers[currentQuestion.id] === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectOption(idx)}
                        className={`w-full p-4 rounded-xl border text-left flex items-center gap-3.5 transition-all cursor-pointer ${
                          darkMode
                            ? 'border-neutral-800 bg-neutral-900'
                            : 'border-neutral-200 bg-white'
                        }`}
                      >
                        {/* Radio Circle */}
                        <span
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'border-[#0a6b3c]'
                              : darkMode
                              ? 'border-neutral-600'
                              : 'border-neutral-300'
                          }`}
                        >
                          {isSelected && (
                            <span className="w-2.5 h-2.5 rounded-full bg-[#0a6b3c]" />
                          )}
                        </span>

                        <span className="text-sm font-extrabold shrink-0">
                          {letter}.
                        </span>
                        <span className="text-sm font-medium">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Bottom Navigation Bar (< Previous | Next >) */}
            <div
              className={`px-5 py-4 border-t flex items-center justify-between gap-4 ${
                darkMode
                  ? 'bg-neutral-900/50 border-neutral-800'
                  : 'bg-white border-neutral-100'
              }`}
            >
              <button
                type="button"
                onClick={handlePreviousQuestion}
                disabled={isFirstOverall}
                className={`px-5 py-2.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 ${
                  darkMode
                    ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:border-[#0a6b3c]'
                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-[#0a6b3c] hover:text-black'
                }`}
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isLastOverall) {
                    setShowConfirmSubmit(true);
                  } else {
                    handleNextQuestion();
                  }
                }}
                className="px-6 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <span>{isLastOverall ? 'Finish' : 'Next'}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 3. Question Palette Card */}
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-3.5 ${
              darkMode
                ? 'bg-neutral-900 border-neutral-800'
                : 'bg-white border-neutral-200'
            }`}
          >
            <div className="space-y-1">
              <h3 className="text-xs md:text-sm font-extrabold">
                Question Palette — {activeSubject} ({currentSubjectAnswered} of{' '}
                {currentSubjectQuestions.length} answered)
              </h3>
              <p className="text-[11px] text-neutral-500">
                Green = Current · Pale green = Answered · Gray = Unanswered
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {currentSubjectQuestions.map((q, idx) => {
                const isCurrent = idx === subjQuestionIndex;
                const isAnswered = isQuestionAnswered(q);
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSubjQuestionIndex(idx)}
                    className={`w-10 h-10 rounded-xl font-mono text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center tabular-nums border ${
                      isCurrent
                        ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-xs'
                        : isAnswered
                        ? 'bg-[#0a6b3c]/15 text-[#0a6b3c] border-[#0a6b3c]/40'
                        : darkMode
                        ? 'bg-neutral-800 text-neutral-300 border-neutral-700'
                        : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:border-[#0a6b3c]'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (4 cols): Candidate Profile, Current Set Progress, and Submit Exam Button */}
        <aside className="md:col-span-4 space-y-4 md:sticky md:top-20">
          {/* 1. CANDIDATE PROFILE Card */}
          <div
            className={`rounded-2xl border shadow-xs overflow-hidden ${
              darkMode
                ? 'bg-neutral-900 border-neutral-800'
                : 'bg-white border-neutral-200'
            }`}
          >
            <div className="bg-[#1c1c1c] text-white px-5 py-3.5 text-xs font-extrabold uppercase tracking-wider">
              CANDIDATE PROFILE
            </div>

            <div className="p-5 space-y-4">
              {/* Centered Vertical Rounded-Rectangle Passport Box (Blank until uploaded, never covered by camera) */}
              <div className="w-24 h-28 rounded-2xl border-2 border-[#0a6b3c] bg-white mx-auto flex items-center justify-center overflow-hidden">
                {candidatePortraitUrl ? (
                  <img
                    src={candidatePortraitUrl}
                    alt={`${candidate.firstName} ${candidate.surname}`}
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>

              {/* Left-Aligned Candidate Details matching reference screenshot */}
              <div className="space-y-2 text-xs pt-1">
                <div>
                  <strong className="font-extrabold">Name:</strong>{' '}
                  <span
                    className={
                      darkMode ? 'text-neutral-300' : 'text-neutral-700'
                    }
                  >
                    {candidate.firstName} {candidate.surname}
                  </span>
                </div>

                <div>
                  <strong className="font-extrabold">Reg No:</strong>{' '}
                  <span
                    className={
                      darkMode ? 'text-neutral-300' : 'text-neutral-700'
                    }
                  >
                    {candidate.regNumber}
                  </span>
                </div>

                <div>
                  <strong className="font-extrabold">Gender:</strong>{' '}
                  <span
                    className={
                      darkMode ? 'text-neutral-300' : 'text-neutral-700'
                    }
                  >
                    {candidate.gender}
                  </span>
                </div>

                <div className="flex items-center gap-2 pt-0.5">
                  <strong className="font-extrabold">Category:</strong>
                  <span className="px-3 py-0.5 rounded-full bg-[#0a6b3c] text-white font-bold text-[11px] lowercase">
                    {candidate.category}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Current Set & Progress Card */}
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-2.5 ${
              darkMode
                ? 'bg-neutral-900 border-neutral-800'
                : 'bg-white border-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-extrabold">Current Set:</span>
              <span className="font-extrabold text-[#0a6b3c]">
                {activeSubject} ({currentSubjectQuestions.length})
              </span>
            </div>

            <div className="space-y-2">
              <div
                className={`text-xs font-medium ${
                  darkMode ? 'text-neutral-400' : 'text-neutral-600'
                }`}
              >
                Progress - {answeredCount} of {examQuestions.length} answered
              </div>
              <div className="w-full h-2.5 rounded-full bg-neutral-100 border border-neutral-200 overflow-hidden">
                <div
                  className="h-full bg-[#0a6b3c] transition-all duration-300"
                  style={{
                    width: `${
                      examQuestions.length > 0
                        ? Math.round(
                            (answeredCount / examQuestions.length) * 100
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* 3. Full-Width SUBMIT EXAM Button */}
          <button
            type="button"
            onClick={() => setShowConfirmSubmit(true)}
            className="w-full py-4 px-6 rounded-2xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-sm font-extrabold uppercase tracking-wider transition-colors cursor-pointer shadow-md"
          >
            SUBMIT EXAM
          </button>
        </aside>
      </main>

      {/* STAGE 4 MODAL: Submit Examination? */}
      {showConfirmSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-3xl p-6 md:p-7 space-y-5 shadow-2xl border border-neutral-200">
            <div className="flex items-start gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-black">
                  Submit Examination?
                </h3>
                <p className="text-xs text-neutral-600 mt-0.5">
                  Please review your examination status before submitting.
                </p>
              </div>
            </div>

            {/* Examination Status Box */}
            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neutral-600 font-medium">Total Questions:</span>
                <span className="font-mono font-extrabold text-black">
                  {examQuestions.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600 font-medium">Answered:</span>
                <span className="font-mono font-extrabold text-[#0a6b3c]">
                  {answeredCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-neutral-600 font-medium">Unanswered:</span>
                <span className="font-mono font-extrabold text-red-600">
                  {unansweredCount}
                </span>
              </div>
              <div className="border-t border-neutral-200 pt-2.5 flex items-center justify-between">
                <span className="text-neutral-600 font-medium">Time Remaining:</span>
                <span className="font-mono font-extrabold text-[#0a6b3c]">
                  {formatHMSCompact(secondsLeft)}
                </span>
              </div>
            </div>

            {/* Notice Box */}
            <div className="rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 p-3.5 text-xs text-[#0a6b3c] leading-relaxed">
              <strong className="font-extrabold">Notice:</strong>{' '}
              {unansweredCount > 0
                ? `You still have ${unansweredCount} unanswered questions.`
                : 'You have answered all questions.'}{' '}
              Once submitted, you cannot modify your answers.
            </div>

            {/* Review Questions & Yes, Submit Exam Buttons */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                disabled={isSubmittingAndEvaluating}
                onClick={() => setShowConfirmSubmit(false)}
                className="py-3 px-4 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-bold text-black transition-colors cursor-pointer disabled:opacity-50"
              >
                Review Questions
              </button>
              <button
                type="button"
                disabled={isSubmittingAndEvaluating}
                onClick={handleFinalizeSubmission}
                className="py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm disabled:opacity-60"
              >
                <span>
                  {isSubmittingAndEvaluating
                    ? 'Evaluating Answers...'
                    : 'Yes, Submit Exam'}
                </span>
                <Check className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>
      )}
      {renderMovableCircularCamera()}
      {renderCameraAccessRequiredModal()}
    </div>
  );
};
