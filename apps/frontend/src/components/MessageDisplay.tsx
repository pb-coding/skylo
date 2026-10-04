import { FC } from "react";
const MessageDisplay: FC<{ message: string }> = ({ message }) => message ? <div className="toast" role="status" aria-live="polite"><p>{message}</p></div> : null;
export default MessageDisplay;
