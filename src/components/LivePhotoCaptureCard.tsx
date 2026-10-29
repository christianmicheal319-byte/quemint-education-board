import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  VideoOff,
  Sparkles,
} from 'lucide-react';

interface LivePhotoCaptureCardProps {
  currentPhotoUrl?: string;
  required?: boolean;
  onPhotoCaptured: (dataUrl: string) => void;
  onClearPhoto?: () => void;
  compact?: boolean;
}

interface FaceDetectionResult {
  faceCount: number;
  centeredInOval: boolean;
  message: string;
}

// Universal real-time canvas face detection fallback when native window.FaceDetector is not enabled
function detectFacesInCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): FaceDetectionResult {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Grid resolution for connected-component skin/face region clustering
  const gridCols = 24;
  const gridRows = 18;
  const cellW = width / gridCols;
  const cellH = height / gridRows;

  const skinGrid: boolean[][] = Array.from({ length: gridRows }, () =>
    Array(gridCols).fill(false)
  );

  let totalBrightness = 0;
  let totalPixelsSampled = 0;
  let edgeActivityInsideOval = 0;

  // Oval center & radii in normalized coordinates
  const ovalCx = width * 0.5;
  const ovalCy = height * 0.48;
  const ovalRx = width * 0.25;
  const ovalRy = height * 0.36;

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      let skinPixels = 0;
      let cellSamples = 0;

      const startX = Math.floor(gx * cellW);
      const startY = Math.floor(gy * cellH);
      const endX = Math.min(width - 2, Math.floor((gx + 1) * cellW));
      const endY = Math.min(height - 2, Math.floor((gy + 1) * cellH));

      for (let y = startY; y < endY; y += 2) {
        for (let x = startX; x < endX; x += 2) {
          const idx = (y * width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          totalBrightness += luma;
          totalPixelsSampled++;
          cellSamples++;

          // YCbCr conversion for broad human skin-tone & facial illumination detection across all skin tones
          const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
          const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

          const isSkinYCbCr =
            luma > 28 &&
            luma < 242 &&
            cb >= 72 &&
            cb <= 138 &&
            cr >= 128 &&
            cr <= 185 &&
            r > b;

          if (isSkinYCbCr) {
            skinPixels++;
          }

          // Check horizontal/vertical gradient (facial features: eyes, brows, nose, mouth) inside oval
          const normDx = (x - ovalCx) / ovalRx;
          const normDy = (y - ovalCy) / ovalRy;
          if (normDx * normDx + normDy * normDy <= 1.0) {
            const rightIdx = (y * width + (x + 1)) * 4;
            const downIdx = ((y + 1) * width + x) * 4;
            const lumaRight =
              0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];
            const lumaDown =
              0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];
            if (Math.abs(luma - lumaRight) + Math.abs(luma - lumaDown) > 22) {
              edgeActivityInsideOval++;
            }
          }
        }
      }

      if (cellSamples > 0 && skinPixels / cellSamples >= 0.32) {
        skinGrid[gy][gx] = true;
      }
    }
  }

  const avgBrightness = totalPixelsSampled > 0 ? totalBrightness / totalPixelsSampled : 0;
  if (avgBrightness < 18) {
    return {
      faceCount: 0,
      centeredInOval: false,
      message: 'Camera frame is too dark — Please ensure your face is well-lit',
    };
  }

  // Connected-components clustering to count distinct face blobs
  const visited: boolean[][] = Array.from({ length: gridRows }, () =>
    Array(gridCols).fill(false)
  );

  interface BlobCluster {
    cells: number;
    sumX: number;
    sumY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }

  const clusters: BlobCluster[] = [];

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      if (skinGrid[r][c] && !visited[r][c]) {
        const queue: [number, number][] = [[r, c]];
        visited[r][c] = true;
        const cluster: BlobCluster = {
          cells: 0,
          sumX: 0,
          sumY: 0,
          minX: c,
          maxX: c,
          minY: r,
          maxY: r,
        };

        while (queue.length > 0) {
          const [cr, cc] = queue.shift()!;
          cluster.cells++;
          cluster.sumX += cc;
          cluster.sumY += cr;
          cluster.minX = Math.min(cluster.minX, cc);
          cluster.maxX = Math.max(cluster.maxX, cc);
          cluster.minY = Math.min(cluster.minY, cr);
          cluster.maxY = Math.max(cluster.maxY, cr);

          const dirs = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ];
          for (const [dr, dc] of dirs) {
            const nr = cr + dr;
            const nc = cc + dc;
            if (
              nr >= 0 &&
              nr < gridRows &&
              nc >= 0 &&
              nc < gridCols &&
              skinGrid[nr][nc] &&
              !visited[nr][nc]
            ) {
              visited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }

        // Filter out tiny noise specks; keep face-sized clusters
        if (cluster.cells >= 6) {
          clusters.push(cluster);
        }
      }
    }
  }

  clusters.sort((a, b) => b.cells - a.cells);

  // Check if multiple significant separated face clusters exist
  const significantClusters = clusters.filter((cl) => cl.cells >= 10);
  if (significantClusters.length > 1) {
    const first = significantClusters[0];
    const second = significantClusters[1];
    const c1x = first.sumX / first.cells;
    const c2x = second.sumX / second.cells;
    if (second.cells >= first.cells * 0.38 && Math.abs(c1x - c2x) >= 5) {
      return {
        faceCount: significantClusters.length,
        centeredInOval: false,
        message: 'Multiple faces detected — Only 1 candidate is allowed in frame',
      };
    }
  }

  if (clusters.length === 0 || edgeActivityInsideOval < 15) {
    return {
      faceCount: 0,
      centeredInOval: false,
      message: 'Position your face clearly inside the oval guide',
    };
  }

  const primary = clusters[0];
  const centerCol = primary.sumX / primary.cells;
  const centerRow = primary.sumY / primary.cells;

  const normX = centerCol / gridCols;
  const normY = centerRow / gridRows;

  const isCentered =
    normX >= 0.25 && normX <= 0.75 && normY >= 0.2 && normY <= 0.78 && primary.cells >= 8;

  if (!isCentered) {
    return {
      faceCount: 0,
      centeredInOval: false,
      message: 'Center your face inside the green oval guide',
    };
  }

  return {
    faceCount: 1,
    centeredInOval: true,
    message: '1 Face Detected in Oval — Ready to Capture',
  };
}

