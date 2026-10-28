import { Candidate, ExamResult } from '../types';

export interface LiveCandidateTelemetry {
  candidateId: string;
  regNumber: string;
  candidateName: string;
  category: string;
  gender: string;
  passportDataUrl?: string;
  testTitle: string;
  testCode: string;
  currentSubject: string;
  currentQuestionIndex: number;
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  accuracyPercent: number; // 0 to 100
  focusStatus: 'Focused' | 'Lost Focus Warning';
  cameraActive: boolean;
  isLiveFromExamTab: boolean;
  examStage?: string;
  timeLeftSeconds?: number;
  senderDeviceId?: string;
  lastUpdated: number;
  lastTransition?: 'promoted-to-top' | 'dropped-below-80' | null;
  lastTransitionAt?: number;
}

const STORAGE_KEY = 'quemint_live_proctoring_telemetry_v2';
const FRAMES_STORAGE_KEY = 'quemint_live_proctoring_frames_v2';
const CHANNEL_NAME = 'quemint_live_proctoring_channel_v2';
const LOCAL_EVENT_NAME = 'quemint_live_proctoring_local_event_v2';
const DEVICE_ID_KEY = 'quemint_device_id_v1';

export const LIVE_SESSION_ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes active exam session window

export function getLocalDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'dev-local';
  }
}

/**
 * Returns the candidate's uploaded Passport Photograph ONLY if the candidate (or admin) uploaded one.
 * If no photo has been uploaded, returns an empty string ('') so registration photo and photocard remain blank.
 */
export function getCandidateHdPortraitUrl(
  cand: Pick<Candidate, 'passportDataUrl'> | null | undefined
): string {
  const raw = cand?.passportDataUrl?.trim() || '';
  if (!raw) return '';
  // Ignore any legacy pre-seeded stock paths or external placeholder URLs
  if (
    raw.startsWith('/proctoring/') ||
    raw.includes('unsplash.com') ||
    raw.includes('pravatar.cc') ||
    raw.includes('randomuser.me')
  ) {
    return '';
  }
  return raw;
}

export function getSavedLiveTelemetryMap(): Record<string, LiveCandidateTelemetry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function getSavedLiveFramesMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FRAMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLiveFrameToStorage(candidateId: string, liveFrameDataUrl: string): void {
  if (!candidateId || !liveFrameDataUrl) return;
  try {
    const frames = getSavedLiveFramesMap();
    frames[candidateId] = liveFrameDataUrl;
    const keys = Object.keys(frames);
    if (keys.length > 8) {
      delete frames[keys[0]];
    }
    localStorage.setItem(FRAMES_STORAGE_KEY, JSON.stringify(frames));
  } catch {
    // If quota exceeded, store only the latest active candidate's frame
    try {
      localStorage.setItem(
        FRAMES_STORAGE_KEY,
        JSON.stringify({ [candidateId]: liveFrameDataUrl })
      );
    } catch {
      // Ignore storage errors
    }
  }
}

export function publishCandidateLiveTelemetry(telemetry: LiveCandidateTelemetry): void {
  try {
    const current = getSavedLiveTelemetryMap();
    const prev = current[telemetry.candidateId];
    let lastTransition = prev?.lastTransition || null;
    let lastTransitionAt = prev?.lastTransitionAt || undefined;

    if (prev) {
      if (prev.accuracyPercent < 80 && telemetry.accuracyPercent >= 80) {
        lastTransition = 'promoted-to-top';
        lastTransitionAt = Date.now();
      } else if (prev.accuracyPercent >= 80 && telemetry.accuracyPercent < 80) {
        lastTransition = 'dropped-below-80';
        lastTransitionAt = Date.now();
      }
    }

    const enriched: LiveCandidateTelemetry = {
      ...telemetry,
      senderDeviceId: telemetry.senderDeviceId || getLocalDeviceId(),
      lastTransition,
      lastTransitionAt,
      lastUpdated: Date.now(),
    };

    current[telemetry.candidateId] = enriched;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));

    const message = { type: 'TELEMETRY_UPDATE', payload: enriched };

    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(message);
      bc.close();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: message }));
    }

    if (typeof fetch !== 'undefined' && telemetry.isLiveFromExamTab) {
      fetch('/api/proctoring/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: enriched.candidateId,
          senderDeviceId: enriched.senderDeviceId,
          telemetry: enriched,
        }),
      }).catch(() => {});
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Publishes a live real-time webcam frame captured from a student taking an exam in ExamInterface.tsx
 * via localStorage, same-tab CustomEvent, BroadcastChannel (0ms cross-tab), and /api/proctoring/publish (cross-device).
 */
