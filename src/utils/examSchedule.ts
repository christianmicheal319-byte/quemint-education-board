import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ExamCenter, ExamScheduleItem } from '../types';

export const AFRICA_LAGOS_TZ = 'Africa/Lagos';

export type ScheduleStatusType = 'no_schedule' | 'upcoming' | 'live' | 'ended' | 'inactive';

export interface ScheduleCheckResult {
  allowed: boolean;
  status: ScheduleStatusType;
  scheduleType: 'general' | 'per_centre' | 'none';
  matchedSchedule: ExamScheduleItem | null;
  examCode: string;
  centreName: string;
  startTimeIso: string | null;
  endTimeIso: string | null;
  startTimeFormatted: string; // e.g. "09:00 AM"
  endTimeFormatted: string; // e.g. "12:00 PM"
  endDateFormatted: string; // e.g. "28 Oct 2025"
  startDateFormatted: string; // e.g. "28 Oct 2025"
  timeUntilStartMs: number;
  timeUntilEndMs: number;
  countdownLabel: string; // e.g. "2h 15m 04s"
  message: string; // Exact blocking or live message
  bannerText: string; // Student UI card summary
  serverNowMs: number;
}

/**
 * Converts a Date or ISO timestamp into `YYYY-MM-DDTHH:mm` formatted specifically in Africa/Lagos (UTC+1)
 * for `<input type="datetime-local" />`.
 */
