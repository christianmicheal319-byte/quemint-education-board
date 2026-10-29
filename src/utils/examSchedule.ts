import { useState, useEffect, useCallback, useMemo } from 'react';
import { ExamCenter, ExamScheduleItem, ExamSettings } from '../types';

export const AFRICA_LAGOS_TZ = 'Africa/Lagos';

export interface CanAttemptExamResult {
  allowed: boolean;
  status: 'active' | 'before_start' | 'after_end' | 'no_schedule';
  reason: string;
  schedule: ExamScheduleItem | null;
  centreName: string;
  startTimeMs: number | null;
  endTimeMs: number | null;
  serverNowMs: number;
  remainingSeconds: number | null;
  secondsUntilStart: number | null;
}

/**
 * Formats a Date or timestamp in Africa/Lagos (WAT, UTC+1) as 12-hour time e.g. "09:00 AM"
 */
export function formatLagosTime12h(dateOrIso: string | number | Date): string {
  try {
    const d = new Date(dateOrIso);
    if (isNaN(d.getTime())) return 'N/A';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: AFRICA_LAGOS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return 'N/A';
  }
}

/**
 * Formats a Date or timestamp in Africa/Lagos (WAT, UTC+1) as short date e.g. "28 Oct 2025"
 */
export function formatLagosDateShort(dateOrIso: string | number | Date): string {
  try {
    const d = new Date(dateOrIso);
    if (isNaN(d.getTime())) return 'N/A';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: AFRICA_LAGOS_TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return 'N/A';
  }
}

/**
 * Formats a Date or timestamp in Africa/Lagos (WAT, UTC+1) as "28 Oct 2025 09:00 AM"
 */
export function formatLagosDateTimeFull(dateOrIso: string | number | Date): string {
  const datePart = formatLagosDateShort(dateOrIso);
  const timePart = formatLagosTime12h(dateOrIso);
  if (datePart === 'N/A' || timePart === 'N/A') return 'N/A';
  return `${datePart} ${timePart}`;
}

/**
 * Converts an ISO timestamp or Date into `YYYY-MM-DDTHH:mm` in Africa/Lagos (+01:00) for `<input type="datetime-local" />`
 */
