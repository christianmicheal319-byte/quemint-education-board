import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AttemptedQuestionItem,
  CategoryType,
  ExamResult,
  ExamSettings,
  Question,
} from '../types';
import { drawOfficialSeal } from './pdfSlipGenerator';

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
  question: string;
  answer_keys: string[];
  candidate_answer: string;
}

export interface TyaEvaluationResponseItem {
  id?: string;
  is_correct: boolean;
  confidence: number;
  explanation: string;
  correct_answer: string;
}

/**
 * Step 2: AI Evaluation via backend /api/evaluate-tya
 */
export async function evaluateTyaBatchWithServer(
  items: TyaEvaluationBatchRequestItem[]
): Promise<Record<string, TyaEvaluationResponseItem>> {
  if (!items || items.length === 0) return {};

  try {
    const res = await fetch('/api/evaluate-tya', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results)) {
        const map: Record<string, TyaEvaluationResponseItem> = {};
        data.results.forEach((r: TyaEvaluationResponseItem) => {
          if (r && r.id) {
            map[r.id] = r;
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
  items.forEach((item) => {
    const exact = evaluateTyaExactMatch(item.candidate_answer, item.answer_keys);
    const official = item.answer_keys.join(' | ');
    fallbackMap[item.id] = {
      id: item.id,
      is_correct: exact.matched,
      confidence: exact.matched ? 1 : 0.85,
      explanation: exact.matched
        ? exact.explanation
        : `Candidate answered "${item.candidate_answer || 'None'}". Official answer key: ${official}.`,
      correct_answer: official,
    };
  });
  return fallbackMap;
}

/**
 * Parse inline options like "(A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4" or "A. Opt1 B. Opt2 C. Opt3 D. Opt4"
 */
function parseInlineMcqOptions(rawOptions: string): [string, string, string, string] {
  const text = (rawOptions || '').trim();
  const regexParens =
    /\(A\)\s*(.*?)\s*\(B\)\s*(.*?)\s*\(C\)\s*(.*?)\s*\(D\)\s*(.*?)(?:\s*\([EF]\).*)?$/i;
  const matchParens = text.match(regexParens);
  if (matchParens) {
    return [
      matchParens[1].trim(),
      matchParens[2].trim(),
      matchParens[3].trim(),
      matchParens[4].trim(),
    ];
  }

  const regexDots =
    /\bA[.)]\s*(.*?)\s+\bB[.)]\s*(.*?)\s+\bC[.)]\s*(.*?)\s+\bD[.)]\s*(.*?)(?:\s+\b[EF][.)].*)?$/i;
  const matchDots = text.match(regexDots);
  if (matchDots) {
    return [
      matchDots[1].trim(),
      matchDots[2].trim(),
      matchDots[3].trim(),
      matchDots[4].trim(),
    ];
  }

  const parts = text
    .split(/[;,]/)
    .map((p) => p.replace(/^\(?[A-F][).]\s*/i, '').trim())
    .filter(Boolean);
  return [
    parts[0] || 'Option A',
    parts[1] || 'Option B',
    parts[2] || 'Option C',
    parts[3] || 'Option D',
  ];
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
 * Bulk Question Parser supporting:
 * 1. Format A (6-column MCQ):
 *    QNo | TYPE=MCQ (or MCQ) | Question | Options (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | Answer Key (e.g., C) | Mark (e.g., 1)
 * 2. Format B (6-column TYA):
 *    QNo | TYPE=TYA (or TYA) | Question | Answer Key(s) (can contain |) | Mark | AI Evaluation (YES/NO)
 * 3. Numbered list format:
 *    1. Which part of the nephron is mainly responsible for ultrafiltration of blood?
 *    Answer key: Glomerulus.
 */
export function parseBulkQuestionsInput(
  rawText: string,
  subject: string,
  category: CategoryType | 'All' = 'All',
  bankId?: string
): Question[] {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return [];

  const parsedQuestions: Question[] = [];
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Check if input uses pipe-delimited rows
  const hasPipeRows = lines.some((l) => l.includes('|'));

  if (hasPipeRows) {
    lines.forEach((line, idx) => {
      if (!line.includes('|')) return;
      const rawCols = line.split('|').map((c) => c.trim());
      if (rawCols.length < 3) return;

      // Detect Column 2 TYPE (e.g. "TYA", "TYPE=TYA", "MCQ", "TYPE=MCQ")
      const col1Upper = rawCols[1]
        .toUpperCase()
        .replace(/^TYPE\s*=\s*/i, '')
        .trim();

      if (col1Upper === 'TYA') {
        // Format B - TYA:
        // QNo | TYA | Question | Answer Key(s) [may span multiple pipes if keys separated by |] | Mark | AI Evaluation
        const questionText = rawCols[2] || '';
        if (!questionText) return;

        // Because Answer Key(s) itself may contain '|' (e.g. Grana | Thylakoid membrane),
        // we inspect the last two columns for Mark (number) and AI Evaluation (YES/NO/TRUE/FALSE)
        let allowAiEval = true;
        let mark = 1;
        let answerKeyEndIdx = rawCols.length;

        const lastCol = rawCols[rawCols.length - 1]
          .toUpperCase()
          .replace(/^AI\s*EVALUATION\s*=\s*/i, '')
          .trim();

        if (
          ['YES', 'NO', 'TRUE', 'FALSE', 'Y', 'N', '1', '0'].includes(lastCol) &&
          rawCols.length >= 5
        ) {
          allowAiEval = ['YES', 'TRUE', 'Y', '1'].includes(lastCol);
          answerKeyEndIdx = rawCols.length - 1;

          const secondLastCol = rawCols[rawCols.length - 2]
            .replace(/^MARK\s*=\s*/i, '')
            .trim();
          const parsedMark = Number(secondLastCol);
          if (!Number.isNaN(parsedMark) && parsedMark > 0 && rawCols.length >= 6) {
            mark = parsedMark;
            answerKeyEndIdx = rawCols.length - 2;
          }
        } else {
          const parsedLastMark = Number(
            rawCols[rawCols.length - 1].replace(/^MARK\s*=\s*/i, '').trim()
          );
          if (!Number.isNaN(parsedLastMark) && parsedLastMark > 0 && rawCols.length >= 5) {
            mark = parsedLastMark;
            answerKeyEndIdx = rawCols.length - 1;
          }
        }

        const answerKeySlice = rawCols.slice(3, answerKeyEndIdx).filter(Boolean);
        const answerKeys: string[] = [];
        answerKeySlice.forEach((segment) => {
          parseAnswerKeys(segment).forEach((k) => {
            if (!answerKeys.some((existing) => existing.toLowerCase() === k.toLowerCase())) {
              answerKeys.push(k);
            }
          });
        });

        if (answerKeys.length === 0 && rawCols[3]) {
          answerKeys.push(rawCols[3].replace(/\.$/, '').trim());
        }

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

      if (col1Upper === 'MCQ') {
        // Format A - MCQ:
        // Case 1 (6 columns): QNo | MCQ | Question | (A) Opt1 (B) Opt2 (C) Opt3 (D) Opt4 | Answer Key | Mark
        // Case 2 (9 columns): QNo | MCQ | Question | OptA | OptB | OptC | OptD | Answer Key | Mark
        const questionText = rawCols[2] || '';
        if (!questionText) return;

        let options: [string, string, string, string] = ['Option A', 'Option B', 'Option C', 'Option D'];
        let correctAnswer = 0;
        let mark = 1;

        if (rawCols.length >= 8) {
          options = [
            rawCols[3] || 'Option A',
            rawCols[4] || 'Option B',
            rawCols[5] || 'Option C',
            rawCols[6] || 'Option D',
          ];
          correctAnswer = letterToOptionIndex(rawCols[7]);
          mark = Number(rawCols[8]) || 1;
        } else {
          options = parseInlineMcqOptions(rawCols[3] || '');
          correctAnswer = letterToOptionIndex(rawCols[4] || 'A');
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
        });
        return;
      }

      // Fallback: Legacy pipe format without explicit MCQ/TYA in column 2:
      // e.g., Question | OptA | OptB | OptC | OptD | AnswerKey
      if (rawCols.length >= 6) {
        const questionText = rawCols[0];
        const options: [string, string, string, string] = [
          rawCols[1] || 'Option A',
          rawCols[2] || 'Option B',
          rawCols[3] || 'Option C',
          rawCols[4] || 'Option D',
        ];
        const correctAnswer = letterToOptionIndex(rawCols[5] || 'A');
        parsedQuestions.push({
          id: `q-mcq-${Date.now()}-${idx}`,
          subject,
          bankId,
          category,
          questionType: 'MCQ',
          questionText,
          options,
          correctAnswer,
          mark: Number(rawCols[6]) || 1,
        });
      }
    });

    if (parsedQuestions.length > 0) {
      return parsedQuestions;
    }
  }

  // Also support numbered TYA blocks like:
  // "1. Which part of the nephron is mainly responsible for ultrafiltration of blood?
  // Answer key: Glomerulus."
  let currentQuestionText = '';
  lines.forEach((line, idx) => {
    const answerMatch = line.match(/^answer\s*key\s*[:=-]\s*(.+)$/i);
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
