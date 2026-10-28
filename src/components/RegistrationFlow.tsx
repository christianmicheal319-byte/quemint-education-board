import React, { useState, useEffect, useRef } from 'react';
import {
  CheckSquare,
  Square,
  CreditCard,
  Building2,
  Zap,
  Copy,
  Check,
  Upload,
  Printer,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  ArrowRight,
  KeyRound,
  Hash,
  Camera,
  Phone,
  Mail,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  MapPin,
  BookOpen,
  GraduationCap,
  Lock,
  X,
} from 'lucide-react';
import {
  Candidate,
  CategoryType,
  ExamCenter,
  ExamSettings,
  GenderType,
  PaymentMethodType,
} from '../types';
import {
  DEFAULT_EXAM_CENTERS,
  DEFAULT_SUBJECTS_LIST,
  DEFAULT_SUBJECT_COMBINATIONS,
  STANDARD_CATEGORIES,
} from '../data/initialData';
import { QuemintSeal } from './QuemintSeal';
import { RegistrationSlipModal } from './RegistrationSlipModal';
import { LivePhotoCaptureCard } from './LivePhotoCaptureCard';
import { generateUniqueQmtRegNumber } from '../utils/pdfSlipGenerator';
import { simpleFallbackHash } from '../utils/passwordHash';

interface RegistrationFlowProps {
  candidates: Candidate[];
  settings: ExamSettings;
  activeCandidateId: string | null;
  onSetActiveCandidateId: (id: string | null) => void;
  onRegisterOrUpdateCandidate: (candidate: Candidate, eventTitle?: string, eventMsg?: string) => void;
  onUpdateSettings?: (settings: ExamSettings) => void;
  onBackToLogin: (prefillRegNo?: string) => void;
  onOpenAdminForConfirmation: () => void;
}

const GENDERS: GenderType[] = ['Male', 'Female'];

