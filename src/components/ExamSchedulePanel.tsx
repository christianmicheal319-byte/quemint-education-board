import React, { useState, useMemo, useEffect } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Edit3,
  Plus,
  Database,
  Copy,
  Check,
  MapPin,
  Globe,
  Play,
  Lock,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import {
  ExamCenter,
  ExamScheduleItem,
  ExamScheduleType,
  ExamSettings,
  PublishedTest,
} from '../types';
import {
  AFRICA_LAGOS_TZ,
  EXAM_SCHEDULES_SQL_MIGRATION,
  formatCountdownDuration,
  formatLagosDateShort,
  formatLagosDateTimeFull,
  formatLagosTime12h,
  fromLagosDateTimeLocalInput,
  getScheduleRowStatus,
  toLagosDateTimeLocalInput,
  useServerTime,
} from '../utils/examSchedule';
import { QuemintSeal } from './QuemintSeal';

interface ExamSchedulePanelProps {
  settings: ExamSettings;
  examCenters: ExamCenter[];
  onUpdateSettings: (newSettings: ExamSettings) => void;
  onTriggerToast?: (msg: string) => void;
}

interface CentreDraftState {
  startLocal: string;
  endLocal: string;
  isActive: boolean;
}

export const ExamSchedulePanel: React.FC<ExamSchedulePanelProps> = ({
  settings,
  examCenters,
  onUpdateSettings,
  onTriggerToast,
}) => {
  const { serverNowMs, resyncServerTime } = useServerTime(10000);

  const publishedTests = useMemo<PublishedTest[]>(() => {
    const list = settings.publishedTests || [];
    if (list.length > 0) return list;
    return [
      {
        id: 'test-qmt-3045b',
        title: 'UTME Mock - Batch B',
        testCode: 'QMT3045B',
        category: 'All',
        durationMinutes: 30,
        deadline: '31/12/2027, 23:59:00',
        subjectAllocations: { English: 10, Biology: 10, Mathematics: 5, Chemistry: 5 },
        totalQuestions: 30,
        published: true,
        requireFullscreen: true,
        requireCamera: true,
        createdAt: new Date().toISOString(),
      },
    ];
  }, [settings.publishedTests]);

  const schedules = useMemo<ExamScheduleItem[]>(
    () => settings.examSchedules || [],
    [settings.examSchedules]
  );

  const [selectedExamCode, setSelectedExamCode] = useState<string>(
    () => publishedTests[0]?.testCode || 'QMT3045B'
  );
  const [scheduleType, setScheduleType] = useState<ExamScheduleType>('general');

  // Helper to get today's date string YYYY-MM-DD in Africa/Lagos
  const getTodayLagosDatePrefix = (baseMs: number = serverNowMs): string => {
    const localStr = toLagosDateTimeLocalInput(new Date(baseMs));
    return localStr.slice(0, 10) || '2025-10-28';
  };

  // General schedule form state
  const [generalStartLocal, setGeneralStartLocal] = useState<string>(() => {
    const prefix = getTodayLagosDatePrefix(Date.now());
    return `${prefix}T09:00`;
  });
  const [generalEndLocal, setGeneralEndLocal] = useState<string>(() => {
    const prefix = getTodayLagosDatePrefix(Date.now());
    return `${prefix}T12:00`;
  });
  const [generalIsActive, setGeneralIsActive] = useState<boolean>(true);

  // Per-centre draft state map: centerId -> { startLocal, endLocal, isActive }
  const [centreDrafts, setCentreDrafts] = useState<Record<string, CentreDraftState>>({});

  // Validation / status feedback
  const [validationError, setValidationError] = useState<string>('');
  const [localBanner, setLocalBanner] = useState<string>('');

  // Admin All Schedules Table Filters
  const [filterExamCode, setFilterExamCode] = useState<string>('ALL');
  const [filterCenterId, setFilterCenterId] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // SQL Schema Modal / Drawer
  const [showSqlSchema, setShowSqlSchema] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const notify = (msg: string) => {
    setLocalBanner(msg);
    setTimeout(() => setLocalBanner(''), 4000);
    if (onTriggerToast) onTriggerToast(msg);
  };

  // Sync General form & Per-Centre drafts when selectedExamCode or schedules change
  useEffect(() => {
    const cleanCode = selectedExamCode.trim().toUpperCase();
    const existingGen = schedules.find(
      (s) =>
        s.exam_code.trim().toUpperCase() === cleanCode &&
        (s.exam_center_id === null || s.schedule_type === 'general')
    );

    if (existingGen) {
      setGeneralStartLocal(toLagosDateTimeLocalInput(existingGen.start_time));
      setGeneralEndLocal(toLagosDateTimeLocalInput(existingGen.end_time));
      setGeneralIsActive(existingGen.is_active);
    }

    const prefix = getTodayLagosDatePrefix(Date.now());
    const nextDrafts: Record<string, CentreDraftState> = {};

    examCenters.forEach((center, idx) => {
      const existingPerCentre = schedules.find(
        (s) =>
          s.exam_code.trim().toUpperCase() === cleanCode &&
          s.exam_center_id !== null &&
          (s.exam_center_id.trim().toLowerCase() === center.id.trim().toLowerCase() ||
            (s.exam_center_name || '').trim().toLowerCase() ===
              center.name.trim().toLowerCase())
      );

      if (existingPerCentre) {
        nextDrafts[center.id] = {
          startLocal: toLagosDateTimeLocalInput(existingPerCentre.start_time),
          endLocal: toLagosDateTimeLocalInput(existingPerCentre.end_time),
          isActive: existingPerCentre.is_active,
        };
      } else {
        // Default staggered example: Centre 1 = 09:00-12:00, Centre 2 = 12:00-14:00, Centre 3 = 09:00-14:00
        const defaultStart = idx % 3 === 1 ? `${prefix}T12:00` : `${prefix}T09:00`;
        const defaultEnd = idx % 3 === 0 ? `${prefix}T12:00` : `${prefix}T14:00`;
        nextDrafts[center.id] = {
          startLocal: defaultStart,
          endLocal: defaultEnd,
          isActive: true,
        };
      }
    });

    setCentreDrafts(nextDrafts);
  }, [selectedExamCode, examCenters, schedules]);

  const persistSchedules = async (updatedSchedules: ExamScheduleItem[], toastMsg: string) => {
    onUpdateSettings({
      ...settings,
      examSchedules: updatedSchedules,
    });
    try {
      await fetch('/api/exam-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules: updatedSchedules }),
      });
    } catch {
      // Synced via settings localStorage & /api/sync
    }
    notify(toastMsg);
  };

  // Save GENERAL schedule (exam_center_id = null, schedule_type = 'general')
  const handleSaveGeneralSchedule = () => {
    setValidationError('');
    const startIso = fromLagosDateTimeLocalInput(generalStartLocal);
    const endIso = fromLagosDateTimeLocalInput(generalEndLocal);

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (!startIso || !endIso || isNaN(startMs) || isNaN(endMs)) {
      setValidationError('Please select valid Start and End DateTimes (Africa/Lagos WAT).');
      return;
    }

    if (endMs <= startMs) {
      setValidationError(
        'Validation Error: End DateTime must be strictly greater than Start DateTime (End > Start).'
      );
      return;
    }

    const cleanCode = selectedExamCode.trim().toUpperCase();
    const existingGen = schedules.find(
      (s) =>
        s.exam_code.trim().toUpperCase() === cleanCode &&
        (s.exam_center_id === null || s.schedule_type === 'general')
    );

    const newItem: ExamScheduleItem = {
      id: existingGen?.id || `sched-gen-${cleanCode.toLowerCase()}-${Date.now()}`,
      exam_code: cleanCode,
      exam_center_id: null,
      exam_center_name: 'ALL (General Schedule)',
      schedule_type: 'general',
      start_time: startIso,
      end_time: endIso,
      is_active: generalIsActive,
      created_at: existingGen?.created_at || new Date().toISOString(),
    };

    // Upsert general schedule for this exam_code
    const others = schedules.filter(
      (s) =>
        !(
          s.exam_code.trim().toUpperCase() === cleanCode &&
          (s.exam_center_id === null || s.schedule_type === 'general')
        )
    );

    persistSchedules(
      [newItem, ...others],
      `Saved General Schedule for ${cleanCode}: ${formatLagosDateTimeFull(startIso)} – ${formatLagosTime12h(endIso)} WAT (Applies to ALL centres).`
    );
  };

  // Save a single PER-CENTRE schedule row
  const handleSaveCentreScheduleRow = (center: ExamCenter) => {
    setValidationError('');
    const draft = centreDrafts[center.id];
    if (!draft) return;

    const startIso = fromLagosDateTimeLocalInput(draft.startLocal);
    const endIso = fromLagosDateTimeLocalInput(draft.endLocal);
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (!startIso || !endIso || isNaN(startMs) || isNaN(endMs)) {
      setValidationError(`Please select valid Start and End DateTimes for "${center.name}".`);
      return;
    }

    if (endMs <= startMs) {
      setValidationError(
        `Validation Error for "${center.name}": End DateTime must be strictly after Start DateTime.`
      );
      return;
    }

    const cleanCode = selectedExamCode.trim().toUpperCase();
    const existingRow = schedules.find(
      (s) =>
        s.exam_code.trim().toUpperCase() === cleanCode &&
        s.exam_center_id !== null &&
        (s.exam_center_id.trim().toLowerCase() === center.id.trim().toLowerCase() ||
          (s.exam_center_name || '').trim().toLowerCase() ===
            center.name.trim().toLowerCase())
    );

    const newItem: ExamScheduleItem = {
      id: existingRow?.id || `sched-ctr-${center.id}-${Date.now()}`,
      exam_code: cleanCode,
      exam_center_id: center.id,
      exam_center_name: center.name,
      schedule_type: 'per_centre',
      start_time: startIso,
      end_time: endIso,
      is_active: draft.isActive,
      created_at: existingRow?.created_at || new Date().toISOString(),
    };

    const others = schedules.filter((s) => s.id !== existingRow?.id);
    persistSchedules(
      [newItem, ...others],
      `Saved schedule for "${center.name}" (${cleanCode}): ${formatLagosTime12h(startIso)} – ${formatLagosTime12h(endIso)} WAT.`
    );
  };

  // Save ALL centre rows at once for the selected exam code
  const handleSaveAllCentresForExam = () => {
    setValidationError('');
    const cleanCode = selectedExamCode.trim().toUpperCase();
    const newPerCentreItems: ExamScheduleItem[] = [];

    for (const center of examCenters) {
      const draft = centreDrafts[center.id];
      if (!draft) continue;
      const startIso = fromLagosDateTimeLocalInput(draft.startLocal);
      const endIso = fromLagosDateTimeLocalInput(draft.endLocal);
      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();

      if (!startIso || !endIso || isNaN(startMs) || isNaN(endMs)) {
        setValidationError(`Invalid DateTime on centre "${center.name}".`);
        return;
      }
      if (endMs <= startMs) {
        setValidationError(
          `Validation Error on "${center.name}": End DateTime must be > Start DateTime.`
        );
        return;
      }

      const existingRow = schedules.find(
        (s) =>
          s.exam_code.trim().toUpperCase() === cleanCode &&
          s.exam_center_id !== null &&
          (s.exam_center_id.trim().toLowerCase() === center.id.trim().toLowerCase() ||
            (s.exam_center_name || '').trim().toLowerCase() ===
              center.name.trim().toLowerCase())
      );

      newPerCentreItems.push({
        id: existingRow?.id || `sched-ctr-${center.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        exam_code: cleanCode,
        exam_center_id: center.id,
        exam_center_name: center.name,
        schedule_type: 'per_centre',
        start_time: startIso,
        end_time: endIso,
        is_active: draft.isActive,
        created_at: existingRow?.created_at || new Date().toISOString(),
      });
    }

    const remainingSchedules = schedules.filter(
      (s) =>
        !(
          s.exam_code.trim().toUpperCase() === cleanCode &&
          s.exam_center_id !== null &&
          s.schedule_type === 'per_centre'
        )
    );

    persistSchedules(
      [...newPerCentreItems, ...remainingSchedules],
      `Saved all ${newPerCentreItems.length} Per-Centre schedules for ${cleanCode}!`
    );
  };

  const handleDeleteScheduleById = (scheduleId: string) => {
    const target = schedules.find((s) => s.id === scheduleId);
    const updated = schedules.filter((s) => s.id !== scheduleId);
    persistSchedules(
      updated,
      target
        ? `Deleted schedule for ${target.exam_code} (${target.exam_center_name || 'General'}).`
        : 'Schedule deleted.'
    );
  };

  const handleToggleScheduleActive = (scheduleId: string) => {
    const updated = schedules.map((s) =>
      s.id === scheduleId ? { ...s, is_active: !s.is_active } : s
    );
    const target = updated.find((s) => s.id === scheduleId);
    persistSchedules(
      updated,
      target
        ? `Schedule for ${target.exam_code} (${target.exam_center_name || 'General'}) marked ${
            target.is_active ? 'ACTIVE' : 'INACTIVE'
          }.`
        : 'Schedule updated.'
    );
  };

  // Add sample regional centres (Lagos Main, Abuja Centre, PH Centre) if admin wants them alongside existing centres
  const handleAddSampleRegionalCentres = () => {
    const sampleDefs = [
      { id: 'centre-lagos-main', name: 'Lagos Main', maxCapacity: 150, currentCount: 0 },
      { id: 'centre-abuja', name: 'Abuja Centre', maxCapacity: 120, currentCount: 0 },
      { id: 'centre-ph', name: 'PH Centre', maxCapacity: 100, currentCount: 0 },
    ];
    const existingNames = new Set(examCenters.map((c) => c.name.trim().toLowerCase()));
    const toAdd = sampleDefs.filter((d) => !existingNames.has(d.name.toLowerCase()));
    if (toAdd.length === 0) {
      notify('Lagos Main, Abuja Centre, and PH Centre are already in Examination Centres.');
      return;
    }
    onUpdateSettings({
      ...settings,
      examCenters: [...examCenters, ...toAdd],
    });
    notify(`Added ${toAdd.map((c) => c.name).join(', ')} to Examination Centres!`);
  };

  // Apply quick time preset to General Schedule inputs
  const applyGeneralPreset = (mode: '9to12' | '12to2' | 'live2h' | 'live1m' | 'upcoming30m' | 'ended10m') => {
    setValidationError('');
    const now = serverNowMs;
    const prefix = getTodayLagosDatePrefix(now);

    if (mode === '9to12') {
      setGeneralStartLocal(`${prefix}T09:00`);
      setGeneralEndLocal(`${prefix}T12:00`);
    } else if (mode === '12to2') {
      setGeneralStartLocal(`${prefix}T12:00`);
      setGeneralEndLocal(`${prefix}T14:00`);
    } else if (mode === 'live2h') {
      setGeneralStartLocal(toLagosDateTimeLocalInput(new Date(now - 15 * 60 * 1000)));
      setGeneralEndLocal(toLagosDateTimeLocalInput(new Date(now + 120 * 60 * 1000)));
    } else if (mode === 'live1m') {
      setGeneralStartLocal(toLagosDateTimeLocalInput(new Date(now - 5 * 60 * 1000)));
      setGeneralEndLocal(toLagosDateTimeLocalInput(new Date(now + 60 * 1000)));
    } else if (mode === 'upcoming30m') {
      setGeneralStartLocal(toLagosDateTimeLocalInput(new Date(now + 30 * 60 * 1000)));
      setGeneralEndLocal(toLagosDateTimeLocalInput(new Date(now + 150 * 60 * 1000)));
    } else if (mode === 'ended10m') {
      setGeneralStartLocal(toLagosDateTimeLocalInput(new Date(now - 130 * 60 * 1000)));
      setGeneralEndLocal(toLagosDateTimeLocalInput(new Date(now - 10 * 60 * 1000)));
    }
  };

  // Apply staggered 9AM-12PM / 12PM-2PM / 9AM-2PM timetable across all centres
  const handleAutoFillStaggeredCentres = (datePrefixOverride?: string) => {
    const prefix = datePrefixOverride || getTodayLagosDatePrefix(serverNowMs);
    const updated: Record<string, CentreDraftState> = {};
    examCenters.forEach((center, idx) => {
      if (idx % 3 === 0) {
        // First centre: 09:00 AM to 12:00 PM
        updated[center.id] = {
          startLocal: `${prefix}T09:00`,
          endLocal: `${prefix}T12:00`,
          isActive: true,
        };
      } else if (idx % 3 === 1) {
        // Second centre: 12:00 PM to 02:00 PM
        updated[center.id] = {
          startLocal: `${prefix}T12:00`,
          endLocal: `${prefix}T14:00`,
          isActive: true,
        };
      } else {
        // Third centre: 09:00 AM to 02:00 PM
        updated[center.id] = {
          startLocal: `${prefix}T09:00`,
          endLocal: `${prefix}T14:00`,
          isActive: true,
        };
      }
    });
    setCentreDrafts(updated);
    notify(
      `Populated staggered timetable (Centre 1: 09:00 AM–12:00 PM, Centre 2: 12:00 PM–02:00 PM, Centre 3: 09:00 AM–02:00 PM) for ${prefix}. Click "Save All Centre Schedules" to activate.`
    );
  };

  const selectedTestObj = useMemo(
    () =>
      publishedTests.find(
        (t) => t.testCode.trim().toUpperCase() === selectedExamCode.trim().toUpperCase()
      ) || publishedTests[0],
    [publishedTests, selectedExamCode]
  );

  // Filtered schedules for the Admin View Table
  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (
        filterExamCode !== 'ALL' &&
        s.exam_code.trim().toUpperCase() !== filterExamCode.trim().toUpperCase()
      ) {
        return false;
      }
      if (filterCenterId === 'GENERAL_ONLY') {
        if (s.exam_center_id !== null && s.schedule_type !== 'general') return false;
      } else if (filterCenterId !== 'ALL') {
        if (
          (s.exam_center_id || '').trim().toLowerCase() !==
          filterCenterId.trim().toLowerCase()
        ) {
          return false;
        }
      }
      if (filterStatus !== 'ALL') {
        const st = getScheduleRowStatus(s, serverNowMs).status;
        if (st !== filterStatus) return false;
      }
      return true;
    });
  }, [schedules, filterExamCode, filterCenterId, filterStatus, serverNowMs]);

  return (
    <div className="space-y-8">
      {/* Top Official Banner + Authoritative Africa/Lagos Server Clock */}
      <div className="rounded-3xl bg-[#0a6b3c] text-white p-6 md:p-7 shadow-md flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <QuemintSeal size="md" variant="white" showText={false} />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-white text-[10px] font-extrabold uppercase tracking-widest">
                QUEMINT CBT • TIME-TABLE &amp; SCHEDULE ENFORCEMENT
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-400/20 border border-emerald-300/40 text-emerald-200 font-mono text-[10px] font-extrabold">
                TIMEZONE: {AFRICA_LAGOS_TZ} (WAT / UTC+1)
              </span>
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold tracking-tight">
              Exam Schedule / Time-Table Management
            </h2>
            <p className="text-xs text-white/85 max-w-2xl leading-relaxed">
              Configure a <strong>General Schedule</strong> (all examination centres write at the same time) or a <strong>Per-Centre Schedule</strong> (e.g., First Centre 9:00 AM – 12:00 PM, Second Centre 12:00 PM – 2:00 PM). Once the server clock passes <code>end_time</code> by even 1 second, attempting is permanently blocked and active sessions auto-submit.
            </p>
          </div>
        </div>

        {/* Live Server Time Box */}
        <div className="flex flex-col sm:flex-row lg:flex-col items-stretch sm:items-center lg:items-end justify-between gap-2.5 bg-black/25 border border-white/20 rounded-2xl p-4 shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono font-extrabold text-emerald-300">
            <Clock className="w-4 h-4 shrink-0 animate-pulse" />
            <span>SERVER TIME (AFRICA/LAGOS WAT):</span>
            <button
              type="button"
              onClick={() => resyncServerTime()}
              title="Re-sync Server Time (/api/time)"
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <div className="font-mono text-base md:text-lg font-extrabold text-white tabular-nums">
            {formatLagosDateShort(new Date(serverNowMs).toISOString())} •{' '}
            {new Intl.DateTimeFormat('en-US', {
              timeZone: AFRICA_LAGOS_TZ,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            }).format(new Date(serverNowMs))}{' '}
            WAT
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSqlSchema(!showSqlSchema)}
              className="px-3 py-1.5 rounded-xl bg-white text-[#0a6b3c] hover:bg-neutral-100 text-[11px] font-extrabold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Database className="w-3.5 h-3.5" />
              <span>{showSqlSchema ? 'Hide SQL Schema' : 'exam_schedules SQL Schema'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Optional Expandable SQL Schema Card */}
      {showSqlSchema && (
        <div className="p-5 rounded-2xl border-2 border-[#0a6b3c] bg-neutral-950 text-white space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-400">
              <Database className="w-4 h-4" />
              <span>PostgreSQL / Supabase Migration: exam_schedules Table &amp; Unique Indexes</span>
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(EXAM_SCHEDULES_SQL_MIGRATION);
                setCopiedSql(true);
                setTimeout(() => setCopiedSql(false), 2500);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSql ? 'Copied SQL!' : 'Copy SQL'}</span>
            </button>
          </div>
          <pre className="p-4 rounded-xl bg-black/80 border border-neutral-800 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
            {EXAM_SCHEDULES_SQL_MIGRATION}
          </pre>
        </div>
      )}

      {/* Toast / Validation Banner */}
      {localBanner && (
        <div className="p-4 rounded-2xl bg-[#0a6b3c]/10 border-2 border-[#0a6b3c] text-[#0a6b3c] text-xs font-extrabold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{localBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocalBanner('')}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {validationError && (
        <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-300 text-red-800 text-xs font-extrabold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{validationError}</span>
          </div>
          <button
            type="button"
            onClick={() => setValidationError('')}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SECTION 1: SCHEDULE CONFIGURATION BUILDER */}
      <section className="p-6 md:p-7 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-5">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
              1. CONFIGURE EXAM SCHEDULE (GENERAL OR PER EXAMINATION CENTRE)
            </span>
            <h3 className="text-lg font-extrabold text-black mt-0.5">
              Select Exam Code &amp; Schedule Type
            </h3>
          </div>

          {/* Select Exam Code Dropdown */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs font-extrabold uppercase text-neutral-700">
              Select Exam Code:
            </label>
            <select
              value={selectedExamCode}
              onChange={(e) => setSelectedExamCode(e.target.value)}
              className="px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white text-black font-mono text-xs md:text-sm font-extrabold focus:outline-none cursor-pointer"
            >
              {publishedTests.map((t) => (
                <option key={t.id} value={t.testCode}>
                  {t.testCode} — {t.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Schedule Type Radio Selector */}
        <div className="space-y-2.5">
          <label className="block text-xs font-extrabold uppercase tracking-wider text-neutral-700">
            Schedule Type:
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Radio 1: GENERAL */}
            <label
              onClick={() => setScheduleType('general')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3.5 ${
                scheduleType === 'general'
                  ? 'border-[#0a6b3c] bg-[#0a6b3c]/8 shadow-xs'
                  : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="schedule_type_radio"
                checked={scheduleType === 'general'}
                onChange={() => setScheduleType('general')}
                className="w-4 h-4 accent-[#0a6b3c] mt-1 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-[#0a6b3c]" />
                  <span className="text-sm font-extrabold text-black">
                    GENERAL (All Centres Same Time)
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Everybody across all examination centres writes <strong>{selectedExamCode}</strong> within the exact same Start and End DateTime window.
                </p>
              </div>
            </label>

            {/* Radio 2: PER CENTRE */}
            <label
              onClick={() => setScheduleType('per_centre')}
              className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-start gap-3.5 ${
                scheduleType === 'per_centre'
                  ? 'border-[#0a6b3c] bg-[#0a6b3c]/8 shadow-xs'
                  : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="schedule_type_radio"
                checked={scheduleType === 'per_centre'}
                onChange={() => setScheduleType('per_centre')}
                className="w-4 h-4 accent-[#0a6b3c] mt-1 cursor-pointer"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#0a6b3c]" />
                  <span className="text-sm font-extrabold text-black">
                    PER CENTRE (Different Time Per Centre)
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  Assign individual time slots for each examination centre (e.g., Centre 1: 9:00 AM – 12:00 PM, Centre 2: 12:00 PM – 2:00 PM).
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* =====================================================================
            MODE A: GENERAL SCHEDULE FORM (ALL CENTRES SAME TIME)
           ===================================================================== */}
        {scheduleType === 'general' && (
          <div className="p-5 md:p-6 rounded-2xl border-2 border-[#0a6b3c]/30 bg-[#0a6b3c]/5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-[11px] font-extrabold uppercase tracking-wider">
                  <Globe className="w-3.5 h-3.5" />
                  <span>General Schedule - Applies to ALL centres for {selectedExamCode}</span>
                </span>
                <p className="text-xs text-neutral-700 font-semibold mt-2">
                  Exam: <strong className="text-black">{selectedTestObj?.title}</strong> (
                  <code className="font-mono text-[#0a6b3c] font-extrabold">{selectedExamCode}</code>) • Timezone: <strong>Africa/Lagos (WAT)</strong>
                </p>
              </div>

              {/* Active / Inactive Switch */}
              <label className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white border border-neutral-300 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={generalIsActive}
                  onChange={(e) => setGeneralIsActive(e.target.checked)}
                  className="w-4 h-4 accent-[#0a6b3c] cursor-pointer"
                />
                <span className="text-xs font-extrabold text-black">
                  Status: {generalIsActive ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </label>
            </div>

            {/* Quick Time Window Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] font-extrabold uppercase text-neutral-600 mr-1">
                Quick Presets (WAT):
              </span>
              <button
                type="button"
                onClick={() => applyGeneralPreset('9to12')}
                className="px-3 py-1.5 rounded-lg border border-[#0a6b3c]/40 bg-white hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                09:00 AM – 12:00 PM
              </button>
              <button
                type="button"
                onClick={() => applyGeneralPreset('12to2')}
                className="px-3 py-1.5 rounded-lg border border-[#0a6b3c]/40 bg-white hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                12:00 PM – 02:00 PM
              </button>
              <button
                type="button"
                onClick={() => applyGeneralPreset('live2h')}
                className="px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-emerald-800 text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                Live Now (Ends in 2h)
              </button>
              <button
                type="button"
                onClick={() => applyGeneralPreset('live1m')}
                className="px-3 py-1.5 rounded-lg border border-amber-500 bg-amber-50 hover:bg-amber-500 hover:text-black text-amber-900 text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                Live Now (Ends in 60s • Test Auto-Submit)
              </button>
              <button
                type="button"
                onClick={() => applyGeneralPreset('upcoming30m')}
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-100 text-neutral-800 text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                Upcoming (Starts in 30m)
              </button>
              <button
                type="button"
                onClick={() => applyGeneralPreset('ended10m')}
                className="px-3 py-1.5 rounded-lg border border-red-300 bg-red-50 hover:bg-red-600 hover:text-white text-red-700 text-[11px] font-extrabold transition-colors cursor-pointer"
              >
                Ended (Closed 10m ago)
              </button>
            </div>

            {/* Start & End DateTime Pickers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-white border border-neutral-200 space-y-2">
                <label className="block text-xs font-extrabold uppercase text-neutral-700">
                  Start DateTime (Africa/Lagos WAT)
                </label>
                <input
                  type="datetime-local"
                  value={generalStartLocal}
                  onChange={(e) => setGeneralStartLocal(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs md:text-sm font-extrabold text-black bg-neutral-50"
                />
                <div className="text-[11px] font-mono font-bold text-[#0a6b3c]">
                  Formatted: {formatLagosDateTimeFull(fromLagosDateTimeLocalInput(generalStartLocal))} WAT
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-neutral-200 space-y-2">
                <label className="block text-xs font-extrabold uppercase text-neutral-700">
                  End DateTime (Africa/Lagos WAT)
                </label>
                <input
                  type="datetime-local"
                  value={generalEndLocal}
                  onChange={(e) => setGeneralEndLocal(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs md:text-sm font-extrabold text-black bg-neutral-50"
                />
                <div className="text-[11px] font-mono font-bold text-[#0a6b3c]">
                  Formatted: {formatLagosDateTimeFull(fromLagosDateTimeLocalInput(generalEndLocal))} WAT
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs text-neutral-600 font-medium">
                Saving this General Schedule applies to <strong>every examination centre</strong> for{' '}
                <strong className="text-black">{selectedExamCode}</strong> (unless a specific centre has an active Per-Centre override).
              </div>
              <button
                type="button"
                onClick={handleSaveGeneralSchedule}
                className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold flex items-center gap-2 transition-colors cursor-pointer shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save General Schedule for {selectedExamCode}</span>
              </button>
            </div>
          </div>
        )}

        {/* =====================================================================
            MODE B: PER-CENTRE SCHEDULE TABLE (DIFFERENT TIME PER CENTRE)
           ===================================================================== */}
        {scheduleType === 'per_centre' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-[#0a6b3c]/5 border border-[#0a6b3c]/25">
              <div>
                <div className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  Per-Centre Schedule Matrix for {selectedExamCode} ({examCenters.length} Examination Centres)
                </div>
                <p className="text-xs text-neutral-600 mt-0.5">
                  Configure different Start and End times for each centre (e.g., Centre 1: 09:00 AM – 12:00 PM, Centre 2: 12:00 PM – 02:00 PM). Students in a centre can only attempt within their centre&apos;s window.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleAutoFillStaggeredCentres()}
                  className="px-3.5 py-2 rounded-xl border border-[#0a6b3c] bg-white hover:bg-[#0a6b3c] hover:text-white text-[#0a6b3c] text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-Fill 9AM–12PM / 12PM–2PM</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddSampleRegionalCentres}
                  className="px-3.5 py-2 rounded-xl border border-neutral-300 bg-white hover:border-[#0a6b3c] text-black text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#0a6b3c]" />
                  <span>+ Add Lagos / Abuja / PH Centres</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#0a6b3c] text-white font-extrabold uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-4">Centre Name</th>
                    <th className="py-3.5 px-4">Start DateTime Picker (WAT)</th>
                    <th className="py-3.5 px-4">End DateTime Picker (WAT)</th>
                    <th className="py-3.5 px-4 text-center">Status</th>
                    <th className="py-3.5 px-4">Saved Schedule State</th>
                    <th className="py-3.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {examCenters.map((center, idx) => {
                    const draft = centreDrafts[center.id] || {
                      startLocal: `${getTodayLagosDatePrefix()}T09:00`,
                      endLocal: `${getTodayLagosDatePrefix()}T12:00`,
                      isActive: true,
                    };
                    const cleanCode = selectedExamCode.trim().toUpperCase();
                    const savedRow = schedules.find(
                      (s) =>
                        s.exam_code.trim().toUpperCase() === cleanCode &&
                        s.exam_center_id !== null &&
                        (s.exam_center_id.trim().toLowerCase() ===
                          center.id.trim().toLowerCase() ||
                          (s.exam_center_name || '').trim().toLowerCase() ===
                            center.name.trim().toLowerCase())
                    );
                    const rowStatus = savedRow
                      ? getScheduleRowStatus(savedRow, serverNowMs)
                      : null;

                    return (
                      <tr
                        key={center.id}
                        className={idx % 2 === 0 ? 'bg-white' : 'bg-neutral-50/70'}
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-extrabold text-black text-sm flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#0a6b3c] shrink-0" />
                            <span>
                              Centre {idx + 1} - {center.name}
                            </span>
                          </div>
                          <div className="text-[11px] text-neutral-500 font-mono">
                            ID: {center.id} • Cap: {center.maxCapacity}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <input
                            type="datetime-local"
                            value={draft.startLocal}
                            onChange={(e) =>
                              setCentreDrafts((prev) => ({
                                ...prev,
                                [center.id]: {
                                  ...draft,
                                  startLocal: e.target.value,
                                },
                              }))
                            }
                            className="w-full min-w-[185px] px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs font-bold text-black bg-white"
                          />
                          <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                            {formatLagosDateTimeFull(
                              fromLagosDateTimeLocalInput(draft.startLocal)
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <input
                            type="datetime-local"
                            value={draft.endLocal}
                            onChange={(e) =>
                              setCentreDrafts((prev) => ({
                                ...prev,
                                [center.id]: {
                                  ...draft,
                                  endLocal: e.target.value,
                                },
                              }))
                            }
                            className="w-full min-w-[185px] px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] focus:outline-none font-mono text-xs font-bold text-black bg-white"
                          />
                          <div className="text-[10px] font-mono text-neutral-500 mt-0.5">
                            {formatLagosDateTimeFull(
                              fromLagosDateTimeLocalInput(draft.endLocal)
                            )}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setCentreDrafts((prev) => ({
                                ...prev,
                                [center.id]: {
                                  ...draft,
                                  isActive: !draft.isActive,
                                },
                              }))
                            }
                            className={`px-3 py-1 rounded-full text-[11px] font-extrabold uppercase cursor-pointer transition-colors ${
                              draft.isActive
                                ? 'bg-[#0a6b3c] text-white'
                                : 'bg-neutral-200 text-neutral-700'
                            }`}
                          >
                            {draft.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>

                        <td className="py-3.5 px-4">
                          {savedRow && rowStatus ? (
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                                  rowStatus.status === 'live'
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : rowStatus.status === 'upcoming'
                                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                    : rowStatus.status === 'ended'
                                    ? 'bg-red-100 text-red-700 border border-red-300'
                                    : 'bg-neutral-200 text-neutral-600'
                                }`}
                              >
                                {rowStatus.status === 'live' && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                                )}
                                <span>{rowStatus.status.toUpperCase()}</span>
                              </span>
                              <div className="text-[11px] font-mono font-bold text-neutral-700">
                                {rowStatus.countdownText}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-neutral-400 font-semibold">
                              Not saved yet
                            </span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSaveCentreScheduleRow(center)}
                              className="px-3.5 py-2 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold cursor-pointer transition-colors"
                            >
                              Save
                            </button>
                            {savedRow && (
                              <button
                                type="button"
                                onClick={() => handleDeleteScheduleById(savedRow.id)}
                                className="p-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                                title="Delete Centre Schedule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleSaveAllCentresForExam}
                className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold flex items-center gap-2 cursor-pointer shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save All Centre Schedules for {selectedExamCode}</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* SECTION 2: ADMIN VIEW — ALL EXAM SCHEDULES LIST WITH FILTERS & LIVE COUNTDOWNS */}
      <section className="p-6 md:p-7 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-neutral-200 pb-4">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
              2. ACTIVE &amp; SCHEDULED TIME-TABLES ({filteredSchedules.length} OF {schedules.length})
            </span>
            <h3 className="text-lg font-extrabold text-black mt-0.5">
              All Configured Exam Schedules (General &amp; Per-Centre)
            </h3>
          </div>

          {/* Filter by Exam Code, Centre, and Status */}
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={filterExamCode}
              onChange={(e) => setFilterExamCode(e.target.value)}
              className="px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-extrabold text-black bg-neutral-50 cursor-pointer"
            >
              <option value="ALL">All Exam Codes</option>
              {publishedTests.map((t) => (
                <option key={t.id} value={t.testCode}>
                  {t.testCode} ({t.title})
                </option>
              ))}
            </select>

            <select
              value={filterCenterId}
              onChange={(e) => setFilterCenterId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-extrabold text-black bg-neutral-50 cursor-pointer"
            >
              <option value="ALL">All Centres + General</option>
              <option value="GENERAL_ONLY">ALL (General Schedules Only)</option>
              {examCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2 rounded-xl border border-neutral-300 focus:border-[#0a6b3c] text-xs font-extrabold text-black bg-neutral-50 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="live">Live Now</option>
              <option value="upcoming">Upcoming</option>
              <option value="ended">Ended</option>
              <option value="inactive">Inactive</option>
            </select>

            {schedules.length > 0 && (
              <button
                type="button"
                onClick={() => persistSchedules([], 'Cleared all exam schedules. All exams are now open anytime.')}
                className="px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}
          </div>
        </div>

        {filteredSchedules.length === 0 ? (
          <div className="p-8 rounded-2xl border-2 border-dashed border-neutral-200 text-center space-y-2">
            <Calendar className="w-8 h-8 text-[#0a6b3c] mx-auto opacity-80" />
            <div className="text-sm font-extrabold text-black">
              No Exam Schedules Configured Yet
            </div>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              When no schedule is set for an exam code, candidates can attempt the exam anytime (backward compatibility). Use the builder above to set a <strong>General</strong> or <strong>Per-Centre</strong> schedule.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#0a6b3c] text-white font-extrabold uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4">Exam Code</th>
                  <th className="py-3.5 px-4">Type</th>
                  <th className="py-3.5 px-4">Centre Name (or ALL)</th>
                  <th className="py-3.5 px-4">Start (WAT)</th>
                  <th className="py-3.5 px-4">End (WAT)</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Countdown / Timer</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredSchedules.map((sched, idx) => {
                  const isGeneral =
                    sched.exam_center_id === null || sched.schedule_type === 'general';
                  const rowInfo = getScheduleRowStatus(sched, serverNowMs);
                  const centerLabel = isGeneral
                    ? 'ALL (All Examination Centres)'
                    : sched.exam_center_name ||
                      examCenters.find((c) => c.id === sched.exam_center_id)?.name ||
                      sched.exam_center_id;

                  return (
                    <tr
                      key={sched.id}
                      className={idx % 2 === 0 ? 'bg-white' : 'bg-[#0a6b3c]/3'}
                    >
                      <td className="py-3.5 px-4 font-mono font-extrabold text-[#0a6b3c] text-sm">
                        {sched.exam_code}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${
                            isGeneral
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-[#0a6b3c]/15 text-[#0a6b3c] border border-[#0a6b3c]/30'
                          }`}
                        >
                          {isGeneral ? 'GENERAL' : 'PER CENTRE'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-black">
                        {centerLabel}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-black whitespace-nowrap">
                        <div>{formatLagosDateShort(sched.start_time)}</div>
                        <div className="text-[#0a6b3c] font-extrabold">
                          {formatLagosTime12h(sched.start_time)} WAT
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-black whitespace-nowrap">
                        <div>{formatLagosDateShort(sched.end_time)}</div>
                        <div className="text-[#0a6b3c] font-extrabold">
                          {formatLagosTime12h(sched.end_time)} WAT
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {rowInfo.status === 'live' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 border border-emerald-400 text-emerald-900 text-[11px] font-extrabold uppercase">
                            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
                            <span>LIVE NOW</span>
                          </span>
                        )}
                        {rowInfo.status === 'upcoming' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-extrabold uppercase">
                            <Clock className="w-3 h-3" />
                            <span>UPCOMING</span>
                          </span>
                        )}
                        {rowInfo.status === 'ended' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 border border-red-300 text-red-700 text-[11px] font-extrabold uppercase">
                            <Lock className="w-3 h-3" />
                            <span>ENDED</span>
                          </span>
                        )}
                        {rowInfo.status === 'inactive' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-200 text-neutral-700 text-[11px] font-extrabold uppercase">
                            <span>INACTIVE</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-extrabold whitespace-nowrap">
                        {rowInfo.status === 'live' ? (
                          <span className="text-[#0a6b3c]">
                            Time left: {formatCountdownDuration(rowInfo.timeUntilEndMs)}
                          </span>
                        ) : rowInfo.status === 'upcoming' ? (
                          <span className="text-amber-800">
                            Starts in {formatCountdownDuration(rowInfo.timeUntilStartMs)}
                          </span>
                        ) : rowInfo.status === 'ended' ? (
                          <span className="text-red-600">
                            Closed at {formatLagosTime12h(sched.end_time)}
                          </span>
                        ) : (
                          <span className="text-neutral-400">Disabled</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedExamCode(sched.exam_code);
                              if (isGeneral) {
                                setScheduleType('general');
                                setGeneralStartLocal(toLagosDateTimeLocalInput(sched.start_time));
                                setGeneralEndLocal(toLagosDateTimeLocalInput(sched.end_time));
                                setGeneralIsActive(sched.is_active);
                              } else {
                                setScheduleType('per_centre');
                                if (sched.exam_center_id) {
                                  setCentreDrafts((prev) => ({
                                    ...prev,
                                    [sched.exam_center_id!]: {
                                      startLocal: toLagosDateTimeLocalInput(sched.start_time),
                                      endLocal: toLagosDateTimeLocalInput(sched.end_time),
                                      isActive: sched.is_active,
                                    },
                                  }));
                                }
                              }
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-neutral-300 hover:border-[#0a6b3c] bg-white text-black font-extrabold text-[11px] flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-[#0a6b3c]" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleScheduleActive(sched.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold cursor-pointer ${
                              sched.is_active
                                ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                : 'bg-[#0a6b3c] text-white hover:bg-[#0e8a4e]'
                            }`}
                          >
                            {sched.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteScheduleById(sched.id)}
                            className="p-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                            title="Delete Schedule"
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
        )}
      </section>
    </div>
  );
};
