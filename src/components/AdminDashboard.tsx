import React, { useState, useMemo, useEffect } from 'react';
import {
  Users,
  BookOpen,
  FileText,
  BarChart3,
  Video,
  Settings,
  Bell,
  LogOut,
  CheckCircle2,
  KeyRound,
  Ban,
  ShieldCheck,
  Trash2,
  Upload,
  Search,
  Camera,
  Eye,
  Edit3,
  Plus,
  Download,
  Copy,
  Check,
  Moon,
  Sun,
  ArrowLeft,
  ArrowRight,
  Folder,
  Layers,
  Lock,
  Unlock,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Send,
  Shield,
  Trophy,
  Printer,
  UserPlus,
  GraduationCap,
  Hash,
  MapPin,
  Database,
  X,
  EyeOff,
  FileSpreadsheet,
  Calendar,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  Candidate,
  CategoryType,
  ExamCenter,
  ExamResult,
  ExamSettings,
  ExamStartFlowType,
  GenderType,
  NotificationItem,
  PublishedTest,
  Question,
  QuestionDownloadMode,
  QuestionType,
  ResultSlipFieldConfig,
  SubjectCombinationConfig,
  SubjectPoolConfig,
  SubjectScoreDetail,
  SystemSettingItem,
} from '../types';
import {
  DEFAULT_EXAM_CENTERS,
  DEFAULT_RESULT_SLIP_FIELDS,
  DEFAULT_SUBJECTS_LIST,
  DEFAULT_SUBJECT_COMBINATIONS,
} from '../data/initialData';
import {
  calculateSetScore,
  calculateSetScoreDetailed,
  DEFAULT_PSYCHOMETRIC_CONFIG,
  PsychometricConfig,
} from '../utils/calculateScore';
import { hashPasswordSha256, simpleFallbackHash } from '../utils/passwordHash';
import { QuemintSeal, QUEMINT_LOGO_URL } from './QuemintSeal';
import { RegistrationSlipModal } from './RegistrationSlipModal';
import { LiveProctoringPanel } from './LiveProctoringPanel';
import { PerformanceAnalysisPanel } from './PerformanceAnalysisPanel';
import { ExamSchedulePanel } from './ExamSchedulePanel';
import {
  getQuemintGradeInfo,
  getEffectiveResultSlipFields,
  isExamRankingPublished,
  resolveResultSlipFieldRows,
  downloadCandidateResultSlipPdf,
  downloadCandidateQuestionsPdf,
  drawOfficialSeal,
  generateUniqueQmtRegNumber,
  sortCandidatesAlphabeticallyByFirstName,
  formatBulkCandidatesAsText,
  downloadRegisteredCandidatesPdf,
} from '../utils/pdfSlipGenerator';
import {
  SAMPLE_20_BIOLOGY_TYA_6COL_TEXT,
  parseAnswerKeys,
  parseBulkQuestionsInput,
  resolveAttemptedItemsForResult,
  downloadAttemptWithAiExplanationsPdf,
  downloadAttemptWithAiExplanationsExcelCsv,
} from '../utils/tyaEvaluator';

interface AdminDashboardProps {
  candidates: Candidate[];
  questions: Question[];
  results: ExamResult[];
  settings: ExamSettings;
  notifications: NotificationItem[];
  onUpdateCandidate: (candidate: Candidate, notifTitle?: string, notifMsg?: string) => void;
  onAddCandidatesBulk: (newCandidates: Candidate[]) => void;
  onDeleteCandidates: (ids: string[]) => void;
  onClearAllCandidates: () => void;
  onAddQuestion: (question: Question) => void;
  onDeleteQuestion: (id: string) => void;
  onUpdateResult: (updatedResult: ExamResult) => void;
  onDeleteResults: (ids: string[]) => void;
  onClearAllResults: () => void;
  onDeleteNotifications: (ids: string[]) => void;
  onClearAllNotifications: () => void;
  onClearProctoringFeeds: (candidateIds: string[]) => void;
  onClearAllProctoringFeeds: () => void;
  onRestoreAllProctoringFeeds?: () => void;
  onUpdateSettings: (settings: ExamSettings) => void;
  onRecalculateResults?: (config: PsychometricConfig) => void;
  onMarkNotificationsRead: () => void;
  onReturnToCandidatePortal: () => void;
  onLogoutAdmin: () => void;
}

