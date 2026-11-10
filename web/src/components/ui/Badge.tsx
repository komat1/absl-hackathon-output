import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "green" | "red" | "gray" | "amber" | "blue" | "teal";

const TONE_CLASS: Record<BadgeTone, string> = {
  green: "badge-green",
  red: "badge-red",
  gray: "badge-gray",
  amber: "badge-amber",
  blue: "badge-blue",
  teal: "badge-teal"
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  children?: ReactNode;
};

export function Badge({ tone = "gray", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={["badge", TONE_CLASS[tone], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </span>
  );
}
