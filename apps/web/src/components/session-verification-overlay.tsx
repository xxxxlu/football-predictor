import { PulseLogo } from "./pulse";

/** One shared full-screen state while authentication is being resolved. */
export function SessionVerificationOverlay() {
  return <div className="session-verification-overlay" role="status" aria-live="polite" aria-label="正在确认会话" aria-busy="true">
    <div className="session-verification-overlay__content">
      <div className="session-verification-overlay__mark" aria-hidden="true">
        <PulseLogo size={140} fg="rgb(244 241 232 / 16%)" cut="var(--pulse-carbon)" />
        <span className="session-verification-overlay__fill"><PulseLogo size={140} fg="var(--pulse-red)" cut="var(--pulse-carbon)" /></span>
      </div>
      <p className="session-verification-overlay__label">正在确认会话</p>
    </div>
  </div>;
}
