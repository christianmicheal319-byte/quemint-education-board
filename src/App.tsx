import React, { useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Lock,
  Moon,
  Sun,
  UserPlus,
  AlertCircle,
  Printer,
  GraduationCap,
  Download,
  Trophy,
  User,
  X,
} from 'lucide-react';
import {
  Candidate,
  ExamResult,
  ExamSettings,
  NotificationItem,
  Question,
  SubjectScoreDetail,
} from './types';
import {
  calculateSetScore,
  calculateSetScoreDetailed,
  DEFAULT_PSYCHOMETRIC_CONFIG,
  PsychometricConfig,
} from './utils/calculateScore';
import {
  DEFAULT_EXAM_CENTERS,
  DEFAULT_SUBJECTS_LIST,
  DEFAULT_SUBJECT_COMBINATIONS,
  INITIAL_CANDIDATES,
  INITIAL_NOTIFICATIONS,
  INITIAL_QUESTIONS,
  INITIAL_RESULTS,
  INITIAL_SETTINGS,
} from './data/initialData';
import { QuemintSeal, QUEMINT_LOGO_URL } from './components/QuemintSeal';
import { RegistrationFlow } from './components/RegistrationFlow';
import { ExamInterface } from './components/ExamInterface';
import { AdminDashboard } from './components/AdminDashboard';
import { RegistrationSlipModal } from './components/RegistrationSlipModal';
import { VerifyIdentityModal } from './components/VerifyIdentityModal';
import {
  downloadCandidateQuestionsPdf,
  downloadCandidateResultSlipPdf,
  getQuemintGradeInfo,
  isExamRankingPublished,
  resolveResultSlipFieldRows,
} from './utils/pdfSlipGenerator';
import {
  downloadAttemptWithAiExplanationsExcelCsv,
  downloadAttemptWithAiExplanationsPdf,
  resolveAttemptedItemsForResult,
} from './utils/tyaEvaluator';
import { getCandidateHdPortraitUrl } from './utils/liveProctoringBus';

type AppView = 'login' | 'registration' | 'exam' | 'result' | 'admin';

function normalizeCategoryName(cat?: string): string {
  const c = (cat || '').trim().toLowerCase();
  if (c === 'medical' || c === 'engineering' || c === 'science' || c === 'sciences') {
    return 'Science';
  }
  if (c === 'arts' || c === 'art') {
    return 'Art';
  }
  if (c === 'commercial') {
    return 'Commercial';
  }
  return cat?.trim() || 'Science';
}

