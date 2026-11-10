import type { ReactNode } from "react";

/**
 * Page title + optional one-line description + optional action.
 *
 * The description is OPTIONAL on purpose: on a screen used daily, a sentence that
 * only restates the title gets read a thousand times and then stops being read,
 * which is how the load-bearing ones lose their audience. Pass one only when it
 * says something the reader cannot see from the screen itself.
 */
export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[color:var(--text-2)]">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0 sm:pt-0.5">{action}</div>}
    </div>
  );
}
