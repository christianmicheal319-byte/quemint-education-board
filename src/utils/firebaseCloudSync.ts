import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  Candidate,
  ExamResult,
  ExamSettings,
  NotificationItem,
  Question,
} from '../types';
import {
  LiveCandidateTelemetry,
  getCandidateHdPortraitUrl,
  getLocalDeviceId,
} from './liveProctoringBus';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

function sanitizeFirestoreId(rawId: string): string {
  const cleaned = (rawId || 'item').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || 'item';
}

const lastSyncedCandidateJsonMap = new Map<string, string>();
const lastSyncedStateJsonMap = new Map<string, string>();
let hasInitialCandidatesSnapshotResolved = false;

export type CloudStateKind = 'settings' | 'questions' | 'results' | 'notifications';

export async function pushCloudStateKind(
  kind: CloudStateKind,
  payload: unknown
): Promise<void> {
  const docId = sanitizeFirestoreId(kind);
  const path = `cbt_state/${docId}`;
  try {
    const payloadJson = JSON.stringify(payload);
    if (payloadJson.length > 940000) {
      return;
    }
    if (lastSyncedStateJsonMap.get(kind) === payloadJson) {
      return;
    }
    lastSyncedStateJsonMap.set(kind, payloadJson);

    await setDoc(doc(db, 'cbt_state', docId), {
      kind,
      payloadJson,
      updatedAt: Date.now(),
      updatedByDevice: getLocalDeviceId().slice(0, 120),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('missing or insufficient permissions')
    ) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function pushCloudCandidates(
  candidates: Candidate[],
  allowDeletions = false
): Promise<void> {
  const currentSafeIds = new Set<string>();

  for (const cand of candidates) {
    if (!cand || !cand.id) continue;
    const safeId = sanitizeFirestoreId(cand.id);
    currentSafeIds.add(safeId);

    const candidateJson = JSON.stringify(cand);
    if (candidateJson.length > 890000) continue;

    if (lastSyncedCandidateJsonMap.get(safeId) === candidateJson) {
      continue;
    }
    lastSyncedCandidateJsonMap.set(safeId, candidateJson);

    const path = `cbt_candidates/${safeId}`;
    try {
      await setDoc(doc(db, 'cbt_candidates', safeId), {
        id: safeId,
        regNumber: (cand.regNumber || '').slice(0, 60),
        paymentStatus: (cand.paymentStatus || 'Pending').slice(0, 30),
        candidateJson,
        updatedAt: typeof cand.updatedAt === 'number' ? cand.updatedAt : Date.now(),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    }
  }

  if (allowDeletions && hasInitialCandidatesSnapshotResolved) {
    for (const prevSafeId of Array.from(lastSyncedCandidateJsonMap.keys())) {
      if (!currentSafeIds.has(prevSafeId)) {
        lastSyncedCandidateJsonMap.delete(prevSafeId);
        const path = `cbt_candidates/${prevSafeId}`;
        try {
          await deleteDoc(doc(db, 'cbt_candidates', prevSafeId));
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.toLowerCase().includes('missing or insufficient permissions')
          ) {
            handleFirestoreError(error, OperationType.DELETE, path);
          }
        }
      }
    }
  }
}

export function subscribeToCloudAppState(callbacks: {
  initialState: {
    candidates: Candidate[];
    questions: Question[];
    settings: ExamSettings;
    results: ExamResult[];
    notifications: NotificationItem[];
  };
  onCandidatesChange: (candidates: Candidate[]) => void;
  onQuestionsChange: (questions: Question[]) => void;
  onSettingsChange: (settings: ExamSettings) => void;
  onResultsChange: (results: ExamResult[]) => void;
  onNotificationsChange: (notifications: NotificationItem[]) => void;
}): () => void {
  let seededStateDocs = false;
  let seededCandidates = false;

  const stateUnsub = onSnapshot(
    collection(db, 'cbt_state'),
    (snapshot) => {
      if (snapshot.empty && !seededStateDocs) {
        seededStateDocs = true;
        pushCloudStateKind('settings', callbacks.initialState.settings);
        pushCloudStateKind('questions', callbacks.initialState.questions);
        pushCloudStateKind('results', callbacks.initialState.results);
        pushCloudStateKind('notifications', callbacks.initialState.notifications);
        return;
      }

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') return;
        const data = change.doc.data();
        if (!data || typeof data.payloadJson !== 'string') return;
        const kind = data.kind as CloudStateKind;
        lastSyncedStateJsonMap.set(kind, data.payloadJson);

        try {
          const parsed = JSON.parse(data.payloadJson);
          if (kind === 'settings' && parsed && typeof parsed === 'object') {
            callbacks.onSettingsChange(parsed as ExamSettings);
          } else if (kind === 'questions' && Array.isArray(parsed)) {
            callbacks.onQuestionsChange(parsed as Question[]);
          } else if (kind === 'results' && Array.isArray(parsed)) {
            callbacks.onResultsChange(parsed as ExamResult[]);
          } else if (kind === 'notifications' && Array.isArray(parsed)) {
            callbacks.onNotificationsChange(parsed as NotificationItem[]);
          }
        } catch {
          // Ignore malformed JSON
        }
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cbt_state');
    }
  );

  const candidatesUnsub = onSnapshot(
    collection(db, 'cbt_candidates'),
    (snapshot) => {
      hasInitialCandidatesSnapshotResolved = true;
      if (snapshot.empty && !seededCandidates) {
        seededCandidates = true;
        pushCloudCandidates(callbacks.initialState.candidates, false);
        return;
      }

      const loadedCandidates: Candidate[] = [];
      const currentDocIds = new Set<string>();

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data || typeof data.candidateJson !== 'string' || data.deleted) return;
        currentDocIds.add(docSnap.id);
        lastSyncedCandidateJsonMap.set(docSnap.id, data.candidateJson);
        try {
          const cand = JSON.parse(data.candidateJson) as Candidate;
          if (cand && cand.id) {
            loadedCandidates.push({
              ...cand,
              passportDataUrl: getCandidateHdPortraitUrl(cand),
            });
          }
        } catch {
          // Ignore malformed candidate JSON
        }
      });

      // Clean up deleted keys from local cache map
      for (const cachedKey of Array.from(lastSyncedCandidateJsonMap.keys())) {
        if (!currentDocIds.has(cachedKey)) {
          lastSyncedCandidateJsonMap.delete(cachedKey);
        }
      }

      if (loadedCandidates.length > 0) {
        loadedCandidates.sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return aTime - bTime;
        });
        callbacks.onCandidatesChange(loadedCandidates);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cbt_candidates');
    }
  );

  return () => {
    stateUnsub();
    candidatesUnsub();
  };
}

