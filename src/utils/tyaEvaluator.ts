import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AttemptedQuestionItem,
  CategoryType,
  ExamResult,
  ExamSettings,
  Question,
  QuestionType,
} from '../types';
import { drawOfficialSeal } from './pdfSlipGenerator';

export const SAMPLE_MCQ_BULK_TEXT = `1. Crossing over in meiosis occurs where
A. Prophase I ✅
B. Anaphase
C. Metaphase
D. Prophase II

2. Which organelle is known as the powerhouse of the cell?
A. Nucleus
B. Mitochondria ✅
C. Ribosome
D. Golgi apparatus

3. What is the functional unit of the mammalian kidney?
A. Alveolus
B. Neuron
C. Nephron ✅
D. Villus

4. Which plant hormone is primarily responsible for apical dominance and phototropism?
A. Auxin ✅
B. Gibberellin
C. Cytokinin
D. Abscisic acid

5. Which blood vessel carries oxygenated blood from the lungs to the heart?
A. Pulmonary artery
B. Vena cava
C. Aorta
D. Pulmonary vein ✅`;

export const SAMPLE_20_BIOLOGY_TYA_6COL_TEXT = `1 | TYA | Which part of the nephron is mainly responsible for ultrafiltration of blood? | Glomerulus | 1 | YES
2 | TYA | In which stage of mitosis do chromosomes align at the equator of the cell? | Metaphase | 1 | YES
3 | TYA | Which enzyme converts starch into maltose? | Amylase | 1 | YES
4 | TYA | What is the process by which green plants lose water vapour through their leaves called? | Transpiration | 1 | YES
5 | TYA | Which vitamin is essential for the clotting of blood? | Vitamin K | 1 | YES
6 | TYA | What is the respiratory pigment found in human red blood cells? | Hemoglobin | Haemoglobin | 1 | YES
7 | TYA | Which organelle is present in plant cells that gives them rigidity and is absent in animal cells? | Cell wall | Cellulose cell wall | 1 | YES
8 | TYA | What is the name of the process by which atmospheric nitrogen is converted into usable nitrogen compounds by bacteria? | Nitrogen fixation | 1 | YES
9 | TYA | Which part of the human brain controls posture and balance? | Cerebellum | 1 | YES
10 | TYA | What is the hormone secreted by the pancreas that lowers blood glucose level? | Insulin | 1 | YES
11 | TYA | What type of movement of water molecules across a selectively permeable membrane from a dilute solution to a concentrated solution is called? | Osmosis | 1 | YES
12 | TYA | Which structure in flowering plants produces pollen grains? | Anther | 1 | YES
13 | TYA | What is the powerhouse of the cell? | Mitochondria | Mitochondrion | 1 | YES
14 | TYA | Which type of blood circulation occurs in mammals where blood passes through the heart twice in one complete circuit? | Double circulation | 1 | YES
15 | TYA | What is the ecological relationship in which both organisms benefit from each other called? | Mutualism | Symbiosis | 1 | YES
16 | TYA | Which plant hormone is mainly responsible for cell elongation and phototropism? | Auxin | Auxins | Indole-3-acetic acid | 1 | YES
17 | TYA | What is the name of the blood vessel that carries oxygenated blood from the lungs to the heart? | Pulmonary vein | 1 | YES
18 | TYA | Which pigment gives colour to human skin and protects it from ultraviolet radiation? | Melanin | 1 | YES
19 | TYA | What is the flap of cartilage that prevents food from entering the trachea during swallowing? | Epiglottis | 1 | YES
20 | TYA | Where does the light-dependent stage of photosynthesis take place inside the chloroplast? | Thylakoid membranes | Thylakoid membrane | Grana | 1 | YES`;

/**
 * Parse a string of answer keys separated by | or ; (or comma if not part of a phrase)
 */
export function parseAnswerKeys(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  const delimiter = raw.includes('|')
    ? '|'
    : raw.includes(';')
    ? ';'
    : ',';
  return raw
    .split(delimiter)
    .map((k) => k.trim().replace(/\.$/, '').trim())
    .filter(Boolean);
}

/**
 * Normalize text for Step 1 Exact Match:
 * trim, lowercase, remove extra spaces and trailing punctuation
 */
