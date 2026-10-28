import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Candidate, ExamResult, ExamSettings, Question } from '../types';

import { QUEMINT_LOGO_URL } from '../components/QuemintSeal';

let cachedCircularLogoPng: string | null = null;

if (typeof window !== 'undefined') {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        cachedCircularLogoPng = canvas.toDataURL('image/png');
      }
    } catch {
      // Fallback to vector seal if canvas tainting occurs
    }
  };
  img.src = QUEMINT_LOGO_URL;
}

/**
 * Helper to draw the official Quemint Education Board logo seal in a jsPDF document
 */
export function drawOfficialSeal(doc: jsPDF, centerX: number, centerY: number, radius = 26) {
  if (cachedCircularLogoPng) {
    doc.setFillColor(255, 255, 255);
    doc.circle(centerX, centerY, radius + 1, 'F');
    doc.addImage(
      cachedCircularLogoPng,
      'PNG',
      centerX - radius,
      centerY - radius,
      radius * 2,
      radius * 2
    );
    return;
  }

  // Fallback vector seal if image is still loading
  doc.setFillColor(10, 107, 60);
  doc.circle(centerX, centerY, radius, 'F');

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.5);
  doc.circle(centerX, centerY, radius - 3.5, 'S');

  doc.setFillColor(255, 255, 255);
  doc.circle(centerX, centerY, radius - 8, 'F');

  doc.setTextColor(10, 107, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('QUEMINT', centerX, centerY - 2, { align: 'center' });

  doc.setFontSize(6.5);
  doc.text('EDUC. BOARD', centerX, centerY + 6, { align: 'center' });
}

/**
 * Helper to draw a vector QR / 2D verification matrix in the top-right corner
 */
function drawVerificationMatrix(doc: jsPDF, x: number, y: number, size = 46, seedStr = 'QMT') {
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(10, 107, 60);
  doc.setLineWidth(1);
  doc.roundedRect(x, y, size, size, 3, 3, 'FD');

  const cells = 7;
  const pad = 4;
  const cellSize = (size - pad * 2) / cells;

  doc.setFillColor(10, 107, 60);
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const isCorner =
        (r < 2 && c < 2) ||
        (r < 2 && c >= cells - 2) ||
        (r >= cells - 2 && c < 2);
      const hash = (seedStr.charCodeAt((r * cells + c) % seedStr.length) + r * 17 + c * 31) % 3;
      if (isCorner || hash === 0) {
        doc.rect(
          x + pad + c * cellSize,
          y + pad + r * cellSize,
          cellSize - 0.6,
          cellSize - 0.6,
          'F'
        );
      }
    }
  }
}

/**
 * Helper to draw a vector security barcode at the bottom of the slip
 */
function drawSecurityBarcode(doc: jsPDF, x: number, y: number, width = 150, height = 22, code = '2027015PHA') {
  doc.setFillColor(10, 107, 60);
  let cursor = x;
  const endX = x + width;
  let idx = 0;
  while (cursor < endX - 3) {
    const ch = code.charCodeAt(idx % code.length) || 65;
    const barW = (ch % 3) + 1;
    const gapW = ((ch >> 1) % 2) + 1.5;
    if (cursor + barW <= endX) {
      doc.rect(cursor, y, barW, height, 'F');
    }
    cursor += barW + gapW;
    idx++;
  }
}

/**
 * Formats subject scores in Two-Top, Two-Down format:
 * Physics: 99  •  Chemistry: 99
 * Biology: 90  •  English: 90
 */
export function formatSubjectsTwoTopTwoDown(
  breakdown: Record<string, { score: number }>,
  separator = '   •   '
): string[] {
  const entries = Object.entries(breakdown).map(
    ([subj, st]) => `${subj}: ${st.score}`
  );
  const rows: string[] = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(entries.slice(i, i + 2).join(separator));
  }
  return rows;
}

export interface QuemintGradeInfo {
  grade: string;       // e.g. 'SS ✨', 'S', 'A', 'B', 'C', 'D', 'E', 'F'
  pdfGrade: string;    // e.g. 'SS', 'S', 'A', 'B', 'C', 'D', 'E', 'F'
  isSS: boolean;
  label: string;       // What the grade stands for: 'Super perfect', 'Superior', 'Excellent', etc.
  range: string;       // e.g. '100%', '90%-99%', etc.
  remark: string;      // e.g. 'Grade SS ✨ — Super perfect', 'Grade S — Superior', 'Grade A — Excellent'
  displayFull: string; // e.g. 'Grade SS ✨ — Super perfect'
}

