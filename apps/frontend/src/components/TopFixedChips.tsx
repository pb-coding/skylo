import { FC } from "react";

import VoiceChat from "./VoiceChat";
import RoundChip from "../global/RoundChip";

type TopFixedChipsProps = {
  session: string;
};

const TopFixedChips: FC<TopFixedChipsProps> = ({ session }) => {
  const isActiveSession = session !== "";

  if (!isActiveSession) return null;

  return (
    <div className="fixed top-0 left-0 flex">
      <RoundChip description="toggle voice chat">
        <VoiceChat session={session} />
      </RoundChip>
    </div>
  );
};

export default TopFixedChips;
