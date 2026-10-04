import { FC } from "react";

type HeadsetIconProps = {
  enabled: boolean;
};

const HeadsetIcon: FC<HeadsetIconProps> = ({ enabled }) => {
  return (
    <svg
      className="w-4 h-4 pt-0.5 text-white"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path d="M 7.824 5.937 a 1 1 0 0 0 0.726 -0.312 a 2.042 2.042 0 0 1 2.835 -0.065 a 1 1 0 0 0 1.388 -1.441 a 3.994 3.994 0 0 0 -5.674 0.13 a 1 1 0 0 0 0.725 1.688 Z" />
      <path d="M 17 7 A 7 7 0 1 0 3 7 a 3 3 0 0 0 -3 3 v 2 a 3 3 0 0 0 3 3 h 1 a 1 1 0 0 0 1 -1 V 7 a 5 5 0 1 1 10 0 v 7.083 A 2.92 2.92 0 0 1 12.083 17 H 12 a 2 2 0 0 0 -2 -2 H 9 a 2 2 0 0 0 -2 2 v 1 a 2 2 0 0 0 2 2 h 1 a 1.993 1.993 0 0 0 1.722 -1 h 0.361 a 4.92 4.92 0 0 0 4.824 -4 H 17 a 3 3 0 0 0 3 -3 v -2 a 3 3 0 0 0 -3 -3 Z" />
      {!enabled && <path d="M 1 19 L 19 0 L 19 1 L 1 20 L 1 19" />}
    </svg>
  );
};

export default HeadsetIcon;
