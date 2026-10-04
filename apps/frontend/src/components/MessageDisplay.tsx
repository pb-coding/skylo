import { FC } from "react";

type MessageDisplayProps = {
  message: string;
};

const MessageDisplay: FC<MessageDisplayProps> = ({ message }) => {
  if (!message || message == "") return null;

  return (
    <div className="absolute top-0 left-0 w-full h-full flex justify-center items-center">
      <div className="bg-gray-800 p-4 rounded-lg">
        <p className="text-white text-xl opacity-100">{message}</p>
      </div>
    </div>
  );
};

export default MessageDisplay;
