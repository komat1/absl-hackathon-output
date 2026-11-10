import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { RESEARCH_CATEGORY_LABEL, type ResearchBlock, type ResearchCategory, type ResearchSource } from "@/types/blocks";

const CATEGORY_TONE: Record<ResearchCategory, BadgeTone> = {
  cybersecurity: "red",
  "service-continuity": "amber",
  "technology-lifecycle": "blue",
  regulatory: "teal",
  "business-context": "gray"
};

const STAMP = new Intl.DateTimeFormat("en-IE", { day: "2-digit", month: "short", year: "numeric" });

/** A publication date can be a month without a day; print whichever we got
 *  rather than inventing the first of the month. */
function published(value: string): string {
  const full = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const month = /^\d{4}-\d{2}$/.test(value);
  if (full) return STAMP.format(new Date(`${value}T00:00:00`));
  if (month) return new Date(`${value}-01T00:00:00`).toLocaleDateString("en-IE", { month: "short", year: "numeric" });
  return value;
}

/** The host, so the reader can see where a link goes before clicking it. */
function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SourceLink({ source }: { source: ResearchSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex max-w-full items-baseline gap-1.5 text-[11.5px] leading-5 text-[color:var(--text-3)] hover:text-[color:var(--text)]"
      title={source.title}
    >
      <Icon icon="fa-sharp fa-regular fa-arrow-up-right-from-square" className="text-[9px]" />
      <span className="truncate underline decoration-[color:var(--line-2)] underline-offset-2">
        {source.publisher} · {host(source.url)}
      </span>
      <span className="shrink-0 tabular-nums text-[color:var(--text-4)]">{published(source.published)}</span>
    </a>
  );
}

/** One labelled line inside a finding. The labels are the whole point of this
 *  component: "the source says" and "we think" must never read as one voice. */
function Line({ icon, label, children }: { icon: string; label: string; children: string }) {
  return (
    <div className="flex gap-2">
      <Icon icon={`fa-sharp fa-regular ${icon}`} className="mt-[4px] shrink-0 text-[10px] text-[color:var(--text-4)]" />
      <p className="min-w-0 text-[12.5px] leading-5 text-[color:var(--text-2)]">
        <span className="font-semibold text-[color:var(--text-3)]">{label} </span>
        {children}
      </p>
    </div>
  );
}

/**
 * Public web research, rendered as a block like any other.
 *
 * This is the one component on screen whose content is real. Everything else in
 * this app is simulated business data, so the block leads with what it is and
 * when it was fetched, and every claim carries its source and publication date
 * — without those two dates the finding is worth nothing to a salesperson.
 *
 * The three labelled lines under each claim are deliberate and not decoration.
 * "The source says" is quoted work; "could mean for us" is our inference; "ask
 * them" is the admission that neither the source nor the dataset can tell us
 * whether this customer is actually affected. Collapsing them into one
 * paragraph is exactly the mistake the brief warns about.
 */
export function ResearchView({ block }: { block: ResearchBlock }) {
  const { report } = block;
  const empty = report.findings.length === 0 && report.candidates.length === 0;

  return (
    <section className="panel animate-block-in p-4">
      <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-[13px] font-semibold text-[color:var(--text-2)]">{block.title}</h3>
        <Badge tone="teal">Public sources</Badge>
        <span className="text-[11px] text-[color:var(--text-4)]">accessed {published(block.accessed)}</span>
      </header>
      <p className="mt-1 text-[11px] leading-5 text-[color:var(--text-4)]">
        Real public sources — not evidence this account is affected. Deal figures elsewhere are simulated.
      </p>

      {report.summary && (
        <p className="mt-3 text-[13px] leading-[1.55] text-[color:var(--text)]">{report.summary}</p>
      )}

      {report.findings.length > 0 && (
        <ol className="mt-3 flex flex-col divide-y divide-[color:var(--line)]">
          {report.findings.map((finding) => (
            <li key={finding.claim} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline gap-2">
                <Badge tone={CATEGORY_TONE[finding.category]}>{RESEARCH_CATEGORY_LABEL[finding.category]}</Badge>
                <SourceLink source={finding.source} />
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-[color:var(--text)]">{finding.claim}</p>
              <div className="mt-1.5">
                <Line icon="fa-comment-question" label="Ask them —">
                  {finding.question}
                </Line>
              </div>
              <details className="group mt-1">
                <summary className="cursor-pointer list-none text-[11.5px] text-[color:var(--text-4)] hover:text-[color:var(--text-2)]">
                  <Icon icon="fa-sharp fa-regular fa-chevron-right" className="mr-1 text-[9px] group-open:rotate-90" />
                  What it could mean · next step
                </summary>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  <Line icon="fa-lightbulb" label="Could mean for us —">
                    {finding.implication}
                  </Line>
                  <Line icon="fa-arrow-right" label="Next step —">
                    {finding.next_step}
                  </Line>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}

      {report.candidates.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-[12px] font-semibold text-[color:var(--text-3)]">
            Companies worth a look — suggestions, not pipeline
          </h4>
          <ul className="flex flex-col divide-y divide-[color:var(--line)]">
            {report.candidates.map((candidate) => (
              <li key={candidate.company} className="py-2.5 first:pt-0 last:pb-0">
                <div className="text-[13px] font-semibold text-[color:var(--text)]">{candidate.company}</div>
                <p className="mt-0.5 text-[12.5px] leading-5 text-[color:var(--text-2)]">{candidate.why}</p>
                <Line icon="fa-comment" label="Opener —">
                  {candidate.opener}
                </Line>
                {candidate.sources.length > 0 && (
                  <div className="mt-1 flex flex-col gap-0.5">
                    {candidate.sources.map((source) => (
                      <SourceLink key={source.url} source={source} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.topics.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-[12px] font-semibold text-[color:var(--text-3)]">Take into the meeting</h4>
          <ul className="list-disc pl-5 text-[12.5px] leading-5 text-[color:var(--text-2)]">
            {report.topics.map((topic) => (
              <li key={topic}>{topic}</li>
            ))}
          </ul>
        </div>
      )}

      {/* A gap is a result — kept, but folded away so it doesn't drown the findings. */}
      {report.gaps.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[11.5px] text-[color:var(--text-4)] hover:text-[color:var(--text-2)]">
            <Icon icon="fa-sharp fa-regular fa-chevron-right" className="mr-1 text-[9px] group-open:rotate-90" />
            Not found ({report.gaps.length})
          </summary>
          <ul className="mt-1 list-disc pl-5 text-[11.5px] leading-5 text-[color:var(--text-4)]">
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </details>
      )}

      {empty && (
        <p className="mt-3 text-[12.5px] leading-5 text-[color:var(--text-3)]">
          Nothing citable came back. Try a narrower topic, or the industry rather than the company.
        </p>
      )}
    </section>
  );
}
