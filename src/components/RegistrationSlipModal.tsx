import React, { useState } from 'react';
import { Printer, X, Camera, CheckCircle2, Phone, Mail, ShieldCheck, Copy, Check, Download } from 'lucide-react';
import { Candidate } from '../types';
import { QuemintSeal } from './QuemintSeal';
import { LivePhotoCaptureCard } from './LivePhotoCaptureCard';
import { downloadRegistrationSlipPdf } from '../utils/pdfSlipGenerator';

interface RegistrationSlipModalProps {
  candidate: Candidate;
  onClose: () => void;
  onUpdatePassport?: (candidateId: string, dataUrl: string) => void;
  isFreeRegistration?: boolean;
}

export const RegistrationSlipModal: React.FC<RegistrationSlipModalProps> = ({
  candidate,
  onClose,
  onUpdatePassport,
  isFreeRegistration,
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showLiveCameraModal, setShowLiveCameraModal] = useState<boolean>(false);

  const isFree =
    Boolean(isFreeRegistration) ||
    candidate.paymentMethod === 'Free Registration' ||
    candidate.amountPaid === 0;

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const fullName = `${candidate.surname.toUpperCase()}, ${candidate.firstName} ${candidate.middleName || ''}`.trim();
  const uploadedPassportUrl =
    candidate.passportDataUrl && !candidate.passportDataUrl.startsWith('/proctoring/')
      ? candidate.passportDataUrl
      : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-xl border-2 border-[#0a6b3c] shadow-2xl overflow-hidden my-8">
        {/* Top Action Bar (Hidden when printing) */}
        <div className="no-print flex items-center justify-between px-6 py-3.5 bg-[#0a6b3c] text-white">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Official Examination Photocard & Registration Slip</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadRegistrationSlipPdf(candidate, isFree)}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-[#0a6b3c] font-extrabold text-xs rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF Slip
            </button>
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0e8a4e] text-white font-bold text-xs rounded-lg hover:bg-white/20 transition-colors cursor-pointer whitespace-nowrap shrink-0 border border-white/30"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#0e8a4e] text-white hover:bg-white/20 transition-colors cursor-pointer"
              aria-label="Close Slip"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Slip Container */}
        <div id="printable-registration-slip" className="p-6 md:p-8 bg-white text-black">
          {/* Official Header with Green Seal */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b-2 border-[#0a6b3c]">
            <QuemintSeal
              size="lg"
              variant="green"
              subtitle="Official Candidate Examination Photocard & Registration Slip"
            />
            <div className="text-left md:text-right">
              <div className="inline-block px-3 py-1 bg-[#0a6b3c] text-white text-xs font-bold tracking-wider uppercase rounded">
                2026/2027 CBT Examination Slip
              </div>
              <p className="text-xs text-neutral-600 mt-1 font-mono tabular-nums">
                Issued: {new Date(candidate.createdAt).toLocaleDateString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
          </div>

          {/* Main Candidate Bio-Data & Passport Photo Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-6 border-b border-neutral-200">
            {/* Bio-Data Columns (2 cols) */}
            <div className="md:col-span-2 space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c] mb-2">
                  1. Candidate Bio-Data & Category
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-neutral-50 p-4 rounded-lg border border-neutral-200">
                  <div>
                    <span className="block text-xs text-neutral-500">Full Name (Surname First)</span>
                    <span className="font-bold text-sm text-black">{fullName}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-neutral-500">First / Middle Name</span>
                    <span className="font-semibold text-sm text-black">
                      {candidate.firstName} {candidate.middleName || '—'}
                    </span>
                  </div>
                  <div>
                    <span className="block text-xs text-neutral-500">Gender</span>
                    <span className="font-semibold text-sm text-black">{candidate.gender}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-neutral-500">Examination Category</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 mt-0.5 rounded bg-[#0a6b3c] text-white text-xs font-bold">
                      {candidate.category.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Examination Credentials (Registration Number + Approval Status or PIN) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c] mb-2">
                  {isFree
                    ? '2. Official Examination Registration Number & Approval Status'
                    : '2. Official Examination Credentials (GREEN BOX Verified)'}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#0a6b3c]/5 p-4 rounded-lg border-2 border-[#0a6b3c]">
                  <div>
                    <span className="block text-xs font-semibold text-[#0a6b3c]">
                      Registration Number
                    </span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono font-extrabold text-lg text-black tabular-nums">
                        {candidate.regNumber || 'PENDING-REG'}
                      </span>
                      {candidate.regNumber && (
                        <button
                          type="button"
                          onClick={() => handleCopy(candidate.regNumber, 'reg')}
                          className="no-print p-1 text-[#0a6b3c] hover:bg-[#0a6b3c]/10 rounded cursor-pointer"
                          title="Copy Registration Number"
                        >
                          {copiedField === 'reg' ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {isFree ? (
                    <div>
                      <span className="block text-xs font-semibold text-[#0a6b3c]">
                        Admin Approval Status
                      </span>
                      <div className="mt-1">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-extrabold uppercase ${
                            candidate.paymentStatus === 'Paid'
                              ? 'bg-[#0a6b3c] text-white'
                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                          }`}
                        >
                          {candidate.paymentStatus === 'Paid'
                            ? 'Approved by Admin (Active)'
                            : 'Pending Admin Approval'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <span className="block text-xs font-semibold text-[#0a6b3c]">
                        GREEN BOX Examination PIN
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="font-mono font-extrabold text-lg text-[#0a6b3c] tabular-nums">
                          {candidate.pin || 'AWAITING PIN'}
                        </span>
                        {candidate.pin && (
                          <button
                            type="button"
                            onClick={() => handleCopy(candidate.pin, 'pin')}
                            className="no-print p-1 text-[#0a6b3c] hover:bg-[#0a6b3c]/10 rounded cursor-pointer"
                            title="Copy PIN"
                          >
                            {copiedField === 'pin' ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Passport Photo Area (1 col) — Completely blank until candidate uploads their own photo */}
            <div className="flex flex-col items-center justify-start">
              <div className="w-40 h-44 rounded-lg border-2 border-[#0a6b3c] bg-white flex flex-col items-center justify-center overflow-hidden relative shadow-sm">
                {uploadedPassportUrl ? (
                  <img
                    src={uploadedPassportUrl}
                    alt={`${fullName} Passport`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>

              {onUpdatePassport && (
                <div className="no-print mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowLiveCameraModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0a6b3c] bg-[#0a6b3c]/10 hover:bg-[#0a6b3c]/20 rounded-md transition-colors cursor-pointer"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {uploadedPassportUrl ? 'Retake Live Photo' : 'Capture Live Photo'}
                  </button>
                  {uploadedPassportUrl && (
                    <button
                      type="button"
                      onClick={() => onUpdatePassport(candidate.id, '')}
                      className="px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {showLiveCameraModal && onUpdatePassport && (
                <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
                  <div className="w-full max-w-lg bg-white text-black rounded-2xl border-2 border-[#0a6b3c] p-5 space-y-4 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                        Live Camera Photo Card Capture
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowLiveCameraModal(false)}
                        className="p-1 rounded-lg border border-neutral-300 hover:border-black cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <LivePhotoCaptureCard
                      currentPhotoUrl={uploadedPassportUrl}
                      onPhotoCaptured={(url) => {
                        onUpdatePassport(candidate.id, url);
                      }}
                      onClearPhoto={() => onUpdatePassport(candidate.id, '')}
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowLiveCameraModal(false)}
                        className="px-4 py-2 rounded-xl bg-[#0a6b3c] text-white text-xs font-extrabold cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center gap-1.5 text-xs font-bold text-[#0a6b3c]">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  Status:{' '}
                  {candidate.paymentStatus === 'Paid'
                    ? 'APPROVED'
                    : 'PENDING APPROVAL'}
                </span>
              </div>
            </div>
          </div>

          {/* Payment & Examination Schedule Details */}
          <div
            className={`grid grid-cols-1 ${
              isFree ? '' : 'md:grid-cols-2'
            } gap-6 py-5 border-b border-neutral-200`}
          >
            {!isFree && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c] mb-2">
                  3. Payment & Transaction Details
                </h3>
                <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Amount Paid:</span>
                    <span className="font-mono font-bold text-black tabular-nums">
                      ₦{candidate.amountPaid.toLocaleString()}.00
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Payment Method:</span>
                    <span className="font-semibold text-black">{candidate.paymentMethod}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Transaction Reference:</span>
                    <span className="font-mono font-semibold text-black tabular-nums">
                      {candidate.transactionRef}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-600">Verification Status:</span>
                    <span className="font-bold text-[#0a6b3c]">
                      {candidate.paymentStatus === 'Paid'
                        ? 'CONFIRMED & CLEARED'
                        : 'PENDING ADMIN CONFIRMATION'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#0a6b3c] mb-2">
                {isFree ? '3. Date & Time of Examination' : '4. Date & Time of Examination'}
              </h3>
              <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-600">Examination Date:</span>
                  <span className="font-bold text-black">{candidate.examDate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Examination Time:</span>
                  <span className="font-bold text-black">{candidate.examTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Examination Mode:</span>
                  <span className="font-semibold text-[#0a6b3c]">
                    Computer-Based Test (CBT Online Portal)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Registration Approval:</span>
                  <span className="font-bold text-[#0a6b3c]">
                    {candidate.paymentStatus === 'Paid'
                      ? 'Approved by Admin — Permitted to Log In with Reg No'
                      : 'Awaiting Admin Approval in Admin Panel'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Official Footer & Contact Information */}
          <div className="pt-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-[#0a6b3c] uppercase tracking-wide">
                Quemint Education Board — Official Support & Verification Desk
              </div>
              <div className="flex flex-wrap items-center gap-4 text-neutral-700 font-medium">
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-[#0a6b3c]" />
                  WhatsApp: <strong>08107812604 / 08142847261</strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-[#0a6b3c]" />
                  Email: <strong>christianevans895@gmail.com</strong>
                </span>
              </div>
            </div>

            <div className="text-left sm:text-right border-t sm:border-t-0 pt-2 sm:pt-0 border-neutral-200">
              <div className="text-[11px] font-bold text-[#0a6b3c]">REGISTRAR’S SEAL</div>
              <div className="text-[10px] text-neutral-500">
                Keep this slip safe. Required for examination login.
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Print CTA Bar (Hidden when printing) */}
        <div className="no-print px-6 py-4 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between">
          <span className="text-xs text-neutral-600">
            Green & White Official Slip • Ready for A4/Letter Printing or Save as PDF
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 rounded-lg transition-colors cursor-pointer"
            >
              Close Preview
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 border-2 border-[#0a6b3c] text-[#0a6b3c] hover:bg-[#0a6b3c]/10 text-xs font-extrabold rounded-lg transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print Slip
            </button>
            <button
              type="button"
              onClick={() => downloadRegistrationSlipPdf(candidate, isFree)}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold rounded-lg shadow-sm transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Download PDF Slip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
