import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { decide } from "@/lib/api";
import { formatValue } from "@/lib/format";
import { useChat } from "@/stores/chat";
import { FIELD_LABEL, type EditableField, type FieldChange, type PreviewBlock, type ValueFormat } from "@/types/blocks";

/** Each editable field has one unit, and the card shows it in that unit — a
 *  probability as a percentage, a date as a date. */
const FIELD_FORMAT: Record<EditableField, ValueFormat> = {
  won_lost_active_status: "number",
  close_date: "date",
  win_probability_percent: "percent"
};

function showValue(field: EditableField, value: string): string {
  return field === "won_lost_active_status" ? value : formatValue(value, FIELD_FORMAT[field]);
}

/**
 * The decision card — the only block on screen whose buttons change data.
 *
 * It is written as a decision rather than as a diff: what was asked for, what is
 * stored right now, what would move, what it does to the weighted pipeline, and
 * what stays read-only whatever the answer is. A person confirming a change to
 * every product line of a deal should be able to see all of that without
 * scrolling back through the conversation.
 *
 * Confirm goes to /api/confirm, not to the model: a human decision stays a human
 * decision, and the agent has no tool that this click routes through. Cancel
 * drops the pending change and performs no write — there is nothing here to
 * undo afterwards because nothing was ever saved.
 */
