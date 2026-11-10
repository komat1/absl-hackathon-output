import { Fragment, type ReactNode } from "react";

/**
 * Minimal, XSS-safe markdown renderer for copilot replies. Supports the small
 * subset the agent is told to use: **bold**, *italic*, `code`, "- " bullets,
 * "1. " numbered steps, "### " sub-headings and "| a | b |" tables. It builds
 * React nodes directly (no dangerouslySetInnerHTML), so model output can never
 * inject markup.
 *
 * Structure matters more here than it looks: an answer is a briefing — the
 * figures, where they came from, what to do next — and a briefing rendered as
 * one wall of prose is one nobody reads in front of a customer.
 */

const INLINE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;

export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[2] !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold text-[color:var(--text)]">
          {match[2]}
        </strong>
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <code key={key++} className="rounded bg-[color:var(--well)] px-1 py-0.5 text-[12px]">
          {match[3]}
        </code>
      );
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key++}>{match[4]}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** One parsed line: what it is decides how it is laid out. */
type Line =
  | { kind: "heading"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "step"; marker: string; text: string }
  | { kind: "row"; cells: string[] }
  | { kind: "divider"; aligns: Align[] }
  | { kind: "text"; text: string };

type Align = "left" | "right";

/**
 * A table row is strict — it must both start and end with a pipe. Markdown also
 * allows `a | b`, but this renderer sits under free prose where a stray pipe in
 * a sentence is likelier than a borderless table.
 */
const ROW = /^\s*\|(.*)\|\s*$/;
const DIVIDER = /^[\s:|-]+$/;