export function normalizeTyaString(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/[.,;!?'"()[\]]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Step 1: Exact Match (No AI needed)
 * Compares normalized candidate answer against all normalized answer keys
 */
export function evaluateTyaExactMatch(
  candidateAnswer: string,
  answerKeys: string[]
): {
  matched: boolean;
  matchedKey?: string;
  explanation: string;
} {
  const normCand = normalizeTyaString(candidateAnswer);
  const officialKeysStr = (answerKeys || []).filter(Boolean).join(' | ');

  if (!normCand) {
    return {
      matched: false,
      explanation: `No answer typed by candidate. Expected Answer Key: ${officialKeysStr || 'N/A'}.`,
    };
  }

  for (const key of answerKeys || []) {
    const normKey = normalizeTyaString(key);
    if (!normKey) continue;
    if (
      normCand === normKey ||
      normCand + 's' === normKey ||
      normKey + 's' === normCand
    ) {
      return {
        matched: true,
        matchedKey: key,
        explanation: `Exact match with official answer key ("${key}").`,
      };
    }
  }

  return {
    matched: false,
    explanation: '',
  };
}

export interface TyaEvaluationBatchRequestItem {
  id: string;
  question?: string;
  questionText?: string;
  answer_keys?: string[];
  answerKeys?: string[];
  candidate_answer?: string;
  typedAnswer?: string;
  mark?: number;
  allowAiEval?: boolean;
}

export interface TyaEvaluationResponseItem {
  id?: string;
  is_correct: boolean;
  isCorrect?: boolean;
  confidence: number;
  aiConfidence?: number;
  explanation: string;
  aiExplanation?: string;
  aiEvaluated?: boolean;
  correct_answer: string;
}

/**
 * Step 2: AI Evaluation via backend /api/evaluate-tya
 */
export async function evaluateTyaBatchWithServer(
  items: TyaEvaluationBatchRequestItem[],
  enableAiEval = true
): Promise<Record<string, TyaEvaluationResponseItem>> {
  if (!items || items.length === 0) return {};

  const normalizedItems = items.map((item) => ({
    id: item.id,
    question: item.question || item.questionText || '',
    answer_keys: item.answer_keys || item.answerKeys || [],
    candidate_answer: item.candidate_answer ?? item.typedAnswer ?? '',
    allowAiEval: item.allowAiEval !== false && enableAiEval,
  }));

  try {
    const res = await fetch('/api/evaluate-tya', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: normalizedItems, enableAiEval }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        const map: Record<string, TyaEvaluationResponseItem> = {};
        data.results.forEach((r: any) => {
          if (r && r.id) {
            const isCorr = Boolean(r.is_correct ?? r.isCorrect);
            const expl = r.explanation || r.aiExplanation || '';
            const conf = typeof r.confidence === 'number' ? r.confidence : 0.9;
            map[r.id] = {
              id: r.id,
              is_correct: isCorr,
              isCorrect: isCorr,
              confidence: conf,
              aiConfidence: conf,
              explanation: expl,
              aiExplanation: expl,
              aiEvaluated: Boolean(r.aiEvaluated ?? true),
              correct_answer: r.correct_answer || '',
            };
          }
        });
        return map;
      }
    }
  } catch {
    // Fallback below if network request fails
  }

  // Client fallback if offline
  const fallbackMap: Record<string, TyaEvaluationResponseItem> = {};
  normalizedItems.forEach((item) => {
    const exact = evaluateTyaExactMatch(item.candidate_answer, item.answer_keys);
    const official = item.answer_keys.join(' | ');
    const expl = exact.matched
      ? exact.explanation
      : `Candidate answered "${item.candidate_answer || 'None'}". Official answer key: ${official}.`;
    fallbackMap[item.id] = {
      id: item.id,
      is_correct: exact.matched,
      isCorrect: exact.matched,
      confidence: exact.matched ? 1 : 0.85,
      aiConfidence: exact.matched ? 1 : 0.85,
      explanation: expl,
      aiExplanation: expl,
      aiEvaluated: false,
      correct_answer: official,
    };
  });
  return fallbackMap;
}

/**
/**
 * Helper to detect checkmark/correct marker on an option (e.g. "Prophase I ✅", "Prophase I ✓", "Prophase I (correct)")
 * and return cleaned option text + boolean flag.
 */
function extractOptionTextAndCorrectness(rawOpt: string): {
  cleanText: string;
  isCorrect: boolean;
} {
  const raw = (rawOpt || '').trim();
  const hasCheckmark =
    /[✅✓✔☑]/.test(raw) ||
    /\(\s*correct\s*\)|\[\s*correct\s*\]/i.test(raw) ||
    /<--+/.test(raw) ||
    /\s+\*+$/.test(raw);

  const cleanText = raw
    .replace(/[✅✓✔☑]/g, '')
    .replace(/\(\s*correct\s*\)|\[\s*correct\s*\]/gi, '')
    .replace(/<--+/g, '')
    .replace(/\s+\*+$/, '')
    .trim();

  return {
    cleanText: cleanText || raw,
    isCorrect: hasCheckmark,
  };
}

/**
 * Parse inline options like "(A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4" or "A. Opt1 B. Opt2 C. Opt3 D. Opt4"
 */
