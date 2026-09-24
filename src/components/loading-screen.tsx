import Image from "next/image";

export function LoadingScreen({ message = "Loading your workspace" }: { message?: string }) {
  const accessBlocked = /subscription expired|business suspended/i.test(message);
  const renewalEmail = `mailto:info@cubixtop.com?subject=${encodeURIComponent(
    "CubiPOS subscription validity request",
  )}&body=${encodeURIComponent(
    "Hello Cubixtop team,\n\nOur CubiPOS business access is suspended or has expired. Please review our subscription validity and contact us with the available extension options.\n",
  )}`;
  return (
    <main className={`loading-screen ${accessBlocked ? "access-blocked" : ""}`} role={accessBlocked ? "alert" : "status"} aria-live="polite" aria-label={accessBlocked ? "CubiPOS access notice" : "Loading CubiPOS"}>
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
        <p className="loading-title">
          {accessBlocked ? "Business access needs attention" : "Loading CubiPOS"}
          {!accessBlocked && <span className="loading-dots" aria-hidden="true">...</span>}
        </p>
        <p className="loading-message">{message}</p>
        {accessBlocked && (
          <>
            <p className="loading-help">
              Ask Cubixtop to review and extend your validity. The System Super
              Admin will update your access date after approval.
            </p>
            <a className="button-link primary loading-contact" href={renewalEmail}>
              Email info@cubixtop.com
            </a>
          </>
        )}
      </div>
    </main>
  );
}
