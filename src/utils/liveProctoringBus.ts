import { Candidate, ExamResult } from '../types';

export const LIVE_SESSION_ACTIVE_WINDOW_MS = 35000;

export interface LiveCandidateTelemetry {
  candidateId: string;
  regNumber: string;
  candidateName: string;
  category: string;
  gender: 'Male' | 'Female';
  currentSubject: string;
  currentQuestionIndex: number;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  wrongCount?: number;
  accuracyPercent: number;
  currentStreakType?: 'pass' | 'fail' | 'none';
  currentStreakCount?: number;
  timeRemainingSeconds?: number;
  timeLeftSeconds: number;
  cameraConnected?: boolean;
  cameraActive?: boolean;
  cameraLabel?: string;
  faceVerified?: boolean;
  focusStatus?: 'Focused' | 'Tab Switched' | string;
  securityFlags?: number;
  status?: 'Active' | 'Submitted' | 'Idle';
  isLiveFromExamTab?: boolean;
  passportDataUrl?: string;
  lastTransition?: 'promoted-to-top' | 'dropped-below-80' | 'none';
  lastTransitionAt?: number;
  lastUpdated: number;
  senderDeviceId?: string;
}

const LOCAL_DEVICE_ID_KEY = 'quemint_proctoring_device_id';
const LIVE_TELEMETRY_STORAGE_KEY = 'quemint_live_telemetry_v4';
const LIVE_FRAMES_STORAGE_KEY = 'quemint_live_frames_v4';
const BROADCAST_CHANNEL_NAME = 'quemint_live_proctoring_channel_v4';

export function getLocalDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    let id = sessionStorage.getItem(LOCAL_DEVICE_ID_KEY);
    if (!id) {
      id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(LOCAL_DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'local-dev';
  }
}

