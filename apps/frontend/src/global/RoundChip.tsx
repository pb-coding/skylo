import { FC } from "react";

type RoundChipProps = {
  description: string;
  children: React.ReactNode;
};

const RoundChip: FC<RoundChipProps> = ({ description, children }) => {
  return (
    <span className="inline-flex items-center justify-center w-8 h-8 ml-4 mt-4 text-sm font-semibold rounded-full bg-theme-secondary hover:bg-theme-secondary-hover text-white">
      {children}
      <span className="sr-only">{description}</span>
    </span>
  );
};

export default RoundChip;
