import { useEffect, useId, useRef, useState } from "react";
import { X, ScanBarcode, Zap, ZapOff, Keyboard } from "lucide-react";
import { Button, Input } from "../ui/ui.jsx";
import styles from "./BarcodeScanner.module.css";

/**
 * Opens the device camera and decodes a barcode. Uses html5-qrcode (wraps
 * ZXing). Retail barcodes (UPC/EAN/CODE128 etc.) need sharper focus and
 * more effective resolution than QR to decode reliably, so this asks the
 * camera for a higher-res feed and — where supported — continuous
 * autofocus and a torch toggle for dim labels. A manual-entry fallback is
 * always available right in this modal, since scanning sometimes just
 * won't cooperate (damaged label, bad lighting, no camera access).
 */
const SCAN_FORMATS = [
  "QR_CODE", "EAN_13", "EAN_8", "UPC_A", "UPC_E",
  "CODE_128", "CODE_39", "CODE_93", "CODABAR", "ITF",
];

export default function BarcodeScanner({ onDetected, onClose }) {
  const viewportId = useId().replace(/:/g, "");
  const containerRef = useRef(null);
  const scannerRef = useRef(null);
  const lastDetectionRef = useRef({ code: null, time: 0 });
  const [error, setError] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");

  useEffect(() => {
    if (manualMode) return; // camera only needed in scan mode
    let cancelled = false;

    import("html5-qrcode").then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (cancelled || !containerRef.current) return;

      const formatsToSupport = SCAN_FORMATS
        .map((f) => Html5QrcodeSupportedFormats[f])
        .filter((f) => f !== undefined);

      const scanner = new Html5Qrcode(containerRef.current.id, { formatsToSupport, verbose: false });
      scannerRef.current = scanner;

      scanner
        .start(
          { facingMode: "environment" },
          {
            fps: 15,
            // Wider than tall — matches how a barcode is actually held up,
            // unlike a square box tuned for QR.
            qrbox: { width: 280, height: 140 },
            aspectRatio: 1.777,
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              // Best-effort: browsers that support it will keep the barcode
              // in focus even close up; ignored harmlessly otherwise.
              advanced: [{ focusMode: "continuous" }],
            },
            experimentalFeatures: {
              // On Chrome/Android this hands decoding off to the browser's
              // native, hardware-backed barcode reader instead of the pure-JS
              // ZXing fallback — meaningfully more reliable on real 1D
              // barcodes (UPC/EAN). Silently ignored where unsupported.
              useBarCodeDetectorIfSupported: true,
            },
          },
          (decodedText) => {
            // The success callback fires on every frame that decodes
            // successfully — without this, holding a code steady for even
            // half a second adds it to the cart several times over. Only
            // treat it as a *new* scan if it's a different code, or the
            // same code again after a cooldown (e.g. scanning two units
            // of the same item back to back).
            const now = Date.now();
            const { code: lastCode, time: lastTime } = lastDetectionRef.current;
            if (decodedText === lastCode && now - lastTime < 2000) return;
            lastDetectionRef.current = { code: decodedText, time: now };

            if (navigator.vibrate) navigator.vibrate(80);
            onDetected(decodedText);
          },
          () => {} // per-frame "no code found" — expected constantly, ignore
        )
        .then(() => {
          try {
            const capabilities = scanner.getRunningTrackCapabilities?.();
            if (capabilities?.torch) setTorchAvailable(true);
          } catch {
            // torch introspection not supported on this device/browser — fine, just hide the toggle
          }
        })
        .catch(() => setError("Couldn't access the camera. Check permissions, or type the code in instead."));
    });

    return () => {
      cancelled = true;
      if (scannerRef.current) {
        scannerRef.current.stop().then(() => scannerRef.current.clear()).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualMode]);

  async function toggleTorch() {
    if (!scannerRef.current) return;
    try {
      await scannerRef.current.applyVideoConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((t) => !t);
    } catch {
      setTorchAvailable(false);
    }
  }

  function submitManual(e) {
    e.preventDefault();
    if (manualCode.trim()) onDetected(manualCode.trim());
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}><ScanBarcode size={16} /> Scan barcode</span>
          <div className={styles.headerActions}>
            {!manualMode && torchAvailable && (
              <button className={styles.iconToggle} onClick={toggleTorch} title="Toggle flashlight">
                {torchOn ? <ZapOff size={16} /> : <Zap size={16} />}
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {manualMode ? (
          <form className={styles.manualForm} onSubmit={submitManual}>
            <Input
              autoFocus
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Type the barcode number"
              inputMode="numeric"
            />
            <Button type="submit" variant="accent">Use this code</Button>
          </form>
        ) : (
          <div id={viewportId} ref={containerRef} className={styles.viewport} />
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.footer}>
          {!manualMode && <p className={styles.hint}>Hold a barcode or QR code steady, filling the frame.</p>}
          <button className={styles.switchModeBtn} onClick={() => setManualMode((m) => !m)}>
            <Keyboard size={14} /> {manualMode ? "Use camera instead" : "Type it in instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