export function getCandidateHdPortraitUrl(candidate: Partial<Candidate>): string {
  const existing = (candidate.passportDataUrl || '').trim();
  if (existing && !existing.startsWith('/proctoring/')) {
    return existing;
  }
  const initials = `${(candidate.firstName || 'C')[0] || 'C'}${
    (candidate.surname || 'S')[0] || 'S'
  }`.toUpperCase();
  const fullName = `${candidate.firstName || 'Candidate'} ${candidate.surname || ''}`.trim();
  const regNo = candidate.regNumber || 'QMT-CANDIDATE';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <rect width="240" height="240" rx="24" fill="#0a6b3c"/>
    <circle cx="120" cy="86" r="42" fill="#0e8a4e" stroke="#ffffff" stroke-width="3"/>
    <path d="M48 212 C48 164 192 164 192 212" fill="#0e8a4e" stroke="#ffffff" stroke-width="3"/>
    <text x="120" y="98" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-size="30" font-weight="bold">${initials}</text>
    <rect x="16" y="198" width="208" height="28" rx="8" fill="#000000" fill-opacity="0.55"/>
    <text x="120" y="216" text-anchor="middle" fill="#ffffff" font-family="monospace" font-size="11" font-weight="bold">${regNo.slice(0, 18)}</text>
    <title>${fullName}</title>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function buildInitialCandidateTelemetry(
  candidates: Candidate[],
  results: ExamResult[] = [],
  existingMap: Record<string, LiveCandidateTelemetry> = {}
): Record<string, LiveCandidateTelemetry> {
  const map: Record<string, LiveCandidateTelemetry> = { ...existingMap };
  candidates.forEach((candidate) => {
    const existing = map[candidate.id];
    const matchedRes = results.find(
      (r) =>
        r.candidateId === candidate.id ||
        (candidate.regNumber &&
          r.regNumber.trim().toUpperCase() ===
            candidate.regNumber.trim().toUpperCase())
    );
    const subjects = (
      candidate.subjectCombination || 'English Language, Biology, Chemistry, Physics'
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const defaultAcc = matchedRes ? matchedRes.percentage : existing?.accuracyPercent ?? 75;
    const defaultAnswered = matchedRes
      ? matchedRes.totalQuestions
      : existing?.answeredCount ?? 12;
    const defaultCorrect = matchedRes
      ? matchedRes.rawTotalCorrect ?? Math.round((defaultAcc / 100) * defaultAnswered)
      : existing?.correctCount ?? 9;

    map[candidate.id] = {
      candidateId: candidate.id,
      regNumber: candidate.regNumber || 'PENDING',
      candidateName: `${candidate.firstName} ${
        candidate.middleName ? candidate.middleName + ' ' : ''
      }${candidate.surname}`.trim(),
      category: candidate.category || 'Science',
      gender: candidate.gender || 'Female',
      currentSubject: existing?.currentSubject || subjects[0] || 'English Language',
      currentQuestionIndex: existing?.currentQuestionIndex ?? 1,
      totalQuestions: existing?.totalQuestions ?? 40,
      answeredCount: defaultAnswered,
      correctCount: defaultCorrect,
      wrongCount: Math.max(0, defaultAnswered - defaultCorrect),
      accuracyPercent: defaultAcc,
      currentStreakType: existing?.currentStreakType || 'none',
      currentStreakCount: existing?.currentStreakCount || 0,
      timeRemainingSeconds: existing?.timeRemainingSeconds ?? 1800,
      timeLeftSeconds: existing?.timeLeftSeconds ?? existing?.timeRemainingSeconds ?? 1800,
      cameraConnected: existing?.cameraConnected ?? false,
      cameraActive: existing?.cameraActive ?? existing?.cameraConnected ?? false,
      faceVerified: existing?.faceVerified ?? true,
      focusStatus: existing?.focusStatus || 'Focused',
      securityFlags: existing?.securityFlags ?? 0,
      status: matchedRes ? 'Submitted' : existing?.status || 'Idle',
      isLiveFromExamTab: existing?.isLiveFromExamTab ?? false,
      passportDataUrl: getCandidateHdPortraitUrl(candidate),
      lastTransition: existing?.lastTransition || 'none',
      lastTransitionAt: existing?.lastTransitionAt,
      lastUpdated: existing?.lastUpdated ?? 0,
    };
  });
  return map;
}

export function getSavedLiveTelemetryMap(): Record<string, LiveCandidateTelemetry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LIVE_TELEMETRY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getSavedLiveFramesMap(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LIVE_FRAMES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

let sharedChannel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (!sharedChannel) {
    try {
      sharedChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    } catch {
      sharedChannel = null;
    }
  }
  return sharedChannel;
}

export function publishCandidateLiveTelemetry(telemetry: LiveCandidateTelemetry): void {
  if (typeof window === 'undefined') return;
  const acc =
    typeof telemetry.accuracyPercent === 'number'
      ? telemetry.accuracyPercent
      : telemetry.answeredCount > 0
      ? Math.round((telemetry.correctCount / telemetry.answeredCount) * 100)
      : 0;
  const enriched: LiveCandidateTelemetry = {
    ...telemetry,
    accuracyPercent: acc,
    timeLeftSeconds:
      telemetry.timeLeftSeconds ?? telemetry.timeRemainingSeconds ?? 1800,
    isLiveFromExamTab: telemetry.isLiveFromExamTab ?? true,
    lastUpdated: Date.now(),
    senderDeviceId: telemetry.senderDeviceId || getLocalDeviceId(),
  };

  try {
    const existing = getSavedLiveTelemetryMap();
    existing[telemetry.candidateId] = enriched;
    localStorage.setItem(LIVE_TELEMETRY_STORAGE_KEY, JSON.stringify(existing));
  } catch {
    // ignore storage quota errors
  }

  try {
    getChannel()?.postMessage({
      type: 'TELEMETRY_UPDATE',
      candidateId: telemetry.candidateId,
      telemetry: enriched,
    });
  } catch {
    // ignore
  }

  fetch('/api/proctoring/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidateId: telemetry.candidateId,
      senderDeviceId: enriched.senderDeviceId,
      telemetry: enriched,
    }),
  }).catch(() => {});
}

export function publishCandidateLiveFrame(
  candidateId: string,
  frameDataUrl: string,
  telemetry?: LiveCandidateTelemetry
): void {
  if (typeof window === 'undefined' || !candidateId || !frameDataUrl) return;
  const senderDeviceId = getLocalDeviceId();

  try {
    const frames = getSavedLiveFramesMap();
    frames[candidateId] = frameDataUrl;
    localStorage.setItem(LIVE_FRAMES_STORAGE_KEY, JSON.stringify(frames));
  } catch {
    // ignore quota errors
  }

  try {
    getChannel()?.postMessage({
      type: 'FRAME_UPDATE',
      candidateId,
      frameDataUrl,
      telemetry,
      senderDeviceId,
    });
  } catch {
    // ignore
  }

  fetch('/api/proctoring/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidateId,
      senderDeviceId,
      liveFrameDataUrl: frameDataUrl,
      telemetry: telemetry
        ? {
            ...telemetry,
            isLiveFromExamTab: true,
            lastUpdated: Date.now(),
            senderDeviceId,
          }
        : undefined,
    }),
  }).catch(() => {});
}

