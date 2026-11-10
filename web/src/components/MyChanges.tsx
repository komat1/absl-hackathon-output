import { useCallback, useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { auditDecisions, type AuditDecision } from "@/lib/api";

const STATUS_TONE: Record<string, BadgeTone> = { Active: "blue", Won: "green", Lost: "red" };

const FIELD: Record<string, { label: string; icon: string; format: (v: string) => string }> = {
  won_lost_active_status: { label: "Status", icon: "fa-sharp fa-regular fa-flag", format: (v) => v },
  close_date: {
    label: "Close date",
    icon: "fa-sharp fa-regular fa-calendar",
    format: (v) => new Date(`${v}T00:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })
  },
  win_probability_percent: { label: "Probability", icon: "fa-sharp fa-regular fa-percent", format: (v) => `${v}%` }
};

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

function Value({ field, value }: { field: string; value: string | null }) {
  if (value === null || value === "") return <span className="text-[color:var(--text-4)]">—</span>;
  const tone = field === "won_lost_active_status" ? STATUS_TONE[value] : undefined;
  const text = FIELD[field]?.format(value) ?? value;
  return tone ? <Badge tone={tone}>{text}</Badge> : <span className="font-medium tabular-nums">{text}</span>;
}

/**
 * The deal updates you have confirmed, as simple cards: who, what moved, when.
 * Same source as the audit trail (`/api/audit`, straight from PostgreSQL), just
 * read for a person rather than as the record.
 */
export function MyChanges() {
  const [decisions, setDecisions] = useState<AuditDecision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDecisions(await auditDecisions(50));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
      <SectionHeader
        title="My changes"
        description="Deal updates you confirmed, newest first. Each one was saved to every product line of the deal."
        action={
          <button type="button" className="icon-button" onClick={() => void load()} title="Reload" aria-label="Reload my changes">
            <Icon icon={loading ? "fa-sharp fa-regular fa-spinner-third fa-spin" : "fa-sharp fa-regular fa-arrow-rotate-right"} />
          </button>
        }
      />

      {error ? (
        <section className="panel">
          <EmptyState icon="fa-sharp fa-regular fa-triangle-exclamation" title="Your changes could not be loaded" hint={error} />
        </section>
      ) : loading && decisions === null ? (
        <section className="panel">
          <SkeletonRows rows={4} />
        </section>
      ) : decisions && decisions.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {decisions.map((decision) => (
            <li key={decision.id} className="panel animate-block-in p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold text-[color:var(--text-1)]">
                    {decision.customer_name ?? "Unknown customer"}
                  </div>
                  <div className="text-[12px] tabular-nums text-[color:var(--text-4)]">
                    Deal {decision.deal_id} · {decision.rows_affected} product line{decision.rows_affected === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] text-[color:var(--text-4)]" title={new Date(decision.changed_at).toLocaleString("en-IE")}>
                  {ago(decision.changed_at)}
                </span>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {decision.changes.map((change) => (
                  <div key={change.field} className="flex items-center gap-3 text-[13px]">
                    <span className="flex w-[110px] shrink-0 items-center gap-2 text-[color:var(--text-3)]">
                      <Icon icon={FIELD[change.field]?.icon ?? "fa-sharp fa-regular fa-pen"} />
                      {FIELD[change.field]?.label ?? change.field}
                    </span>
                    <span className="text-[color:var(--text-3)] line-through decoration-[color:var(--text-4)]">
                      <Value field={change.field} value={change.old_value} />
                    </span>
                    <Icon icon="fa-sharp fa-regular fa-arrow-right" className="text-[color:var(--text-4)]" />
                    <span className="text-[color:var(--text-1)]">
                      <Value field={change.field} value={change.new_value} />
                    </span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section className="panel">
          <EmptyState
            icon="fa-sharp fa-regular fa-pen-to-square"
            title="You haven't changed any deals yet"
            hint="Ask the copilot to move a deal's status, close date or win probability. Once you confirm, it shows up here."
          />
        </section>
      )}
    </div>
  );
}