/** Splits on unescaped pipes, so a cell may contain a literal `\|`. */
function cells(inner: string): string[] {
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function parse(line: string): Line {
  const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
  if (heading) return { kind: "heading", text: heading[1] ?? "" };
  const row = ROW.exec(line);
  if (row) {
    const inner = row[1] ?? "";
    const parts = cells(inner);
    // "|---|---:|" — carries the per-column alignment, never any content.
    if (inner.includes("-") && DIVIDER.test(inner)) {
      return { kind: "divider", aligns: parts.map((part) => (part.endsWith(":") ? "right" : "left")) };
    }
    return { kind: "row", cells: parts };
  }
  const step = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
  if (step) return { kind: "step", marker: step[1] ?? "", text: step[2] ?? "" };
  if (/^\s*[-•*]\s+/.test(line)) return { kind: "bullet", text: line.replace(/^\s*[-•*]\s+/, "") };
  return { kind: "text", text: line };
}

const NUMERIC = /^[\s€$%+-]*\d[\d\s.,]*\s*(€|%|k|m|bn|pp|days?|months?)?\s*$/i;

/** A column of nothing but amounts reads right-aligned, the way money always does. */
function autoAlign(rows: string[][], column: number): Align {
  const values = rows.map((row) => row[column] ?? "").filter((value) => value !== "" && value !== "—" && value !== "-");
  return values.length > 0 && values.every((value) => NUMERIC.test(value)) ? "right" : "left";
}

/**
 * One markdown table. The head row is whatever came first; alignment comes from
 * the divider when the agent wrote one, otherwise from the body's own shape.
 *
 * Deliberately tolerant of a half-arrived table: answers stream in line by line,
 * so a table exists for a second as a lone header with no divider and no body.
 * Rendering that as a head-only table beats flashing raw pipes at the reader.
 */
function Table({ rows, aligns }: { rows: string[][]; aligns: Align[] }) {
  const [head, ...body] = rows;
  const width = Math.max(...rows.map((row) => row.length));
  const columns = Array.from({ length: width }, (_, index) => aligns[index] ?? autoAlign(body, index));
  return (
    <div className="-mx-1 my-1.5 overflow-x-auto px-1">
      <table className="table-rows w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {columns.map((align, index) => (
              <th
                key={index}
                className={`eyebrow whitespace-nowrap pb-1.5 pr-3 ${align === "right" ? "text-right" : "text-left"}`}
              >
                {renderInline(head?.[index] ?? "")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r}>
              {columns.map((align, index) => (
                <td
                  key={index}
                  className={`py-1.5 pr-3 align-top text-[color:var(--text-2)] ${
                    align === "right" ? "whitespace-nowrap text-right tabular-nums" : "text-left"
                  }`}
                >
                  {renderInline(row[index] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RichText({ text }: { text: string }) {
  const raw = text.split("\n");
  // The answer streams in token by token, so the last line is routinely half a
  // row ("| Siemens | 141"). Closing it keeps the row inside the table instead
  // of flashing raw pipes as prose for a frame on every single row.
  const lines = raw.map((line, index) =>
    parse(index === raw.length - 1 && /^\s*\|/.test(line) && !ROW.test(line) ? `${line} |` : line)
  );
  const out: ReactNode[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    // A run of consecutive row/divider lines is one table — collected here so
    // the per-line renderer below never has to know tables exist.
    if (line.kind === "row" || line.kind === "divider") {
      const rows: string[][] = [];
      let aligns: Align[] = [];
      const start = index;
      for (; index < lines.length; index++) {
        const current = lines[index]!;
        if (current.kind === "row") rows.push(current.cells);
        else if (current.kind === "divider") aligns = current.aligns;
        else break;
      }
      index--;
      if (rows.length > 0) out.push(<Table key={start} rows={rows} aligns={aligns} />);
      continue;
    }

    out.push(renderLine(line, index, lines[index + 1]));
  }

  return <div className="flex flex-col">{out}</div>;
}

/** Everything that is not part of a table — those are collected by RichText itself. */
function renderLine(
  line: Exclude<Line, { kind: "row" | "divider" }>,
  index: number,
  next: Line | undefined
): ReactNode {
  // Blank lines between blocks would double up with the per-block spacing,
  // so an empty text line only survives as a small gap.
  if (line.kind === "text" && line.text.trim() === "") {
    return <span key={index} className="h-2" />;
  }
  // The agent opens every briefing with one bold headline — give it the weight
  // of a title so the answer reads at a glance.
  const lead = line.kind === "text" ? /^\s*\*\*([^*]+)\*\*\s*$/.exec(line.text) : null;
  if (lead) {
    return (
      <div key={index} className={`text-[14.5px] font-semibold leading-snug text-[color:var(--text)] ${index === 0 ? "" : "mt-2"} mb-0.5`}>
        {lead[1]}
      </div>
    );
  }
  if (line.kind === "heading") {
    return (
      <div
        key={index}
        className={`eyebrow text-[color:var(--text-3)] ${index === 0 ? "" : "mt-3 border-t border-[color:var(--line)] pt-2.5"} mb-1`}
      >
        {renderInline(line.text)}
      </div>
    );
  }
  if (line.kind === "step") {
    return (
      <div key={index} className="flex gap-2.5 py-[3px]">
        <span className="mt-[1px] grid size-[18px] shrink-0 place-items-center rounded-md bg-[color:var(--brand-bg)] text-[10.5px] font-bold tabular-nums text-[color:var(--brand-500)]">
          {line.marker}
        </span>
        <span className="min-w-0 flex-1">{renderInline(line.text)}</span>
      </div>
    );
  }
  if (line.kind === "bullet") {
    return (
      <div key={index} className="flex gap-2 py-[2px]">
        <span className="mt-[9px] size-1 shrink-0 rounded-full bg-[color:var(--text-4)]" />
        <span className="min-w-0 flex-1">{renderInline(line.text)}</span>
      </div>
    );
  }
  return (
    <Fragment key={index}>
      <span>{renderInline(line.text)}</span>
      {/* A run of plain prose keeps its line breaks; a paragraph followed by a
          list does not need an extra one — the list has its own. */}
      {next && next.kind === "text" && next.text.trim() !== "" && <span className="h-1" />}
    </Fragment>
  );
}