function parseInlineMcqOptionsWithCorrect(rawOptions: string): {
  options: [string, string, string, string];
  detectedCorrectIndex: number | null;
} {
  const text = (rawOptions || '').trim();
  let rawList: string[] = [];

  const regexParens =
    /\(A\)\s*(.*?)\s*\(B\)\s*(.*?)\s*\(C\)\s*(.*?)\s*\(D\)\s*(.*?)(?:\s*\([EF]\).*)?$/i;
  const matchParens = text.match(regexParens);
  if (matchParens) {
    rawList = [matchParens[1], matchParens[2], matchParens[3], matchParens[4]];
  } else {
    const regexDots =
      /\bA[.)]\s*(.*?)\s+\bB[.)]\s*(.*?)\s+\bC[.)]\s*(.*?)\s+\bD[.)]\s*(.*?)(?:\s+\b[EF][.)].*)?$/i;
    const matchDots = text.match(regexDots);
    if (matchDots) {
      rawList = [matchDots[1], matchDots[2], matchDots[3], matchDots[4]];
    } else {
      rawList = text
        .split(/[;,]/)
        .map((p) => p.replace(/^\(?[A-F][).]\s*/i, '').trim())
        .filter(Boolean);
    }
  }

  let detectedCorrectIndex: number | null = null;
  const cleanedOptions = [0, 1, 2, 3].map((idx) => {
    const item = rawList[idx] || `Option ${String.fromCharCode(65 + idx)}`;
    const { cleanText, isCorrect } = extractOptionTextAndCorrectness(item);
    if (isCorrect && detectedCorrectIndex === null) {
      detectedCorrectIndex = idx;
    }
    return cleanText;
  }) as [string, string, string, string];

  return {
    options: cleanedOptions,
    detectedCorrectIndex,
  };
}

function parseInlineMcqOptions(rawOptions: string): [string, string, string, string] {
  return parseInlineMcqOptionsWithCorrect(rawOptions).options;
}

function letterToOptionIndex(rawLetter: string): number {
  const clean = (rawLetter || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-F0-3]/g, '');
  if (clean === 'B' || clean === '1') return 1;
  if (clean === 'C' || clean === '2') return 2;
  if (clean === 'D' || clean === '3') return 3;
  return 0;
}

/**
 * Parse multi-line MCQ questions where each question has A/B/C/D option lines
 * and the correct option is marked with ✅ (or ✓, ✔, *, (correct)) or an "Answer: A" line.
 * Example:
 * 1. Crossing over in meiosis occurs where
 * A. Prophase I ✅
 * B. Anaphase
 * C. Metaphase
 * D. Prophase II
 */
function parseMultilineMcqBlocks(
  rawText: string,
  subject: string,
  category: CategoryType | 'All' = 'All',
  bankId?: string
): Question[] {
  const lines = (rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim());

  const results: Question[] = [];
  let currentQuestionLines: string[] = [];
  let currentOptions: { letter: string; text: string; isCorrect: boolean }[] = [];
  let explicitAnswerLetter: string | null = null;
  let currentMark = 1;

  const flushCurrentMcq = (idxSeed: number) => {
    const questionText = currentQuestionLines
      .join(' ')
      .replace(/^(?:Q(?:uestion)?\s*)?\d+[.):-]\s*/i, '')
      .trim();

    if (questionText && currentOptions.length >= 2) {
      const optMap: Record<string, { text: string; isCorrect: boolean }> = {};
      currentOptions.forEach((o) => {
        optMap[o.letter.toUpperCase()] = { text: o.text, isCorrect: o.isCorrect };
      });

      const letters = ['A', 'B', 'C', 'D'];
      const finalOptions = letters.map((letter, idx) => {
        if (optMap[letter]) return optMap[letter].text;
        if (currentOptions[idx]) return currentOptions[idx].text;
        return `Option ${letter}`;
      }) as [string, string, string, string];

      let correctIndex = 0;
      const markedIdx = letters.findIndex((l) => optMap[l]?.isCorrect);
      if (markedIdx !== -1) {
        correctIndex = markedIdx;
      } else {
        const fallbackMarkedIdx = currentOptions.findIndex((o) => o.isCorrect);
        if (fallbackMarkedIdx !== -1 && fallbackMarkedIdx < 4) {
          correctIndex = fallbackMarkedIdx;
        } else if (explicitAnswerLetter) {
          correctIndex = letterToOptionIndex(explicitAnswerLetter);
        }
      }

      results.push({
        id: `q-mcq-${Date.now()}-${idxSeed}-${results.length}`,
        subject,
        bankId,
        category,
        questionType: 'MCQ',
        questionText,
        options: finalOptions,
        correctAnswer: correctIndex,
        mark: currentMark,
        allowAiEval: false, // No AI evaluation needed for MCQ
      });
    }

    currentQuestionLines = [];
    currentOptions = [];
    explicitAnswerLetter = null;
    currentMark = 1;
  };

  lines.forEach((line, lineIdx) => {
    if (!line) {
      if (currentQuestionLines.length > 0 && currentOptions.length >= 2) {
        flushCurrentMcq(lineIdx);
      }
      return;
    }

    // Check if line is an explicit answer key line like "Answer: A" or "Correct Answer: B"
    const answerLineMatch = line.match(
      /^(?:correct\s*answer|answer\s*key|answer|ans|key)\s*[:=-]\s*\(?([A-Da-d])\)?(?:\b|$)/i
    );
    if (answerLineMatch && currentQuestionLines.length > 0) {
      explicitAnswerLetter = answerLineMatch[1].toUpperCase();
      if (currentOptions.length >= 2) {
        flushCurrentMcq(lineIdx);
      }
      return;
    }

    // Check if line is an option line: "A. Prophase I ✅", "(A) Prophase I", "A) Prophase I", "A - Prophase I"
    const optionMatch = line.match(
      /^(?:\(([A-Fa-f])\)|([A-Fa-f])[.):-]\s+)(.+)$/
    );
    if (optionMatch) {
      const letter = (optionMatch[1] || optionMatch[2] || 'A').toUpperCase();
      const rawOptBody = optionMatch[3].trim();

      // If this is option 'A' and we already had >= 2 options for a previous question, flush first
      if (letter === 'A' && currentOptions.length >= 2) {
        flushCurrentMcq(lineIdx);
      }

      const { cleanText, isCorrect } = extractOptionTextAndCorrectness(rawOptBody);
      currentOptions.push({
        letter,
        text: cleanText,
        isCorrect,
      });
      return;
    }

    // Check if a single line contains inline options A. ... B. ... C. ... D. ...
    if (/\bA[.)]\s+.+\bB[.)]\s+.+\bC[.)]\s+/i.test(line) || /\(A\)\s*.+\(B\)\s*.+\(C\)/i.test(line)) {
      const { options, detectedCorrectIndex } = parseInlineMcqOptionsWithCorrect(line);
      ['A', 'B', 'C', 'D'].forEach((letter, idx) => {
        currentOptions.push({
          letter,
          text: options[idx],
          isCorrect: detectedCorrectIndex === idx,
        });
      });
      return;
    }

    // Otherwise it's a question line (either start of a new question or continuation of stem)
    if (currentOptions.length >= 2) {
      flushCurrentMcq(lineIdx);
    }

    currentQuestionLines.push(line);
  });

  if (currentQuestionLines.length > 0 && currentOptions.length >= 2) {
    flushCurrentMcq(lines.length);
  }

  return results;
}

