import { FC, ReactNode, ButtonHTMLAttributes } from "react";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; children: ReactNode };
const Button: FC<ButtonProps> = ({ variant = "primary", children, className = "", ...rest }) => <button className={`button button-${variant} ${className}`} {...rest}>{children}</button>;
export default Button;