export function unpublishCandidateLiveStream(candidateId: string): void {
  if (typeof window === 'undefined' || !candidateId) return;
  try {
    const frames = getSavedLiveFramesMap();
    delete frames[candidateId];
    localStorage.setItem(LIVE_FRAMES_STORAGE_KEY, JSON.stringify(frames));
  } catch {
    // ignore
  }

  try {
    getChannel()?.postMessage({
      type: 'CANDIDATE_DISCONNECTED',
      candidateId,
    });
  } catch {
    // ignore
  }

  fetch('/api/proctoring/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidateId }),
  }).catch(() => {});
}

export function subscribeToLiveProctoring(
  onTelemetryMap: (latestMap: Record<string, LiveCandidateTelemetry>) => void,
  onFrame: (
    candidateId: string,
    liveFrameDataUrl: string,
    incomingTelemetry?: LiveCandidateTelemetry
  ) => void,
  onDisconnect?: (disconnectedCandidateId: string) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const emitSingleTelemetry = (cid: string, tel: LiveCandidateTelemetry) => {
    onTelemetryMap({
      [cid]: {
        ...tel,
        isLiveFromExamTab: true,
        lastUpdated: tel.lastUpdated || Date.now(),
      },
    });
  };

  let bc: BroadcastChannel | null = null;
  const handleBcMessage = (ev: MessageEvent) => {
    const data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'TELEMETRY_UPDATE' && data.candidateId && data.telemetry) {
      emitSingleTelemetry(data.candidateId, data.telemetry);
    } else if (data.type === 'FRAME_UPDATE' && data.candidateId && data.frameDataUrl) {
      onFrame(data.candidateId, data.frameDataUrl, data.telemetry);
    } else if (data.type === 'CANDIDATE_DISCONNECTED' && data.candidateId) {
      onDisconnect?.(data.candidateId);
    }
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      bc.addEventListener('message', handleBcMessage);
    } catch {
      bc = null;
    }
  }

  let es: EventSource | null = null;
  try {
    es = new EventSource('/api/proctoring/stream');
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'SNAPSHOT' && Array.isArray(parsed.feeds)) {
          const batchMap: Record<string, LiveCandidateTelemetry> = {};
          parsed.feeds.forEach((f: any) => {
            if (f.candidateId && f.telemetry) {
              batchMap[f.candidateId] = {
                ...f.telemetry,
                isLiveFromExamTab: true,
                lastUpdated: f.updatedAt || Date.now(),
              };
            }
            if (f.candidateId && f.liveFrameDataUrl) {
              onFrame(f.candidateId, f.liveFrameDataUrl, f.telemetry);
            }
          });
          if (Object.keys(batchMap).length > 0) {
            onTelemetryMap(batchMap);
          }
        } else if (parsed.type === 'FEED_UPDATE' && parsed.feed) {
          const f = parsed.feed;
          if (f.candidateId && f.telemetry) {
            emitSingleTelemetry(f.candidateId, f.telemetry);
          }
          if (f.candidateId && f.liveFrameDataUrl) {
            onFrame(f.candidateId, f.liveFrameDataUrl, f.telemetry);
          }
        } else if (parsed.type === 'CANDIDATE_DISCONNECTED' && parsed.candidateId) {
          onDisconnect?.(parsed.candidateId);
        }
      } catch {
        // ignore parse errors
      }
    };
  } catch {
    es = null;
  }

  const pollFeeds = async () => {
    try {
      const res = await fetch('/api/proctoring/feeds');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.feeds)) {
        const batchMap: Record<string, LiveCandidateTelemetry> = {};
        data.feeds.forEach((f: any) => {
          if (f.candidateId && f.telemetry) {
            batchMap[f.candidateId] = {
              ...f.telemetry,
              isLiveFromExamTab: true,
              lastUpdated: f.updatedAt || Date.now(),
            };
          }
          if (f.candidateId && f.liveFrameDataUrl) {
            onFrame(f.candidateId, f.liveFrameDataUrl, f.telemetry);
          }
        });
        if (Object.keys(batchMap).length > 0) {
          onTelemetryMap(batchMap);
        }
      }
    } catch {
      // ignore
    }
  };

  pollFeeds();
  const pollInterval = setInterval(pollFeeds, 2500);

  return () => {
    clearInterval(pollInterval);
    if (bc) {
      bc.removeEventListener('message', handleBcMessage);
      bc.close();
    }
    if (es) {
      es.close();
    }
  };
}