export function publishCandidateLiveFrame(
  candidateId: string,
  liveFrameDataUrl: string,
  telemetry?: LiveCandidateTelemetry
): void {
  try {
    const senderDeviceId = getLocalDeviceId();
    const now = Date.now();
    let enrichedTelemetry = telemetry;

    if (telemetry) {
      const current = getSavedLiveTelemetryMap();
      const prev = current[candidateId];
      let lastTransition = prev?.lastTransition || null;
      let lastTransitionAt = prev?.lastTransitionAt || undefined;

      if (prev) {
        if (prev.accuracyPercent < 80 && telemetry.accuracyPercent >= 80) {
          lastTransition = 'promoted-to-top';
          lastTransitionAt = now;
        } else if (prev.accuracyPercent >= 80 && telemetry.accuracyPercent < 80) {
          lastTransition = 'dropped-below-80';
          lastTransitionAt = now;
        }
      }

      enrichedTelemetry = {
        ...telemetry,
        isLiveFromExamTab: true,
        cameraActive: true,
        senderDeviceId: telemetry.senderDeviceId || senderDeviceId,
        lastTransition,
        lastTransitionAt,
        lastUpdated: now,
      };

      current[candidateId] = enrichedTelemetry;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Ignore quota errors
      }
    }

    if (liveFrameDataUrl) {
      saveLiveFrameToStorage(candidateId, liveFrameDataUrl);
    }

    const message = {
      type: 'LIVE_FRAME_UPDATE',
      candidateId,
      liveFrameDataUrl,
      telemetry: enrichedTelemetry,
      senderDeviceId,
      updatedAt: now,
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(message);
      bc.close();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: message }));
    }

    if (typeof fetch !== 'undefined') {
      fetch('/api/proctoring/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId,
          senderDeviceId,
          liveFrameDataUrl,
          telemetry: enrichedTelemetry,
        }),
      }).catch(() => {});
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Immediately unpublishes a candidate's live camera stream when they submit the exam.
 */
export function unpublishCandidateLiveStream(candidateId: string): void {
  try {
    const current = getSavedLiveTelemetryMap();
    if (current[candidateId]) {
      current[candidateId] = {
        ...current[candidateId],
        isLiveFromExamTab: false,
        cameraActive: false,
        lastUpdated: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    }

    try {
      const frames = getSavedLiveFramesMap();
      if (frames[candidateId]) {
        delete frames[candidateId];
        localStorage.setItem(FRAMES_STORAGE_KEY, JSON.stringify(frames));
      }
    } catch {
      // Ignore
    }

    const message = {
      type: 'CANDIDATE_DISCONNECTED',
      candidateId,
    };

    if (typeof BroadcastChannel !== 'undefined') {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(message);
      bc.close();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(LOCAL_EVENT_NAME, { detail: message }));
    }

    if (typeof fetch !== 'undefined') {
      fetch('/api/proctoring/unpublish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId }),
      }).catch(() => {});
    }
  } catch {
    // Ignore errors
  }
}

export function subscribeToLiveProctoring(
  onUpdate: (map: Record<string, LiveCandidateTelemetry>) => void,
  onLiveFrame?: (
    candidateId: string,
    liveFrameDataUrl: string,
    telemetry?: LiveCandidateTelemetry
  ) => void,
  onCandidateDisconnect?: (candidateId: string) => void
): () => void {
  let bc: BroadcastChannel | null = null;

  const handleIncomingMessage = (msg: any) => {
    if (!msg) return;
    if (msg.type === 'LIVE_FRAME_UPDATE' && msg.candidateId && msg.liveFrameDataUrl) {
      if (onLiveFrame) {
        onLiveFrame(msg.candidateId, msg.liveFrameDataUrl, msg.telemetry);
      }
    } else if (msg.type === 'CANDIDATE_DISCONNECTED' && msg.candidateId) {
      onUpdate(getSavedLiveTelemetryMap());
      if (onCandidateDisconnect) {
        onCandidateDisconnect(msg.candidateId);
      }
    } else {
      onUpdate(getSavedLiveTelemetryMap());
    }
  };

  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (event) => {
      handleIncomingMessage(event.data);
    };
  }

  const handleLocalEvent = (event: Event) => {
    const customEvent = event as CustomEvent;
    handleIncomingMessage(customEvent.detail);
  };

  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      onUpdate(getSavedLiveTelemetryMap());
    } else if (e.key === FRAMES_STORAGE_KEY && onLiveFrame) {
      const frames = getSavedLiveFramesMap();
      const telMap = getSavedLiveTelemetryMap();
      Object.entries(frames).forEach(([cid, frameUrl]) => {
        if (frameUrl) {
          onLiveFrame(cid, frameUrl, telMap[cid]);
        }
      });
    }
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(LOCAL_EVENT_NAME, handleLocalEvent);

  return () => {
    if (bc) bc.close();
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LOCAL_EVENT_NAME, handleLocalEvent);
  };
}

