import { FC } from "react";
import { socket } from "../socket";

import Button from "../global/Button";

export const ConnectionManager: FC = () => {
  function connect() {
    socket.connect();
  }

  function disconnect() {
    socket.disconnect();
  }

  return (
    <>
      <Button onClick={connect}>Connect</Button>
      <Button onClick={disconnect}>Disconnect</Button>
    </>
  );
};
