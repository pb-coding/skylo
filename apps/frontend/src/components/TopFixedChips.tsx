import { FC, useState } from "react";
import { Copy, Check, UserPlus } from "@phosphor-icons/react";
import VoiceChat from "./VoiceChat";
const TopFixedChips: FC<{ session: string; isConnected: boolean; playerCount: number; hostId: string; ownParticipantId: string }> = ({ session, isConnected, playerCount, hostId, ownParticipantId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (!session) return null;
  const invitation = new URL(window.location.href);
  invitation.search = "";
  invitation.searchParams.set("room", session);
  async function copy() {
    try { await navigator.clipboard.writeText(invitation.toString()); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <header className="game-toolbar">
    <div className="invite-control">
      <button className="invite-button" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}><UserPlus size={22} weight="fill" /><span>Einladen</span></button>
      {isOpen && <section className="invite-popover" aria-label="Freunde einladen">
        <h2>Gemeinsam am Tisch</h2><p>Raumcode: <strong>{session}</strong></p>
        <label htmlFor="invitation-link">Einladungslink</label><input id="invitation-link" value={invitation.toString()} readOnly onFocus={(event) => event.target.select()} />
        <button className="button button-primary" onClick={copy}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? "Link kopiert" : "Link kopieren"}</button>
        {copyError && <p role="status">Bitte markiere den Link und kopiere ihn manuell.</p>}
      </section>}
    </div>
    <VoiceChat key={session} session={session} isConnected={isConnected} playerCount={playerCount} hostId={hostId} ownParticipantId={ownParticipantId} />
  </header>;
};
export default TopFixedChips;