/**
 * Generates initial realistic live exam session telemetry for all active Paid candidates
 * so that both <80% and >=80% columns are populated and dynamic right away.
 */
export function buildInitialCandidateTelemetry(
  candidates: Candidate[],
  results: ExamResult[],
  existingMap: Record<string, LiveCandidateTelemetry>
): Record<string, LiveCandidateTelemetry> {
  const nextMap: Record<string, LiveCandidateTelemetry> = { ...existingMap };
  const paidCandidates = candidates.filter(
    (c) => c.paymentStatus === 'Paid' && !c.proctoringCleared
  );

  const defaultSubjectsByCategory: Record<string, string[]> = {
    medical: ['Biology', 'Chemistry', 'Physics', 'English'],
    engineering: ['Mathematics', 'Physics', 'Chemistry', 'English'],
    art: ['Literature', 'Government', 'English'],
    commercial: ['Economics', 'Mathematics', 'English'],
  };

  paidCandidates.forEach((cand, idx) => {
    const existing = nextMap[cand.id];
    const fullName = `${cand.firstName} ${cand.middleName ? cand.middleName + ' ' : ''}${cand.surname}`.trim();
    const resolvedPortrait = getCandidateHdPortraitUrl(cand);

    if (existing) {
      nextMap[cand.id] = {
        ...existing,
        regNumber: cand.regNumber,
        candidateName: fullName,
        category: cand.category,
        gender: cand.gender,
        passportDataUrl: resolvedPortrait,
      };
      return;
    }

    // Check if candidate has an existing exam result to seed initial accuracy
    const matchedResult = results.find(
      (r) =>
        r.candidateId === cand.id ||
        r.regNumber.trim().toUpperCase() === cand.regNumber.trim().toUpperCase()
    );

    const catKey = cand.category.trim().toLowerCase();
    const subjPool = defaultSubjectsByCategory[catKey] || [
      'English',
      'Biology',
      'Chemistry',
      'Physics',
    ];
    const currentSubject = subjPool[idx % subjPool.length];
    const totalQuestions = 40;

    // Seed some candidates >= 80% accuracy (Top Performers) and some < 80% accuracy
    let answeredCount = 15 + ((idx * 5) % 18);
    let correctCount = 0;

    if (matchedResult) {
      answeredCount = Math.min(totalQuestions, Math.max(10, matchedResult.totalQuestions || 25));
      correctCount = Math.round((matchedResult.percentage / 100) * answeredCount);
    } else {
      // Alternate so some start at ~85-92% and others start at ~62-78% (near the 80% threshold for dynamic movement)
      const targetRatios = [0.88, 0.75, 0.84, 0.79, 0.91, 0.68, 0.81, 0.72];
      const ratio = targetRatios[idx % targetRatios.length];
      correctCount = Math.round(answeredCount * ratio);
    }

    const accuracyPercent =
      answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

    nextMap[cand.id] = {
      candidateId: cand.id,
      regNumber: cand.regNumber,
      candidateName: fullName,
      category: cand.category,
      gender: cand.gender,
      passportDataUrl: resolvedPortrait,
      testTitle: 'Rapid Test',
      testCode: 'RAPID-2026-QMT',
      currentSubject,
      currentQuestionIndex: Math.min(totalQuestions, answeredCount + 1),
      totalQuestions,
      answeredCount,
      correctCount,
      accuracyPercent,
      focusStatus: 'Focused',
      cameraActive: true,
      isLiveFromExamTab: false,
      lastUpdated: Date.now(),
      lastTransition: null,
    };
  });

  return nextMap;
}
