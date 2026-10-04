import { FC } from "react";

type MessageDisplayProps = {
  message: string;
};

const MessageDisplay: FC<MessageDisplayProps> = ({ message }) => {
  if (!message || message == "") return null;

  return (
    <div role="status" className="fixed bottom-4 inset-x-4 z-40 flex justify-center pointer-events-none">
      <div className="bg-gray-800 p-4 rounded-lg">
        <p className="text-white text-xl opacity-100">{message}</p>
      </div>
    </div>
  );
};

export default MessageDisplay;