export function PreviewView({ block }: { block: PreviewBlock }) {
  const preview = block.preview;
  const sessionId = useChat((state) => state.sessionId);
  const applyResult = useChat((state) => state.applyResult);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [outcome, setOutcome] = useState<{ saved: boolean; message: string } | null>(null);

  async function choose(decision: "confirm" | "cancel") {
    setBusy(decision);
    const result = await decide(sessionId, preview.pending_id, decision);
    setOutcome(result);
    setBusy(null);
    applyResult(result);
  }

  const moving = preview.changes.filter((change) => !change.unchanged);
  const stored = preview.stored_now;
  const weightedDelta = preview.weighted_after_eur - preview.weighted_before_eur;

  return (
    <section className="panel animate-block-in overflow-hidden">
      <header className="flex items-start gap-2.5 border-b border-[color:var(--line)] px-4 py-3">
        <Icon
          icon="fa-sharp fa-regular fa-circle-question"
          className="mt-0.5 text-[12px] text-[color:var(--brand-ink)]"
        />
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[color:var(--text)]">
            {moving.length > 1 ? "Confirm this decision" : "Review this change"}
          </h3>
          {block.intent && (
            <p className="mt-0.5 text-[11.5px] leading-4 text-[color:var(--text-3)]">{block.intent}</p>
          )}
        </div>
        <span className="ml-auto shrink-0 pt-0.5 text-[11px] text-[color:var(--text-4)]">
          nothing saved yet
        </span>
      </header>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color:var(--line)] px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tabular-nums text-[color:var(--text)]">
          {preview.deal}
        </span>
        <span className="text-[12.5px] text-[color:var(--text-2)]">{preview.name}</span>
        <span className="ml-auto text-[12px] tabular-nums text-[color:var(--text-3)]">
          {formatValue(preview.deal_value_eur, "money")}
          <span className="ml-1 text-[color:var(--text-4)]">deal value</span>
        </span>
      </div>

      {/* What is stored right now — read live from the deal's lines, so the card
          states the decision against the database and not against the chat. */}
      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 border-b border-[color:var(--line)] bg-[color:var(--nest)] px-4 py-2.5 text-[11.5px]">
        <Stored label="Status" value={String(stored.status ?? "—")} />
        <Stored label="Win probability" value={formatValue(stored.win_probability_percent, "percent")} />
        <Stored label="Close date" value={String(stored.close_date ?? "—")} />
        <span className="ml-auto self-center text-[10.5px] uppercase tracking-wide text-[color:var(--text-4)]">
          stored now
        </span>
      </dl>

      <ul className="flex flex-col gap-2 px-4 py-3">
        {preview.changes.map((change) => (
          <ChangeRow key={change.field} change={change} />
        ))}
      </ul>

      {preview.derived_note && (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-[var(--r-sm)] bg-[color:var(--nest)] px-3 py-2 text-[11.5px] leading-5 text-[color:var(--text-3)]">
          <Icon icon="fa-sharp fa-regular fa-circle-info" className="mt-[3px] text-[10.5px]" />
          {preview.derived_note}
        </p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-[color:var(--line)] px-4 py-3 text-[12.5px]">
        <dt className="text-[color:var(--text-4)]">Weighted pipeline</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums text-[color:var(--text-3)]">
            {formatValue(preview.weighted_before_eur, "money")}
          </span>
          <Icon icon="fa-sharp fa-regular fa-arrow-right" className="text-[10px] text-[color:var(--text-4)]" />
          <span className="font-semibold tabular-nums text-[color:var(--text)]">
            {formatValue(preview.weighted_after_eur, "money")}
          </span>
          {weightedDelta !== 0 && (
            <span
              className="tabular-nums text-[11.5px]"
              style={{ color: weightedDelta > 0 ? "var(--green)" : "var(--red)" }}
            >
              {weightedDelta > 0 ? "+" : "−"}
              {formatValue(Math.abs(weightedDelta), "money")}
            </span>
          )}
          <span className="block w-full text-[11px] text-[color:var(--text-4)]">
            {preview.leaves_active_pipeline
              ? "This deal leaves the Active pipeline, so its weighted value goes to zero. A prioritization aid, not a forecast."
              : "Value × probability. A prioritization aid, never a forecast."}
          </span>
        </dd>

        <dt className="text-[color:var(--text-4)]">Applies to</dt>
        <dd className="text-[color:var(--text-2)]">
          all {preview.affected_lines} product line{preview.affected_lines === 1 ? "" : "s"} of this deal
          {moving.length > 1 && ", in one transaction"}
          <span className="block text-[11.5px] text-[color:var(--text-4)]">
            including lines hidden by a filter on the table
          </span>
        </dd>

        <dt className="text-[color:var(--text-4)]">Stays as it is</dt>
        <dd className="text-[11.5px] leading-5 text-[color:var(--text-4)]">
          Prices, recorded revenue and the sales-phase snapshot are read-only. Confirming does not
          recalculate historical revenue.
        </dd>
      </dl>

      {outcome ? (
        <div
          className="flex items-center gap-2 border-t border-[color:var(--line)] px-4 py-3 text-[12.5px] font-semibold"
          style={{ color: outcome.saved ? "var(--green)" : "var(--text-2)" }}
        >
          <Icon
            icon={outcome.saved ? "fa-sharp fa-regular fa-circle-check" : "fa-sharp fa-regular fa-circle-xmark"}
            className="text-[12px]"
          />
          {outcome.message}
        </div>
      ) : (
        <footer className="flex flex-wrap items-center gap-2 border-t border-[color:var(--line)] px-4 py-3">
          <Button className="whitespace-nowrap" onClick={() => void choose("confirm")} disabled={busy !== null}>
            {busy === "confirm" ? "Saving…" : moving.length > 1 ? "Confirm and move forward" : "Confirm and save"}
          </Button>
          <Button variant="secondary" onClick={() => void choose("cancel")} disabled={busy !== null}>
            Cancel
          </Button>
          <span className="ml-auto text-[11px] text-[color:var(--text-4)]">
            Cancelling writes nothing — the stored values stay as they are.
          </span>
        </footer>
      )}
    </section>
  );
}

function Stored({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <dt className="text-[color:var(--text-4)]">{label}</dt>
      <dd className="font-medium tabular-nums text-[color:var(--text-2)]">{value}</dd>
    </span>
  );
}

/** One field of the decision. A field already holding the new value is shown
 *  struck through rather than dropped: "nothing to do here" is information the
 *  person needs before they press a button. */
function ChangeRow({ change }: { change: FieldChange }) {
  const old = change.old_values.map((value) => showValue(change.field, value)).join(", ") || "—";
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span className="min-w-[8.5rem] text-[12px] text-[color:var(--text-4)]">
        {FIELD_LABEL[change.field]}
      </span>
      <span className="rounded-[var(--r-sm)] bg-[color:var(--nest)] px-2 py-0.5 text-[12.5px] tabular-nums text-[color:var(--text-3)] line-through">
        {old}
      </span>
      <Icon icon="fa-sharp fa-regular fa-arrow-right" className="text-[10px] text-[color:var(--text-4)]" />
      {change.unchanged ? (
        <span className="flex items-center gap-1.5 rounded-[var(--r-sm)] bg-[color:var(--nest)] px-2 py-0.5 text-[12.5px] tabular-nums text-[color:var(--text-4)]">
          {showValue(change.field, change.new_value)}
          <span className="text-[11px]">already set</span>
        </span>
      ) : (
        <span className="rounded-[var(--r-sm)] bg-[color:var(--brand-bg)] px-2 py-0.5 text-[12.5px] font-semibold tabular-nums text-[color:var(--brand-ink)]">
          {showValue(change.field, change.new_value)}
        </span>
      )}
    </li>
  );
}