/**
 * Bulk Question Parser supporting:
 * 1. Multi-line MCQ format (No |MCQ| needed, no AI evaluation needed):
 *    1. Crossing over in meiosis occurs where
 *    A. Prophase I ✅
 *    B. Anaphase
 *    C. Metaphase
 *    D. Prophase II
 * 2. Format A (Pipe MCQ — with or without |MCQ| column):
 *    QNo | MCQ | Question | Options (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | Answer Key (e.g., C) | Mark (e.g., 1)
 * 3. Format B (Pipe TYA — with or without |TYA| column):
 *    QNo | TYA | Question | Answer Key(s) (can contain |) | Mark | AI Evaluation (YES/NO)
 * 4. Numbered TYA list format:
 *    1. Which part of the nephron is mainly responsible for ultrafiltration of blood?
 *    Answer key: Glomerulus.
 */
export function parseBulkQuestionsInput(
  rawText: string,
  subject: string,
  category: CategoryType | 'All' = 'All',
  bankId?: string,
  selectedFormat: QuestionType = 'MCQ'
): Question[] {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return [];

  const parsedQuestions: Question[] = [];
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Check if input has multi-line MCQ option lines (A. ..., B. ..., C. ..., D. ...) without pipe delimiters
  const hasOptionLines = lines.some(
    (l) => !l.includes('|') && /^(?:\([A-Da-d]\)|[A-Da-d][.):-]\s+).+/.test(l)
  );

  if (hasOptionLines && (selectedFormat === 'MCQ' || !lines.some((l) => l.includes('|')))) {
    const multilineMcq = parseMultilineMcqBlocks(trimmed, subject, category, bankId);
    if (multilineMcq.length > 0) {
      return multilineMcq;
    }
  }

  // Check if input uses pipe-delimited rows
  const hasPipeRows = lines.some((l) => l.includes('|'));

  if (hasPipeRows) {
    lines.forEach((line, idx) => {
      if (!line.includes('|')) return;
      const rawCols = line.split('|').map((c) => c.trim());
      if (rawCols.length < 2) return;

      // Detect Column 2 TYPE (e.g. "TYA", "TYPE=TYA", "MCQ", "TYPE=MCQ")
      const col1Upper = (rawCols[1] || '')
        .toUpperCase()
        .replace(/^TYPE\s*=\s*/i, '')
        .trim();

      const isExplicitTya = col1Upper === 'TYA';
      const isExplicitMcq = col1Upper === 'MCQ';

      if (isExplicitTya || (!isExplicitMcq && selectedFormat === 'TYA')) {
        // Format B - TYA (Supports both with "| TYA |" and without "| TYA |"):
        // With | TYA |: QNo | TYA | Question | Answer Key(s) | Mark | AI Evaluation
        // Without | TYA |:
        //   Case 1 (starts with QNo number): 1 | Question | Answer Key(s) | Mark | AI Evaluation
        //   Case 2 (starts directly with Question): Question | Answer Key(s) | Mark | AI Evaluation
        let questionColIdx = 2;
        if (!isExplicitTya) {
          const firstColIsNumber = /^\d+[.)]?$/.test(rawCols[0]);
          questionColIdx = firstColIsNumber ? 1 : 0;
        }

        const questionText = (rawCols[questionColIdx] || '').replace(/^\d+[.)]\s*/, '').trim();
        if (!questionText) return;

        let allowAiEval = true;
        let mark = 1;
        let answerKeyEndIdx = rawCols.length;
        const minColsForMeta = questionColIdx + 3;

        const lastCol = rawCols[rawCols.length - 1]
          .toUpperCase()
          .replace(/^AI\s*EVALUATION\s*=\s*/i, '')
          .trim();

        if (
          ['YES', 'NO', 'TRUE', 'FALSE', 'Y', 'N', '1', '0'].includes(lastCol) &&
          rawCols.length >= minColsForMeta
        ) {
          allowAiEval = ['YES', 'TRUE', 'Y', '1'].includes(lastCol);
          answerKeyEndIdx = rawCols.length - 1;

          const secondLastCol = rawCols[rawCols.length - 2]
            .replace(/^MARK\s*=\s*/i, '')
            .trim();
          const parsedMark = Number(secondLastCol);
          if (
            !Number.isNaN(parsedMark) &&
            parsedMark > 0 &&
            rawCols.length >= minColsForMeta + 1
          ) {
            mark = parsedMark;
            answerKeyEndIdx = rawCols.length - 2;
          }
        } else {
          const parsedLastMark = Number(
            rawCols[rawCols.length - 1].replace(/^MARK\s*=\s*/i, '').trim()
          );
          if (
            !Number.isNaN(parsedLastMark) &&
            parsedLastMark > 0 &&
            rawCols.length >= minColsForMeta
          ) {
            mark = parsedLastMark;
            answerKeyEndIdx = rawCols.length - 1;
          }
        }

        const answerStartIdx = questionColIdx + 1;
        const answerKeySlice = rawCols.slice(answerStartIdx, answerKeyEndIdx).filter(Boolean);
        const answerKeys: string[] = [];
        answerKeySlice.forEach((segment) => {
          parseAnswerKeys(segment).forEach((k) => {
            if (!answerKeys.some((existing) => existing.toLowerCase() === k.toLowerCase())) {
              answerKeys.push(k);
            }
          });
        });

        if (answerKeys.length === 0 && rawCols[answerStartIdx]) {
          answerKeys.push(rawCols[answerStartIdx].replace(/\.$/, '').trim());
        }

        if (answerKeys.length === 0) return;

        parsedQuestions.push({
          id: `q-tya-${Date.now()}-${idx}`,
          subject,
          bankId,
          category,
          questionType: 'TYA',
          questionText,
          options: [
            answerKeys[0] || 'Type your answer',
            answerKeys[1] || '',
            answerKeys[2] || '',
            '',
          ],
          correctAnswer: 0,
          answerKeys,
          mark,
          allowAiEval,
        });
        return;
      }

      if (isExplicitMcq) {
        // Format A - MCQ with explicit | MCQ | column:
        // Case 1 (6 columns): QNo | MCQ | Question | (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | Answer Key | Mark
        // Case 2 (8-9 columns): QNo | MCQ | Question | OptA | OptB | OptC | OptD | Answer Key | Mark
        const questionText = rawCols[2] || '';
        if (!questionText) return;

        let options: [string, string, string, string] = [
          'Option A',
          'Option B',
          'Option C',
          'Option D',
        ];
        let correctAnswer = 0;
        let mark = 1;

        if (rawCols.length >= 7 && !/\([A-D]\)|\bA[.)]/i.test(rawCols[3] || '')) {
          let detectedFromCheckmark: number | null = null;
          const extracted = [rawCols[3], rawCols[4], rawCols[5], rawCols[6]].map(
            (optStr, oIdx) => {
              const { cleanText, isCorrect } = extractOptionTextAndCorrectness(
                optStr || `Option ${String.fromCharCode(65 + oIdx)}`
              );
              if (isCorrect && detectedFromCheckmark === null) {
                detectedFromCheckmark = oIdx;
              }
              return cleanText;
            }
          ) as [string, string, string, string];
          options = extracted;
          correctAnswer =
            detectedFromCheckmark !== null
              ? detectedFromCheckmark
              : letterToOptionIndex(rawCols[7] || 'A');
          mark = Number(rawCols[8]) || 1;
        } else {
          const { options: parsedOpts, detectedCorrectIndex } =
            parseInlineMcqOptionsWithCorrect(rawCols[3] || '');
          options = parsedOpts;
          correctAnswer =
            detectedCorrectIndex !== null
              ? detectedCorrectIndex
              : letterToOptionIndex(rawCols[4] || 'A');
          mark = Number(rawCols[5]) || 1;
        }

        parsedQuestions.push({
          id: `q-mcq-${Date.now()}-${idx}`,
          subject,
          bankId,
          category,
          questionType: 'MCQ',
          questionText,
          options,
          correctAnswer,
          mark,
          allowAiEval: false,
        });
        return;
      }

      // Pipe MCQ format WITHOUT typing | MCQ |:
      // Supports:
      // 1) QNo | Question | (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | AnswerKey | Mark
      // 2) Question | (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | AnswerKey | Mark
      // 3) QNo | Question | OptA | OptB | OptC | OptD | [AnswerKey] | [Mark] (also supports ✅ on any option)
      // 4) Question | OptA | OptB | OptC | OptD | [AnswerKey] | [Mark]
      const firstIsQNo = /^\d+[.)]?$/.test(rawCols[0]);
      const qColIdx = firstIsQNo ? 1 : 0;
      const questionText = (rawCols[qColIdx] || '').replace(/^\d+[.)]\s*/, '').trim();
      if (!questionText) return;

      const nextCol = rawCols[qColIdx + 1] || '';
      const isInlineOptions =
        /\([A-D]\)/i.test(nextCol) || /\bA[.)]\s+.+\bB[.)]/i.test(nextCol);

      if (isInlineOptions) {
        const { options, detectedCorrectIndex } =
          parseInlineMcqOptionsWithCorrect(nextCol);
        const ansCol = rawCols[qColIdx + 2] || 'A';
        const markCol = rawCols[qColIdx + 3];
        parsedQuestions.push({
          id: `q-mcq-${Date.now()}-${idx}`,
          subject,
          bankId,
          category,
          questionType: 'MCQ',
          questionText,
          options,
          correctAnswer:
            detectedCorrectIndex !== null
              ? detectedCorrectIndex
              : letterToOptionIndex(ansCol),
          mark: Number(markCol) || 1,
          allowAiEval: false,
        });
      } else if (rawCols.length >= qColIdx + 5) {
        let detectedFromCheckmark: number | null = null;
        const options = [0, 1, 2, 3].map((oIdx) => {
          const rawOpt = rawCols[qColIdx + 1 + oIdx] || `Option ${String.fromCharCode(65 + oIdx)}`;
          const { cleanText, isCorrect } = extractOptionTextAndCorrectness(rawOpt);
          if (isCorrect && detectedFromCheckmark === null) {
            detectedFromCheckmark = oIdx;
          }
          return cleanText;
        }) as [string, string, string, string];

        const ansCol = rawCols[qColIdx + 5] || 'A';
        const markCol = rawCols[qColIdx + 6];
        parsedQuestions.push({
          id: `q-mcq-${Date.now()}-${idx}`,
          subject,
          bankId,
          category,
          questionType: 'MCQ',
          questionText,
          options,
          correctAnswer:
            detectedFromCheckmark !== null
              ? detectedFromCheckmark
              : letterToOptionIndex(ansCol),
          mark: Number(markCol) || 1,
          allowAiEval: false,
        });
      }
    });

    if (parsedQuestions.length > 0) {
      return parsedQuestions;
    }
  }

  // Fallback for multi-line MCQ blocks if not already matched
  const multilineMcqFallback = parseMultilineMcqBlocks(trimmed, subject, category, bankId);
  if (multilineMcqFallback.length > 0) {
    return multilineMcqFallback;
  }

  // Also support numbered TYA blocks like:
  // "1. Which part of the nephron is mainly responsible for ultrafiltration of blood?
  // Answer key: Glomerulus."
  let currentQuestionText = '';
  lines.forEach((line, idx) => {
    const answerMatch = line.match(/^(?:answer\s*key|answer|ans)\s*[:=-]\s*(.+)$/i);
    if (answerMatch && currentQuestionText) {
      const rawKeyStr = answerMatch[1].trim().replace(/\.$/, '').trim();
      const answerKeys = parseAnswerKeys(rawKeyStr);
      parsedQuestions.push({
        id: `q-tya-num-${Date.now()}-${idx}`,
        subject,
        bankId,
        category,
        questionType: 'TYA',
        questionText: currentQuestionText.replace(/^\d+[.)]\s*/, '').trim(),
        options: [
          answerKeys[0] || rawKeyStr,
          answerKeys[1] || '',
          answerKeys[2] || '',
          '',
        ],
        correctAnswer: 0,
        answerKeys: answerKeys.length > 0 ? answerKeys : [rawKeyStr],
        mark: 1,
        allowAiEval: true,
      });
      currentQuestionText = '';
    } else if (/^\d+[.)]\s+/.test(line)) {
      currentQuestionText = line.replace(/^\d+[.)]\s+/, '').trim();
    } else if (currentQuestionText) {
      currentQuestionText += ' ' + line;
    }
  });

  return parsedQuestions;
}

