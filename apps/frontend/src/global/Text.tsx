import { FC, ReactNode, HTMLProps } from "react";

type TextNormalProps = HTMLProps<HTMLParagraphElement> & {
  children: ReactNode;
};

const Text: FC<TextNormalProps> = ({ children, ...rest }) => {
  return (
    <p className="text-lg font-medium drop-shadow-black text-white" {...rest}>
      {children}
    </p>
  );
};

export default Text;
