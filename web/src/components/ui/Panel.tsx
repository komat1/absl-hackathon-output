import type { HTMLAttributes, ReactNode } from "react";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export function Panel({ className, children, ...props }: PanelProps) {
  return (
    <div className={["panel", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
}