/**
 * Resolve AttemptedQuestionItem[] from an ExamResult (or fallback to Question pool)
 */
export function resolveAttemptedItemsForResult(
  result: ExamResult,
  allQuestions: Question[]
): AttemptedQuestionItem[] {
  if (result.attemptedRecord && result.attemptedRecord.length > 0) {
    return result.attemptedRecord;
  }

  const subjects = Object.keys(result.subjectBreakdown || {});
  const pool = allQuestions.filter((q) =>
    subjects.length > 0 ? subjects.includes(q.subject) : true
  );

  return pool.slice(0, result.totalQuestions || 20).map((q, idx) => {
    const isTya = q.questionType === 'TYA';
    const keys =
      q.answerKeys && q.answerKeys.length > 0
        ? q.answerKeys
        : [q.options[q.correctAnswer] || q.options[0] || ''];
    return {
      id: q.id,
      subject: q.subject,
      questionNumber: idx + 1,
      questionText: q.questionText,
      options: q.options,
      selectedAnswer: isTya ? null : q.correctAnswer,
      correctAnswer: q.correctAnswer,
      questionType: isTya ? 'TYA' : 'MCQ',
      typedAnswer: isTya ? keys[0] : undefined,
      answerKeys: isTya ? keys : undefined,
      isCorrect: true,
      aiEvaluated: isTya,
      aiExplanation: isTya
        ? `Candidate answer matches official answer key (${keys.join(' | ')}).`
        : undefined,
      marksAwarded: q.mark || 1,
      maxMarks: q.mark || 1,
    };
  });
}

