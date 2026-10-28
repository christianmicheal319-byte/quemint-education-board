import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Filter,
  CheckCircle2,
  Award,
  TrendingUp,
  TrendingDown,
  Users,
  MapPin,
  FileSpreadsheet,
  Code2,
  Sparkles,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Candidate, ExamCenter, ExamResult, ExamSettings } from '../types';
import { QuemintSeal } from './QuemintSeal';
import { drawOfficialSeal } from '../utils/pdfSlipGenerator';

interface PerformanceAnalysisPanelProps {
  results: ExamResult[];
  candidates: Candidate[];
  settings: ExamSettings;
  examCenters: ExamCenter[];
}

type AnalysisTabMode = 'overall' | 'per_code';
type ScoreFilterType = 'all' | 'below' | 'between' | 'above';

interface ScoreRangeBracket {
  id: string;
  label: string;
  minScore: number;
  maxScore: number;
  isCumulativeTop?: boolean; // "300 - ABOVE" (sum of 320-ABOVE + 300-319)
}

const FIXED_SCORE_BRACKETS: ScoreRangeBracket[] = [
  { id: '320_above', label: '320 - ABOVE', minScore: 320, maxScore: 400 },
  { id: '300_319', label: '300 - 319', minScore: 300, maxScore: 319.999 },
  {
    id: '300_above_sum',
    label: '300 - ABOVE',
    minScore: 300,
    maxScore: 400,
    isCumulativeTop: true,
  },
  { id: '250_299', label: '250 - 299', minScore: 250, maxScore: 299.999 },
  { id: '200_249', label: '200 - 249', minScore: 200, maxScore: 249.999 },
  { id: '160_199', label: '160 - 199', minScore: 160, maxScore: 199.999 },
  { id: '140_159', label: '140 - 159', minScore: 140, maxScore: 159.999 },
  { id: '120_139', label: '120 - 139', minScore: 120, maxScore: 139.999 },
  { id: '100_119', label: '100 - 119', minScore: 100, maxScore: 119.999 },
  { id: 'below_100', label: 'BELOW 100', minScore: 0, maxScore: 99.999 },
];