/**
 * Official Quemint Grading System:
 * - Grade SS ✨ — Super perfect (100%)
 * - Grade S — Superior (90%-99%)
 * - Grade A — Excellent (80%-89%)
 * - Grade B — Very Good (70%-79%)
 * - Grade C — Good (60%-69%)
 * - Grade D — Poor (50%-59%)
 * - Grade E — Very Poor (40%-49%)
 * - Grade F — Failed (below 40%)
 */
export function getQuemintGradeInfo(percentage: number): QuemintGradeInfo {
  const pct = Math.round(percentage);
  if (pct >= 100) {
    return {
      grade: 'SS ✨',
      pdfGrade: 'SS',
      isSS: true,
      label: 'Super perfect',
      range: '100%',
      remark: 'Grade SS ✨ — Super perfect',
      displayFull: 'Grade SS ✨ — Super perfect',
    };
  }
  if (pct >= 90) {
    return {
      grade: 'S',
      pdfGrade: 'S',
      isSS: false,
      label: 'Superior',
      range: '90%-99%',
      remark: 'Grade S — Superior',
      displayFull: 'Grade S — Superior',
    };
  }
  if (pct >= 80) {
    return {
      grade: 'A',
      pdfGrade: 'A',
      isSS: false,
      label: 'Excellent',
      range: '80%-89%',
      remark: 'Grade A — Excellent',
      displayFull: 'Grade A — Excellent',
    };
  }
  if (pct >= 70) {
    return {
      grade: 'B',
      pdfGrade: 'B',
      isSS: false,
      label: 'Very Good',
      range: '70%-79%',
      remark: 'Grade B — Very Good',
      displayFull: 'Grade B — Very Good',
    };
  }
  if (pct >= 60) {
    return {
      grade: 'C',
      pdfGrade: 'C',
      isSS: false,
      label: 'Good',
      range: '60%-69%',
      remark: 'Grade C — Good',
      displayFull: 'Grade C — Good',
    };
  }
  if (pct >= 50) {
    return {
      grade: 'D',
      pdfGrade: 'D',
      isSS: false,
      label: 'Poor',
      range: '50%-59%',
      remark: 'Grade D — Poor',
      displayFull: 'Grade D — Poor',
    };
  }
  if (pct >= 40) {
    return {
      grade: 'E',
      pdfGrade: 'E',
      isSS: false,
      label: 'Very Poor',
      range: '40%-49%',
      remark: 'Grade E — Very Poor',
      displayFull: 'Grade E — Very Poor',
    };
  }
  return {
    grade: 'F',
    pdfGrade: 'F',
    isSS: false,
    label: 'Failed',
    range: 'below 40%',
    remark: 'Grade F — Failed',
    displayFull: 'Grade F — Failed',
  };
}

/**
 * Helper to draw a crisp 4-point sparkle (✨) icon in jsPDF for SS grade
 */
function drawSparkleIcon(doc: jsPDF, cx: number, cy: number, size = 3.8) {
  doc.setFillColor(245, 158, 11); // Gold sparkle (#f59e0b)
  doc.triangle(cx, cy - size, cx - size * 0.32, cy, cx + size * 0.32, cy, 'F');
  doc.triangle(cx, cy + size, cx - size * 0.32, cy, cx + size * 0.32, cy, 'F');
  doc.triangle(cx - size, cy, cx, cy - size * 0.32, cx, cy + size * 0.32, 'F');
  doc.triangle(cx + size, cy, cx, cy - size * 0.32, cx, cy + size * 0.32, 'F');
}

/**
 * Formats an ISO date string into DD/MM/YYYY, hh:mm am/pm (e.g. "24/10/2026, 07:05 am")
 */
export function formatExamDateTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const hh = String(hours).padStart(2, '0');
    return `${day}/${month}/${year}, ${hh}:${minutes} ${ampm}`;
  } catch {
    return isoStr;
  }
}