export function toLagosDateTimeLocalInput(isoOrDate?: string | number | Date): string {
  if (!isoOrDate) return '';
  try {
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return '';
    // Africa/Lagos is permanently UTC+1 (no DST)
    const lagosMs = d.getTime() + 60 * 60 * 1000;
    const lagosDate = new Date(lagosMs);
    return lagosDate.toISOString().slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Converts a `YYYY-MM-DDTHH:mm` string from `<input type="datetime-local" />` into an explicit Africa/Lagos TIMESTAMPTZ string (`+01:00`)
 */
export function fromLagosDateTimeLocalInput(localValue: string): string {
  const trimmed = (localValue || '').trim();
  if (!trimmed) return '';
  if (/[+-]\d{2}:\d{2}$/.test(trimmed) || trimmed.endsWith('Z')) {
    return new Date(trimmed).toISOString();
  }
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  return `${withSeconds}+01:00`;
}

/**
 * Formats seconds (or milliseconds if > 100000) into human-readable countdown e.g. "01h 24m 15s" or "14m 05s"
 */
export function formatCountdownDuration(val: number | null): string {
  if (val === null || val <= 0) return '00m 00s';
  const totalSeconds = val > 100000 ? Math.floor(val / 1000) : Math.floor(val);
  const secs = Math.max(0, totalSeconds);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const remSecs = secs % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(remSecs)}s`;
  }
  if (hours > 0) {
    return `${pad(hours)}h ${pad(minutes)}m ${pad(remSecs)}s`;
  }
  return `${pad(minutes)}m ${pad(remSecs)}s`;
}

/**
 * Returns status badge info for a schedule row in Admin Schedule Manager
 */
export function getScheduleRowStatus(
  schedule: ExamScheduleItem,
  serverNowMs: number
): {
  status: 'inactive' | 'upcoming' | 'live' | 'ended';
  code: 'INACTIVE' | 'UPCOMING' | 'OPEN_NOW' | 'ENDED';
  label: string;
  countdownText: string;
  timeUntilStartMs: number;
  timeUntilEndMs: number;
} {
  const startMs = new Date(schedule.start_time).getTime();
  const endMs = new Date(schedule.end_time).getTime();
  const timeUntilStartMs = Math.max(0, startMs - serverNowMs);
  const timeUntilEndMs = Math.max(0, endMs - serverNowMs);

  if (!schedule.is_active) {
    return {
      status: 'inactive',
      code: 'INACTIVE',
      label: 'Inactive',
      countdownText: 'Schedule Inactive',
      timeUntilStartMs,
      timeUntilEndMs,
    };
  }
  if (serverNowMs < startMs) {
    return {
      status: 'upcoming',
      code: 'UPCOMING',
      label: 'Scheduled (Upcoming)',
      countdownText: `Starts in ${formatCountdownDuration(timeUntilStartMs)}`,
      timeUntilStartMs,
      timeUntilEndMs,
    };
  }
  if (serverNowMs > endMs) {
    return {
      status: 'ended',
      code: 'ENDED',
      label: 'Closed (Ended)',
      countdownText: `Ended at ${formatLagosTime12h(endMs)}`,
      timeUntilStartMs: 0,
      timeUntilEndMs: 0,
    };
  }
  return {
    status: 'live',
    code: 'OPEN_NOW',
    label: 'Active Now (Open)',
    countdownText: `Closes in ${formatCountdownDuration(timeUntilEndMs)}`,
    timeUntilStartMs: 0,
    timeUntilEndMs,
  };
}

/**
 * Core Enforcement Function: `canAttemptExam(student, exam_code)`
 */
export function canAttemptExam(params: {
  examCode: string;
  studentCenterId?: string | null;
  studentCenterName?: string | null;
  studentExamCenterId?: string | null;
  studentExamCenterName?: string | null;
  schedules?: ExamScheduleItem[];
  examCenters?: ExamCenter[];
  serverNowMs?: number;
}): CanAttemptExamResult {
  const {
    examCode,
    schedules = [],
    examCenters = [],
    serverNowMs = Date.now(),
  } = params;
  const studentCenterId = params.studentCenterId ?? params.studentExamCenterId;
  const studentCenterName = params.studentCenterName ?? params.studentExamCenterName;

  const cleanCode = (examCode || '').trim().toUpperCase();
  const activeForCode = schedules.filter(
    (s) => s && s.is_active && (s.exam_code || '').trim().toUpperCase() === cleanCode
  );

  // Resolve display name of student's centre
  const matchedCenterObj = examCenters.find(
    (ec) =>
      (studentCenterId && ec.id === studentCenterId) ||
      (studentCenterName &&
        ec.name.trim().toLowerCase() === studentCenterName.trim().toLowerCase())
  );
  const resolvedCentreName =
    matchedCenterObj?.name || studentCenterName || 'All Examination Centres';
  const resolvedCentreId = matchedCenterObj?.id || studentCenterId || null;

  if (activeForCode.length === 0) {
    return {
      allowed: true,
      status: 'no_schedule',
      reason: 'No time-table restriction configured for this examination code.',
      schedule: null,
      centreName: resolvedCentreName,
      startTimeMs: null,
      endTimeMs: null,
      serverNowMs,
      remainingSeconds: null,
      secondsUntilStart: null,
    };
  }

  // Step 2a: First check if specific schedule exists for (exam_code, student.exam_center_id)
  let matchedSchedule: ExamScheduleItem | undefined;
  if (resolvedCentreId) {
    matchedSchedule = activeForCode.find(
      (s) =>
        s.schedule_type === 'per_centre' &&
        s.exam_center_id &&
        s.exam_center_id === resolvedCentreId
    );
  }
  if (!matchedSchedule && studentCenterName) {
    const cleanName = studentCenterName.trim().toLowerCase();
    matchedSchedule = activeForCode.find(
      (s) =>
        s.schedule_type === 'per_centre' &&
        (s.exam_center_name || '').trim().toLowerCase() === cleanName
    );
  }

  // Step 2b: Else fallback to GENERAL schedule (exam_code, exam_center_id IS NULL)
  if (!matchedSchedule) {
    matchedSchedule = activeForCode.find(
      (s) => s.schedule_type === 'general' || s.exam_center_id === null
    );
  }

  if (!matchedSchedule) {
    return {
      allowed: true,
      status: 'no_schedule',
      reason: 'No specific or general schedule assigned to your examination centre.',
      schedule: null,
      centreName: resolvedCentreName,
      startTimeMs: null,
      endTimeMs: null,
      serverNowMs,
      remainingSeconds: null,
      secondsUntilStart: null,
    };
  }

  const startMs = new Date(matchedSchedule.start_time).getTime();
  const endMs = new Date(matchedSchedule.end_time).getTime();
  const displayCentre =
    matchedSchedule.schedule_type === 'per_centre'
      ? matchedSchedule.exam_center_name || resolvedCentreName
      : `${resolvedCentreName} (General Schedule)`;

  const startFormatted = `${formatLagosTime12h(startMs)} on ${formatLagosDateShort(startMs)}`;
  const endFormatted = `${formatLagosTime12h(endMs)} on ${formatLagosDateShort(endMs)}`;

  // Step 3a: Current server time < start_time
  if (serverNowMs < startMs) {
    const secondsUntilStart = Math.max(1, Math.ceil((startMs - serverNowMs) / 1000));
    return {
      allowed: false,
      status: 'before_start',
      reason: `Examination has not started yet for your centre (${displayCentre}). Scheduled: ${formatLagosTime12h(startMs)} - ${formatLagosTime12h(endMs)} (${formatLagosDateShort(startMs)}).`,
      schedule: matchedSchedule,
      centreName: displayCentre,
      startTimeMs: startMs,
      endTimeMs: endMs,
      serverNowMs,
      remainingSeconds: null,
      secondsUntilStart,
    };
  }

  // Step 3b: Current server time > end_time (even by 1 second e.g. 12:00:01 PM)
  if (serverNowMs > endMs) {
    return {
      allowed: false,
      status: 'after_end',
      reason: `Examination schedule has ended for your centre (${displayCentre}). Schedule was ${startFormatted} to ${endFormatted}. You can no longer attempt this exam.`,
      schedule: matchedSchedule,
      centreName: displayCentre,
      startTimeMs: startMs,
      endTimeMs: endMs,
      serverNowMs,
      remainingSeconds: 0,
      secondsUntilStart: 0,
    };
  }

  // Step 3c: start_time <= now <= end_time -> Allow
  const remainingSeconds = Math.max(0, Math.floor((endMs - serverNowMs) / 1000));
  return {
    allowed: true,
    status: 'active',
    reason: `Examination schedule is ACTIVE for ${displayCentre} (${formatLagosTime12h(startMs)} - ${formatLagosTime12h(endMs)}).`,
    schedule: matchedSchedule,
    centreName: displayCentre,
    startTimeMs: startMs,
    endTimeMs: endMs,
    serverNowMs,
    remainingSeconds,
    secondsUntilStart: 0,
  };
}

/**
 * Hook that maintains authoritative server time (`Africa/Lagos` UTC+1) so students cannot bypass schedules by changing their device clock.
 */
export function useServerTime(syncIntervalMs = 15000) {
  const [serverOffsetMs, setServerOffsetMs] = useState<number>(0);
  const [tickNowMs, setTickNowMs] = useState<number>(() => Date.now());

  const resyncServerTime = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/time');
      if (!res.ok) return;
      const data = await res.json();
      const t1 = Date.now();
      const rttHalf = Math.round((t1 - t0) / 2);
      if (typeof data?.serverTimeMs === 'number') {
        const estimatedNow = data.serverTimeMs + rttHalf;
        setServerOffsetMs(estimatedNow - Date.now());
        setTickNowMs(Date.now());
      }
    } catch {
      // Fallback to current offset if offline
    }
  }, []);

  useEffect(() => {
    resyncServerTime();
    const syncTimer = setInterval(resyncServerTime, syncIntervalMs);
    const secondTicker = setInterval(() => {
      setTickNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(syncTimer);
      clearInterval(secondTicker);
    };
  }, [resyncServerTime, syncIntervalMs]);

  return {
    serverNowMs: tickNowMs + serverOffsetMs,
    resyncServerTime,
  };
}

/**
 * React hook `useExamSchedule(examCode, studentCenterId, settings)` for real-time schedule enforcement & countdowns.
 */
export function useExamSchedule(params: {
  examCode: string;
  studentCenterId?: string | null;
  studentCenterName?: string | null;
  settings: ExamSettings;
}) {
  const { serverNowMs, resyncServerTime } = useServerTime(10000);

  const checkResult = useMemo(() => {
    return canAttemptExam({
      examCode: params.examCode,
      studentCenterId: params.studentCenterId,
      studentCenterName: params.studentCenterName,
      schedules: params.settings.examSchedules || [],
      examCenters: params.settings.examCenters || [],
      serverNowMs,
    });
  }, [
    params.examCode,
    params.studentCenterId,
    params.studentCenterName,
    params.settings.examSchedules,
    params.settings.examCenters,
    serverNowMs,
  ]);

  return {
    ...checkResult,
    resyncServerTime,
  };
}

export const EXAM_SCHEDULES_SQL_MIGRATION = `-- Supabase / PostgreSQL Migration: exam_schedules table (Africa/Lagos WAT)
CREATE TYPE schedule_type_enum AS ENUM ('general', 'per_centre');

CREATE TABLE IF NOT EXISTS public.exam_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_code VARCHAR(64) NOT NULL REFERENCES public.exams(exam_code) ON DELETE CASCADE,
  exam_center_id UUID NULL REFERENCES public.exam_centers(id) ON DELETE CASCADE,
  schedule_type schedule_type_enum NOT NULL DEFAULT 'general',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_end_after_start CHECK (end_time > start_time)
);

-- Unique constraint for Per-Centre schedules: (exam_code, exam_center_id) WHERE exam_center_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_schedules_per_centre_unique
  ON public.exam_schedules (exam_code, exam_center_id)
  WHERE exam_center_id IS NOT NULL;

-- Unique constraint for General schedule: (exam_code) WHERE exam_center_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_schedules_general_unique
  ON public.exam_schedules (exam_code)
  WHERE exam_center_id IS NULL;
`;
