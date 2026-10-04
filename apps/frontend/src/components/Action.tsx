import { FC, ReactNode } from "react";
import { socket } from "../socket";
import { Player } from "../types/gameTypes";

type ActionProps = {
  data: Player | undefined;
  action: () => void;
  children: ReactNode;
};

/**
 * This component will give the user the ability to perform an action if they are the owner of the cards
 * It also checks if its the users turn
 * @param param0
 * @returns
 */

const Action: FC<ActionProps> = ({ data, action, children }) => {
  const userSocketId = socket.id;

  if (!data) {
    return <div>{children}</div>;
  }

  if (userSocketId !== data.socketId || !data.playersTurn) {
    return <div>{children}</div>;
  }

  return <button onClick={action}>{children}</button>;
};

export default Action;
