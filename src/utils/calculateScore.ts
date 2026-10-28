export interface PsychometricConfig {
  enabled: boolean;
  failStreakCount: number; // default: 3 consecutive wrong answers
  failStreakPenalty: number; // default: -1 (or 1) raw score deduction
  passStreakCount: number; // default: 15 consecutive correct answers
  passStreakBonus: number; // default: 0.5 raw score bonus
  maxSubjectScoreCap: number; // default: 99 (never 100)
  minSubjectScoreCap: number; // default: 0
}

export const DEFAULT_PSYCHOMETRIC_CONFIG: PsychometricConfig = {
  enabled: true,
  failStreakCount: 3,
  failStreakPenalty: -1,
  passStreakCount: 15,
  passStreakBonus: 0.5,
  maxSubjectScoreCap: 99,
  minSubjectScoreCap: 0,
};

export interface DetailedSetScore {
  rawCorrect: number;
  failStreaksTriggered: number;
  totalPenaltyDeducted: number;
  passStreaksTriggered: number;
  totalBonusAdded: number;
  adjustedRaw: number;
  uncappedPercent: number;
  finalScore: number;
}

export function calculateSetScoreDetailed(
  answersInOrder: { isCorrect: boolean }[],
  totalInSet: number,
  config: PsychometricConfig = DEFAULT_PSYCHOMETRIC_CONFIG
): DetailedSetScore {
  const safeTotal = totalInSet > 0 ? totalInSet : 1;
  const rawCorrect = answersInOrder.filter((a) => a.isCorrect).length;
  let raw = rawCorrect;
  let failStreaksTriggered = 0;
  let totalPenaltyDeducted = 0;
  let passStreaksTriggered = 0;
  let totalBonusAdded = 0;

  if (config.enabled) {
    // Check N fails in a row (default: 3 fails in a row -> -1 penalty)
    const targetFailStreak = Math.max(1, Math.floor(config.failStreakCount));
    const penaltyMagnitude = Math.abs(config.failStreakPenalty);
    let failStreak = 0;
    for (const ans of answersInOrder) {
      if (!ans.isCorrect) {
        failStreak++;
        if (failStreak === targetFailStreak) {
          raw -= penaltyMagnitude;
          failStreaksTriggered++;
          totalPenaltyDeducted += penaltyMagnitude;
          failStreak = 0;
        }
      } else {
        failStreak = 0;
      }
    }

    // Check M correct in a row (default: 15 correct in a row -> +0.5 bonus)
    const targetPassStreak = Math.max(1, Math.floor(config.passStreakCount));
    const bonusMagnitude = Math.abs(config.passStreakBonus);
    let passStreak = 0;
    for (const ans of answersInOrder) {
      if (ans.isCorrect) {
        passStreak++;
        if (passStreak === targetPassStreak) {
          raw += bonusMagnitude;
          passStreaksTriggered++;
          totalBonusAdded += bonusMagnitude;
          passStreak = 0;
        }
      } else {
        passStreak = 0;
      }
    }
  }

  const percent = (raw / safeTotal) * 100;
  const uncappedPercent = Math.round(percent);
  let finalScore = uncappedPercent;

  const maxCap = config.enabled ? config.maxSubjectScoreCap : 100;
  const minCap = config.enabled ? config.minSubjectScoreCap : 0;

  if (finalScore > maxCap) finalScore = maxCap;
  if (finalScore < minCap) finalScore = minCap;

  return {
    rawCorrect,
    failStreaksTriggered,
    totalPenaltyDeducted,
    passStreaksTriggered,
    totalBonusAdded,
    adjustedRaw: raw,
    uncappedPercent,
    finalScore,
  };
}

export function calculateSetScore(
  answersInOrder: { isCorrect: boolean }[],
  totalInSet: number,
  config: PsychometricConfig = DEFAULT_PSYCHOMETRIC_CONFIG
): number {
  let raw = answersInOrder.filter((a) => a.isCorrect).length;

  if (config.enabled) {
    const targetFailStreak = Math.max(1, Math.floor(config.failStreakCount));
    const penaltyMagnitude = Math.abs(config.failStreakPenalty);
    // Check 3 fails in a row (or admin-configured failStreakCount)
    let failStreak = 0;
    for (const ans of answersInOrder) {
      if (!ans.isCorrect) {
        failStreak++;
        if (failStreak === targetFailStreak) {
          raw -= penaltyMagnitude;
          failStreak = 0;
        }
      } else {
        failStreak = 0;
      }
    }

    const targetPassStreak = Math.max(1, Math.floor(config.passStreakCount));
    const bonusMagnitude = Math.abs(config.passStreakBonus);
    // Check 15 correct in a row (or admin-configured passStreakCount)
    let passStreak = 0;
    for (const ans of answersInOrder) {
      if (ans.isCorrect) {
        passStreak++;
        if (passStreak === targetPassStreak) {
          raw += bonusMagnitude;
          passStreak = 0;
        }
      } else {
        passStreak = 0;
      }
    }
  }

  const safeTotal = totalInSet > 0 ? totalInSet : 1;
  const percent = (raw / safeTotal) * 100;
  let finalScore = Math.round(percent);
  const maxCap = config.enabled ? config.maxSubjectScoreCap : 100;
  const minCap = config.enabled ? config.minSubjectScoreCap : 0;
  if (finalScore > maxCap) finalScore = maxCap;
  if (finalScore < minCap) finalScore = minCap;
  return finalScore;
}