/**
 * Download Attempt PDF with jspdf-autotable:
 * For TYA questions, shows Question, Candidate Answer, Answer Key, AI Evaluation (CORRECT/WRONG), Marks,
 * and adds an extra row below the question for AI Explanation in italic gray!
 */
export function downloadAttemptWithAiExplanationsPdf(
  result: ExamResult,
  settings: ExamSettings,
  allQuestions: Question[]
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const brandGreen: [number, number, number] = [10, 107, 60];

  // Top Header Banner
  doc.setFillColor(...brandGreen);
  doc.rect(0, 0, pageWidth, 34, 'F');
  drawOfficialSeal(doc, 22, 17, 9);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('QUEMINT EDUCATION BOARD — CANDIDATE ATTEMPT & AI EVALUATION REPORT', 35, 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `Candidate: ${result.candidateName}   |   Reg No: ${result.regNumber}   |   Category: ${result.category}`,
    35,
    20
  );
  doc.text(
    `Exam: ${result.testTitle || settings.resultTitles?.testSubtitle || 'CBT Examination'} (${result.testCode || settings.testAccessCode || 'QMT'})   |   Aggregate: ${result.score} (${result.percentage}%)`,
    35,
    26.5
  );

  const items = resolveAttemptedItemsForResult(result, allQuestions);

  // Build table rows: For TYA questions, add an extra row directly below in italic gray for AI Explanation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodyRows: any[] = [];

  items.forEach((item, idx) => {
    const qNo = item.questionNumber || idx + 1;
    const isTya = item.questionType === 'TYA';
    const maxMark = item.maxMarks || 1;

    if (isTya) {
      const isCorr = Boolean(item.isCorrect);
      const awarded = typeof item.marksAwarded === 'number' ? item.marksAwarded : isCorr ? maxMark : 0;
      const candAns = (item.typedAnswer || '').trim() || 'No Answer Typed';
      const ansKey =
        item.answerKeys && item.answerKeys.length > 0
          ? item.answerKeys.join(' / ')
          : item.options?.[0] || 'N/A';
      const aiEvalLabel = isCorr
        ? item.aiEvaluated
          ? 'CORRECT (AI Verified Equivalence)'
          : 'CORRECT (Exact Match)'
        : 'WRONG';

      bodyRows.push([
        `Q${qNo}\n[TYA]`,
        `${item.subject}\n${item.questionText}`,
        candAns,
        ansKey,
        aiEvalLabel,
        `${awarded}/${maxMark}`,
      ]);

      const explanationText =
        item.aiExplanation ||
        (isCorr
          ? `Your answer "${candAns}" is scientifically accurate and equivalent to ${ansKey}.`
          : `Expected "${ansKey}". "${candAns}" is not scientifically equivalent.`);

      // Extra row below TYA question for AI Explanation in italic gray
      bodyRows.push([
        {
          content: `AI Explanation (Q${qNo}): "${explanationText}"`,
          colSpan: 6,
          styles: {
            fontStyle: 'italic',
            textColor: [95, 95, 95],
            fillColor: [248, 250, 249],
            fontSize: 8,
            cellPadding: { top: 2, bottom: 2.5, left: 6, right: 4 },
          },
        },
      ]);
    } else {
      const letters = ['A', 'B', 'C', 'D'];
      const isCorr =
        typeof item.isCorrect === 'boolean'
          ? item.isCorrect
          : item.selectedAnswer === item.correctAnswer;
      const awarded = typeof item.marksAwarded === 'number' ? item.marksAwarded : isCorr ? maxMark : 0;
      const selStr =
        item.selectedAnswer !== null && item.selectedAnswer !== undefined
          ? `(${letters[item.selectedAnswer]}) ${item.options?.[item.selectedAnswer] || ''}`
          : 'Unanswered';
      const corStr = `(${letters[item.correctAnswer]}) ${item.options?.[item.correctAnswer] || ''}`;

      bodyRows.push([
        `Q${qNo}\n[MCQ]`,
        `${item.subject}\n${item.questionText}`,
        selStr,
        corStr,
        isCorr ? 'CORRECT' : 'WRONG',
        `${awarded}/${maxMark}`,
      ]);
    }
  });

  autoTable(doc, {
    startY: 40,
    head: [
      [
        'QNo / Type',
        'Subject & Question',
        'Candidate Answer',
        'Answer Key',
        'AI / Marking Status',
        'Marks',
      ],
    ],
    body: bodyRows,
    theme: 'grid',
    headStyles: {
      fillColor: brandGreen,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
    },
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [20, 20, 20],
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 18, fontStyle: 'bold' },
      1: { cellWidth: 62 },
      2: { cellWidth: 34 },
      3: { cellWidth: 34 },
      4: { cellWidth: 26, fontStyle: 'bold' },
      5: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 4 && data.cell.raw) {
        const text = String(data.cell.raw);
        if (text.startsWith('CORRECT')) {
          data.cell.styles.textColor = [10, 107, 60];
        } else if (text.startsWith('WRONG')) {
          data.cell.styles.textColor = [200, 30, 30];
        }
      }
    },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Generated by Quemint CBT Platform • Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 7,
      { align: 'center' }
    );
  }

  const safeReg = (result.regNumber || 'Candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Quemint_Attempt_AI_Report_${safeReg}.pdf`);
}

