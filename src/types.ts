import { PsychometricConfig } from './utils/calculateScore';

export type CategoryType = string;

export interface SubjectCombinationConfig {
  id: string;
  name: string; // Subject combination name (Category), e.g. "Medical", "Engineering", "Art", "Commercial"
  subjects: string[]; // Subjects assigned to this combination (category)
}

export type GenderType = 'Male' | 'Female';

export type PaymentMethodType =
  | 'Instant Transfer (Paystack DVA)'
  | 'Direct Bank Transfer (Manual - Moniepoint)'
  | 'Card Payment'
  | 'Free Registration'
  | 'Admin Upload';

export type PaymentStatusType = 'Pending' | 'Paid';

export type ExamStartFlowType = 'dashboard_first' | 'immediate';

export interface SystemSettingItem {
  id: string;
  key: 'exam_start_flow' | 'default_candidate_password' | string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamCenter {
  id: string;
  name: string; // e.g., "Q Zone 1", "L Zone", "Main Hall"
  maxCapacity: number; // dynamic any number
  currentCount: number; // default 0
}

export interface Candidate {
  id: string;
  firstName: string;
  middleName: string;
  surname: string;
  email?: string;
  phone?: string;
  password?: string;
  passwordHash?: string; // password_hash in students table
  stateOfOrigin?: string;
  courseOfStudy?: string;
  subjectCombination?: string; // e.g., "English, Mathematics, Biology, Chemistry"
  examCenterId?: string;
  examCenterName?: string;
  gender: GenderType;
  category: CategoryType; // 'Science' | 'Art' | 'Commercial'
  regNumber: string; // e.g., 2027015PHA
  pin: string; // Written into GREEN BOX once generated
  paymentStatus: PaymentStatusType;
  paymentMethod: PaymentMethodType;
  amountPaid: number;
  transactionRef: string;
  proofFileName?: string;
  proofDataUrl?: string;
  passportDataUrl?: string;
  dvaAccountNumber?: string;
  dvaBankName?: string;
  suspended?: boolean;
  proctoringCleared?: boolean;
  examAssigned?: boolean;
  examDate: string;
  examTime: string;
  createdAt: string;
}

export interface QuestionBankItem {
  id: string;
  subject: string;
  title: string;
  description: string;
}

export interface Question {
  id: string;
  subject: string;
  bankId?: string;
  category: CategoryType | 'All';
  questionText: string;
  imageUrl?: string;
  options: [string, string, string, string];
  correctAnswer: number; // 0, 1, 2, or 3
}

export interface AttemptedQuestionItem {
  subject: string;
  questionNumber: number;
  questionText: string;
  imageUrl?: string;
  options: [string, string, string, string];
  selectedAnswer: number | null;
  correctAnswer: number;
}

export interface SubjectScoreDetail {
  score: number; // Psychometric Final Score for this subject (0 to maxCap, e.g. 99)
  total: number; // Max subject cap (e.g., 99) or question count
  rawCorrect?: number;
  questionCount?: number;
  failStreaks?: number;
  passStreaks?: number;
}

export interface ExamResult {
  id: string;
  candidateId: string;
  candidateName: string;
  regNumber: string;
  gender?: GenderType;
  category: CategoryType;
  courseOfStudy?: string;
  stateOfOrigin?: string;
  examCenterName?: string;
  testId?: string;
  testTitle?: string;
  score: number; // Aggregate = sum of all subjects (e.g., 99 + 99 + 99 + 99 = 396)
  maxAggregate?: number; // e.g., 396 (4 subjects * 99)
  rawTotalCorrect?: number;
  totalQuestions: number;
  percentage: number;
  subjectBreakdown: Record<string, SubjectScoreDetail>;
  attemptedRecord?: AttemptedQuestionItem[];
  timeSpentSeconds: number;
  submittedAt: string;
}

export interface BankPoolAllocation {
  bankId: string;
  title: string;
  description: string;
  available: number;
  enabled: boolean;
  pick: number;
}

export interface SubjectPoolConfig {
  subject: string;
  subjectTotal: number;
  expanded?: boolean;
  banks: BankPoolAllocation[];
}

export interface PublishedTest {
  id: string;
  title: string; // e.g. "Rapid Test"
  testCode: string; // e.g. "RAPID-2026-QMT"
  category: CategoryType | 'All';
  durationMinutes: number;
  deadline: string;
  subjectAllocations: Record<string, number>; // e.g. { English: 10, Biology: 10, Physics: 5, Chemistry: 5 }
  totalQuestions: number;
  published: boolean;
  rankingPublished?: boolean; // Only when true does Ranking appear on candidate result slips for this exam
  requireFullscreen: boolean;
  requireCamera: boolean;
  maxAttempts?: number; // Number of attempts permitted per candidate for this published test
  createdAt: string;
}

export type ResultSlipFieldKey =
  | 'candidateName'
  | 'regNumber'
  | 'category'
  | 'gender'
  | 'examinationCentre'
  | 'courseOfStudy'
  | 'stateOfOrigin'
  | 'currentRanking'
  | 'examDateTime'
  | 'subjectCombination'
  | 'email'
  | 'phone'
  | string;

export interface ResultSlipFieldConfig {
  key: ResultSlipFieldKey;
  label: string;
  enabled: boolean;
  isCustom?: boolean;
  customValue?: string;
}

export interface LoginPageBannerConfig {
  brandName: string;
  topSmallLabel: string;
  mainTitle: string;
  description: string;
  footerInfo: string;
}

export interface ResultTitlesConfig {
  testTitle: string; // First word styled green on result slip, e.g. "Quemint"
  testSubtitle: string; // e.g. "Rapid Test"
  assessmentSubtitle: string; // e.g. "Quemint Education Board Assessment"
}

export interface BrandColorsConfig {
  primary: string; // Default: #0a6b3c
  secondary: string; // Default: #0e8a4e
}

export type QuestionDownloadMode =
  | 'Download total questions attempted'
  | 'Download all exam questions & answers'
  | 'Download failed questions only';

export interface ExamSettings {
  examOpen: boolean;
  registrationOpen?: boolean;
  freeRegistration?: boolean;
  allowRegNumberGeneration?: boolean;
  requirePhotoCardDuringRegistration?: boolean;
  examStartFlow?: ExamStartFlowType; // "dashboard_first" | "immediate" (system_settings.exam_start_flow)
  defaultCandidatePassword?: string; // Plain or masked preview for admin convenience
  defaultCandidatePasswordHash?: string; // Hashed master password stored in system_settings.default_candidate_password
  systemSettings?: Record<string, string>; // Mirrors system_settings key-value store
  resultSlipFields?: ResultSlipFieldConfig[]; // Dynamic fields displayed on candidate result slips
  rankingPublishedByTestId?: Record<string, boolean>; // Per-exam ranking publication state
  globalRankingPublished?: boolean; // Global fallback ranking publication state
  examSecurityGlobal: boolean;
  proctoringEnabled: boolean;
  allowCheckResults: boolean;
  enableQuestionDownload: boolean;
  downloadMode: QuestionDownloadMode;
  durationMinutes: number;
  registrationFee: number;
  defaultExamDate: string;
  defaultExamTime: string;
  passMarkPercent: number;
  testAccessCode: string;
  requireTestCodeOnStart: boolean;
  loginBanner: LoginPageBannerConfig;
  resultTitles: ResultTitlesConfig;
  brandColors?: BrandColorsConfig;
  subjectCombinations?: SubjectCombinationConfig[];
  examCenters?: ExamCenter[];
  availableSubjects?: string[];
  questionBanks?: QuestionBankItem[];
  subjectPooling: SubjectPoolConfig[];
  publishedTests: PublishedTest[];
  psychometric: PsychometricConfig;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'registration' | 'payment' | 'pin' | 'exam';
  timestamp: string;
  read: boolean;
}
