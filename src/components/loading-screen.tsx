import Image from "next/image";

export function LoadingScreen({ message = "Loading your workspace" }: { message?: string }) {
  return (
    <main className="loading-screen" role="status" aria-live="polite" aria-label="Loading CubiPOS">
      <div className="loading-card">
        <div className="loading-logo-wrap">
          <Image
            className="loading-logo"
            src="/cubipos-logo.png"
            alt="CubiPOS by Cubixtop"
            width={1400}
            height={467}
            priority
          />
        </div>
        <p className="loading-title">Loading CubiPOS<span className="loading-dots" aria-hidden="true">...</span></p>
        <p className="loading-message">{message}</p>
      </div>
    </main>
  );
}