/**
 * Generates and downloads the Candidate Result Slip PDF matching the exact layout of the
 * reference screenshot (Result_Slip_<RegNo>_<TestCode>.pdf) in Quemint Green (#0a6b3c) and White (#FFFFFF).
 */
export function downloadCandidateResultSlipPdf(
  res: ExamResult,
  candidate: Candidate | undefined,
  settings: ExamSettings,
  _rankInfo?: { rank: number; total: number }
) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
  const marginX = 52;
  const contentWidth = pageWidth - marginX * 2;
  const gradeInfo = getQuemintGradeInfo(res.percentage);

  // 1. Clean White Page Background
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // 2. Top Solid Quemint Green Bar (#0a6b3c)
  doc.setFillColor(10, 107, 60);
  doc.rect(marginX, 46, contentWidth, 7, 'F');

  // 2b. Official Quemint Education Board Logo Centered at Top
  drawOfficialSeal(doc, pageWidth / 2, 86, 23);

  // 3. Centered Two-Tone Title: "<Brand> <EXAM TITLE>"
  const brandTitle = (settings.resultTitles?.testTitle || 'Quemint').trim();
  const examTitle = (
    res.testTitle ||
    settings.resultTitles?.testSubtitle ||
    'MOCK EXAMINATION'
  )
    .trim()
    .toUpperCase();
  const assessmentSub =
    settings.resultTitles?.assessmentSubtitle || 'Quemint Assessment';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19.5);
  const brandPart = `${brandTitle} `;
  const brandW = doc.getTextWidth(brandPart);
  const examW = doc.getTextWidth(examTitle);
  const totalTitleW = brandW + examW;
  const titleStartX = (pageWidth - totalTitleW) / 2;

  // Brand in Quemint Green (#0a6b3c)
  doc.setTextColor(10, 107, 60);
  doc.text(brandPart, titleStartX, 132);

  // Exam title in dark near-black (#1f2937)
  doc.setTextColor(31, 41, 55);
  doc.text(examTitle, titleStartX + brandW, 132);

  // 4. Centered Subtitle below Main Title
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(115, 122, 130);
  doc.text(assessmentSub, pageWidth / 2, 150, { align: 'center' });

  // 5. Thin Horizontal Divider Line
  doc.setDrawColor(232, 235, 239);
  doc.setLineWidth(0.8);
  doc.line(marginX, 168, pageWidth - marginX, 168);

  // 6. Two-Column Candidate Particulars Grid
  const genderStr = res.gender || candidate?.gender || 'Male';
  const examDateFormatted = formatExamDateTime(res.submittedAt);

  const leftColX = marginX + 12;
  const rightColX = pageWidth / 2 + 12;

  const drawLabelValue = (
    x: number,
    y: number,
    label: string,
    value: string
  ) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(115, 122, 130);
    doc.text(label, x, y);
    const labelW = doc.getTextWidth(`${label}    `);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(24, 24, 27);
    doc.text(value, x + labelW, y);
  };

  // Left Column: Candidate Name, Registration Number, Gender
  drawLabelValue(leftColX, 192, 'Candidate Name:', res.candidateName);
  drawLabelValue(leftColX, 212, 'Registration Number:', res.regNumber);
  drawLabelValue(leftColX, 232, 'Gender:', genderStr);

  // Right Column: Category, Exam Date/Time
  drawLabelValue(rightColX, 192, 'Category:', res.category.toLowerCase());
  drawLabelValue(rightColX, 212, 'Exam Date/Time:', examDateFormatted);

  // 7. Subject & Score Table (Soft Green Tinted Header + Alternating Subject Rows)
  const tableTopY = 260;
  const headerH = 30;
  const rowH = 28;

  // Header Box with soft Quemint green tint (#e3f5ec) and subtle green border (#9fd8b8)
  doc.setFillColor(227, 245, 236);
  doc.setDrawColor(159, 216, 184);
  doc.setLineWidth(0.8);
  doc.rect(marginX, tableTopY, contentWidth, headerH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(24, 24, 27);
  doc.text('Subject', marginX + 16, tableTopY + 19);
  doc.text('Score', pageWidth - marginX - 16, tableTopY + 19, {
    align: 'right',
  });

  // Subject Rows (No /xx or Cap labels anywhere)
  const subjectEntries = Object.entries(res.subjectBreakdown);
  subjectEntries.forEach(([subj, st], idx) => {
    const rY = tableTopY + headerH + idx * rowH;

    // Alternating subtle light gray fill on odd rows
    if (idx % 2 === 1) {
      doc.setFillColor(248, 249, 250);
    } else {
      doc.setFillColor(255, 255, 255);
    }
    doc.rect(marginX, rY, contentWidth, rowH, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(31, 41, 55);
    doc.text(subj, marginX + 16, rY + 18);

    doc.setTextColor(17, 24, 39);
    doc.text(String(st.score), pageWidth - marginX - 16, rY + 18, {
      align: 'right',
    });
  });

  // 8. Centered Aggregate Score, Percentage & Official Grade (e.g. "Grade SS — Super perfect", "Grade S — Superior", "Grade A — Excellent")
  const afterTableY = tableTopY + headerH + subjectEntries.length * rowH;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(24, 24, 27);
  doc.text(`Aggregate score: ${res.score}`, pageWidth / 2, afterTableY + 36, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(115, 122, 130);
  doc.text(`Percentage: ${res.percentage}%`, pageWidth / 2, afterTableY + 53, {
    align: 'center',
  });

  // Grade line: "Grade <Grade> — <Meaning>" with sparkle for SS
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(10, 107, 60); // Quemint Green (#0a6b3c)
  const gradeLineText = `Grade ${gradeInfo.pdfGrade} — ${gradeInfo.label}`;
  doc.text(gradeLineText, pageWidth / 2, afterTableY + 72, {
    align: 'center',
  });
  if (gradeInfo.isSS) {
    const gWidth = doc.getTextWidth(gradeLineText);
    drawSparkleIcon(doc, pageWidth / 2 + gWidth / 2 + 7, afterTableY + 68.5, 3.8);
  }

  // 9. Bottom Divider Line & Verification Authenticated Footer
  const footerLineY = afterTableY + 100;
  doc.setDrawColor(232, 235, 239);
  doc.setLineWidth(0.8);
  doc.line(marginX, footerLineY, pageWidth - marginX, footerLineY);

  const testCode =
    settings.testAccessCode ||
    `RAPID-${new Date(res.submittedAt).getFullYear() || 2026}-QMT`;
  const resultIdStr = res.id.startsWith('res-') ? res.id : `res-${res.id}`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(148, 155, 164);
  doc.text(
    `Result ID: ${resultIdStr}  |  Test Code: ${testCode}`,
    marginX,
    footerLineY + 15
  );
  doc.text(
    'Official Result Slip - Verification Authenticated',
    pageWidth - marginX,
    footerLineY + 15,
    { align: 'right' }
  );

  doc.save(`Result_Slip_${res.regNumber}_${testCode}.pdf`);
}

/**
 * Generates and downloads the Questions-With-Answers PDF matching the reference screenshot:
 * Shows each question, "Options:", A/B/C/D options with the correct option in bold + green ✓,
 * without indicating which option the student selected or failed.
 */
export function downloadCandidateQuestionsPdf(
  res: ExamResult,
  settings: ExamSettings,
  allQuestions: Question[] = []
) {
  const mode = settings.downloadMode || 'Download total questions attempted';
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
  const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;

  // Build question list to render
  const records = res.attemptedRecord || [];
  const filtered = records.filter((item) => {
    if (mode === 'Download failed questions only') {
      return item.selectedAnswer !== item.correctAnswer;
    }
    if (mode === 'Download total questions attempted') {
      return item.selectedAnswer !== null;
    }
    return true;
  });

  let listToRender: {
    subject: string;
    questionText: string;
    options: string[];
    correctAnswer: number;
  }[] = (filtered.length > 0 ? filtered : records).map((r) => ({
    subject: r.subject,
    questionText: r.questionText,
    options: r.options,
    correctAnswer: r.correctAnswer,
  }));

  // Fallback to question bank for pre-seeded results that don't have attemptedRecord populated
  if (listToRender.length === 0 && allQuestions.length > 0) {
    const candidateSubjects = Object.keys(res.subjectBreakdown || {});
    const matchingQuestions =
      candidateSubjects.length > 0
        ? allQuestions.filter((q) => candidateSubjects.includes(q.subject))
        : allQuestions;
    listToRender = (
      matchingQuestions.length > 0 ? matchingQuestions : allQuestions
    ).map((q) => ({
      subject: q.subject,
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer,
    }));
  }

  // Group questions by subject while preserving subject order
  const subjectGroups: {
    subject: string;
    items: {
      questionText: string;
      options: string[];
      correctAnswer: number;
    }[];
  }[] = [];

  listToRender.forEach((item) => {
    let group = subjectGroups.find((g) => g.subject === item.subject);
    if (!group) {
      group = { subject: item.subject, items: [] };
      subjectGroups.push(group);
    }
    group.items.push({
      questionText: item.questionText,
      options: item.options,
      correctAnswer: item.correctAnswer,
    });
  });

  // Page 1 Top Header: Official Logo + "QUEMINT SIMULATED EXAMS [ MEDICAL ASPIRANT ] 1.0"
  drawOfficialSeal(doc, marginX + 13, 35, 12);
  const headerTitle = `QUEMINT SIMULATED EXAMS [ ${res.category.toUpperCase()} ASPIRANT ] 1.0`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(10, 107, 60); // Quemint Green (#0a6b3c)
  doc.text(headerTitle, marginX + 31, 39);

  // Horizontal line beneath top title
  doc.setDrawColor(10, 107, 60);
  doc.setLineWidth(1.2);
  doc.line(marginX, 51, pageWidth - marginX, 51);

  // "Name: ............................................................................................................"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(
    'Name: ........................................................................................................................',
    marginX,
    68
  );

  let currentY = 94;
  let globalQuestionNumber = 1;
  const letters = ['A', 'B', 'C', 'D'];

  // Helper to draw a crisp green checkmark (✓) next to the correct option
  const drawGreenCheckmark = (x: number, y: number) => {
    doc.setDrawColor(22, 163, 74); // #16a34a crisp green
    doc.setLineWidth(1.5);
    doc.line(x, y - 3.2, x + 2.3, y - 0.6);
    doc.line(x + 2.3, y - 0.6, x + 6.6, y - 6.2);
  };

  subjectGroups.forEach((group, gIdx) => {
    if (gIdx > 0) {
      currentY += 6;
    }

    // Ensure enough room for Category heading + at least first question
    if (currentY + 95 > pageHeight - 46) {
      doc.addPage();
      currentY = 46;
    }

    // "Category: Biology"
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Category: ${group.subject}`, marginX, currentY);
    currentY += 20;

    group.items.forEach((qItem) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      const wrappedQ: string[] = doc.splitTextToSize(
        qItem.questionText,
        contentWidth - 28
      );

      const estimatedHeight =
        wrappedQ.length * 13 + 15 + qItem.options.length * 14 + 10;

      if (currentY + estimatedHeight > pageHeight - 46) {
        doc.addPage();
        currentY = 46;
      }

      // Question Number + Question Text
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.setTextColor(30, 41, 59);
      doc.text(`${globalQuestionNumber}.`, marginX + 10, currentY);

      wrappedQ.forEach((lineStr: string) => {
        doc.text(lineStr, marginX + 24, currentY);
        currentY += 13;
      });

      // "Options:" label
      currentY += 1;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(15, 23, 42);
      doc.text('Options:', marginX + 24, currentY);
      currentY += 14;

      // Options A, B, C, D (Correct option in bold + green ✓, no student answer indicator)
      qItem.options.forEach((optText, optIdx) => {
        const isCorrect = optIdx === qItem.correctAnswer;
        const prefix = letters[optIdx] || String.fromCharCode(65 + optIdx);
        const fullOptionStr = `${prefix}. ${optText}`;

        if (isCorrect) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.2);
          doc.setTextColor(15, 23, 42);
          doc.text(fullOptionStr, marginX + 34, currentY);

          const textW = doc.getTextWidth(fullOptionStr);
          drawGreenCheckmark(marginX + 34 + textW + 5, currentY);
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.2);
          doc.setTextColor(30, 41, 59);
          doc.text(fullOptionStr, marginX + 34, currentY);
        }

        currentY += 14;
      });

      currentY += 8;
      globalQuestionNumber++;
    });
  });

  // Draw bottom page numbers & "❤️ from Quemint" footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerY = pageHeight - 24;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(String(p), marginX, footerY);

    const footerSuffix = ' from Quemint';
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const suffixW = doc.getTextWidth(footerSuffix);
    doc.text(footerSuffix, pageWidth - marginX, footerY, {
      align: 'right',
    });

    // Draw crisp vector heart (❤️) immediately before " from Quemint"
    const heartX = pageWidth - marginX - suffixW - 4.2;
    doc.setFillColor(225, 29, 72); // Red heart (#e11d48)
    doc.circle(heartX - 1.45, footerY - 3.9, 1.55, 'F');
    doc.circle(heartX + 1.45, footerY - 3.9, 1.55, 'F');
    doc.rect(heartX - 1.45, footerY - 3.9, 2.9, 0.9, 'F');
    doc.triangle(
      heartX - 2.9,
      footerY - 3.35,
      heartX + 2.9,
      footerY - 3.35,
      heartX,
      footerY - 0.1,
      'F'
    );
  }

  doc.save(
    `Questions-With-Answers-QUEMINT_SIMULATED_EXAMS_${res.regNumber}.pdf`
  );
}

/**
 * Generates and downloads an official JAMB-style Photocard & Registration Slip PDF
 */
export function downloadRegistrationSlipPdf(
  candidate: Candidate,
  isFreeRegistration?: boolean
) {
  const isFree =
    Boolean(isFreeRegistration) ||
    candidate.paymentMethod === 'Free Registration' ||
    candidate.amountPaid === 0;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Outer Green Security Border
  doc.setDrawColor(10, 107, 60);
  doc.setLineWidth(2.5);
  doc.rect(20, 20, pageWidth - 40, pageHeight - 40, 'S');

  doc.setDrawColor(14, 138, 78);
  doc.setLineWidth(0.8);
  doc.rect(25, 25, pageWidth - 50, pageHeight - 50, 'S');

  // Header Banner
  doc.setFillColor(10, 107, 60);
  doc.roundedRect(36, 36, pageWidth - 72, 86, 8, 8, 'F');

  drawOfficialSeal(doc, 76, 79, 25);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('QUEMINT EDUCATION BOARD', 114, 66);

  doc.setFontSize(11);
  doc.text('OFFICIAL CANDIDATE EXAMINATION PHOTOCARD & REGISTRATION SLIP', 114, 84);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    `2026/2027 CBT Examination Session  •  Issued: ${new Date(
      candidate.createdAt
    ).toLocaleDateString('en-GB')}`,
    114,
    102
  );

  // Credentials Highlight Card + Passport Photo Frame (Blank if not uploaded)
  const credY = 138;
  const passportBoxW = 76;
  const passportBoxH = 86;
  const passportBoxX = pageWidth - 36 - passportBoxW;

  doc.setFillColor(242, 250, 245);
  doc.setDrawColor(10, 107, 60);
  doc.setLineWidth(1.5);
  doc.roundedRect(36, credY, pageWidth - 72 - passportBoxW - 12, passportBoxH, 8, 8, 'FD');

  doc.setTextColor(10, 107, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(
    isFree
      ? 'OFFICIAL EXAMINATION REGISTRATION NUMBER & APPROVAL STATUS'
      : 'OFFICIAL GREEN BOX EXAMINATION CREDENTIALS',
    50,
    credY + 22
  );

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);
  doc.text(
    `REGISTRATION NO: ${candidate.regNumber || 'PENDING'}`,
    50,
    credY + 46
  );

  doc.setTextColor(10, 107, 60);
  if (isFree) {
    doc.setFontSize(10);
    doc.text(
      `APPROVAL STATUS: ${
        candidate.paymentStatus === 'Paid'
          ? 'APPROVED BY ADMIN (ACTIVE FOR EXAM LOGIN)'
          : 'PENDING ADMIN APPROVAL'
      }`,
      50,
      credY + 68
    );
  } else {
    doc.text(
      `GREEN BOX PIN: ${candidate.pin || 'AWAITING PIN'}`,
      50,
      credY + 68
    );
  }

  // Passport Photo Box (Completely blank white box unless candidate uploaded a photo)
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(10, 107, 60);
  doc.setLineWidth(1.5);
  doc.roundedRect(passportBoxX, credY, passportBoxW, passportBoxH, 6, 6, 'FD');

  if (
    candidate.passportDataUrl &&
    candidate.passportDataUrl.startsWith('data:image/')
  ) {
    try {
      const imgFormat = candidate.passportDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(
        candidate.passportDataUrl,
        imgFormat,
        passportBoxX + 2,
        credY + 2,
        passportBoxW - 4,
        passportBoxH - 4
      );
    } catch {
      // Leave blank if image format is unsupported
    }
  }

  // Candidate Details Table
  const fullName = `${candidate.surname.toUpperCase()}, ${candidate.firstName} ${
    candidate.middleName || ''
  }`.trim();

  const tableRows: string[][] = [
    ['Full Name (Surname First)', fullName],
    ['Gender', candidate.gender],
    ['Examination Category', candidate.category.toUpperCase()],
    ['Registration Number', candidate.regNumber || 'Not Generated'],
  ];

  if (!isFree) {
    tableRows.push(
      ['GREEN BOX PIN', candidate.pin || 'Pending Confirmation'],
      ['Amount Paid', `NGN ${candidate.amountPaid.toLocaleString()}.00`],
      ['Payment Method', candidate.paymentMethod],
      ['Transaction Reference', candidate.transactionRef]
    );
  }

  tableRows.push(
    [
      isFree ? 'Admin Approval Status' : 'Payment Verification Status',
      candidate.paymentStatus === 'Paid'
        ? 'APPROVED & CLEARED FOR EXAMINATION'
        : 'PENDING ADMIN APPROVAL',
    ],
    ['Scheduled Examination Date', candidate.examDate],
    ['Scheduled Examination Time', candidate.examTime]
  );

  autoTable(doc, {
    startY: credY + passportBoxH + 16,
    margin: { left: 36, right: 36 },
    head: [['FIELD', 'CANDIDATE REGISTRATION DETAILS']],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [10, 107, 60],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: 8,
    },
    bodyStyles: {
      textColor: [0, 0, 0],
      fontSize: 9.5,
      cellPadding: 8,
    },
    alternateRowStyles: {
      fillColor: [246, 251, 248],
    },
    columnStyles: {
      0: { cellWidth: 185, fontStyle: 'bold', textColor: [10, 107, 60] },
      1: { cellWidth: 'auto', fontStyle: 'bold' },
    },
  });

  // Footer
  drawSecurityBarcode(doc, 36, pageHeight - 75, 200, 20, candidate.regNumber || 'QMT2027');
  doc.setTextColor(10, 107, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(
    'Quemint Education Board Support — WhatsApp: 08107812604 / 08142847261 | Email: christianevans895@gmail.com',
    36,
    pageHeight - 36
  );

  doc.save(`Quemint_Registration_Slip_${candidate.regNumber || candidate.id}.pdf`);
}

/**
 * Generates a unique Registration Number starting with QMT (e.g. QMT2027001AA)
 */
export function generateUniqueQmtRegNumber(
  existingCandidates: { regNumber?: string }[]
): string {
  const existingSet = new Set(
    existingCandidates
      .map((c) => (c.regNumber || '').trim().toUpperCase())
      .filter(Boolean)
  );

  let maxSeq = 0;
  existingSet.forEach((reg) => {
    const match = reg.match(/^QMT2027(\d{3})([A-Z]{2})?$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  });

  let nextSeq = maxSeq + 1;
  while (true) {
    const padded = String(nextSeq).padStart(3, '0');
    const firstLetter = String.fromCharCode(65 + (Math.floor((nextSeq - 1) / 26) % 26));
    const secondLetter = String.fromCharCode(65 + ((nextSeq - 1) % 26));
    const candidateReg = `QMT2027${padded}${firstLetter}${secondLetter}`;
    if (!existingSet.has(candidateReg)) {
      return candidateReg;
    }
    nextSeq++;
  }
}

/**
 * Sorts candidates in alphabetical order based on candidates' First Name
 */
export function sortCandidatesAlphabeticallyByFirstName(
  candidates: Candidate[]
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const firstCmp = (a.firstName || '')
      .trim()
      .localeCompare((b.firstName || '').trim(), undefined, { sensitivity: 'base' });
    if (firstCmp !== 0) return firstCmp;
    const surCmp = (a.surname || '')
      .trim()
      .localeCompare((b.surname || '').trim(), undefined, { sensitivity: 'base' });
    if (surCmp !== 0) return surCmp;
    return (a.middleName || '')
      .trim()
      .localeCompare((b.middleName || '').trim(), undefined, { sensitivity: 'base' });
  });
}

/**
 * Formats bulk registered candidate details in plain text, arranged alphabetically by First Name
 */
export function formatBulkCandidatesAsText(candidates: Candidate[]): string {
  const sorted = sortCandidatesAlphabeticallyByFirstName(candidates);
  const lines: string[] = [
    'QUEMINT EDUCATION BOARD — REGISTERED CANDIDATES DETAILS (ALPHABETICAL BY FIRST NAME)',
    `Total Candidates: ${sorted.length}`,
    `Exported: ${new Date().toLocaleString()}`,
    '================================================================================',
    '',
  ];

  sorted.forEach((cand, idx) => {
    lines.push(
      `${idx + 1}. First Name: ${cand.firstName}`,
      `   Middle Name: ${cand.middleName || '—'}`,
      `   Surname: ${cand.surname}`,
      `   Gender: ${cand.gender}`,
      `   Category: ${cand.category}`,
      `   Registration Number: ${cand.regNumber || 'Pending Admin Approval'}`,
      `   Approval Status: ${cand.paymentStatus === 'Paid' ? 'Approved' : 'Pending Approval'}`,
      ''
    );
  });

  return lines.join('\n').trim();
}

/**
 * Downloads registered candidates' details in PDF format, arranged alphabetically by First Name
 */
export function downloadRegisteredCandidatesPdf(
  candidates: Candidate[],
  settings?: ExamSettings
) {
  const sorted = sortCandidatesAlphabeticallyByFirstName(candidates);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Official Green Header
  doc.setFillColor(10, 107, 60);
  doc.rect(0, 0, pageWidth, 94, 'F');

  drawOfficialSeal(doc, 54, 47, 26);

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('QUEMINT EDUCATION BOARD', 94, 38);

  doc.setFontSize(10.5);
  doc.text(
    'OFFICIAL REGISTERED CANDIDATES DETAILS (ALPHABETICAL BY FIRST NAME)',
    94,
    56
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    `Total Candidates: ${sorted.length}   |   Sorted: A–Z by First Name   |   Generated: ${new Date().toLocaleDateString()}`,
    94,
    74
  );

  const tableRows = sorted.map((cand, index) => [
    String(index + 1),
    cand.firstName || '—',
    cand.middleName || '—',
    cand.surname || '—',
    cand.gender || '—',
    cand.category || '—',
    cand.regNumber || 'Pending Approval',
    cand.paymentStatus === 'Paid' ? 'Approved' : 'Pending',
  ]);

  autoTable(doc, {
    startY: 112,
    margin: { left: 28, right: 28, bottom: 48 },
    head: [
      [
        'S/N',
        'FIRST NAME',
        'MIDDLE NAME',
        'SURNAME',
        'GENDER',
        'CATEGORY',
        'REGISTRATION NO.',
        'STATUS',
      ],
    ],
    body: tableRows,
    theme: 'grid',
    headStyles: {
      fillColor: [10, 107, 60],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 6,
    },
    bodyStyles: {
      textColor: [0, 0, 0],
      fontSize: 8.5,
      cellPadding: 6,
    },
    alternateRowStyles: {
      fillColor: [244, 250, 246],
    },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      1: { fontStyle: 'bold', textColor: [10, 107, 60] },
      6: { fontStyle: 'bold' },
    },
    didDrawPage: (data) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(10, 107, 60);
      doc.text(
        `${settings?.loginBanner?.brandName || 'Quemint Education Board'} — Official Registered Candidates Roll (Page ${data.pageNumber})`,
        28,
        pageHeight - 22
      );
    },
  });

  doc.save('Quemint_Registered_Candidates_Alphabetical.pdf');
}