let lastProctoringPublishAt = 0;

export async function publishCloudProctoringTelemetry(
  telemetry: LiveCandidateTelemetry
): Promise<void> {
  if (!telemetry || !telemetry.candidateId) return;
  const now = Date.now();
  // Throttle Firestore writes to at most once every 1200ms while keeping immediate updates on subject/question changes
  if (now - lastProctoringPublishAt < 900) return;
  lastProctoringPublishAt = now;

  const safeId = sanitizeFirestoreId(telemetry.candidateId);
  const path = `cbt_proctoring/${safeId}`;
  try {
    const telemetryJson = JSON.stringify({
      ...telemetry,
      isLiveFromExamTab: true,
      lastUpdated: now,
    });
    if (telemetryJson.length > 95000) return;

    await setDoc(doc(db, 'cbt_proctoring', safeId), {
      candidateId: safeId,
      active: true,
      telemetryJson,
      updatedAt: now,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('missing or insufficient permissions')
    ) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }
}

export async function unpublishCloudProctoringTelemetry(
  candidateId: string
): Promise<void> {
  if (!candidateId) return;
  const safeId = sanitizeFirestoreId(candidateId);
  const path = `cbt_proctoring/${safeId}`;
  try {
    await deleteDoc(doc(db, 'cbt_proctoring', safeId));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('missing or insufficient permissions')
    ) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export function subscribeToCloudProctoring(
  onTelemetryMapUpdate: (map: Record<string, LiveCandidateTelemetry>) => void,
  onCandidateDisconnect?: (candidateId: string) => void
): () => void {
  const unsub = onSnapshot(
    collection(db, 'cbt_proctoring'),
    (snapshot) => {
      const activeMap: Record<string, LiveCandidateTelemetry> = {};

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          const removedData = change.doc.data();
          if (removedData?.telemetryJson) {
            try {
              const parsed = JSON.parse(removedData.telemetryJson);
              if (parsed?.candidateId && onCandidateDisconnect) {
                onCandidateDisconnect(parsed.candidateId);
              }
            } catch {
              // ignore
            }
          }
        }
      });

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (!data || !data.active || typeof data.telemetryJson !== 'string') return;
        try {
          const tel = JSON.parse(data.telemetryJson) as LiveCandidateTelemetry;
          if (tel && tel.candidateId) {
            activeMap[tel.candidateId] = {
              ...tel,
              isLiveFromExamTab: true,
              lastUpdated: typeof data.updatedAt === 'number' ? data.updatedAt : tel.lastUpdated,
            };
          }
        } catch {
          // ignore
        }
      });

      if (Object.keys(activeMap).length > 0) {
        onTelemetryMapUpdate(activeMap);
      }
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cbt_proctoring');
    }
  );

  return unsub;
}