/**
 * Download Attempt Excel (CSV) with columns:
 * QNo, Question, Type, Candidate Typed Answer, Answer Key, AI Correct (YES/NO), Marks, AI Explanation
 */
export function downloadAttemptWithAiExplanationsExcelCsv(
  result: ExamResult,
  allQuestions: Question[]
) {
  const items = resolveAttemptedItemsForResult(result, allQuestions);
  const headers = [
    'QNo',
    'Subject',
    'Question',
    'Type',
    'Candidate Typed Answer',
    'Answer Key',
    'AI Correct (YES/NO)',
    'Marks',
    'AI Explanation',
  ];

  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '').replace(/"/g, '""');
    return `"${str}"`;
  };

  const letters = ['A', 'B', 'C', 'D'];
  const rows = items.map((item, idx) => {
    const qNo = item.questionNumber || idx + 1;
    const isTya = item.questionType === 'TYA';
    const maxMark = item.maxMarks || 1;
    const isCorr =
      typeof item.isCorrect === 'boolean'
        ? item.isCorrect
        : item.selectedAnswer === item.correctAnswer;
    const awarded =
      typeof item.marksAwarded === 'number'
        ? item.marksAwarded
        : isCorr
        ? maxMark
        : 0;

    const candAnswer = isTya
      ? (item.typedAnswer || '').trim() || 'No Answer'
      : item.selectedAnswer !== null && item.selectedAnswer !== undefined
      ? `(${letters[item.selectedAnswer]}) ${item.options?.[item.selectedAnswer] || ''}`
      : 'Unanswered';

    const answerKey = isTya
      ? item.answerKeys && item.answerKeys.length > 0
        ? item.answerKeys.join(' | ')
        : item.options?.[0] || ''
      : `(${letters[item.correctAnswer]}) ${item.options?.[item.correctAnswer] || ''}`;

    const aiExplanation = isTya
      ? item.aiExplanation ||
        (isCorr
          ? 'Scientifically accurate and equivalent to official answer key.'
          : `Does not match expected answer (${answerKey}).`)
      : isCorr
      ? 'Selected correct MCQ option.'
      : `Selected option does not match ${answerKey}.`;

    return [
      qNo,
      item.subject,
      item.questionText,
      isTya ? 'TYA' : 'MCQ',
      candAnswer,
      answerKey,
      isCorr ? 'YES' : 'NO',
      `${awarded}/${maxMark}`,
      aiExplanation,
    ]
      .map(escapeCsv)
      .join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeReg = (result.regNumber || 'Candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
  a.href = url;
  a.download = `Quemint_Attempt_AI_Evaluation_${safeReg}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
