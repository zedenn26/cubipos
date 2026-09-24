"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, IScannerControls } from "@zxing/browser";
export function CameraScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let controls: IScannerControls | undefined;
    let stopped = false;
    const reader = new BrowserMultiFormatReader();
    void reader
      .decodeFromVideoDevice(undefined, video.current!, (result) => {
        if (result && !stopped) {
          stopped = true;
          controls?.stop();
          onCode(result.getText());
          onClose();
        }
      })
      .then((c) => {
        controls = c;
        if (stopped) c.stop();
      })
      .catch(() =>
        setError(
          "Camera unavailable. Allow camera access over HTTPS, or enter the code manually.",
        ),
      );
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onCode, onClose]);
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Scan barcode or QR"
    >
      <section className="panel">
        <h2>Scan barcode / QR</h2>
        <video
          ref={video}
          playsInline
          muted
          style={{ maxWidth: "100%", width: 480 }}
        />
        {error && <p role="alert">{error}</p>}
        <button onClick={onClose}>Close camera</button>
      </section>
    </div>
  );
}
