import { FC, ReactNode } from "react";
import { socket } from "../socket";
import { Player } from "../types/gameTypes";

type DisplayProps = {
  data: Player | undefined;
  children: ReactNode;
};

/**
 * This component will display its children only if they are the owner.
 * @param param0
 * @returns
 */

const Display: FC<DisplayProps> = ({ data, children }) => {
  const userSocketId = socket.id;

  if (!data || userSocketId !== data.socketId) {
    return null;
  }

  return <div>{children}</div>;
};

export default Display;
