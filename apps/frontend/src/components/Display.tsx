import { ReactNode } from "react";

export default function Display({ playerId, ownPlayerId, children }: { playerId: string; ownPlayerId: string | null; children: ReactNode }) {
  return playerId === ownPlayerId ? <div>{children}</div> : null;
}