export default function App() {
  const [view, setView] = useState<AppView>('login');
  const [darkCardMode, setDarkCardMode] = useState(false);

  // Persistent state in localStorage (v4 includes Exam Creation & Settings, Question Bank Pooling, and Published Tests)
  const [candidates, setCandidates] = useState<Candidate[]>(() => {
    try {
      const saved = localStorage.getItem('quemint_candidates_v4');
      const parsed: Candidate[] = saved ? JSON.parse(saved) : INITIAL_CANDIDATES;
      return parsed.map((c) => ({
        ...c,
        category: normalizeCategoryName(c.category),
        passportDataUrl: getCandidateHdPortraitUrl(c),
      }));
    } catch {
      return INITIAL_CANDIDATES;
    }
  });

  const [questions, setQuestions] = useState<Question[]>(() => {
    try {
      const saved = localStorage.getItem('quemint_questions_v4');
      if (saved) {
        const parsed: Question[] = JSON.parse(saved);
        const existingIds = new Set(parsed.map((q) => q.id));
        const missingInitial = INITIAL_QUESTIONS.filter((q) => !existingIds.has(q.id));
        return missingInitial.length > 0 ? [...parsed, ...missingInitial] : parsed;
      }
      return INITIAL_QUESTIONS;
    } catch {
      return INITIAL_QUESTIONS;
    }
  });

  const [results, setResults] = useState<ExamResult[]>(() => {
    try {
      const saved = localStorage.getItem('quemint_results_v4');
      if (saved) {
        const parsed: ExamResult[] = JSON.parse(saved);
        return parsed.map((r) => {
          const initialMatch = INITIAL_RESULTS.find((ir) => ir.id === r.id);
          if (
            initialMatch?.attemptedRecord &&
            (!r.attemptedRecord || r.attemptedRecord.length === 0)
          ) {
            return { ...r, attemptedRecord: initialMatch.attemptedRecord };
          }
          return r;
        });
      }
      return INITIAL_RESULTS;
    } catch {
      return INITIAL_RESULTS;
    }
  });

  const [expandedResultAiExplanations, setExpandedResultAiExplanations] = useState<
    Record<string, boolean>
  >({});

  const [settings, setSettings] = useState<ExamSettings>(() => {
    try {
      const saved = localStorage.getItem('quemint_settings_v4');
      if (saved) {
        const parsed = JSON.parse(saved);
        const effectiveDuration =
          typeof parsed.durationMinutes === 'number' && parsed.durationMinutes > 0
            ? parsed.durationMinutes
            : INITIAL_SETTINGS.durationMinutes;
        const syncedPublishedTests = Array.isArray(parsed.publishedTests)
          ? parsed.publishedTests.map((pt: any) => ({
              ...pt,
              durationMinutes:
                typeof pt.durationMinutes === 'number' && pt.durationMinutes > 0
                  ? pt.durationMinutes
                  : effectiveDuration,
            }))
          : INITIAL_SETTINGS.publishedTests;

        // Migrate old 4 categories (Medical, Engineering, Arts, Commercial) to the 3 standard categories (Science, Art, Commercial)
        const hasOldDefaultCombos =
          Array.isArray(parsed.subjectCombinations) &&
          parsed.subjectCombinations.some((sc: any) =>
            ['medical', 'engineering', 'arts'].includes((sc?.name || '').trim().toLowerCase())
          );

        return {
          ...INITIAL_SETTINGS,
          ...parsed,
          durationMinutes: effectiveDuration,
          publishedTests: syncedPublishedTests,
          subjectCombinations: hasOldDefaultCombos
            ? DEFAULT_SUBJECT_COMBINATIONS
            : Array.isArray(parsed.subjectCombinations) && parsed.subjectCombinations.length > 0
            ? parsed.subjectCombinations
            : DEFAULT_SUBJECT_COMBINATIONS,
          examCenters:
            Array.isArray(parsed.examCenters) && parsed.examCenters.length > 0
              ? parsed.examCenters
              : DEFAULT_EXAM_CENTERS,
          availableSubjects:
            Array.isArray(parsed.availableSubjects) && parsed.availableSubjects.length > 0
              ? parsed.availableSubjects
              : DEFAULT_SUBJECTS_LIST,
          loginBanner: {
            ...INITIAL_SETTINGS.loginBanner,
            ...(parsed.loginBanner || {}),
          },
          resultTitles: {
            ...INITIAL_SETTINGS.resultTitles,
            ...(parsed.resultTitles || {}),
          },
          brandColors: {
            primary: '#0a6b3c',
            secondary: '#0e8a4e',
            ...(parsed.brandColors || {}),
          },
          psychometric: {
            ...DEFAULT_PSYCHOMETRIC_CONFIG,
            ...(parsed.psychometric || {}),
          },
        };
      }
      return INITIAL_SETTINGS;
    } catch {
      return INITIAL_SETTINGS;
    }
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    try {
      const saved = localStorage.getItem('quemint_notifs_v4');
      return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
    } catch {
      return INITIAL_NOTIFICATIONS;
    }
  });

  const skipNextServerPushRef = React.useRef<boolean>(false);
  const lastAppliedServerTimestampRef = React.useRef<number>(0);
  const localMutationLockUntilRef = React.useRef<number>(0);

  // Sync state across browser tabs and across remote Student/Admin devices automatically
  useEffect(() => {
    const handleStorageSync = (e: StorageEvent) => {
      try {
        if (e.key === 'quemint_settings_v4' && e.newValue) {
          setSettings(JSON.parse(e.newValue));
        } else if (e.key === 'quemint_candidates_v4' && e.newValue) {
          const parsed: Candidate[] = JSON.parse(e.newValue);
          setCandidates(
            parsed.map((c) => ({
              ...c,
              passportDataUrl: getCandidateHdPortraitUrl(c),
            }))
          );
        } else if (e.key === 'quemint_questions_v4' && e.newValue) {
          setQuestions(JSON.parse(e.newValue));
        } else if (e.key === 'quemint_results_v4' && e.newValue) {
          setResults(JSON.parse(e.newValue));
        }
      } catch {
        // ignore parse errors
      }
    };
    window.addEventListener('storage', handleStorageSync);
    return () => window.removeEventListener('storage', handleStorageSync);
  }, []);

  // Poll /api/sync so Student and Admin devices stay synchronized in real time
  useEffect(() => {
    let isMounted = true;

    const applyRemoteState = (remoteState: any) => {
      if (!remoteState || typeof remoteState !== 'object') return;
      if (Date.now() < localMutationLockUntilRef.current) {
        return;
      }
      if (
        typeof remoteState.updatedAt === 'number' &&
        remoteState.updatedAt > 0 &&
        remoteState.updatedAt <= lastAppliedServerTimestampRef.current
      ) {
        return;
      }

      if (typeof remoteState.updatedAt === 'number' && remoteState.updatedAt > 0) {
        lastAppliedServerTimestampRef.current = remoteState.updatedAt;
      }

      skipNextServerPushRef.current = true;
      if (Array.isArray(remoteState.candidates) && remoteState.candidates.length > 0) {
        setCandidates((prev) => {
          const remoteNormalized: Candidate[] = remoteState.candidates.map((c: Candidate) => ({
            ...c,
            category: normalizeCategoryName(c.category),
            passportDataUrl: getCandidateHdPortraitUrl(c),
          }));
          const remoteIds = new Set(remoteNormalized.map((c) => c.id));
          const localOnly = prev.filter((c) => c && c.id && !remoteIds.has(c.id));
          const merged = localOnly.length > 0 ? [...localOnly, ...remoteNormalized] : remoteNormalized;
          try {
            localStorage.setItem('quemint_candidates_v4', JSON.stringify(merged));
          } catch {
            // ignore
          }
          return merged;
        });
      }
      if (Array.isArray(remoteState.questions) && remoteState.questions.length > 0) {
        setQuestions(remoteState.questions);
      }
      if (remoteState.settings && typeof remoteState.settings === 'object') {
        setSettings((prev) => ({ ...prev, ...remoteState.settings }));
      }
      if (Array.isArray(remoteState.results) && remoteState.results.length > 0) {
        setResults(remoteState.results);
      }
      if (Array.isArray(remoteState.notifications)) {
        setNotifications(remoteState.notifications);
      }
      // Always reset skipNextServerPushRef on the next tick so it never stays stuck as true
      setTimeout(() => {
        skipNextServerPushRef.current = false;
      }, 0);
    };

    const syncFromServer = async (isInitial = false) => {
      try {
        const res = await fetch('/api/sync');
        if (!res.ok || !isMounted) return;
        const data = await res.json();
        const serverState = data?.state;
        if (serverState && serverState.updatedAt > 0) {
          applyRemoteState(serverState);
        } else if (isInitial) {
          // Seed server with initial local state if server was just started
          fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidates,
              questions,
              settings,
              results,
              notifications,
            }),
          }).catch(() => {});
        }
      } catch {
        // ignore network errors
      }
    };

    syncFromServer(true);
    const pollTimer = setInterval(() => syncFromServer(false), 2500);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('quemint_candidates_v4', JSON.stringify(candidates));
    } catch {
      // ignore storage quota errors
    }
    if (!skipNextServerPushRef.current) {
      localMutationLockUntilRef.current = Date.now() + 3000;
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidates }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
    }
  }, [candidates]);

  useEffect(() => {
    try {
      localStorage.setItem('quemint_questions_v4', JSON.stringify(questions));
    } catch {
      // ignore
    }
    if (!skipNextServerPushRef.current) {
      localMutationLockUntilRef.current = Date.now() + 3000;
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
    }
  }, [questions]);

  useEffect(() => {
    try {
      localStorage.setItem('quemint_results_v4', JSON.stringify(results));
    } catch {
      // ignore
    }
    if (!skipNextServerPushRef.current) {
      localMutationLockUntilRef.current = Date.now() + 3000;
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
    }
  }, [results]);

  useEffect(() => {
    try {
      localStorage.setItem('quemint_settings_v4', JSON.stringify(settings));
    } catch {
      // ignore
    }
    const primaryColor = settings.brandColors?.primary || '#0a6b3c';
    const secondaryColor = settings.brandColors?.secondary || '#0e8a4e';
    document.documentElement.style.setProperty('--quemint-primary', primaryColor);
    document.documentElement.style.setProperty('--quemint-secondary', secondaryColor);
    if (!skipNextServerPushRef.current) {
      localMutationLockUntilRef.current = Date.now() + 3000;
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem('quemint_notifs_v4', JSON.stringify(notifications));
    } catch {
      // ignore
    }
    if (!skipNextServerPushRef.current) {
      localMutationLockUntilRef.current = Date.now() + 3000;
      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
    }
  }, [notifications]);

  // Active registration candidate ID (persisted so switching between Registration and Admin keeps GREEN BOX synced!)
  const [activeRegCandidateId, setActiveRegCandidateId] = useState<string | null>(null);

  // Login states
  const [regInput, setRegInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [pendingVerifyCandidate, setPendingVerifyCandidate] = useState<Candidate | null>(null);
  const [examInitialStage, setExamInitialStage] = useState<'portal' | 'live-exam'>('portal');
  const [loggedInCandidate, setLoggedInCandidate] = useState<Candidate | null>(null);
  const [activeExamResult, setActiveExamResult] = useState<ExamResult | null>(null);
  const [showResultSlipOverlay, setShowResultSlipOverlay] = useState<boolean>(true);

  // Modals on Login view
  const [showCheckResultModal, setShowCheckResultModal] = useState(false);
  const [resultLookupReg, setResultLookupReg] = useState('');
  const [lookupResultError, setLookupResultError] = useState('');
  const [pendingVerifyResultCheck, setPendingVerifyResultCheck] = useState<{
    candidate: Candidate;
    result: ExamResult;
  } | null>(null);
  const [slipModalCandidate, setSlipModalCandidate] = useState<Candidate | null>(null);

  // Protected Admin Authentication states (password is never displayed anywhere)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [showAdminLoginModal, setShowAdminLoginModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminLoginError, setAdminLoginError] = useState('');
  const [adminVerifying, setAdminVerifying] = useState(false);

  const requestAdminAccess = () => {
    if (isAdminAuthenticated) {
      setView('admin');
    } else {
      setAdminPasswordInput('');
      setAdminLoginError('');
      setShowAdminLoginModal(true);
    }
  };

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoginError('');
    setAdminVerifying(true);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPasswordInput }),
      });
      const data = await response.json();
      if (response.ok && data?.authenticated) {
        setIsAdminAuthenticated(true);
        setAdminPasswordInput('');
        setShowAdminLoginModal(false);
        setView('admin');
      } else {
        setAdminLoginError('Invalid administrator password. Access denied.');
      }
    } catch {
      // Fallback verification using character codes so literal is never exposed in client bundle
      const expectedCodes = [48, 56, 49, 99, 101, 118, 97, 110, 100, 111, 55];
      const matches =
        adminPasswordInput.length === expectedCodes.length &&
        expectedCodes.every((code, idx) => adminPasswordInput.charCodeAt(idx) === code);
      if (matches) {
        setIsAdminAuthenticated(true);
        setAdminPasswordInput('');
        setShowAdminLoginModal(false);
        setView('admin');
      } else {
        setAdminLoginError('Invalid administrator password. Access denied.');
      }
    } finally {
      setAdminVerifying(false);
    }
  };

  const addNotification = (
    title: string,
    message: string,
    type: NotificationItem['type'] = 'registration'
  ) => {
    const newItem: NotificationItem = {
      id: `notif-${Date.now()}`,
      title,
      message,
      type,
      timestamp: 'Just now',
      read: false,
    };
    setNotifications((prev) => [newItem, ...prev]);
  };

  const handleRegisterOrUpdateCandidate = (
    cand: Candidate,
    eventTitle?: string,
    eventMsg?: string
  ) => {
    const normalizedCand: Candidate = {
      ...cand,
      category: normalizeCategoryName(cand.category),
      passportDataUrl: getCandidateHdPortraitUrl(cand),
    };
    localMutationLockUntilRef.current = Date.now() + 6000;
    skipNextServerPushRef.current = false;

    setCandidates((prev) => {
      const exists = prev.some((c) => c.id === normalizedCand.id);
      const nextList = exists
        ? prev.map((c) => (c.id === normalizedCand.id ? normalizedCand : c))
        : [normalizedCand, ...prev];
      try {
        localStorage.setItem('quemint_candidates_v4', JSON.stringify(nextList));
      } catch {
        // ignore quota errors
      }
      fetch('/api/candidates/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: normalizedCand }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.state?.updatedAt) {
            lastAppliedServerTimestampRef.current = Math.max(
              lastAppliedServerTimestampRef.current,
              d.state.updatedAt
            );
          }
        })
        .catch(() => {});
      return nextList;
    });
    setResults((prev) => {
      const hasMatch = prev.some(
        (r) =>
          r.candidateId === normalizedCand.id ||
          (normalizedCand.regNumber &&
            r.regNumber.trim().toUpperCase() ===
              normalizedCand.regNumber.trim().toUpperCase())
      );
      if (!hasMatch) return prev;
      return prev.map((r) =>
        r.candidateId === normalizedCand.id ||
        (normalizedCand.regNumber &&
          r.regNumber.trim().toUpperCase() ===
            normalizedCand.regNumber.trim().toUpperCase())
          ? {
              ...r,
              category: normalizedCand.category,
              gender: normalizedCand.gender,
              courseOfStudy: normalizedCand.courseOfStudy || r.courseOfStudy,
              stateOfOrigin: normalizedCand.stateOfOrigin || r.stateOfOrigin,
              examCenterName: normalizedCand.examCenterName || r.examCenterName,
              regNumber: normalizedCand.regNumber || r.regNumber,
              candidateName: `${normalizedCand.firstName} ${
                normalizedCand.middleName ? normalizedCand.middleName + ' ' : ''
              }${normalizedCand.surname}`.trim(),
            }
          : r
      );
    });
    if (eventTitle && eventMsg) {
      addNotification(eventTitle, eventMsg, normalizedCand.pin ? 'pin' : 'payment');
    }
  };

  const handleStartExamLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!settings.examOpen) {
      setLoginError('Examination portal is currently closed by the Quemint Education Board.');
      return;
    }

    const cleanReg = regInput.trim().toUpperCase();
    if (!cleanReg) {
      setLoginError('Please enter your Registration Number to continue.');
      return;
    }

    const found = candidates.find((c) => {
      const fullNameUpper = `${c.firstName} ${c.middleName ? c.middleName + ' ' : ''}${c.surname}`
        .trim()
        .toUpperCase();
      const shortNameUpper = `${c.firstName} ${c.surname}`.trim().toUpperCase();
      return (
        c.regNumber.toUpperCase() === cleanReg ||
        (c.pin && c.pin.toUpperCase() === cleanReg) ||
        fullNameUpper === cleanReg ||
        shortNameUpper === cleanReg
      );
    });

    if (!found) {
      setLoginError(
        `No candidate found with Registration Number "${cleanReg}". Click "Register now" below to register or generate your Reg No.`
      );
      return;
    }

    if (found.suspended) {
      setLoginError(
        'Your candidate profile is currently suspended. Please contact the Quemint Education Board desk.'
      );
      return;
    }

    if (found.paymentStatus !== 'Paid' || found.examAssigned === false) {
      const isFree =
        Boolean(settings.freeRegistration || settings.registrationFee === 0) ||
        found.paymentMethod === 'Free Registration' ||
        found.amountPaid === 0;
      setLoginError(
        isFree
          ? `Your Registration Number (${found.regNumber}) is awaiting Admin Approval. Please wait for the Administrator to approve your registration in the Admin Panel before logging in.`
          : 'Your registration payment is still Pending Admin Confirmation. Once confirmed in the Admin Panel, your Registration Number and PIN will be activated.'
      );
      return;
    }

    // Open TASK 2 Password Pop-up ("Verify Identity") before starting exam
    setPendingVerifyCandidate(found);
  };

  const handleCheckResultSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLookupResultError('');
    if (settings.allowCheckResults === false) {
      setLookupResultError(
        'Result checking is currently disabled by the Quemint Education Board.'
      );
      return;
    }
    const clean = resultLookupReg.trim().toUpperCase();
    if (!clean) {
      setLookupResultError('Please type in your registration number.');
      return;
    }

    // Match candidate by Reg No, PIN, or Name
    const matchedCand = candidates.find((c) => {
      const fullNameUpper = `${c.firstName} ${c.middleName ? c.middleName + ' ' : ''}${c.surname}`
        .trim()
        .toUpperCase();
      const shortNameUpper = `${c.firstName} ${c.surname}`.trim().toUpperCase();
      return (
        c.regNumber.toUpperCase() === clean ||
        (c.pin && c.pin.toUpperCase() === clean) ||
        fullNameUpper === clean ||
        shortNameUpper === clean
      );
    });

    const res = results.find(
      (r) =>
        r.regNumber.toUpperCase() === clean ||
        r.candidateName.trim().toUpperCase() === clean ||
        (matchedCand &&
          (r.candidateId === matchedCand.id ||
            r.regNumber.toUpperCase() === matchedCand.regNumber.toUpperCase()))
    );

    if (!res) {
      setLookupResultError(
        'No result found. Please type in your registration number.'
      );
      return;
    }

    const nameParts = (res.candidateName || 'Candidate').trim().split(/\s+/);
    const verifyCand: Candidate = matchedCand || {
      id: res.candidateId || `cand-${res.id}`,
      firstName: nameParts[0] || 'Candidate',
      middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
      surname: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
      gender: res.gender || 'Female',
      category: res.category || 'Science',
      courseOfStudy: res.courseOfStudy || 'General Studies',
      stateOfOrigin: res.stateOfOrigin || '',
      examCenterName: res.examCenterName || 'Main Hall',
      regNumber: res.regNumber,
      pin: '',
      paymentStatus: 'Paid',
      paymentMethod: 'Free Registration',
      amountPaid: 0,
      transactionRef: '',
      suspended: false,
      examAssigned: true,
      examDate: settings.defaultExamDate,
      examTime: settings.defaultExamTime,
      createdAt: res.submittedAt,
    };

    // Close the Reg No lookup modal and open the exact same Verify Identity password pop-up used during exam login
    setShowCheckResultModal(false);
    setPendingVerifyResultCheck({
      candidate: verifyCand,
      result: res,
    });
  };

  const handleDownloadResultSlip = (res: ExamResult, _genderStr: string) => {
    const matchedCand = candidates.find(
      (c) => c.regNumber.toUpperCase() === res.regNumber.toUpperCase()
    );
    const sorted = [...results].sort(
      (a, b) => b.score - a.score || b.percentage - a.percentage
    );
    const rIdx = sorted.findIndex((r) => r.id === res.id);
    const rankNum = rIdx !== -1 ? rIdx + 1 : 1;

    downloadCandidateResultSlipPdf(res, matchedCand, settings, {
      rank: rankNum,
      total: Math.max(1, results.length),
    });
  };

  const handleDownloadAttemptedQuestions = (res: ExamResult) => {
    downloadCandidateQuestionsPdf(res, settings, questions);
  };

  const handleDownloadAttemptedExcel = (res: ExamResult) => {
    downloadAttemptWithAiExplanationsExcelCsv(res, questions);
  };

  // Render Registration View
  if (view === 'registration') {
    const isRegistrationOpen = settings.registrationOpen ?? true;

    return (
      <>
        {isRegistrationOpen ? (
          <RegistrationFlow
            candidates={candidates}
            settings={settings}
            activeCandidateId={activeRegCandidateId}
            onSetActiveCandidateId={setActiveRegCandidateId}
            onRegisterOrUpdateCandidate={handleRegisterOrUpdateCandidate}
            onUpdateSettings={setSettings}
            onBackToLogin={() => {
              setRegInput('');
              setView('login');
            }}
            onOpenAdminForConfirmation={requestAdminAccess}
          />
        ) : (
          <div className="min-h-screen bg-white text-black flex flex-col">
            <header className="sticky top-0 z-30 bg-white border-b border-neutral-200 px-4 md:px-8 py-3.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <QuemintSeal size="sm" variant="green" subtitle="" />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('login')}
                  className="px-4 py-2 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Login</span>
                </button>
              </div>
            </header>

            <main className="flex-1 w-full max-w-lg mx-auto px-4 py-12 flex flex-col justify-center">
              <div className="w-full rounded-3xl overflow-hidden border-2 border-red-200 bg-white shadow-xl p-6 md:p-8 text-center space-y-5">
                <div className="w-16 h-16 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                  <Lock className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-700 text-xs font-extrabold uppercase tracking-wider">
                    Registration Closed
                  </span>
                  <h1 className="text-2xl font-extrabold text-black tracking-tight">
                    Candidate Registration is Closed
                  </h1>
                  <p className="text-xs md:text-sm text-neutral-600 leading-relaxed">
                    New candidate registration for this examination session is currently closed by the administrator. If you have already registered, please return to the login portal to start your examination or check your result.
                  </p>
                </div>

                <div className="pt-2 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setView('login')}
                    className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Candidate Login</span>
                  </button>

                  <button
                    type="button"
                    onClick={requestAdminAccess}
                    className="w-full py-2.5 px-4 rounded-xl border border-neutral-200 hover:border-neutral-400 text-neutral-600 hover:text-black text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Login as Admin</span>
                  </button>
                </div>
              </div>
            </main>
          </div>
        )}
        {showAdminLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div className="flex items-center gap-2 text-[#0a6b3c]">
                  <Lock className="w-4 h-4" />
                  <h3 className="text-base font-extrabold">Administrator Login</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminLoginModal(false);
                    setAdminPasswordInput('');
                    setAdminLoginError('');
                  }}
                  className="text-xs font-bold text-neutral-500 hover:text-black cursor-pointer"
                >
                  Close
                </button>
              </div>
              {adminLoginError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                  {adminLoginError}
                </div>
              )}
              <form onSubmit={handleAdminLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold uppercase text-neutral-700 mb-1.5">
                    Administrator Password
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Enter administrator password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-sm text-black bg-white"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAdminLoginModal(false);
                      setAdminPasswordInput('');
                      setAdminLoginError('');
                    }}
                    className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={adminVerifying}
                    className="px-5 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                  >
                    {adminVerifying ? 'Verifying...' : 'Access Control Center'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </>
    );
  }

  // Render CBT Exam View (Portal Dashboard or Immediate Live Exam)
  if (view === 'exam' && loggedInCandidate) {
    const activeLoggedInCand =
      candidates.find((c) => c.id === loggedInCandidate.id) || loggedInCandidate;
    return (
      <ExamInterface
        key={`${activeLoggedInCand.id}-${examInitialStage}`}
        candidate={activeLoggedInCand}
        questions={questions}
        settings={settings}
        results={results}
        initialStage={examInitialStage}
        onUpdateCandidate={(updatedCand) => {
          setLoggedInCandidate(updatedCand);
          handleRegisterOrUpdateCandidate(updatedCand);
        }}
        onSubmitExam={(newResult) => {
          setResults((prev) => [newResult, ...prev]);
          addNotification(
            'Examination Submitted',
            `${newResult.candidateName} (${newResult.regNumber}) submitted exam with Aggregate Score ${newResult.score} (${newResult.percentage}%).`,
            'exam'
          );
          setActiveExamResult(newResult);
          setShowResultSlipOverlay(true);
          try {
            window.history.pushState({}, '', '/');
          } catch {
            // ignore
          }
          setView('result');
        }}
        onViewResult={(existingResult) => {
          setActiveExamResult(existingResult);
          setShowResultSlipOverlay(true);
          setView('result');
        }}
        onExitExam={() => {
          setRegInput('');
          try {
            window.history.pushState({}, '', '/');
          } catch {
            // ignore
          }
          setView('login');
        }}
      />
    );
  }

  // Render Admin Control Center View (Strictly requires authentication)
  if (view === 'admin' && isAdminAuthenticated) {
    return (
      <AdminDashboard
        candidates={candidates}
        questions={questions}
        results={results}
        settings={settings}
        notifications={notifications}
        onUpdateCandidate={handleRegisterOrUpdateCandidate}
        onAddCandidatesBulk={(newCands) => {
          setCandidates((prev) => [...newCands, ...prev]);
          addNotification(
            'Bulk Candidates Uploaded',
            `${newCands.length} candidate(s) added to Uploaded Candidates Dashboard.`,
            'registration'
          );
        }}
        onDeleteCandidates={(ids) => {
          setCandidates((prev) => prev.filter((c) => !ids.includes(c.id)));
        }}
        onClearAllCandidates={() => setCandidates([])}
        onAddQuestion={(q) => setQuestions((prev) => [q, ...prev])}
        onDeleteQuestion={(id) =>
          setQuestions((prev) => prev.filter((q) => q.id !== id))
        }
        onUpdateResult={(updatedResult) =>
          setResults((prev) =>
            prev.map((r) => (r.id === updatedResult.id ? updatedResult : r))
          )
        }
        onDeleteResults={(ids) =>
          setResults((prev) => prev.filter((r) => !ids.includes(r.id)))
        }
        onClearAllResults={() => setResults([])}
        onDeleteNotifications={(ids) =>
          setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)))
        }
        onClearAllNotifications={() => setNotifications([])}
        onClearProctoringFeeds={(candIds) =>
          setCandidates((prev) =>
            prev.map((c) =>
              candIds.includes(c.id) ? { ...c, proctoringCleared: true } : c
            )
          )
        }
        onClearAllProctoringFeeds={() =>
          setCandidates((prev) =>
            prev.map((c) =>
              c.paymentStatus === 'Paid' ? { ...c, proctoringCleared: true } : c
            )
          )
        }
        onRestoreAllProctoringFeeds={() =>
          setCandidates((prev) =>
            prev.map((c) => ({ ...c, proctoringCleared: false }))
          )
        }
        onUpdateSettings={setSettings}
        onRecalculateResults={(activePsycho: PsychometricConfig) => {
          const maxCap = activePsycho.enabled ? activePsycho.maxSubjectScoreCap : 100;
          setResults((prev) =>
            prev.map((res) => {
              let newAggregate = 0;
              const newBreakdown: Record<string, SubjectScoreDetail> = {};
              const subjectsKeys = Object.keys(res.subjectBreakdown);

              subjectsKeys.forEach((subj) => {
                const existingSubj = res.subjectBreakdown[subj];
                const subjAttempted = res.attemptedRecord?.filter(
                  (a) => a.subject === subj
                );

                let answersInOrder: { isCorrect: boolean }[] = [];
                let totalInSet = existingSubj.questionCount || 10;

                if (subjAttempted && subjAttempted.length > 0) {
                  totalInSet = subjAttempted.length;
                  answersInOrder = subjAttempted.map((a) => ({
                    isCorrect: a.selectedAnswer === a.correctAnswer,
                  }));
                } else {
                  const rawC =
                    existingSubj.rawCorrect !== undefined
                      ? existingSubj.rawCorrect
                      : Math.round((existingSubj.score / 100) * totalInSet);
                  answersInOrder = Array.from({ length: totalInSet }, (_, idx) => ({
                    isCorrect: idx < rawC,
                  }));
                }

                const newSubjScore = calculateSetScore(
                  answersInOrder,
                  totalInSet,
                  activePsycho
                );
                const det = calculateSetScoreDetailed(
                  answersInOrder,
                  totalInSet,
                  activePsycho
                );

                newAggregate += newSubjScore;
                newBreakdown[subj] = {
                  ...existingSubj,
                  score: newSubjScore,
                  total: maxCap,
                  rawCorrect: det.rawCorrect,
                  questionCount: totalInSet,
                  failStreaks: det.failStreaksTriggered,
                  passStreaks: det.passStreaksTriggered,
                };
              });

              const numSubjs = Math.max(1, subjectsKeys.length);
              const newPct = Math.min(
                maxCap,
                Math.max(
                  activePsycho.enabled ? activePsycho.minSubjectScoreCap : 0,
                  Math.round(newAggregate / numSubjs)
                )
              );

              return {
                ...res,
                score: newAggregate,
                maxAggregate: numSubjs * maxCap,
                percentage: newPct,
                subjectBreakdown: newBreakdown,
              };
            })
          );
          addNotification(
            'Psychometric Marking Regulations Applied',
            `Admin updated Psychometric Marking Regulations (Fail Streak: ${activePsycho.failStreakCount} -> ${activePsycho.failStreakPenalty}, Pass Streak: ${activePsycho.passStreakCount} -> +${activePsycho.passStreakBonus}).`,
            'exam'
          );
        }}
        onMarkNotificationsRead={() =>
          setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
        }
        onReturnToCandidatePortal={() => {
          if (activeRegCandidateId) {
            setView('registration');
          } else {
            setView('login');
          }
        }}
        onLogoutAdmin={() => {
          setIsAdminAuthenticated(false);
          setAdminPasswordInput('');
          setView('login');
        }}
      />
    );
  }

  // Render Exam Result Slip & Candidate Portal View (Matches Screenshot_20261023-155257_de6c24fc.png)
  if (view === 'result' && activeExamResult) {
    const matchedCandidate = candidates.find(
      (c) => c.regNumber.toUpperCase() === activeExamResult.regNumber.toUpperCase()
    );
    const candidateGender =
      activeExamResult.gender || matchedCandidate?.gender || 'Female';

    const gradeInfo = getQuemintGradeInfo(activeExamResult.percentage);

    const sortedResults = [...results].sort(
      (a, b) => b.score - a.score || b.percentage - a.percentage
    );
    const rankIndex = sortedResults.findIndex((r) => r.id === activeExamResult.id);
    const rankPosition = rankIndex !== -1 ? rankIndex + 1 : 1;
    const rankingPublished = isExamRankingPublished(activeExamResult, settings);
    const dynamicSlipRows = resolveResultSlipFieldRows(
      activeExamResult,
      matchedCandidate,
      settings,
      { rank: rankPosition, total: Math.max(1, results.length) }
    );

    return (
      <div className="min-h-screen bg-neutral-100 text-black relative flex flex-col">
        {/* Background Candidate Portal View (visible behind modal & interactive if modal dismissed) */}
        <div className="max-w-3xl w-full mx-auto px-4 py-8 space-y-6">
          {/* Candidate Portal Header Card */}
          <div className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src={QUEMINT_LOGO_URL}
                  alt="Quemint Education Board Logo"
                  className="w-12 h-12 rounded-full object-contain border border-[#0a6b3c]/25 bg-white p-0.5 shrink-0 shadow-2xs"
                />
                <div>
                  <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0a6b3c]">
                    CANDIDATE PORTAL • OFFICIAL RESULT
                  </span>
                  <h1 className="text-2xl font-extrabold text-black mt-0.5">
                    Hi, {activeExamResult.candidateName}
                  </h1>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {matchedCandidate && (
                  <button
                    type="button"
                    onClick={() => setSlipModalCandidate(matchedCandidate)}
                    className="px-3.5 py-2 rounded-full border border-[#0a6b3c] text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Reg Slip</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setRegInput('');
                    setView('login');
                  }}
                  className="px-4 py-2 rounded-full border border-neutral-300 hover:border-black text-xs font-bold cursor-pointer"
                >
                  Logout
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl border-2 border-[#0a6b3c] bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {matchedCandidate && getCandidateHdPortraitUrl(matchedCandidate) ? (
                    <img
                      src={getCandidateHdPortraitUrl(matchedCandidate)}
                      alt={activeExamResult.candidateName}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="text-xs space-y-0.5">
                  <div className="font-extrabold text-black">
                    {activeExamResult.candidateName}
                  </div>
                  <div className="text-neutral-600 font-mono">
                    Reg No: {activeExamResult.regNumber} · {activeExamResult.category}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowResultSlipOverlay(true)}
                className="px-4 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer"
              >
                View Result Slip
              </button>
            </div>

            {/* Dynamic Candidate Result Details on Check Results Portal (Controlled by Admin; Ranking hidden unless Published) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {dynamicSlipRows.map((row) => (
                <div
                  key={row.key}
                  className="p-3.5 rounded-2xl bg-neutral-50 border border-neutral-200"
                >
                  <span className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500">
                    {row.label}
                  </span>
                  <span
                    className={`font-extrabold text-sm mt-0.5 block ${
                      row.key === 'examinationCentre' || row.key === 'currentRanking'
                        ? 'text-[#0a6b3c]'
                        : row.key === 'regNumber'
                        ? 'font-mono text-[#0a6b3c]'
                        : 'text-black'
                    }`}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Grade, Average, Remark */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <div className="text-[11px] text-neutral-500 font-semibold">Grade</div>
                <div className="text-xl font-extrabold text-[#0a6b3c] mt-1">
                  {gradeInfo.displayFull}
                </div>
              </div>
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <div className="text-[11px] text-neutral-500 font-semibold">Average</div>
                <div className="text-2xl font-extrabold text-black mt-1 font-mono tabular-nums">
                  {activeExamResult.percentage}%
                </div>
                <div className="text-xs font-semibold text-neutral-500 mt-0.5">
                  Aggregate: {activeExamResult.score}
                </div>
              </div>
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4">
                <div className="text-[11px] text-neutral-500 font-semibold">
                  Exams Taken
                </div>
                <div className="text-2xl font-extrabold text-black mt-1 font-mono">
                  {Math.max(
                    1,
                    results.filter(
                      (r) =>
                        r.regNumber.trim().toUpperCase() ===
                        activeExamResult.regNumber.trim().toUpperCase()
                    ).length
                  )}
                </div>
              </div>
            </div>

            {/* Only display Candidate Ranking when Admin has clicked "Publish Ranking" on this exam */}
            {rankingPublished && (
              <div className="rounded-2xl border-2 border-[#0a6b3c]/30 bg-[#0a6b3c]/5 p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c] flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>OVERALL CANDIDATE RANKING</span>
                  </div>
                  <div className="text-xl font-extrabold text-black font-mono">
                    #{rankPosition}{' '}
                    <span className="text-xs font-sans font-semibold text-neutral-600">
                      of {Math.max(1, results.length)} total candidates
                    </span>
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center">
                  <Trophy className="w-5 h-5" />
                </div>
              </div>
            )}
          </div>

          {/* Subject Breakdown & Recent Attempts Card on Check Results Portal */}
          <div className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-black">
                Subject Breakdown &amp; Result Slip
              </h2>
              <button
                type="button"
                onClick={() =>
                  handleDownloadResultSlip(activeExamResult, candidateGender)
                }
                className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download PDF Slip</span>
              </button>
            </div>

            <div className="rounded-xl overflow-hidden border border-neutral-200">
              <div className="bg-[#e3f5ec] border-b border-[#bfe5d0] px-4 py-3 flex items-center justify-between text-xs font-bold text-neutral-900">
                <span>Subject</span>
                <span>Score</span>
              </div>
              <div className="divide-y divide-neutral-100 text-xs bg-white">
                {Object.entries(activeExamResult.subjectBreakdown).map(
                  ([subj, stats]) => (
                    <div
                      key={subj}
                      className="px-4 py-3 flex items-center justify-between"
                    >
                      <span className="text-neutral-800 font-semibold">{subj}</span>
                      <span className="font-bold text-neutral-900 tabular-nums">
                        {stats.score}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                Recent Attempts
              </h3>
              <div className="rounded-2xl border border-neutral-200 p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-extrabold text-sm text-black">
                    {activeExamResult.testTitle ||
                      settings.resultTitles?.testSubtitle ||
                      'Rapid Test'}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    Aggregate Score: {activeExamResult.score} (
                    {activeExamResult.percentage}%) ·{' '}
                    <strong className="text-[#0a6b3c]">
                      {gradeInfo.displayFull}
                    </strong>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadAttemptedQuestions(activeExamResult)}
                    className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Questions PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResultSlipOverlay(true)}
                    className="px-4 py-2 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] text-xs font-extrabold cursor-pointer"
                  >
                    Open Slip
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Questions With Official Answers Card (Matches Downloaded PDF: Just ✅ on correct MCQ options & Answer Key beneath TYA, no scoring/psychometric) */}
          {(() => {
            const attemptedItems = resolveAttemptedItemsForResult(
              activeExamResult,
              questions
            );
            if (attemptedItems.length === 0) return null;
            return (
              <div className="rounded-3xl bg-white border border-neutral-200 p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-4">
                  <div>
                    <h2 className="text-base font-extrabold text-black">
                      Questions &amp; Official Answer Keys
                    </h2>
                    <p className="text-xs text-neutral-500">
                      Correct MCQ options are marked with ✅ and TYA questions display the examiner Answer Key beneath each question.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadCandidateQuestionsPdf(
                          activeExamResult,
                          {
                            ...settings,
                            downloadMode: 'Download total questions attempted',
                          },
                          questions
                        )
                      }
                      className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Attempted Questions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadCandidateQuestionsPdf(
                          activeExamResult,
                          {
                            ...settings,
                            downloadMode: 'Download failed questions only',
                          },
                          questions
                        )
                      }
                      className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Missed Questions</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4 max-h-[540px] overflow-y-auto pr-1">
                  {attemptedItems.map((item, idx) => {
                    const isTya = item.questionType === 'TYA';
                    const officialKey = isTya
                      ? (item.answerKeys && item.answerKeys.length > 0
                          ? item.answerKeys
                          : [item.options?.[0] || '—']
                        ).join(' | ')
                      : '';
                    const letters = ['A', 'B', 'C', 'D'];

                    return (
                      <div
                        key={`${item.id}-${idx}`}
                        className="p-4 rounded-2xl border border-neutral-200 bg-white text-xs space-y-2"
                      >
                        <div className="text-[11px] font-extrabold text-[#0a6b3c]">
                          Category: {item.subject}
                        </div>
                        <div className="font-normal text-black text-sm leading-relaxed">
                          <span className="font-semibold mr-1.5">{idx + 1}.</span>
                          {item.questionText}
                        </div>

                        {isTya ? (
                          <div className="pl-4 pt-1">
                            <span className="font-extrabold text-black text-xs">
                              Answer Key: {officialKey}{' '}
                              <span className="text-[#16a34a] font-extrabold">✓</span>
                            </span>
                          </div>
                        ) : (
                          <div className="pl-4 space-y-1 pt-0.5">
                            <div className="font-extrabold text-[11px] text-neutral-900">
                              Options:
                            </div>
                            <div className="pl-2 space-y-1">
                              {(item.options || []).map((optText, oIdx) => {
                                const isCorrectOpt = oIdx === item.correctAnswer;
                                return (
                                  <div
                                    key={oIdx}
                                    className={
                                      isCorrectOpt
                                        ? 'font-extrabold text-black'
                                        : 'font-normal text-neutral-700'
                                    }
                                  >
                                    {letters[oIdx] || String.fromCharCode(65 + oIdx)}.{' '}
                                    {optText}{' '}
                                    {isCorrectOpt && (
                                      <span className="text-[#16a34a] font-extrabold ml-1">
                                        ✓
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        {/* FOREGROUND RESULT MODAL (Matches Reference Screenshot 2 in Quemint Green & White) */}
        {showResultSlipOverlay && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
            <div className="w-full max-w-md bg-white text-black rounded-[28px] overflow-hidden shadow-2xl p-6 md:p-7 relative my-auto">
              {/* Top-Right Close (X) Button */}
              <button
                type="button"
                onClick={() => setShowResultSlipOverlay(false)}
                aria-label="Close result slip"
                className="absolute top-5 right-5 p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-5">
                {/* Top Official Quemint Logo & Centered Title */}
                <div className="text-center space-y-1.5 pt-1">
                  <div className="w-16 h-16 rounded-full bg-white border-2 border-[#0a6b3c]/25 flex items-center justify-center mx-auto mb-3 overflow-hidden shadow-xs p-0.5">
                    <img
                      src={QUEMINT_LOGO_URL}
                      alt="Quemint Education Board Official Logo"
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>
                  <h2 className="text-lg md:text-xl font-extrabold tracking-tight text-neutral-900">
                    <span className="text-[#0a6b3c]">
                      {settings.resultTitles?.testTitle || 'Quemint'}
                    </span>{' '}
                    <span className="uppercase">
                      {activeExamResult.testTitle ||
                        settings.resultTitles?.testSubtitle ||
                        'MOCK EXAMINATION'}
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {settings.resultTitles?.assessmentSubtitle ||
                      'Quemint Assessment'}
                  </p>
                </div>

                {/* Dynamic Candidate Details (Admin can add/remove registration fields; Ranking only appears when Admin clicks Publish Ranking) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-xs pt-1">
                  {dynamicSlipRows.map((row) => (
                    <div key={row.key}>
                      <div className="text-neutral-500">
                        {row.label.endsWith(':') ? row.label : `${row.label}:`}
                      </div>
                      <div
                        className={`font-bold mt-0.5 ${
                          row.key === 'examinationCentre' || row.key === 'currentRanking'
                            ? 'text-[#0a6b3c]'
                            : row.key === 'category'
                            ? 'text-neutral-900 lowercase'
                            : 'text-neutral-900'
                        }`}
                      >
                        {row.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-neutral-100" />

                {/* Subject & Score Table Box (Soft Green Header, Standalone Scores, No /xx) */}
                <div className="rounded-xl overflow-hidden border border-neutral-200/80">
                  <div className="bg-[#e3f5ec] border-b border-[#bfe5d0] px-4 py-3 flex items-center justify-between text-xs font-bold text-neutral-900">
                    <span>Subject</span>
                    <span>Score</span>
                  </div>
                  <div className="divide-y divide-neutral-100 text-xs bg-white">
                    {Object.entries(activeExamResult.subjectBreakdown).map(
                      ([subj, stats]) => (
                        <div
                          key={subj}
                          className="px-4 py-3 flex items-center justify-between"
                        >
                          <span className="text-neutral-800 font-semibold">
                            {subj}
                          </span>
                          <span className="font-bold text-neutral-900 tabular-nums">
                            {stats.score}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* Centered Aggregate Score, Percentage & Official Grade */}
                <div className="text-center pt-1 space-y-1">
                  <div className="text-base md:text-lg font-extrabold text-neutral-900">
                    Aggregate score: {activeExamResult.score}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Percentage: {activeExamResult.percentage}%
                  </div>
                  <div className="text-xs font-extrabold text-[#0a6b3c] pt-1">
                    {gradeInfo.displayFull}
                  </div>
                </div>

                {/* Three Full-Width Stacked Action Buttons */}
                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadResultSlip(activeExamResult, candidateGender)
                    }
                    className="w-full py-3.5 px-5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download result slip</span>
                  </button>

                  {settings.enableQuestionDownload !== false && (
                    <button
                      type="button"
                      onClick={() => handleDownloadAttemptedQuestions(activeExamResult)}
                      className="w-full py-3.5 px-5 rounded-xl bg-white hover:bg-[#0a6b3c]/5 border border-[#0a6b3c] text-[#0a6b3c] text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {settings.downloadMode || 'Download total questions attempted'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setRegInput('');
                      setView('login');
                    }}
                    className="w-full py-3.5 px-5 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to login</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {slipModalCandidate && (
          <RegistrationSlipModal
            candidate={slipModalCandidate}
            onClose={() => setSlipModalCandidate(null)}
            onUpdatePassport={(_candId, url) => {
              const updated = { ...slipModalCandidate, passportDataUrl: url };
              setSlipModalCandidate(updated);
              handleRegisterOrUpdateCandidate(updated);
            }}
          />
        )}
      </div>
    );
  }

  // DEFAULT VIEW: Candidate Login & Registration Gateway (Matches Screenshot 1 with Green #0a6b3c Brand Rules)
  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      {/* Top Bar following 3-Zone Contract with Quemint Education Board Green Seal on Top Left */}
      <header className="sticky top-0 z-30 bg-white border-b border-neutral-200 px-4 md:px-8 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Official Seal & Brand Title */}
        <div className="flex items-center gap-3 shrink-0">
          <QuemintSeal size="sm" variant="green" subtitle="" />
        </div>

        {/* Zone 2: Concise Single-Line Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-bold text-neutral-700">
          <button
            type="button"
            onClick={() => setView('login')}
            className="text-[#0a6b3c] underline underline-offset-4 cursor-pointer whitespace-nowrap shrink-0"
          >
            Candidate Login
          </button>
          <button
            type="button"
            onClick={() => setView('registration')}
            className="hover:text-[#0a6b3c] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Registration
          </button>
          <button
            type="button"
            onClick={() => {
              setResultLookupReg('');
              setLookupResultError('');
              setShowCheckResultModal(true);
            }}
            className="hover:text-[#0a6b3c] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Check Result
          </button>
          <button
            type="button"
            onClick={requestAdminAccess}
            className="hover:text-[#0a6b3c] transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Admin Dashboard
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action (Registration) */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setView('registration')}
            className="px-4 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Registration</span>
          </button>
        </div>
      </header>

      {/* Main Content Container: Clean Centered Candidate Login Card */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-8 md:py-12 flex flex-col justify-center">
        <div className="w-full rounded-3xl overflow-hidden border border-neutral-200 shadow-xl flex flex-col bg-white">
          {/* Top Green Box Header Section (#0a6b3c) */}
          <div className="bg-[#0a6b3c] p-6 md:p-8 text-white space-y-5">
            <div className="flex items-center justify-between gap-4">
              <QuemintSeal size="sm" variant="white" subtitle="" />
              <button
                type="button"
                onClick={() => setDarkCardMode(!darkCardMode)}
                className="px-3.5 py-1.5 rounded-full bg-[#0e8a4e] hover:bg-white/20 border border-white/30 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {darkCardMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="text-xs font-extrabold uppercase tracking-widest text-white/90">
                {settings.loginBanner?.topSmallLabel ||
                  'MEDICAL & ENGINEERING · ART & COMMERCIAL'}
              </div>
              <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight leading-tight">
                {settings.loginBanner?.mainTitle || 'Quemint Rapid Test Practice.'}
              </h1>
              <p className="text-sm text-white/90 leading-relaxed">
                {settings.loginBanner?.description ||
                  'A focused exam environment built to help you prepare with confidence.'}
              </p>
            </div>

            <div className="pt-1 text-xs font-semibold text-white/90">
              {settings.loginBanner?.footerInfo ||
                `Timed Questions · ${settings.durationMinutes} minutes · Secure testing`}
            </div>
          </div>

          {/* Bottom Candidate Login Form Section */}
          <div
            className={`p-6 md:p-8 flex-1 flex flex-col justify-between space-y-6 transition-colors ${
              darkCardMode ? 'bg-neutral-900 text-white' : 'bg-white text-black'
            }`}
          >
            <div className="space-y-5">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  WELCOME BACK
                </span>
                <h2 className="text-2xl font-extrabold tracking-tight mt-0.5">
                  Candidate login
                </h2>
                <p
                  className={`text-xs mt-1 ${
                    darkCardMode ? 'text-neutral-400' : 'text-neutral-600'
                  }`}
                >
                  Enter your registration number to continue.
                </p>
              </div>

              {loginError && (
                <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleStartExamLogin} className="space-y-4">
                <div>
                  <label
                    className={`block text-xs font-extrabold uppercase tracking-wider mb-2 ${
                      darkCardMode ? 'text-neutral-300' : 'text-neutral-700'
                    }`}
                  >
                    REGISTRATION NUMBER
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={regInput}
                    onChange={(e) => setRegInput(e.target.value)}
                    placeholder="Enter your Reg No"
                    className={`w-full px-4 py-3.5 rounded-xl border text-sm font-mono font-bold focus:border-[#0a6b3c] focus:outline-none ${
                      darkCardMode
                        ? 'bg-neutral-800 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-black'
                    }`}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm"
                >
                  <span>Start examination</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              {/* Stacked Actions:
                  1. Check my result
                  2. Register now (directly beneath Check my result -> takes them to Registration page)
                  3. Login as Admin */}
              <div className="flex flex-col items-start gap-2.5 pt-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setResultLookupReg('');
                    setLookupResultError('');
                    setShowCheckResultModal(true);
                  }}
                  className={`hover:text-[#0a6b3c] transition-colors cursor-pointer ${
                    darkCardMode ? 'text-neutral-300' : 'text-neutral-700'
                  }`}
                >
                  Check my result
                </button>

                <button
                  type="button"
                  onClick={() => setView('registration')}
                  className="text-[#0a6b3c] hover:text-[#0e8a4e] font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Register now</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={requestAdminAccess}
                  className={`hover:text-[#0a6b3c] flex items-center gap-1.5 transition-colors cursor-pointer pt-0.5 ${
                    darkCardMode ? 'text-neutral-400' : 'text-neutral-600'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Login as Admin</span>
                </button>
              </div>
            </div>

            {/* Footer Status inside Card */}
            <div className="pt-4 border-t border-neutral-200 flex flex-wrap items-center justify-between gap-2">
              <div
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold border ${
                  settings.examOpen
                    ? 'bg-[#0a6b3c]/10 border-[#0a6b3c]/30 text-[#0a6b3c]'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    settings.examOpen ? 'bg-[#0a6b3c]' : 'bg-red-600'
                  }`}
                />
                <span>{settings.examOpen ? 'Exam is open' : 'Exam is closed'}</span>
              </div>

              <div
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-extrabold border ${
                  (settings.registrationOpen ?? true)
                    ? 'bg-[#0a6b3c]/10 border-[#0a6b3c]/30 text-[#0a6b3c]'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    (settings.registrationOpen ?? true) ? 'bg-[#0a6b3c]' : 'bg-red-600'
                  }`}
                />
                <span>
                  {(settings.registrationOpen ?? true)
                    ? 'Registration is open'
                    : 'Registration is closed'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* TASK 2: Password Pop-Up Before Exam ("Verify Identity") */}
      {pendingVerifyCandidate && (
        <VerifyIdentityModal
          candidate={pendingVerifyCandidate}
          settings={settings}
          onCancel={() => setPendingVerifyCandidate(null)}
          onVerified={(flow) => {
            const targetCand = pendingVerifyCandidate;
            setPendingVerifyCandidate(null);
            setLoggedInCandidate(targetCand);
            if (flow === 'immediate') {
              setExamInitialStage('live-exam');
              try {
                window.history.pushState({}, '', `/exam/${targetCand.id}`);
              } catch {
                // ignore
              }
            } else {
              setExamInitialStage('portal');
              try {
                window.history.pushState({}, '', `/candidate/${targetCand.id}/portal`);
              } catch {
                // ignore
              }
            }
            setView('exam');
          }}
        />
      )}

      {/* Password Pop-Up Before Checking Result (Same "Verify Identity" modal as Examination Login) */}
      {pendingVerifyResultCheck && (
        <VerifyIdentityModal
          candidate={pendingVerifyResultCheck.candidate}
          settings={settings}
          onCancel={() => setPendingVerifyResultCheck(null)}
          onVerified={() => {
            const targetResult = pendingVerifyResultCheck.result;
            setPendingVerifyResultCheck(null);
            setResultLookupReg('');
            setLookupResultError('');
            setActiveExamResult(targetResult);
            setShowResultSlipOverlay(true);
            setView('result');
          }}
        />
      )}

      {/* Check My Result Modal */}
      {showCheckResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h3 className="text-base font-extrabold text-[#0a6b3c]">
                Check Examination Result
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowCheckResultModal(false);
                  setResultLookupReg('');
                  setLookupResultError('');
                }}
                className="text-xs font-bold text-neutral-500 hover:text-black cursor-pointer"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-neutral-600 font-medium">
              Type in your registration number
            </p>

            {lookupResultError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                {lookupResultError}
              </div>
            )}

            <form onSubmit={handleCheckResultSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold uppercase text-neutral-700 mb-1.5">
                  Registration Number
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={resultLookupReg}
                  onChange={(e) => setResultLookupReg(e.target.value)}
                  placeholder="Type in your registration number"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-sm font-bold text-black"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCheckResultModal(false);
                    setResultLookupReg('');
                    setLookupResultError('');
                  }}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer"
                >
                  View Result Slip
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Registration Slip Modal */}
      {slipModalCandidate && (
        <RegistrationSlipModal
          candidate={slipModalCandidate}
          isFreeRegistration={Boolean(
            settings.freeRegistration || settings.registrationFee === 0
          )}
          onClose={() => setSlipModalCandidate(null)}
          onUpdatePassport={(_candId, url) => {
            const updated = { ...slipModalCandidate, passportDataUrl: url };
            setSlipModalCandidate(updated);
            handleRegisterOrUpdateCandidate(updated);
          }}
        />
      )}

      {/* Protected Administrator Login Modal (Password is masked and never visible) */}
      {showAdminLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <div className="flex items-center gap-2 text-[#0a6b3c]">
                <Lock className="w-4 h-4" />
                <h3 className="text-base font-extrabold">Administrator Login</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAdminLoginModal(false);
                  setAdminPasswordInput('');
                  setAdminLoginError('');
                }}
                className="text-xs font-bold text-neutral-500 hover:text-black cursor-pointer"
              >
                Close
              </button>
            </div>

            {adminLoginError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                {adminLoginError}
              </div>
            )}

            <form onSubmit={handleAdminLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold uppercase text-neutral-700 mb-1.5">
                  Administrator Password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={adminPasswordInput}
                  onChange={(e) => setAdminPasswordInput(e.target.value)}
                  placeholder="Enter administrator password"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-sm text-black bg-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAdminLoginModal(false);
                    setAdminPasswordInput('');
                    setAdminLoginError('');
                  }}
                  className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adminVerifying}
                  className="px-5 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                >
                  {adminVerifying ? 'Verifying...' : 'Access Control Center'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