export function toLagosDateTimeLocalInput(isoOrDate: string | Date | undefined | null): string {
  if (!isoOrDate) return '';
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (isNaN(d.getTime())) return '';

  // Africa/Lagos is permanently UTC+1 (no daylight saving)
  const lagosMs = d.getTime() + 60 * 60 * 1000;
  const lagosDate = new Date(lagosMs);
  const year = lagosDate.getUTCFullYear();
  const month = String(lagosDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(lagosDate.getUTCDate()).padStart(2, '0');
  const hours = String(lagosDate.getUTCHours()).padStart(2, '0');
  const mins = String(lagosDate.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${mins}`;
}

/**
 * Converts a `<input type="datetime-local" />` string (`YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`)
 * interpreted in Africa/Lagos timezone (`+01:00`) into a canonical TIMESTAMPTZ string.
 */
export function fromLagosDateTimeLocalInput(localInput: string): string {
  const clean = (localInput || '').trim();
  if (!clean) return '';
  // If it already includes timezone offset or Z, normalize it
  if (/[+-]\d{2}:\d{2}$/.test(clean) || clean.endsWith('Z')) {
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      const localPart = toLagosDateTimeLocalInput(parsed);
      return `${localPart}:00+01:00`;
    }
  }
  // Ensure seconds are present
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean)
    ? `${clean}:00`
    : clean;
  return `${withSeconds}+01:00`;
}

/**
 * Formats an ISO timestamp as 12-hour time in Africa/Lagos (e.g., "09:00 AM", "12:00 PM").
 */
export function formatLagosTime12h(isoStr: string | undefined | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: AFRICA_LAGOS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    const lagosDate = new Date(d.getTime() + 3600000);
    let h = lagosDate.getUTCHours();
    const m = String(lagosDate.getUTCMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
  }
}

/**
 * Formats an ISO timestamp as short date in Africa/Lagos (e.g., "28 Oct 2025").
 */
export function formatLagosDateShort(isoStr: string | undefined | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: AFRICA_LAGOS_TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toDateString();
  }
}

/**
 * Formats an ISO timestamp as full date + time in Africa/Lagos (e.g., "28 Oct 2025 09:00 AM").
 */
export function formatLagosDateTimeFull(isoStr: string | undefined | null): string {
  if (!isoStr) return '—';
  const datePart = formatLagosDateShort(isoStr);
  const timePart = formatLagosTime12h(isoStr);
  if (datePart === '—' || timePart === '—') return '—';
  return `${datePart} ${timePart}`;
}

/**
 * Formats milliseconds into human-readable countdown (e.g., "2h 15m 08s" or "45m 12s").
 */
export function formatCountdownDuration(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

/**
 * Evaluates the status of a single schedule row relative to `nowMs`.
 */
export function getScheduleRowStatus(
  schedule: ExamScheduleItem,
  nowMs: number = Date.now()
): {
  status: ScheduleStatusType;
  timeUntilStartMs: number;
  timeUntilEndMs: number;
  countdownText: string;
} {
  if (!schedule.is_active) {
    return {
      status: 'inactive',
      timeUntilStartMs: 0,
      timeUntilEndMs: 0,
      countdownText: 'Inactive',
    };
  }
  const startMs = new Date(schedule.start_time).getTime();
  const endMs = new Date(schedule.end_time).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    return {
      status: 'inactive',
      timeUntilStartMs: 0,
      timeUntilEndMs: 0,
      countdownText: 'Invalid time',
    };
  }

  if (nowMs < startMs) {
    const diff = startMs - nowMs;
    return {
      status: 'upcoming',
      timeUntilStartMs: diff,
      timeUntilEndMs: Math.max(0, endMs - nowMs),
      countdownText: `Starts in ${formatCountdownDuration(diff)}`,
    };
  }

  // Once it is passed end_time even by a millisecond / second (nowMs > endMs), it is ended!
  if (nowMs <= endMs) {
    const diff = endMs - nowMs;
    return {
      status: 'live',
      timeUntilStartMs: 0,
      timeUntilEndMs: diff,
      countdownText: `Time left: ${formatCountdownDuration(diff)}`,
    };
  }

  return {
    status: 'ended',
    timeUntilStartMs: 0,
    timeUntilEndMs: 0,
    countdownText: `Ended ${formatLagosDateTimeFull(schedule.end_time)}`,
  };
}

/**
 * CORE ENFORCEMENT FUNCTION: canAttemptExam(student_exam_center_id, exam_code)
 *
 * 1. Check for per-centre schedule:
 *    SELECT * FROM exam_schedules WHERE exam_code = code AND exam_center_id = student_center AND is_active = true
 * 2. If found -> use that:
 *    - If now < start_time -> Block ("Exam not yet started. Your centre (Lagos Main) exam starts at 09:00 AM. Come back later." + countdown)
 *    - If now >= start_time AND now <= end_time -> Allow "Start Exam" button
 *    - If now > end_time (even by 1 second) -> Block ("Exam schedule for your centre (Lagos Main) has ended at 12:00 PM. You can no longer attempt QMT3045B.")
 * 3. If NOT found per-centre, check general:
 *    SELECT * FROM exam_schedules WHERE exam_code = code AND exam_center_id IS NULL AND is_active = true
 *    Same logic: now between start/end -> Allow, else block with message "General schedule for QMT3045B ended at..."
 * 4. If NO schedule set at all -> Allow anytime (backward compatibility)
 */
export function canAttemptExam(params: {
  studentExamCenterId?: string | null;
  studentExamCenterName?: string | null;
  examCode: string;
  schedules: ExamScheduleItem[];
  examCenters?: ExamCenter[];
  serverNowMs?: number;
}): ScheduleCheckResult {
  const {
    studentExamCenterId,
    studentExamCenterName,
    examCode,
    schedules = [],
    examCenters = [],
    serverNowMs = Date.now(),
  } = params;

  const cleanCode = (examCode || '').trim().toUpperCase();
  const cleanCenterId = (studentExamCenterId || '').trim().toLowerCase();
  const cleanCenterName = (studentExamCenterName || '').trim().toLowerCase();

  // Resolve canonical centre ID and display name for the student
  const matchedCenterObj = examCenters.find(
    (c) =>
      (cleanCenterId && c.id.trim().toLowerCase() === cleanCenterId) ||
      (cleanCenterName && c.name.trim().toLowerCase() === cleanCenterName)
  );
  const resolvedCenterId = matchedCenterObj?.id || studentExamCenterId || '';
  const resolvedCenterName =
    matchedCenterObj?.name || studentExamCenterName || 'Main Hall';

  // Filter active schedules for this exam_code
  const activeForExam = schedules.filter(
    (s) =>
      s &&
      s.is_active &&
      (s.exam_code || '').trim().toUpperCase() === cleanCode
  );

  // 1. Check for per-centre schedule matching student's examination centre
  const perCentreMatch = activeForExam.find((s) => {
    if (s.schedule_type !== 'per_centre' && s.exam_center_id === null) {
      return false;
    }
    const schedCenterId = (s.exam_center_id || '').trim().toLowerCase();
    const schedCenterName = (s.exam_center_name || '').trim().toLowerCase();
    if (
      resolvedCenterId &&
      schedCenterId &&
      schedCenterId === resolvedCenterId.trim().toLowerCase()
    ) {
      return true;
    }
    if (cleanCenterId && schedCenterId && schedCenterId === cleanCenterId) {
      return true;
    }
    if (cleanCenterName && schedCenterName && schedCenterName === cleanCenterName) {
      return true;
    }
    if (
      resolvedCenterName &&
      schedCenterName &&
      schedCenterName === resolvedCenterName.trim().toLowerCase()
    ) {
      return true;
    }
    return false;
  });

  // 2. If per-centre schedule found -> enforce it
  if (perCentreMatch) {
    const startMs = new Date(perCentreMatch.start_time).getTime();
    const endMs = new Date(perCentreMatch.end_time).getTime();
    const startTimeStr = formatLagosTime12h(perCentreMatch.start_time);
    const endTimeStr = formatLagosTime12h(perCentreMatch.end_time);
    const startDateStr = formatLagosDateShort(perCentreMatch.start_time);
    const endDateStr = formatLagosDateShort(perCentreMatch.end_time);
    const displayCentre = perCentreMatch.exam_center_name || resolvedCenterName;

    if (serverNowMs < startMs) {
      const diffMs = startMs - serverNowMs;
      const countdown = formatCountdownDuration(diffMs);
      return {
        allowed: false,
        status: 'upcoming',
        scheduleType: 'per_centre',
        matchedSchedule: perCentreMatch,
        examCode: cleanCode,
        centreName: displayCentre,
        startTimeIso: perCentreMatch.start_time,
        endTimeIso: perCentreMatch.end_time,
        startTimeFormatted: startTimeStr,
        endTimeFormatted: endTimeStr,
        startDateFormatted: startDateStr,
        endDateFormatted: endDateStr,
        timeUntilStartMs: diffMs,
        timeUntilEndMs: Math.max(0, endMs - serverNowMs),
        countdownLabel: countdown,
        message: `Exam not yet started. Your centre (${displayCentre}) exam starts at ${startTimeStr} (${startDateStr}). Come back later.`,
        bannerText: `Your Exam Centre: ${displayCentre} | Scheduled: ${startTimeStr} - ${endTimeStr} WAT | Starts in ${countdown}`,
        serverNowMs,
      };
    }

    if (serverNowMs >= startMs && serverNowMs <= endMs) {
      const diffMs = endMs - serverNowMs;
      const countdown = formatCountdownDuration(diffMs);
      return {
        allowed: true,
        status: 'live',
        scheduleType: 'per_centre',
        matchedSchedule: perCentreMatch,
        examCode: cleanCode,
        centreName: displayCentre,
        startTimeIso: perCentreMatch.start_time,
        endTimeIso: perCentreMatch.end_time,
        startTimeFormatted: startTimeStr,
        endTimeFormatted: endTimeStr,
        startDateFormatted: startDateStr,
        endDateFormatted: endDateStr,
        timeUntilStartMs: 0,
        timeUntilEndMs: diffMs,
        countdownLabel: countdown,
        message: `LIVE NOW - Ends at ${endTimeStr} | Time left: ${countdown}`,
        bannerText: `LIVE NOW - Ends at ${endTimeStr} | Time left: ${countdown}`,
        serverNowMs,
      };
    }

    // serverNowMs > endMs (even by 1 second) -> Block permanently
    return {
      allowed: false,
      status: 'ended',
      scheduleType: 'per_centre',
      matchedSchedule: perCentreMatch,
      examCode: cleanCode,
      centreName: displayCentre,
      startTimeIso: perCentreMatch.start_time,
      endTimeIso: perCentreMatch.end_time,
      startTimeFormatted: startTimeStr,
      endTimeFormatted: endTimeStr,
      startDateFormatted: startDateStr,
      endDateFormatted: endDateStr,
      timeUntilStartMs: 0,
      timeUntilEndMs: 0,
      countdownLabel: '0s',
      message: `Exam schedule for your centre (${displayCentre}) has ended at ${endTimeStr}. You can no longer attempt ${cleanCode}.`,
      bannerText: `Closed - Your centre schedule ended at ${endTimeStr} on ${endDateStr}`,
      serverNowMs,
    };
  }

  // 3. If NOT found per-centre, check general schedule (exam_center_id IS NULL or schedule_type === 'general')
  const generalMatch = activeForExam.find(
    (s) => s.exam_center_id === null || s.schedule_type === 'general'
  );

  if (generalMatch) {
    const startMs = new Date(generalMatch.start_time).getTime();
    const endMs = new Date(generalMatch.end_time).getTime();
    const startTimeStr = formatLagosTime12h(generalMatch.start_time);
    const endTimeStr = formatLagosTime12h(generalMatch.end_time);
    const startDateStr = formatLagosDateShort(generalMatch.start_time);
    const endDateStr = formatLagosDateShort(generalMatch.end_time);

    if (serverNowMs < startMs) {
      const diffMs = startMs - serverNowMs;
      const countdown = formatCountdownDuration(diffMs);
      return {
        allowed: false,
        status: 'upcoming',
        scheduleType: 'general',
        matchedSchedule: generalMatch,
        examCode: cleanCode,
        centreName: `${resolvedCenterName} (General Schedule)`,
        startTimeIso: generalMatch.start_time,
        endTimeIso: generalMatch.end_time,
        startTimeFormatted: startTimeStr,
        endTimeFormatted: endTimeStr,
        startDateFormatted: startDateStr,
        endDateFormatted: endDateStr,
        timeUntilStartMs: diffMs,
        timeUntilEndMs: Math.max(0, endMs - serverNowMs),
        countdownLabel: countdown,
        message: `Exam not yet started. General schedule for ${cleanCode} (${resolvedCenterName}) starts at ${startTimeStr} on ${startDateStr}. Come back later.`,
        bannerText: `Your Exam Centre: ${resolvedCenterName} (All Centres) | Scheduled: ${startTimeStr} - ${endTimeStr} WAT | Starts in ${countdown}`,
        serverNowMs,
      };
    }

    if (serverNowMs >= startMs && serverNowMs <= endMs) {
      const diffMs = endMs - serverNowMs;
      const countdown = formatCountdownDuration(diffMs);
      return {
        allowed: true,
        status: 'live',
        scheduleType: 'general',
        matchedSchedule: generalMatch,
        examCode: cleanCode,
        centreName: `${resolvedCenterName} (General Schedule)`,
        startTimeIso: generalMatch.start_time,
        endTimeIso: generalMatch.end_time,
        startTimeFormatted: startTimeStr,
        endTimeFormatted: endTimeStr,
        startDateFormatted: startDateStr,
        endDateFormatted: endDateStr,
        timeUntilStartMs: 0,
        timeUntilEndMs: diffMs,
        countdownLabel: countdown,
        message: `LIVE NOW - Ends at ${endTimeStr} | Time left: ${countdown}`,
        bannerText: `LIVE NOW - Ends at ${endTimeStr} | Time left: ${countdown}`,
        serverNowMs,
      };
    }

    // serverNowMs > endMs (even by 1 second) -> Block permanently
    return {
      allowed: false,
      status: 'ended',
      scheduleType: 'general',
      matchedSchedule: generalMatch,
      examCode: cleanCode,
      centreName: `${resolvedCenterName} (General Schedule)`,
      startTimeIso: generalMatch.start_time,
      endTimeIso: generalMatch.end_time,
      startTimeFormatted: startTimeStr,
      endTimeFormatted: endTimeStr,
      startDateFormatted: startDateStr,
      endDateFormatted: endDateStr,
      timeUntilStartMs: 0,
      timeUntilEndMs: 0,
      countdownLabel: '0s',
      message: `General schedule for ${cleanCode} ended at ${endTimeStr} on ${endDateStr}. You can no longer attempt ${cleanCode}.`,
      bannerText: `Closed - General schedule for ${cleanCode} ended at ${endTimeStr} on ${endDateStr}`,
      serverNowMs,
    };
  }

  // 4. If NO active schedule set for this exam_code:
  // Wait — what if Admin configured per-centre schedules for OTHER centres on this exam_code,
  // or what if no schedule exists at all?
  // Per spec: "3. If NOT found per-centre, check general... 4. If NO schedule set at all -> Allow anytime (backward compatibility)"
  return {
    allowed: true,
    status: 'no_schedule',
    scheduleType: 'none',
    matchedSchedule: null,
    examCode: cleanCode,
    centreName: resolvedCenterName,
    startTimeIso: null,
    endTimeIso: null,
    startTimeFormatted: 'Anytime',
    endTimeFormatted: 'Anytime',
    startDateFormatted: '',
    endDateFormatted: '',
    timeUntilStartMs: 0,
    timeUntilEndMs: 0,
    countdownLabel: '',
    message: 'Open Schedule — Available to attempt anytime.',
    bannerText: `Your Exam Centre: ${resolvedCenterName} | Open Schedule (No time restriction set)`,
    serverNowMs,
  };
}

/**
 * Hook that synchronizes with authoritative server time via `/api/time` (preventing client clock tampering)
 * and ticks every 1 second.
 */
export function useServerTime(syncIntervalMs = 15000): {
  serverNowMs: number;
  offsetMs: number;
  resyncServerTime: () => Promise<number>;
} {
  const offsetRef = useRef<number>(0);
  const [serverNowMs, setServerNowMs] = useState<number>(() => Date.now());

  const resyncServerTime = useCallback(async (): Promise<number> => {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/time', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.serverTimeMs === 'number' && data.serverTimeMs > 0) {
          const rttHalf = Math.round((Date.now() - t0) / 2);
          const authoritativeNow = data.serverTimeMs + rttHalf;
          offsetRef.current = authoritativeNow - Date.now();
          setServerNowMs(authoritativeNow);
          return authoritativeNow;
        }
      }
    } catch {
      // Fallback to current offset if offline
    }
    const fallbackNow = Date.now() + offsetRef.current;
    setServerNowMs(fallbackNow);
    return fallbackNow;
  }, []);

  useEffect(() => {
    resyncServerTime();
    const syncTimer = setInterval(() => {
      resyncServerTime();
    }, syncIntervalMs);
    const tickTimer = setInterval(() => {
      setServerNowMs(Date.now() + offsetRef.current);
    }, 1000);
    return () => {
      clearInterval(syncTimer);
      clearInterval(tickTimer);
    };
  }, [resyncServerTime, syncIntervalMs]);

  return {
    serverNowMs,
    offsetMs: offsetRef.current,
    resyncServerTime,
  };
}

/**
 * Enforcement Hook `useExamSchedule()`
 * Evaluates schedule status every second using authoritative server time and `/api/check-schedule`.
 */
export function useExamSchedule(params: {
  examCode: string;
  studentCenterId?: string | null;
  studentCenterName?: string | null;
  schedules?: ExamScheduleItem[];
  examCenters?: ExamCenter[];
}): ScheduleCheckResult & {
  verifyWithServerApi: (targetExamCode?: string) => Promise<ScheduleCheckResult>;
} {
  const {
    examCode,
    studentCenterId,
    studentCenterName,
    schedules = [],
    examCenters = [],
  } = params;

  const { serverNowMs, resyncServerTime } = useServerTime(12000);

  const checkResult = useMemo(
    () =>
      canAttemptExam({
        studentExamCenterId: studentCenterId,
        studentExamCenterName: studentCenterName,
        examCode,
        schedules,
        examCenters,
        serverNowMs,
      }),
    [studentCenterId, studentCenterName, examCode, schedules, examCenters, serverNowMs]
  );

  const verifyWithServerApi = useCallback(
    async (targetExamCode?: string): Promise<ScheduleCheckResult> => {
      const codeToCheck = targetExamCode || examCode;
      try {
        const res = await fetch('/api/check-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exam_code: codeToCheck,
            exam_center_id: studentCenterId || null,
            exam_center_name: studentCenterName || null,
            schedules,
            exam_centers: examCenters,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.result) {
            return data.result as ScheduleCheckResult;
          }
        }
      } catch {
        // Fallback to local evaluation with freshly synced server time
      }
      const freshNow = await resyncServerTime();
      return canAttemptExam({
        studentExamCenterId: studentCenterId,
        studentExamCenterName: studentCenterName,
        examCode: codeToCheck,
        schedules,
        examCenters,
        serverNowMs: freshNow,
      });
    },
    [examCode, studentCenterId, studentCenterName, schedules, examCenters, resyncServerTime]
  );

  return {
    ...checkResult,
    verifyWithServerApi,
  };
}

export const EXAM_SCHEDULES_SQL_MIGRATION = `-- ============================================================================
-- QUEMINT CBT PLATFORM: EXAM SCHEDULES / TIME-TABLE (GENERAL + PER CENTRE)
-- Timezone: Africa/Lagos (WAT / UTC+1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS exam_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code VARCHAR(64) NOT NULL REFERENCES exams(exam_code) ON DELETE CASCADE,
  exam_center_id UUID NULL REFERENCES exam_centers(id) ON DELETE CASCADE,
  schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('general', 'per_centre')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_exam_schedule_end_after_start CHECK (end_time > start_time)
);

-- Unique constraint for Per-Centre schedule: (exam_code, exam_center_id) WHERE exam_center_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_schedules_per_centre_unique
  ON exam_schedules (exam_code, exam_center_id)
  WHERE exam_center_id IS NOT NULL;

-- Unique constraint for General schedule: (exam_code) WHERE exam_center_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_schedules_general_unique
  ON exam_schedules (exam_code)
  WHERE exam_center_id IS NULL;
`;
