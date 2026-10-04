import { FC } from "react";

export const ConnectedIndicator: FC = () => (
  <span className="ml-2 flex w-2.5 h-2.5 bg-theme-primary rounded-full border border-black"></span>
);

export const DisconnectedIndicator: FC = () => (
  <span className="ml-2 flex w-2 h-2 bg-theme-secondary rounded-full"></span>
);