export const PerformanceAnalysisPanel: React.FC<PerformanceAnalysisPanelProps> = ({
  results,
  candidates,
  settings,
  examCenters,
}) => {
  // Top Tabs: Tab 1 = Overall Performance (All Codes), Tab 2 = Per Exam Code (e.g., QMT3045B)
  const [activeTab, setActiveTab] = useState<AnalysisTabMode>('per_code');

  // Available Exam Codes from publishedTests + results + default QMT3045B
  const examCodeCatalog = useMemo(() => {
    const map = new Map<string, { code: string; title: string; testId?: string }>();

    // Always ensure QMT3045B is available as a first-class exam code option
    map.set('QMT3045B', {
      code: 'QMT3045B',
      title: 'UTME Mock - Batch B',
      testId: 'test-qmt-3045b',
    });

    (settings.publishedTests || []).forEach((pt) => {
      const code = (pt.testCode || '').trim().toUpperCase();
      if (code) {
        map.set(code, {
          code,
          title: pt.title || 'CBT Examination',
          testId: pt.id,
        });
      }
    });

    if (settings.testAccessCode) {
      const activeCode = settings.testAccessCode.trim().toUpperCase();
      if (activeCode && !map.has(activeCode)) {
        map.set(activeCode, {
          code: activeCode,
          title: settings.resultTitles?.testSubtitle || 'Rapid Test',
        });
      }
    }

    results.forEach((r) => {
      const code = (r.testCode || '').trim().toUpperCase();
      if (code && !map.has(code)) {
        map.set(code, {
          code,
          title: r.testTitle || 'CBT Examination',
          testId: r.testId,
        });
      }
    });

    return Array.from(map.values());
  }, [settings.publishedTests, settings.testAccessCode, settings.resultTitles, results]);

  const [selectedExamCode, setSelectedExamCode] = useState<string>('QMT3045B');

  // Filter Builder State
  const [filterType, setFilterType] = useState<ScoreFilterType>('all');
  const [belowPercent, setBelowPercent] = useState<number>(75);
  const [betweenFromPercent, setBetweenFromPercent] = useState<number>(75);
  const [betweenToPercent, setBetweenToPercent] = useState<number>(80);
  const [abovePercent, setAbovePercent] = useState<number>(75);

  // Checkboxes — Statistics Only, NO Names, NO Reg Numbers
  const [showTotalStudents, setShowTotalStudents] = useState<boolean>(true);
  const [showBestCenter, setShowBestCenter] = useState<boolean>(true);
  const [showHighestScore, setShowHighestScore] = useState<boolean>(true);
  const [showLowestScore, setShowLowestScore] = useState<boolean>(true);
  const [showAverageScore, setShowAverageScore] = useState<boolean>(true);
  const [showRangeBreakdownTable, setShowRangeBreakdownTable] = useState<boolean>(true);

  const [showAllBracketsWhenFiltered, setShowAllBracketsWhenFiltered] =
    useState<boolean>(false);
  const [showSqlModal, setShowSqlModal] = useState<boolean>(false);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>(() =>
    new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  );
  const [reportToast, setReportToast] = useState<string>('');

  const brandName =
    settings.loginBanner?.brandName?.trim() ||
    settings.resultTitles?.testTitle?.trim() ||
    'Quemint';

  const selectedExamMeta = useMemo(() => {
    return (
      examCodeCatalog.find(
        (item) => item.code.toUpperCase() === selectedExamCode.toUpperCase()
      ) || {
        code: selectedExamCode,
        title: 'UTME Mock - Batch B',
      }
    );
  }, [examCodeCatalog, selectedExamCode]);

  // Normalize each result's 400-scale raw score, Examination Centre, and Exam Code
  const normalizedResults = useMemo(() => {
    const candidateById = new Map<string, Candidate>();
    const candidateByReg = new Map<string, Candidate>();
    candidates.forEach((c) => {
      candidateById.set(c.id, c);
      if (c.regNumber) {
        candidateByReg.set(c.regNumber.trim().toUpperCase(), c);
      }
    });

    const publishedById = new Map<string, { code: string; title: string }>();
    (settings.publishedTests || []).forEach((pt) => {
      if (pt.id && pt.testCode) {
        publishedById.set(pt.id, {
          code: pt.testCode.trim().toUpperCase(),
          title: pt.title,
        });
      }
    });

    const hasExplicitQmt3045b = results.some(
      (r) => (r.testCode || '').trim().toUpperCase() === 'QMT3045B'
    );

    return results.map((r, idx) => {
      const matchedCand =
        candidateById.get(r.candidateId) ||
        candidateByReg.get((r.regNumber || '').trim().toUpperCase());

      // Resolve Examination Centre
      const centerName =
        r.examCenterName?.trim() ||
        matchedCand?.examCenterName?.trim() ||
        examCenters[idx % Math.max(1, examCenters.length)]?.name ||
        'Q Zone 1';

      // Resolve Exam Code
      let resolvedCode = (r.testCode || '').trim().toUpperCase();
      if (!resolvedCode && r.testId && publishedById.has(r.testId)) {
        resolvedCode = publishedById.get(r.testId)!.code;
      }
      if (!resolvedCode) {
        resolvedCode = 'QMT3045B';
      }

      // Convert score to 400-point scale if needed (aggregate score in app is already 0..400)
      const rawScore400 =
        typeof r.score === 'number' && !isNaN(r.score)
          ? Math.min(400, Math.max(0, Math.round(r.score * 100) / 100))
          : Math.min(400, Math.max(0, Math.round(((r.percentage || 0) / 100) * 400)));

      const pct400 = Math.round((rawScore400 / 400) * 10000) / 100;

      return {
        id: r.id,
        examCode: resolvedCode,
         AlsoMatchesQmt3045B: !hasExplicitQmt3045b && resolvedCode === 'RAPID-2026-QMT',
        examCenterName: centerName,
        rawScore400,
        pct400,
      };
    });
  }, [results, candidates, settings.publishedTests, examCenters]);

  // Step 1: Filter by Tab (Overall vs Per Exam Code)
  const codeScopedResults = useMemo(() => {
    if (activeTab === 'overall') {
      return normalizedResults;
    }
    const target = selectedExamCode.trim().toUpperCase();
    const directMatches = normalizedResults.filter(
      (r) =>
        r.examCode === target ||
        (target === 'QMT3045B' && r.AlsoMatchesQmt3045B)
    );
    // If legacy localStorage results were saved under a single test without testCode, include them for QMT3045B
    if (directMatches.length === 0 && target === 'QMT3045B') {
      return normalizedResults;
    }
    return directMatches;
  }, [activeTab, normalizedResults, selectedExamCode]);

  // Step 2: Compute Filter Score Bounds (on 400 scale)
  const scoreFilterBounds = useMemo(() => {
    if (filterType === 'below') {
      const clampedPct = Math.min(100, Math.max(0, Number(belowPercent) || 0));
      const cutoffRaw = Math.round((clampedPct / 100) * 400 * 100) / 100;
      return {
        minRaw: 0,
        maxRaw: cutoffRaw,
        exclusiveMax: clampedPct < 100,
        label: `Below ${clampedPct}% (Below ${cutoffRaw}/400)`,
        shortSlug: `Below${clampedPct}`,
        isSubRange: clampedPct < 100,
      };
    }

    if (filterType === 'between') {
      const p1 = Math.min(100, Math.max(0, Number(betweenFromPercent) || 0));
      const p2 = Math.min(100, Math.max(0, Number(betweenToPercent) || 100));
      const lowPct = Math.min(p1, p2);
      const highPct = Math.max(p1, p2);
      const minRaw = Math.round((lowPct / 100) * 400 * 100) / 100;
      const maxRaw = Math.round((highPct / 100) * 400 * 100) / 100;
      return {
        minRaw,
        maxRaw,
        exclusiveMax: false,
        label: `Between ${lowPct}% and ${highPct}% (${minRaw} - ${maxRaw}/400)`,
        shortSlug: `Between${lowPct}to${highPct}`,
        isSubRange: !(lowPct === 0 && highPct === 100),
      };
    }

    if (filterType === 'above') {
      const clampedPct = Math.min(100, Math.max(0, Number(abovePercent) || 0));
      const minRaw = Math.round((clampedPct / 100) * 400 * 100) / 100;
      return {
        minRaw,
        maxRaw: 400,
        exclusiveMax: false,
        label:
          clampedPct === 0
            ? 'Above 0% (Full Distribution 0 - 400)'
            : `Above ${clampedPct}% (${minRaw}/400 & Above)`,
        shortSlug: `Above${clampedPct}`,
        isSubRange: clampedPct > 0,
      };
    }

    return {
      minRaw: 0,
      maxRaw: 400,
      exclusiveMax: false,
      label: 'All Scores (Full Distribution 0 - 400 / 0% - 100%)',
      shortSlug: 'AllScores',
      isSubRange: false,
    };
  }, [filterType, belowPercent, betweenFromPercent, betweenToPercent, abovePercent]);

  // Step 3: Filter results within the selected score bounds
  const filteredResults = useMemo(() => {
    return codeScopedResults.filter((r) => {
      if (r.rawScore400 < scoreFilterBounds.minRaw) return false;
      if (scoreFilterBounds.exclusiveMax) {
        return r.rawScore400 < scoreFilterBounds.maxRaw;
      }
      return r.rawScore400 <= scoreFilterBounds.maxRaw;
    });
  }, [codeScopedResults, scoreFilterBounds]);

  // Step 4: Pure Statistical Aggregates (NO Names, NO Reg Numbers)
  const summaryStats = useMemo(() => {
    const count = filteredResults.length;
    if (count === 0) {
      return {
        totalStudents: 0,
        highestScore: null as number | null,
        highestPct: null as number | null,
        lowestScore: null as number | null,
        lowestPct: null as number | null,
        averageScore: 0,
        averagePct: 0,
        bestCenter: null as {
          name: string;
          average: number;
          candidatesCount: number;
        } | null,
      };
    }

    let maxScore = -Infinity;
    let minScore = Infinity;
    let sumScore = 0;

    const centerTotals = new Map<string, { sum: number; count: number }>();

    filteredResults.forEach((r) => {
      if (r.rawScore400 > maxScore) maxScore = r.rawScore400;
      if (r.rawScore400 < minScore) minScore = r.rawScore400;
      sumScore += r.rawScore400;

      const cName = r.examCenterName || 'Q Zone 1';
      const prev = centerTotals.get(cName) || { sum: 0, count: 0 };
      centerTotals.set(cName, {
        sum: prev.sum + r.rawScore400,
        count: prev.count + 1,
      });
    });

    const avgScore = Math.round((sumScore / count) * 10) / 10;
    const avgPct = Math.round(((avgScore / 400) * 100) * 100) / 100;

    // Best Performing Examination Centre: SELECT center, AVG(raw_score) GROUP BY center ORDER BY AVG DESC LIMIT 1
    let bestCenter: { name: string; average: number; candidatesCount: number } | null =
      null;
    centerTotals.forEach((val, name) => {
      const cAvg = Math.round((val.sum / val.count) * 10) / 10;
      if (
        !bestCenter ||
        cAvg > bestCenter.average ||
        (cAvg === bestCenter.average && val.count > bestCenter.candidatesCount)
      ) {
        bestCenter = {
          name,
          average: cAvg,
          candidatesCount: val.count,
        };
      }
    });

    return {
      totalStudents: count,
      highestScore: maxScore,
      highestPct: Math.round(((maxScore / 400) * 100) * 100) / 100,
      lowestScore: minScore,
      lowestPct: Math.round(((minScore / 400) * 100) * 100) / 100,
      averageScore: avgScore,
      averagePct: avgPct,
      bestCenter,
    };
  }, [filteredResults]);

  // Step 5: Score Range Breakdown Table Rows (Category / Score Range, No of Candidates, % of Total)
  const breakdownRows = useMemo(() => {
    const totalInFiltered = filteredResults.length;

    // Filter brackets to those within the active filter range (unless full distribution or showAllBracketsWhenFiltered is true)
    const activeBrackets = FIXED_SCORE_BRACKETS.filter((bracket) => {
      if (!scoreFilterBounds.isSubRange || showAllBracketsWhenFiltered) {
        return true;
      }
      // If user applied e.g. BELOW 75% (<300), exclude brackets >= 300
      const effectiveFilterMax = scoreFilterBounds.exclusiveMax
        ? scoreFilterBounds.maxRaw - 0.001
        : scoreFilterBounds.maxRaw;
      const overlaps =
        bracket.minScore <= effectiveFilterMax &&
        bracket.maxScore >= scoreFilterBounds.minRaw;

      // Only show "300 - ABOVE" cumulative row if both 320-ABOVE and 300-319 are in range
      if (bracket.isCumulativeTop) {
        return effectiveFilterMax >= 320 && scoreFilterBounds.minRaw <= 300;
      }
      return overlaps;
    });

    return activeBrackets.map((bracket) => {
      const count = filteredResults.filter(
        (r) => r.rawScore400 >= bracket.minScore && r.rawScore400 <= bracket.maxScore
      ).length;

      const pct =
        totalInFiltered > 0
          ? Math.round(((count / totalInFiltered) * 100) * 100) / 100
          : 0;

      return {
        ...bracket,
        count,
        pct,
        pctFormatted: `${pct}%`,
      };
    });
  }, [filteredResults, scoreFilterBounds, showAllBracketsWhenFiltered]);

  const handleGenerateReportClick = () => {
    const nowFormatted = new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    setReportGeneratedAt(nowFormatted);
    setReportToast(
      `Performance Report updated (${
        activeTab === 'per_code' ? selectedExamMeta.code : 'All Exam Codes'
      } • ${scoreFilterBounds.label})`
    );
    setTimeout(() => setReportToast(''), 3500);
  };

  // Dynamic Header Strings
  const reportHeaderTitle =
    activeTab === 'per_code'
      ? `${brandName} CBT - Performance Report: ${selectedExamMeta.code}`
      : `${brandName} CBT - Overall Performance Analysis (All Exam Codes)`;

  const reportHeaderSubtitle =
    activeTab === 'per_code'
      ? `Exam: ${selectedExamMeta.title} - ${selectedExamMeta.code} | Total Score: 400 | Date: ${reportGeneratedAt}`
      : `Exam: All Exam Codes Combined (${examCodeCatalog
          .map((c) => c.code)
          .join(', ')}) | Total Score: 400 | Date: ${reportGeneratedAt}`;

  const breakdownTableTitle =
    activeTab === 'per_code'
      ? `Score Distribution for ${selectedExamMeta.code}`
      : 'Score Distribution Across All Exam Codes';

  // Generate PDF with jsPDF + jspdf-autotable (Brand Logo, Brand Name, Dynamic Header, 5 Summary Cards, Score Range Breakdown Table, No Names)
  const generatePDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    // Top Official Brand Header Banner
    doc.setFillColor(10, 107, 60); // #0a6b3c
    doc.rect(0, 0, pageWidth, 38, 'F');

    // Draw Official Quemint Seal / Logo
    drawOfficialSeal(doc, 22, 19, 11);

    // Brand Name & Dynamic Report H1
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(reportHeaderTitle, 37, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(reportHeaderSubtitle, 37, 21);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(`Filter Applied: ${scoreFilterBounds.label}`, 37, 27.5);
    doc.text(
      'PURE STATISTICAL REPORT • ZERO CANDIDATE NAMES OR REGISTRATION NUMBERS',
      37,
      33.5
    );

    let cursorY = 46;

    // SECTION 1: Summary Statistics Cards in PDF
    const summaryItems: { label: string; value: string }[] = [];
    if (showTotalStudents) {
      summaryItems.push({
        label: 'Total Number of Students Found',
        value: `${summaryStats.totalStudents}`,
      });
    }
    if (showHighestScore) {
      summaryItems.push({
        label: 'Highest Score (No Name)',
        value:
          summaryStats.highestScore !== null
            ? `${summaryStats.highestScore}/400 (${summaryStats.highestPct}%)`
            : 'N/A',
      });
    }
    if (showLowestScore) {
      summaryItems.push({
        label: 'Lowest Score (No Name)',
        value:
          summaryStats.lowestScore !== null
            ? `${summaryStats.lowestScore}/400 (${summaryStats.lowestPct}%)`
            : 'N/A',
      });
    }
    if (showAverageScore) {
      summaryItems.push({
        label: 'Average Score',
        value:
          summaryStats.totalStudents > 0
            ? `${summaryStats.averageScore}/400 (${summaryStats.averagePct}%)`
            : '0',
      });
    }
    if (showBestCenter) {
      summaryItems.push({
        label: 'Best Performing Examination Centre',
        value: summaryStats.bestCenter
          ? `${summaryStats.bestCenter.name} | Average: ${summaryStats.bestCenter.average} | Candidates: ${summaryStats.bestCenter.candidatesCount}`
          : 'N/A',
      });
    }

    if (summaryItems.length > 0) {
      doc.setTextColor(10, 107, 60);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text('SECTION 1: EXECUTIVE STATISTICAL SUMMARY', 14, cursorY);
      cursorY += 3;

      autoTable(doc, {
        startY: cursorY,
        head: [['STATISTICAL METRIC', 'VALUE']],
        body: summaryItems.map((item) => [item.label, item.value]),
        theme: 'grid',
        headStyles: {
          fillColor: [10, 107, 60],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
        },
        bodyStyles: {
          textColor: [20, 20, 20],
          fontSize: 9,
          fontStyle: 'bold',
        },
        columnStyles: {
          0: { cellWidth: 75 },
          1: { cellWidth: 'auto' },
        },
        margin: { left: 14, right: 14 },
      });

      cursorY = (doc as any).lastAutoTable.finalY + 10;
    }

    // SECTION 2: Score Range Breakdown Table
    if (showRangeBreakdownTable) {
      doc.setTextColor(10, 107, 60);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(`SECTION 2: ${breakdownTableTitle.toUpperCase()}`, 14, cursorY);
      cursorY += 3;

      const tableBody: string[][] = breakdownRows.map((row) => [
        row.isCumulativeTop ? `${row.label} (Cumulative 300+)` : row.label,
        String(row.count),
        row.pctFormatted,
      ]);

      const totalLabel = scoreFilterBounds.isSubRange
        ? 'TOTAL IN THIS RANGE'
        : 'TOTAL';
      tableBody.push([
        totalLabel,
        String(summaryStats.totalStudents),
        summaryStats.totalStudents > 0 ? '100%' : '0%',
      ]);

      autoTable(doc, {
        startY: cursorY,
        head: [['CATEGORY / SCORE RANGE', 'NO OF CANDIDATES', '% OF TOTAL']],
        body: tableBody,
        theme: 'grid',
        headStyles: {
          fillColor: [10, 107, 60],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9.5,
        },
        bodyStyles: {
          textColor: [15, 15, 15],
          fontSize: 9,
        },
        didParseCell: (data) => {
          if (data.section === 'body') {
            const rawRow = data.row.raw as string[];
            const firstCol = rawRow?.[0] || '';
            if (firstCol.startsWith('TOTAL')) {
              data.cell.styles.fillColor = [10, 107, 60];
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = 'bold';
            } else if (firstCol.includes('Cumulative 300+')) {
              data.cell.styles.fillColor = [232, 245, 238];
              data.cell.styles.textColor = [10, 107, 60];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        },
        columnStyles: {
          0: { fontStyle: 'bold' },
          1: { halign: 'center', fontStyle: 'bold' },
          2: { halign: 'right', fontStyle: 'bold' },
        },
        margin: { left: 14, right: 14 },
      });
    }

    // Footer on all pages: "Generated by Quemint"
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(210, 210, 210);
      doc.line(14, pageHeight - 14, pageWidth - 14, pageHeight - 14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(10, 107, 60);
      doc.text(`Generated by ${brandName}`, 14, pageHeight - 8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Official Statistical Performance Analysis • Page ${i} of ${totalPages}`,
        pageWidth - 14,
        pageHeight - 8.5,
        { align: 'right' }
      );
    }

    // Filename: Performance_QMT3045B_Below75_28Oct2026.pdf
    const dateSlug = new Date()
      .toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      .replace(/\s+/g, '');
    const codeSlug =
      activeTab === 'per_code'
        ? selectedExamMeta.code.replace(/[^a-zA-Z0-9]/g, '')
        : 'Overall';
    const fileName = `Performance_${codeSlug}_${scoreFilterBounds.shortSlug}_${dateSlug}.pdf`;
    doc.save(fileName);
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {reportToast && (
        <div className="p-4 rounded-2xl bg-[#0a6b3c] text-white text-xs md:text-sm font-extrabold flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{reportToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setReportToast('')}
            className="text-xs underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TOP BRAND HEADER & TAB SWITCHER (TAB 1: Overall Performance | TAB 2: Per Exam Code) */}
      <section className="p-6 rounded-3xl border-2 border-[#0a6b3c] bg-white text-black shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <QuemintSeal size="lg" showText={false} />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-3 py-0.5 rounded-full bg-[#0a6b3c] text-white text-[10px] font-extrabold uppercase tracking-wider">
                  {brandName} OFFICIAL STATISTICAL ENGINE
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-[10px] font-extrabold uppercase">
                  PURE STATISTICS • NO NAMES • NO REG NUMBERS
                </span>
              </div>
              <h2 className="text-xl md:text-2xl font-extrabold text-black">
                {brandName} Performance Analysis &amp; Score Range Distribution
              </h2>
              <p className="text-xs text-neutral-600">
                Aggregate score distribution (400-point scale), examination centre performance, and score range breakdown across all or individual exam codes.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowSqlModal((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] bg-neutral-50 text-neutral-800 text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5 text-[#0a6b3c]" />
              <span>{showSqlModal ? 'Hide SQL Queries' : 'View DB SQL Queries'}</span>
            </button>

            <button
              type="button"
              onClick={generatePDF}
              className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold inline-flex items-center gap-2 shadow-xs cursor-pointer transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download as PDF</span>
            </button>
          </div>
        </div>

        {/* TABS: Tab 1 = Overall Performance (All Codes), Tab 2 = Per Exam Code (e.g., QMT3045B) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="inline-flex items-center rounded-2xl bg-neutral-100 p-1.5 border border-neutral-200">
            <button
              type="button"
              onClick={() => setActiveTab('overall')}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'overall'
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : 'text-neutral-700 hover:text-black'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>Tab 1: Overall Performance (All Codes)</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('per_code')}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer flex items-center gap-2 ${
                activeTab === 'per_code'
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : 'text-neutral-700 hover:text-black'
              }`}
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Tab 2: Per Exam Code (e.g., QMT3045B)</span>
            </button>
          </div>

          {/* Top Dropdown: Select Exam Code (Visible in Tab 2) */}
          {activeTab === 'per_code' && (
            <div className="flex items-center gap-2.5">
              <label className="text-xs font-extrabold text-neutral-800 whitespace-nowrap">
                Select Exam Code:
              </label>
              <select
                value={selectedExamCode}
                onChange={(e) => setSelectedExamCode(e.target.value)}
                className="px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white font-mono text-xs md:text-sm font-extrabold text-[#0a6b3c] focus:outline-none cursor-pointer"
              >
                {examCodeCatalog.map((item) => (
                  <option key={item.code} value={item.code} className="text-black font-sans">
                    {item.code} — {item.title}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Optional SQL Reference Drawer */}
        {showSqlModal && (
          <div className="p-4 rounded-2xl bg-neutral-900 text-emerald-300 font-mono text-xs space-y-2 overflow-x-auto border border-neutral-800">
            <div className="text-white font-sans font-extrabold text-xs flex items-center justify-between">
              <span>PostgreSQL / Supabase Statistical Queries (Zero Personal Identifiers)</span>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="text-neutral-400 hover:text-white text-[11px]"
              >
                Close
              </button>
            </div>
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap">
{`-- 1. Score Range Breakdown Query (Per Exam Code e.g. '${selectedExamMeta.code}')
SELECT
  COUNT(*) FILTER (WHERE raw_score >= 320) AS range_320_above,
  COUNT(*) FILTER (WHERE raw_score >= 300 AND raw_score <= 319) AS range_300_319,
  COUNT(*) FILTER (WHERE raw_score >= 300) AS range_300_above,
  COUNT(*) FILTER (WHERE raw_score >= 250 AND raw_score <= 299) AS range_250_299,
  COUNT(*) FILTER (WHERE raw_score >= 200 AND raw_score <= 249) AS range_200_249,
  COUNT(*) FILTER (WHERE raw_score >= 160 AND raw_score <= 199) AS range_160_199,
  COUNT(*) FILTER (WHERE raw_score >= 140 AND raw_score <= 159) AS range_140_159,
  COUNT(*) FILTER (WHERE raw_score >= 120 AND raw_score <= 139) AS range_120_139,
  COUNT(*) FILTER (WHERE raw_score >= 100 AND raw_score <= 119) AS range_100_119,
  COUNT(*) FILTER (WHERE raw_score < 100) AS range_below_100,
  COUNT(*) AS total_candidates
FROM results
WHERE (${activeTab === 'per_code' ? `exam_code = '${selectedExamMeta.code}'` : 'TRUE'})
  AND raw_score >= ${scoreFilterBounds.minRaw}
  AND raw_score ${scoreFilterBounds.exclusiveMax ? '<' : '<='} ${scoreFilterBounds.maxRaw};

-- 2. Best Performing Examination Centre Query
SELECT
  exam_center_name AS center,
  ROUND(AVG(raw_score)::numeric, 1) AS avg_score,
  COUNT(*) AS candidate_count
FROM results
WHERE (${activeTab === 'per_code' ? `exam_code = '${selectedExamMeta.code}'` : 'TRUE'})
  AND raw_score >= ${scoreFilterBounds.minRaw}
  AND raw_score ${scoreFilterBounds.exclusiveMax ? '<' : '<='} ${scoreFilterBounds.maxRaw}
GROUP BY exam_center_name
ORDER BY AVG(raw_score) DESC
LIMIT 1;`}
            </pre>
          </div>
        )}
      </section>

      {/* FILTER BUILDER CARD: "Generate Performance Report" */}
      <section className="p-6 rounded-3xl border border-neutral-200 bg-white text-black shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
              <Filter className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-black">
                Generate Performance Report
              </h3>
              <p className="text-xs text-neutral-500">
                Configure score range filter (converted to 400-point scale) and choose which statistical metrics to display.
              </p>
            </div>
          </div>

          <span className="px-3 py-1 rounded-full bg-[#0a6b3c]/10 text-[#0a6b3c] font-mono text-xs font-extrabold">
            Active Filter: {scoreFilterBounds.label}
          </span>
        </div>

        {/* 4 Filter Options: All Distribution, 1. BELOW, 2. BETWEEN, 3. ABOVE */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Option 0: Full Distribution (0% - 100%) */}
          <div
            onClick={() => setFilterType('all')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer space-y-2 ${
              filterType === 'all'
                ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                : 'border-neutral-200 bg-neutral-50/70 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                ALL SCORES (0% - 100%)
              </span>
              <input
                type="radio"
                checked={filterType === 'all'}
                onChange={() => setFilterType('all')}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
            </div>
            <p className="text-[11px] text-neutral-600">
              Show full JAMB-standard score distribution from <strong>320 - ABOVE</strong> down to <strong>BELOW 100</strong>.
            </p>
            <div className="pt-1 font-mono text-xs font-extrabold text-[#0a6b3c]">
              Raw Score: 0 – 400 / 400
            </div>
          </div>

          {/* Option 1: BELOW [%] */}
          <div
            onClick={() => setFilterType('below')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer space-y-2.5 ${
              filterType === 'below'
                ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                : 'border-neutral-200 bg-neutral-50/70 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                1. BELOW [%]
              </span>
              <input
                type="radio"
                checked={filterType === 'below'}
                onChange={() => setFilterType('below')}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="px-2.5 py-1.5 rounded-lg bg-neutral-200 text-black text-xs font-extrabold">
                Below
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={belowPercent}
                onChange={(e) => {
                  setFilterType('below');
                  setBelowPercent(Math.min(100, Math.max(1, Number(e.target.value) || 0)));
                }}
                className="w-20 px-2.5 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] bg-white font-mono text-xs font-extrabold text-black text-center"
              />
              <span className="text-xs font-extrabold text-neutral-700">%</span>
            </div>
            <div className="font-mono text-[11px] font-extrabold text-[#0a6b3c]">
              raw = ({belowPercent}/100)×400 = &lt;{Math.round((belowPercent / 100) * 400)}
            </div>
          </div>

          {/* Option 2: BETWEEN [From %] [To %] */}
          <div
            onClick={() => setFilterType('between')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer space-y-2.5 ${
              filterType === 'between'
                ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                : 'border-neutral-200 bg-neutral-50/70 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                2. BETWEEN [% – %]
              </span>
              <input
                type="radio"
                checked={filterType === 'between'}
                onChange={() => setFilterType('between')}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
            </div>
            <div
              className="flex flex-wrap items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-[11px] font-bold text-neutral-600">From</span>
              <input
                type="number"
                min={0}
                max={100}
                value={betweenFromPercent}
                onChange={(e) => {
                  setFilterType('between');
                  setBetweenFromPercent(
                    Math.min(100, Math.max(0, Number(e.target.value) || 0))
                  );
                }}
                className="w-16 px-2 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] bg-white font-mono text-xs font-extrabold text-black text-center"
              />
              <span className="text-[11px] font-bold text-neutral-600">% To</span>
              <input
                type="number"
                min={0}
                max={100}
                value={betweenToPercent}
                onChange={(e) => {
                  setFilterType('between');
                  setBetweenToPercent(
                    Math.min(100, Math.max(0, Number(e.target.value) || 0))
                  );
                }}
                className="w-16 px-2 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] bg-white font-mono text-xs font-extrabold text-black text-center"
              />
              <span className="text-[11px] font-bold text-neutral-600">%</span>
            </div>
            <div className="font-mono text-[11px] font-extrabold text-[#0a6b3c]">
              raw = {Math.round((Math.min(betweenFromPercent, betweenToPercent) / 100) * 400)} –{' '}
              {Math.round((Math.max(betweenFromPercent, betweenToPercent) / 100) * 400)} / 400
            </div>
          </div>

          {/* Option 3: ABOVE [%] */}
          <div
            onClick={() => setFilterType('above')}
            className={`p-4 rounded-2xl border-2 transition-all cursor-pointer space-y-2.5 ${
              filterType === 'above'
                ? 'border-[#0a6b3c] bg-[#0a6b3c]/5'
                : 'border-neutral-200 bg-neutral-50/70 hover:border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-black">
                3. ABOVE [%]
              </span>
              <input
                type="radio"
                checked={filterType === 'above'}
                onChange={() => setFilterType('above')}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <span className="px-2.5 py-1.5 rounded-lg bg-neutral-200 text-black text-xs font-extrabold">
                Above
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={abovePercent}
                onChange={(e) => {
                  setFilterType('above');
                  setAbovePercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)));
                }}
                className="w-20 px-2.5 py-1.5 rounded-lg border border-neutral-300 focus:border-[#0a6b3c] bg-white font-mono text-xs font-extrabold text-black text-center"
              />
              <span className="text-xs font-extrabold text-neutral-700">%</span>
            </div>
            <div className="font-mono text-[11px] font-extrabold text-[#0a6b3c]">
              raw = ({abovePercent}/100)×400 = &gt;={Math.round((abovePercent / 100) * 400)}
            </div>
          </div>
        </div>

        {/* CHECKBOXES — STATISTICS ONLY, NO NAMES, NO REG NO */}
        <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3">
          <div className="text-xs font-extrabold uppercase tracking-wider text-neutral-700">
            Report Statistical Metrics (Checkboxes — Statistics Only, No Names, No Reg No):
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] cursor-pointer text-xs font-bold text-black">
              <input
                type="checkbox"
                checked={showTotalStudents}
                onChange={(e) => setShowTotalStudents(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Total Number of Students in this range</span>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] cursor-pointer text-xs font-bold text-black">
              <input
                type="checkbox"
                checked={showBestCenter}
                onChange={(e) => setShowBestCenter(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Best Performing Examination Centre (Name + Avg + Count)</span>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] cursor-pointer text-xs font-bold text-black">
              <input
                type="checkbox"
                checked={showHighestScore}
                onChange={(e) => setShowHighestScore(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Highest Score (Score only)</span>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] cursor-pointer text-xs font-bold text-black">
              <input
                type="checkbox"
                checked={showLowestScore}
                onChange={(e) => setShowLowestScore(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Lowest Score (Score only)</span>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] cursor-pointer text-xs font-bold text-black">
              <input
                type="checkbox"
                checked={showAverageScore}
                onChange={(e) => setShowAverageScore(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Average Score</span>
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-white border-2 border-[#0a6b3c] cursor-pointer text-xs font-extrabold text-[#0a6b3c]">
              <input
                type="checkbox"
                checked={showRangeBreakdownTable}
                onChange={(e) => setShowRangeBreakdownTable(e.target.checked)}
                className="accent-[#0a6b3c] w-4 h-4 cursor-pointer"
              />
              <span>Show Score Range Breakdown Table (Category, No of Candidates, %)</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleGenerateReportClick}
            className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs md:text-sm font-extrabold inline-flex items-center gap-2 shadow-xs cursor-pointer transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate Performance Report</span>
          </button>

          <button
            type="button"
            onClick={generatePDF}
            className="px-5 py-3 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c] hover:text-white text-xs md:text-sm font-extrabold inline-flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download as PDF</span>
          </button>
        </div>
      </section>

      {/* GENERATED REPORT DISPLAY CONTAINER (With Brand Logo, Dynamic Header, Section 1 Summary Cards & Section 2 Breakdown Table) */}
      <section className="rounded-3xl border-2 border-[#0a6b3c] overflow-hidden bg-white text-black shadow-xs">
        {/* Dynamic Official Report Header Banner */}
        <div className="bg-[#0a6b3c] text-white p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-4">
            <div className="p-1.5 rounded-2xl bg-white/10 border border-white/20 shrink-0">
              <QuemintSeal size="lg" variant="white" showText={false} />
            </div>
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/15 text-emerald-200 font-mono text-[10px] font-extrabold uppercase tracking-wider">
                <span>OFFICIAL {brandName.toUpperCase()} PERFORMANCE REPORT</span>
              </div>
              <h1 className="text-lg md:text-2xl font-extrabold text-white tracking-tight">
                {reportHeaderTitle}
              </h1>
              <p className="text-xs text-emerald-100 font-medium">
                {reportHeaderSubtitle}
              </p>
              <div className="pt-1 flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-lg bg-black/30 border border-white/20 text-white font-mono text-xs font-extrabold">
                  Filter: {scoreFilterBounds.label}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={generatePDF}
            className="px-4 py-2.5 rounded-xl bg-white text-[#0a6b3c] hover:bg-emerald-50 text-xs font-extrabold inline-flex items-center gap-2 shadow-sm cursor-pointer shrink-0 self-start md:self-center"
          >
            <Download className="w-4 h-4" />
            <span>Download as PDF</span>
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* SECTION 1: Summary Cards (5 Cards — Pure Statistics, NO Names) */}
          {(showTotalStudents ||
            showHighestScore ||
            showLowestScore ||
            showAverageScore ||
            showBestCenter) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                  Section 1: Statistical Summary Cards (Zero Candidate Identifiers)
                </h3>
                <span className="text-[11px] font-mono text-neutral-500">
                  Scale: 400 Aggregate Points
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Card 1: Total Number of Students Found */}
                {showTotalStudents && (
                  <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50/70 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                        Total Students Found
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
                        <Users className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="font-mono text-3xl font-extrabold text-black tabular-nums">
                      {summaryStats.totalStudents}
                    </div>
                    <div className="text-[11px] font-bold text-[#0a6b3c]">
                      Candidates in filtered range
                    </div>
                  </div>
                )}

                {/* Card 2: Highest Score (Score Only — NO NAME) */}
                {showHighestScore && (
                  <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50/70 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                        Highest Score
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 text-[#0a6b3c] flex items-center justify-center">
                        <TrendingUp className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="font-mono text-xl font-extrabold text-black tabular-nums">
                      {summaryStats.highestScore !== null
                        ? `${summaryStats.highestScore}/400 (${summaryStats.highestPct}%)`
                        : 'N/A'}
                    </div>
                    <div className="text-[11px] font-bold text-neutral-500">
                      Score only • Anonymous
                    </div>
                  </div>
                )}

                {/* Card 3: Lowest Score (Score Only — NO NAME) */}
                {showLowestScore && (
                  <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50/70 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                        Lowest Score
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                        <TrendingDown className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="font-mono text-xl font-extrabold text-black tabular-nums">
                      {summaryStats.lowestScore !== null
                        ? `${summaryStats.lowestScore}/400 (${summaryStats.lowestPct}%)`
                        : 'N/A'}
                    </div>
                    <div className="text-[11px] font-bold text-neutral-500">
                      Score only • Anonymous
                    </div>
                  </div>
                )}

                {/* Card 4: Average Score */}
                {showAverageScore && (
                  <div className="p-4 rounded-2xl border border-neutral-200 bg-neutral-50/70 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-neutral-500">
                        Average Score
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-[#0a6b3c]/10 text-[#0a6b3c] flex items-center justify-center">
                        <Award className="w-4 h-4" />
                      </div>
                    </div>
                    <div className="font-mono text-2xl font-extrabold text-black tabular-nums">
                      {summaryStats.totalStudents > 0 ? summaryStats.averageScore : '0'}
                    </div>
                    <div className="text-[11px] font-bold text-[#0a6b3c]">
                      {summaryStats.totalStudents > 0
                        ? `${summaryStats.averageScore}/400 (${summaryStats.averagePct}%)`
                        : 'No candidates in range'}
                    </div>
                  </div>
                )}

                {/* Card 5: Best Performing Examination Centre */}
                {showBestCenter && (
                  <div className="p-4 rounded-2xl border-2 border-[#0a6b3c] bg-[#0a6b3c]/5 flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        Best Examination Centre
                      </span>
                      <div className="w-8 h-8 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center">
                        <MapPin className="w-4 h-4" />
                      </div>
                    </div>
                    {summaryStats.bestCenter ? (
                      <>
                        <div className="font-extrabold text-sm text-black truncate">
                          {summaryStats.bestCenter.name}
                        </div>
                        <div className="font-mono text-[11px] font-extrabold text-[#0a6b3c]">
                          Average: {summaryStats.bestCenter.average} | Candidates:{' '}
                          {summaryStats.bestCenter.candidatesCount}
                        </div>
                      </>
                    ) : (
                      <div className="font-mono text-sm font-bold text-neutral-500">
                        N/A
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 2: Score Range Breakdown Table (Category / Score Range | No of Candidates | % of Total) */}
          {showRangeBreakdownTable && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-extrabold text-black">
                    {breakdownTableTitle}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Pure statistical score range distribution — no candidate names or registration numbers are shown.
                  </p>
                </div>

                {scoreFilterBounds.isSubRange && (
                  <button
                    type="button"
                    onClick={() => setShowAllBracketsWhenFiltered((prev) => !prev)}
                    className="px-3 py-1.5 rounded-xl border border-neutral-300 hover:border-[#0a6b3c] text-xs font-extrabold text-neutral-700 hover:text-[#0a6b3c] cursor-pointer self-start sm:self-center"
                  >
                    {showAllBracketsWhenFiltered
                      ? 'Show Only Filtered Range Brackets'
                      : 'Show All 0–400 Brackets'}
                  </button>
                )}
              </div>

              <div className="rounded-2xl border-2 border-neutral-200 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0a6b3c] text-white text-xs font-extrabold uppercase tracking-wider">
                      <th className="py-3.5 px-4 border-r border-white/15">
                        CATEGORY / SCORE RANGE
                      </th>
                      <th className="py-3.5 px-4 text-center border-r border-white/15">
                        NO OF CANDIDATES
                      </th>
                      <th className="py-3.5 px-4 text-right">% OF TOTAL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 text-xs md:text-sm">
                    {breakdownRows.map((row) => (
                      <tr
                        key={row.id}
                        className={
                          row.isCumulativeTop
                            ? 'bg-[#0a6b3c]/10 font-extrabold text-[#0a6b3c]'
                            : 'bg-white hover:bg-neutral-50 text-black'
                        }
                      >
                        <td className="py-3 px-4 font-mono font-extrabold border-r border-neutral-200">
                          <div className="flex items-center gap-2">
                            <span>{row.label}</span>
                            {row.isCumulativeTop && (
                              <span className="px-2 py-0.5 rounded bg-[#0a6b3c] text-white font-sans text-[10px] font-extrabold uppercase">
                                Sum of 320+ &amp; 300–319
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-extrabold tabular-nums border-r border-neutral-200">
                          {row.count}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-extrabold tabular-nums">
                          <div className="inline-flex items-center justify-end gap-2.5 w-full">
                            <div className="w-20 h-2 bg-neutral-100 rounded-full overflow-hidden hidden sm:block border border-neutral-200">
                              <div
                                className="h-full bg-[#0a6b3c]"
                                style={{ width: `${Math.min(100, row.pct)}%` }}
                              />
                            </div>
                            <span className="min-w-[52px] text-right">
                              {row.pctFormatted}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}

                    {/* Grand Total Row */}
                    <tr className="bg-neutral-900 text-white font-extrabold text-xs md:text-sm">
                      <td className="py-3.5 px-4 font-mono uppercase tracking-wider border-r border-neutral-700">
                        {scoreFilterBounds.isSubRange ? 'TOTAL IN THIS RANGE' : 'TOTAL'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono text-base tabular-nums text-emerald-400 border-r border-neutral-700">
                        {summaryStats.totalStudents}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-emerald-400 tabular-nums">
                        {summaryStats.totalStudents > 0 ? '100%' : '0%'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Official Report Footer */}
          <div className="pt-4 border-t border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-neutral-500">
            <div className="flex items-center gap-2 font-extrabold text-[#0a6b3c]">
              <QuemintSeal size="sm" showText={false} />
              <span>Generated by {brandName}</span>
            </div>
            <div className="font-mono text-[11px]">
              {activeTab === 'per_code'
                ? `Code: ${selectedExamMeta.code} (${selectedExamMeta.title})`
                : 'Scope: All Exam Codes Combined'}{' '}
              • Total Candidates in Range: {summaryStats.totalStudents}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