export const LivePhotoCaptureCard: React.FC<LivePhotoCaptureCardProps> = ({
  currentPhotoUrl,
  required = false,
  onPhotoCaptured,
  onClearPhoto,
  compact = false,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [detectionStatus, setDetectionStatus] = useState<FaceDetectionResult>({
    faceCount: 0,
    centeredInOval: false,
    message: 'Click "Start Live Camera" to align your face inside the oval guide',
  });
  const [justCaptured, setJustCaptured] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const nativeDetectorRef = useRef<any>(null);

  // Initialize native FaceDetector if supported by the browser
  useEffect(() => {
    const win = window as any;
    if (typeof win !== 'undefined' && 'FaceDetector' in win) {
      try {
        nativeDetectorRef.current = new win.FaceDetector({
          fastMode: true,
          maxDetectedFaces: 5,
        });
      } catch {
        nativeDetectorRef.current = null;
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    setStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((t) => t.stop());
      }
      return null;
    });
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = async () => {
    setCameraError('');
    setJustCaptured(false);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Live camera API (navigator.mediaDevices.getUserMedia) is not supported in this browser.'
      );
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      setStream(mediaStream);
      setCameraActive(true);
    } catch {
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        setStream(fallbackStream);
        setCameraActive(true);
      } catch {
        setCameraError(
          'Unable to access live camera. Please grant camera permission in your browser to capture your Photo Card.'
        );
      }
    }
  };

  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [stream, cameraActive]);

  // Real-time face detection loop while camera is active
  useEffect(() => {
    if (!cameraActive || !stream) return;

    let isCancelled = false;
    const interval = setInterval(async () => {
      const videoEl = videoRef.current;
      const detCanvas = detectionCanvasRef.current;
      if (!videoEl || !detCanvas || videoEl.readyState < 2) return;

      const w = 240;
      const h = 180;
      detCanvas.width = w;
      detCanvas.height = h;
      const ctx = detCanvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(videoEl, 0, 0, w, h);

      // 1. Try native browser FaceDetector first if available
      if (nativeDetectorRef.current) {
        try {
          const faces = await nativeDetectorRef.current.detect(detCanvas);
          if (isCancelled) return;
          if (Array.isArray(faces)) {
            if (faces.length === 0) {
              setDetectionStatus({
                faceCount: 0,
                centeredInOval: false,
                message: 'No face detected — Position your face inside the oval guide',
              });
              return;
            }
            if (faces.length > 1) {
              setDetectionStatus({
                faceCount: faces.length,
                centeredInOval: false,
                message: `Multiple faces detected (${faces.length}) — Only 1 face allowed in frame`,
              });
              return;
            }
            // Verify single face is reasonably inside the center oval
            const box = faces[0].boundingBox;
            const faceCx = (box.x + box.width / 2) / w;
            const faceCy = (box.y + box.height / 2) / h;
            const inOval =
              faceCx >= 0.24 && faceCx <= 0.76 && faceCy >= 0.18 && faceCy <= 0.82;
            if (!inOval) {
              setDetectionStatus({
                faceCount: 0,
                centeredInOval: false,
                message: 'Move your face into the center of the oval guide',
              });
              return;
            }
            setDetectionStatus({
              faceCount: 1,
              centeredInOval: true,
              message: '1 Face Detected in Oval — Ready to Capture',
            });
            return;
          }
        } catch {
          // If native FaceDetector throws on this platform, fall through to canvas vision engine
        }
      }

      // 2. Universal Canvas Computer Vision Face Detection
      const fallbackResult = detectFacesInCanvas(ctx, w, h);
      if (!isCancelled) {
        setDetectionStatus(fallbackResult);
      }
    }, 320);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [cameraActive, stream]);

  const handleCapturePhoto = () => {
    const videoEl = videoRef.current;
    const capCanvas = captureCanvasRef.current;
    if (!videoEl || !capCanvas || videoEl.readyState < 2) return;

    if (detectionStatus.faceCount !== 1 || !detectionStatus.centeredInOval) {
      return;
    }

    const targetW = 480;
    const targetH = 560;
    capCanvas.width = targetW;
    capCanvas.height = targetH;
    const ctx = capCanvas.getContext('2d');
    if (!ctx) return;

    const vw = videoEl.videoWidth || 640;
    const vh = videoEl.videoHeight || 480;
    const targetAspect = targetW / targetH;
    const videoAspect = vw / vh;

    let sx = 0;
    let sy = 0;
    let sw = vw;
    let sh = vh;

    if (videoAspect > targetAspect) {
      sw = vh * targetAspect;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / targetAspect;
      sy = (vh - sh) / 2;
    }

    ctx.save();
    // Mirror horizontally to match natural front-facing preview
    ctx.translate(targetW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, targetW, targetH);
    ctx.restore();

    const dataUrl = capCanvas.toDataURL('image/jpeg', 0.92);
    onPhotoCaptured(dataUrl);
    setJustCaptured(true);
    stopCamera();
  };

  const isFaceValid = detectionStatus.faceCount === 1 && detectionStatus.centeredInOval;
  const hasSavedPhoto = Boolean(
    currentPhotoUrl && !currentPhotoUrl.startsWith('/proctoring/')
  );

  return (
    <div className="rounded-2xl border-2 border-[#0a6b3c] bg-white p-5 space-y-4 shadow-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200 pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#0a6b3c] text-white flex items-center justify-center shrink-0">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#0a6b3c]">
                Live Photo Card Capture
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  required
                    ? 'bg-red-100 text-red-700 border border-red-300'
                    : 'bg-[#0a6b3c]/10 text-[#0a6b3c]'
                }`}
              >
                {required ? 'Compulsory (1 Face Required)' : 'Live Camera Only'}
              </span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Gallery file uploads are disabled. Use your live camera and align your face inside the oval guide.
            </p>
          </div>
        </div>

        {hasSavedPhoto && !cameraActive && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0a6b3c] text-white text-[11px] font-extrabold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Live Photo Verified</span>
          </span>
        )}
      </div>

      {cameraError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{cameraError}</span>
        </div>
      )}

      {/* Main Content Area: Live Camera Viewport OR Captured Photo Preview */}
      {cameraActive ? (
        <div className="space-y-3.5">
          <div
            className={`relative mx-auto overflow-hidden rounded-2xl bg-neutral-950 border-2 border-[#0a6b3c] shadow-md ${
              compact ? 'max-w-xs aspect-[4/4.5]' : 'max-w-sm aspect-[4/4.5]'
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />

            {/* Darkened Vignette with Face Oval Guide Overlay */}
            <svg
              viewBox="0 0 200 230"
              className="absolute inset-0 w-full h-full pointer-events-none"
              preserveAspectRatio="none"
            >
              <defs>
                <mask id="face-oval-mask">
                  <rect width="200" height="230" fill="white" />
                  <ellipse cx="100" cy="108" rx="54" ry="72" fill="black" />
                </mask>
              </defs>
              <rect
                width="200"
                height="230"
                fill="rgba(0,0,0,0.48)"
                mask="url(#face-oval-mask)"
              />
              <ellipse
                cx="100"
                cy="108"
                rx="54"
                ry="72"
                fill="none"
                stroke={
                  isFaceValid
                    ? '#10b981'
                    : detectionStatus.faceCount > 1
                    ? '#ef4444'
                    : '#f59e0b'
                }
                strokeWidth="3.5"
                strokeDasharray={isFaceValid ? 'none' : '7 5'}
              />
            </svg>

            {/* Top Corner Live Indicator */}
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 text-white text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE CAMERA</span>
            </div>

            {/* Bottom Face Detection Status Pill */}
            <div className="absolute bottom-3 inset-x-3">
              <div
                className={`px-3 py-2 rounded-xl text-[11px] font-extrabold text-center shadow-md flex items-center justify-center gap-1.5 ${
                  isFaceValid
                    ? 'bg-[#0a6b3c] text-white border border-emerald-300'
                    : detectionStatus.faceCount > 1
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-500 text-black'
                }`}
              >
                {isFaceValid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{detectionStatus.message}</span>
              </div>
            </div>
          </div>

          {/* Capture & Cancel Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleCapturePhoto}
              disabled={!isFaceValid}
              className="px-6 py-3 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold uppercase tracking-wider flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shadow-xs"
            >
              <Camera className="w-4 h-4" />
              <span>
                {isFaceValid
                  ? 'Capture & Save Photo Card'
                  : 'Align 1 Face in Oval to Capture'}
              </span>
            </button>

            <button
              type="button"
              onClick={stopCamera}
              className="px-4 py-3 rounded-xl border border-neutral-300 hover:border-black bg-white text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <VideoOff className="w-3.5 h-3.5" />
              <span>Close Camera</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-neutral-50 p-4 rounded-xl border border-neutral-200">
          <div className="flex items-center gap-4">
            <div className="w-20 h-24 rounded-xl border-2 border-[#0a6b3c] bg-white flex flex-col items-center justify-center overflow-hidden shrink-0 shadow-2xs">
              {hasSavedPhoto ? (
                <img
                  src={currentPhotoUrl}
                  alt="Captured Candidate Photo Card"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center p-2 text-neutral-400">
                  <Camera className="w-6 h-6 mx-auto mb-1 text-[#0a6b3c]/50" />
                  <span className="block text-[9px] font-bold uppercase">No Photo</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="text-xs font-extrabold text-black flex items-center gap-1.5">
                {hasSavedPhoto ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-[#0a6b3c]" />
                    <span>Live Biometric Photo Captured &amp; Validated</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#0a6b3c]" />
                    <span>
                      {required
                        ? 'Live Photo Capture Required to Complete Registration'
                        : 'Capture Your Official Student Photo Card'}
                    </span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-neutral-600 leading-relaxed max-w-md">
                {hasSavedPhoto
                  ? 'Captured directly from your live camera with 1-face oval verification and saved to your candidate profile.'
                  : 'Click "Start Live Camera" below, position your face inside the oval frame until 1 face is detected, and capture.'}
              </p>
              {justCaptured && (
                <div className="text-[11px] font-extrabold text-[#0a6b3c]">
                  ✓ Photo saved to candidate profile!
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={startCamera}
              className="px-4 py-2.5 rounded-xl bg-[#0a6b3c] hover:bg-[#0e8a4e] text-white text-xs font-extrabold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-2xs"
            >
              {hasSavedPhoto ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retake Live Photo</span>
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  <span>Start Live Camera</span>
                </>
              )}
            </button>

            {hasSavedPhoto && onClearPhoto && !required && (
              <button
                type="button"
                onClick={onClearPhoto}
                className="px-3 py-2.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Offscreen Canvases for Face Detection & High-Res Photo Capture */}
      <canvas ref={detectionCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  );
};
