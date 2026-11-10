import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import {
  decideNewDeal,
  previewNewDeal,
  products,
  type Account,
  type NewDealDraft,
  type NewDealPreview,
  type Product
} from "@/lib/api";

const TYPES: NewDealDraft["opportunity_type"][] = ["New Business", "Upsell", "Renewal"];

/**
 * Turn a research finding into pipeline. Same shape as every other write:
 * the form only previews, and nothing reaches the database until Confirm.
 */
export function NewDealForm({ accounts, initialCustomer }: { accounts: Account[]; initialCustomer: string }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [draft, setDraft] = useState<NewDealDraft>({
    customer: initialCustomer,
    product: "",
    price_eur: 10000,
    win_probability_percent: 20,
    close_date: "2027-03-31",
    opportunity_type: "New Business"
  });
  const [preview, setPreview] = useState<NewDealPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (open && catalog.length === 0) void products().then(setCatalog).catch(() => setCatalog([]));
  }, [open, catalog.length]);

  useEffect(() => {
    if (!preview) setDraft((d) => ({ ...d, customer: initialCustomer || d.customer }));
  }, [initialCustomer, preview]);

  const set = <K extends keyof NewDealDraft>(key: K, value: NewDealDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setMessage(null);
    try {
      return await fn();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "confirm" | "cancel") {
    if (!preview) return;
    const result = await run(() => decideNewDeal(preview.pending_id, decision));
    if (result) {
      setMessage({ ok: result.saved, text: result.message });
      setPreview(null);
    }
  }

  const valid = draft.customer.trim().length >= 2 && draft.product && draft.price_eur > 0;

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="self-start">
        <Icon icon="fa-sharp fa-regular fa-plus" className="mr-1.5 text-[11px]" />
        New deal from research
      </Button>
    );
  }

  return (
    <section className="panel p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-[color:var(--text)]">New deal</span>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
          <Icon icon="fa-sharp fa-regular fa-xmark" className="text-[12px]" />
        </button>
      </div>
      <p className="mt-1 text-[11.5px] leading-5 text-[color:var(--text-4)]">
        Creates one Active product line in Discovery. You see a preview first; nothing is saved until you confirm.
      </p>

      {!preview && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          <Field label="Customer">
            <input
              list="newdeal-accounts"
              value={draft.customer}
              onChange={(e) => set("customer", e.target.value)}
              className="field"
              placeholder="Existing account or a new prospect"
            />
            <datalist id="newdeal-accounts">
              {accounts.map((a) => (
                <option key={a.partner} value={a.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Product">
            <select value={draft.product} onChange={(e) => set("product", e.target.value)} className="field">
              <option value="">Pick a product</option>
              {catalog.map((p) => (
                <option key={p.product} value={p.product}>
                  {p.cluster} · {p.product}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              value={draft.opportunity_type}
              onChange={(e) => set("opportunity_type", e.target.value as NewDealDraft["opportunity_type"])}
              className="field"
            >
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Price (EUR)">
            <input
              type="number"
              min={1}
              value={draft.price_eur}
              onChange={(e) => set("price_eur", Number(e.target.value))}
              className="field"
            />
          </Field>
          <Field label="Win probability (%)">
            <input
              type="number"
              min={0}
              max={100}
              value={draft.win_probability_percent}
              onChange={(e) => set("win_probability_percent", Number(e.target.value))}
              className="field"
            />
          </Field>
          <Field label="Close date">
            <input
              type="date"
              value={draft.close_date}
              onChange={(e) => set("close_date", e.target.value)}
              className="field"
            />
          </Field>
          <div className="sm:col-span-3">
            <Button disabled={!valid || busy} onClick={() => void run(() => previewNewDeal(draft)).then((p) => p && setPreview(p))}>
              Preview
            </Button>
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-md border border-[color:var(--border)] p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
            <dt className="text-[color:var(--text-3)]">Customer</dt>
            <dd className="text-[color:var(--text)]">
              {preview.customer}{" "}
              <span className={`badge ${preview.existing_account ? "badge-gray" : "badge-amber"}`}>
                {preview.existing_account ? `existing · ${preview.partner}` : "new prospect"}
              </span>
            </dd>
            <dt className="text-[color:var(--text-3)]">Product</dt>
            <dd className="text-[color:var(--text)]">
              {preview.product} ({preview.cluster})
            </dd>
            <dt className="text-[color:var(--text-3)]">Value</dt>
            <dd className="tabular-nums text-[color:var(--text)]">EUR {preview.price_eur.toLocaleString("en-US")}</dd>
            <dt className="text-[color:var(--text-3)]">Status</dt>
            <dd className="text-[color:var(--text)]">
              Active · Discovery · {preview.win_probability_percent}% · close {preview.close_date} ·{" "}
              {preview.opportunity_type}
            </dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy} onClick={() => void decide("confirm")}>
              Confirm and create
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void decide("cancel")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p
          className="mt-2.5 text-[12px] leading-5"
          style={{ color: message.ok ? "var(--green)" : message.text.startsWith("Cancelled") ? "var(--text-3)" : "var(--red)" }}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold text-[color:var(--text-3)]">{label}</span>
      {children}
    </label>
  );
}
