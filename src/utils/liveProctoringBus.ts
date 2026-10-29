import { Candidate, ExamResult } from '../types';
import {
  publishCloudProctoringTelemetry,
  subscribeToCloudProctoring,
  unpublishCloudProctoringTelemetry,
} from './firebaseCloudSync';

export const LIVE_SESSION_ACTIVE_WINDOW_MS = 120000;

export interface LiveCandidateTelemetry {
  candidateId: string;
  regNumber: string;
  candidateName: string;
  category: string;
  gender: 'Male' | 'Female';
  testTitle?: string;
  testCode?: string;
  examStage?: string;
  currentSubject: string;
  currentQuestionIndex: number;
  currentQuestionText?: string;
  selectedOptionLetter?: string;
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

const FEMALE_PORTRAITS = [
  '/proctoring/cand_f1_hd.jpg',
  '/proctoring/cand_f2_hd.jpg',
  '/proctoring/cand_f3_hd.jpg',
  '/proctoring/cand_f4_hd.jpg',
  '/proctoring/cand_f5_hd.jpg',
];

const MALE_PORTRAITS = [
  '/proctoring/cand_m1_hd.jpg',
  '/proctoring/cand_m2_hd.jpg',
  '/proctoring/cand_m3_hd.jpg',
  '/proctoring/cand_m4_hd.jpg',
  '/proctoring/cand_m5.jpg',
];

const FEMALE_VIDEOS = [
  '/proctoring/vid_f1.mp4',
  '/proctoring/vid_f2.mp4',
  '/proctoring/vid_f3.mp4',
  '/proctoring/vid_f4.mp4',
];

const MALE_VIDEOS = [
  '/proctoring/vid_m1.mp4',
  '/proctoring/vid_m2.mp4',
  '/proctoring/vid_m3.mp4',
  '/proctoring/vid_m4.mp4',
];

function getCandidateStableIndex(candidate: Partial<Candidate>, fallbackIndex = 0): number {
  const key = `${candidate.id || ''}-${candidate.regNumber || ''}-${candidate.firstName || ''}-${candidate.surname || ''}`;
  if (!key.replace(/-/g, '').trim()) return fallbackIndex;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

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
  if (existing) {
    return existing;
  }
  const idx = getCandidateStableIndex(candidate);
  const isMale = (candidate.gender || '').toLowerCase() === 'male';
  const pool = isMale ? MALE_PORTRAITS : FEMALE_PORTRAITS;
  return pool[idx % pool.length];
}

export function getCandidateLiveExamVideoUrl(
  candidate: Partial<Candidate>,
  fallbackIndex = 0
): string {
  const idx = getCandidateStableIndex(candidate, fallbackIndex);
  const isMale = (candidate.gender || '').toLowerCase() === 'male';
  const pool = isMale ? MALE_VIDEOS : FEMALE_VIDEOS;
  return pool[idx % pool.length];
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

  publishCloudProctoringTelemetry(enriched).catch(() => {});

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

  unpublishCloudProctoringTelemetry(candidateId).catch(() => {});

  fetch('/api/proctoring/unpublish', {
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
        } else if (
          (parsed.type === 'CANDIDATE_FEED' || parsed.type === 'FEED_UPDATE') &&
          parsed.feed
        ) {
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

  const handleStorageEvent = (e: StorageEvent) => {
    try {
      if (e.key === LIVE_TELEMETRY_STORAGE_KEY && e.newValue) {
        const parsedMap = JSON.parse(e.newValue);
        if (parsedMap && typeof parsedMap === 'object') {
          onTelemetryMap(parsedMap);
        }
      } else if (e.key === LIVE_FRAMES_STORAGE_KEY && e.newValue) {
        const parsedFrames = JSON.parse(e.newValue);
        if (parsedFrames && typeof parsedFrames === 'object') {
          Object.entries(parsedFrames).forEach(([cid, frameUrl]) => {
            if (typeof frameUrl === 'string' && frameUrl.length > 0) {
              onFrame(cid, frameUrl);
            }
          });
        }
      }
    } catch {
      // ignore
    }
  };
  window.addEventListener('storage', handleStorageEvent);

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
  const pollInterval = setInterval(pollFeeds, 800);

  const cloudUnsub = subscribeToCloudProctoring(
    (cloudTelemetryMap) => {
      onTelemetryMap(cloudTelemetryMap);
    },
    (disconnectedCandidateId) => {
      onDisconnect?.(disconnectedCandidateId);
    }
  );

  return () => {
    clearInterval(pollInterval);
    cloudUnsub();
    window.removeEventListener('storage', handleStorageEvent);
    if (bc) {
      bc.removeEventListener('message', handleBcMessage);
      bc.close();
    }
    if (es) {
      es.close();
    }
  };
}
