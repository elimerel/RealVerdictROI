import type { RubricItem, Verdict } from "@/lib/calculations";

const STATUS_TONE: Record<RubricItem["status"], string> = {
  win: "border-emerald-700 bg-emerald-950/30 text-emerald-300",
  ok: "border-zinc-700 bg-zinc-900/40 text-zinc-300",
  warn: "border-amber-800 bg-amber-950/30 text-amber-200",
  fail: "border-red-800 bg-red-950/30 text-red-200",
};

const STATUS_DOT: Record<RubricItem["status"], string> = {
  win: "bg-emerald-400",
  ok: "bg-zinc-500",
  warn: "bg-amber-400",
  fail: "bg-red-400",
};

export default function VerdictRubric({ verdict }: { verdict: Verdict }) {
  const totalMax = verdict.breakdown.reduce((s, r) => s + r.maxPoints, 0);
  const earned = verdict.breakdown.reduce((s, r) => s + Math.max(0, r.points), 0);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
            Why this verdict
          </div>
          <h2 className="mt-1 text-2xl font-semibold text-zinc-100 sm:text-3xl">
            Score: {verdict.score} / 100
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Seven independent signals, each weighted by how much it actually
            tells you about a deal. Negative-pointing signals subtract.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div className="font-mono tabular-nums">
            {earned} earned / {totalMax} possible
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {verdict.breakdown.map((item) => (
          <div
            key={item.category}
            className={`rounded-lg border p-4 ${STATUS_TONE[item.status]}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[item.status]}`}
                  />
                  <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                    {item.category}
                  </span>
                </div>
                <div className="mt-1 font-mono text-xs tabular-nums text-zinc-400">
                  {item.metric}
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`font-mono text-base font-semibold tabular-nums ${
                    item.points > 0
                      ? "text-zinc-100"
                      : item.points < 0
                        ? "text-red-300"
                        : "text-zinc-500"
                  }`}
                >
                  {item.points > 0 ? "+" : ""}
                  {item.points}
                </div>
                <div className="text-[10px] text-zinc-500">
                  / {item.maxPoints} max
                </div>
              </div>
            </div>
            <p className="mt-2.5 text-sm leading-snug text-zinc-200">
              {item.note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