type AdminTab =
  | 'Overview'
  | 'Candidates'
  | 'Exam Centers'
  | 'Exam Schedule'
  | 'Question bank'
  | 'Results'
  | 'Performance Analysis'
  | 'Analytics'
  | 'Live Proctoring'
  | 'Settings / Create Exam'
  | 'Notifications';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  candidates,
  questions,
  results,
  settings,
  notifications,
  onUpdateCandidate,
  onAddCandidatesBulk,
  onDeleteCandidates,
  onClearAllCandidates,
  onAddQuestion,
  onDeleteQuestion,
  onUpdateResult,
  onDeleteResults,
  onClearAllResults,
  onDeleteNotifications,
  onClearAllNotifications,
  onClearProctoringFeeds,
  onClearAllProctoringFeeds,
  onRestoreAllProctoringFeeds,
  onUpdateSettings,
  onRecalculateResults,
  onMarkNotificationsRead,
  onReturnToCandidatePortal,
  onLogoutAdmin,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('Candidates');
  const [darkSurface, setDarkSurface] = useState(false);

  // Results bulk selection + View/Edit individual result state
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [viewingResult, setViewingResult] = useState<ExamResult | null>(null);
  const [editingResult, setEditingResult] = useState<ExamResult | null>(null);
  const [newResultSubjectName, setNewResultSubjectName] = useState<string>('');
  const [newResultSubjectScore, setNewResultSubjectScore] = useState<number>(75);

  // Live Proctoring & Notifications bulk selection state
  const [selectedProctoringIds, setSelectedProctoringIds] = useState<string[]>([]);
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<string[]>([]);

  const psychoConfig: PsychometricConfig =
    settings.psychometric || DEFAULT_PSYCHOMETRIC_CONFIG;

  // Interactive Sandbox state for testing Psychometric Marking Regulations in Admin Panel
  const [sandboxAnswers, setSandboxAnswers] = useState<boolean[]>([
    true,
    true,
    false,
    false,
    false, // 3 fails in a row -> -1 penalty
    true,
    true,
    true,
    true,
    true,
  ]);
  const [recalcBanner, setRecalcBanner] = useState<string>('');
  const [settingsSavedToast, setSettingsSavedToast] = useState<string>('');
  const [newTestTitle, setNewTestTitle] = useState<string>(
    settings.resultTitles?.testSubtitle || 'Rapid Test'
  );
  const [newTestCategory, setNewTestCategory] = useState<CategoryType | 'All'>('All');
  const [newTestDeadline, setNewTestDeadline] = useState<string>('31/12/2027, 23:59:00');
  const [newTestMaxAttempts, setNewTestMaxAttempts] = useState<number>(1);
  const [durationInputStr, setDurationInputStr] = useState<string>(
    String(settings.durationMinutes || 30)
  );
  const [publishedTestDurationDrafts, setPublishedTestDurationDrafts] = useState<
    Record<string, string>
  >({});

  // Admin-Controlled Exam Start Flow & Default Candidate Master Password state
  const [examStartFlowDraft, setExamStartFlowDraft] = useState<ExamStartFlowType>(
    settings.examStartFlow || 'dashboard_first'
  );
  const [defaultCandidatePasswordDraft, setDefaultCandidatePasswordDraft] =
    useState<string>(settings.defaultCandidatePassword || 'quemint2026');
  const [showDefaultCandidatePassword, setShowDefaultCandidatePassword] =
    useState<boolean>(false);

  // Dynamic Result Slip Custom Field Inputs
  const [customSlipFieldLabel, setCustomSlipFieldLabel] = useState('');
  const [customSlipFieldValue, setCustomSlipFieldValue] = useState('');

  const effectiveResultSlipFields: ResultSlipFieldConfig[] = useMemo(
    () => getEffectiveResultSlipFields(settings),
    [settings]
  );

  const handleToggleResultSlipField = (fieldKey: string) => {
    const updatedFields = effectiveResultSlipFields.map((f) =>
      f.key === fieldKey ? { ...f, enabled: !f.enabled } : f
    );
    onUpdateSettings({
      ...settings,
      resultSlipFields: updatedFields,
    });
    const target = updatedFields.find((f) => f.key === fieldKey);
    if (target) {
      triggerToast(
        target.enabled
          ? `"${target.label}" added to Candidate Result Slip!`
          : `"${target.label}" removed from Candidate Result Slip.`
      );
    }
  };

  const handleUpdateResultSlipFieldLabel = (fieldKey: string, newLabel: string) => {
    const updatedFields = effectiveResultSlipFields.map((f) =>
      f.key === fieldKey ? { ...f, label: newLabel } : f
    );
    onUpdateSettings({
      ...settings,
      resultSlipFields: updatedFields,
    });
  };

  const handleAddCustomResultSlipField = () => {
    const labelClean = customSlipFieldLabel.trim();
    if (!labelClean) {
      triggerToast('Please enter a label for the custom result slip field.');
      return;
    }
    const newField: ResultSlipFieldConfig = {
      key: `custom_${Date.now()}`,
      label: labelClean,
      enabled: true,
      isCustom: true,
      customValue: customSlipFieldValue.trim() || 'Verified',
    };
    const updatedFields = [...effectiveResultSlipFields, newField];
    onUpdateSettings({
      ...settings,
      resultSlipFields: updatedFields,
    });
    setCustomSlipFieldLabel('');
    setCustomSlipFieldValue('');
    triggerToast(`Added "${labelClean}" to Candidate Result Slip!`);
  };

  const handleDeleteCustomResultSlipField = (fieldKey: string) => {
    const updatedFields = effectiveResultSlipFields.filter((f) => f.key !== fieldKey);
    onUpdateSettings({
      ...settings,
      resultSlipFields: updatedFields,
    });
    triggerToast('Custom result slip field removed.');
  };

  const handleTogglePublishRankingForTest = (testId: string) => {
    const existingTests = settings.publishedTests || [];
    const targetTest = existingTests.find((t) => t.id === testId);
    const currentStatus = targetTest
      ? Boolean(
          targetTest.rankingPublished ||
            (settings.rankingPublishedByTestId &&
              settings.rankingPublishedByTestId[testId])
        )
      : Boolean(settings.globalRankingPublished);
    const nextStatus = !currentStatus;

    const updatedTests = existingTests.map((t) =>
      t.id === testId ? { ...t, rankingPublished: nextStatus } : t
    );
    const updatedMap = {
      ...(settings.rankingPublishedByTestId || {}),
      [testId]: nextStatus,
    };

    onUpdateSettings({
      ...settings,
      publishedTests: updatedTests,
      rankingPublishedByTestId: updatedMap,
    });

    triggerToast(
      nextStatus
        ? `Ranking PUBLISHED for "${targetTest?.title || 'Exam'}"! Candidates can now see their Current Ranking on their result slip.`
        : `Ranking UNPUBLISHED for "${targetTest?.title || 'Exam'}". Ranking has been completely hidden from candidate results.`
    );
  };

  useEffect(() => {
    if (settings.examStartFlow) {
      setExamStartFlowDraft(settings.examStartFlow);
    }
  }, [settings.examStartFlow]);

  useEffect(() => {
    if (settings.defaultCandidatePassword) {
      setDefaultCandidatePasswordDraft(settings.defaultCandidatePassword);
    }
  }, [settings.defaultCandidatePassword]);

  const triggerToast = (msg: string) => {
    setSettingsSavedToast(msg);
    setTimeout(() => setSettingsSavedToast(''), 3500);
  };

  const normalizeSystemSettingsMap = (
    raw: ExamSettings['systemSettings'] | SystemSettingItem[] | undefined
  ): Record<string, string> => {
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const map: Record<string, string> = {};
      raw.forEach((item) => {
        if (item && typeof item.key === 'string') {
          map[item.key] = String(item.value ?? '');
        }
      });
      return map;
    }
    if (typeof raw === 'object') {
      return { ...(raw as Record<string, string>) };
    }
    return {};
  };

  const handleSaveExamStartFlow = async () => {
    const selectedFlow: ExamStartFlowType =
      examStartFlowDraft === 'immediate' ? 'immediate' : 'dashboard_first';
    const existingSysMap = normalizeSystemSettingsMap(settings.systemSettings);
    const updatedSystemSettings: Record<string, string> = {
      ...existingSysMap,
      exam_start_flow: selectedFlow,
    };

    onUpdateSettings({
      ...settings,
      examStartFlow: selectedFlow,
      systemSettings: updatedSystemSettings,
    });

    try {
      await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exam_start_flow: selectedFlow }),
      });
    } catch {
      // Fallback to local state if API unreachable
    }

    triggerToast(
      selectedFlow === 'dashboard_first'
        ? 'Exam Start Behaviour saved: "Go to Dashboard First (Recommended)" (exam_start_flow = dashboard_first).'
        : 'Exam Start Behaviour saved: "Start Exam Immediately" (exam_start_flow = immediate).'
    );
  };

  const handleSaveDefaultCandidatePassword = async () => {
    const cleanPass = defaultCandidatePasswordDraft.trim();
    if (!cleanPass) {
      triggerToast('Please enter a valid master password before saving.');
      return;
    }

    let hashedVal = simpleFallbackHash(cleanPass);
    try {
      hashedVal = await hashPasswordSha256(cleanPass);
    } catch {
      // Fallback hash already computed
    }

    const existingSysMap = normalizeSystemSettingsMap(settings.systemSettings);
    const updatedSystemSettings: Record<string, string> = {
      ...existingSysMap,
      default_candidate_password: hashedVal,
    };

    onUpdateSettings({
      ...settings,
      defaultCandidatePassword: cleanPass,
      defaultCandidatePasswordHash: hashedVal,
      systemSettings: updatedSystemSettings,
    });

    try {
      await fetch('/api/system-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_candidate_password: cleanPass }),
      });
    } catch {
      // Fallback to local state if API unreachable
    }

    triggerToast(
      'Default Candidate Master Password saved & hashed in system_settings (key: default_candidate_password)!'
    );
  };

  // Applies any custom duration (no upper bound) to global settings and active tests
  const handleApplyDurationMinutes = (rawMinutes: number, showToast = false) => {
    const validMinutes = Math.max(1, Math.round(rawMinutes) || 1);
    setDurationInputStr(String(validMinutes));
    const updatedPublishedTests = (settings.publishedTests || []).map((pt) => ({
      ...pt,
      durationMinutes: validMinutes,
    }));
    const currentFooter =
      settings.loginBanner?.footerInfo ||
      `Timed Questions · ${validMinutes} minutes · Secure testing`;
    const updatedFooter = currentFooter.replace(
      /\b\d+\s*minutes?\b/i,
      `${validMinutes} minutes`
    );

    onUpdateSettings({
      ...settings,
      durationMinutes: validMinutes,
      publishedTests: updatedPublishedTests,
      loginBanner: {
        ...settings.loginBanner,
        footerInfo: updatedFooter,
      },
    });

    if (showToast) {
      triggerToast(
        `Exam duration set to ${validMinutes} minutes!`
      );
    }
  };

  const updatePsychoField = <K extends keyof PsychometricConfig>(
    key: K,
    value: PsychometricConfig[K]
  ) => {
    const updatedPsycho: PsychometricConfig = {
      ...psychoConfig,
      [key]: value,
    };
    onUpdateSettings({
      ...settings,
      psychometric: updatedPsycho,
    });
  };

  // Exam Centers / Q-Zones derived from settings
  const examCenters: ExamCenter[] = useMemo(() => {
    return settings.examCenters && settings.examCenters.length > 0
      ? settings.examCenters
      : DEFAULT_EXAM_CENTERS;
  }, [settings.examCenters]);

  const [newCenterName, setNewCenterName] = useState<string>('');
  const [newCenterCapacity, setNewCenterCapacity] = useState<string>('50');
  const [editingCenterId, setEditingCenterId] = useState<string | null>(null);
  const [editCenterNameDraft, setEditCenterNameDraft] = useState<string>('');
  const [editCenterCapDraft, setEditCenterCapDraft] = useState<string>('');
  const [editCenterCountDraft, setEditCenterCountDraft] = useState<string>('');

  const handleCreateExamCenter = () => {
    const cleanName = newCenterName.trim();
    const maxCap = Math.max(1, parseInt(newCenterCapacity, 10) || 50);
    if (!cleanName) {
      triggerToast('Please enter a name for the Exam Center / Q-Zone (e.g., Q Zone 1).');
      return;
    }
    const newCenter: ExamCenter = {
      id: `center-${Date.now()}`,
      name: cleanName,
      maxCapacity: maxCap,
      currentCount: 0,
    };
    onUpdateSettings({
      ...settings,
      examCenters: [...examCenters, newCenter],
    });
    setNewCenterName('');
    setNewCenterCapacity('50');
    triggerToast(`Created Exam Center "${cleanName}" (Max Capacity: ${maxCap}).`);
  };

  const handleStartEditExamCenter = (center: ExamCenter) => {
    setEditingCenterId(center.id);
    setEditCenterNameDraft(center.name);
    setEditCenterCapDraft(String(center.maxCapacity));
    setEditCenterCountDraft(String(center.currentCount));
  };

  const handleSaveEditExamCenter = (centerId: string) => {
    const cleanName = editCenterNameDraft.trim();
    const maxCap = Math.max(1, parseInt(editCenterCapDraft, 10) || 50);
    const curCount = Math.max(0, parseInt(editCenterCountDraft, 10) || 0);
    if (!cleanName) {
      triggerToast('Exam Center name cannot be empty.');
      return;
    }
    const updatedCenters = examCenters.map((ec) =>
      ec.id === centerId
        ? { ...ec, name: cleanName, maxCapacity: maxCap, currentCount: curCount }
        : ec
    );
    onUpdateSettings({
      ...settings,
      examCenters: updatedCenters,
    });
    setEditingCenterId(null);
    triggerToast(`Updated Exam Center "${cleanName}" (${curCount}/${maxCap}).`);
  };

  const handleDeleteExamCenter = (centerId: string) => {
    const target = examCenters.find((ec) => ec.id === centerId);
    const updatedCenters = examCenters.filter((ec) => ec.id !== centerId);
    onUpdateSettings({
      ...settings,
      examCenters: updatedCenters,
    });
    if (target) {
      triggerToast(`Deleted Exam Center "${target.name}".`);
    }
  };

  // Candidate Registry states (TASK 2: Exact 6-column Bulk Paste format)
  const [pasteText, setPasteText] = useState(
    `Chiamaka | Blessing | Okafor | English, Maths, Biology, Chemistry | Medicine | Science\nTunde | - | Bakare | English, Government, Literature, CRS | Law | Art\nZainab | Amina | Bello | English, Maths, Economics, Accounting | Accounting | Commercial`
  );
  const [previewedCandidates, setPreviewedCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');

  // Modals for Photocard / View Profile / Edit Candidate
  const [slipCandidate, setSlipCandidate] = useState<Candidate | null>(null);
  const [profileCandidate, setProfileCandidate] = useState<Candidate | null>(null);
  const [editCandidate, setEditCandidate] = useState<Candidate | null>(null);
  const [showAddCandidateModal, setShowAddCandidateModal] = useState(false);

  // New Candidate Manual Form in Admin
  const [newFirstName, setNewFirstName] = useState('');
  const [newMiddleName, setNewMiddleName] = useState('');
  const [newSurname, setNewSurname] = useState('');
  const [newGender, setNewGender] = useState<GenderType>('Male');
  const [newCategory, setNewCategory] = useState<CategoryType>('Science');
  const [newCourseOfStudy, setNewCourseOfStudy] = useState('');
  const [newSubjectCombination, setNewSubjectCombination] = useState(
    'English, Mathematics, Biology, Chemistry'
  );
  const [newStateOfOrigin, setNewStateOfOrigin] = useState('');

  // Question Bank states
  const [subjectsList, setSubjectsList] = useState<string[]>(DEFAULT_SUBJECTS_LIST);
  const [qSubject, setQSubject] = useState('English');
  const [questionBanks, setQuestionBanks] = useState<
    { id: string; subject: string; title: string; description: string }[]
  >([
    {
      id: 'bank-eng-1',
      subject: 'English',
      title: 'Lexis & Grammar',
      description: 'Prepositions, vocabulary, and sentence structure',
    },
    {
      id: 'bank-eng-2',
      subject: 'English',
      title: 'Comprehension & Antonyms',
      description: 'Synonyms, figures of speech, and spelling',
    },
    {
      id: 'bank-bio-1',
      subject: 'Biology',
      title: 'Cell Biology & Physiology',
      description: 'Organelles, circulation, osmoregulation, and plant vascular tissues',
    },
    {
      id: 'bank-mth-1',
      subject: 'Mathematics',
      title: 'Calculus, Algebra & Statistics',
      description: 'Derivatives, exponential equations, and central tendency',
    },
    {
      id: 'bank-phy-1',
      subject: 'Physics',
      title: 'Mechanics, Electricity & Waves',
      description: 'Newtonian dynamics, DC circuits, and electromagnetic spectrum',
    },
    {
      id: 'bank-chm-1',
      subject: 'Chemistry',
      title: 'Inorganic & Physical Chemistry',
      description: 'Oxidation states, gas laws, periodic table, and pH calculations',
    },
  ]);
  const [openedBankId, setOpenedBankId] = useState<string | null>(null);
  const [showAddSubjectModal, setShowAddSubjectModal] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [showAddBankModal, setShowAddBankModal] = useState(false);
  const [newBankTitle, setNewBankTitle] = useState('');
  const [newBankDesc, setNewBankDesc] = useState('');

  const [qCategory, setQCategory] = useState<CategoryType | 'All'>('All');
  const [qText, setQText] = useState('');
  const [qOptA, setQOptA] = useState('');
  const [qOptB, setQOptB] = useState('');
  const [qOptC, setQOptC] = useState('');
  const [qOptD, setQOptD] = useState('');
  const [qCorrect, setQCorrect] = useState(0);
  const [qType, setQType] = useState<QuestionType>('MCQ');
  const [qMarkInput, setQMarkInput] = useState<number>(1);
  const [qAnswerKeysInput, setQAnswerKeysInput] = useState<string>('');
  const [qAllowAiEval, setQAllowAiEval] = useState<boolean>(true);
  const [bulkQuestionPasteText, setBulkQuestionPasteText] = useState<string>('');
  const [previewedBulkQuestions, setPreviewedBulkQuestions] = useState<Question[]>([]);
  const [expandedAiExplanations, setExpandedAiExplanations] = useState<Record<string, boolean>>({});

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Subject Combinations (Categories) derived from settings
  const subjectCombinations: SubjectCombinationConfig[] = useMemo(() => {
    return settings.subjectCombinations && settings.subjectCombinations.length > 0
      ? settings.subjectCombinations
      : DEFAULT_SUBJECT_COMBINATIONS;
  }, [settings.subjectCombinations]);

  // All available subjects across Question Bank, Pooling, and Combinations
  const allAvailableSubjects = useMemo(() => {
    const set = new Set<string>(subjectsList);
    questions.forEach((q) => {
      if (q.subject) set.add(q.subject);
    });
    (settings.subjectPooling || []).forEach((sp) => {
      if (sp.subject) set.add(sp.subject);
    });
    subjectCombinations.forEach((c) => {
      c.subjects.forEach((s) => set.add(s));
    });
    return Array.from(set);
  }, [subjectsList, questions, settings.subjectPooling, subjectCombinations]);

  // State for Adding / Editing a Subject Combination (Category)
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [comboNameInput, setComboNameInput] = useState<string>('');
  const [comboSubjectsInput, setComboSubjectsInput] = useState<string[]>([
    'English',
    'Biology',
    'Physics',
    'Chemistry',
  ]);
  const [customSubjectDraft, setCustomSubjectDraft] = useState<string>('');

  const handleToggleComboSubjectDraft = (subj: string) => {
    setComboSubjectsInput((prev) =>
      prev.some((s) => s.trim().toLowerCase() === subj.trim().toLowerCase())
        ? prev.filter((s) => s.trim().toLowerCase() !== subj.trim().toLowerCase())
        : [...prev, subj]
    );
  };

  const handleAddCustomSubjectToDraft = () => {
    const clean = customSubjectDraft.trim();
    if (!clean) return;
    if (!subjectsList.some((s) => s.toLowerCase() === clean.toLowerCase())) {
      setSubjectsList((prev) => [...prev, clean]);
    }
    setComboSubjectsInput((prev) =>
      prev.some((s) => s.trim().toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, clean]
    );
    setCustomSubjectDraft('');
  };

  const syncSettingsWithUpdatedCombos = (
    updatedCombos: SubjectCombinationConfig[],
    oldCategoryName?: string,
    newCategoryName?: string
  ) => {
    const allComboSubjects = new Set<string>();
    updatedCombos.forEach((c) => c.subjects.forEach((s) => allComboSubjects.add(s)));

    const existingPooling = [...(settings.subjectPooling || [])];
    allComboSubjects.forEach((subj) => {
      if (
        !existingPooling.some(
          (sp) => sp.subject.trim().toLowerCase() === subj.trim().toLowerCase()
        )
      ) {
        existingPooling.push({
          subject: subj,
          subjectTotal: 15,
          expanded: false,
          banks: [],
        });
      }
    });

    const updatedTests = (settings.publishedTests || []).map((pt) => {
      const nextCat =
        oldCategoryName &&
        newCategoryName &&
        pt.category.trim().toLowerCase() === oldCategoryName.trim().toLowerCase()
          ? newCategoryName
          : pt.category;

      const targetCombo = updatedCombos.find(
        (c) => c.name.trim().toLowerCase() === nextCat.trim().toLowerCase()
      );
      const relevantSubjects = targetCombo
        ? targetCombo.subjects
        : Array.from(allComboSubjects);

      const nextAllocations = { ...(pt.subjectAllocations || {}) };
      relevantSubjects.forEach((subj) => {
        if (
          !Object.keys(nextAllocations).some(
            (a) => a.trim().toLowerCase() === subj.trim().toLowerCase()
          )
        ) {
          const poolCfg = existingPooling.find(
            (sp) => sp.subject.trim().toLowerCase() === subj.trim().toLowerCase()
          );
          nextAllocations[subj] = poolCfg?.subjectTotal || 15;
        }
      });

      return {
        ...pt,
        category: nextCat,
        subjectAllocations: nextAllocations,
      };
    });

    onUpdateSettings({
      ...settings,
      subjectCombinations: updatedCombos,
      subjectPooling: existingPooling,
      publishedTests: updatedTests,
    });
  };

  const handleStartEditCombination = (combo: SubjectCombinationConfig) => {
    setEditingComboId(combo.id);
    setComboNameInput(combo.name);
    setComboSubjectsInput([...combo.subjects]);
  };

  const handleCancelEditCombination = () => {
    setEditingComboId(null);
    setComboNameInput('');
    setComboSubjectsInput(['English']);
  };

  const handleSaveSubjectCombination = () => {
    const cleanName = comboNameInput.trim();
    if (!cleanName) {
      triggerToast('Please enter a Subject Combination Name (Category).');
      return;
    }
    if (comboSubjectsInput.length === 0) {
      triggerToast('Please pick at least one subject for this Subject Combination.');
      return;
    }

    if (editingComboId) {
      const oldCombo = subjectCombinations.find((c) => c.id === editingComboId);
      const updatedCombos = subjectCombinations.map((c) =>
        c.id === editingComboId
          ? { ...c, name: cleanName, subjects: [...comboSubjectsInput] }
          : c
      );

      if (oldCombo && oldCombo.name.trim().toLowerCase() !== cleanName.toLowerCase()) {
        candidates.forEach((cand) => {
          if (cand.category.trim().toLowerCase() === oldCombo.name.trim().toLowerCase()) {
            onUpdateCandidate({ ...cand, category: cleanName });
          }
        });
        results.forEach((res) => {
          if (res.category.trim().toLowerCase() === oldCombo.name.trim().toLowerCase()) {
            onUpdateResult({ ...res, category: cleanName });
          }
        });
      }

      syncSettingsWithUpdatedCombos(updatedCombos, oldCombo?.name, cleanName);
      triggerToast(
        `Updated Subject Combination "${cleanName}" (${comboSubjectsInput.join(', ')}).`
      );
    } else {
      const existingIdx = subjectCombinations.findIndex(
        (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
      );
      let updatedCombos: SubjectCombinationConfig[];
      if (existingIdx >= 0) {
        updatedCombos = subjectCombinations.map((c, idx) =>
          idx === existingIdx
            ? { ...c, name: cleanName, subjects: [...comboSubjectsInput] }
            : c
        );
      } else {
        updatedCombos = [
          ...subjectCombinations,
          {
            id: `combo-${Date.now()}`,
            name: cleanName,
            subjects: [...comboSubjectsInput],
          },
        ];
      }
      syncSettingsWithUpdatedCombos(updatedCombos);
      triggerToast(
        `Saved Subject Combination "${cleanName}" with subjects: ${comboSubjectsInput.join(', ')}.`
      );
    }

    setEditingComboId(null);
    setComboNameInput('');
    setComboSubjectsInput(['English']);
  };

  const handleToggleSubjectOnExistingCombo = (comboId: string, subj: string) => {
    let targetName = '';
    let updatedSubjectsForCombo: string[] = [];
    let blockedEmpty = false;

    const updatedCombos = subjectCombinations.map((c) => {
      if (c.id !== comboId) return c;
      targetName = c.name;
      const hasSubj = c.subjects.some(
        (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
      );
      const nextSubjs = hasSubj
        ? c.subjects.filter((s) => s.trim().toLowerCase() !== subj.trim().toLowerCase())
        : [...c.subjects, subj];
      if (nextSubjs.length === 0) {
        blockedEmpty = true;
        updatedSubjectsForCombo = c.subjects;
        return c;
      }
      updatedSubjectsForCombo = nextSubjs;
      return { ...c, subjects: nextSubjs };
    });

    if (blockedEmpty) {
      triggerToast('A Subject Combination must have at least 1 subject.');
      return;
    }

    if (editingComboId === comboId && updatedSubjectsForCombo.length > 0) {
      setComboSubjectsInput(updatedSubjectsForCombo);
    }

    syncSettingsWithUpdatedCombos(updatedCombos);
    if (targetName) {
      triggerToast(
        `Updated "${targetName}" subjects: ${updatedSubjectsForCombo.join(', ')}`
      );
    }
  };

  const handleDeleteSubjectCombination = (comboId: string) => {
    if (subjectCombinations.length <= 1) return;
    const target = subjectCombinations.find((c) => c.id === comboId);
    const updatedCombos = subjectCombinations.filter((c) => c.id !== comboId);
    if (editingComboId === comboId) {
      handleCancelEditCombination();
    }
    syncSettingsWithUpdatedCombos(updatedCombos);
    if (target) {
      triggerToast(`Removed Subject Combination "${target.name}".`);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Normalize category string to Science, Art, or Commercial
  const normalizeBulkCategory = (rawCat: string): CategoryType => {
    const clean = (rawCat || '').trim().toLowerCase();
    if (clean === 'art' || clean === 'arts') return 'Art';
    if (clean === 'commercial') return 'Commercial';
    if (clean === 'science' || clean === 'sciences' || clean === 'medical' || clean === 'engineering') {
      return 'Science';
    }
    return rawCat.trim() || 'Science';
  };

  // TASK 2: Parse pasted text into Candidate objects (Exact 6-column format + Key-Value block support + Auto-assign Exam Center)
  const parseCandidateBlocks = (
    raw: string,
    mutateCentersClone?: ExamCenter[]
  ): Candidate[] => {
    const centersPool = mutateCentersClone
      ? mutateCentersClone
      : examCenters.map((ec) => ({ ...ec }));

    const pickNextAvailableCenter = (): { id?: string; name?: string } => {
      const avail = centersPool.find((ec) => ec.currentCount < ec.maxCapacity);
      if (!avail) return {};
      avail.currentCount += 1;
      return { id: avail.id, name: avail.name };
    };

    const trimmedRaw = raw.trim();
    if (!trimmedRaw) return [];

    // Check if the user pasted 6-column rows (delimited by |, tab, or semicolon)
    const nonEmptyLines = trimmedRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const isPipeOrTabFormat = nonEmptyLines.some(
      (line) => line.includes('|') || line.includes('\t') || line.includes(';')
    );

    if (isPipeOrTabFormat) {
      const workingCands = [...candidates];
      return nonEmptyLines.map((line, idx) => {
        const delimiter = line.includes('|')
          ? '|'
          : line.includes('\t')
          ? '\t'
          : ';';
        const cols = line.split(delimiter).map((c) => c.trim());
        const fName = cols[0] || `Candidate${idx + 1}`;
        const rawMid = cols[1] || '';
        const mName = rawMid === '-' ? '' : rawMid;
        const sName = cols[2] || `Student${idx + 1}`;
        const subjComb = cols[3] || 'English, Mathematics, Biology, Chemistry';
        const course = cols[4] || 'General Studies';
        const catVal = normalizeBulkCategory(cols[5] || 'Science');

        const assignedZone = pickNextAvailableCenter();
        const generatedReg = generateUniqueQmtRegNumber(workingCands);

        const newCand: Candidate = {
          id: `cand-bulk-${Date.now()}-${idx}`,
          firstName: fName,
          middleName: mName,
          surname: sName,
          gender: 'Female',
          subjectCombination: subjComb,
          courseOfStudy: course,
          category: catVal,
          examCenterId: assignedZone.id,
          examCenterName: assignedZone.name,
          regNumber: generatedReg,
          pin: `QMT-${Math.floor(100000 + Math.random() * 900000)}`,
          paymentStatus: 'Paid',
          paymentMethod: 'Admin Upload',
          amountPaid: settings.registrationFee,
          transactionRef: `ADM-UPL-${Date.now().toString().slice(-5)}`,
          suspended: false,
          examAssigned: true,
          examDate: settings.defaultExamDate,
          examTime: settings.defaultExamTime,
          createdAt: new Date().toISOString(),
        };
        workingCands.push(newCand);
        return newCand;
      });
    }

    // Also support blocks separated by a blank line (either 6 plain lines per block OR Key: Value lines)
    const blocks = trimmedRaw
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    const workingCands = [...candidates];
    return blocks.map((block, idx) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const hasColons = lines.some((l) => l.includes(':'));

      let fName = 'Candidate';
      let mName = '';
      let sName = `User${idx + 1}`;
      let subjComb = 'English, Mathematics, Biology, Chemistry';
      let course = '';
      let catVal: CategoryType = 'Science';
      let genderVal: GenderType = 'Female';
      let reg = '';

      if (!hasColons && lines.length >= 3) {
        // 6-line positional block: 1. First Name, 2. Middle Name, 3. Surname, 4. Subject Combination, 5. Course, 6. Category
        fName = lines[0] || 'Candidate';
        mName = lines[1] === '-' ? '' : lines[1] || '';
        sName = lines[2] || `User${idx + 1}`;
        subjComb = lines[3] || 'English, Mathematics, Biology, Chemistry';
        course = lines[4] || '';
        catVal = normalizeBulkCategory(lines[5] || 'Science');
      } else {
        const map: Record<string, string> = {};
        lines.forEach((line) => {
          const [k, ...rest] = line.split(':');
          if (k && rest.length > 0) {
            map[k.trim().toLowerCase()] = rest.join(':').trim();
          }
        });
        fName = map['first name'] || 'Candidate';
        const rawM = map['middle name'] || '';
        mName = rawM === '-' ? '' : rawM;
        sName = map['surname'] || `User${idx + 1}`;
        subjComb =
          map['subject combination'] ||
          map['subjects'] ||
          'English, Mathematics, Biology, Chemistry';
        course = map['course'] || map['course of study'] || '';
        catVal = normalizeBulkCategory(map['category'] || 'Science');
        const rawGender = (map['gender'] || 'Female').toLowerCase();
        genderVal = rawGender.startsWith('m') ? 'Male' : 'Female';
        reg = map['registration number'] || '';
      }

      const assignedZone = pickNextAvailableCenter();
      const finalReg = reg || generateUniqueQmtRegNumber(workingCands);

      const newCand: Candidate = {
        id: `cand-bulk-${Date.now()}-${idx}`,
        firstName: fName,
        middleName: mName,
        surname: sName,
        gender: genderVal,
        subjectCombination: subjComb,
        courseOfStudy: course,
        category: catVal,
        examCenterId: assignedZone.id,
        examCenterName: assignedZone.name,
        regNumber: finalReg,
        pin: `QMT-${Math.floor(100000 + Math.random() * 900000)}`,
        paymentStatus: 'Paid',
        paymentMethod: 'Admin Upload',
        amountPaid: settings.registrationFee,
        transactionRef: `ADM-UPL-${Date.now().toString().slice(-5)}`,
        suspended: false,
        examAssigned: true,
        examDate: settings.defaultExamDate,
        examTime: settings.defaultExamTime,
        createdAt: new Date().toISOString(),
      };
      workingCands.push(newCand);
      return newCand;
    });
  };

  const handlePreviewCandidates = () => {
    const parsed = parseCandidateBlocks(pasteText);
    setPreviewedCandidates(parsed);
  };

  const handleSaveAllPasted = () => {
    const updatedCenters = examCenters.map((ec) => ({ ...ec }));
    const toSave = parseCandidateBlocks(pasteText, updatedCenters);
    if (toSave.length === 0) return;
    onAddCandidatesBulk(toSave);
    onUpdateSettings({
      ...settings,
      examCenters: updatedCenters,
    });
    setPreviewedCandidates([]);
    triggerToast(
      `Saved ${toSave.length} bulk-pasted candidate(s) and auto-assigned to available Exam Centers / Q-Zones!`
    );
  };

  const isFreeRegistration = Boolean(
    settings.freeRegistration || settings.registrationFee === 0
  );
  const isRegNumberGenerationAllowed = Boolean(settings.allowRegNumberGeneration);

  const getOrGenerateQmtRegNumber = (cand: Candidate): string => {
    const existing = (cand.regNumber || '').trim().toUpperCase();
    if (existing.startsWith('QMT')) {
      return existing;
    }
    return generateUniqueQmtRegNumber(candidates);
  };

  // ADMIN FLOW Step 1: Confirm Payment / Approve Registration & Generate Unique QMT Registration Number
  const handleConfirmPayment = (cand: Candidate) => {
    const generatedReg = getOrGenerateQmtRegNumber(cand);
    const isCandFree =
      isFreeRegistration ||
      !isRegNumberGenerationAllowed ||
      cand.paymentMethod === 'Free Registration' ||
      cand.amountPaid === 0;
    const updated: Candidate = {
      ...cand,
      regNumber: generatedReg,
      paymentStatus: 'Paid',
      examAssigned: true,
    };
    onUpdateCandidate(
      updated,
      isCandFree ? 'Candidate Registration Approved & QMT Reg No Generated' : 'Payment Confirmed & QMT Reg No Generated',
      isCandFree
        ? `Admin approved registration for ${cand.firstName} ${cand.surname} (${cand.category}). Unique Registration Number ${generatedReg} has been generated and activated.`
        : `Admin confirmed payment of ₦${cand.amountPaid.toLocaleString()} for ${cand.firstName} ${cand.surname} (${cand.category}). Unique Registration Number ${generatedReg} generated.`
    );
    triggerToast(
      `Approved ${cand.firstName} ${cand.surname}! Generated unique Registration Number: ${generatedReg}`
    );
  };

  // ADMIN FLOW Step 2: Approve & Generate PIN (or Approve & Generate QMT Reg No)
  const handleGeneratePinForCandidate = (cand: Candidate) => {
    const isCandFree =
      isFreeRegistration ||
      !isRegNumberGenerationAllowed ||
      cand.paymentMethod === 'Free Registration' ||
      cand.amountPaid === 0;
    const generatedReg = getOrGenerateQmtRegNumber(cand);

    if (isCandFree) {
      const updated: Candidate = {
        ...cand,
        paymentStatus: 'Paid',
        pin: '',
        regNumber: generatedReg,
        examAssigned: true,
      };
      onUpdateCandidate(
        updated,
        'Registration Approved & QMT Reg Number Generated',
        `Admin approved ${cand.firstName} ${cand.surname} (${cand.category}). Unique Registration Number ${generatedReg} generated and activated for Candidate Login.`
      );
      triggerToast(
        `Approved ${cand.firstName} ${cand.surname}! Generated unique Registration Number: ${generatedReg}`
      );
      return;
    }

    const generatedPin = `QMT-${Math.floor(100000 + Math.random() * 900000)}`;
    const updated: Candidate = {
      ...cand,
      paymentStatus: 'Paid',
      pin: generatedPin,
      regNumber: generatedReg,
      examAssigned: true,
    };
    onUpdateCandidate(
      updated,
      'GREEN BOX PIN & QMT Reg Number Generated by Admin',
      `Unique Registration Number ${generatedReg} and PIN ${generatedPin} generated for ${cand.firstName} ${cand.surname}.`
    );
    triggerToast(
      `Generated Registration Number ${generatedReg} & PIN ${generatedPin} for ${cand.firstName} ${cand.surname}!`
    );
  };

  // Bulk Approve Candidates (Selected or All Pending/Unapproved)
  const handleBulkApproveCandidates = (targetIds?: string[]) => {
    const candidatesToApprove = sortCandidatesAlphabeticallyByFirstName(
      targetIds && targetIds.length > 0
        ? candidates.filter((c) => targetIds.includes(c.id))
        : candidates.filter(
            (c) =>
              c.paymentStatus !== 'Paid' ||
              !c.regNumber ||
              !c.regNumber.trim().toUpperCase().startsWith('QMT')
          )
    );

    if (candidatesToApprove.length === 0) {
      triggerToast('All candidates are already approved with QMT Registration Numbers.');
      return;
    }

    const workingCandidates = [...candidates];
    const approvedList: Candidate[] = [];

    candidatesToApprove.forEach((cand) => {
      const existingReg = (cand.regNumber || '').trim().toUpperCase();
      const generatedReg = existingReg.startsWith('QMT')
        ? existingReg
        : generateUniqueQmtRegNumber(workingCandidates);

      const isCandFree =
        isFreeRegistration ||
        !isRegNumberGenerationAllowed ||
        cand.paymentMethod === 'Free Registration' ||
        cand.amountPaid === 0;

      const generatedPin = isCandFree
        ? cand.pin || ''
        : cand.pin || `QMT-${Math.floor(100000 + Math.random() * 900000)}`;

      const updatedCand: Candidate = {
        ...cand,
        regNumber: generatedReg,
        paymentStatus: 'Paid',
        pin: generatedPin,
        examAssigned: true,
      };

      const idx = workingCandidates.findIndex((item) => item.id === cand.id);
      if (idx !== -1) {
        workingCandidates[idx] = updatedCand;
      } else {
        workingCandidates.push(updatedCand);
      }

      approvedList.push(updatedCand);
    });

    approvedList.forEach((updatedCand, index) => {
      const isLast = index === approvedList.length - 1;
      onUpdateCandidate(
        updatedCand,
        isLast ? `Bulk Approved ${approvedList.length} Candidate(s)` : undefined,
        isLast
          ? `Admin bulk-approved ${approvedList.length} candidate(s) and generated unique QMT Registration Numbers: ${approvedList
              .map((c) => `${c.firstName} ${c.surname} (${c.regNumber})`)
              .join(', ')}.`
          : undefined
      );
    });

    setSelectedIds([]);
    const sampleRegs = approvedList
      .slice(0, 3)
      .map((c) => c.regNumber)
      .join(', ');
    triggerToast(
      `Bulk approved ${approvedList.length} candidate(s)! Generated QMT Reg Numbers: ${sampleRegs}${
        approvedList.length > 3 ? ` (+${approvedList.length - 3} more)` : ''
      }`
    );
  };

  const handleCopyBulkCandidatesText = (listToExport: Candidate[] = candidates) => {
    const text = formatBulkCandidatesAsText(listToExport);
    navigator.clipboard.writeText(text);
    setCopiedId('bulk-candidates-text');
    setTimeout(() => setCopiedId(null), 2500);
    triggerToast(
      `Copied ${listToExport.length} candidate(s) in alphabetical order (by First Name) to clipboard!`
    );
  };

  const handleDownloadCandidatesPdf = (listToExport: Candidate[] = candidates) => {
    downloadRegisteredCandidatesPdf(listToExport, settings);
    triggerToast(
      `Downloaded PDF for ${listToExport.length} candidate(s) arranged alphabetically by First Name!`
    );
  };

  // Candidates sorted alphabetically by First Name
  const sortedAllCandidates = useMemo(() => {
    return sortCandidatesAlphabeticallyByFirstName(candidates);
  }, [candidates]);

  // Filtered candidates (arranged in alphabetical order based on candidates' First Name)
  const filteredCandidates = useMemo(() => {
    const filtered = candidates.filter((c) => {
      const fullName = `${c.firstName} ${c.middleName} ${c.surname}`.toLowerCase();
      const matchesSearch =
        !searchQuery.trim() ||
        fullName.includes(searchQuery.toLowerCase()) ||
        c.regNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.pin.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === 'All' ||
        (statusFilter === 'Paid' && c.paymentStatus === 'Paid') ||
        (statusFilter === 'Pending' && c.paymentStatus === 'Pending') ||
        (statusFilter === 'Suspended' && c.suspended);

      const matchesCategory = categoryFilter === 'All' || c.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
    return sortCandidatesAlphabeticallyByFirstName(filtered);
  }, [candidates, searchQuery, statusFilter, categoryFilter]);

  const pendingCount = candidates.filter((c) => c.paymentStatus === 'Pending').length;
  const paidCount = candidates.filter((c) => c.paymentStatus === 'Paid').length;
  const unapprovedCount = candidates.filter(
    (c) =>
      c.paymentStatus !== 'Paid' ||
      !c.regNumber ||
      !c.regNumber.trim().toUpperCase().startsWith('QMT')
  ).length;
  const unreadNotifs = notifications.filter((n) => !n.read).length;

  const subjectVolumes = useMemo(() => {
    const counts: Record<string, number> = {};
    questions.forEach((q) => {
      counts[q.subject] = (counts[q.subject] || 0) + 1;
    });
    return counts;
  }, [questions]);

  const toggleSelectCandidate = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredCandidates.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCandidates.map((c) => c.id));
    }
  };

  const handleBulkSuspend = (suspendState: boolean) => {
    candidates.forEach((c) => {
      if (selectedIds.includes(c.id)) {
        onUpdateCandidate({ ...c, suspended: suspendState });
      }
    });
    setSelectedIds([]);
  };

  // Results Ranking states & helpers
  const [resultsCategoryFilter, setResultsCategoryFilter] = useState<string>('All');
  const [showCopyTextBox, setShowCopyTextBox] = useState<boolean>(false);
  const [showPdfPreviewModal, setShowPdfPreviewModal] = useState<boolean>(false);
  const [copiedRankingToast, setCopiedRankingToast] = useState<boolean>(false);

  // Sort results in strict ranking order (highest aggregate score first, then percentage)
  const rankedResults = useMemo(() => {
    const filtered = results.filter(
      (r) => resultsCategoryFilter === 'All' || r.category === resultsCategoryFilter
    );
    return [...filtered].sort(
      (a, b) => b.score - a.score || b.percentage - a.percentage
    );
  }, [results, resultsCategoryFilter]);

  // Helper to format subject scores as two top, two down:
  // Line 1: Physics: 99  •  Chemistry: 99
  // Line 2: Biology: 90  •  English: 90
  const formatSubjectScoresTwoByTwo = (
    breakdown: Record<string, { score: number }>,
    separator = '  •  '
  ): string[] => {
    const entries = Object.entries(breakdown).map(
      ([subj, st]) => `${subj}: ${st.score}`
    );
    const lines: string[] = [];
    for (let i = 0; i < entries.length; i += 2) {
      lines.push(entries.slice(i, i + 2).join(separator));
    }
    return lines;
  };

  // Format ranked results as clean plain text for copying (no /xx or Cap mentions)
  const formattedRankedText = useMemo(() => {
    const titleBrand = settings.resultTitles?.testTitle || 'Quemint';
    const titleSub = settings.resultTitles?.testSubtitle || 'Rapid Test';
    const assessSub =
      settings.resultTitles?.assessmentSubtitle ||
      'Quemint Education Board Assessment';

    const headerLines = [
      '====================================================================',
      `                 QUEMINT EDUCATION BOARD`,
      `           ${titleBrand.toUpperCase()} ${titleSub.toUpperCase()} — OFFICIAL RANKING`,
      `             ${assessSub}`,
      `Generated: ${new Date().toLocaleString()} | Category: ${resultsCategoryFilter}`,
      '====================================================================',
      '',
    ];

    const bodyLines = rankedResults.map((r, idx) => {
      const rankNum = idx + 1;
      const gradeInfo = getQuemintGradeInfo(r.percentage);
      const twoByTwoLines = formatSubjectScoresTwoByTwo(
        r.subjectBreakdown,
        '  •  '
      ).map((line) => `    ${line}`);

      return [
        `#${rankNum}. ${r.candidateName.toUpperCase()} (${r.regNumber}) — ${r.category}`,
        ...twoByTwoLines,
        `    Aggregate: ${r.score}  •  Percentage: ${r.percentage}%  •  ${gradeInfo.displayFull}`,
      ].join('\n');
    });

    return [...headerLines, ...bodyLines.join('\n\n').split('\n')].join('\n');
  }, [rankedResults, settings.resultTitles, resultsCategoryFilter]);

  const handleCopyRankedResultsText = () => {
    navigator.clipboard.writeText(formattedRankedText);
    setCopiedRankingToast(true);
    setTimeout(() => setCopiedRankingToast(false), 3000);
  };

  // Generate & download a well-designed Official Quemint Education Board Ranked Results PDF
  const handleExportRankedResultsPdf = () => {
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'pt',
      format: 'a4',
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // 1. Top Quemint Green Banner (#0a6b3c)
    doc.setFillColor(10, 107, 60);
    doc.rect(0, 0, pageWidth, 92, 'F');

    // Accent Secondary Green Bottom Strip on Header (#0e8a4e)
    doc.setFillColor(14, 138, 78);
    doc.rect(0, 88, pageWidth, 4, 'F');

    // Official Circular Seal Emblem on Left
    drawOfficialSeal(doc, 54, 45, 24);

    // Official Header Titles
    const titleBrand = settings.resultTitles?.testTitle || 'Quemint';
    const titleSub = settings.resultTitles?.testSubtitle || 'Rapid Test';
    const assessSub =
      settings.resultTitles?.assessmentSubtitle ||
      'Quemint Education Board Assessment';

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('QUEMINT EDUCATION BOARD', 90, 36);

    doc.setFontSize(12);
    doc.text(
      `${titleBrand.toUpperCase()} ${titleSub.toUpperCase()} — OFFICIAL CANDIDATE RANKING SHEET`,
      90,
      55
    );

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(`${assessSub}  •  Category: ${resultsCategoryFilter}`, 90, 72);

    // Right-side Metadata in Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      `Date: ${new Date().toLocaleDateString()}`,
      pageWidth - 40,
      38,
      { align: 'right' }
    );
    doc.text(
      `Total Ranked: ${rankedResults.length} Candidate(s)`,
      pageWidth - 40,
      54,
      { align: 'right' }
    );
    doc.text('OFFICIAL VERIFIED RECORD', pageWidth - 40, 70, {
      align: 'right',
    });

    // 2. Summary KPI Strip Below Header
    const highestScore =
      rankedResults.length > 0 ? rankedResults[0].score : 0;
    const avgScore =
      rankedResults.length > 0
        ? Math.round(
            rankedResults.reduce((acc, r) => acc + r.score, 0) /
              rankedResults.length
          )
        : 0;
    const passCount = rankedResults.filter(
      (r) => r.percentage >= settings.passMarkPercent
    ).length;
    const passRate =
      rankedResults.length > 0
        ? Math.round((passCount / rankedResults.length) * 100)
        : 0;

    const kpis = [
      { label: 'CANDIDATES RANKED', value: String(rankedResults.length) },
      { label: 'TOP AGGREGATE SCORE', value: String(highestScore) },
      { label: 'AVERAGE AGGREGATE', value: String(avgScore) },
      { label: 'PASS RATE', value: `${passRate}% (${passCount} Passed)` },
    ];

    const boxWidth = (pageWidth - 80 - 36) / 4;
    kpis.forEach((kpi, idx) => {
      const x = 40 + idx * (boxWidth + 12);
      const y = 108;
      doc.setFillColor(244, 250, 246);
      doc.setDrawColor(10, 107, 60);
      doc.setLineWidth(0.8);
      doc.roundedRect(x, y, boxWidth, 44, 6, 6, 'FD');

      doc.setTextColor(10, 107, 60);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(kpi.label, x + 12, y + 16);

      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(kpi.value, x + 12, y + 34);
    });

    // 3. Ranked Results Table (Two top, two down subject scores, official Grade — Meaning, no /xx anywhere)
    const tableBody = rankedResults.map((r, idx) => {
      const gradeInfo = getQuemintGradeInfo(r.percentage);
      const subjectsFormatted = formatSubjectScoresTwoByTwo(
        r.subjectBreakdown,
        '   •   '
      ).join('\n');

      return [
        `#${idx + 1}`,
        r.candidateName,
        r.regNumber,
        r.category,
        subjectsFormatted,
        String(r.score),
        `${r.percentage}%`,
        `Grade ${gradeInfo.pdfGrade} — ${gradeInfo.label}`,
      ];
    });

    autoTable(doc, {
      startY: 168,
      margin: { left: 40, right: 40, bottom: 50 },
      head: [
        [
          'Rank',
          'Candidate Name',
          'Reg Number',
          'Category',
          'Subject Scores',
          'Aggregate',
          'Percentage',
          'Grade / Remark',
        ],
      ],
      body: tableBody,
      theme: 'grid',
      headStyles: {
        fillColor: [10, 107, 60],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9.5,
        halign: 'left',
        cellPadding: 8,
      },
      bodyStyles: {
        textColor: [0, 0, 0],
        fontSize: 9,
        cellPadding: 7,
        lineColor: [220, 230, 224],
        lineWidth: 0.5,
      },
      alternateRowStyles: {
        fillColor: [245, 251, 247],
      },
      columnStyles: {
        0: { fontStyle: 'bold', halign: 'center', cellWidth: 46, textColor: [10, 107, 60] },
        1: { fontStyle: 'bold', cellWidth: 135 },
        2: { fontStyle: 'bold', cellWidth: 82 },
        3: { cellWidth: 74 },
        4: { cellWidth: 'auto' },
        5: { fontStyle: 'bold', halign: 'center', cellWidth: 64, textColor: [10, 107, 60] },
        6: { fontStyle: 'bold', halign: 'center', cellWidth: 64 },
        7: { fontStyle: 'bold', halign: 'left', cellWidth: 120, textColor: [10, 107, 60] },
      },
      didDrawPage: (data) => {
        // Official Footer on every page
        doc.setDrawColor(10, 107, 60);
        doc.setLineWidth(0.75);
        doc.line(40, pageHeight - 36, pageWidth - 40, pageHeight - 36);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(10, 107, 60);
        doc.text(
          'Quemint Education Board — Official Examination Ranking Sheet',
          40,
          pageHeight - 20
        );

        doc.setFont('helvetica', 'normal');
        doc.setTextColor(90, 90, 90);
        doc.text(
          `Page ${data.pageNumber}`,
          pageWidth - 40,
          pageHeight - 20,
          { align: 'right' }
        );
      },
    });

    doc.save('Quemint_Official_Ranked_Results.pdf');
  };

  const handleExportResultsCsv = () => {
    const headers = [
      'Rank,Candidate Name,Registration Number,Category,Subject Scores,Aggregate Score,Percentage,Submitted At',
    ];
    const rows = rankedResults.map((r, idx) => {
      const subjScores = Object.entries(r.subjectBreakdown)
        .map(([subj, st]) => `${subj}: ${st.score}`)
        .join(' | ');
      return `${idx + 1},"${r.candidateName}","${r.regNumber}","${r.category}","${subjScores}",${r.score},${r.percentage}%,"${r.submittedAt}"`;
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'quemint_ranked_exam_results.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className={`min-h-screen transition-colors ${
        darkSurface ? 'bg-neutral-950 text-white' : 'bg-white text-black'
      }`}
    >
      {/* Top Control Center Bar (Matches Screenshots 2-5 with Green #0a6b3c Brand Rules) */}
      <header
        className={`sticky top-0 z-30 border-b px-4 md:px-8 py-4 flex flex-wrap items-center justify-between gap-4 ${
          darkSurface
            ? 'bg-neutral-900 border-neutral-800'
            : 'bg-white border-neutral-200'
        }`}
      >
        <div className="flex items-center gap-4">
          <QuemintSeal size="sm" variant="green" showText={false} />
          <div>
            <span className="block text-[11px] font-extrabold uppercase tracking-widest text-[#0a6b3c]">
              CONTROL CENTER
            </span>
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight">
              {activeTab === 'Settings / Create Exam'
                ? 'Exam Creation & Settings'
                : activeTab === 'Exam Centers'
                ? 'Examination Centre'
                : activeTab}
            </h1>
          </div>
        </div>

        {/* Right Controls: Proctoring ON/OFF, Return to Candidate View, Dark Mode, Logout */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onReturnToCandidatePortal}
            className="px-3.5 py-2 rounded-lg border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c] hover:text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Candidate / GREEN BOX View</span>
          </button>

          {/* Camera Access Required / Proctoring Toggle Pill */}
          <div className="flex items-center gap-1 p-1 rounded-full bg-neutral-100 border border-neutral-200 text-xs font-bold">
            <Video className="w-3.5 h-3.5 text-[#0a6b3c] ml-2 mr-1" />
            <span className="hidden sm:inline text-[10px] font-extrabold uppercase text-neutral-700 mr-1">
              Camera Required:
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  proctoringEnabled: true,
                  publishedTests: (settings.publishedTests || []).map((pt) => ({
                    ...pt,
                    requireCamera: true,
                  })),
                })
              }
              className={`px-3 py-1 rounded-full text-[11px] font-extrabold transition-colors cursor-pointer ${
                settings.proctoringEnabled
                  ? 'bg-[#0a6b3c] text-white'
                  : 'text-neutral-600'
              }`}
            >
              ON
            </button>
            <button
              type="button"
              onClick={() =>
                onUpdateSettings({
                  ...settings,
                  proctoringEnabled: false,
                  publishedTests: (settings.publishedTests || []).map((pt) => ({
                    ...pt,
                    requireCamera: false,
                  })),
                })
              }
              className={`px-3 py-1 rounded-full text-[11px] font-extrabold transition-colors cursor-pointer ${
                !settings.proctoringEnabled
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-600'
              }`}
            >
              OFF
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDarkSurface(!darkSurface)}
            className="p-2.5 rounded-full border border-neutral-200 hover:border-[#0a6b3c] text-neutral-700 cursor-pointer"
            title="Toggle Surface Contrast"
          >
            {darkSurface ? (
              <Sun className="w-4 h-4 text-white" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onLogoutAdmin}
            className="p-2.5 rounded-full border border-neutral-200 hover:border-[#0a6b3c] text-neutral-700 cursor-pointer"
            title="Exit Admin Control Center"
          >
            <LogOut className={`w-4 h-4 ${darkSurface ? 'text-white' : 'text-black'}`} />
          </button>
        </div>
      </header>

      {/* Navigation Tabs Row (Active Tab = GREEN #0a6b3c) */}
      <nav
        className={`border-b px-4 md:px-8 py-3 flex items-center gap-2 overflow-x-auto ${
          darkSurface
            ? 'bg-neutral-900 border-neutral-800'
            : 'bg-white border-neutral-200'
        }`}
      >
        {(
          [
            { id: 'Overview', label: 'Overview', icon: BarChart3 },
            {
              id: 'Candidates',
              label: `Candidates (${candidates.length})`,
              icon: Users,
              badge: pendingCount > 0 ? `${pendingCount} Pending` : undefined,
            },
            {
              id: 'Exam Centers',
              label: `Examination Centre (${examCenters.length})`,
              icon: MapPin,
            },
            {
              id: 'Exam Schedule',
              label: `Exam Schedule${
                (settings.examSchedules || []).length > 0
                  ? ` (${(settings.examSchedules || []).length})`
                  : ''
              }`,
              icon: Calendar,
            },
            { id: 'Question bank', label: 'Question bank', icon: BookOpen },
            { id: 'Results', label: 'Results', icon: FileText },
            {
              id: 'Performance Analysis',
              label: 'Performance Analysis',
              icon: BarChart3,
            },
            { id: 'Analytics', label: 'Analytics', icon: BarChart3 },
            { id: 'Live Proctoring', label: 'Live Proctoring', icon: Video },
            { id: 'Settings / Create Exam', label: 'Settings / Create Exam', icon: Settings },
            {
              id: 'Notifications',
              label: 'Notifications',
              icon: Bell,
              badge: unreadNotifs > 0 ? String(unreadNotifs) : undefined,
            },
          ] as { id: AdminTab; label: string; icon: React.ElementType; badge?: string }[]
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'Notifications') onMarkNotificationsRead();
              }}
              className={`px-4 py-2 rounded-full text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : darkSurface
                  ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                  : 'bg-neutral-100 text-neutral-800 hover:bg-neutral-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                    isActive
                      ? 'bg-[#0e8a4e] text-white'
                      : 'bg-[#0a6b3c] text-white'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* TAB 1: OVERVIEW (Matches Screenshot 3 with Green #0a6b3c theme) */}
        {activeTab === 'Overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div
                onClick={() => setActiveTab('Candidates')}
                className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs hover:border-[#0a6b3c] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                    CANDIDATES
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
                <div className="font-mono text-4xl font-extrabold text-black tabular-nums">
                  {candidates.length}
                </div>
                <div className="text-xs text-[#0a6b3c] font-bold mt-3">
                  Manage registered examinees ({paidCount} Paid · {pendingCount} Pending) ↗
                </div>
              </div>

              <div
                onClick={() => setActiveTab('Question bank')}
                className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs hover:border-[#0a6b3c] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                    QUESTIONS
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                </div>
                <div className="font-mono text-4xl font-extrabold text-black tabular-nums">
                  {questions.length}
                </div>
                <div className="text-xs text-[#0a6b3c] font-bold mt-3">
                  Across {Object.keys(subjectVolumes).length} question banks ↗
                </div>
              </div>

              <div
                onClick={() => setActiveTab('Results')}
                className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs hover:border-[#0a6b3c] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                    RESULTS
                  </span>
                  <div className="w-10 h-10 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                </div>
                <div className="font-mono text-4xl font-extrabold text-black tabular-nums">
                  {results.length}
                </div>
                <div className="text-xs text-[#0a6b3c] font-bold mt-3">
                  View attempts & export ranking ↗
                </div>
              </div>
            </div>

            {/* Exam Status Card */}
            <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-black">
                    Exam Status: {settings.examOpen ? 'OPEN (Live)' : 'CLOSED'}
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    {settings.examOpen
                      ? 'Candidates are permitted to log in with their Registration Number and attempt tests.'
                      : 'Candidate login is currently locked until the board opens the session.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({ ...settings, examOpen: !settings.examOpen })
                }
                className={`px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider text-white transition-colors cursor-pointer shrink-0 ${
                  settings.examOpen
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                }`}
              >
                {settings.examOpen ? 'CLOSE EXAM NOW' : 'OPEN EXAM NOW'}
              </button>
            </div>

            {/* Pending Candidate Registrations Awaiting Admin Review & Approval */}
            {pendingCount > 0 && (
              <div className="p-6 rounded-2xl border-2 border-amber-400 bg-amber-50/60 text-black shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800">
                      AWAITING ADMIN REVIEW & APPROVAL ({pendingCount} PENDING)
                    </span>
                    <h3 className="text-base font-extrabold text-black">
                      Review Candidate Registration Details Before Approval
                    </h3>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      Inspect the bio-data, subject combination, passport photo, and payment proof filled by each candidate before approving.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleBulkApproveCandidates()}
                      className="px-4 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Bulk Approve All Pending ({pendingCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('Candidates')}
                      className="px-4 py-2 rounded-xl border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/10 text-[#0a6b3c] text-xs font-extrabold cursor-pointer"
                    >
                      Open Full Verification Queue ↗
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-amber-200/80 bg-white rounded-xl border border-amber-200 overflow-hidden">
                  {candidates
                    .filter((c) => c.paymentStatus === 'Pending')
                    .map((cand) => (
                      <div
                        key={cand.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-neutral-50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl border border-[#0a6b3c]/30 bg-white flex items-center justify-center overflow-hidden shrink-0">
                            {cand.passportDataUrl && !cand.passportDataUrl.startsWith('/proctoring/') ? (
                              <img
                                src={cand.passportDataUrl}
                                alt={`${cand.firstName} ${cand.surname}`}
                                className="w-full h-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div>
                            <div className="font-extrabold text-xs text-black flex flex-wrap items-center gap-2">
                              <span>
                                {cand.firstName} {cand.middleName} {cand.surname}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase">
                                {cand.category}
                              </span>
                              <span className="text-[11px] font-semibold text-neutral-500">
                                {cand.gender}
                              </span>
                            </div>
                            <div className="text-[11px] text-neutral-500 font-mono mt-0.5">
                              Reg No: {cand.regNumber || 'Pending'}{' '}
                              {isFreeRegistration || cand.paymentMethod === 'Free Registration'
                                ? '• Free Registration (Awaiting Admin Approval)'
                                : `• ${cand.paymentMethod} • Ref: ${cand.transactionRef}`}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setProfileCandidate(cand)}
                            className="px-3.5 py-2 rounded-lg border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] font-extrabold text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Filled Details</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleGeneratePinForCandidate(cand)}
                            className="px-3.5 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              {isFreeRegistration || cand.paymentMethod === 'Free Registration'
                                ? 'Approve Reg Number'
                                : 'Approve & Generate PIN'}
                            </span>
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Active Question Banks & Question Volumes */}
            <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-extrabold text-black">
                  Active Question Banks & Question Volumes
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveTab('Question bank')}
                  className="text-xs font-extrabold text-[#0a6b3c] hover:underline cursor-pointer"
                >
                  + Manage Question Banks
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Object.entries(subjectVolumes).map(([subj, count]) => (
                  <div
                    key={subj}
                    className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 flex flex-col justify-between"
                  >
                    <span className="text-xs font-bold text-black">{subj}</span>
                    <div className="flex items-baseline justify-between mt-3">
                      <span className="font-mono text-2xl font-extrabold text-[#0a6b3c] tabular-nums">
                        {count}
                      </span>
                      <span className="text-[11px] text-neutral-500">questions</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Psychometric Marking Regulations Active Summary Card */}
            <div className="p-6 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase">
                    {psychoConfig.enabled ? 'PSYCHOMETRIC ENGINE ACTIVE' : 'STANDARD MARKING'}
                  </span>
                  <h3 className="text-base font-extrabold text-black">
                    Quemint Psychometric Marking Regulations
                  </h3>
                </div>
                <p className="text-xs text-neutral-600">
                  <strong>{psychoConfig.failStreakPenalty} penalty</strong> on{' '}
                  <strong>{psychoConfig.failStreakCount} fails in a row</strong> ·{' '}
                  <strong>+{psychoConfig.passStreakBonus} bonus</strong> on{' '}
                  <strong>{psychoConfig.passStreakCount} passes in a row</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('Settings / Create Exam')}
                className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold whitespace-nowrap cursor-pointer shrink-0"
              >
                Regulate Marking Rules
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: CANDIDATES (Uploaded Candidates Dashboard + Payment Verification & PIN Generation) */}
        {activeTab === 'Candidates' && (
          <div className="space-y-8">
            {/* REGISTRATION OPEN / CLOSED QUICK CONTROL BAR */}
            <section className="p-5 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    (settings.registrationOpen ?? true)
                      ? 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                      : 'bg-red-100 text-red-600'
                  }`}
                >
                  {(settings.registrationOpen ?? true) ? (
                    <Unlock className="w-5 h-5" />
                  ) : (
                    <Lock className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                      Portal Registration Status:
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold uppercase ${
                        (settings.registrationOpen ?? true)
                          ? 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {(settings.registrationOpen ?? true)
                        ? 'REGISTRATION IS OPEN'
                        : 'REGISTRATION IS CLOSED'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 mt-1">
                    {(settings.registrationOpen ?? true)
                      ? 'Candidates clicking Register on the landing interface can currently register for the exam.'
                      : 'Registration is closed. When candidates click Register on the landing interface, it shows closed.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextRegOpen = !(settings.registrationOpen ?? true);
                  onUpdateSettings({ ...settings, registrationOpen: nextRegOpen });
                  triggerToast(
                    nextRegOpen
                      ? 'Candidate Registration is now OPEN!'
                      : 'Candidate Registration has been CLOSED.'
                  );
                }}
                className={`px-5 py-3 rounded-xl text-white text-xs font-extrabold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                  (settings.registrationOpen ?? true)
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                }`}
              >
                {(settings.registrationOpen ?? true)
                  ? 'Close Registration'
                  : 'Open Registration'}
              </button>
            </section>

            {/* FREE vs PAID REGISTRATION QUICK CONTROL BAR */}
            <section className="p-5 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                      Registration Fee Mode:
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold uppercase ${
                        isFreeRegistration
                          ? 'bg-[#0a6b3c] text-white'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}
                    >
                      {isFreeRegistration
                        ? 'FREE REGISTRATION (NO PAYMENT METHODS / NO PIN SHOWN)'
                        : `PAID REGISTRATION (₦${settings.registrationFee.toLocaleString()})`}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 mt-1">
                    {isFreeRegistration
                      ? 'Payment methods and PIN are hidden during student registration. Students fill their bio-data, generate their Registration Number, and require your approval below to log in.'
                      : 'Students see payment methods and GREEN BOX PIN during registration. Click "Make Registration Free" to hide payment methods and PIN.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextFree = !isFreeRegistration;
                  onUpdateSettings({
                    ...settings,
                    freeRegistration: nextFree,
                    registrationFee: nextFree
                      ? 0
                      : settings.registrationFee > 0
                      ? settings.registrationFee
                      : 5000,
                  });
                  triggerToast(
                    nextFree
                      ? 'Registration is now FREE! Payment methods and PIN are hidden on student registration.'
                      : 'Paid Registration mode restored.'
                  );
                }}
                className={`px-5 py-3 rounded-xl text-white text-xs font-extrabold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                  isFreeRegistration
                    ? 'bg-neutral-800 hover:bg-black'
                    : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                }`}
              >
                {isFreeRegistration
                  ? 'Switch to Paid Registration'
                  : 'Make Registration Free'}
              </button>
            </section>

            {/* ALLOW / DISALLOW CANDIDATE REGISTRATION NUMBER GENERATION QUICK CONTROL BAR */}
            <section className="p-5 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    isRegNumberGenerationAllowed
                      ? 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  <Hash className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                      Candidate Reg Number Generation:
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold uppercase ${
                        isRegNumberGenerationAllowed
                          ? 'bg-[#0a6b3c] text-white'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}
                    >
                      {isRegNumberGenerationAllowed
                        ? 'ALLOWED ON REGISTRATION PORTAL'
                        : 'DISALLOWED (GENERATED BY ADMIN ON APPROVAL)'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 mt-1">
                    {isRegNumberGenerationAllowed
                      ? 'Candidates can generate their Registration Number during registration. Click "Disallow Reg Number Generation" so candidates only fill their details and click Confirmed.'
                      : 'When disallowed: Candidates fill only their details and click Confirmed, see "your registration has been successfully submitted, you may leave", and return to the home page. A unique QMT Registration Number (e.g. QMT2027001AA) is generated here on the Admin Panel when you approve them.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextAllow = !isRegNumberGenerationAllowed;
                  onUpdateSettings({
                    ...settings,
                    allowRegNumberGeneration: nextAllow,
                  });
                  triggerToast(
                    nextAllow
                      ? 'Candidate Registration Number generation is now ALLOWED during registration.'
                      : 'Candidate Registration Number generation is now DISALLOWED. Candidates will fill only their details and click Confirmed.'
                  );
                }}
                className={`px-5 py-3 rounded-xl text-white text-xs font-extrabold uppercase tracking-wider transition-colors cursor-pointer shrink-0 ${
                  isRegNumberGenerationAllowed
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                }`}
              >
                {isRegNumberGenerationAllowed
                  ? 'Disallow Reg Number Generation'
                  : 'Allow Reg Number Generation'}
              </button>
            </section>

            {/* REQUIRE PHOTO CARD DURING REGISTRATION QUICK CONTROL BAR */}
            <section className="p-5 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    Boolean(settings.requirePhotoCardDuringRegistration)
                      ? 'bg-[#0a6b3c] text-white'
                      : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                      Require Photo Card During Registration:
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold uppercase ${
                        Boolean(settings.requirePhotoCardDuringRegistration)
                          ? 'bg-[#0a6b3c] text-white'
                          : 'bg-neutral-200 text-neutral-700'
                      }`}
                    >
                      {Boolean(settings.requirePhotoCardDuringRegistration)
                        ? 'ON (COMPULSORY LIVE CAMERA CAPTURE)'
                        : 'OFF (SKIPPED IN REGISTRATION • OPTIONAL ON DASHBOARD)'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 mt-1">
                    {Boolean(settings.requirePhotoCardDuringRegistration)
                      ? 'ON: Adds Live Photo Capture step in registration and blocks the registration submit button until a live camera photo (1 face detected in oval) is captured.'
                      : 'OFF (Default): Skips photo capture during registration so candidates can register immediately, and shows "Add your Photo Card (optional)" on their dashboard.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings.requirePhotoCardDuringRegistration)}
                onClick={() => {
                  const nextVal = !Boolean(settings.requirePhotoCardDuringRegistration);
                  onUpdateSettings({
                    ...settings,
                    requirePhotoCardDuringRegistration: nextVal,
                  });
                  triggerToast(
                    nextVal
                      ? 'Require Photo Card During Registration is now ON (Live Camera Capture required).'
                      : 'Require Photo Card During Registration is now OFF (Photo capture skipped in registration).'
                  );
                }}
                className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/5 transition-colors cursor-pointer shrink-0"
              >
                <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                  {Boolean(settings.requirePhotoCardDuringRegistration) ? 'ON' : 'OFF'}
                </span>
                <span
                  className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                    Boolean(settings.requirePhotoCardDuringRegistration)
                      ? 'bg-[#0a6b3c] justify-end'
                      : 'bg-neutral-300 justify-start'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                </span>
              </button>
            </section>

            {/* SECTION A: ADMIN CANDIDATE APPROVAL & VERIFICATION QUEUE */}
            <section className="p-6 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-neutral-200 pb-4">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    4. ADMIN FLOW — CANDIDATE REGISTRATION REVIEW, APPROVAL &amp; QMT REG NUMBER GENERATION
                  </span>
                  <h2 className="text-lg font-extrabold text-black">
                    Approve Candidate Registration &amp; Generate Unique QMT Registration Number (e.g. QMT2027001AA)
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Candidates are arranged in alphabetical order by First Name. Approving a candidate automatically generates a unique Registration Number starting with QMT (e.g. QMT2027001AA).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => handleBulkApproveCandidates(selectedIds)}
                    disabled={selectedIds.length === 0}
                    className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Selected ({selectedIds.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkApproveCandidates()}
                    disabled={unapprovedCount === 0}
                    className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Bulk Approve All Pending ({unapprovedCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopyBulkCandidatesText(candidates)}
                    className="px-3.5 py-2 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/10 font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedId === 'bulk-candidates-text' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied Bulk Text (A–Z)!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Bulk Candidates (Text)</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadCandidatesPdf(candidates)}
                    className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Candidates (PDF)</span>
                  </button>
                  <span className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white">
                    Approved: {paidCount}
                  </span>
                  <span className="px-3 py-1.5 rounded-lg bg-amber-100 text-amber-900 border border-amber-300">
                    Pending Approval: {pendingCount}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 text-[11px] font-extrabold uppercase text-neutral-500">
                      <th className="py-3 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={
                            sortedAllCandidates.length > 0 &&
                            selectedIds.length === sortedAllCandidates.length
                          }
                          onChange={() => {
                            if (selectedIds.length === sortedAllCandidates.length) {
                              setSelectedIds([]);
                            } else {
                              setSelectedIds(sortedAllCandidates.map((c) => c.id));
                            }
                          }}
                          className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                          title="Select all candidates for bulk approval"
                        />
                      </th>
                      <th className="py-3 px-3">Candidate Bio-Data (A–Z by First Name)</th>
                      <th className="py-3 px-3">Category &amp; Subjects</th>
                      <th className="py-3 px-3">QMT Registration Number</th>
                      {!isFreeRegistration && isRegNumberGenerationAllowed && (
                        <th className="py-3 px-3">Payment Method &amp; Proof</th>
                      )}
                      <th className="py-3 px-3">Approval Status</th>
                      {!isFreeRegistration && isRegNumberGenerationAllowed && (
                        <th className="py-3 px-3">GREEN BOX PIN</th>
                      )}
                      <th className="py-3 px-3 text-right">Review &amp; Approval Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 text-xs">
                    {sortedAllCandidates.map((cand) => {
                      const isCandPaid = cand.paymentStatus === 'Paid';
                      const isCandFree =
                        isFreeRegistration ||
                        !isRegNumberGenerationAllowed ||
                        cand.paymentMethod === 'Free Registration' ||
                        cand.amountPaid === 0;
                      const matchedCombo = subjectCombinations.find(
                        (sc) => sc.name.trim().toLowerCase() === cand.category.trim().toLowerCase()
                      );
                      const customSubjects = cand.subjectCombination
                        ? cand.subjectCombination
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : [];
                      const comboSubjects =
                        customSubjects.length > 0
                          ? customSubjects
                          : matchedCombo
                          ? matchedCombo.subjects
                          : [];
                      return (
                        <tr key={cand.id} className="hover:bg-neutral-50">
                          <td className="py-3.5 px-3">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(cand.id)}
                              onChange={() => toggleSelectCandidate(cand.id)}
                              className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => setProfileCandidate(cand)}
                                className="w-9 h-9 rounded-lg border border-[#0a6b3c]/30 bg-white flex items-center justify-center overflow-hidden shrink-0 cursor-pointer"
                                title="Click to view candidate registration details"
                              >
                                {cand.passportDataUrl && !cand.passportDataUrl.startsWith('/proctoring/') ? (
                                  <img
                                    src={cand.passportDataUrl}
                                    alt={`${cand.firstName} ${cand.surname}`}
                                    className="w-full h-full object-cover"
                                  />
                                ) : null}
                              </button>
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setProfileCandidate(cand)}
                                  className="font-extrabold text-black hover:text-[#0a6b3c] hover:underline text-left cursor-pointer"
                                >
                                  {cand.firstName} {cand.middleName} {cand.surname}
                                </button>
                                <div className="text-[11px] text-neutral-500 flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-neutral-700">{cand.gender}</span>
                                  {cand.courseOfStudy && (
                                    <span className="text-[#0a6b3c] font-bold">
                                      • {cand.courseOfStudy}
                                    </span>
                                  )}
                                  {cand.examCenterName && (
                                    <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-bold text-[10px]">
                                      {cand.examCenterName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            <select
                              value={
                                subjectCombinations.find(
                                  (c) =>
                                    c.name.trim().toLowerCase() ===
                                    (cand.category || '').trim().toLowerCase()
                                )?.name || cand.category
                              }
                              onChange={(e) => {
                                const newCat = e.target.value;
                                onUpdateCandidate({ ...cand, category: newCat });
                                triggerToast(
                                  `Updated ${cand.firstName} ${cand.surname}'s Category to "${newCat}".`
                                );
                              }}
                              className="px-2.5 py-1 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase cursor-pointer border border-[#0a6b3c] focus:outline-none"
                              title="Click to change candidate's Category (Science, Art, Commercial)"
                            >
                              {!subjectCombinations.some(
                                (c) =>
                                  c.name.trim().toLowerCase() ===
                                  (cand.category || '').trim().toLowerCase()
                              ) && (
                                <option value={cand.category} className="bg-white text-black">
                                  {cand.category}
                                </option>
                              )}
                              {subjectCombinations.map((combo) => (
                                <option
                                  key={combo.id}
                                  value={combo.name}
                                  className="bg-white text-black font-bold"
                                >
                                  {combo.name}
                                </option>
                              ))}
                            </select>
                            {comboSubjects.length > 0 && (
                              <div className="text-[10px] text-neutral-500 mt-1 max-w-[200px] truncate" title={comboSubjects.join(', ')}>
                                {comboSubjects.join(', ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            {cand.regNumber ? (
                              <div className="inline-flex items-center gap-1.5 font-mono font-extrabold text-[#0a6b3c] bg-[#0a6b3c]/10 px-2.5 py-1 rounded border border-[#0a6b3c]">
                                <span>{cand.regNumber}</span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(cand.regNumber, `reg-${cand.id}`)}
                                  className="hover:text-black cursor-pointer"
                                  title="Copy Registration Number"
                                >
                                  {copiedId === `reg-${cand.id}` ? (
                                    <Check className="w-3 h-3" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-neutral-500 italic text-[11px]">
                                Generated on Approval (QMT...)
                              </span>
                            )}
                          </td>
                          {!isFreeRegistration && isRegNumberGenerationAllowed && (
                            <td className="py-3.5 px-3">
                              <div className="font-semibold text-black">{cand.paymentMethod}</div>
                              <div className="text-[11px] text-neutral-500 font-mono">
                                Ref: {cand.transactionRef}{' '}
                                {cand.proofFileName ? `• Proof: ${cand.proofFileName}` : ''}
                              </div>
                              {(cand.proofDataUrl || cand.proofFileName) && (
                                <button
                                  type="button"
                                  onClick={() => setProfileCandidate(cand)}
                                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-extrabold text-[#0a6b3c] hover:underline cursor-pointer"
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Inspect Uploaded Proof & Details</span>
                                </button>
                              )}
                            </td>
                          )}
                          <td className="py-3.5 px-3">
                            {isCandPaid ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0a6b3c]/15 text-[#0a6b3c] font-extrabold text-[11px]">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {isCandFree
                                  ? 'Approved (QMT Reg No Active)'
                                  : `Approved / Paid (₦${cand.amountPaid.toLocaleString()})`}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-900 font-extrabold text-[11px]">
                                {isCandFree
                                  ? 'Pending Admin Approval'
                                  : `Pending Approval (₦${cand.amountPaid.toLocaleString()})`}
                              </span>
                            )}
                          </td>
                          {!isFreeRegistration && isRegNumberGenerationAllowed && (
                            <td className="py-3.5 px-3">
                              {cand.pin ? (
                                <div className="inline-flex items-center gap-1.5 font-mono font-extrabold text-[#0a6b3c] bg-[#0a6b3c]/10 px-2.5 py-1 rounded border border-[#0a6b3c]">
                                  <span>{cand.pin}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(cand.pin, cand.id)}
                                    className="hover:text-black cursor-pointer"
                                    title="Copy PIN"
                                  >
                                    {copiedId === cand.id ? (
                                      <Check className="w-3 h-3" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-neutral-400 italic">Not generated</span>
                              )}
                            </td>
                          )}
                          <td className="py-3.5 px-3 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setProfileCandidate(cand)}
                                className="px-3 py-1.5 rounded-lg border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View Filled Details</span>
                              </button>

                              {!isCandPaid && !isCandFree && (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPayment(cand)}
                                  className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Approve &amp; Generate QMT Reg No</span>
                                </button>
                              )}

                              {isCandFree ? (
                                !isCandPaid || !cand.regNumber.toUpperCase().startsWith('QMT') ? (
                                  <button
                                    type="button"
                                    onClick={() => handleConfirmPayment(cand)}
                                    className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Approve &amp; Generate QMT Reg No</span>
                                  </button>
                                ) : (
                                  <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c] font-extrabold text-[11px]">
                                    ✓ Approved ({cand.regNumber})
                                  </span>
                                )
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleGeneratePinForCandidate(cand)}
                                  className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  <KeyRound className="w-3.5 h-3.5" />
                                  <span>
                                    {cand.pin
                                      ? 'Regenerate PIN'
                                      : !isCandPaid
                                      ? 'Approve & Generate PIN'
                                      : 'Generate PIN'}
                                  </span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* SECTION B: Paste candidates in normal text (TASK 2: Exact 6-Column Base Format) */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-extrabold text-black">
                    Add Students — Bulk Paste (6-Column Format)
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Format per line:{' '}
                    <span className="font-mono font-bold text-[#0a6b3c]">
                      First Name | Middle Name (or &quot;-&quot;) | Surname | Subject Combination | Course | Category (Art, Science, Commercial)
                    </span>
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 text-[#0a6b3c] text-[11px] font-extrabold">
                  Auto-assigns to first available Examination Centre
                </span>
              </div>

              <textarea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="First Name | Middle Name (or -) | Surname | English, Maths, Biology, Chemistry | Medicine | Science"
                className="w-full p-4 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs text-black bg-neutral-50"
              />

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handlePreviewCandidates}
                  className="px-5 py-2.5 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold transition-colors cursor-pointer"
                >
                  Preview candidates
                </button>
                <button
                  type="button"
                  onClick={handleSaveAllPasted}
                  className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold transition-colors cursor-pointer"
                >
                  Save all candidates &amp; Assign Examination Centre
                </button>
              </div>

              {previewedCandidates.length > 0 && (
                <div className="p-4 rounded-xl bg-[#0a6b3c]/5 border border-[#0a6b3c] space-y-2">
                  <div className="text-xs font-extrabold text-[#0a6b3c]">
                    Previewed {previewedCandidates.length} Candidate(s) — Click &quot;Save all candidates &amp; Assign Examination Centre&quot; to commit:
                  </div>
                  {previewedCandidates.map((pc) => (
                    <div
                      key={pc.id}
                      className="text-xs text-black flex flex-wrap items-center gap-2.5 py-1 border-b border-[#0a6b3c]/15 last:border-b-0"
                    >
                      <span className="font-extrabold">
                        {pc.firstName} {pc.middleName ? `${pc.middleName} ` : ''}
                        {pc.surname}
                      </span>
                      <span className="font-mono text-neutral-600">{pc.regNumber}</span>
                      <span className="px-2 py-0.5 rounded bg-[#0a6b3c] text-white text-[10px] font-bold uppercase">
                        {pc.category}
                      </span>
                      {pc.courseOfStudy && (
                        <span className="px-2 py-0.5 rounded bg-white border border-neutral-300 text-black text-[10px] font-bold">
                          Course: {pc.courseOfStudy}
                        </span>
                      )}
                      {pc.subjectCombination && (
                        <span className="text-[11px] text-neutral-700 font-semibold">
                          [{pc.subjectCombination}]
                        </span>
                      )}
                      {pc.examCenterName && (
                        <span className="px-2 py-0.5 rounded bg-[#0a6b3c]/15 text-[#0a6b3c] text-[10px] font-extrabold">
                          Examination Centre: {pc.examCenterName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* SECTION C: Candidate Registry (Matches Screenshot 2, 4, 5 in Green & White theme) */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <div>
                <h2 className="text-base font-extrabold text-black">
                  Candidate registry (Uploaded Candidates Dashboard)
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  CSV, Excel, or PDF files are accepted. Confirmed candidates automatically appear here for exam assignment.
                </p>
              </div>

              {/* Bulk Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleBulkApproveCandidates(selectedIds)}
                  disabled={selectedIds.length === 0}
                  className="px-3.5 py-2 rounded-full bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve selected ({selectedIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleBulkApproveCandidates()}
                  disabled={unapprovedCount === 0}
                  className="px-3.5 py-2 rounded-full bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Approve all pending ({unapprovedCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleBulkSuspend(true)}
                  disabled={selectedIds.length === 0}
                  className="px-3.5 py-2 rounded-full border border-amber-400 text-amber-800 bg-amber-50 hover:bg-amber-100 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Suspend selected ({selectedIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleBulkSuspend(false)}
                  disabled={selectedIds.length === 0}
                  className="px-3.5 py-2 rounded-full border border-[#0a6b3c] text-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Lift suspension ({selectedIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onDeleteCandidates(selectedIds);
                    setSelectedIds([]);
                  }}
                  disabled={selectedIds.length === 0}
                  className="px-3.5 py-2 rounded-full border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete selected ({selectedIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={onClearAllCandidates}
                  className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear all candidates</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowAddCandidateModal(true)}
                  className="px-4 py-2 rounded-full bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Upload candidates</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleCopyBulkCandidatesText(filteredCandidates)}
                  className="px-4 py-2 rounded-full border-2 border-[#0a6b3c] text-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/10 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedId === 'bulk-candidates-text' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied Bulk Text (A–Z)!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Bulk Candidates in Text (A–Z)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadCandidatesPdf(filteredCandidates)}
                  className="px-4 py-2 rounded-full bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Candidates in PDF (A–Z)</span>
                </button>
              </div>

              {/* Search & Filter Controls */}
              <div className="space-y-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or reg number..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs text-black"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-bold text-black bg-white"
                  >
                    <option value="All">All statuses</option>
                    <option value="Paid">Paid & Verified</option>
                    <option value="Pending">Pending Payment</option>
                    <option value="Suspended">Suspended</option>
                  </select>

                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-bold text-black bg-white"
                  >
                    <option value="All">All Subject Combinations (Categories)</option>
                    {subjectCombinations.map((combo) => (
                      <option key={combo.id} value={combo.name}>
                        {combo.name} ({combo.subjects.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Candidate Registry Table */}
              <div className="overflow-x-auto rounded-xl border border-neutral-200">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-extrabold text-neutral-600">
                      <th className="py-3.5 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={
                            filteredCandidates.length > 0 &&
                            selectedIds.length === filteredCandidates.length
                          }
                          onChange={toggleSelectAll}
                          className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                        />
                      </th>
                      <th className="py-3.5 px-4">Name</th>
                      <th className="py-3.5 px-4">Registration</th>
                      <th className="py-3.5 px-4">Gender</th>
                      <th className="py-3.5 px-4">Category</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 text-xs">
                    {filteredCandidates.map((cand) => {
                      return (
                        <tr key={cand.id} className="hover:bg-neutral-50">
                          <td className="py-3.5 px-4">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(cand.id)}
                              onChange={() => toggleSelectCandidate(cand.id)}
                              className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-white border border-[#0a6b3c]/30 flex items-center justify-center overflow-hidden shrink-0">
                                {cand.passportDataUrl && !cand.passportDataUrl.startsWith('/proctoring/') ? (
                                  <img
                                    src={cand.passportDataUrl}
                                    alt={`${cand.firstName} ${cand.surname}`}
                                    className="w-full h-full object-cover"
                                  />
                                ) : null}
                              </div>
                              <div>
                                <div className="font-extrabold text-black flex items-center gap-1.5">
                                  <span>
                                    {cand.firstName} {cand.middleName} {cand.surname}
                                  </span>
                                  {cand.suspended && (
                                    <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">
                                      Suspended
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-neutral-500 flex flex-wrap items-center gap-1.5">
                                  <span>
                                    {cand.paymentStatus === 'Paid'
                                      ? 'Approved (Reg No Active)'
                                      : 'Pending Admin Approval'}
                                    {!isFreeRegistration &&
                                      cand.paymentMethod !== 'Free Registration' &&
                                      ` • PIN: ${cand.pin || 'Pending'}`}
                                  </span>
                                  {cand.courseOfStudy && (
                                    <span className="text-[#0a6b3c] font-bold">
                                      • {cand.courseOfStudy}
                                    </span>
                                  )}
                                  {cand.examCenterName && (
                                    <span className="px-1.5 py-0.5 rounded bg-[#0a6b3c]/10 text-[#0a6b3c] font-bold text-[10px]">
                                      {cand.examCenterName}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-black tabular-nums">
                            {cand.regNumber || '—'}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-700 font-medium">
                            {cand.gender}
                          </td>
                          <td className="py-3.5 px-4">
                            {/* Interactive Category Selector Badge = GREEN #0a6b3c */}
                            <select
                              value={
                                subjectCombinations.find(
                                  (c) =>
                                    c.name.trim().toLowerCase() ===
                                    (cand.category || '').trim().toLowerCase()
                                )?.name || cand.category
                              }
                              onChange={(e) => {
                                const newCat = e.target.value;
                                onUpdateCandidate({ ...cand, category: newCat });
                                triggerToast(
                                  `Updated ${cand.firstName} ${cand.surname}'s Category to "${newCat}".`
                                );
                              }}
                              className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase tracking-wider cursor-pointer border border-[#0a6b3c] focus:outline-none"
                              title="Click to change candidate's Category (Science, Art, Commercial)"
                            >
                              {!subjectCombinations.some(
                                (c) =>
                                  c.name.trim().toLowerCase() ===
                                  (cand.category || '').trim().toLowerCase()
                              ) && (
                                <option value={cand.category} className="bg-white text-black">
                                  {cand.category}
                                </option>
                              )}
                              {subjectCombinations.map((combo) => (
                                <option
                                  key={combo.id}
                                  value={combo.name}
                                  className="bg-white text-black font-bold"
                                >
                                  {combo.name}
                                </option>
                              ))}
                            </select>
                            {cand.subjectCombination && (
                              <div
                                className="text-[10px] text-neutral-500 mt-1 max-w-[200px] truncate"
                                title={cand.subjectCombination}
                              >
                                {cand.subjectCombination}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center justify-end gap-2">
                              {cand.paymentStatus !== 'Paid' && (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmPayment(cand)}
                                  className="px-3 py-1.5 rounded-full bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                >
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>Approve Reg No</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateCandidate({ ...cand, suspended: !cand.suspended })
                                }
                                className="px-3 py-1.5 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 font-bold text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Ban className="w-3 h-3" />
                                <span>{cand.suspended ? 'Unsuspend' : 'Suspend'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setSlipCandidate(cand)}
                                className="px-3 py-1.5 rounded-full border border-neutral-300 hover:border-[#0a6b3c] bg-white text-black font-bold text-[11px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                              >
                                <Camera className="w-3 h-3 text-[#0a6b3c]" />
                                <span>Edit Photocard</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setProfileCandidate(cand)}
                                className="px-3 py-1.5 rounded-full border border-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] font-bold text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                              >
                                <Eye className="w-3 h-3" />
                                <span>View Filled Details</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditCandidate(cand)}
                                className="p-1.5 rounded-full border border-neutral-300 hover:border-[#0a6b3c] text-neutral-700 cursor-pointer"
                                title="Edit Candidate"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => onDeleteCandidates([cand.id])}
                                className="p-1.5 rounded-full border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                                title="Delete Candidate"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2B: EXAMINATION CENTRE ADMIN */}
        {activeTab === 'Exam Centers' && (
          <div className="space-y-6">
            {/* Top Create Examination Centre Card */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    EXAMINATION CENTRE MANAGEMENT
                  </span>
                  <h2 className="text-lg font-extrabold text-black mt-0.5">
                    Create &amp; Manage Examination Centres
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Students self-registering see only centres where{' '}
                    <span className="font-mono font-bold text-black">
                      current_count &lt; max_capacity
                    </span>
                    . Admin bulk paste automatically assigns candidates to the first available Examination Centre.
                  </p>
                </div>
                <div className="px-3.5 py-2 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c] text-right">
                  <span className="block text-[10px] font-extrabold uppercase text-[#0a6b3c]">
                    Total Available Slots
                  </span>
                  <span className="text-base font-extrabold text-black tabular-nums">
                    {examCenters.reduce(
                      (acc, c) => acc + Math.max(0, c.maxCapacity - c.currentCount),
                      0
                    )}{' '}
                    / {examCenters.reduce((acc, c) => acc + c.maxCapacity, 0)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-extrabold text-neutral-700 mb-1">
                    Examination Centre Name *
                  </label>
                  <input
                    type="text"
                    value={newCenterName}
                    onChange={(e) => setNewCenterName(e.target.value)}
                    placeholder="e.g., Main Hall, Centre 1, North Wing"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs font-semibold text-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-extrabold text-neutral-700 mb-1">
                    Max Capacity (Any Number) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newCenterCapacity}
                    onChange={(e) => setNewCenterCapacity(e.target.value)}
                    placeholder="e.g., 50, 120, 250"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs font-semibold text-black font-mono"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleCreateExamCenter}
                    className="w-full px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Examination Centre</span>
                  </button>
                </div>
              </div>
            </section>

            {/* Examination Centres List with Fill Rate, Edit & Delete */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-extrabold text-black">
                    Active Examination Centres ({examCenters.length})
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Real-time capacity tracking, fill rate percentage, and slot availability.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {examCenters.map((center) => {
                  const slotsLeft = Math.max(0, center.maxCapacity - center.currentCount);
                  const fillPercent =
                    center.maxCapacity > 0
                      ? Math.min(100, Math.round((center.currentCount / center.maxCapacity) * 100))
                      : 100;
                  const isFull = slotsLeft === 0;
                  const isEditing = editingCenterId === center.id;

                  return (
                    <div
                      key={center.id}
                      className={`p-4 rounded-2xl border-2 transition-all space-y-3 ${
                        isFull
                          ? 'border-red-300 bg-red-50/40'
                          : 'border-[#0a6b3c]/30 bg-neutral-50 hover:border-[#0a6b3c]'
                      }`}
                    >
                      {isEditing ? (
                        <div className="space-y-2.5 text-xs">
                          <div>
                            <label className="block font-bold text-neutral-700 mb-0.5">
                              Examination Centre Name
                            </label>
                            <input
                              type="text"
                              value={editCenterNameDraft}
                              onChange={(e) => setEditCenterNameDraft(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white font-bold"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block font-bold text-neutral-700 mb-0.5">
                                Current Count
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={editCenterCountDraft}
                                onChange={(e) => setEditCenterCountDraft(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white font-mono"
                              />
                            </div>
                            <div>
                              <label className="block font-bold text-neutral-700 mb-0.5">
                                Max Capacity
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={editCenterCapDraft}
                                onChange={(e) => setEditCenterCapDraft(e.target.value)}
                                className="w-full px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white font-mono"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingCenterId(null)}
                              className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-neutral-700 font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEditExamCenter(center.id)}
                              className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white font-extrabold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shrink-0">
                                <MapPin className="w-4 h-4" />
                              </div>
                              <div>
                                <h4 className="font-extrabold text-sm text-black">
                                  {center.name}
                                </h4>
                                <span
                                  className={`inline-block text-[11px] font-extrabold ${
                                    isFull ? 'text-red-600' : 'text-[#0a6b3c]'
                                  }`}
                                >
                                  {isFull
                                    ? 'FULL (0 slots left)'
                                    : `${center.name} - ${slotsLeft} left`}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEditExamCenter(center)}
                                className="p-1.5 rounded-lg border border-neutral-300 bg-white hover:border-[#0a6b3c] text-neutral-700 cursor-pointer"
                                title="Edit Exam Center"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteExamCenter(center.id)}
                                className="p-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                                title="Delete Exam Center"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-neutral-600 font-semibold">
                                Assigned: <strong className="text-black">{center.currentCount}</strong> /{' '}
                                {center.maxCapacity}
                              </span>
                              <span className="font-mono font-extrabold text-black">
                                {fillPercent}% Full
                              </span>
                            </div>
                            <div className="w-full h-2.5 rounded-full bg-neutral-200 overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  isFull ? 'bg-red-600' : 'bg-[#0a6b3c]'
                                }`}
                                style={{ width: `${fillPercent}%` }}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Non-Destructive Supabase Migration SQL Card */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#0a6b3c]" />
                  <h3 className="text-sm font-extrabold text-black">
                    Supabase Non-Destructive Migration SQL (ADD Columns &amp; Exam Centers Table)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      `CREATE TABLE IF NOT EXISTS public.exam_centers (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name TEXT NOT NULL UNIQUE,\n  max_capacity INTEGER NOT NULL DEFAULT 50 CHECK (max_capacity > 0),\n  current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\nALTER TABLE public.students\n  ADD COLUMN IF NOT EXISTS first_name TEXT,\n  ADD COLUMN IF NOT EXISTS middle_name TEXT,\n  ADD COLUMN IF NOT EXISTS surname TEXT,\n  ADD COLUMN IF NOT EXISTS subject_combination TEXT,\n  ADD COLUMN IF NOT EXISTS course_of_study TEXT,\n  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('Art', 'Science', 'Commercial')),\n  ADD COLUMN IF NOT EXISTS state_of_origin TEXT,\n  ADD COLUMN IF NOT EXISTS password_hash TEXT,\n  ADD COLUMN IF NOT EXISTS exam_center_id UUID REFERENCES public.exam_centers(id) ON DELETE SET NULL;\n\n-- TYA (Type Your Answers) + AI Evaluation Columns\nALTER TABLE public.questions\n  ADD COLUMN IF NOT EXISTS question_type VARCHAR(10) NOT NULL DEFAULT 'MCQ',\n  ADD COLUMN IF NOT EXISTS answer_keys JSONB DEFAULT '[]'::jsonb,\n  ADD COLUMN IF NOT EXISTS allow_ai_eval BOOLEAN NOT NULL DEFAULT true,\n  ADD COLUMN IF NOT EXISTS explanation TEXT,\n  ADD COLUMN IF NOT EXISTS mark INTEGER NOT NULL DEFAULT 1;\n\nALTER TABLE public.student_answers\n  ADD COLUMN IF NOT EXISTS typed_answer TEXT,\n  ADD COLUMN IF NOT EXISTS is_correct BOOLEAN,\n  ADD COLUMN IF NOT EXISTS ai_evaluated BOOLEAN NOT NULL DEFAULT false,\n  ADD COLUMN IF NOT EXISTS ai_explanation TEXT,\n  ADD COLUMN IF NOT EXISTS marks_awarded INTEGER NOT NULL DEFAULT 0;\n\nCREATE TABLE IF NOT EXISTS public.system_settings (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  key TEXT NOT NULL UNIQUE,\n  value TEXT NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\nINSERT INTO public.system_settings (key, value)\nVALUES\n  ('exam_start_flow', 'dashboard_first'),\n  ('enable_ai_evaluation_for_tya', 'true'),\n  ('default_candidate_password', '9b871512327c09ce91dd649b3f96a63b7408ef267c8cc5710114e629730cb61f')\nON CONFLICT (key) DO UPDATE\nSET value = EXCLUDED.value,\n    updated_at = now();`,
                      'supabase-migration-sql'
                    )
                  }
                  className="px-3.5 py-1.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedId === 'supabase-migration-sql' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied Migration SQL!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Supabase SQL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 rounded-xl bg-neutral-900 text-emerald-400 font-mono text-[11px] overflow-x-auto leading-relaxed">
{`-- Non-destructive migration: Keeps all existing student & question columns
CREATE TABLE IF NOT EXISTS public.exam_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  max_capacity INTEGER NOT NULL DEFAULT 50 CHECK (max_capacity > 0),
  current_count INTEGER NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS surname TEXT,
  ADD COLUMN IF NOT EXISTS subject_combination TEXT,
  ADD COLUMN IF NOT EXISTS course_of_study TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('Art', 'Science', 'Commercial')),
  ADD COLUMN IF NOT EXISTS state_of_origin TEXT,
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS exam_center_id UUID REFERENCES public.exam_centers(id) ON DELETE SET NULL;

-- TYA (Type Your Answers) + AI Evaluation Columns
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS question_type VARCHAR(10) NOT NULL DEFAULT 'MCQ',
  ADD COLUMN IF NOT EXISTS answer_keys JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allow_ai_eval BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS mark INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.student_answers
  ADD COLUMN IF NOT EXISTS typed_answer TEXT,
  ADD COLUMN IF NOT EXISTS is_correct BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_evaluated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_explanation TEXT,
  ADD COLUMN IF NOT EXISTS marks_awarded INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.system_settings (key, value)
VALUES
  ('exam_start_flow', 'dashboard_first'),
  ('enable_ai_evaluation_for_tya', 'true'),
  ('default_candidate_password', '9b871512327c09ce91dd649b3f96a63b7408ef267c8cc5710114e629730cb61f')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();`}
              </pre>
            </section>
          </div>
        )}

        {/* TAB 3: QUESTION BANK (Matches Screenshot 6 in Green #0a6b3c & White theme) */}
        {activeTab === 'Question bank' && (
          <div className="space-y-6">
            {/* Top Card: SUBJECT NAVIGATION */}
            <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <div>
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  SUBJECT NAVIGATION
                </span>
                <h2 className="text-lg font-extrabold text-black mt-0.5">
                  Select Subject to Manage its Question Banks
                </h2>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowAddSubjectModal(true)}
                  className="px-4 py-2.5 rounded-full bg-neutral-900 hover:bg-black text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add New Subject</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {allAvailableSubjects.map((subj) => {
                  const isSelected = qSubject === subj;
                  return (
                    <button
                      key={subj}
                      type="button"
                      onClick={() => {
                        setQSubject(subj);
                        setOpenedBankId(null);
                      }}
                      className={`px-5 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#0a6b3c] text-white shadow-xs'
                          : 'bg-neutral-100 hover:bg-neutral-200 text-black'
                      }`}
                    >
                      {subj}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Subject Combination Name (Category) & Subjects Manager in Question Bank Tab */}
            <section className="p-6 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  SUBJECT COMBINATIONS (CATEGORIES)
                </span>
                <h2 className="text-lg font-extrabold text-black">
                  Add or Edit Subject Combination Name (Category) &amp; Pick Subjects
                </h2>
                <p className="text-xs text-neutral-500">
                  Create or edit any Subject Combination Name (Category) — e.g. <strong>Medical</strong>, <strong>Engineering</strong>, <strong>Art</strong>, <strong>Commercial</strong> — and pick the subjects that belong to it. When a candidate falls under that Subject Combination, they only see exams and questions from the subjects in their combination.
                </p>
              </div>

              {/* Add / Edit Subject Combination Form */}
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    {editingComboId
                      ? 'Editing Subject Combination (Category)'
                      : 'Add New Subject Combination (Category)'}
                  </span>
                  {editingComboId && (
                    <button
                      type="button"
                      onClick={handleCancelEditCombination}
                      className="text-xs font-bold text-neutral-600 hover:text-black underline cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                      Subject Combination Name (Category)
                    </label>
                    <input
                      type="text"
                      value={comboNameInput}
                      onChange={(e) => setComboNameInput(e.target.value)}
                      placeholder="e.g. Medical, Nursing, Law..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs md:text-sm font-bold text-black bg-white"
                    />
                  </div>

                  <div className="md:col-span-8 space-y-2.5">
                    <label className="block text-xs font-extrabold text-neutral-800">
                      Pick Subjects for this Combination ({comboSubjectsInput.length} selected)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {allAvailableSubjects.map((subj) => {
                        const isPicked = comboSubjectsInput.some(
                          (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                        );
                        return (
                          <button
                            key={subj}
                            type="button"
                            onClick={() => handleToggleComboSubjectDraft(subj)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                              isPicked
                                ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                                : 'bg-white text-neutral-700 border-neutral-300 hover:border-[#0a6b3c]'
                            }`}
                          >
                            {isPicked && <Check className="w-3.5 h-3.5" />}
                            <span>{subj}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 pt-1 max-w-sm">
                      <input
                        type="text"
                        value={customSubjectDraft}
                        onChange={(e) => setCustomSubjectDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomSubjectToDraft();
                          }
                        }}
                        placeholder="Or type a new subject name..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] text-xs bg-white text-black"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomSubjectToDraft}
                        className="px-3 py-1.5 rounded-lg border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c] hover:text-white text-xs font-extrabold cursor-pointer whitespace-nowrap"
                      >
                        + Add Subject
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  {editingComboId && (
                    <button
                      type="button"
                      onClick={handleCancelEditCombination}
                      className="px-4 py-2.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 text-black text-xs font-extrabold cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveSubjectCombination}
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {editingComboId
                        ? 'Save Updated Subject Combination (Category)'
                        : 'Save Subject Combination (Category)'}
                    </span>
                  </button>
                </div>
              </div>

              {/* List of Configured Subject Combinations */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {subjectCombinations.map((combo) => {
                  const isEditingThis = editingComboId === combo.id;
                  return (
                    <div
                      key={combo.id}
                      className={`p-4 rounded-2xl border space-y-3 flex flex-col justify-between transition-all ${
                        isEditingThis
                          ? 'border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 shadow-sm'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          {isEditingThis ? (
                            <div className="space-y-1.5">
                              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                                Rename Category / Combination:
                              </label>
                              <input
                                type="text"
                                value={comboNameInput}
                                onChange={(e) => setComboNameInput(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-lg border-2 border-[#0a6b3c] bg-white text-xs font-extrabold text-black focus:outline-none"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-xs font-extrabold">
                                {combo.name}
                              </span>
                              <span className="text-[11px] font-bold text-neutral-500">
                                {combo.subjects.length} Subjects
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isEditingThis ? (
                            <>
                              <button
                                type="button"
                                onClick={handleSaveSubjectCombination}
                                className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditCombination}
                                className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-[11px] font-bold text-neutral-700 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEditCombination(combo)}
                              className="px-2.5 py-1 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] text-[11px] font-extrabold text-black flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3 text-[#0a6b3c]" />
                              <span>Edit</span>
                            </button>
                          )}
                          {subjectCombinations.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSubjectCombination(combo.id)}
                              className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                              title="Delete Subject Combination"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-neutral-500">
                          Click any subject below to add or remove it from{' '}
                          <strong>{isEditingThis ? comboNameInput || combo.name : combo.name}</strong> (saves immediately):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {allAvailableSubjects.map((subj) => {
                            const active = isEditingThis
                              ? comboSubjectsInput.some(
                                  (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                                )
                              : combo.subjects.some(
                                  (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                                );
                            return (
                              <button
                                key={subj}
                                type="button"
                                onClick={() =>
                                  handleToggleSubjectOnExistingCombo(combo.id, subj)
                                }
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border transition-colors cursor-pointer flex items-center gap-1 ${
                                  active
                                    ? 'bg-[#0a6b3c]/10 border-[#0a6b3c] text-[#0a6b3c]'
                                    : 'bg-neutral-50 border-neutral-200 text-neutral-400 hover:text-black'
                                }`}
                              >
                                {active && <Check className="w-3 h-3" />}
                                <span>{subj}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Bottom Card: ALL QUESTION BANKS IN SELECTED SUBJECT */}
            {!openedBankId ? (
              <section className="p-6 rounded-2xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    <Layers className="w-4 h-4" />
                    <span>{qSubject.toUpperCase()} QUESTION BANKS</span>
                  </div>
                  <h2 className="text-xl font-extrabold text-black">
                    All Question Banks in {qSubject}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    Each subject can have unlimited question banks (e.g. Reproduction, Circular Motion, Cell Division). Click any bank to manage its questions.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const banksForSubj = questionBanks.filter((b) => b.subject === qSubject);
                      if (banksForSubj[0]) {
                        setOpenedBankId(banksForSubj[0].id);
                      } else {
                        setShowAddBankModal(true);
                      }
                    }}
                    className="px-4 py-2.5 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] bg-white text-black text-xs font-extrabold inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#0a6b3c]" />
                    <span>Upload Questions</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAddBankModal(true)}
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Add New Question Bank</span>
                  </button>
                </div>

                {/* Question Bank Cards List */}
                <div className="space-y-4">
                  {questionBanks
                    .filter((b) => b.subject === qSubject)
                    .map((bank, bIdx) => {
                      const subjQuestions = questions.filter((q) => q.subject === qSubject);
                      const qCount = bIdx === 0 ? subjQuestions.length : 0;

                      return (
                        <div
                          key={bank.id}
                          className="p-5 rounded-2xl border border-neutral-200 bg-white space-y-4 shadow-2xs"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center shrink-0">
                                <Folder className="w-5 h-5" />
                              </div>
                              <h3 className="text-sm font-extrabold text-black">
                                {bank.title}
                              </h3>
                            </div>

                            <span className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white font-mono text-xs font-extrabold tabular-nums">
                              {qCount} Qs
                            </span>
                          </div>

                          <p className="text-xs text-neutral-600">{bank.description}</p>

                          <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                            <div className="flex items-center gap-3 text-neutral-400">
                              <button
                                type="button"
                                onClick={() => setOpenedBankId(bank.id)}
                                className="hover:text-[#0a6b3c] cursor-pointer"
                                title="Edit Bank"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setQuestionBanks((prev) =>
                                    prev.filter((item) => item.id !== bank.id)
                                  )
                                }
                                className="hover:text-red-600 cursor-pointer"
                                title="Delete Bank"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() => setOpenedBankId(bank.id)}
                              className="px-4 py-2 rounded-full bg-neutral-900 hover:bg-[#0a6b3c] text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <span>Open Bank</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            ) : (
              /* Inside an Opened Question Bank: Add & Manage Questions */
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => setOpenedBankId(null)}
                  className="px-4 py-2 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-xs font-extrabold text-black inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5 text-[#0a6b3c]" />
                  <span>Back to {qSubject} Question Banks</span>
                </button>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  <div className="lg:col-span-5 space-y-6">
                    {/* Single Question Form (MCQ or TYA) */}
                    <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-4">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-base font-extrabold text-black">
                          Add Question to {qSubject}
                        </h2>
                        <span className="px-2.5 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[11px] font-extrabold">
                          {qType === 'TYA' ? 'TYA + AI Eval' : 'MCQ (Options A-D)'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-neutral-700 mb-1">
                            Subject
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={qSubject}
                            className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs font-bold text-black bg-neutral-50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-neutral-700 mb-1">
                            Category
                          </label>
                          <select
                            value={qCategory}
                            onChange={(e) =>
                              setQCategory(e.target.value as CategoryType | 'All')
                            }
                            className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs font-bold text-black bg-white"
                          >
                            <option value="All">All Categories</option>
                            {subjectCombinations.map((combo) => (
                              <option key={combo.id} value={combo.name}>
                                {combo.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Question Type Selector: MCQ vs TYA */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-neutral-700 mb-1">
                            Question Type (MCQ or TYA)
                          </label>
                          <select
                            value={qType}
                            onChange={(e) => setQType(e.target.value as QuestionType)}
                            className="w-full px-3 py-2 rounded-lg border-2 border-[#0a6b3c] text-xs font-extrabold text-black bg-white"
                          >
                            <option value="MCQ">MCQ (Multiple Choice A–D)</option>
                            <option value="TYA">TYA (Type Your Answer)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-neutral-700 mb-1">
                            Mark
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={qMarkInput}
                            onChange={(e) =>
                              setQMarkInput(Math.max(1, Number(e.target.value) || 1))
                            }
                            className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-xs font-bold text-black bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-neutral-700 mb-1">
                          Question Prompt
                        </label>
                        <textarea
                          rows={3}
                          value={qText}
                          onChange={(e) => setQText(e.target.value)}
                          placeholder={
                            qType === 'TYA'
                              ? 'e.g., Which part of the nephron is mainly responsible for ultrafiltration of blood?'
                              : 'Enter the question stem...'
                          }
                          className="w-full p-3 rounded-lg border border-neutral-300 text-xs text-black"
                        />
                      </div>

                      {qType === 'TYA' ? (
                        <div className="space-y-3 p-3.5 rounded-xl bg-[#0a6b3c]/5 border border-[#0a6b3c]/25">
                          <div>
                            <label className="block text-xs font-extrabold text-[#0a6b3c] mb-1">
                              Answer Key(s)
                            </label>
                            <input
                              type="text"
                              value={qAnswerKeysInput}
                              onChange={(e) => setQAnswerKeysInput(e.target.value)}
                              placeholder="e.g., Grana | Thylakoid membrane | Thylakoid membranes"
                              className="w-full px-3 py-2.5 rounded-lg border border-[#0a6b3c]/40 bg-white text-xs font-bold text-black"
                            />
                            <p className="text-[11px] text-neutral-600 mt-1">
                              Separate multiple correct answers with{' '}
                              <code className="font-mono font-bold text-[#0a6b3c]">|</code>{' '}
                              (e.g., <span className="font-semibold">Grana | Thylakoid membrane</span>)
                            </p>
                          </div>

                          <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                            <input
                              type="checkbox"
                              checked={qAllowAiEval}
                              onChange={(e) => setQAllowAiEval(e.target.checked)}
                              className="w-4 h-4 accent-[#0a6b3c] rounded"
                            />
                            <span className="text-xs font-extrabold text-black">
                              Enable AI Evaluation (Scientific equivalence &amp; synonyms)
                            </span>
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {[
                            { label: 'Option A', val: qOptA, set: setQOptA },
                            { label: 'Option B', val: qOptB, set: setQOptB },
                            { label: 'Option C', val: qOptC, set: setQOptC },
                            { label: 'Option D', val: qOptD, set: setQOptD },
                          ].map((opt, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input
                                type="radio"
                                name="correctOpt"
                                checked={qCorrect === idx}
                                onChange={() => setQCorrect(idx)}
                                className="accent-[#0a6b3c]"
                              />
                              <input
                                type="text"
                                value={opt.val}
                                onChange={(e) => opt.set(e.target.value)}
                                placeholder={`${opt.label} (Select radio if correct)`}
                                className="flex-1 px-3 py-2 rounded-lg border border-neutral-300 text-xs text-black"
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (!qText.trim()) return;
                          if (qType === 'TYA') {
                            const keys = parseAnswerKeys(qAnswerKeysInput);
                            if (keys.length === 0) {
                              triggerToast('Please enter at least one Answer Key for TYA.');
                              return;
                            }
                            onAddQuestion({
                              id: `q-tya-${Date.now()}`,
                              subject: qSubject,
                              category: qCategory,
                              questionType: 'TYA',
                              questionText: qText.trim(),
                              options: [],
                              correctAnswer: 0,
                              answerKeys: keys,
                              mark: qMarkInput || 1,
                              allowAiEval: qAllowAiEval,
                            });
                            setQText('');
                            setQAnswerKeysInput('');
                            triggerToast(`Saved TYA question to ${qSubject} bank.`);
                          } else {
                            if (!qOptA.trim() || !qOptB.trim()) return;
                            onAddQuestion({
                              id: `q-${Date.now()}`,
                              subject: qSubject,
                              category: qCategory,
                              questionType: 'MCQ',
                              questionText: qText.trim(),
                              options: [
                                qOptA.trim(),
                                qOptB.trim(),
                                qOptC.trim() || 'None of the above',
                                qOptD.trim() || 'All of the above',
                              ],
                              correctAnswer: qCorrect,
                              mark: qMarkInput || 1,
                            });
                            setQText('');
                            setQOptA('');
                            setQOptB('');
                            setQOptC('');
                            setQOptD('');
                            triggerToast(`Saved MCQ question to ${qSubject} bank.`);
                          }
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold uppercase tracking-wider cursor-pointer"
                      >
                        + Save {qType} Question to Bank
                      </button>
                    </div>

                    {/* Bulk Upload / Paste 6-Column Format (Supports MCQ & TYA) */}
                    <div className="p-6 rounded-2xl border-2 border-[#0a6b3c] bg-white text-black space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-extrabold text-black">
                            Bulk Upload / Paste Questions (6-Column MCQ &amp; TYA)
                          </h3>
                          <p className="text-[11px] text-neutral-600 mt-0.5">
                            Column 2 detects <code className="font-mono font-bold text-[#0a6b3c]">MCQ</code> or{' '}
                            <code className="font-mono font-bold text-[#0a6b3c]">TYA</code> automatically
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkQuestionPasteText(SAMPLE_20_BIOLOGY_TYA_6COL_TEXT);
                            const parsed = parseBulkQuestionsInput(
                              SAMPLE_20_BIOLOGY_TYA_6COL_TEXT,
                              qSubject,
                              qCategory
                            );
                            setPreviewedBulkQuestions(parsed);
                            triggerToast('Loaded 20 Biology TYA sample questions into preview.');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-[#0a6b3c] text-[11px] font-extrabold cursor-pointer"
                        >
                          Load 20 Biology TYA Questions
                        </button>
                      </div>

                      <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 text-[11px] space-y-1 font-mono text-neutral-700">
                        <div className="font-sans font-extrabold text-black">
                          Format A — MCQ (6 Columns):
                        </div>
                        <div>
                          QNo | MCQ | Question | (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | C | 1
                        </div>
                        <div className="font-sans font-extrabold text-[#0a6b3c] pt-1">
                          Format B — TYA (6 Columns):
                        </div>
                        <div>
                          1 | TYA | Which part of the nephron is mainly responsible for ultrafiltration of blood? | Glomerulus | 1 | YES
                        </div>
                        <div>
                          21 | TYA | Light dependent stage of photosynthesis occurs where? | Grana ; Thylakoid membrane | 1 | YES
                        </div>
                      </div>

                      <textarea
                        rows={6}
                        value={bulkQuestionPasteText}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBulkQuestionPasteText(val);
                          setPreviewedBulkQuestions(
                            parseBulkQuestionsInput(val, qSubject, qCategory)
                          );
                        }}
                        placeholder={`1 | TYA | Which part of the nephron is mainly responsible for ultrafiltration of blood? | Glomerulus | 1 | YES\n2 | TYA | In which stage of mitosis do chromosomes align at the equator of the cell? | Metaphase | 1 | YES`}
                        className="w-full p-3 rounded-xl border border-neutral-300 font-mono text-xs text-black"
                      />

                      {previewedBulkQuestions.length > 0 && (
                        <div className="p-3 rounded-xl bg-[#0a6b3c]/5 border border-[#0a6b3c]/25 space-y-2">
                          <div className="flex items-center justify-between text-xs font-extrabold text-[#0a6b3c]">
                            <span>
                              Parsed {previewedBulkQuestions.length} Question(s) (
                              {
                                previewedBulkQuestions.filter(
                                  (q) => q.questionType === 'TYA'
                                ).length
                              }{' '}
                              TYA,{' '}
                              {
                                previewedBulkQuestions.filter(
                                  (q) => q.questionType !== 'TYA'
                                ).length
                              }{' '}
                              MCQ)
                            </span>
                          </div>
                          <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                            {previewedBulkQuestions.map((pq, idx) => (
                              <div
                                key={pq.id}
                                className="p-2 rounded-lg bg-white border border-neutral-200 text-[11px] flex items-start justify-between gap-2"
                              >
                                <div>
                                  <span
                                    className={`inline-block px-1.5 py-0.5 rounded font-mono text-[10px] font-extrabold mr-1.5 ${
                                      pq.questionType === 'TYA'
                                        ? 'bg-amber-500/15 text-amber-800 border border-amber-500/30'
                                        : 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                                    }`}
                                  >
                                    {pq.questionType || 'MCQ'}
                                  </span>
                                  <span className="font-bold text-black">
                                    {idx + 1}. {pq.questionText}
                                  </span>
                                  {pq.questionType === 'TYA' && (
                                    <div className="text-[10px] text-[#0a6b3c] font-bold mt-0.5">
                                      Answer Key(s): {(pq.answerKeys || []).join(' | ')} • Mark:{' '}
                                      {pq.mark || 1} • AI Eval:{' '}
                                      {pq.allowAiEval !== false ? 'YES' : 'NO'}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        disabled={previewedBulkQuestions.length === 0}
                        onClick={() => {
                          if (previewedBulkQuestions.length === 0) return;
                          previewedBulkQuestions.forEach((pq) => onAddQuestion(pq));
                          const count = previewedBulkQuestions.length;
                          setBulkQuestionPasteText('');
                          setPreviewedBulkQuestions([]);
                          triggerToast(
                            `Uploaded ${count} question(s) to ${qSubject} Question Bank.`
                          );
                        }}
                        className="w-full py-2.5 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] disabled:opacity-40 text-white text-xs font-extrabold uppercase tracking-wider cursor-pointer"
                      >
                        + Bulk Import {previewedBulkQuestions.length || ''} Question(s) to{' '}
                        {qSubject}
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-7 p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-base font-extrabold text-black">
                        {qSubject} Questions (
                        {questions.filter((q) => q.subject === qSubject).length})
                      </h2>
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <span className="px-2.5 py-1 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c]">
                          MCQ:{' '}
                          {
                            questions.filter(
                              (q) => q.subject === qSubject && q.questionType !== 'TYA'
                            ).length
                          }
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-800 border border-amber-500/30">
                          TYA:{' '}
                          {
                            questions.filter(
                              (q) => q.subject === qSubject && q.questionType === 'TYA'
                            ).length
                          }
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3 max-h-[760px] overflow-y-auto pr-1">
                      {questions
                        .filter((q) => q.subject === qSubject)
                        .map((q, i) => {
                          const isTya = q.questionType === 'TYA';
                          return (
                            <div
                              key={q.id}
                              className="p-4 rounded-xl border border-neutral-200 bg-neutral-50 space-y-2"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2 py-0.5 rounded bg-[#0a6b3c] text-white font-mono text-[10px] font-bold">
                                    #{i + 1} • {q.subject}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-extrabold ${
                                      isTya
                                        ? 'bg-amber-500 text-black'
                                        : 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                                    }`}
                                  >
                                    {isTya ? 'TYPE = TYA' : 'TYPE = MCQ'}
                                  </span>
                                  <span className="text-[11px] font-bold text-[#0a6b3c]">
                                    Category: {q.category}
                                  </span>
                                  <span className="text-[11px] font-bold text-neutral-600">
                                    • Mark: {q.mark || 1}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onDeleteQuestion(q.id)}
                                  className="text-red-600 hover:text-red-800 p-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <p className="text-xs font-bold text-black">{q.questionText}</p>
                              {isTya ? (
                                <div className="p-2.5 rounded-lg bg-white border border-[#0a6b3c]/30 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                  <div>
                                    <span className="font-bold text-neutral-500">
                                      Answer Key(s):{' '}
                                    </span>
                                    <span className="font-extrabold text-[#0a6b3c]">
                                      {(q.answerKeys && q.answerKeys.length > 0
                                        ? q.answerKeys
                                        : ['—']
                                      ).join(' | ')}
                                    </span>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                      q.allowAiEval !== false
                                        ? 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                                        : 'bg-neutral-200 text-neutral-700'
                                    }`}
                                  >
                                    AI Evaluation: {q.allowAiEval !== false ? 'YES' : 'NO'}
                                  </span>
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                                  {q.options.map((opt, oIdx) => (
                                    <div
                                      key={oIdx}
                                      className={`px-2.5 py-1 rounded ${
                                        q.correctAnswer === oIdx
                                          ? 'bg-[#0a6b3c] text-white font-bold'
                                          : 'bg-white text-neutral-700 border border-neutral-200'
                                      }`}
                                    >
                                      {['A', 'B', 'C', 'D'][oIdx]}. {opt}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Add New Subject Modal */}
            {showAddSubjectModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
                  <h3 className="text-base font-extrabold text-[#0a6b3c]">
                    Add New Subject
                  </h3>
                  <div>
                    <label className="block text-xs font-bold mb-1">Subject Name</label>
                    <input
                      type="text"
                      value={newSubjectName}
                      onChange={(e) => setNewSubjectName(e.target.value)}
                      placeholder="e.g. Accounting or Further Mathematics"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-xs font-bold text-black"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddSubjectModal(false)}
                      className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const clean = newSubjectName.trim();
                        if (!clean) return;
                        if (!subjectsList.includes(clean)) {
                          setSubjectsList((prev) => [...prev, clean]);
                        }
                        setQSubject(clean);
                        setNewSubjectName('');
                        setShowAddSubjectModal(false);
                      }}
                      className="px-4 py-2 rounded-lg bg-[#0a6b3c] text-white text-xs font-bold cursor-pointer"
                    >
                      Save Subject
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add New Question Bank Modal */}
            {showAddBankModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
                  <h3 className="text-base font-extrabold text-[#0a6b3c]">
                    Add Question Bank in {qSubject}
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold mb-1">Bank Title</label>
                      <input
                        type="text"
                        value={newBankTitle}
                        onChange={(e) => setNewBankTitle(e.target.value)}
                        placeholder="e.g. Oral English & Phonetics"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-xs font-bold text-black"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-1">Description</label>
                      <input
                        type="text"
                        value={newBankDesc}
                        onChange={(e) => setNewBankDesc(e.target.value)}
                        placeholder="e.g. Vowel sounds, stress patterns, and rhymes"
                        className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 text-xs text-black"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddBankModal(false)}
                      className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!newBankTitle.trim()) return;
                        setQuestionBanks((prev) => [
                          ...prev,
                          {
                            id: `bank-${Date.now()}`,
                            subject: qSubject,
                            title: newBankTitle.trim(),
                            description:
                              newBankDesc.trim() || `Question bank for ${qSubject}`,
                          },
                        ]);
                        setNewBankTitle('');
                        setNewBankDesc('');
                        setShowAddBankModal(false);
                      }}
                      className="px-4 py-2 rounded-lg bg-[#0a6b3c] text-white text-xs font-bold cursor-pointer"
                    >
                      Create Bank
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: RESULTS (Ranked Order + Copy as Text + Well-Designed PDF Export) */}
        {activeTab === 'Results' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-5 shadow-xs">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <img
                    src={QUEMINT_LOGO_URL}
                    alt="Quemint Education Board Official Logo"
                    className="w-12 h-12 rounded-full object-contain border border-[#0a6b3c]/25 bg-white p-0.5 shrink-0 shadow-2xs"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1">
                        <Trophy className="w-3 h-3" />
                        <span>OFFICIAL RANKING ORDER</span>
                      </span>
                      <h2 className="text-lg font-extrabold text-black">
                        Ranked Examination Results ({rankedResults.length})
                      </h2>
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      Candidates are automatically ordered from Rank #1 downwards by highest aggregate score. Copy as formatted text or export as an official Quemint PDF sheet.
                    </p>
                  </div>
                </div>

                {/* Action Toolbar: Category Filter + Copy as Text + Preview PDF + Download PDF + Bulk/Clear Results */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={resultsCategoryFilter}
                    onChange={(e) => setResultsCategoryFilter(e.target.value)}
                    className="px-3.5 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-extrabold text-black bg-white cursor-pointer"
                  >
                    <option value="All">All Categories ({results.length})</option>
                    {subjectCombinations.map((combo) => (
                      <option key={combo.id} value={combo.name}>
                        {combo.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      if (selectedResultIds.length === 0) return;
                      onDeleteResults(selectedResultIds);
                      setSelectedResultIds([]);
                      triggerToast('Selected results deleted.');
                    }}
                    disabled={selectedResultIds.length === 0}
                    className="px-3.5 py-2 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete selected ({selectedResultIds.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      onClearAllResults();
                      setSelectedResultIds([]);
                      triggerToast('All results cleared.');
                    }}
                    disabled={results.length === 0}
                    className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear all results</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyRankedResultsText}
                    className="px-4 py-2 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedRankingToast ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copied Ranked Text!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Ranked Text</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowCopyTextBox(!showCopyTextBox)}
                    className="px-3.5 py-2 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-xs font-bold text-black cursor-pointer"
                  >
                    {showCopyTextBox ? 'Hide Text Box' : 'View Text to Copy'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPdfPreviewModal(true)}
                    className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] bg-[#0a6b3c]/8 hover:bg-[#0a6b3c]/15 text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Preview Official Sheet</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportRankedResultsPdf}
                    className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-2 transition-colors cursor-pointer shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>Export Ranked PDF</span>
                  </button>
                </div>
              </div>

              {/* Publish Ranking Per Exam Control Banner */}
              <div className="p-4 rounded-2xl border-2 border-[#0a6b3c]/30 bg-[#0a6b3c]/5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-[#0a6b3c]" />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      PUBLISH CANDIDATE RANKING CONTROL (PER EXAM)
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600">
                    Candidate ranking is <strong>only shown on candidate results</strong> when you click <strong>Publish Ranking</strong> for that exam. If unpublished, the word &quot;Ranking&quot; completely disappears from candidate results and slips.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(settings.publishedTests || []).map((pt) => {
                    const isRankPub = Boolean(
                      pt.rankingPublished ||
                        (settings.rankingPublishedByTestId &&
                          settings.rankingPublishedByTestId[pt.id])
                    );
                    return (
                      <button
                        key={pt.id}
                        type="button"
                        onClick={() => handleTogglePublishRankingForTest(pt.id)}
                        className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs ${
                          isRankPub
                            ? 'bg-[#0a6b3c] text-white hover:bg-[#0e8a4e]'
                            : 'bg-white border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10'
                        }`}
                      >
                        <Trophy className="w-3.5 h-3.5" />
                        <span>
                          {isRankPub
                            ? `Ranking Published: ${pt.title} (Click to Unpublish)`
                            : `Publish Ranking: ${pt.title}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Expandable Copyable Ranked Text Box */}
              {showCopyTextBox && (
                <div className="p-4 rounded-2xl bg-neutral-50 border-2 border-[#0a6b3c]/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Copyable Ranked Results Text (Ready for WhatsApp, Word, or Email)
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyRankedResultsText}
                      className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedRankingToast ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy All Text</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    rows={10}
                    value={formattedRankedText}
                    onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    className="w-full p-3.5 rounded-xl border border-neutral-300 bg-white font-mono text-xs text-black focus:outline-none focus:border-[#0a6b3c]"
                  />
                </div>
              )}

              {/* Ranked Results Table (No /xx or Cap indicators anywhere) */}
              <div className="overflow-x-auto rounded-2xl border border-neutral-200">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0a6b3c] text-white text-xs font-extrabold">
                      <th className="py-3.5 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={
                            rankedResults.length > 0 &&
                            rankedResults.every((r) => selectedResultIds.includes(r.id))
                          }
                          onChange={() => {
                            const allVisibleIds = rankedResults.map((r) => r.id);
                            const allSelected =
                              allVisibleIds.length > 0 &&
                              allVisibleIds.every((id) => selectedResultIds.includes(id));
                            if (allSelected) {
                              setSelectedResultIds((prev) =>
                                prev.filter((id) => !allVisibleIds.includes(id))
                              );
                            } else {
                              setSelectedResultIds((prev) =>
                                Array.from(new Set([...prev, ...allVisibleIds]))
                              );
                            }
                          }}
                          className="accent-white w-4 h-4 cursor-pointer"
                        />
                      </th>
                      <th className="py-3.5 px-4">Rank</th>
                      <th className="py-3.5 px-4">Candidate</th>
                      <th className="py-3.5 px-4">Reg Number</th>
                      <th className="py-3.5 px-4">Category</th>
                      <th className="py-3.5 px-4">Subject Scores</th>
                      <th className="py-3.5 px-4">Aggregate</th>
                      <th className="py-3.5 px-4">Percentage</th>
                      <th className="py-3.5 px-4">Grade / Remark</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 text-xs">
                    {rankedResults.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="py-8 px-4 text-center text-neutral-500 font-semibold"
                        >
                          No examination results available.
                        </td>
                      </tr>
                    ) : (
                      rankedResults.map((r, index) => {
                        const rank = index + 1;
                        const gradeInfo = getQuemintGradeInfo(r.percentage);
                        const isPassGrade = r.percentage >= 40;
                        return (
                          <tr
                            key={r.id}
                            className={
                              index % 2 === 0
                                ? 'bg-white hover:bg-[#0a6b3c]/5'
                                : 'bg-[#0a6b3c]/3 hover:bg-[#0a6b3c]/8'
                            }
                          >
                            <td className="py-3.5 px-4">
                              <input
                                type="checkbox"
                                checked={selectedResultIds.includes(r.id)}
                                onChange={() =>
                                  setSelectedResultIds((prev) =>
                                    prev.includes(r.id)
                                      ? prev.filter((id) => id !== r.id)
                                      : [...prev, r.id]
                                  )
                                }
                                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                              />
                            </td>
                            <td className="py-3.5 px-4">
                              <span
                                className={`inline-flex items-center justify-center px-2.5 py-1 rounded-lg font-mono text-xs font-extrabold ${
                                  rank === 1
                                    ? 'bg-[#0a6b3c] text-white shadow-2xs'
                                    : rank <= 3
                                    ? 'bg-[#0a6b3c]/15 text-[#0a6b3c] border border-[#0a6b3c]/30'
                                    : 'bg-neutral-100 text-neutral-700'
                                }`}
                              >
                                #{rank}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-extrabold text-black">
                              {r.candidateName}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-bold text-black tabular-nums">
                              {r.regNumber}
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase">
                                {r.category}
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="font-mono text-xs leading-relaxed space-y-1">
                                {Array.from(
                                  {
                                    length: Math.ceil(
                                      Object.entries(r.subjectBreakdown).length / 2
                                    ),
                                  },
                                  (_, rowIdx) => {
                                    const pair = Object.entries(
                                      r.subjectBreakdown
                                    ).slice(rowIdx * 2, rowIdx * 2 + 2);
                                    return (
                                      <div
                                        key={rowIdx}
                                        className="flex items-center gap-2 whitespace-nowrap"
                                      >
                                        {pair.map(([subj, st], pIdx) => (
                                          <React.Fragment key={subj}>
                                            {pIdx > 0 && (
                                              <span className="text-[#0a6b3c] font-extrabold px-1">
                                                •
                                              </span>
                                            )}
                                            <span className="font-bold text-black">
                                              {subj}:{' '}
                                              <strong className="text-[#0a6b3c] font-extrabold">
                                                {st.score}
                                              </strong>
                                            </span>
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    );
                                  }
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 font-mono text-sm font-extrabold text-[#0a6b3c] tabular-nums">
                              {r.score}
                            </td>
                            <td className="py-3.5 px-4 font-mono font-extrabold text-black tabular-nums">
                              {r.percentage}%
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span
                                className={`px-2.5 py-1 rounded-lg font-extrabold text-[11px] ${
                                  isPassGrade
                                    ? 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                                    : 'bg-red-100 text-red-700'
                                }`}
                              >
                                {gradeInfo.displayFull}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setViewingResult(r)}
                                  className="px-2.5 py-1.5 rounded-lg border border-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                                  title="View Individual Result"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingResult({
                                      ...r,
                                      subjectBreakdown: { ...r.subjectBreakdown },
                                    })
                                  }
                                  className="px-2.5 py-1.5 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] bg-white text-black font-extrabold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Edit Individual Result"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-[#0a6b3c]" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    onDeleteResults([r.id]);
                                    setSelectedResultIds((prev) =>
                                      prev.filter((id) => id !== r.id)
                                    );
                                  }}
                                  className="p-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 transition-colors cursor-pointer"
                                  title="Delete Individual Result"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Official Printable / PDF Preview Modal */}
            {showPdfPreviewModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
                <div className="w-full max-w-4xl bg-white text-black rounded-3xl overflow-hidden shadow-2xl border-2 border-[#0a6b3c] my-auto">
                  {/* Modal Top Controls */}
                  <div className="bg-neutral-100 border-b border-neutral-200 px-6 py-3.5 flex flex-wrap items-center justify-between gap-3 print:hidden">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Official Quemint Ranked Results Sheet Preview
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyRankedResultsText}
                        className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/5 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>
                          {copiedRankingToast ? 'Copied Text!' : 'Copy as Text'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-3.5 py-2 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Sheet</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportRankedResultsPdf}
                        className="px-4 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPdfPreviewModal(false)}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-neutral-500 hover:text-black cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>

                  {/* Well-Designed Official Sheet Body */}
                  <div className="p-6 md:p-8 space-y-6 bg-white">
                    {/* Sheet Green Banner Header */}
                    <div className="rounded-2xl bg-[#0a6b3c] text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <QuemintSeal size="md" variant="white" showText={false} />
                        <div>
                          <div className="text-[11px] font-extrabold uppercase tracking-widest text-white/85">
                            QUEMINT EDUCATION BOARD
                          </div>
                          <h3 className="text-xl md:text-2xl font-extrabold tracking-tight">
                            {settings.resultTitles?.testTitle || 'Quemint'}{' '}
                            {settings.resultTitles?.testSubtitle || 'Rapid Test'} — Official Ranking
                          </h3>
                          <p className="text-xs text-white/85 mt-0.5">
                            {settings.resultTitles?.assessmentSubtitle ||
                              'Quemint Education Board Assessment'}{' '}
                            • Category: {resultsCategoryFilter}
                          </p>
                        </div>
                      </div>
                      <div className="text-xs sm:text-right space-y-1 font-mono">
                        <div className="font-extrabold">
                          Date: {new Date().toLocaleDateString()}
                        </div>
                        <div className="text-white/90">
                          Candidates Ranked: {rankedResults.length}
                        </div>
                      </div>
                    </div>

                    {/* Sheet Ranked Table */}
                    <div className="rounded-2xl border border-neutral-200 overflow-hidden">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-[#0a6b3c] text-white font-extrabold">
                            <th className="py-3 px-4">Rank</th>
                            <th className="py-3 px-4">Candidate Name</th>
                            <th className="py-3 px-4">Reg No</th>
                            <th className="py-3 px-4">Category</th>
                            <th className="py-3 px-4">Subject Breakdown</th>
                            <th className="py-3 px-4 text-center">Aggregate</th>
                            <th className="py-3 px-4 text-center">Percentage</th>
                            <th className="py-3 px-4">Grade / Remark</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                          {rankedResults.map((r, idx) => {
                            const gInfo = getQuemintGradeInfo(r.percentage);
                            return (
                              <tr
                                key={r.id}
                                className={idx % 2 === 0 ? 'bg-white' : 'bg-[#0a6b3c]/4'}
                              >
                                <td className="py-3 px-4 font-mono font-extrabold text-[#0a6b3c]">
                                  #{idx + 1}
                                </td>
                                <td className="py-3 px-4 font-extrabold text-black">
                                  {r.candidateName}
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-neutral-700">
                                  {r.regNumber}
                                </td>
                                <td className="py-3 px-4 font-bold text-[#0a6b3c]">
                                  {r.category}
                                </td>
                                <td className="py-3 px-4 font-mono text-xs leading-relaxed">
                                  <div className="space-y-0.5">
                                    {formatSubjectScoresTwoByTwo(
                                      r.subjectBreakdown,
                                      '   •   '
                                    ).map((line, lIdx) => (
                                      <div
                                        key={lIdx}
                                        className="font-bold text-black whitespace-nowrap"
                                      >
                                        {line}
                                      </div>
                                    ))}
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-mono font-extrabold text-center text-[#0a6b3c] text-sm">
                                  {r.score}
                                </td>
                                <td className="py-3 px-4 font-mono font-bold text-center text-black">
                                  {r.percentage}%
                                </td>
                                <td className="py-3 px-4 font-extrabold text-[#0a6b3c] whitespace-nowrap">
                                  {gInfo.displayFull}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="pt-2 border-t border-neutral-200 flex items-center justify-between text-[11px] text-neutral-500 font-semibold">
                      <span>
                        Official Verified Result Ranking — Quemint Education Board
                      </span>
                      <span>Generated {new Date().toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: PERFORMANCE ANALYSIS (PURE STATISTICS WITH SCORE RANGE BREAKDOWN - NO NAMES) */}
        {activeTab === 'Performance Analysis' && (
          <PerformanceAnalysisPanel
            results={results}
            candidates={candidates}
            settings={settings}
            examCenters={examCenters}
          />
        )}

        {/* TAB: EXAM SCHEDULE / TIME-TABLE (PER EXAMINATION CENTRE + GENERAL SCHEDULE) */}
        {activeTab === 'Exam Schedule' && (
          <ExamSchedulePanel
            settings={settings}
            examCenters={examCenters}
            onUpdateSettings={onUpdateSettings}
            onTriggerToast={triggerToast}
          />
        )}

        {/* TAB 5: ANALYTICS */}
        {activeTab === 'Analytics' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-4">
              <h3 className="text-base font-extrabold text-black">
                Candidates by Examination Category
              </h3>
              {(['Medical', 'Engineering', 'Art', 'Commercial'] as CategoryType[]).map(
                (cat) => {
                  const count = candidates.filter((c) => c.category === cat).length;
                  const pct =
                    candidates.length > 0
                      ? Math.round((count / candidates.length) * 100)
                      : 0;
                  return (
                    <div key={cat} className="space-y-1.5">
                      <div className="flex justify-between text-xs font-bold">
                        <span>{cat}</span>
                        <span className="font-mono text-[#0a6b3c] tabular-nums">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0a6b3c]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-4">
              <h3 className="text-base font-extrabold text-black">
                Revenue & Payment Verification Summary
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c]">
                  <span className="block text-xs text-[#0a6b3c] font-bold">
                    Confirmed Revenue
                  </span>
                  <span className="font-mono text-2xl font-extrabold text-black tabular-nums">
                    ₦{(paidCount * settings.registrationFee).toLocaleString()}
                  </span>
                </div>
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200">
                  <span className="block text-xs text-neutral-500 font-bold">
                    Pending Manual Proof
                  </span>
                  <span className="font-mono text-2xl font-extrabold text-black tabular-nums">
                    ₦{(pendingCount * settings.registrationFee).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: LIVE PROCTORING */}
        {activeTab === 'Live Proctoring' && (
          <LiveProctoringPanel
            candidates={candidates}
            results={results}
            settings={settings}
            selectedProctoringIds={selectedProctoringIds}
            setSelectedProctoringIds={setSelectedProctoringIds}
            onClearProctoringFeeds={onClearProctoringFeeds}
            onClearAllProctoringFeeds={onClearAllProctoringFeeds}
            onRestoreAllProctoringFeeds={onRestoreAllProctoringFeeds}
            onToggleProctoringEnabled={(enabled) =>
              onUpdateSettings({ ...settings, proctoringEnabled: enabled })
            }
          />
        )}

        {/* TAB 7: EXAM CREATION & SETTINGS (Matches all 7 uploaded screenshots in Quemint Green #0a6b3c & White) */}
        {activeTab === 'Settings / Create Exam' && (
          <div className="max-w-3xl mx-auto space-y-6">
            {settingsSavedToast && (
              <div className="sticky top-20 z-40 p-4 rounded-2xl bg-[#0a6b3c] text-white text-xs md:text-sm font-extrabold flex items-center justify-between shadow-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{settingsSavedToast}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsSavedToast('')}
                  className="text-xs underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* CARD 1: Login Page Settings (Screenshot_20261023-163226_f8d7e139.png) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-extrabold text-black">
                    Login Page Settings
                  </h2>
                  <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold uppercase tracking-wider">
                    CANDIDATE LOGIN BANNER
                  </span>
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Customize the dynamic text displayed inside the green hero banner on the Candidate Login page.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Brand Name
                  </label>
                  <input
                    type="text"
                    value={settings.loginBanner?.brandName ?? 'Quemint'}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        loginBanner: {
                          ...settings.loginBanner,
                          brandName: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Top Small Label
                  </label>
                  <input
                    type="text"
                    value={
                      settings.loginBanner?.topSmallLabel ??
                      'MEDICAL & ENGINEERING · ART & COMMERCIAL'
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        loginBanner: {
                          ...settings.loginBanner,
                          topSmallLabel: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Main Title
                  </label>
                  <textarea
                    rows={2}
                    value={
                      settings.loginBanner?.mainTitle ??
                      'Quemint Rapid Test Practice.'
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        loginBanner: {
                          ...settings.loginBanner,
                          mainTitle: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={
                      settings.loginBanner?.description ??
                      'A focused exam environment built to help you prepare with confidence.'
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        loginBanner: {
                          ...settings.loginBanner,
                          description: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Footer Info
                  </label>
                  <input
                    type="text"
                    value={
                      settings.loginBanner?.footerInfo ??
                      `Timed Questions · ${settings.durationMinutes} minutes · Secure testing`
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        loginBanner: {
                          ...settings.loginBanner,
                          footerInfo: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    triggerToast('Login Page Banner settings saved and live.')
                  }
                  className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
                >
                  Save
                </button>
              </div>
            </section>

            {/* CARD 1B: Brand Colors & Visual Identity */}
            <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#0a6b3c]" />
                    <h2 className="text-lg font-extrabold text-black">
                      Brand Colors &amp; Visual Identity
                    </h2>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold uppercase tracking-wider">
                    PORTAL-WIDE BRAND THEME
                  </span>
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Customize the Primary and Secondary (Hover / Accent) brand colors used across the Candidate Login page, Registration portal, Examination interface, Result Slips, and Admin Dashboard.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-2.5">
                  <label className="block text-xs font-extrabold text-neutral-800">
                    Primary Brand Color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings.brandColors?.primary || '#0a6b3c'}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          brandColors: {
                            primary: e.target.value,
                            secondary:
                              settings.brandColors?.secondary || '#0e8a4e',
                          },
                        })
                      }
                      className="w-12 h-11 rounded-xl border border-neutral-300 cursor-pointer p-0.5 bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={settings.brandColors?.primary || '#0a6b3c'}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          brandColors: {
                            primary: e.target.value,
                            secondary:
                              settings.brandColors?.secondary || '#0e8a4e',
                          },
                        })
                      }
                      placeholder="#0a6b3c"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs font-extrabold text-black bg-white uppercase"
                    />
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    Used for headers, official seal, primary buttons, badges, and borders.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-2.5">
                  <label className="block text-xs font-extrabold text-neutral-800">
                    Secondary / Hover Brand Color
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={settings.brandColors?.secondary || '#0e8a4e'}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          brandColors: {
                            primary: settings.brandColors?.primary || '#0a6b3c',
                            secondary: e.target.value,
                          },
                        })
                      }
                      className="w-12 h-11 rounded-xl border border-neutral-300 cursor-pointer p-0.5 bg-white shrink-0"
                    />
                    <input
                      type="text"
                      value={settings.brandColors?.secondary || '#0e8a4e'}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          brandColors: {
                            primary: settings.brandColors?.primary || '#0a6b3c',
                            secondary: e.target.value,
                          },
                        })
                      }
                      placeholder="#0e8a4e"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs font-extrabold text-black bg-white uppercase"
                    />
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    Used for button hover states, highlights, and secondary accents.
                  </p>
                </div>
              </div>

              {/* Curated Brand Color Presets */}
              <div className="space-y-2">
                <span className="block text-xs font-extrabold text-neutral-700">
                  Quick Brand Color Presets
                </span>
                <div className="flex flex-wrap gap-2">
                  {[
                    {
                      name: 'Quemint Emerald (Default)',
                      primary: '#0a6b3c',
                      secondary: '#0e8a4e',
                    },
                    {
                      name: 'Royal Blue',
                      primary: '#1e40af',
                      secondary: '#2563eb',
                    },
                    {
                      name: 'Imperial Purple',
                      primary: '#5b21b6',
                      secondary: '#7c3aed',
                    },
                    {
                      name: 'Crimson Maroon',
                      primary: '#991b1b',
                      secondary: '#dc2626',
                    },
                    {
                      name: 'Teal Ocean',
                      primary: '#0f766e',
                      secondary: '#0d9488',
                    },
                    {
                      name: 'Navy Slate',
                      primary: '#0f172a',
                      secondary: '#334155',
                    },
                    {
                      name: 'Amber Gold',
                      primary: '#b45309',
                      secondary: '#d97706',
                    },
                  ].map((preset) => {
                    const isCurrent =
                      (settings.brandColors?.primary || '#0a6b3c').toLowerCase() ===
                      preset.primary.toLowerCase();
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            ...settings,
                            brandColors: {
                              primary: preset.primary,
                              secondary: preset.secondary,
                            },
                          });
                          triggerToast(`Brand color updated to ${preset.name}!`);
                        }}
                        className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer ${
                          isCurrent
                            ? 'border-[#0a6b3c] bg-[#0a6b3c]/10 text-[#0a6b3c]'
                            : 'border-neutral-300 bg-white hover:bg-neutral-50 text-black'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-black/15 shrink-0"
                          style={{ backgroundColor: preset.primary }}
                        />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onUpdateSettings({
                      ...settings,
                      brandColors: {
                        primary: '#0a6b3c',
                        secondary: '#0e8a4e',
                      },
                    });
                    triggerToast('Brand colors reset to default Quemint Green (#0a6b3c).');
                  }}
                  className="px-4 py-3 rounded-xl border border-neutral-300 hover:border-black text-xs font-bold text-neutral-700 hover:text-black cursor-pointer"
                >
                  Reset to Default Green
                </button>

                <button
                  type="button"
                  onClick={() =>
                    triggerToast('Brand colors saved and applied across all pages!')
                  }
                  className="flex-1 sm:flex-none px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
                >
                  Save Brand Colors
                </button>
              </div>
            </section>

            {/* CARD 2: Exam Configuration & Result Titles (Screenshot_20261023-163247_d5713fc8.png) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-extrabold text-black">
                    Exam Configuration &amp; Result Titles
                  </h2>
                  <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold uppercase tracking-wider">
                    DYNAMIC RESULT VIEW
                  </span>
                </div>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Set the test title and subtitles shown on candidate result slips, exam screens, and login portal. When edited, changes reflect on student result view instantly.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Test Title <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={settings.resultTitles?.testTitle ?? 'Quemint'}
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        resultTitles: {
                          ...settings.resultTitles,
                          testTitle: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                  <p className="text-[11px] text-neutral-400 mt-1">
                    First word is styled green, rest in bold on the result slip.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Test Subtitle / Result Subtitle{' '}
                    <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={settings.resultTitles?.testSubtitle ?? 'Rapid Test'}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNewTestTitle(val);
                      onUpdateSettings({
                        ...settings,
                        resultTitles: {
                          ...settings.resultTitles,
                          testSubtitle: val,
                        },
                      });
                    }}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                  <p className="text-[11px] text-neutral-400 mt-1">
                    e.g. &quot;Mock Exam Result&quot; appended to title.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Assessment Subtitle <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={
                      settings.resultTitles?.assessmentSubtitle ??
                      'Quemint Education Board Assessment'
                    }
                    onChange={(e) =>
                      onUpdateSettings({
                        ...settings,
                        resultTitles: {
                          ...settings.resultTitles,
                          assessmentSubtitle: e.target.value,
                        },
                      })
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-semibold text-black"
                  />
                  <p className="text-[11px] text-neutral-400 mt-1">
                    Secondary gray subtitle shown beneath the result title.
                  </p>
                </div>

                {/* STUDENT RESULT SLIP HEADER LIVE PREVIEW */}
                <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-5 text-center space-y-1">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-400">
                    STUDENT RESULT SLIP HEADER LIVE PREVIEW
                  </div>
                  <div className="text-xl font-extrabold text-black pt-1">
                    <span className="text-[#0a6b3c]">
                      {settings.resultTitles?.testTitle || 'Quemint'}
                    </span>{' '}
                    <span>{settings.resultTitles?.testSubtitle || 'Rapid Test'}</span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {settings.resultTitles?.assessmentSubtitle ||
                      'Quemint Education Board Assessment'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    triggerToast(
                      'Exam Configuration & Result Titles saved! Live on student result slips.'
                    )
                  }
                  className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
                >
                  Save exam title &amp; subtitles
                </button>
              </div>

              {/* DYNAMIC CANDIDATE RESULT SLIP INFORMATION CONFIGURATOR */}
              <div className="pt-6 border-t border-neutral-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      <FileText className="w-4 h-4" />
                      <span>DYNAMIC CANDIDATE RESULT SLIP INFORMATION</span>
                    </div>
                    <h3 className="text-base font-extrabold text-black mt-0.5">
                      Add or Remove Registration Details Shown on Result Slips
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Toggle which candidate registration details appear on the candidate result slip and PDF. By default, <strong>Examination Centre</strong>, <strong>Course</strong>, <strong>State of Origin</strong>, and <strong>Current Ranking</strong> are enabled. Note: <strong>Current Ranking</strong> only appears on candidate results when you click <strong>Publish Ranking</strong> on that exam.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateSettings({
                        ...settings,
                        resultSlipFields: DEFAULT_RESULT_SLIP_FIELDS,
                      });
                      triggerToast('Result slip fields reset to official defaults!');
                    }}
                    className="px-3 py-1.5 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-xs font-extrabold text-neutral-700 hover:text-[#0a6b3c] cursor-pointer"
                  >
                    Reset Fields to Default
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {effectiveResultSlipFields.map((field) => (
                    <div
                      key={field.key}
                      className={`p-3.5 rounded-2xl border-2 flex flex-col justify-between gap-2.5 transition-all ${
                        field.enabled
                          ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                          : 'border-neutral-200 bg-neutral-50 opacity-75'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={field.enabled}
                            onChange={() => handleToggleResultSlipField(field.key)}
                            className="w-4 h-4 accent-[#0a6b3c] cursor-pointer"
                          />
                          <span className="text-xs font-extrabold text-black">
                            {field.label}
                          </span>
                        </label>
                        {field.isCustom ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomResultSlipField(field.key)}
                            className="p-1 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Remove custom field"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              field.enabled
                                ? 'bg-[#0a6b3c] text-white'
                                : 'bg-neutral-200 text-neutral-600'
                            }`}
                          >
                            {field.enabled ? 'Shown' : 'Hidden'}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-neutral-500 shrink-0">
                          Slip Label:
                        </span>
                        <input
                          type="text"
                          value={field.label}
                          onChange={(e) =>
                            handleUpdateResultSlipFieldLabel(field.key, e.target.value)
                          }
                          className="w-full px-2 py-1 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-[11px] font-bold bg-white text-black"
                        />
                      </div>

                      {field.key === 'currentRanking' && (
                        <div className="text-[10px] font-bold text-[#0a6b3c] bg-white/80 px-2 py-1 rounded border border-[#0a6b3c]/25">
                          Requires &quot;Publish Ranking&quot; active on the exam to show on candidate results.
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add Custom Information Field to Result Slip */}
                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3">
                  <div className="text-xs font-extrabold text-black">
                    + Add Additional Custom Information Field to Candidate Result Slip
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      type="text"
                      value={customSlipFieldLabel}
                      onChange={(e) => setCustomSlipFieldLabel(e.target.value)}
                      placeholder="Field Label (e.g., Academic Session, Batch)"
                      className="px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs font-semibold text-black bg-white"
                    />
                    <input
                      type="text"
                      value={customSlipFieldValue}
                      onChange={(e) => setCustomSlipFieldValue(e.target.value)}
                      placeholder="Value / Default Text (e.g., 2026/2027 Session)"
                      className="px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs font-semibold text-black bg-white"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomResultSlipField}
                      className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Field to Result Slip</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* CARD 3: Exam Control (Screenshot_20261023-163247_d5713fc8.png) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-4">
              <h2 className="text-lg font-extrabold text-black">Exam Control</h2>

              <div
                className={`p-4 rounded-2xl border flex items-center gap-3.5 ${
                  settings.examOpen
                    ? 'bg-[#0a6b3c]/8 border-[#0a6b3c]/30'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div
                  className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-white ${
                    settings.examOpen ? 'bg-[#0a6b3c]' : 'bg-red-600'
                  }`}
                >
                  {settings.examOpen ? (
                    <Unlock className="w-5 h-5" />
                  ) : (
                    <Lock className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div
                    className={`text-sm font-extrabold uppercase ${
                      settings.examOpen ? 'text-[#0a6b3c]' : 'text-red-700'
                    }`}
                  >
                    {settings.examOpen ? 'EXAM IS OPEN' : 'EXAM IS CLOSED'}
                  </div>
                  <div
                    className={`text-xs ${
                      settings.examOpen ? 'text-[#0a6b3c]' : 'text-red-600'
                    }`}
                  >
                    {settings.examOpen
                      ? 'Candidates can login and take the exam.'
                      : 'Candidates cannot start the exam while closed.'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const nextOpen = !settings.examOpen;
                  onUpdateSettings({ ...settings, examOpen: nextOpen });
                  triggerToast(
                    nextOpen
                      ? 'Exam is now OPEN for candidates!'
                      : 'Exam has been CLOSED.'
                  );
                }}
                className={`w-full py-3.5 px-6 rounded-xl text-white text-xs md:text-sm font-extrabold uppercase tracking-wider transition-colors cursor-pointer ${
                  settings.examOpen
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                }`}
              >
                {settings.examOpen ? 'CLOSE EXAM NOW' : 'OPEN EXAM NOW'}
              </button>

              {/* Candidate Registration Control inside Settings / Create Exam */}
              <div className="pt-4 border-t border-neutral-200 space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                    <UserPlus className="w-3.5 h-3.5 text-[#0a6b3c]" />
                    <span>REGISTRATION CONTROL</span>
                  </div>
                  <h3 className="text-base font-extrabold text-black">
                    Open or Close Candidate Registration
                  </h3>
                </div>

                <div
                  className={`p-4 rounded-2xl border flex items-center gap-3.5 ${
                    (settings.registrationOpen ?? true)
                      ? 'bg-[#0a6b3c]/5 border-[#0a6b3c]/30'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      (settings.registrationOpen ?? true)
                        ? 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                        : 'bg-red-100 text-red-600'
                    }`}
                  >
                    {(settings.registrationOpen ?? true) ? (
                      <Unlock className="w-5 h-5" />
                    ) : (
                      <Lock className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <div
                      className={`text-sm font-extrabold uppercase ${
                        (settings.registrationOpen ?? true)
                          ? 'text-[#0a6b3c]'
                          : 'text-red-700'
                      }`}
                    >
                      {(settings.registrationOpen ?? true)
                        ? 'REGISTRATION IS OPEN'
                        : 'REGISTRATION IS CLOSED'}
                    </div>
                    <div
                      className={`text-xs ${
                        (settings.registrationOpen ?? true)
                          ? 'text-[#0a6b3c]'
                          : 'text-red-600'
                      }`}
                    >
                      {(settings.registrationOpen ?? true)
                        ? 'Candidates can click Register on the landing interface to register.'
                        : 'When candidates click Register on the landing interface, it shows closed.'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const nextRegOpen = !(settings.registrationOpen ?? true);
                    onUpdateSettings({ ...settings, registrationOpen: nextRegOpen });
                    triggerToast(
                      nextRegOpen
                        ? 'Candidate Registration is now OPEN!'
                        : 'Candidate Registration has been CLOSED.'
                    );
                  }}
                  className={`w-full py-3.5 px-6 rounded-xl text-white text-xs md:text-sm font-extrabold uppercase tracking-wider transition-colors cursor-pointer ${
                    (settings.registrationOpen ?? true)
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#0a6b3c] hover:bg-[#0e8a4e]'
                  }`}
                >
                  {(settings.registrationOpen ?? true)
                    ? 'CLOSE REGISTRATION NOW'
                    : 'OPEN REGISTRATION NOW'}
                </button>

                {/* REGISTRATION SETTINGS: Require Photo Card During Registration (ON/OFF, default OFF) */}
                <div className="pt-4 border-t border-neutral-200 space-y-3">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    <Camera className="w-3.5 h-3.5" />
                    <span>REGISTRATION SETTINGS</span>
                  </div>

                  <div className="p-4 rounded-2xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-black">
                          Require Photo Card During Registration
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            Boolean(settings.requirePhotoCardDuringRegistration)
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-neutral-200 text-neutral-700'
                          }`}
                        >
                          {Boolean(settings.requirePhotoCardDuringRegistration)
                            ? 'ON (Compulsory)'
                            : 'OFF (Default)'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600 leading-relaxed">
                        {Boolean(settings.requirePhotoCardDuringRegistration)
                          ? 'ON: Adds the Live Photo Capture step during registration, blocks registration submission until 1 face is detected inside the oval guide and captured via live camera, and saves the photo to the candidate profile.'
                          : 'OFF: Skips photo capture during registration so registration completes immediately, and shows an optional "Add your Photo Card (optional)" banner in the candidate dashboard.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(settings.requirePhotoCardDuringRegistration)}
                      onClick={() => {
                        const nextVal = !Boolean(
                          settings.requirePhotoCardDuringRegistration
                        );
                        onUpdateSettings({
                          ...settings,
                          requirePhotoCardDuringRegistration: nextVal,
                        });
                        triggerToast(
                          nextVal
                            ? 'Require Photo Card During Registration: ON (Live Camera Capture required).'
                            : 'Require Photo Card During Registration: OFF (Skipped during registration).'
                        );
                      }}
                      className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/10 transition-colors cursor-pointer shrink-0 self-start sm:self-center"
                    >
                      <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                        {Boolean(settings.requirePhotoCardDuringRegistration)
                          ? 'ON'
                          : 'OFF'}
                      </span>
                      <span
                        className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                          Boolean(settings.requirePhotoCardDuringRegistration)
                            ? 'bg-[#0a6b3c] justify-end'
                            : 'bg-neutral-300 justify-start'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                      </span>
                    </button>
                  </div>

                  {/* Toggle 5: Enable AI Evaluation for TYA */}
                  <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-extrabold text-black">
                          Enable AI Evaluation for TYA (&quot;Type Your Answers&quot;)
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                            settings.enableAiEvaluationForTya !== false
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-neutral-200 text-neutral-700'
                          }`}
                        >
                          {settings.enableAiEvaluationForTya !== false ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600">
                        When ON (default), TYA responses that do not match the exact Answer Key string are automatically evaluated by the AI Examiner for scientific equivalence, synonyms, and spelling variations (e.g.,{' '}
                        <span className="font-bold text-[#0a6b3c]">
                          Thylakoid membrane = Grana
                        </span>
                        ).
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextVal = !(settings.enableAiEvaluationForTya !== false);
                        onUpdateSettings({
                          ...settings,
                          enableAiEvaluationForTya: nextVal,
                        });
                        triggerToast(
                          nextVal
                            ? 'AI Evaluation for TYA: ON (Scientific equivalence & AI explanations enabled).'
                            : 'AI Evaluation for TYA: OFF (Exact string match only).'
                        );
                      }}
                      className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/10 transition-colors cursor-pointer shrink-0 self-start sm:self-center"
                    >
                      <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                        {settings.enableAiEvaluationForTya !== false ? 'ON' : 'OFF'}
                      </span>
                      <span
                        className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center ${
                          settings.enableAiEvaluationForTya !== false
                            ? 'bg-[#0a6b3c] justify-end'
                            : 'bg-neutral-300 justify-start'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full bg-white shadow-xs" />
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* TASK 1: ADMIN PANEL > SETTINGS > EXAM FLOW SETTINGS */}
            <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    <Settings className="w-4 h-4" />
                    <span>ADMIN PANEL &gt; SETTINGS &gt; EXAM FLOW SETTINGS</span>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 text-[#0a6b3c] font-mono text-[10px] font-extrabold">
                    system_settings: exam_start_flow = &quot;{examStartFlowDraft}&quot;
                  </span>
                </div>
                <h2 className="text-lg font-extrabold text-black">
                  Exam Start Behaviour
                </h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Choose what happens after student enters correct password
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option 1: Go to Dashboard First (Recommended) */}
                <label
                  onClick={() => setExamStartFlowDraft('dashboard_first')}
                  className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                    examStartFlowDraft === 'dashboard_first'
                      ? 'border-[#0a6b3c] bg-[#0a6b3c]/8 shadow-xs'
                      : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="exam_start_flow"
                          checked={examStartFlowDraft === 'dashboard_first'}
                          onChange={() => setExamStartFlowDraft('dashboard_first')}
                          className="w-4 h-4 accent-[#0a6b3c] cursor-pointer"
                        />
                        <span className="text-sm font-extrabold text-black">
                          Option 1: Go to Dashboard First (Recommended)
                        </span>
                      </div>
                    </div>
                    <div className="pl-6 space-y-1">
                      <div className="text-xs font-extrabold text-[#0a6b3c]">
                        Students go to dashboard first before exam
                      </div>
                      <p className="text-xs text-neutral-600 leading-relaxed">
                        After password correct, show candidate portal with name, course, selected subjects, category, exam center, instructions, then &quot;Start Exam Now&quot; button.
                      </p>
                    </div>
                  </div>
                  <div className="pl-6 flex items-center justify-between pt-2 border-t border-neutral-200/80">
                    <span className="font-mono text-[10px] font-bold text-neutral-500">
                      Route: /candidate/[id]/portal
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#0a6b3c] text-white font-mono text-[10px] font-extrabold">
                      dashboard_first
                    </span>
                  </div>
                </label>

                {/* Option 2: Start Exam Immediately */}
                <label
                  onClick={() => setExamStartFlowDraft('immediate')}
                  className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between gap-3 ${
                    examStartFlowDraft === 'immediate'
                      ? 'border-[#0a6b3c] bg-[#0a6b3c]/8 shadow-xs'
                      : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="radio"
                          name="exam_start_flow"
                          checked={examStartFlowDraft === 'immediate'}
                          onChange={() => setExamStartFlowDraft('immediate')}
                          className="w-4 h-4 accent-[#0a6b3c] cursor-pointer"
                        />
                        <span className="text-sm font-extrabold text-black">
                          Option 2: Start Exam Immediately
                        </span>
                      </div>
                    </div>
                    <div className="pl-6 space-y-1">
                      <div className="text-xs font-extrabold text-[#0a6b3c]">
                        Students start exam immediately
                      </div>
                      <p className="text-xs text-neutral-600 leading-relaxed">
                        After password correct, skip dashboard and start exam directly.
                      </p>
                    </div>
                  </div>
                  <div className="pl-6 flex items-center justify-between pt-2 border-t border-neutral-200/80">
                    <span className="font-mono text-[10px] font-bold text-neutral-500">
                      Route: /exam/[id]
                    </span>
                    <span className="px-2 py-0.5 rounded bg-neutral-800 text-white font-mono text-[10px] font-extrabold">
                      immediate
                    </span>
                  </div>
                </label>
              </div>

              <button
                type="button"
                onClick={handleSaveExamStartFlow}
                className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Exam Start Behaviour</span>
              </button>
            </section>

            {/* TASK 3: ADMIN > SETTINGS > DEFAULT CANDIDATE PASSWORD */}
            <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    <KeyRound className="w-4 h-4" />
                    <span>ADMIN &gt; SETTINGS &gt; DEFAULT CANDIDATE PASSWORD</span>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 text-[#0a6b3c] font-mono text-[10px] font-extrabold">
                    system_settings: default_candidate_password
                  </span>
                </div>
                <h2 className="text-lg font-extrabold text-black">
                  Default Candidate Password (Master Password)
                </h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Set ONE master password for ALL candidates. When a student clicks <strong>Start Exams</strong> and the <strong>Verify Identity</strong> modal appears, they can enter either their personal registration password or this Admin Default Master Password. Saved hashed in <code className="font-mono font-bold text-black">system_settings</code>.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-extrabold text-neutral-800">
                  Master Password for All Candidates
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative flex-1">
                    <input
                      type={showDefaultCandidatePassword ? 'text' : 'password'}
                      value={defaultCandidatePasswordDraft}
                      onChange={(e) =>
                        setDefaultCandidatePasswordDraft(e.target.value)
                      }
                      placeholder="Enter master password for all candidates..."
                      className="w-full pl-4 pr-11 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-mono font-extrabold text-black bg-neutral-50"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowDefaultCandidatePassword((prev) => !prev)
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-neutral-500 hover:text-black cursor-pointer"
                      title={
                        showDefaultCandidatePassword
                          ? 'Hide password'
                          : 'Show password'
                      }
                    >
                      {showDefaultCandidatePassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveDefaultCandidatePassword}
                    className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-2 shrink-0"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Save Default Password</span>
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-neutral-600">
                    Stored SHA-256 Hash (<code className="font-mono text-[#0a6b3c]">default_candidate_password</code>):
                  </span>
                  <span className="font-mono text-neutral-800 truncate max-w-md">
                    {settings.defaultCandidatePasswordHash ||
                      simpleFallbackHash(
                        settings.defaultCandidatePassword || 'quemint2026'
                      )}
                  </span>
                </div>
              </div>
            </section>

            {/* CARD 3B: Subject Combination Name (Category) & Assigned Subjects Manager */}
            <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  <Layers className="w-4 h-4" />
                  <span>SUBJECT COMBINATION NAME (CATEGORY) &amp; SUBJECT ASSIGNMENT</span>
                </div>
                <h2 className="text-lg font-extrabold text-black">
                  Add or Edit Subject Combinations (Categories)
                </h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Add a Subject Combination Name (Category) such as <strong>Medical</strong>, <strong>Engineering</strong>, <strong>Art</strong>, or <strong>Commercial</strong>, and pick the subjects for that combination. When a student falls under that Subject Combination Name (Category), they will only see exams and questions from the subjects assigned to their combination.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    {editingComboId
                      ? 'Editing Subject Combination (Category)'
                      : 'Create New Subject Combination (Category)'}
                  </span>
                  {editingComboId && (
                    <button
                      type="button"
                      onClick={handleCancelEditCombination}
                      className="text-xs font-bold text-neutral-600 hover:text-black underline cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-4">
                    <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                      Subject Combination Name (Category)
                    </label>
                    <input
                      type="text"
                      value={comboNameInput}
                      onChange={(e) => setComboNameInput(e.target.value)}
                      placeholder="e.g. Medical, Nursing, Law..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs md:text-sm font-bold text-black bg-white"
                    />
                  </div>

                  <div className="md:col-span-8 space-y-2.5">
                    <label className="block text-xs font-extrabold text-neutral-800">
                      Pick Subjects to Include in this Combination ({comboSubjectsInput.length} selected)
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {allAvailableSubjects.map((subj) => {
                        const isPicked = comboSubjectsInput.some(
                          (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                        );
                        return (
                          <button
                            key={subj}
                            type="button"
                            onClick={() => handleToggleComboSubjectDraft(subj)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center gap-1.5 border transition-colors cursor-pointer ${
                              isPicked
                                ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                                : 'bg-white text-neutral-700 border-neutral-300 hover:border-[#0a6b3c]'
                            }`}
                          >
                            {isPicked && <Check className="w-3.5 h-3.5" />}
                            <span>{subj}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 pt-1 max-w-sm">
                      <input
                        type="text"
                        value={customSubjectDraft}
                        onChange={(e) => setCustomSubjectDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCustomSubjectToDraft();
                          }
                        }}
                        placeholder="Or type a new subject name..."
                        className="flex-1 px-3 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] text-xs bg-white text-black"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomSubjectToDraft}
                        className="px-3 py-1.5 rounded-lg border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c] hover:text-white text-xs font-extrabold cursor-pointer whitespace-nowrap"
                      >
                        + Add Subject
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  {editingComboId && (
                    <button
                      type="button"
                      onClick={handleCancelEditCombination}
                      className="px-4 py-2.5 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-100 text-black text-xs font-extrabold cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveSubjectCombination}
                    className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {editingComboId
                        ? 'Save Updated Subject Combination (Category)'
                        : 'Save Subject Combination (Category)'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {subjectCombinations.map((combo) => {
                  const isEditingThis = editingComboId === combo.id;
                  return (
                    <div
                      key={combo.id}
                      className={`p-4 rounded-2xl border space-y-3 flex flex-col justify-between transition-all ${
                        isEditingThis
                          ? 'border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 shadow-sm'
                          : 'border-neutral-200 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          {isEditingThis ? (
                            <div className="space-y-1.5">
                              <label className="block text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                                Rename Category / Combination:
                              </label>
                              <input
                                type="text"
                                value={comboNameInput}
                                onChange={(e) => setComboNameInput(e.target.value)}
                                className="w-full px-3 py-1.5 rounded-lg border-2 border-[#0a6b3c] bg-white text-xs font-extrabold text-black focus:outline-none"
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-xs font-extrabold">
                                {combo.name}
                              </span>
                              <span className="text-[11px] font-bold text-neutral-500">
                                {combo.subjects.length} Subjects
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isEditingThis ? (
                            <>
                              <button
                                type="button"
                                onClick={handleSaveSubjectCombination}
                                className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                              >
                                <Check className="w-3 h-3" />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEditCombination}
                                className="px-2.5 py-1.5 rounded-lg border border-neutral-300 bg-white text-[11px] font-bold text-neutral-700 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleStartEditCombination(combo)}
                              className="px-2.5 py-1 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] text-[11px] font-extrabold text-black flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3 text-[#0a6b3c]" />
                              <span>Edit</span>
                            </button>
                          )}
                          {subjectCombinations.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteSubjectCombination(combo.id)}
                              className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                              title="Delete Subject Combination"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] font-bold text-neutral-500">
                          Assigned Subjects for{' '}
                          <strong>{isEditingThis ? comboNameInput || combo.name : combo.name}</strong> (click to toggle immediately):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {allAvailableSubjects.map((subj) => {
                            const active = isEditingThis
                              ? comboSubjectsInput.some(
                                  (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                                )
                              : combo.subjects.some(
                                  (s) => s.trim().toLowerCase() === subj.trim().toLowerCase()
                                );
                            return (
                              <button
                                key={subj}
                                type="button"
                                onClick={() =>
                                  handleToggleSubjectOnExistingCombo(combo.id, subj)
                                }
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border transition-colors cursor-pointer flex items-center gap-1 ${
                                  active
                                    ? 'bg-[#0a6b3c]/10 border-[#0a6b3c] text-[#0a6b3c]'
                                    : 'bg-neutral-50 border-neutral-200 text-neutral-400 hover:text-black'
                                }`}
                              >
                                {active && <Check className="w-3 h-3" />}
                                <span>{subj}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* CARD 4: Test Code Generation & Publish Test to Candidate Portal */}
            <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  <Sparkles className="w-4 h-4" />
                  <span>REQUIREMENT #2: EXAM ACCESS AUTHENTICATION &amp; TEST PUBLISHING</span>
                </div>
                <h2 className="text-lg font-extrabold text-black">
                  Test Code Generation &amp; Publish Test
                </h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Create and publish tests below. Once you click <strong>Publish Test</strong>, whenever a registered candidate logs in with their Registration Number and clicks <strong>Start examination</strong>, they immediately see the published test filtered to the subjects in their Subject Combination (Category).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Test Name / Title
                  </label>
                  <input
                    type="text"
                    value={newTestTitle}
                    onChange={(e) => setNewTestTitle(e.target.value)}
                    placeholder="e.g. Rapid Test"
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Target Subject Combination (Category)
                  </label>
                  <select
                    value={newTestCategory}
                    onChange={(e) =>
                      setNewTestCategory(e.target.value as CategoryType | 'All')
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs md:text-sm font-bold text-black bg-white"
                  >
                    <option value="All">
                      All Subject Combinations ({subjectCombinations.map((c) => c.name).join(', ')})
                    </option>
                    {subjectCombinations.map((combo) => (
                      <option key={combo.id} value={combo.name}>
                        {combo.name} Only ({combo.subjects.join(', ')})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Active Test Code
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={settings.testAccessCode || 'RAPID-2026-QMT'}
                      onChange={(e) =>
                        onUpdateSettings({
                          ...settings,
                          testAccessCode: e.target.value.toUpperCase(),
                        })
                      }
                      className="flex-1 px-4 py-2.5 rounded-xl border border-neutral-300 font-mono text-xs md:text-sm font-extrabold text-[#0a6b3c]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const randomCode = `RAPID-${Math.floor(1000 + Math.random() * 9000)}-QMT`;
                        onUpdateSettings({
                          ...settings,
                          testAccessCode: randomCode,
                        });
                      }}
                      className="px-3.5 py-2.5 rounded-xl bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-[#0a6b3c] text-xs font-extrabold cursor-pointer whitespace-nowrap"
                    >
                      Generate
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Examination Deadline
                  </label>
                  <input
                    type="text"
                    value={newTestDeadline}
                    onChange={(e) => setNewTestDeadline(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-neutral-300 font-mono text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Test Duration (in Minutes) — Type Any Duration You Want
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative flex-1 max-w-xs">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={durationInputStr}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, '');
                          setDurationInputStr(raw);
                        }}
                        placeholder="Enter duration in minutes (e.g. 25, 45, 120)"
                        className="w-full px-4 py-2.5 pr-20 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-sm font-extrabold text-[#0a6b3c] bg-white"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-neutral-500 pointer-events-none">
                        minutes
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Type any duration in minutes (not bound to any preset) and click <strong>Publish Test to Candidate Portal</strong> below.
                  </p>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-extrabold text-neutral-800 mb-1.5">
                    Number of Attempts Permitted per Candidate
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setNewTestMaxAttempts((prev) => Math.max(1, prev - 1))
                        }
                        className="w-10 h-10 rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-black font-extrabold text-base flex items-center justify-center cursor-pointer"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={newTestMaxAttempts}
                        onChange={(e) =>
                          setNewTestMaxAttempts(
                            Math.max(1, Math.min(99, Number(e.target.value) || 1))
                          )
                        }
                        className="w-24 px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-center font-mono text-sm font-extrabold text-[#0a6b3c]"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setNewTestMaxAttempts((prev) => Math.min(99, prev + 1))
                        }
                        className="w-10 h-10 rounded-xl border border-neutral-300 bg-neutral-50 hover:bg-neutral-100 text-black font-extrabold text-base flex items-center justify-center cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[1, 2, 3, 5, 10].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setNewTestMaxAttempts(preset)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-extrabold cursor-pointer transition-colors ${
                            newTestMaxAttempts === preset
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-[#0a6b3c]/10 text-[#0a6b3c] hover:bg-[#0a6b3c]/20'
                          }`}
                        >
                          {preset} {preset === 1 ? 'Attempt' : 'Attempts'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Controls how many times a candidate can take this published test before their Start button locks.
                  </p>
                </div>
              </div>

              {/* Publish Action Button */}
              <button
                type="button"
                onClick={() => {
                  const pooling = settings.subjectPooling || [];
                  const allocations: Record<string, number> = {};
                  let totalQ = 0;

                  const selectedCombo =
                    newTestCategory !== 'All'
                      ? subjectCombinations.find(
                          (c) =>
                            c.name.trim().toLowerCase() ===
                            newTestCategory.trim().toLowerCase()
                        )
                      : null;

                  const targetSubjs = selectedCombo
                    ? selectedCombo.subjects
                    : allAvailableSubjects;

                  targetSubjs.forEach((subj) => {
                    const poolCfg = pooling.find(
                      (sp) => sp.subject.trim().toLowerCase() === subj.trim().toLowerCase()
                    );
                    const availCount = questions.filter(
                      (q) => q.subject.trim().toLowerCase() === subj.trim().toLowerCase()
                    ).length;
                    const count =
                      poolCfg && poolCfg.subjectTotal > 0
                        ? poolCfg.subjectTotal
                        : availCount > 0
                        ? Math.min(10, availCount)
                        : 0;
                    if (count > 0) {
                      allocations[subj] = count;
                      totalQ += count;
                    }
                  });

                  if (totalQ === 0) {
                    allocations['English'] = 10;
                    allocations['Biology'] = 10;
                    allocations['Physics'] = 5;
                    allocations['Chemistry'] = 5;
                    totalQ = 30;
                  }

                  const cleanTitle =
                    newTestTitle.trim() ||
                    settings.resultTitles?.testSubtitle ||
                    'Rapid Test';

                  const permittedAttempts = Math.max(
                    1,
                    Math.min(99, Number(newTestMaxAttempts) || 1)
                  );

                  const parsedTypedDuration = parseInt(durationInputStr.trim(), 10);
                  const customDurationMinutes =
                    !isNaN(parsedTypedDuration) && parsedTypedDuration >= 1
                      ? parsedTypedDuration
                      : settings.durationMinutes || 30;
                  setDurationInputStr(String(customDurationMinutes));

                  const newPublished: PublishedTest = {
                    id: `test-${Date.now()}`,
                    title: cleanTitle,
                    testCode: settings.testAccessCode || 'RAPID-2026-QMT',
                    category: newTestCategory,
                    durationMinutes: customDurationMinutes,
                    deadline: newTestDeadline,
                    subjectAllocations: allocations,
                    totalQuestions: totalQ,
                    published: true,
                    requireFullscreen: true,
                    requireCamera: settings.proctoringEnabled,
                    maxAttempts: permittedAttempts,
                    createdAt: new Date().toISOString(),
                  };

                  const existingTests = settings.publishedTests || [];
                  const sameTitleIdx = existingTests.findIndex(
                    (t) =>
                      t.title.toLowerCase() === cleanTitle.toLowerCase() &&
                      t.category === newTestCategory
                  );

                  let updatedTests: PublishedTest[];
                  if (sameTitleIdx >= 0) {
                    const targetId = existingTests[sameTitleIdx].id;
                    updatedTests = existingTests.map((t, i) =>
                      i === sameTitleIdx ? { ...newPublished, id: targetId } : t
                    );
                    setPublishedTestDurationDrafts((prev) => ({
                      ...prev,
                      [targetId]: String(customDurationMinutes),
                    }));
                  } else {
                    updatedTests = [newPublished, ...existingTests];
                  }

                  const currentFooter =
                    settings.loginBanner?.footerInfo ||
                    `Timed Questions · ${customDurationMinutes} minutes · Secure testing`;
                  const updatedFooter = currentFooter.replace(
                    /\b\d+\s*minutes?\b/i,
                    `${customDurationMinutes} minutes`
                  );

                  onUpdateSettings({
                    ...settings,
                    examOpen: true,
                    durationMinutes: customDurationMinutes,
                    loginBanner: {
                      ...settings.loginBanner,
                      footerInfo: updatedFooter,
                    },
                    resultTitles: {
                      ...settings.resultTitles,
                      testSubtitle: cleanTitle,
                    },
                    publishedTests: updatedTests,
                  });

                  triggerToast(
                    `Test "${cleanTitle}" (${newPublished.testCode}) is now PUBLISHED with duration ${customDurationMinutes} mins and ${permittedAttempts} permitted ${permittedAttempts === 1 ? 'attempt' : 'attempts'}!`
                  );
                }}
                className="w-full py-4 px-6 rounded-2xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
              >
                <Send className="w-4 h-4" />
                <span>Publish Test to Candidate Portal</span>
              </button>

              {/* Published Tests List */}
              <div className="pt-3 border-t border-neutral-200 space-y-2.5">
                <div className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">
                  Published &amp; Created Tests ({(settings.publishedTests || []).length})
                </div>
                {(settings.publishedTests || []).map((pt) => {
                  const currentMaxAttempts = pt.maxAttempts ?? 1;
                  const draftDur =
                    publishedTestDurationDrafts[pt.id] !== undefined
                      ? publishedTestDurationDrafts[pt.id]
                      : String(pt.durationMinutes || settings.durationMinutes || 30);
                  return (
                    <div
                      key={pt.id}
                      className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-sm text-black">
                            {pt.title}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#0a6b3c]/15 text-[#0a6b3c] font-mono text-[11px] font-extrabold">
                            {pt.testCode}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                              pt.published
                                ? 'bg-[#0a6b3c] text-white'
                                : 'bg-neutral-300 text-neutral-700'
                            }`}
                          >
                            {pt.published ? 'PUBLISHED (LIVE)' : 'DRAFT / UNPUBLISHED'}
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 text-[#0a6b3c] text-[10px] font-extrabold">
                            Attempts Permitted: {currentMaxAttempts}
                          </span>
                        </div>
                        <div className="text-xs text-neutral-600">
                          Category: <strong>{pt.category}</strong> · Duration:{' '}
                          <strong>{pt.durationMinutes} mins</strong> · Deadline:{' '}
                          <strong>{pt.deadline}</strong>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        {/* Free-form Duration (Mins) Input for Published Test */}
                        <div className="flex items-center gap-1.5 bg-white border border-neutral-300 rounded-xl px-2.5 py-1.5">
                          <span className="text-[11px] font-extrabold text-neutral-600">
                            Duration (mins):
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={draftDur}
                            onChange={(e) => {
                              const rawVal = e.target.value.replace(/[^0-9]/g, '');
                              setPublishedTestDurationDrafts((prev) => ({
                                ...prev,
                                [pt.id]: rawVal,
                              }));
                              const parsed = parseInt(rawVal, 10);
                              if (!isNaN(parsed) && parsed >= 1) {
                                const updated = (settings.publishedTests || []).map((t) =>
                                  t.id === pt.id ? { ...t, durationMinutes: parsed } : t
                                );
                                onUpdateSettings({
                                  ...settings,
                                  durationMinutes: parsed,
                                  publishedTests: updated,
                                });
                              }
                            }}
                            onBlur={() => {
                              const parsed = parseInt(draftDur, 10);
                              const validDur =
                                !isNaN(parsed) && parsed >= 1
                                  ? parsed
                                  : pt.durationMinutes || settings.durationMinutes || 30;
                              setPublishedTestDurationDrafts((prev) => ({
                                ...prev,
                                [pt.id]: String(validDur),
                              }));
                              const updated = (settings.publishedTests || []).map((t) =>
                                t.id === pt.id ? { ...t, durationMinutes: validDur } : t
                              );
                              onUpdateSettings({
                                ...settings,
                                durationMinutes: validDur,
                                publishedTests: updated,
                              });
                            }}
                            placeholder="Mins"
                            className="w-16 px-2 py-0.5 rounded border border-neutral-200 focus:border-[#0a6b3c] text-center font-mono text-xs font-extrabold text-[#0a6b3c] focus:outline-none"
                          />
                        </div>

                        {/* Inline Max Attempts Editor for Published Test */}
                        <div className="flex items-center gap-1.5 bg-white border border-neutral-300 rounded-xl px-2.5 py-1">
                          <span className="text-[11px] font-extrabold text-neutral-600">
                            Max Attempts:
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = Math.max(1, currentMaxAttempts - 1);
                              const updated = (settings.publishedTests || []).map((t) =>
                                t.id === pt.id ? { ...t, maxAttempts: nextVal } : t
                              );
                              onUpdateSettings({
                                ...settings,
                                publishedTests: updated,
                              });
                              triggerToast(
                                `Updated "${pt.title}" permitted attempts to ${nextVal}.`
                              );
                            }}
                            className="w-6 h-6 rounded-md bg-neutral-100 hover:bg-neutral-200 text-black font-extrabold text-xs flex items-center justify-center cursor-pointer"
                            title="Decrease Permitted Attempts"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={currentMaxAttempts}
                            onChange={(e) => {
                              const nextVal = Math.max(
                                1,
                                Math.min(99, Number(e.target.value) || 1)
                              );
                              const updated = (settings.publishedTests || []).map((t) =>
                                t.id === pt.id ? { ...t, maxAttempts: nextVal } : t
                              );
                              onUpdateSettings({
                                ...settings,
                                publishedTests: updated,
                              });
                            }}
                            className="w-11 text-center font-mono text-xs font-extrabold text-[#0a6b3c] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = Math.min(99, currentMaxAttempts + 1);
                              const updated = (settings.publishedTests || []).map((t) =>
                                t.id === pt.id ? { ...t, maxAttempts: nextVal } : t
                              );
                              onUpdateSettings({
                                ...settings,
                                publishedTests: updated,
                              });
                              triggerToast(
                                `Updated "${pt.title}" permitted attempts to ${nextVal}.`
                              );
                            }}
                            className="w-6 h-6 rounded-md bg-neutral-100 hover:bg-neutral-200 text-black font-extrabold text-xs flex items-center justify-center cursor-pointer"
                            title="Increase Permitted Attempts"
                          >
                            +
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleTogglePublishRankingForTest(pt.id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors ${
                            Boolean(
                              pt.rankingPublished ||
                                (settings.rankingPublishedByTestId &&
                                  settings.rankingPublishedByTestId[pt.id])
                            )
                              ? 'bg-[#0a6b3c] text-white hover:bg-[#0e8a4e]'
                              : 'border-2 border-[#0a6b3c] bg-white text-[#0a6b3c] hover:bg-[#0a6b3c]/10'
                          }`}
                          title="When published, candidates see their Current Ranking on their result slip. When unpublished, Ranking completely disappears from candidate results."
                        >
                          <Trophy className="w-3.5 h-3.5" />
                          <span>
                            {Boolean(
                              pt.rankingPublished ||
                                (settings.rankingPublishedByTestId &&
                                  settings.rankingPublishedByTestId[pt.id])
                            )
                              ? 'Unpublish Ranking'
                              : 'Publish Ranking'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveTab('Exam Schedule')}
                          className="px-3.5 py-2 rounded-xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
                          title="Configure General or Per-Centre Exam Schedule for this test"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Manage Schedule</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const updated = (settings.publishedTests || []).map((t) =>
                              t.id === pt.id ? { ...t, published: !t.published } : t
                            );
                            onUpdateSettings({
                              ...settings,
                              publishedTests: updated,
                            });
                            triggerToast(
                              !pt.published
                                ? `Published "${pt.title}" to Candidate Portal.`
                                : `Unpublished "${pt.title}".`
                            );
                          }}
                          className={`px-3.5 py-2 rounded-xl text-xs font-extrabold cursor-pointer ${
                            pt.published
                              ? 'border border-neutral-300 bg-white text-black hover:bg-neutral-100'
                              : 'bg-[#0a6b3c] text-white hover:bg-[#0e8a4e]'
                          }`}
                        >
                          {pt.published ? 'Unpublish' : 'Publish'}
                        </button>

                        {(settings.publishedTests || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = (settings.publishedTests || []).filter(
                                (t) => t.id !== pt.id
                              );
                              onUpdateSettings({
                                ...settings,
                                publishedTests: updated,
                              });
                            }}
                            className="p-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Delete Test"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* CARD 5: QUESTION BANK POOLING PER SUBJECT (Screenshots 163326, 163348, 163359) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  <Layers className="w-4 h-4" />
                  <span>QUESTION BANK POOLING PER SUBJECT</span>
                </div>
                <div>
                  <span className="inline-block px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[10px] font-extrabold uppercase tracking-wider">
                    MULTI-BANK SHUFFLED POOLING + OPTIONS SHUFFLING
                  </span>
                </div>
                <h2 className="text-lg font-extrabold text-black pt-0.5">
                  Configure Subject Question Totals &amp; Multi-Bank Pooling
                </h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Click any subject to expand its Question Banks. Check the banks you want to pool from, set how many questions to pick from each bank, or click <strong>Auto-Distribute Evenly</strong>. At exam start, each bank is shuffled, N questions are picked, merged, and both question order and options (A–D) are shuffled per candidate.
                </p>
              </div>

              <div className="space-y-5">
                {(settings.subjectPooling || []).map((subjPool, subjIdx) => {
                  const totalAvail = subjPool.banks.reduce(
                    (acc, b) => acc + b.available,
                    0
                  );
                  const totalPicked = subjPool.banks.reduce(
                    (acc, b) => acc + (b.enabled ? b.pick : 0),
                    0
                  );
                  const matchesTotal = totalPicked === subjPool.subjectTotal;
                  const isExpanded = subjPool.expanded !== false;

                  const updateSubjectPool = (updated: SubjectPoolConfig) => {
                    const nextList = (settings.subjectPooling || []).map((item, i) =>
                      i === subjIdx ? updated : item
                    );
                    onUpdateSettings({
                      ...settings,
                      subjectPooling: nextList,
                    });
                  };

                  return (
                    <div
                      key={subjPool.subject}
                      className="rounded-3xl border border-neutral-200 bg-white p-5 space-y-4 shadow-2xs"
                    >
                      {/* Subject Header */}
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateSubjectPool({
                              ...subjPool,
                              expanded: !isExpanded,
                            })
                          }
                          className="w-9 h-9 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center shrink-0 cursor-pointer"
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                        <div>
                          <h3 className="text-sm md:text-base font-extrabold text-black">
                            {subjPool.subject} — {subjPool.subjectTotal} Questions
                          </h3>
                          <p className="text-xs text-neutral-500">
                            {subjPool.banks.length} Question Banks ({totalAvail} total available)
                          </p>
                        </div>
                      </div>

                      {/* Subject Total + Auto-Distribute Evenly + Clear Row */}
                      <div className="flex flex-wrap items-center gap-2.5 pb-2 border-b border-neutral-100">
                        <span className="text-[11px] font-extrabold uppercase text-neutral-600">
                          SUBJECT TOTAL:
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={subjPool.subjectTotal}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value) || 0);
                            updateSubjectPool({
                              ...subjPool,
                              subjectTotal: val,
                            });
                          }}
                          className="w-20 px-3 py-1.5 rounded-xl border border-neutral-300 font-mono text-xs font-extrabold text-black"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const activeBanks = subjPool.banks.filter(
                              (b) => b.available > 0
                            );
                            const targetBanks =
                              activeBanks.length > 0 ? activeBanks : subjPool.banks;
                            const count = Math.max(1, targetBanks.length);
                            const basePick = Math.floor(subjPool.subjectTotal / count);
                            let remainder = subjPool.subjectTotal % count;

                            const nextBanks = subjPool.banks.map((b) => {
                              const isTarget = targetBanks.some(
                                (tb) => tb.bankId === b.bankId
                              );
                              if (!isTarget) {
                                return { ...b, enabled: false, pick: 0 };
                              }
                              const extra = remainder > 0 ? 1 : 0;
                              if (remainder > 0) remainder--;
                              return {
                                ...b,
                                enabled: true,
                                pick: basePick + extra,
                              };
                            });

                            updateSubjectPool({
                              ...subjPool,
                              banks: nextBanks,
                            });
                          }}
                          className="px-3.5 py-2 rounded-xl bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Auto-Distribute Evenly</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            updateSubjectPool({
                              ...subjPool,
                              banks: subjPool.banks.map((b) => ({
                                ...b,
                                enabled: false,
                                pick: 0,
                              })),
                            });
                          }}
                          className="px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      </div>

                      {/* Banks List inside Subject */}
                      {isExpanded && (
                        <div className="space-y-3">
                          {subjPool.banks.map((bank, bIdx) => (
                            <div
                              key={bank.bankId}
                              className={`rounded-2xl p-4 transition-all ${
                                bank.enabled
                                  ? 'border-2 border-[#0a6b3c] bg-[#0a6b3c]/3'
                                  : 'border border-neutral-200 bg-neutral-50/60'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={bank.enabled}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const nextBanks = subjPool.banks.map((item, i) =>
                                      i === bIdx
                                        ? {
                                            ...item,
                                            enabled: checked,
                                            pick: checked
                                              ? item.pick || subjPool.subjectTotal
                                              : 0,
                                          }
                                        : item
                                    );
                                    updateSubjectPool({
                                      ...subjPool,
                                      banks: nextBanks,
                                    });
                                  }}
                                  className="accent-[#0a6b3c] w-4 h-4 mt-0.5 cursor-pointer"
                                />
                                <div className="flex-1">
                                  <div className="text-xs md:text-sm font-extrabold text-black">
                                    {bank.title}
                                  </div>
                                  <div className="text-xs text-neutral-500">
                                    {bank.description}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-3 mt-3 text-xs">
                                <span className="text-neutral-600 font-semibold">
                                  Available:{' '}
                                  <strong className="text-black font-extrabold">
                                    {bank.available}
                                  </strong>
                                </span>
                                <span className="text-neutral-600 font-semibold">
                                  Pick:
                                </span>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={bank.pick}
                                  onChange={(e) => {
                                    const val = Math.max(
                                      0,
                                      Number(e.target.value) || 0
                                    );
                                    const nextBanks = subjPool.banks.map((item, i) =>
                                      i === bIdx
                                        ? {
                                            ...item,
                                            pick: val,
                                            enabled: val > 0 ? true : item.enabled,
                                          }
                                        : item
                                    );
                                    updateSubjectPool({
                                      ...subjPool,
                                      banks: nextBanks,
                                    });
                                  }}
                                  className="w-20 px-3 py-1.5 rounded-xl border border-neutral-300 bg-white font-mono text-xs font-extrabold text-black"
                                />
                              </div>
                            </div>
                          ))}

                          {/* Validation Status Pill */}
                          <div
                            className={`px-4 py-2.5 rounded-xl border text-xs font-extrabold flex items-center justify-between ${
                              matchesTotal
                                ? 'bg-[#0a6b3c]/10 border-[#0a6b3c]/30 text-[#0a6b3c]'
                                : 'bg-amber-50 border-amber-300 text-amber-800'
                            }`}
                          >
                            <span>
                              Total picked for {subjPool.subject}: {totalPicked} ={' '}
                              {totalPicked} / {subjPool.subjectTotal}
                            </span>
                            <span>
                              {matchesTotal
                                ? '✓ Matches Subject Total'
                                : 'Adjust Pick to Match Total'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  // Sync subject allocations into published tests as well
                  const allocations: Record<string, number> = {};
                  let totalQ = 0;
                  (settings.subjectPooling || []).forEach((sp) => {
                    if (sp.subjectTotal > 0) {
                      allocations[sp.subject] = sp.subjectTotal;
                      totalQ += sp.subjectTotal;
                    }
                  });
                  const updatedPublished = (settings.publishedTests || []).map(
                    (pt, idx) =>
                      idx === 0
                        ? {
                            ...pt,
                            subjectAllocations: allocations,
                            totalQuestions: totalQ || pt.totalQuestions,
                          }
                        : pt
                  );
                  onUpdateSettings({
                    ...settings,
                    publishedTests: updatedPublished,
                  });
                  triggerToast(
                    'Subject Question Bank Pooling & Allocations saved and synced to Published Test!'
                  );
                }}
                className="w-full py-4 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
              >
                Save Subject Question Bank Pooling &amp; Allocations
              </button>
            </section>

            {/* CARD 6: Psychometric Marking Config (Exact layout from Screenshot_20261023-163417_0b387165.png in Green #0a6b3c) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-extrabold text-black">
                    Psychometric Marking Config
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Configure penalty and bonus rules applied to candidate scores.
                  </p>
                </div>

                {onRecalculateResults && (
                  <button
                    type="button"
                    onClick={() => {
                      onRecalculateResults(psychoConfig);
                      triggerToast(
                        'Recalculated all submitted candidate scores with active Psychometric Marking Config.'
                      );
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 text-[#0a6b3c] text-xs font-extrabold cursor-pointer"
                  >
                    Re-grade Existing Results ({results.length})
                  </button>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-black">
                    Fail Streak Count
                  </label>
                  <p className="text-xs text-neutral-500 mb-1.5">
                    Number of consecutive wrong answers to trigger a penalty.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={psychoConfig.failStreakCount}
                    onChange={(e) =>
                      updatePsychoField(
                        'failStreakCount',
                        Math.max(1, Number(e.target.value) || 3)
                      )
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-black">
                    Fail Penalty
                  </label>
                  <p className="text-xs text-neutral-500 mb-1.5">
                    Marks deducted when the fail streak is reached (use negative value, e.g. -1).
                  </p>
                  <input
                    type="number"
                    step="0.5"
                    value={psychoConfig.failStreakPenalty}
                    onChange={(e) =>
                      updatePsychoField('failStreakPenalty', Number(e.target.value))
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-black">
                    Pass Streak Count
                  </label>
                  <p className="text-xs text-neutral-500 mb-1.5">
                    Number of consecutive correct answers to trigger a bonus.
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={psychoConfig.passStreakCount}
                    onChange={(e) =>
                      updatePsychoField(
                        'passStreakCount',
                        Math.max(1, Number(e.target.value) || 15)
                      )
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-black">
                    Pass Bonus
                  </label>
                  <p className="text-xs text-neutral-500 mb-1.5">
                    Marks added when the pass streak is reached (e.g. 0.5 or 1).
                  </p>
                  <input
                    type="number"
                    step="0.25"
                    min={0}
                    value={psychoConfig.passStreakBonus}
                    onChange={(e) =>
                      updatePsychoField(
                        'passStreakBonus',
                        Math.max(0, Number(e.target.value))
                      )
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-black">
                    Max Score Per Subject
                  </label>
                  <p className="text-xs text-neutral-500 mb-1.5">
                    Maximum final score per subject (e.g. 99).
                  </p>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={psychoConfig.maxSubjectScoreCap}
                    onChange={(e) =>
                      updatePsychoField(
                        'maxSubjectScoreCap',
                        Math.min(100, Math.max(1, Number(e.target.value) || 99))
                      )
                    }
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-xs md:text-sm font-bold text-black"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (onRecalculateResults) {
                      onRecalculateResults(psychoConfig);
                    }
                    triggerToast('Psychometric Marking Config saved!');
                  }}
                  className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
                >
                  Save marking config
                </button>
              </div>
            </section>

            {/* CARD 7: Exam settings (Exact layout from Screenshot_20261023-163424_235cf051.png in Green #0a6b3c) */}
            <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
              <h2 className="text-lg font-extrabold text-black">Exam settings</h2>

              {/* Global Security & Proctoring Inner Box */}
              <div className="rounded-2xl bg-neutral-50 border border-neutral-200 p-4 md:p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-xs md:text-sm font-extrabold text-black flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-[#0a6b3c]" />
                      <Lock className="w-3.5 h-3.5 text-[#0a6b3c]" />
                      <span>Exam Security - Global</span>
                    </div>
                    <div className="text-xs font-bold text-neutral-800">
                      Enable Exam Security System ON/OFF
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      If OFF, all exams run normal. If ON, per-test settings apply
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        ...settings,
                        examSecurityGlobal: !(settings.examSecurityGlobal ?? true),
                      })
                    }
                    className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                      settings.examSecurityGlobal ?? true
                        ? 'bg-[#0a6b3c]'
                        : 'bg-neutral-300'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                        settings.examSecurityGlobal ?? true
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="border-t border-neutral-200 pt-4 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-xs md:text-sm font-extrabold text-black flex items-center gap-1.5">
                      <Video className="w-4 h-4 text-[#0a6b3c]" />
                      <span>
                        Camera Access Required / Live Proctoring Master Toggle [ ON | OFF ]
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      When ON, candidates must accept camera access (if a candidate clicks Deny, the camera prompt pops up again until they accept it). When OFF, camera access is not required and all candidate cameras stop immediately.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const nextEnabled = !settings.proctoringEnabled;
                      onUpdateSettings({
                        ...settings,
                        proctoringEnabled: nextEnabled,
                        publishedTests: (settings.publishedTests || []).map((pt) => ({
                          ...pt,
                          requireCamera: nextEnabled,
                        })),
                      });
                    }}
                    className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                      settings.proctoringEnabled ? 'bg-[#0a6b3c]' : 'bg-neutral-300'
                    }`}
                  >
                    <span
                      className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                        settings.proctoringEnabled
                          ? 'translate-x-5'
                          : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Allow candidates to check their results */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <div className="text-xs md:text-sm font-extrabold text-black">
                    Allow candidates to check their results
                  </div>
                  <p className="text-xs text-neutral-500">
                    Turn this off to disable result lookup and result display after an exam.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      allowCheckResults: !(settings.allowCheckResults ?? true),
                    })
                  }
                  className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    settings.allowCheckResults ?? true
                      ? 'bg-[#0a6b3c]'
                      : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      settings.allowCheckResults ?? true
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Allow or Disallow Candidate Registration Number Generation */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <div className="text-xs md:text-sm font-extrabold text-black">
                    Allow candidate Registration Number generation during registration
                  </div>
                  <p className="text-xs text-neutral-500">
                    When OFF (disallowed), candidates fill only their bio-data and click Confirmed, then see &ldquo;your registration has been successfully submitted, you may leave&rdquo; and return to the home page. A unique QMT Registration Number (e.g. QMT2027001AA) is generated on the Admin Panel upon approval.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      allowRegNumberGeneration: !Boolean(
                        settings.allowRegNumberGeneration
                      ),
                    })
                  }
                  className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    settings.allowRegNumberGeneration
                      ? 'bg-[#0a6b3c]'
                      : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      settings.allowRegNumberGeneration
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Enable Question Download */}
              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <div className="text-xs md:text-sm font-extrabold text-black">
                    Enable Question Download
                  </div>
                  <p className="text-xs text-neutral-500">
                    Allow candidates to download question compilation PDF from the result view. If OFF, the download button is hidden completely.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      ...settings,
                      enableQuestionDownload: !(
                        settings.enableQuestionDownload ?? true
                      ),
                    })
                  }
                  className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                    settings.enableQuestionDownload ?? true
                      ? 'bg-[#0a6b3c]'
                      : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                      settings.enableQuestionDownload ?? true
                        ? 'translate-x-5'
                        : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Download Mode */}
              <div className="space-y-2 pt-1">
                <div>
                  <label className="block text-xs md:text-sm font-extrabold text-black">
                    Download Mode
                  </label>
                  <p className="text-xs text-neutral-500">
                    Choose which questions candidates can download in their result PDF.
                  </p>
                </div>

                <select
                  value={
                    settings.downloadMode || 'Download total questions attempted'
                  }
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      downloadMode: e.target.value as QuestionDownloadMode,
                    })
                  }
                  className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs md:text-sm font-bold text-black bg-white"
                >
                  <option value="Download total questions attempted">
                    Download total questions attempted
                  </option>
                  <option value="Download all exam questions & answers">
                    Download all exam questions &amp; answers
                  </option>
                  <option value="Download failed questions only">
                    Download failed questions only
                  </option>
                </select>

                <div className="rounded-xl bg-[#0a6b3c]/8 border border-[#0a6b3c]/25 px-4 py-3 flex items-center justify-between text-xs">
                  <span className="text-neutral-600 font-medium">
                    Student Result Button Text:
                  </span>
                  <span className="font-mono font-extrabold text-[#0a6b3c]">
                    {settings.downloadMode || 'Download total questions attempted'}
                  </span>
                </div>
              </div>

              {/* Exam duration (minutes) & Registration Fee */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-2">
                  <label className="block text-xs md:text-sm font-extrabold text-black">
                    Exam duration (minutes) — Type any duration
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={durationInputStr}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^0-9]/g, '');
                      setDurationInputStr(raw);
                    }}
                    placeholder="Type any duration in minutes (e.g. 25, 45, 120)"
                    className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-mono text-sm font-bold text-black"
                  />
                  <p className="text-[11px] text-neutral-500">
                    Enter any number of minutes and click Save exam settings (or Publish Test above).
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-4 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200">
                    <div>
                      <div className="text-xs md:text-sm font-extrabold text-black">
                        Make Registration Free (Hide Payment Methods &amp; PIN)
                      </div>
                      <p className="text-[11px] text-neutral-500">
                        When enabled, payment methods and PIN do not show during student registration. Students still require Admin approval to use their generated Registration Number.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextFree = !isFreeRegistration;
                        onUpdateSettings({
                          ...settings,
                          freeRegistration: nextFree,
                          registrationFee: nextFree
                            ? 0
                            : settings.registrationFee > 0
                            ? settings.registrationFee
                            : 5000,
                        });
                        triggerToast(
                          nextFree
                            ? 'Free Registration enabled — Payment methods and PIN hidden on student registration.'
                            : 'Paid Registration enabled.'
                        );
                      }}
                      className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                        isFreeRegistration ? 'bg-[#0a6b3c]' : 'bg-neutral-300'
                      }`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow-xs transition-transform ${
                          isFreeRegistration ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs md:text-sm font-extrabold text-black mb-1.5">
                      Registration Fee (₦) {isFreeRegistration ? '(Currently Free: ₦0)' : ''}
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={isFreeRegistration ? 0 : settings.registrationFee}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === '' ? 0 : Math.max(0, Number(raw));
                        onUpdateSettings({
                          ...settings,
                          registrationFee: num,
                          freeRegistration: num === 0,
                        });
                      }}
                      className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-mono text-sm font-bold text-black"
                    />
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const parsed = parseInt(durationInputStr, 10);
                  handleApplyDurationMinutes(
                    !isNaN(parsed) && parsed >= 1
                      ? parsed
                      : settings.durationMinutes || 30,
                    true
                  );
                }}
                className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold transition-colors cursor-pointer shadow-xs"
              >
                Save exam settings
              </button>
            </section>
          </div>
        )}

        {/* TAB 8: NOTIFICATIONS */}
        {activeTab === 'Notifications' && (
          <div className="p-6 rounded-2xl border border-neutral-200 bg-white text-black space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200 pb-4">
              <div>
                <h2 className="text-base font-extrabold text-black">
                  System &amp; Payment Activity Logs ({notifications.length})
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Select individual notifications to delete in bulk or clear all notifications.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-extrabold text-neutral-700 cursor-pointer mr-2">
                  <input
                    type="checkbox"
                    checked={
                      notifications.length > 0 &&
                      notifications.every((n) => selectedNotificationIds.includes(n.id))
                    }
                    onChange={() => {
                      const allIds = notifications.map((n) => n.id);
                      const allSelected =
                        allIds.length > 0 &&
                        allIds.every((id) => selectedNotificationIds.includes(id));
                      if (allSelected) {
                        setSelectedNotificationIds([]);
                      } else {
                        setSelectedNotificationIds(allIds);
                      }
                    }}
                    className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
                  />
                  <span>Select all</span>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    if (selectedNotificationIds.length === 0) return;
                    onDeleteNotifications(selectedNotificationIds);
                    setSelectedNotificationIds([]);
                  }}
                  disabled={selectedNotificationIds.length === 0}
                  className="px-3.5 py-2 rounded-xl border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete selected ({selectedNotificationIds.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onClearAllNotifications();
                    setSelectedNotificationIds([]);
                  }}
                  disabled={notifications.length === 0}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear all notifications</span>
                </button>
              </div>
            </div>

            {notifications.length === 0 ? (
              <div className="p-8 rounded-2xl border border-dashed border-neutral-300 text-center text-xs font-bold text-neutral-500">
                No notifications in log.
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((n) => {
                  const isSelected = selectedNotificationIds.includes(n.id);
                  return (
                    <div
                      key={n.id}
                      className={`p-4 rounded-xl border flex items-start justify-between gap-4 transition-colors ${
                        isSelected
                          ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                          : 'border-neutral-200 bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            setSelectedNotificationIds((prev) =>
                              prev.includes(n.id)
                                ? prev.filter((id) => id !== n.id)
                                : [...prev, n.id]
                            )
                          }
                          className="accent-[#0a6b3c] w-4 h-4 mt-0.5 cursor-pointer"
                        />
                        <div className="space-y-1">
                          <div className="text-xs font-extrabold text-[#0a6b3c]">
                            {n.title}
                          </div>
                          <p className="text-xs text-black">{n.message}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] font-mono text-neutral-500 whitespace-nowrap">
                          {n.timestamp}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            onDeleteNotifications([n.id]);
                            setSelectedNotificationIds((prev) =>
                              prev.filter((id) => id !== n.id)
                            );
                          }}
                          className="p-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 transition-colors cursor-pointer"
                          title="Delete Notification"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Printable Registration Slip / Edit Photocard Modal */}
      {slipCandidate && (
        <RegistrationSlipModal
          candidate={slipCandidate}
          isFreeRegistration={isFreeRegistration}
          onClose={() => setSlipCandidate(null)}
          onUpdatePassport={(candId, dataUrl) => {
            const updated = { ...slipCandidate, passportDataUrl: dataUrl };
            setSlipCandidate(updated);
            onUpdateCandidate(updated);
          }}
        />
      )}

      {/* View Candidate Registration Details & Pre-Approval Review Modal */}
      {profileCandidate && (() => {
        const liveCand =
          candidates.find((c) => c.id === profileCandidate.id) || profileCandidate;
        const isApproved = liveCand.paymentStatus === 'Paid';
        const isCandFree =
          isFreeRegistration ||
          liveCand.paymentMethod === 'Free Registration' ||
          liveCand.amountPaid === 0;
        const matchedCombo = subjectCombinations.find(
          (sc) => sc.name.trim().toLowerCase() === liveCand.category.trim().toLowerCase()
        );
        const customSubjects = liveCand.subjectCombination
          ? liveCand.subjectCombination
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        const comboSubjects =
          customSubjects.length > 0
            ? customSubjects
            : matchedCombo
            ? matchedCombo.subjects
            : ['English', 'Mathematics', 'Biology', 'Chemistry'];

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
            <div className="w-full max-w-2xl bg-white text-black rounded-2xl border-2 border-[#0a6b3c] overflow-hidden shadow-2xl my-auto">
              {/* Top Green Official Header */}
              <div className="bg-[#0a6b3c] px-6 py-4 text-white flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white p-0.5 flex items-center justify-center shrink-0">
                    <img
                      src={QUEMINT_LOGO_URL}
                      alt="Quemint Logo"
                      className="w-full h-full object-contain rounded-full"
                    />
                  </div>
                  <div>
                    <span className="block text-[10px] font-extrabold uppercase tracking-widest text-white/80">
                      CANDIDATE REGISTRATION DOSSIER • ADMIN REVIEW
                    </span>
                    <h3 className="text-base md:text-lg font-extrabold">
                      Details Filled by Candidate
                    </h3>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase ${
                      isApproved
                        ? 'bg-[#0e8a4e] text-white border border-white/30'
                        : 'bg-amber-400 text-black'
                    }`}
                  >
                    {isApproved ? 'Approved & Verified' : 'Pending Admin Approval'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setProfileCandidate(null)}
                    className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
                {/* 1. Candidate Bio-Data & Passport Section */}
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row gap-4 items-start">
                  <div className="w-24 h-28 rounded-xl border-2 border-[#0a6b3c] bg-white flex flex-col items-center justify-center overflow-hidden shrink-0">
                    {liveCand.passportDataUrl && !liveCand.passportDataUrl.startsWith('/proctoring/') ? (
                      <img
                        src={liveCand.passportDataUrl}
                        alt={`${liveCand.firstName} ${liveCand.surname}`}
                        className="w-full h-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="flex-1 w-full space-y-2.5">
                    <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        1. Candidate Bio-Data (Filled at Registration)
                      </span>
                      <span className="text-[11px] text-neutral-500 font-mono">
                        Submitted: {new Date(liveCand.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                        <span className="block text-[10px] font-bold uppercase text-neutral-500">
                          First Name
                        </span>
                        <span className="font-extrabold text-sm text-black">
                          {liveCand.firstName}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                        <span className="block text-[10px] font-bold uppercase text-neutral-500">
                          Middle Name
                        </span>
                        <span className="font-extrabold text-sm text-black">
                          {liveCand.middleName || '—'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                        <span className="block text-[10px] font-bold uppercase text-neutral-500">
                          Surname
                        </span>
                        <span className="font-extrabold text-sm text-black">
                          {liveCand.surname}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                        <span className="text-neutral-500 font-bold">Gender:</span>
                        <span className="font-extrabold text-black">{liveCand.gender}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                        <span className="text-neutral-500 font-bold">Registration No:</span>
                        <span className="font-mono font-extrabold text-[#0a6b3c]">
                          {liveCand.regNumber || 'Assigned on Approval'}
                        </span>
                      </div>
                      {liveCand.email && (
                        <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                          <span className="text-neutral-500 font-bold">Email:</span>
                          <span className="font-semibold text-black truncate max-w-[160px]">
                            {liveCand.email}
                          </span>
                        </div>
                      )}
                      {liveCand.phone && (
                        <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                          <span className="text-neutral-500 font-bold">Phone:</span>
                          <span className="font-mono font-semibold text-black">
                            {liveCand.phone}
                          </span>
                        </div>
                      )}
                      {liveCand.stateOfOrigin && (
                        <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                          <span className="text-neutral-500 font-bold">State of Origin:</span>
                          <span className="font-extrabold text-black">
                            {liveCand.stateOfOrigin}
                          </span>
                        </div>
                      )}
                      {liveCand.courseOfStudy && (
                        <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                          <span className="text-neutral-500 font-bold">Course of Study:</span>
                          <span className="font-extrabold text-[#0a6b3c]">
                            {liveCand.courseOfStudy}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Category, Flexible Subject Combination & Exam Center */}
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5 gap-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      2. Category, Flexible 4-Subject Combination &amp; Exam Center
                    </span>
                    <select
                      value={
                        subjectCombinations.find(
                          (c) =>
                            c.name.trim().toLowerCase() ===
                            (liveCand.category || '').trim().toLowerCase()
                        )?.name || liveCand.category
                      }
                      onChange={(e) => {
                        const newCat = e.target.value;
                        onUpdateCandidate({ ...liveCand, category: newCat });
                        triggerToast(
                          `Updated ${liveCand.firstName} ${liveCand.surname}'s Category to "${newCat}".`
                        );
                      }}
                      className="px-2.5 py-1 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase cursor-pointer border border-[#0a6b3c] focus:outline-none"
                    >
                      {!subjectCombinations.some(
                        (c) =>
                          c.name.trim().toLowerCase() ===
                          (liveCand.category || '').trim().toLowerCase()
                      ) && (
                        <option value={liveCand.category} className="bg-white text-black">
                          {liveCand.category}
                        </option>
                      )}
                      {subjectCombinations.map((combo) => (
                        <option
                          key={combo.id}
                          value={combo.name}
                          className="bg-white text-black font-bold"
                        >
                          {combo.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <span className="block text-[11px] text-neutral-600 font-semibold mb-1.5">
                      Candidate&apos;s Registered Subject Combination (Category:{' '}
                      <strong>{liveCand.category}</strong>):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {comboSubjects.map((subj) => (
                        <span
                          key={subj}
                          className="px-3 py-1 rounded-lg bg-white border border-[#0a6b3c]/40 text-[#0a6b3c] font-extrabold text-xs"
                        >
                          {subj}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                      <span className="text-neutral-500 font-bold">Examination Centre:</span>
                      <span className="font-extrabold text-[#0a6b3c]">
                        {liveCand.examCenterName || 'Main Hall'}
                      </span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                      <span className="text-neutral-500 font-bold">Exam Date:</span>
                      <span className="font-bold text-black">{liveCand.examDate}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                      <span className="text-neutral-500 font-bold">Exam Time:</span>
                      <span className="font-bold text-black">{liveCand.examTime}</span>
                    </div>
                  </div>
                </div>

                {/* 3. Registration Approval Status (or Payment & GREEN BOX PIN Details when Paid Mode) */}
                {isCandFree ? (
                  <div className="p-4 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c] flex items-center justify-between gap-4">
                    <div>
                      <span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        3. FREE REGISTRATION — ADMIN APPROVAL STATUS
                      </span>
                      <span className="font-extrabold text-sm text-black block mt-0.5">
                        {isApproved
                          ? `Approved — Candidate is permitted to log in with Reg No (${liveCand.regNumber})`
                          : `Pending Approval — Candidate cannot log in with Reg No (${liveCand.regNumber || 'Pending'}) until approved`}
                      </span>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase shrink-0 ${
                        isApproved
                          ? 'bg-[#0a6b3c] text-white'
                          : 'bg-amber-400 text-black'
                      }`}
                    >
                      {isApproved ? 'Approved' : 'Awaiting Approval'}
                    </span>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 space-y-3">
                    <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        3. Payment Verification & GREEN BOX PIN Status
                      </span>
                      <span className="font-mono font-extrabold text-black">
                        ₦{liveCand.amountPaid.toLocaleString()}.00
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                        <span className="block text-[10px] font-bold uppercase text-neutral-500">
                          Payment Method Selected
                        </span>
                        <span className="font-extrabold text-black">
                          {liveCand.paymentMethod}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200">
                        <span className="block text-[10px] font-bold uppercase text-neutral-500">
                          Transaction Reference
                        </span>
                        <span className="font-mono font-bold text-black">
                          {liveCand.transactionRef || '—'}
                        </span>
                      </div>
                    </div>

                    {liveCand.dvaAccountNumber && (
                      <div className="p-2.5 rounded-lg bg-white border border-neutral-200 flex items-center justify-between">
                        <span className="text-neutral-500 font-bold">
                          Assigned Paystack DVA:
                        </span>
                        <span className="font-mono font-extrabold text-[#0a6b3c]">
                          {liveCand.dvaAccountNumber} ({liveCand.dvaBankName})
                        </span>
                      </div>
                    )}

                    {/* Uploaded Payment Receipt / Proof Preview */}
                    {(liveCand.proofFileName || liveCand.proofDataUrl) && (
                      <div className="p-3 rounded-xl bg-white border-2 border-[#0a6b3c]/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-extrabold text-[#0a6b3c]">
                            Uploaded Payment Receipt / Proof:
                          </span>
                          <span className="font-mono text-[11px] font-bold text-neutral-700">
                            {liveCand.proofFileName || 'Transfer Receipt'}
                          </span>
                        </div>
                        {liveCand.proofDataUrl &&
                          liveCand.proofDataUrl.startsWith('data:image') && (
                            <div className="rounded-lg border border-neutral-200 overflow-hidden bg-neutral-100 max-h-60 flex items-center justify-center p-2">
                              <img
                                src={liveCand.proofDataUrl}
                                alt="Candidate Uploaded Payment Proof"
                                className="max-h-56 w-auto object-contain rounded"
                              />
                            </div>
                          )}
                      </div>
                    )}

                    {/* GREEN BOX PIN Vault Status */}
                    <div className="p-3 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c] flex items-center justify-between">
                      <div>
                        <span className="block text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                          OFFICIAL GREEN BOX EXAMINATION PIN
                        </span>
                        <span className="font-mono text-base font-extrabold text-black">
                          {liveCand.pin || 'Awaiting Admin Approval & PIN Generation'}
                        </span>
                      </div>
                      {liveCand.pin && (
                        <button
                          type="button"
                          onClick={() => handleCopy(liveCand.pin, `modal-${liveCand.id}`)}
                          className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white font-extrabold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === `modal-${liveCand.id}` ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copy PIN
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Bottom Admin Approval & Action Buttons */}
                <div className="pt-2 border-t border-neutral-200 flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setProfileCandidate(null);
                        setEditCandidate(liveCand);
                      }}
                      className="px-3.5 py-2 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-black font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#0a6b3c]" />
                      <span>Edit Filled Details</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setProfileCandidate(null);
                        setSlipCandidate(liveCand);
                      }}
                      className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      <span>Print Registration Slip</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isCandFree ? (
                      !isApproved ? (
                        <button
                          type="button"
                          onClick={() => {
                            handleConfirmPayment(liveCand);
                            triggerToast(
                              `Approved ${liveCand.firstName} ${liveCand.surname}! Their Registration Number (${liveCand.regNumber}) is now active for login.`
                            );
                          }}
                          className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approve Candidate &amp; Allow Reg Number</span>
                        </button>
                      ) : (
                        <span className="px-4 py-2 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] font-extrabold text-xs">
                          ✓ Registration Number Approved for Login
                        </span>
                      )
                    ) : (
                      <>
                        {!isApproved && (
                          <button
                            type="button"
                            onClick={() => {
                              handleConfirmPayment(liveCand);
                              triggerToast(
                                `Approved payment for ${liveCand.firstName} ${liveCand.surname}.`
                              );
                            }}
                            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-extrabold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Approve Payment Only</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            handleGeneratePinForCandidate(liveCand);
                            triggerToast(
                              `Approved ${liveCand.firstName} ${liveCand.surname} & dispatched PIN to GREEN BOX!`
                            );
                          }}
                          className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <KeyRound className="w-4 h-4" />
                          <span>
                            {isApproved && liveCand.pin
                              ? 'Regenerate GREEN BOX PIN'
                              : 'Approve Registration & Generate PIN'}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Candidate Modal */}
      {editCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#0a6b3c]">
              Edit Candidate Registration Details
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">First Name</label>
                <input
                  type="text"
                  value={editCandidate.firstName}
                  onChange={(e) =>
                    setEditCandidate({ ...editCandidate, firstName: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Middle Name</label>
                <input
                  type="text"
                  value={editCandidate.middleName}
                  onChange={(e) =>
                    setEditCandidate({ ...editCandidate, middleName: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Surname</label>
                <input
                  type="text"
                  value={editCandidate.surname}
                  onChange={(e) =>
                    setEditCandidate({ ...editCandidate, surname: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Gender</label>
                  <select
                    value={editCandidate.gender}
                    onChange={(e) =>
                      setEditCandidate({
                        ...editCandidate,
                        gender: e.target.value as GenderType,
                      })
                    }
                    className="w-full px-3 py-2 rounded border border-neutral-300 bg-white"
                  >
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Registration Number</label>
                  <input
                    type="text"
                    value={editCandidate.regNumber}
                    onChange={(e) =>
                      setEditCandidate({ ...editCandidate, regNumber: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded border border-neutral-300 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-bold mb-1">
                  Category (Science, Art, Commercial)
                </label>
                <select
                  value={
                    subjectCombinations.find(
                      (c) =>
                        c.name.trim().toLowerCase() ===
                        (editCandidate.category || '').trim().toLowerCase()
                    )?.name || editCandidate.category
                  }
                  onChange={(e) =>
                    setEditCandidate({
                      ...editCandidate,
                      category: e.target.value as CategoryType,
                    })
                  }
                  className="w-full px-3 py-2 rounded border border-neutral-300 bg-white font-bold"
                >
                  {!subjectCombinations.some(
                    (c) =>
                      c.name.trim().toLowerCase() ===
                      (editCandidate.category || '').trim().toLowerCase()
                  ) && (
                    <option value={editCandidate.category}>
                      {editCandidate.category}
                    </option>
                  )}
                  {subjectCombinations.map((combo) => (
                    <option key={combo.id} value={combo.name}>
                      {combo.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">
                  Subject Combination (Flexible 4 Subjects, comma-separated)
                </label>
                <input
                  type="text"
                  value={editCandidate.subjectCombination || ''}
                  onChange={(e) =>
                    setEditCandidate({
                      ...editCandidate,
                      subjectCombination: e.target.value,
                    })
                  }
                  placeholder="English, Mathematics, Biology, Chemistry"
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Course of Study</label>
                  <input
                    type="text"
                    value={editCandidate.courseOfStudy || ''}
                    onChange={(e) =>
                      setEditCandidate({
                        ...editCandidate,
                        courseOfStudy: e.target.value,
                      })
                    }
                    placeholder="e.g., Medicine, Law"
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">State of Origin</label>
                  <input
                    type="text"
                    value={editCandidate.stateOfOrigin || ''}
                    onChange={(e) =>
                      setEditCandidate({
                        ...editCandidate,
                        stateOfOrigin: e.target.value,
                      })
                    }
                    placeholder="e.g., Lagos, Rivers"
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditCandidate(null)}
                className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateCandidate(editCandidate);
                  triggerToast(
                    `Updated candidate details & Subject Combination (${editCandidate.category}) for ${editCandidate.firstName} ${editCandidate.surname}.`
                  );
                  setEditCandidate(null);
                }}
                className="px-4 py-2 rounded-lg bg-[#0a6b3c] text-white text-xs font-bold cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload / Add Candidate Modal */}
      {showAddCandidateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-extrabold text-[#0a6b3c]">
              Upload / Add Single Candidate
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1">First Name *</label>
                <input
                  type="text"
                  value={newFirstName}
                  onChange={(e) => setNewFirstName(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Middle Name (Optional)</label>
                <input
                  type="text"
                  value={newMiddleName}
                  onChange={(e) => setNewMiddleName(e.target.value)}
                  placeholder="Leave empty or -"
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Surname *</label>
                <input
                  type="text"
                  value={newSurname}
                  onChange={(e) => setNewSurname(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">
                  Subject Combination (Free text, e.g., English, Maths, Biology, Chemistry)
                </label>
                <input
                  type="text"
                  value={newSubjectCombination}
                  onChange={(e) => setNewSubjectCombination(e.target.value)}
                  placeholder="English, Mathematics, Biology, Chemistry"
                  className="w-full px-3 py-2 rounded border border-neutral-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Course of Study</label>
                  <input
                    type="text"
                    value={newCourseOfStudy}
                    onChange={(e) => setNewCourseOfStudy(e.target.value)}
                    placeholder="e.g., Medicine, Law"
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">State of Origin</label>
                  <input
                    type="text"
                    value={newStateOfOrigin}
                    onChange={(e) => setNewStateOfOrigin(e.target.value)}
                    placeholder="e.g., Lagos"
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Gender</label>
                  <select
                    value={newGender}
                    onChange={(e) => setNewGender(e.target.value as GenderType)}
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">
                    Category (Science, Art, Commercial)
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as CategoryType)}
                    className="w-full px-3 py-2 rounded border border-neutral-300"
                  >
                    {subjectCombinations.map((combo) => (
                      <option key={combo.id} value={combo.name}>
                        {combo.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddCandidateModal(false)}
                className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!newFirstName.trim() || !newSurname.trim()) return;
                  const reg = `2027${String(15 + candidates.length).padStart(3, '0')}PHA`;
                  const pin = `QMT-${Math.floor(100000 + Math.random() * 900000)}`;
                  const availableCenter = examCenters.find(
                    (ec) => ec.currentCount < ec.maxCapacity
                  );
                  if (availableCenter) {
                    const updatedCenters = examCenters.map((ec) =>
                      ec.id === availableCenter.id
                        ? { ...ec, currentCount: ec.currentCount + 1 }
                        : ec
                    );
                    onUpdateSettings({
                      ...settings,
                      examCenters: updatedCenters,
                    });
                  }
                  const cleanMid =
                    newMiddleName.trim() === '-' ? '' : newMiddleName.trim();
                  onAddCandidatesBulk([
                    {
                      id: `cand-${Date.now()}`,
                      firstName: newFirstName.trim(),
                      middleName: cleanMid,
                      surname: newSurname.trim(),
                      gender: newGender,
                      category: newCategory,
                      subjectCombination:
                        newSubjectCombination.trim() ||
                        'English, Mathematics, Biology, Chemistry',
                      courseOfStudy: newCourseOfStudy.trim() || 'General Studies',
                      stateOfOrigin: newStateOfOrigin.trim(),
                      examCenterId: availableCenter?.id,
                      examCenterName: availableCenter?.name || 'Main Hall',
                      regNumber: reg,
                      pin,
                      paymentStatus: 'Paid',
                      paymentMethod: 'Admin Upload',
                      amountPaid: settings.registrationFee,
                      transactionRef: `ADM-${Date.now().toString().slice(-5)}`,
                      suspended: false,
                      examAssigned: true,
                      examDate: settings.defaultExamDate,
                      examTime: settings.defaultExamTime,
                      createdAt: new Date().toISOString(),
                    },
                  ]);
                  setNewFirstName('');
                  setNewMiddleName('');
                  setNewSurname('');
                  setNewCourseOfStudy('');
                  setNewStateOfOrigin('');
                  setShowAddCandidateModal(false);
                }}
                className="px-4 py-2 rounded-lg bg-[#0a6b3c] text-white text-xs font-bold cursor-pointer"
              >
                  Add &amp; Generate PIN
                </button>
              </div>
            </div>
          </div>
        )}

      {/* View Individual Result Modal */}
      {viewingResult && (() => {
        const matchedCand = candidates.find(
          (c) => c.regNumber.toUpperCase() === viewingResult.regNumber.toUpperCase()
        );
        const gradeInfo = getQuemintGradeInfo(viewingResult.percentage);
        const sortedAll = [...results].sort(
          (a, b) => b.score - a.score || b.percentage - a.percentage
        );
        const rIdx = sortedAll.findIndex((r) => r.id === viewingResult.id);
        const rankNum = rIdx !== -1 ? rIdx + 1 : 1;
        const isRankPublishedForViewing = isExamRankingPublished(viewingResult, settings);
        const dynamicSlipRows = resolveResultSlipFieldRows(
          viewingResult,
          matchedCand,
          settings,
          { rank: rankNum, total: Math.max(1, results.length) }
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
            <div className="w-full max-w-md bg-white text-black rounded-[28px] overflow-hidden shadow-2xl p-6 md:p-7 relative my-auto border-2 border-[#0a6b3c]">
              <button
                type="button"
                onClick={() => setViewingResult(null)}
                aria-label="Close result view"
                className="absolute top-5 right-5 p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="space-y-5">
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
                      {viewingResult.testTitle ||
                        settings.resultTitles?.testSubtitle ||
                        'MOCK EXAMINATION'}
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-500">
                    {settings.resultTitles?.assessmentSubtitle || 'Quemint Assessment'}
                    {isRankPublishedForViewing
                      ? ` • Rank #${rankNum} of ${Math.max(1, results.length)}`
                      : ''}
                  </p>
                </div>

                {/* Dynamic Candidate Details configured by Admin */}
                <div className="space-y-2 text-xs pt-1">
                  {dynamicSlipRows.map((row) => (
                    <div key={row.key} className="flex justify-between gap-3">
                      <span className="text-neutral-500">{row.label}:</span>
                      <span
                        className={`font-bold text-right ${
                          row.key === 'category' || row.key === 'currentRanking'
                            ? 'text-[#0a6b3c]'
                            : row.key === 'regNumber'
                            ? 'font-mono text-neutral-900'
                            : 'text-neutral-900'
                        }`}
                      >
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="border-t border-neutral-100" />

                {/* Subject & Score Table Box */}
                <div className="rounded-xl overflow-hidden border border-neutral-200/80">
                  <div className="bg-[#e3f5ec] border-b border-[#bfe5d0] px-4 py-3 flex items-center justify-between text-xs font-bold text-neutral-900">
                    <span>Subject</span>
                    <span>Score</span>
                  </div>
                  <div className="divide-y divide-neutral-100 text-xs bg-white">
                    {Object.entries(viewingResult.subjectBreakdown).map(
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

                {/* Aggregate, Percentage & Official Grade */}
                <div className="text-center pt-1 space-y-1">
                  <div className="text-base md:text-lg font-extrabold text-neutral-900">
                    Aggregate score: {viewingResult.score}
                  </div>
                  <div className="text-xs text-neutral-500">
                    Percentage: {viewingResult.percentage}%
                  </div>
                  <div className="text-xs font-extrabold text-[#0a6b3c] pt-1">
                    {gradeInfo.displayFull}
                  </div>
                </div>

                {/* Attempted Questions & AI Evaluation Breakdown */}
                {(() => {
                  const attemptedItems = resolveAttemptedItemsForResult(
                    viewingResult,
                    questions
                  );
                  if (attemptedItems.length === 0) return null;
                  return (
                    <div className="space-y-2.5 pt-2 border-t border-neutral-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                          Attempt Review &amp; AI Explanations ({attemptedItems.length})
                        </h3>
                        <span className="text-[11px] font-bold text-neutral-500">
                          MCQ + TYA
                        </span>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        {attemptedItems.map((item, idx) => {
                          const isTya = item.questionType === 'TYA';
                          const isCorrect = isTya
                            ? Boolean(item.isCorrect)
                            : item.selectedAnswer === item.correctAnswer;
                          const expKey = `${viewingResult.id}-${item.id}-${idx}`;
                          const isExpanded = Boolean(expandedAiExplanations[expKey]);
                          const candidateAns = isTya
                            ? item.typedAnswer || '(No Answer Typed)'
                            : item.selectedAnswer !== null &&
                              item.selectedAnswer !== undefined &&
                              item.options[item.selectedAnswer]
                            ? `${['A', 'B', 'C', 'D'][item.selectedAnswer]}. ${
                                item.options[item.selectedAnswer]
                              }`
                            : 'Not Answered';
                          const officialKey = isTya
                            ? (item.answerKeys && item.answerKeys.length > 0
                                ? item.answerKeys
                                : ['—']
                              ).join(' / ')
                            : item.options[item.correctAnswer]
                            ? `${['A', 'B', 'C', 'D'][item.correctAnswer]}. ${
                                item.options[item.correctAnswer]
                              }`
                            : '—';
                          const maxM = item.maxMarks || 1;
                          const awardedM =
                            typeof item.marksAwarded === 'number'
                              ? item.marksAwarded
                              : isCorrect
                              ? maxM
                              : 0;

                          return (
                            <div
                              key={`${item.id}-${idx}`}
                              className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                                isCorrect
                                  ? 'bg-[#0a6b3c]/5 border-[#0a6b3c]/30'
                                  : 'bg-red-50/70 border-red-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-bold text-black">
                                  <span className="font-extrabold text-[#0a6b3c] mr-1">
                                    Q{idx + 1} ({item.subject} • {isTya ? 'TYA' : 'MCQ'}):
                                  </span>
                                  {item.questionText}
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                                    isCorrect
                                      ? 'bg-[#0a6b3c] text-white'
                                      : 'bg-red-600 text-white'
                                  }`}
                                >
                                  {isCorrect ? '✓ CORRECT' : '✗ WRONG'} ({awardedM}/{maxM})
                                </span>
                              </div>
                              <div className="text-[11px] space-y-0.5">
                                <div>
                                  <span className="text-neutral-500 font-semibold">
                                    Candidate Answer:{' '}
                                  </span>
                                  <span
                                    className={`font-bold ${
                                      isCorrect ? 'text-[#0a6b3c]' : 'text-red-600'
                                    }`}
                                  >
                                    {candidateAns}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-neutral-500 font-semibold">
                                    Answer Key:{' '}
                                  </span>
                                  <span className="font-bold text-black">{officialKey}</span>
                                </div>
                                {isTya && (
                                  <div>
                                    <span className="text-neutral-500 font-semibold">
                                      AI Evaluation:{' '}
                                    </span>
                                    <span
                                      className={`font-extrabold ${
                                        isCorrect ? 'text-[#0a6b3c]' : 'text-red-600'
                                      }`}
                                    >
                                      {isCorrect ? 'CORRECT' : 'WRONG'}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {item.aiExplanation && (
                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedAiExplanations((prev) => ({
                                        ...prev,
                                        [expKey]: !prev[expKey],
                                      }))
                                    }
                                    className="text-[11px] font-extrabold text-[#0a6b3c] hover:underline cursor-pointer"
                                  >
                                    {isExpanded
                                      ? 'Hide AI Explanation ▲'
                                      : 'View AI Explanation ▼'}
                                  </button>
                                  {isExpanded && (
                                    <div className="mt-1.5 p-2.5 rounded-lg bg-white border border-neutral-200 text-[11px] italic text-neutral-700">
                                      {item.aiExplanation}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Action Buttons */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      downloadCandidateResultSlipPdf(
                        viewingResult,
                        matchedCand,
                        settings,
                        { rank: rankNum, total: Math.max(1, results.length) }
                      )
                    }
                    className="w-full py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Result Slip PDF</span>
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadAttemptWithAiExplanationsPdf(
                          viewingResult,
                          settings,
                          questions
                        )
                      }
                      className="py-2.5 px-3 rounded-xl bg-white hover:bg-[#0a6b3c]/5 border border-[#0a6b3c] text-[#0a6b3c] text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Attempt PDF (AI Eval)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadAttemptWithAiExplanationsExcelCsv(
                          viewingResult,
                          questions
                        )
                      }
                      className="py-2.5 px-3 rounded-xl bg-white hover:bg-[#0a6b3c]/5 border border-[#0a6b3c] text-[#0a6b3c] text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      <span>Attempt Excel (CSV)</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const target = viewingResult;
                        setViewingResult(null);
                        setEditingResult({
                          ...target,
                          subjectBreakdown: { ...target.subjectBreakdown },
                        });
                      }}
                      className="py-2.5 px-4 rounded-xl border border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Result</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewingResult(null)}
                      className="py-2.5 px-4 rounded-xl bg-black hover:bg-neutral-800 text-white text-xs font-extrabold cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Individual Result Modal */}
      {editingResult && (() => {
        const previewGrade = getQuemintGradeInfo(editingResult.percentage);

        const recalculateAggregateFromSubjects = (
          breakdown: Record<string, SubjectScoreDetail>
        ) => {
          const entries = Object.values(breakdown);
          const agg = entries.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
          const count = Math.max(1, entries.length);
          const pct = Math.min(100, Math.max(0, Math.round(agg / count)));
          return { agg, pct };
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 overflow-y-auto">
            <div className="w-full max-w-lg bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 space-y-5 shadow-2xl my-auto">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                    ADMIN RESULT EDITOR
                  </span>
                  <h3 className="text-base font-extrabold text-black">
                    Edit Individual Candidate Result
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingResult(null)}
                  className="p-1.5 rounded-full text-neutral-400 hover:text-black cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Candidate Name
                    </label>
                    <input
                      type="text"
                      value={editingResult.candidateName}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          candidateName: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-bold"
                    />
                  </div>
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Registration Number
                    </label>
                    <input
                      type="text"
                      value={editingResult.regNumber}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          regNumber: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Subject Combination (Category)
                    </label>
                    <select
                      value={editingResult.category}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          category: e.target.value as CategoryType,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-bold bg-white"
                    >
                      {subjectCombinations.map((combo) => (
                        <option key={combo.id} value={combo.name}>
                          {combo.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Gender
                    </label>
                    <select
                      value={editingResult.gender || 'Female'}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          gender: e.target.value as GenderType,
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-bold bg-white"
                    >
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                    </select>
                  </div>
                </div>

                {/* Subject Scores Breakdown Editor */}
                <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Subject Scores Breakdown
                    </span>
                    <span className="text-[11px] text-neutral-500 font-semibold">
                      Auto-updates Aggregate &amp; %
                    </span>
                  </div>

                  <div className="space-y-2">
                    {Object.entries(editingResult.subjectBreakdown).map(
                      ([subj, detail]) => (
                        <div
                          key={subj}
                          className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-neutral-200"
                        >
                          <span className="font-extrabold text-black">{subj}</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={detail.score}
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Math.min(100, Number(e.target.value) || 0)
                                );
                                const nextBreakdown = {
                                  ...editingResult.subjectBreakdown,
                                  [subj]: { ...detail, score: val },
                                };
                                const { agg, pct } =
                                  recalculateAggregateFromSubjects(nextBreakdown);
                                setEditingResult({
                                  ...editingResult,
                                  subjectBreakdown: nextBreakdown,
                                  score: agg,
                                  percentage: pct,
                                });
                              }}
                              className="w-20 px-2.5 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] font-mono font-extrabold text-center text-[#0a6b3c]"
                            />
                            {Object.keys(editingResult.subjectBreakdown).length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextBreakdown = {
                                    ...editingResult.subjectBreakdown,
                                  };
                                  delete nextBreakdown[subj];
                                  const { agg, pct } =
                                    recalculateAggregateFromSubjects(nextBreakdown);
                                  setEditingResult({
                                    ...editingResult,
                                    subjectBreakdown: nextBreakdown,
                                    score: agg,
                                    percentage: pct,
                                  });
                                }}
                                className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 cursor-pointer"
                                title="Remove Subject"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>

                  {/* Add Subject to Breakdown */}
                  <div className="pt-2 border-t border-neutral-200 flex items-center gap-2">
                    <input
                      type="text"
                      value={newResultSubjectName}
                      onChange={(e) => setNewResultSubjectName(e.target.value)}
                      placeholder="Add subject (e.g. Further Maths)"
                      className="flex-1 px-3 py-1.5 rounded-lg border border-neutral-300 bg-white text-xs font-semibold"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={newResultSubjectScore}
                      onChange={(e) =>
                        setNewResultSubjectScore(
                          Math.max(0, Math.min(100, Number(e.target.value) || 0))
                        )
                      }
                      className="w-16 px-2 py-1.5 rounded-lg border border-neutral-300 bg-white font-mono font-bold text-center"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = newResultSubjectName.trim();
                        if (!trimmed) return;
                        const nextBreakdown = {
                          ...editingResult.subjectBreakdown,
                          [trimmed]: {
                            score: newResultSubjectScore,
                            total: 99,
                            rawCorrect: Math.round(newResultSubjectScore / 10),
                            questionCount: 10,
                          },
                        };
                        const { agg, pct } =
                          recalculateAggregateFromSubjects(nextBreakdown);
                        setEditingResult({
                          ...editingResult,
                          subjectBreakdown: nextBreakdown,
                          score: agg,
                          percentage: pct,
                        });
                        setNewResultSubjectName('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white font-extrabold text-xs cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {/* Aggregate Score & Percentage Direct Override */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Aggregate Score
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={editingResult.score}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          score: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-mono font-extrabold text-[#0a6b3c]"
                    />
                  </div>
                  <div>
                    <label className="block font-extrabold text-neutral-800 mb-1">
                      Percentage (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={editingResult.percentage}
                      onChange={(e) =>
                        setEditingResult({
                          ...editingResult,
                          percentage: Math.max(
                            0,
                            Math.min(100, Number(e.target.value) || 0)
                          ),
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] font-mono font-extrabold text-black"
                    />
                  </div>
                </div>

                {/* Live Grade Preview */}
                <div className="p-3 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 flex items-center justify-between">
                  <span className="font-bold text-neutral-700">
                    Resulting Official Grade:
                  </span>
                  <span className="font-extrabold text-[#0a6b3c]">
                    {previewGrade.displayFull}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingResult(null)}
                  className="px-4 py-2.5 rounded-xl border border-neutral-300 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateResult(editingResult);
                    setEditingResult(null);
                    triggerToast('Individual candidate result updated!');
                  }}
                  className="px-5 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer"
                >
                  Save Result Changes
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
