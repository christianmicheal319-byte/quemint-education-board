import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Filter,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  Award,
  CheckSquare,
  Square,
  Table as TableIcon,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Candidate, ExamCenter, ExamResult, ExamSettings, PublishedTest } from '../types';
import { drawOfficialSeal } from '../utils/pdfSlipGenerator';

interface PerformanceAnalysisPanelProps {
  results: ExamResult[];
  settings: ExamSettings;
  candidates?: Candidate[];
  examCenters?: ExamCenter[];
}

type FilterOperator = 'ALL' | 'BELOW' | 'BETWEEN' | 'ABOVE';

interface ScoreBandRow {
  label: string;
  minScore: number;
  maxScore: number;
  isSummaryRow?: boolean;
  count: number;
  percentageOfTotal: string;
}

export const PerformanceAnalysisPanel: React.FC<PerformanceAnalysisPanelProps> = ({
  results,
  settings,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overall' | 'per_code'>('per_code');

  const availableExamCodes = useMemo(() => {
    const codesSet = new Set<string>();
    (settings.publishedTests || []).forEach((pt: PublishedTest) => {
      if (pt.testCode) codesSet.add(pt.testCode.trim().toUpperCase());
    });
    results.forEach((r) => {
      if (r.testCode) codesSet.add(r.testCode.trim().toUpperCase());
    });
    if (settings.testAccessCode) {
      codesSet.add(settings.testAccessCode.trim().toUpperCase());
    }
    codesSet.add('QMT3045B');
    return Array.from(codesSet);
  }, [settings.publishedTests, settings.testAccessCode, results]);

  const [selectedExamCode, setSelectedExamCode] = useState<string>(
    availableExamCodes[0] || 'QMT3045B'
  );

  // Filter Builder State
  const [filterMode, setFilterMode] = useState<FilterOperator>('ALL');
  const [belowPercent, setBelowPercent] = useState<number>(75);
  const [betweenFromPercent, setBetweenFromPercent] = useState<number>(75);
  const [betweenToPercent, setBetweenToPercent] = useState<number>(80);
  const [abovePercent, setAbovePercent] = useState<number>(75);

  // Pure Statistics Checkboxes (NO NAMES, NO REG NO)
  const [showTotalStudents, setShowTotalStudents] = useState<boolean>(true);
  const [showBestCentre, setShowBestCentre] = useState<boolean>(true);
  const [showHighestScore, setShowHighestScore] = useState<boolean>(true);
  const [showLowestScore, setShowLowestScore] = useState<boolean>(true);
  const [showAverageScore, setShowAverageScore] = useState<boolean>(true);
  const [showBreakdownTable, setShowBreakdownTable] = useState<boolean>(true);

  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>(() =>
    new Date().toLocaleString()
  );

  // Base results for the active tab (All Codes vs Selected Exam Code)
  const baseResultsForTab = useMemo(() => {
    if (activeSubTab === 'overall') {
      return results;
    }
    const target = selectedExamCode.trim().toUpperCase();
    const matched = results.filter(
      (r) => (r.testCode || settings.testAccessCode || 'QMT3045B').trim().toUpperCase() === target
    );
    // If all results belong to default exam when testCode wasn't explicitly tagged on legacy rows
    if (matched.length === 0 && target === 'QMT3045B') {
      return results;
    }
    return matched;
  }, [activeSubTab, results, selectedExamCode, settings.testAccessCode]);

  // Convert percentage (0-100%) to raw score out of 400: raw = (%/100)*400
  const filterBounds = useMemo(() => {
    if (filterMode === 'BELOW') {
      const maxRaw = Math.round((belowPercent / 100) * 400);
      return {
        minRaw: 0,
        maxRawExclusive: maxRaw,
        maxRawInclusive: maxRaw - 1,
        description: `Below ${belowPercent}% (Raw Score < ${maxRaw}/400)`,
      };
    }
    if (filterMode === 'BETWEEN') {
      const fromRaw = Math.round((Math.min(betweenFromPercent, betweenToPercent) / 100) * 400);
      const toRaw = Math.round((Math.max(betweenFromPercent, betweenToPercent) / 100) * 400);
      return {
        minRaw: fromRaw,
        maxRawExclusive: toRaw + 1,
        maxRawInclusive: toRaw,
        description: `Between ${betweenFromPercent}% and ${betweenToPercent}% (Raw Score ${fromRaw} - ${toRaw}/400)`,
      };
    }
    if (filterMode === 'ABOVE') {
      const minRaw = Math.round((abovePercent / 100) * 400);
      return {
        minRaw,
        maxRawExclusive: 401,
        maxRawInclusive: 400,
        description: `Above ${abovePercent}% (Raw Score >= ${minRaw}/400)`,
      };
    }
    return {
      minRaw: 0,
      maxRawExclusive: 401,
      maxRawInclusive: 400,
      description: 'Overall Full Distribution (0% - 100% / 0 - 400)',
    };
  }, [filterMode, belowPercent, betweenFromPercent, betweenToPercent, abovePercent]);

  const filteredResults = useMemo(() => {
    return baseResultsForTab.filter((r) => {
      const raw = r.score;
      if (filterMode === 'BELOW') {
        return raw < filterBounds.maxRawExclusive;
      }
      if (filterMode === 'BETWEEN') {
        return raw >= filterBounds.minRaw && raw <= filterBounds.maxRawInclusive;
      }
      if (filterMode === 'ABOVE') {
        return raw >= filterBounds.minRaw;
      }
      return true;
    });
  }, [baseResultsForTab, filterMode, filterBounds]);

  // Pure Statistical Summary (Strictly NO candidate names or registration numbers)
  const summaryStats = useMemo(() => {
    const count = filteredResults.length;
    if (count === 0) {
      return {
        totalStudents: 0,
        highestRaw: 0,
        highestPct: '0.00',
        lowestRaw: 0,
        lowestPct: '0.00',
        averageRaw: '0.0',
        averagePct: '0.00',
        bestCentre: {
          name: 'N/A',
          average: '0.0',
          candidates: 0,
        },
      };
    }

    const scores = filteredResults.map((r) => r.score);
    const highestRaw = Math.max(...scores);
    const lowestRaw = Math.min(...scores);
    const sumRaw = scores.reduce((acc, s) => acc + s, 0);
    const avgRaw = sumRaw / count;

    // Best Performing Examination Centre (Name + Average + Count)
    const centreGroups: Record<string, { sum: number; count: number }> = {};
    filteredResults.forEach((r) => {
      const cName = (r.examCenterName || 'Q Zone 1 (Lagos Main)').trim();
      if (!centreGroups[cName]) {
        centreGroups[cName] = { sum: 0, count: 0 };
      }
      centreGroups[cName].sum += r.score;
      centreGroups[cName].count += 1;
    });

    let bestCentreName = 'N/A';
    let bestCentreAvg = -1;
    let bestCentreCount = 0;

    Object.entries(centreGroups).forEach(([cName, data]) => {
      const cAvg = data.sum / data.count;
      if (cAvg > bestCentreAvg) {
        bestCentreAvg = cAvg;
        bestCentreName = cName;
        bestCentreCount = data.count;
      }
    });

    return {
      totalStudents: count,
      highestRaw,
      highestPct: ((highestRaw / 400) * 100).toFixed(2),
      lowestRaw,
      lowestPct: ((lowestRaw / 400) * 100).toFixed(2),
      averageRaw: avgRaw.toFixed(1),
      averagePct: ((avgRaw / 400) * 100).toFixed(2),
      bestCentre: {
        name: bestCentreName,
        average: bestCentreAvg >= 0 ? bestCentreAvg.toFixed(1) : '0.0',
        candidates: bestCentreCount,
      },
    };
  }, [filteredResults]);

  // JAMB-Style Score Range Breakdown Table
  const breakdownRows = useMemo<ScoreBandRow[]>(() => {
    const standardBands: {
      label: string;
      minScore: number;
      maxScore: number;
      isSummaryRow?: boolean;
    }[] = [
      { label: '320 - ABOVE', minScore: 320, maxScore: 400 },
      { label: '300 - 319', minScore: 300, maxScore: 319 },
      { label: '300 - ABOVE (Top Tier Sum)', minScore: 300, maxScore: 400, isSummaryRow: true },
      { label: '250 - 299', minScore: 250, maxScore: 299 },
      { label: '200 - 249', minScore: 200, maxScore: 249 },
      { label: '160 - 199', minScore: 160, maxScore: 199 },
      { label: '140 - 159', minScore: 140, maxScore: 159 },
      { label: '120 - 139', minScore: 120, maxScore: 139 },
      { label: '100 - 119', minScore: 100, maxScore: 119 },
      { label: 'BELOW 100', minScore: 0, maxScore: 99 },
    ];

    const relevantBands = standardBands.filter((band) => {
      if (filterMode === 'ALL') return true;
      if (filterMode === 'ABOVE' && abovePercent === 0) return true;
      return (
        band.maxScore >= filterBounds.minRaw &&
        band.minScore <= filterBounds.maxRawInclusive
      );
    });

    const denominator = Math.max(1, filteredResults.length);

    return relevantBands.map((band) => {
      const count = filteredResults.filter(
        (r) => r.score >= band.minScore && r.score <= band.maxScore
      ).length;
      const pct =
        filteredResults.length > 0 ? ((count / denominator) * 100).toFixed(2) : '0.00';
      return {
        ...band,
        count,
        percentageOfTotal: `${pct}%`,
      };
    });
  }, [filteredResults, filterMode, abovePercent, filterBounds]);

  const handleExportPdf = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(10, 107, 60);
    doc.rect(0, 0, pageWidth, 86, 'F');
    drawOfficialSeal(doc, 46, 43, 24);

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('QUEMINT EDUCATION BOARD', 82, 34);
    doc.setFontSize(10);
    doc.text(
      activeSubTab === 'overall'
        ? 'OVERALL STATISTICAL PERFORMANCE REPORT (ALL EXAM CODES)'
        : `STATISTICAL PERFORMANCE & SCORE DISTRIBUTION FOR ${selectedExamCode}`,
      82,
      52
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(
      `Filter: ${filterBounds.description} • Pure Statistics Only (No Candidate Names/Reg Nos)`,
      82,
      68
    );

    const summaryBody: string[][] = [];
    if (showTotalStudents) {
      summaryBody.push(['Total Number of Students Found', `${summaryStats.totalStudents}`]);
    }
    if (showHighestScore) {
      summaryBody.push([
        'Highest Score (Score Only)',
        `${summaryStats.highestRaw}/400 (${summaryStats.highestPct}%)`,
      ]);
    }
    if (showLowestScore) {
      summaryBody.push([
        'Lowest Score (Score Only)',
        `${summaryStats.lowestRaw}/400 (${summaryStats.lowestPct}%)`,
      ]);
    }
    if (showAverageScore) {
      summaryBody.push([
        'Average Score',
        `${summaryStats.averageRaw}/400 (${summaryStats.averagePct}%)`,
      ]);
    }
    if (showBestCentre) {
      summaryBody.push([
        'Best Performing Examination Centre',
        `${summaryStats.bestCentre.name} | Average: ${summaryStats.bestCentre.average} | Candidates: ${summaryStats.bestCentre.candidates}`,
      ]);
    }

    autoTable(doc, {
      startY: 104,
      head: [['STATISTICAL METRIC', 'VALUE']],
      body: summaryBody,
      headStyles: { fillColor: [10, 107, 60], textColor: [255, 255, 255] },
      styles: { fontSize: 9, cellPadding: 6 },
    });

    if (showBreakdownTable) {
      const nextY = (doc as any).lastAutoTable?.finalY
        ? (doc as any).lastAutoTable.finalY + 22
        : 240;

      const distRows = breakdownRows.map((b) => [
        b.label,
        `${b.count}`,
        b.percentageOfTotal,
      ]);
      distRows.push([
        filterMode === 'ALL' ? 'TOTAL' : 'TOTAL IN THIS RANGE',
        `${filteredResults.length}`,
        filteredResults.length > 0 ? '100.00%' : '0.00%',
      ]);

      autoTable(doc, {
        startY: nextY,
        head: [['CATEGORY / SCORE RANGE', 'NO OF CANDIDATES', '% OF TOTAL']],
        body: distRows,
        headStyles: { fillColor: [10, 107, 60], textColor: [255, 255, 255] },
        styles: { fontSize: 9, cellPadding: 6 },
      });
    }

    const codeLabel = activeSubTab === 'overall' ? 'ALL_CODES' : selectedExamCode;
    doc.save(`Quemint_Performance_Analysis_${codeLabel}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Tabs: Tab 1 = Overall Performance (All Codes), Tab 2 = Per Exam Code */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#0a6b3c]">
                PURE STATISTICAL ANALYTICS • NO CANDIDATE NAMES OR REG NUMBERS
              </span>
              <h2 className="text-xl font-extrabold text-black">
                Performance Analysis &amp; Score Range Breakdown
              </h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSubTab('overall')}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                activeSubTab === 'overall'
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              Tab 1: Overall Performance (All Codes)
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('per_code')}
              className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                activeSubTab === 'per_code'
                  ? 'bg-[#0a6b3c] text-white shadow-xs'
                  : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
              }`}
            >
              Tab 2: Per Exam Code ({selectedExamCode})
            </button>
          </div>
        </div>

        {/* Top Exam Code Dropdown when Tab 2 is active */}
        {activeSubTab === 'per_code' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-[#0a6b3c]/5 border border-[#0a6b3c]/25">
            <div>
              <label className="block text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                Select Exam Code
              </label>
              <p className="text-xs text-neutral-600 mt-0.5">
                View statistical score range breakdown and centre averages for a specific examination code.
              </p>
            </div>
            <select
              value={selectedExamCode}
              onChange={(e) => setSelectedExamCode(e.target.value)}
              className="px-4 py-2.5 rounded-xl border-2 border-[#0a6b3c] bg-white text-black font-mono text-sm font-extrabold focus:outline-none cursor-pointer"
            >
              {availableExamCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* FILTER BUILDER */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          <div className="lg:col-span-7 p-5 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#0a6b3c]">
                <Filter className="w-4 h-4" />
                <h3 className="text-sm font-extrabold uppercase tracking-wider">
                  Generate Performance Report — Filter Builder
                </h3>
              </div>
              <span className="text-[11px] font-mono font-bold text-neutral-600">
                Scale: 400 Max Aggregate
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { id: 'ALL', label: 'All (0% - 100%)' },
                  { id: 'BELOW', label: '1. BELOW %' },
                  { id: 'BETWEEN', label: '2. BETWEEN %' },
                  { id: 'ABOVE', label: '3. ABOVE %' },
                ] as { id: FilterOperator; label: string }[]
              ).map((op) => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setFilterMode(op.id)}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-extrabold transition-colors cursor-pointer ${
                    filterMode === op.id
                      ? 'bg-[#0a6b3c] text-white border-[#0a6b3c]'
                      : 'bg-white text-black border-neutral-300 hover:border-[#0a6b3c]'
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>

            {filterMode === 'BELOW' && (
              <div className="p-4 rounded-xl bg-white border border-neutral-200 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-extrabold text-black">Score Below (%):</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={belowPercent}
                  onChange={(e) =>
                    setBelowPercent(Math.max(1, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="w-24 px-3 py-2 rounded-lg border border-neutral-300 font-mono font-extrabold text-black"
                />
                <span className="font-mono font-bold text-[#0a6b3c]">
                  → Raw Score &lt; {Math.round((belowPercent / 100) * 400)} / 400
                </span>
              </div>
            )}

            {filterMode === 'BETWEEN' && (
              <div className="p-4 rounded-xl bg-white border border-neutral-200 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-extrabold text-black">From (%):</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={betweenFromPercent}
                  onChange={(e) =>
                    setBetweenFromPercent(
                      Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    )
                  }
                  className="w-20 px-3 py-2 rounded-lg border border-neutral-300 font-mono font-extrabold text-black"
                />
                <span className="font-extrabold text-black">To (%):</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={betweenToPercent}
                  onChange={(e) =>
                    setBetweenToPercent(
                      Math.max(0, Math.min(100, Number(e.target.value) || 0))
                    )
                  }
                  className="w-20 px-3 py-2 rounded-lg border border-neutral-300 font-mono font-extrabold text-black"
                />
                <span className="font-mono font-bold text-[#0a6b3c]">
                  → Raw Score {Math.round((betweenFromPercent / 100) * 400)} -{' '}
                  {Math.round((betweenToPercent / 100) * 400)} / 400
                </span>
              </div>
            )}

            {filterMode === 'ABOVE' && (
              <div className="p-4 rounded-xl bg-white border border-neutral-200 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-extrabold text-black">Score Above (%):</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={abovePercent}
                  onChange={(e) =>
                    setAbovePercent(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                  }
                  className="w-24 px-3 py-2 rounded-lg border border-neutral-300 font-mono font-extrabold text-black"
                />
                <span className="font-mono font-bold text-[#0a6b3c]">
                  → Raw Score &gt;= {Math.round((abovePercent / 100) * 400)} / 400
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReportGeneratedAt(new Date().toLocaleString())}
                className="px-5 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold uppercase tracking-wider cursor-pointer shadow-xs"
              >
                Generate Performance Report
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                className="px-4 py-3 rounded-xl border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/5 text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Statistical Report (PDF)</span>
              </button>
            </div>
          </div>

          {/* CHECKBOXES - STATISTICS ONLY, NO NAMES, NO REG NO */}
          <div className="lg:col-span-5 p-5 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
              Report Metrics Checkboxes (Statistics Only — No Names)
            </div>
            <div className="space-y-2 text-xs">
              {[
                {
                  label: 'Show Total Number of Students in this range',
                  checked: showTotalStudents,
                  toggle: () => setShowTotalStudents((p) => !p),
                },
                {
                  label: 'Show Best Performing Examination Centre (Name + Average + Count)',
                  checked: showBestCentre,
                  toggle: () => setShowBestCentre((p) => !p),
                },
                {
                  label: 'Show Highest Score (Score only)',
                  checked: showHighestScore,
                  toggle: () => setShowHighestScore((p) => !p),
                },
                {
                  label: 'Show Lowest Score (Score only)',
                  checked: showLowestScore,
                  toggle: () => setShowLowestScore((p) => !p),
                },
                {
                  label: 'Show Average Score',
                  checked: showAverageScore,
                  toggle: () => setShowAverageScore((p) => !p),
                },
                {
                  label: 'Show Score Range Breakdown Table (Category, No of Candidates, %)',
                  checked: showBreakdownTable,
                  toggle: () => setShowBreakdownTable((p) => !p),
                },
              ].map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={item.toggle}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white border border-neutral-200 hover:border-[#0a6b3c] text-left font-bold text-black cursor-pointer"
                >
                  {item.checked ? (
                    <CheckSquare className="w-4 h-4 text-[#0a6b3c] shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-neutral-400 shrink-0" />
                  )}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: Summary Cards (5 cards, Pure Statistics, NO NAMES) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {showTotalStudents && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase text-neutral-500">
              <span>Total Students Found</span>
              <Users className="w-4 h-4 text-[#0a6b3c]" />
            </div>
            <div className="text-3xl font-extrabold text-black font-mono tabular-nums">
              {summaryStats.totalStudents}
            </div>
            <div className="text-[11px] text-neutral-500 font-semibold">
              {filterBounds.description}
            </div>
          </div>
        )}

        {showHighestScore && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase text-neutral-500">
              <span>Highest Score</span>
              <TrendingUp className="w-4 h-4 text-[#0a6b3c]" />
            </div>
            <div className="text-2xl font-extrabold text-[#0a6b3c] font-mono tabular-nums">
              {summaryStats.highestRaw}/400
            </div>
            <div className="text-xs font-bold text-black font-mono">
              ({summaryStats.highestPct}%) • Score Only
            </div>
          </div>
        )}

        {showLowestScore && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase text-neutral-500">
              <span>Lowest Score</span>
              <TrendingDown className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-extrabold text-black font-mono tabular-nums">
              {summaryStats.lowestRaw}/400
            </div>
            <div className="text-xs font-bold text-neutral-600 font-mono">
              ({summaryStats.lowestPct}%) • Score Only
            </div>
          </div>
        )}

        {showAverageScore && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase text-neutral-500">
              <span>Average Score</span>
              <Award className="w-4 h-4 text-[#0a6b3c]" />
            </div>
            <div className="text-2xl font-extrabold text-black font-mono tabular-nums">
              {summaryStats.averageRaw}
            </div>
            <div className="text-xs font-bold text-[#0a6b3c] font-mono">
              Mean Percentage: {summaryStats.averagePct}%
            </div>
          </div>
        )}

        {showBestCentre && (
          <div className="bg-white rounded-2xl border-2 border-[#0a6b3c] p-5 shadow-xs space-y-1.5">
            <div className="flex items-center justify-between text-xs font-extrabold uppercase text-[#0a6b3c]">
              <span>Best Performing Centre</span>
              <Building2 className="w-4 h-4 text-[#0a6b3c]" />
            </div>
            <div className="text-sm font-extrabold text-black truncate">
              {summaryStats.bestCentre.name}
            </div>
            <div className="text-xs font-bold text-[#0a6b3c] font-mono">
              Average: {summaryStats.bestCentre.average} | Candidates:{' '}
              {summaryStats.bestCentre.candidates}
            </div>
          </div>
        )}
      </div>

      {/* SECTION 2: Score Range Breakdown Table */}
      {showBreakdownTable && (
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
          <div className="bg-[#0a6b3c] text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <TableIcon className="w-5 h-5" />
              <div>
                <h3 className="text-base font-extrabold tracking-tight">
                  {activeSubTab === 'overall'
                    ? 'Score Distribution — Overall Performance (All Exam Codes)'
                    : `Score Distribution for ${selectedExamCode}`}
                </h3>
                <p className="text-xs text-white/85">
                  Active Filter: {filterBounds.description} • Generated {reportGeneratedAt}
                </p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-[#0e8a4e] text-xs font-mono font-extrabold">
              Total Candidates: {filteredResults.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-neutral-200 bg-neutral-50 text-xs font-extrabold uppercase tracking-wider text-neutral-700">
                  <th className="py-3.5 px-6">CATEGORY / SCORE RANGE</th>
                  <th className="py-3.5 px-6 text-right">NO OF CANDIDATES</th>
                  <th className="py-3.5 px-6 text-right">% OF TOTAL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 text-sm">
                {breakdownRows.map((row) => (
                  <tr
                    key={row.label}
                    className={
                      row.isSummaryRow
                        ? 'bg-[#0a6b3c]/10 font-extrabold text-[#0a6b3c]'
                        : 'hover:bg-neutral-50 font-semibold text-black'
                    }
                  >
                    <td className="py-3.5 px-6 font-mono">{row.label}</td>
                    <td className="py-3.5 px-6 text-right font-mono tabular-nums">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono tabular-nums">
                      {row.percentageOfTotal}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#0a6b3c] text-white font-extrabold text-sm">
                  <td className="py-4 px-6 uppercase tracking-wider">
                    {filterMode === 'ALL'
                      ? `TOTAL (${
                          activeSubTab === 'overall' ? 'ALL CODES' : selectedExamCode
                        })`
                      : 'TOTAL IN THIS RANGE'}
                  </td>
                  <td className="py-4 px-6 text-right font-mono tabular-nums">
                    {filteredResults.length.toLocaleString()}
                  </td>
                  <td className="py-4 px-6 text-right font-mono tabular-nums">
                    {filteredResults.length > 0 ? '100%' : '0%'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
