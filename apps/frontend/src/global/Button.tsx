import { FC, ReactNode, ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  children: ReactNode;
};

const Button: FC<ButtonProps> = ({ variant, children, ...rest }) => {
  if (variant === "secondary") {
    return (
      <button
        className="border border-black text-white focus:outline-none focus:ring-4 rounded-lg text-md px-3 py-1.5 mr-2 bg-theme-secondary hover:bg-theme-secondary-hover focus:ring-gray-700"
        {...rest}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      className="border border-black text-white focus:ring-4 rounded-lg text-md px-5 py-2 mr-2 bg-theme-primary hover:bg-theme-primary-hover focus:outline-none focus:ring-blue-800"
      {...rest}
    >
      {children}
    </button>
  );
};

export default Button;