export const RegistrationFlow: React.FC<RegistrationFlowProps> = ({
  candidates,
  settings,
  activeCandidateId,
  onSetActiveCandidateId,
  onRegisterOrUpdateCandidate,
  onUpdateSettings,
  onBackToLogin,
  onOpenAdminForConfirmation,
}) => {
  const subjectCombinations =
    settings.subjectCombinations && settings.subjectCombinations.length > 0
      ? settings.subjectCombinations
      : DEFAULT_SUBJECT_COMBINATIONS;

  const allSubjects =
    settings.availableSubjects && settings.availableSubjects.length > 0
      ? settings.availableSubjects
      : DEFAULT_SUBJECTS_LIST;

  const examCenters: ExamCenter[] =
    settings.examCenters && settings.examCenters.length > 0
      ? settings.examCenters
      : DEFAULT_EXAM_CENTERS;

  const availableExamCenters = examCenters.filter(
    (ec) => ec.currentCount < ec.maxCapacity
  );

  // Find active candidate if already created in this session
  const existingCandidate = candidates.find((c) => c.id === activeCandidateId) || null;

  // Existing registration fields (kept 100% intact)
  const [firstName, setFirstName] = useState(existingCandidate?.firstName || '');
  const [middleName, setMiddleName] = useState(existingCandidate?.middleName || '');
  const [surname, setSurname] = useState(existingCandidate?.surname || '');
  const [gender, setGender] = useState<GenderType>(existingCandidate?.gender || 'Female');
  const [email, setEmail] = useState(existingCandidate?.email || '');
  const [phone, setPhone] = useState(existingCandidate?.phone || '');
  const [password, setPassword] = useState(existingCandidate?.password || '');

  // Step A: State of Origin
  const [stateOfOrigin, setStateOfOrigin] = useState(existingCandidate?.stateOfOrigin || '');

  // Step B: Course of Study
  const [courseOfStudy, setCourseOfStudy] = useState(existingCandidate?.courseOfStudy || '');

  // Step C: Subject Combination (Checkbox Dropdown — start empty with no demo subjects; student clicks to open list, checks 4 subjects, clicks Confirm)
  const [selectedSubjectsDraft, setSelectedSubjectsDraft] = useState<string[]>(() => {
    if (existingCandidate?.subjectCombination) {
      return existingCandidate.subjectCombination
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  });
  const [confirmedSubjects, setConfirmedSubjects] = useState<string[]>(() => {
    if (existingCandidate?.subjectCombination) {
      return existingCandidate.subjectCombination
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  });
  const [isSubjectDropdownOpen, setIsSubjectDropdownOpen] = useState(false);
  const [subjectConfirmedBadge, setSubjectConfirmedBadge] = useState<boolean>(
    Boolean(existingCandidate?.subjectCombination)
  );

  // Step D: Category (3 options: Science, Art, Commercial — single select checkbox with Confirm button)
  const [categoryDraft, setCategoryDraft] = useState<CategoryType>(
    existingCandidate?.category || 'Science'
  );
  const [category, setCategory] = useState<CategoryType>(
    existingCandidate?.category || 'Science'
  );
  const [categoryConfirmedBadge, setCategoryConfirmedBadge] = useState(true);

  // Step E: Exam Center / Q-Zones (Checkbox list of available centers where current_count < max_capacity)
  const [selectedExamCenterId, setSelectedExamCenterId] = useState<string>(
    existingCandidate?.examCenterId || availableExamCenters[0]?.id || ''
  );

  const [passportDataUrl, setPassportDataUrl] = useState<string>(() => {
    const raw = existingCandidate?.passportDataUrl || '';
    return raw.startsWith('/proctoring/') ? '' : raw;
  });

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodType>(
    existingCandidate?.paymentMethod || 'Instant Transfer (Paystack DVA)'
  );

  // Paystack DVA states
  const [dvaLoading, setDvaLoading] = useState(false);
  const [dvaAccount, setDvaAccount] = useState<{
    accountNumber: string;
    bankName: string;
    accountName: string;
    transactionRef: string;
  } | null>(
    existingCandidate?.dvaAccountNumber
      ? {
          accountNumber: existingCandidate.dvaAccountNumber,
          bankName: existingCandidate.dvaBankName || 'Paystack-Titan (Wema Bank)',
          accountName: `QUEMINT / ${existingCandidate.firstName.toUpperCase()} ${existingCandidate.surname.toUpperCase()}`,
          transactionRef: existingCandidate.transactionRef,
        }
      : null
  );
  const [dvaCountdown, setDvaCountdown] = useState<number | null>(null);

  // Manual Transfer states
  const [proofFileName, setProofFileName] = useState(existingCandidate?.proofFileName || '');
  const [proofDataUrl, setProofDataUrl] = useState(existingCandidate?.proofDataUrl || '');
  const [manualSubmitted, setManualSubmitted] = useState(
    existingCandidate?.paymentMethod === 'Direct Bank Transfer (Manual - Moniepoint)'
  );

  // Card Payment states
  const [cardNumber, setCardNumber] = useState('5399 8344 1920 4812');
  const [cardExpiry, setCardExpiry] = useState('09/28');
  const [cardCvv, setCardCvv] = useState('482');
  const [cardProcessing, setCardProcessing] = useState(false);

  // Copy states & Slip modal
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [formError, setFormError] = useState('');
  const [detailsSavedBanner, setDetailsSavedBanner] = useState(false);
  const [showConfirmedSuccessPopup, setShowConfirmedSuccessPopup] = useState(false);

  const proofInputRef = useRef<HTMLInputElement>(null);
  const incrementedCenterForCandidateRef = useRef<Record<string, string>>({});
  const requirePhotoCard = Boolean(settings.requirePhotoCardDuringRegistration);

  // Sync local fields when switching to a specific activeCandidateId
  useEffect(() => {
    if (existingCandidate) {
      setFirstName(existingCandidate.firstName);
      setMiddleName(existingCandidate.middleName);
      setSurname(existingCandidate.surname);
      setGender(existingCandidate.gender);
      setEmail(existingCandidate.email || '');
      setPhone(existingCandidate.phone || '');
      setPassword(existingCandidate.password || '');
      setStateOfOrigin(existingCandidate.stateOfOrigin || '');
      setCourseOfStudy(existingCandidate.courseOfStudy || '');
      if (existingCandidate.subjectCombination) {
        const parsedSubjs = existingCandidate.subjectCombination
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parsedSubjs.length > 0) {
          setSelectedSubjectsDraft(parsedSubjs);
          setConfirmedSubjects(parsedSubjs);
        }
      }
      setCategory(existingCandidate.category);
      setCategoryDraft(existingCandidate.category);
      if (existingCandidate.examCenterId) {
        setSelectedExamCenterId(existingCandidate.examCenterId);
      }
      const cleanPassport = existingCandidate.passportDataUrl?.startsWith('/proctoring/')
        ? ''
        : existingCandidate.passportDataUrl || '';
      setPassportDataUrl(cleanPassport);
    }
  }, [activeCandidateId]);

  // Keep selectedExamCenterId defaulted to first available zone if none selected yet
  useEffect(() => {
    if (!selectedExamCenterId && availableExamCenters.length > 0) {
      setSelectedExamCenterId(availableExamCenters[0].id);
    }
  }, [availableExamCenters, selectedExamCenterId]);

  const handleToggleSubjectCheckbox = (subj: string) => {
    setSelectedSubjectsDraft((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === subj.toLowerCase());
      if (exists) {
        const next = prev.filter((s) => s.toLowerCase() !== subj.toLowerCase());
        setSubjectConfirmedBadge(false);
        setConfirmedSubjects((prevConf) =>
          prevConf.filter((s) => s.toLowerCase() !== subj.toLowerCase())
        );
        return next;
      }
      setFormError('');
      setSubjectConfirmedBadge(false);
      return [...prev, subj];
    });
  };

  const handleConfirmSubjectCombination = () => {
    if (selectedSubjectsDraft.length === 0) {
      setFormError('Please select at least one subject before clicking Confirm.');
      return;
    }
    setFormError('');
    setConfirmedSubjects([...selectedSubjectsDraft]);
    setSubjectConfirmedBadge(true);
    setIsSubjectDropdownOpen(false);
    if (existingCandidate) {
      onRegisterOrUpdateCandidate({
        ...existingCandidate,
        subjectCombination: selectedSubjectsDraft.join(', '),
      });
    }
  };

  const handleConfirmCategory = () => {
    setCategory(categoryDraft);
    setCategoryConfirmedBadge(true);
    if (existingCandidate) {
      onRegisterOrUpdateCandidate({
        ...existingCandidate,
        category: categoryDraft,
      });
    }
  };

  // Increment exam center currentCount once when assigning a candidate
  const assignExamCenterAndIncrement = (candId: string, centerId: string) => {
    const chosenCenter =
      examCenters.find((ec) => ec.id === centerId) || availableExamCenters[0];
    if (!chosenCenter) {
      return { examCenterId: undefined, examCenterName: undefined };
    }
    const alreadyAssignedCenterId =
      existingCandidate?.examCenterId || incrementedCenterForCandidateRef.current[candId];
    if (alreadyAssignedCenterId !== chosenCenter.id && onUpdateSettings) {
      incrementedCenterForCandidateRef.current[candId] = chosenCenter.id;
      const updatedCenters = examCenters.map((ec) => {
        if (ec.id === chosenCenter.id && ec.currentCount < ec.maxCapacity) {
          return { ...ec, currentCount: ec.currentCount + 1 };
        }
        return ec;
      });
      onUpdateSettings({
        ...settings,
        examCenters: updatedCenters,
      });
    }
    return {
      examCenterId: chosenCenter.id,
      examCenterName: chosenCenter.name,
    };
  };

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const validateDetails = () => {
    if (!firstName.trim() || !surname.trim()) {
      setFormError('Please enter both your First Name and Surname before proceeding.');
      return false;
    }
    if (!phone.trim()) {
      setFormError('Please enter your Phone Number before proceeding.');
      return false;
    }
    if (!password.trim() && !existingCandidate?.passwordHash) {
      setFormError('Please create a Password for your candidate account before proceeding.');
      return false;
    }
    if (!stateOfOrigin.trim()) {
      setFormError('Please enter your State of Origin (Step A) before proceeding.');
      return false;
    }
    if (!courseOfStudy.trim()) {
      setFormError('Please enter your Course of Study (Step B) before proceeding.');
      return false;
    }
    const activeSubjs =
      confirmedSubjects.length > 0 ? confirmedSubjects : selectedSubjectsDraft;
    if (activeSubjs.length === 0) {
      setFormError(
        'Please select your subjects in Step C (Subject Combination) and click Confirm.'
      );
      return false;
    }
    if (requirePhotoCard && !passportDataUrl) {
      setFormError(
        'Live Photo Card Capture is required. Please use the live camera below and align 1 face inside the oval guide before submitting.'
      );
      return false;
    }
    setFormError('');
    return true;
  };

  const getCandidateExtraFields = (candId: string) => {
    const finalSubjs =
      confirmedSubjects.length > 0 ? confirmedSubjects : selectedSubjectsDraft;
    const finalCat = categoryConfirmedBadge ? category : categoryDraft;
    const { examCenterId, examCenterName } = assignExamCenterAndIncrement(
      candId,
      selectedExamCenterId
    );
    return {
      email: email.trim(),
      phone: phone.trim(),
      password: password,
      passwordHash: password.trim()
        ? simpleFallbackHash(password.trim())
        : existingCandidate?.passwordHash,
      stateOfOrigin: stateOfOrigin.trim(),
      courseOfStudy: courseOfStudy.trim(),
      subjectCombination: finalSubjs.join(', '),
      category: finalCat,
      examCenterId,
      examCenterName,
    };
  };

  // Handle Live Camera Photo Capture (No file/gallery upload allowed)
  const handleLivePhotoCaptured = (dataUrl: string) => {
    setPassportDataUrl(dataUrl);
    setFormError('');
    if (existingCandidate) {
      onRegisterOrUpdateCandidate({
        ...existingCandidate,
        passportDataUrl: dataUrl,
      });
    }
  };

  // A. Instant Transfer - Paystack DVA (/dedicated_account/assign + 8 sec auto-verification)
  const handleAssignDedicatedAccount = async () => {
    if (!validateDetails()) return;
    setDvaLoading(true);
    try {
      const response = await fetch('/dedicated_account/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          middleName: middleName.trim(),
          surname: surname.trim(),
          category,
          amount: settings.registrationFee,
        }),
      });
      const result = await response.json();
      const assigned = {
        accountNumber: result.data.account_number,
        bankName: result.data.bank.name,
        accountName: result.data.account_name,
        transactionRef: result.data.transaction_reference,
      };
      setDvaAccount(assigned);

      const candId = existingCandidate?.id || `cand-${Date.now()}`;
      const extraFields = getCandidateExtraFields(candId);
      const newCand: Candidate = {
        id: candId,
        firstName: firstName.trim(),
        middleName: middleName.trim(),
        surname: surname.trim(),
        gender,
        ...extraFields,
        regNumber: existingCandidate?.regNumber || '',
        pin: existingCandidate?.pin || '',
        paymentStatus: 'Pending',
        paymentMethod: 'Instant Transfer (Paystack DVA)',
        amountPaid: settings.registrationFee,
        transactionRef: assigned.transactionRef,
        dvaAccountNumber: assigned.accountNumber,
        dvaBankName: assigned.bankName,
        passportDataUrl,
        suspended: false,
        examAssigned: false,
        examDate: settings.defaultExamDate,
        examTime: settings.defaultExamTime,
        createdAt: existingCandidate?.createdAt || new Date().toISOString(),
      };
      onSetActiveCandidateId(candId);
      onRegisterOrUpdateCandidate(newCand);
    } catch {
      const fallbackAcc = `78${Math.floor(10000000 + Math.random() * 90000000)}`;
      const fallbackRef = `QMT-DVA-${Date.now().toString().slice(-6)}`;
      setDvaAccount({
        accountNumber: fallbackAcc,
        bankName: 'Paystack-Titan (Wema Bank)',
        accountName: `QUEMINT / ${firstName.trim().toUpperCase()} ${surname.trim().toUpperCase()}`,
        transactionRef: fallbackRef,
      });
    } finally {
      setDvaLoading(false);
    }
  };

  // Start 8-second Paystack DVA Auto-Verification
  const handleStartDvaAutoVerify = () => {
    if (!validateDetails() || !dvaAccount) return;
    setDvaCountdown(8);
  };

  useEffect(() => {
    if (dvaCountdown === null) return;
    if (dvaCountdown > 0) {
      const timer = setTimeout(() => {
        setDvaCountdown((prev) => (prev !== null ? prev - 1 : null));
      }, 1000);
      return () => clearTimeout(timer);
    }

    // Countdown reached 0 -> Call webhook & auto-generate PIN into GREEN BOX
    const finalizeDvaWebhook = async () => {
      const candId = existingCandidate?.id || `cand-${Date.now()}`;
      let generatedPin = `QMT-${Math.floor(100000 + Math.random() * 900000)}`;
      try {
        const res = await fetch('/api/paystack/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateId: candId,
            transactionRef: dvaAccount?.transactionRef,
          }),
        });
        const data = await res.json();
        if (data?.data?.pin) {
          generatedPin = data.data.pin;
        }
      } catch {
        // Fallback PIN already set
      }

      const extraFields = getCandidateExtraFields(candId);
      const updatedCand: Candidate = {
        id: candId,
        firstName: firstName.trim(),
        middleName: middleName.trim(),
        surname: surname.trim(),
        gender,
        ...extraFields,
        regNumber: existingCandidate?.regNumber || '',
        pin: generatedPin,
        paymentStatus: 'Paid',
        paymentMethod: 'Instant Transfer (Paystack DVA)',
        amountPaid: settings.registrationFee,
        transactionRef: dvaAccount?.transactionRef || `QMT-DVA-${Date.now().toString().slice(-6)}`,
        dvaAccountNumber: dvaAccount?.accountNumber,
        dvaBankName: dvaAccount?.bankName,
        passportDataUrl,
        suspended: false,
        examAssigned: true,
        examDate: settings.defaultExamDate,
        examTime: settings.defaultExamTime,
        createdAt: existingCandidate?.createdAt || new Date().toISOString(),
      };
      onSetActiveCandidateId(candId);
      onRegisterOrUpdateCandidate(
        updatedCand,
        'Paystack DVA Auto-Verified (8s)',
        `${updatedCand.firstName} ${updatedCand.surname} (${updatedCand.category}) paid ₦${settings.registrationFee.toLocaleString()} via Paystack DVA. PIN ${generatedPin} written to GREEN BOX.`
      );
      setDvaCountdown(null);
    };

    finalizeDvaWebhook();
  }, [dvaCountdown]);

  // B. Manual Transfer - Proof Upload & Submit to Admin Dashboard
  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProofDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmitManualProof = () => {
    if (!validateDetails()) return;
    const candId = existingCandidate?.id || `cand-${Date.now()}`;
    const extraFields = getCandidateExtraFields(candId);
    const txRef = existingCandidate?.transactionRef || `MNP-9135688236-${Math.floor(100 + Math.random() * 900)}`;
    const newCand: Candidate = {
      id: candId,
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      surname: surname.trim(),
      gender,
      ...extraFields,
      regNumber: existingCandidate?.regNumber || '',
      pin: existingCandidate?.pin || '',
      paymentStatus: existingCandidate?.paymentStatus || 'Pending',
      paymentMethod: 'Direct Bank Transfer (Manual - Moniepoint)',
      amountPaid: settings.registrationFee,
      transactionRef: txRef,
      proofFileName: proofFileName || 'moniepoint_transfer_receipt.jpg',
      proofDataUrl,
      passportDataUrl,
      suspended: false,
      examAssigned: false,
      examDate: settings.defaultExamDate,
      examTime: settings.defaultExamTime,
      createdAt: existingCandidate?.createdAt || new Date().toISOString(),
    };
    onSetActiveCandidateId(candId);
    onRegisterOrUpdateCandidate(
      newCand,
      'Manual Transfer Proof Uploaded',
      `${newCand.firstName} ${newCand.surname} (${newCand.category}) uploaded payment proof (${newCand.proofFileName}) for Moniepoint 9135688236. Awaiting Admin Confirm Payment & Generate PIN.`
    );
    setManualSubmitted(true);
  };

  // C. Card Payment Handler
  const handleCardPayment = () => {
    if (!validateDetails()) return;
    setCardProcessing(true);
    setTimeout(() => {
      const candId = existingCandidate?.id || `cand-${Date.now()}`;
      const extraFields = getCandidateExtraFields(candId);
      const generatedPin = `QMT-${Math.floor(100000 + Math.random() * 900000)}`;
      const txRef = `QMT-CRD-${Date.now().toString().slice(-6)}`;
      const updatedCand: Candidate = {
        id: candId,
        firstName: firstName.trim(),
        middleName: middleName.trim(),
        surname: surname.trim(),
        gender,
        ...extraFields,
        regNumber: existingCandidate?.regNumber || '',
        pin: generatedPin,
        paymentStatus: 'Paid',
        paymentMethod: 'Card Payment',
        amountPaid: settings.registrationFee,
        transactionRef: txRef,
        passportDataUrl,
        suspended: false,
        examAssigned: true,
        examDate: settings.defaultExamDate,
        examTime: settings.defaultExamTime,
        createdAt: existingCandidate?.createdAt || new Date().toISOString(),
      };
      onSetActiveCandidateId(candId);
      onRegisterOrUpdateCandidate(
        updatedCand,
        'Card Payment Confirmed',
        `${updatedCand.firstName} ${updatedCand.surname} paid ₦${settings.registrationFee.toLocaleString()} via Card. PIN ${generatedPin} written to GREEN BOX.`
      );
      setCardProcessing(false);
    }, 1500);
  };

  const isFreeRegistration = Boolean(
    settings.freeRegistration || settings.registrationFee === 0
  );
  const isRegNumberGenerationAllowed = Boolean(settings.allowRegNumberGeneration);

  // 5. Generate Registration Number (e.g., QMT2027001AA) when allowed by Admin
  const handleGenerateRegNumber = () => {
    if (!validateDetails()) return;
    if (!isRegNumberGenerationAllowed) return;
    if (existingCandidate?.regNumber) return;

    const generatedRegNo = generateUniqueQmtRegNumber(candidates);
    const candId = existingCandidate?.id || `cand-${Date.now()}`;
    const extraFields = getCandidateExtraFields(candId);

    const updatedCand: Candidate = {
      id: candId,
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      surname: surname.trim(),
      gender,
      ...extraFields,
      regNumber: generatedRegNo,
      pin: isFreeRegistration ? '' : existingCandidate?.pin || '',
      paymentStatus: existingCandidate?.paymentStatus || 'Pending',
      paymentMethod: isFreeRegistration
        ? 'Free Registration'
        : existingCandidate?.paymentMethod || selectedPaymentMethod,
      amountPaid: isFreeRegistration ? 0 : settings.registrationFee,
      transactionRef:
        existingCandidate?.transactionRef ||
        (isFreeRegistration
          ? `QMT-FREE-${Date.now().toString().slice(-6)}`
          : `QMT-REF-${Date.now().toString().slice(-6)}`),
      proofFileName: existingCandidate?.proofFileName,
      proofDataUrl: existingCandidate?.proofDataUrl,
      passportDataUrl: passportDataUrl || existingCandidate?.passportDataUrl,
      dvaAccountNumber: existingCandidate?.dvaAccountNumber,
      dvaBankName: existingCandidate?.dvaBankName,
      suspended: false,
      examAssigned: existingCandidate?.paymentStatus === 'Paid',
      examDate: settings.defaultExamDate,
      examTime: settings.defaultExamTime,
      createdAt: existingCandidate?.createdAt || new Date().toISOString(),
    };

    onSetActiveCandidateId(candId);
    onRegisterOrUpdateCandidate(
      updatedCand,
      'Registration Number Generated',
      isFreeRegistration
        ? `Generated Registration Number ${generatedRegNo} for ${updatedCand.firstName} ${updatedCand.surname} (Free Registration — Awaiting Admin Approval to activate Registration Number).`
        : `Generated Registration Number ${generatedRegNo} for ${updatedCand.firstName} ${updatedCand.surname}.`
    );
  };

  // Save / Submit Candidate Registration Bio-Data so Admin can view all filled details before approval
  const handleSaveRegistrationDetails = () => {
    if (!validateDetails()) return;
    const generatedRegNo = isRegNumberGenerationAllowed
      ? existingCandidate?.regNumber || generateUniqueQmtRegNumber(candidates)
      : existingCandidate?.regNumber || '';
    const candId = existingCandidate?.id || `cand-${Date.now()}`;
    const extraFields = getCandidateExtraFields(candId);

    const updatedCand: Candidate = {
      id: candId,
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      surname: surname.trim(),
      gender,
      ...extraFields,
      regNumber: generatedRegNo,
      pin: isFreeRegistration || !isRegNumberGenerationAllowed ? '' : existingCandidate?.pin || '',
      paymentStatus: existingCandidate?.paymentStatus || 'Pending',
      paymentMethod:
        isFreeRegistration || !isRegNumberGenerationAllowed
          ? 'Free Registration'
          : existingCandidate?.paymentMethod || selectedPaymentMethod,
      amountPaid: isFreeRegistration || !isRegNumberGenerationAllowed ? 0 : settings.registrationFee,
      transactionRef:
        existingCandidate?.transactionRef ||
        (isFreeRegistration || !isRegNumberGenerationAllowed
          ? `QMT-FREE-${Date.now().toString().slice(-6)}`
          : `QMT-REG-${Date.now().toString().slice(-6)}`),
      proofFileName: proofFileName || existingCandidate?.proofFileName,
      proofDataUrl: proofDataUrl || existingCandidate?.proofDataUrl,
      passportDataUrl: passportDataUrl || existingCandidate?.passportDataUrl,
      dvaAccountNumber: existingCandidate?.dvaAccountNumber,
      dvaBankName: existingCandidate?.dvaBankName,
      suspended: existingCandidate?.suspended || false,
      examAssigned: existingCandidate?.paymentStatus === 'Paid',
      examDate: settings.defaultExamDate,
      examTime: settings.defaultExamTime,
      createdAt: existingCandidate?.createdAt || new Date().toISOString(),
    };

    onSetActiveCandidateId(candId);
    onRegisterOrUpdateCandidate(
      updatedCand,
      'Candidate Registration Submitted',
      `${updatedCand.firstName} ${updatedCand.middleName ? updatedCand.middleName + ' ' : ''}${updatedCand.surname} (${updatedCand.gender}, ${updatedCand.category}${updatedCand.examCenterName ? ` • ${updatedCand.examCenterName}` : ''}) submitted registration details${generatedRegNo ? ` (Reg No: ${generatedRegNo})` : ' (Awaiting Admin Approval & QMT Reg Number Generation)'}.`
    );

    if (!isRegNumberGenerationAllowed) {
      setShowConfirmedSuccessPopup(true);
    } else {
      setDetailsSavedBanner(true);
      setTimeout(() => setDetailsSavedBanner(false), 5000);
    }
  };

  const currentPin = existingCandidate?.pin || '';
  const currentRegNo = existingCandidate?.regNumber || '';
  const isPaid = existingCandidate?.paymentStatus === 'Paid';

  // Category options (Science, Art, Commercial + any custom admin categories)
  const categoryOptions: string[] = Array.from(
    new Set([
      ...STANDARD_CATEGORIES,
      ...subjectCombinations.map((sc) => sc.name).filter(
        (n) => !['medical', 'engineering', 'arts'].includes(n.trim().toLowerCase())
      ),
    ])
  );

  return (
    <div className="min-h-screen bg-white text-black">
      {/* Top Bar with Quemint Education Board Seal (Green) on Top Left */}
      <header className="sticky top-0 z-30 bg-white border-b border-neutral-200 px-4 md:px-8 py-3.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <QuemintSeal
            size="sm"
            variant="green"
            subtitle={
              isFreeRegistration
                ? 'Candidate Examination Registration Portal'
                : 'Candidate Registration & Payment Portal'
            }
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              onSetActiveCandidateId(null);
              setFirstName('');
              setMiddleName('');
              setSurname('');
              setEmail('');
              setPhone('');
              setPassword('');
              setStateOfOrigin('');
              setCourseOfStudy('');
              setSelectedSubjectsDraft([]);
              setConfirmedSubjects([]);
              setSubjectConfirmedBadge(false);
              setIsSubjectDropdownOpen(false);
              setDvaAccount(null);
              setManualSubmitted(false);
            }}
            className="px-3.5 py-2 text-xs font-semibold text-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            + New Registration
          </button>
          <button
            type="button"
            onClick={() => onBackToLogin(currentRegNo || undefined)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0a6b3c] hover:bg-[#0e8a4e] rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Candidate Login
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">
        {/* Green Hero Banner */}
        <div className="bg-[#0a6b3c] text-white rounded-2xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="text-xs font-bold uppercase tracking-widest text-white/85">
              QUEMINT EDUCATION BOARD • 2026/2027 SESSION
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              {!isRegNumberGenerationAllowed || isFreeRegistration
                ? 'Candidate Examination Registration Portal'
                : 'Candidate Examination Registration & GREEN BOX Portal'}
            </h1>
            <p className="text-sm text-white/90 leading-relaxed">
              {!isRegNumberGenerationAllowed
                ? 'Fill in your candidate registration details below and click Confirmed to submit your registration for Admin approval.'
                : isFreeRegistration
                ? 'Complete your bio-data, select your subjects, category, and Examination Centre, generate your Registration Number, and submit your details for Admin approval.'
                : 'Complete your bio-data, select your subjects, category, and Examination Centre, and verify your registration fee to receive your official Examination PIN inside the GREEN BOX.'}
            </p>
          </div>
          {isRegNumberGenerationAllowed && (
            <div className="bg-[#0e8a4e] border border-white/25 rounded-xl p-4 shrink-0 text-left md:text-right">
              <span className="block text-xs uppercase tracking-wider text-white/85 font-semibold">
                {isFreeRegistration ? 'Registration Mode' : 'Official Registration Fee'}
              </span>
              <span className="font-mono text-2xl md:text-3xl font-extrabold text-white tabular-nums">
                {isFreeRegistration
                  ? 'FREE'
                  : `₦${settings.registrationFee.toLocaleString()}.00`}
              </span>
              <span className="block text-[11px] text-white/80 mt-0.5">
                {isFreeRegistration
                  ? 'Admin Approval Required for Exam Login'
                  : 'Instant PIN & Photocard Slip Included'}
              </span>
            </div>
          )}
        </div>

        {formError && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm font-semibold">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT COLUMN: Step 1 & Step 2 (Student Details & Payment Methods) */}
          <div
            className={`${
              isRegNumberGenerationAllowed ? 'lg:col-span-7' : 'lg:col-span-12 max-w-3xl mx-auto w-full'
            } space-y-6`}
          >
            {/* STEP 1: Fill Candidate Details (Existing Fields + Steps A–E) */}
            <section className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c]">
                    Step 01
                  </span>
                  <h2 className="text-lg font-extrabold text-black">
                    Candidate Bio-Data, Subject Combination &amp; Examination Centre
                  </h2>
                </div>
                <span className="px-3 py-1 rounded-md bg-[#0a6b3c] text-white text-xs font-bold">
                  {category}
                </span>
              </div>

              {/* Existing Name Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    First Name <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Chiamaka"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    Middle Name
                  </label>
                  <input
                    type="text"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="e.g. Blessing"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    Surname <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    placeholder="e.g. Okafor"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                  />
                </div>
              </div>

              {/* Existing Account / Contact Fields (Email, Phone, Password) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="student@email.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    Phone Number <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 08031234567"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                    Password <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create password"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Existing Gender Checkboxes: [ Checkbox ] Male / Female */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-2">
                  Gender (Select Checkbox)
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {GENDERS.map((g) => {
                    const checked = gender === g;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setGender(g)}
                        className={`flex items-center gap-2.5 px-4 py-3 rounded-lg border text-sm font-bold transition-colors cursor-pointer ${
                          checked
                            ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                            : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 shrink-0 text-neutral-400" />
                        )}
                        <span>{g}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* STEP A & STEP B: State of Origin + Course of Study */}
              <div className="pt-3 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c] mb-1.5">
                    Step A • State of Origin <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={stateOfOrigin}
                    onChange={(e) => setStateOfOrigin(e.target.value)}
                    placeholder="e.g. Anambra, Lagos, Kano"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c] mb-1.5">
                    Step B • Course of Study <span className="text-[#0a6b3c]">*</span>
                  </label>
                  <div className="relative">
                    <GraduationCap className="w-4 h-4 text-[#0a6b3c] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      required
                      value={courseOfStudy}
                      onChange={(e) => setCourseOfStudy(e.target.value)}
                      placeholder="e.g. Medicine, Law, Computer Science"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm rounded-lg border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none text-black bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* STEP C: Subject Combination (Checkbox Dropdown + Any Number of Subjects + Confirm Button + Tags) */}
              <div className="pt-3 border-t border-neutral-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Step C • Subject Combination
                    </label>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      <strong>Instructions:</strong> Click <strong>&quot;Select Subject Combination&quot;</strong> below to open the subject list, check your examination subjects, and click <strong>Confirm</strong>.
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold ${
                      selectedSubjectsDraft.length > 0
                        ? 'bg-[#0a6b3c]/15 text-[#0a6b3c]'
                        : 'bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    {selectedSubjectsDraft.length} Checked
                  </span>
                </div>

                {/* Selected Subject Tags (Only shown after student confirms or selects subjects) */}
                {confirmedSubjects.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {confirmedSubjects.map((subj) => (
                      <span
                        key={subj}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-xs font-bold shadow-2xs"
                      >
                        <BookOpen className="w-3 h-3" />
                        <span>{subj}</span>
                        <button
                          type="button"
                          onClick={() => handleToggleSubjectCheckbox(subj)}
                          className="hover:text-white/75 cursor-pointer"
                          title={`Remove ${subj}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {subjectConfirmedBadge && confirmedSubjects.length > 0 && (
                      <span className="text-[11px] font-extrabold text-[#0a6b3c] ml-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Confirmed
                      </span>
                    )}
                  </div>
                )}

                {/* Dropdown Trigger Button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsSubjectDropdownOpen((prev) => !prev)}
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#0a6b3c] bg-neutral-50 hover:bg-[#0a6b3c]/5 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-extrabold text-black">
                      {confirmedSubjects.length > 0 && subjectConfirmedBadge
                        ? `Subject Combination Confirmed (${confirmedSubjects.length}): ${confirmedSubjects.join(', ')}`
                        : selectedSubjectsDraft.length > 0
                        ? `Selecting Subjects (${selectedSubjectsDraft.length} checked) — Click to view list`
                        : 'Select Subject Combination (Click to open subject list & check subjects)'}
                    </span>
                    {isSubjectDropdownOpen ? (
                      <ChevronUp className="w-4 h-4 text-[#0a6b3c] shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-[#0a6b3c] shrink-0" />
                    )}
                  </button>

                  {isSubjectDropdownOpen && (
                    <div className="mt-2 p-4 rounded-xl border-2 border-[#0a6b3c] bg-white shadow-lg space-y-3">
                      <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
                        <span className="text-xs font-extrabold text-[#0a6b3c]">
                          Check Subjects ({selectedSubjectsDraft.length} checked)
                        </span>
                        <button
                          type="button"
                          onClick={handleConfirmSubjectCombination}
                          disabled={selectedSubjectsDraft.length === 0}
                          className="px-3.5 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm Subjects</span>
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto pr-1">
                        {allSubjects.map((subj) => {
                          const isChecked = selectedSubjectsDraft.some(
                            (s) => s.toLowerCase() === subj.toLowerCase()
                          );
                          return (
                            <button
                              key={subj}
                              type="button"
                              onClick={() => handleToggleSubjectCheckbox(subj)}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold text-left transition-colors cursor-pointer ${
                                isChecked
                                  ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                                  : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                              }`}
                            >
                              {isChecked ? (
                                <CheckSquare className="w-4 h-4 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 shrink-0 text-neutral-400" />
                              )}
                              <span className="truncate">{subj}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="pt-2 border-t border-neutral-200 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-neutral-500">
                          Saved as comma-separated: <strong>{selectedSubjectsDraft.join(', ') || 'None'}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={handleConfirmSubjectCombination}
                          disabled={selectedSubjectsDraft.length === 0}
                          className="px-4 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Confirm</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* STEP D: Category (CHECKBOX: Science, Art, Commercial + Confirm Button) */}
              <div className="pt-3 border-t border-neutral-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Step D • Category (Checkbox — Science, Art, Commercial)
                    </label>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Select your category and click <strong>Confirm</strong>. Categories are not locked to fixed subjects.
                    </p>
                  </div>
                  {categoryConfirmedBadge && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-[#0a6b3c]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Confirmed: {category}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {categoryOptions.map((catOption) => {
                    const checked =
                      categoryDraft.trim().toLowerCase() === catOption.trim().toLowerCase();
                    return (
                      <button
                        key={catOption}
                        type="button"
                        onClick={() => {
                          setCategoryDraft(catOption);
                          setCategory(catOption);
                          setCategoryConfirmedBadge(false);
                        }}
                        className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-xs font-extrabold transition-colors cursor-pointer ${
                          checked
                            ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                            : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                        }`}
                      >
                        {checked ? (
                          <CheckSquare className="w-4 h-4 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 shrink-0 text-neutral-400" />
                        )}
                        <span>{catOption}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleConfirmCategory}
                    className="px-4 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Confirm Category ({categoryDraft})</span>
                  </button>
                </div>
              </div>

              {/* STEP E: Examination Centre (Checkbox List — only where current_count < max_capacity) */}
              <div className="pt-3 border-t border-neutral-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Step E • Examination Centre (Select Available Centre)
                    </label>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Showing available examination centres with remaining capacity (<code className="font-mono">current_count &lt; max_capacity</code>).
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] text-[11px] font-extrabold">
                    {availableExamCenters.length} Centre(s) Available
                  </span>
                </div>

                {availableExamCenters.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold">
                    All Examination Centres are currently at full capacity. Please contact the Administrator to increase centre capacity.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {availableExamCenters.map((center) => {
                      const slotsLeft = Math.max(0, center.maxCapacity - center.currentCount);
                      const checked = selectedExamCenterId === center.id;
                      return (
                        <button
                          key={center.id}
                          type="button"
                          onClick={() => setSelectedExamCenterId(center.id)}
                          className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl border text-xs font-bold transition-colors cursor-pointer text-left ${
                            checked
                              ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-2xs'
                              : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {checked ? (
                              <CheckSquare className="w-4 h-4 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 shrink-0 text-neutral-400" />
                            )}
                            <div className="truncate">
                              <div className="font-extrabold flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{center.name}</span>
                              </div>
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-extrabold shrink-0 ${
                              checked
                                ? 'bg-[#0e8a4e] text-white'
                                : 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                            }`}
                          >
                            {slotsLeft} left
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* STEP 02 (Only when Admin Require Photo Card During Registration == ON): Live Photo Capture */}
              {requirePhotoCard && (
                <div className="pt-3 border-t border-neutral-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Step 02 • Compulsory Live Photo Capture
                    </span>
                    <span
                      className={`text-[11px] font-extrabold ${
                        passportDataUrl ? 'text-[#0a6b3c]' : 'text-red-600'
                      }`}
                    >
                      {passportDataUrl
                        ? '✓ 1 Face Validated & Saved'
                        : 'Required to Submit Registration'}
                    </span>
                  </div>
                  <LivePhotoCaptureCard
                    required={true}
                    currentPhotoUrl={passportDataUrl}
                    onPhotoCaptured={handleLivePhotoCaptured}
                  />
                </div>
              )}

              {/* Save / Submit Registration Details for Admin Review */}
              <div className="pt-3 border-t border-neutral-100 space-y-2.5">
                {requirePhotoCard && !passportDataUrl && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold flex items-center gap-2">
                    <Camera className="w-4 h-4 shrink-0 text-[#0a6b3c]" />
                    <span>
                      Please complete Live Photo Capture above (1 face inside the oval guide) to unlock the registration submit button.
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSaveRegistrationDetails}
                  disabled={requirePhotoCard && !passportDataUrl}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {!isRegNumberGenerationAllowed
                      ? 'Confirmed'
                      : existingCandidate
                      ? 'Update & Save Registration Details'
                      : 'Submit Registration Details for Approval'}
                  </span>
                </button>
                {isRegNumberGenerationAllowed && (detailsSavedBanner || existingCandidate) && (
                  <div className="p-3 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-[#0a6b3c]">
                      ✓ Registration details saved ({firstName} {middleName} {surname} • {gender} • {category} • {confirmedSubjects.join(', ')}). Admin can now view all your filled details before approval.
                    </span>
                    <button
                      type="button"
                      onClick={onOpenAdminForConfirmation}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#0a6b3c] text-white text-[11px] font-bold hover:bg-[#0e8a4e] cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>View in Admin</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* Payment Methods Step (Hidden when Free Registration is active or Reg Number Generation is Disallowed) */}
            {!isFreeRegistration && isRegNumberGenerationAllowed && (
              <section className="bg-white rounded-2xl border border-neutral-200 p-6 space-y-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-4">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c]">
                      {requirePhotoCard ? 'Step 03' : 'Step 02'}
                    </span>
                  <h2 className="text-lg font-extrabold text-black">
                    Select Payment Method
                  </h2>
                </div>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0a6b3c]/10 text-[#0a6b3c] text-xs font-extrabold">
                  <span>Registration Fee:</span>
                  <span className="font-mono tabular-nums">
                    ₦{settings.registrationFee.toLocaleString()}.00
                  </span>
                </div>
              </div>

              {/* 3 Payment Method Selector Tabs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedPaymentMethod('Instant Transfer (Paystack DVA)')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    selectedPaymentMethod === 'Instant Transfer (Paystack DVA)'
                      ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-xs'
                      : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Zap className="w-4 h-4" />
                    <span
                      className={`text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                        selectedPaymentMethod === 'Instant Transfer (Paystack DVA)'
                          ? 'bg-[#0e8a4e] text-white'
                          : 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                      }`}
                    >
                      Recommended
                    </span>
                  </div>
                  <div className="font-bold text-xs">Instant Transfer</div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      selectedPaymentMethod === 'Instant Transfer (Paystack DVA)'
                        ? 'text-white/85'
                        : 'text-neutral-500'
                    }`}
                  >
                    Paystack DVA (8s Auto-Verify)
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSelectedPaymentMethod('Direct Bank Transfer (Manual - Moniepoint)')
                  }
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    selectedPaymentMethod === 'Direct Bank Transfer (Manual - Moniepoint)'
                      ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-xs'
                      : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <Building2 className="w-4 h-4" />
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        selectedPaymentMethod === 'Direct Bank Transfer (Manual - Moniepoint)'
                          ? 'text-white/80'
                          : 'text-neutral-500'
                      }`}
                    >
                      Manual
                    </span>
                  </div>
                  <div className="font-bold text-xs">Direct Bank Transfer</div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      selectedPaymentMethod === 'Direct Bank Transfer (Manual - Moniepoint)'
                        ? 'text-white/85'
                        : 'text-neutral-500'
                    }`}
                  >
                    Moniepoint MFB
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedPaymentMethod('Card Payment')}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                    selectedPaymentMethod === 'Card Payment'
                      ? 'bg-[#0a6b3c] text-white border-[#0a6b3c] shadow-xs'
                      : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <CreditCard className="w-4 h-4" />
                    <span
                      className={`text-[10px] font-bold uppercase ${
                        selectedPaymentMethod === 'Card Payment'
                          ? 'text-white/80'
                          : 'text-neutral-500'
                      }`}
                    >
                      Instant
                    </span>
                  </div>
                  <div className="font-bold text-xs">Card Payment</div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      selectedPaymentMethod === 'Card Payment'
                        ? 'text-white/85'
                        : 'text-neutral-500'
                    }`}
                  >
                    Mastercard / Visa / Verve
                  </div>
                </button>
              </div>

              {/* PAYMENT VIEW A: Instant Transfer - Paystack DVA */}
              {selectedPaymentMethod === 'Instant Transfer (Paystack DVA)' && (
                <div className="p-5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-black">
                        Instant Transfer — Paystack Dedicated Virtual Account (DVA)
                      </h3>
                      <p className="text-xs text-neutral-600 mt-0.5">
                        Calls <code className="font-mono text-[#0a6b3c]">/dedicated_account/assign</code> to generate a unique account number. Webhook auto-verifies in 8 seconds and writes PIN into your GREEN BOX.
                      </p>
                    </div>
                  </div>

                  {!dvaAccount ? (
                    <button
                      type="button"
                      onClick={handleAssignDedicatedAccount}
                      disabled={dvaLoading}
                      className="w-full py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {dvaLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Calling /dedicated_account/assign...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Generate Unique Paystack DVA Account Number
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-white border-2 border-[#0a6b3c] space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-neutral-500 font-medium">Assigned Bank:</span>
                          <span className="font-bold text-black">{dvaAccount.bankName}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-neutral-500 font-medium">
                            Unique Account Number:
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-lg font-extrabold text-[#0a6b3c] tabular-nums">
                              {dvaAccount.accountNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopy(dvaAccount.accountNumber, 'dva-acc')}
                              className="p-1.5 rounded bg-[#0a6b3c]/10 text-[#0a6b3c] hover:bg-[#0a6b3c]/20 cursor-pointer"
                            >
                              {copiedKey === 'dva-acc' ? (
                                <Check className="w-3.5 h-3.5" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-neutral-500 font-medium">Account Name:</span>
                          <span className="font-bold text-black">{dvaAccount.accountName}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs pt-2 border-t border-neutral-100">
                          <span className="text-neutral-500 font-medium">Amount to Transfer:</span>
                          <span className="font-mono font-extrabold text-black tabular-nums">
                            ₦{settings.registrationFee.toLocaleString()}.00
                          </span>
                        </div>
                      </div>

                      {isPaid ? (
                        <div className="p-3.5 rounded-xl bg-[#0a6b3c] text-white text-xs font-bold flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            Paystack Webhook Confirmed! PIN auto-written into GREEN BOX.
                          </span>
                          <span className="font-mono">{currentPin}</span>
                        </div>
                      ) : dvaCountdown !== null ? (
                        <div className="p-4 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c] space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-[#0a6b3c]">
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Awaiting Paystack Webhook Auto-Verification...
                            </span>
                            <span className="font-mono text-sm tabular-nums">{dvaCountdown}s</span>
                          </div>
                          <div className="w-full h-2 bg-white rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#0a6b3c] transition-all duration-1000"
                              style={{ width: `${((8 - dvaCountdown) / 8) * 100}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartDvaAutoVerify}
                          className="w-full py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          I Have Made Transfer (Auto-Verify in 8 Secs)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* PAYMENT VIEW B: Direct Bank Transfer (Manual - Moniepoint) */}
              {selectedPaymentMethod === 'Direct Bank Transfer (Manual - Moniepoint)' && (
                <div className="p-5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-black">
                      Direct Bank Transfer (Manual Verification — Moniepoint MFB)
                    </h3>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      Transfer <strong className="text-black">₦{settings.registrationFee.toLocaleString()}.00</strong> to the official Moniepoint account below and upload your payment receipt.
                    </p>
                  </div>

                  {/* Official Moniepoint Account Details Box */}
                  <div className="p-4 rounded-xl bg-white border-2 border-[#0a6b3c] space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-medium">Account No:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-lg font-extrabold text-[#0a6b3c] tabular-nums">
                          9135688236
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy('9135688236', 'moniepoint')}
                          className="px-2 py-1 rounded bg-[#0a6b3c] text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer"
                        >
                          {copiedKey === 'moniepoint' ? (
                            <>
                              <Check className="w-3 h-3" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-medium">Bank:</span>
                      <span className="font-extrabold text-black">Moniepoint MFB</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-neutral-500 font-medium">Name:</span>
                      <span className="font-extrabold text-black">Akpoviri Evans</span>
                    </div>

                    <div className="pt-2 border-t border-neutral-200 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-500 font-medium flex items-center gap-1">
                          <Mail className="w-3.5 h-3.5 text-[#0a6b3c]" /> Email:
                        </span>
                        <span className="font-semibold text-black">
                          christianevans895@gmail.com
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-500 font-medium flex items-center gap-1">
                          <Phone className="w-3.5 h-3.5 text-[#0a6b3c]" /> WhatsApp:
                        </span>
                        <span className="font-mono font-bold text-[#0a6b3c] tabular-nums">
                          08107812604 / 08142847261
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Upload Payment Proof */}
                  <div className="space-y-3">
                    <label className="block text-xs font-bold uppercase tracking-wider text-neutral-700">
                      Upload Payment Proof (Receipt Screenshot / Image)
                    </label>
                    <input
                      ref={proofInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleProofFileChange}
                      className="hidden"
                    />
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                      <button
                        type="button"
                        onClick={() => proofInputRef.current?.click()}
                        className="flex-1 py-2.5 px-4 rounded-xl border border-dashed border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/5 text-[#0a6b3c] text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        {proofFileName ? `Selected: ${proofFileName}` : 'Choose Transfer Receipt File'}
                      </button>

                      <button
                        type="button"
                        onClick={handleSubmitManualProof}
                        className="py-2.5 px-5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-bold transition-colors cursor-pointer shrink-0"
                      >
                        Submit Proof to Admin
                      </button>
                    </div>

                    {manualSubmitted && (
                      <div className="p-4 rounded-xl bg-[#0a6b3c]/10 border border-[#0a6b3c] space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-[#0a6b3c]">
                            {isPaid
                              ? 'Payment Confirmed by Admin! PIN Written to GREEN BOX.'
                              : 'Proof Received in Uploaded Candidates Dashboard (Pending Admin Confirmation)'}
                          </span>
                        </div>
                        {!isPaid && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                            <p className="text-[11px] text-neutral-700">
                              Once Admin clicks <strong>Confirm Payment</strong> and <strong>Generate PIN</strong>, your PIN automatically appears in the GREEN BOX.
                            </p>
                            <button
                              type="button"
                              onClick={onOpenAdminForConfirmation}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0a6b3c] text-white text-[11px] font-bold hover:bg-[#0e8a4e] cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <span>Open Admin to Confirm & Generate PIN</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PAYMENT VIEW C: Card Payment */}
              {selectedPaymentMethod === 'Card Payment' && (
                <div className="p-5 rounded-xl bg-neutral-50 border border-neutral-200 space-y-4">
                  <div>
                    <h3 className="text-sm font-extrabold text-black">
                      Instant Debit / Credit Card Payment
                    </h3>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      Pay securely with Verve, Mastercard, or Visa. Auto-generates PIN into your GREEN BOX upon completion.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold uppercase text-neutral-600 mb-1">
                        Card Number
                      </label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-neutral-300 bg-white text-black"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold uppercase text-neutral-600 mb-1">
                        Expiry Date (MM/YY)
                      </label>
                      <input
                        type="text"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-neutral-300 bg-white text-black"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-neutral-600 mb-1">
                        CVV
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-neutral-300 bg-white text-black"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCardPayment}
                    disabled={cardProcessing || isPaid}
                    className="w-full py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {cardProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Verifying Card & Writing PIN to GREEN BOX...
                      </>
                    ) : isPaid ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Card Payment Verified — PIN Written to GREEN BOX
                      </>
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4" />
                        Pay ₦{settings.registrationFee.toLocaleString()}.00 & Generate PIN
                      </>
                    )}
                  </button>
                </div>
              )}
              </section>
            )}
          </div>

          {/* RIGHT COLUMN: Generate Registration Number, Approval Status, & Printable Slip (Shown only when Reg Number Generation is Allowed by Admin) */}
          {isRegNumberGenerationAllowed && (
            <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-20">
              <section className="rounded-2xl border-2 border-[#0a6b3c] bg-white overflow-hidden shadow-md">
              <div className="bg-[#0a6b3c] px-5 py-4 text-white flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isFreeRegistration ? (
                    <Hash className="w-5 h-5" />
                  ) : (
                    <KeyRound className="w-5 h-5" />
                  )}
                  <div>
                    <span className="block text-xs font-extrabold uppercase tracking-widest">
                      {isFreeRegistration
                        ? 'OFFICIAL REGISTRATION NUMBER'
                        : 'OFFICIAL GREEN BOX'}
                    </span>
                    <span className="block text-[11px] text-white/85">
                      {isFreeRegistration
                        ? 'Registration Number & Admin Approval'
                        : 'Automated Examination PIN Vault'}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#0e8a4e] border border-white/25 text-[11px] font-bold uppercase">
                  {isFreeRegistration
                    ? isPaid
                      ? 'APPROVED'
                      : 'PENDING APPROVAL'
                    : currentPin
                    ? 'PIN ACTIVE'
                    : isPaid
                    ? 'PAID'
                    : 'AWAITING PIN'}
                </span>
              </div>

              <div className="p-6 space-y-5">
                {/* Green Box Inner PIN Vault — Hidden when Free Registration is active */}
                {!isFreeRegistration && (
                  <div className="p-5 rounded-xl bg-[#0a6b3c] text-white text-center space-y-2 border-2 border-[#0e8a4e] shadow-inner">
                    <span className="block text-[11px] font-bold uppercase tracking-widest text-white/80">
                      CANDIDATE EXAMINATION PIN
                    </span>
                    {currentPin ? (
                      <div className="flex items-center justify-center gap-3 pt-1">
                        <span className="font-mono text-2xl md:text-3xl font-extrabold tracking-wider text-white tabular-nums">
                          {currentPin}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(currentPin, 'pin')}
                          className="px-2.5 py-1.5 rounded-lg bg-[#0e8a4e] hover:bg-white hover:text-[#0a6b3c] text-white text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                          title="Copy GREEN BOX PIN"
                        >
                          {copiedKey === 'pin' ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="py-3 space-y-1">
                        <div className="font-mono text-base font-bold text-white/90">
                          [ PIN WILL APPEAR HERE ]
                        </div>
                        <p className="text-[11px] text-white/75 max-w-xs mx-auto">
                          Complete Paystack DVA (8s auto-verify) or Manual Moniepoint confirmation to write your PIN into the GREEN BOX.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* 5. REGISTRATION NUMBER */}
                <div
                  className={`space-y-3 ${
                    isFreeRegistration ? '' : 'pt-2 border-t border-neutral-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                      Registration Number
                    </span>
                    {currentRegNo && (
                      <span className="text-[11px] font-semibold text-[#0a6b3c]">
                        {isPaid
                          ? 'Approved by Admin'
                          : 'Awaiting Admin Approval'}
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleGenerateRegNumber}
                    className="w-full py-3 px-4 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
                  >
                    <Hash className="w-4 h-4" />
                    Generate Registration Number
                  </button>

                  {/* Copyable Reg Number Box */}
                  {currentRegNo && (
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl bg-neutral-50 border-2 border-[#0a6b3c] flex items-center justify-between gap-3">
                        <div>
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                            Official Registration Number (Copyable)
                          </span>
                          <span className="font-mono text-xl font-extrabold text-black tabular-nums">
                            {currentRegNo}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(currentRegNo, 'regNo')}
                          className="px-3.5 py-2 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKey === 'regNo' ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copy Reg No
                            </>
                          )}
                        </button>
                      </div>

                      {/* Admin Approval Status Notice for Generated Registration Number */}
                      <div
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
                          isPaid
                            ? 'bg-[#0a6b3c]/10 border-[#0a6b3c] text-[#0a6b3c]'
                            : 'bg-amber-50 border-amber-300 text-amber-900'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          {isPaid
                            ? 'Your generated Registration Number has been approved by Admin. You can now use it on the Candidate Login page to start your examination.'
                            : 'Your generated Registration Number requires Admin approval in the Admin Panel before it can be used to log in for the examination.'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 6. REGISTRATION SLIP (Printable) & 7. FINAL SUBMISSION */}
                <div className="space-y-2.5 pt-2 border-t border-neutral-200">
                  <button
                    type="button"
                    onClick={() => {
                      if (!validateDetails()) return;
                      if (!existingCandidate) {
                        handleGenerateRegNumber();
                      }
                      setShowSlipModal(true);
                    }}
                    className="w-full py-3 px-4 rounded-xl border-2 border-[#0a6b3c] bg-white hover:bg-[#0a6b3c]/5 text-[#0a6b3c] font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    Print Registration Slip
                  </button>

                  {currentRegNo && (
                    <button
                      type="button"
                      onClick={() => onBackToLogin()}
                      className="w-full py-3 px-4 rounded-xl bg-[#0e8a4e] hover:bg-[#0a6b3c] text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>Proceed to Candidate Login</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Support Box */}
            <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-xs space-y-1.5">
              <div className="font-bold text-[#0a6b3c]">
                Quemint Education Board Helpdesk
              </div>
              <div className="text-neutral-600">
                WhatsApp Support: <strong className="text-black font-mono">08107812604 / 08142847261</strong>
              </div>
              <div className="text-neutral-600">
                Email: <strong className="text-black">christianevans895@gmail.com</strong>
              </div>
            </div>
          </div>
          )}
        </div>
      </main>

      {/* Pop-up Modal when Registration Number Generation is Disallowed and Candidate clicks Confirmed */}
      {showConfirmedSuccessPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-6 md:p-8 text-center space-y-5 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-[#0a6b3c]/10 border-2 border-[#0a6b3c] text-[#0a6b3c] flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-extrabold text-[#0a6b3c] uppercase tracking-wide">
                Registration Submitted
              </h3>
              <p className="text-base font-bold text-black leading-relaxed">
                your registration has been successfully submitted, you may leave
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowConfirmedSuccessPopup(false);
                onSetActiveCandidateId(null);
                onBackToLogin();
              }}
              className="w-full py-3.5 px-6 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white font-extrabold text-sm uppercase tracking-wider transition-colors cursor-pointer shadow-xs"
            >
              Okay
            </button>
          </div>
        </div>
      )}

      {/* Printable Registration Slip Modal */}
      {showSlipModal && (
        <RegistrationSlipModal
          isFreeRegistration={isFreeRegistration}
          candidate={
            existingCandidate || {
              id: 'temp-cand',
              firstName: firstName || 'Candidate',
              middleName,
              surname: surname || 'Student',
              gender,
              email,
              phone,
              stateOfOrigin,
              courseOfStudy,
              subjectCombination: confirmedSubjects.join(', '),
              category,
              examCenterId: selectedExamCenterId,
              examCenterName:
                examCenters.find((ec) => ec.id === selectedExamCenterId)?.name || 'Q Zone 1',
              regNumber: currentRegNo || 'QMT2027001AA',
              pin: isFreeRegistration ? '' : currentPin || 'AWAITING-PIN',
              paymentStatus: isPaid ? 'Paid' : 'Pending',
              paymentMethod: isFreeRegistration
                ? 'Free Registration'
                : selectedPaymentMethod,
              amountPaid: isFreeRegistration ? 0 : settings.registrationFee,
              transactionRef: isFreeRegistration
                ? 'QMT-FREE-2026'
                : dvaAccount?.transactionRef || 'QMT-REF-2026',
              passportDataUrl,
              examDate: settings.defaultExamDate,
              examTime: settings.defaultExamTime,
              createdAt: new Date().toISOString(),
            }
          }
          onClose={() => setShowSlipModal(false)}
          onUpdatePassport={(candId, url) => {
            setPassportDataUrl(url);
            if (existingCandidate && existingCandidate.id === candId) {
              onRegisterOrUpdateCandidate({
                ...existingCandidate,
                passportDataUrl: url,
              });
            }
          }}
        />
      )}
    </div>
  );
};
