import { formatINR, formatINRCompact } from "@/lib/format";

type Point = { month: string; count: number; value: number };

const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });
const monthYearFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v) ?? 10;
  return step * pow;
}

/**
 * Column chart of deposit value maturing per month (single series, so no
 * legend: the card title names it). Pure HTML/CSS: each month is a focusable
 * hit target with a hover/focus tooltip, and a table view sits underneath.
 */
export function MaturityChart({ data }: { data: Point[] }) {
  const max = niceMax(Math.max(...data.map((d) => Number(d.value)), 0));
  const ticks = [max, max / 2, 0];
  const peak = data.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), data[0]);

  return (
    <div>
      <div className="flex gap-3">
        {/* Y axis */}
        <div className="num relative h-48 w-12 shrink-0 text-right text-[11px] text-slate-500" aria-hidden>
          {ticks.map((t, i) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
              {formatINRCompact(t)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-48">
            {/* Gridlines: hairline, solid, recessive */}
            {ticks.map((t, i) => (
              <div
                key={t}
                className="absolute inset-x-0 border-t border-slate-200"
                style={{ top: `${(i / 2) * 100}%` }}
                aria-hidden
              />
            ))}
            <ul className="absolute inset-0 flex" aria-label="Value maturing by month">
              {data.map((d) => {
                const value = Number(d.value);
                const h = (value / max) * 100;
                const date = new Date(`${d.month}-01T00:00:00Z`);
                const isPeak = d === peak && value > 0;
                return (
                  <li
                    key={d.month}
                    tabIndex={0}
                    aria-label={`${monthYearFmt.format(date)}: ${d.count} deposit${d.count === 1 ? "" : "s"}, ${formatINR(value)}`}
                    className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                  >
                    {/* hover band */}
                    <span className="absolute inset-y-0 inset-x-0.5 rounded-sm bg-slate-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    {value > 0 && (
                      <span
                        className="relative w-full max-w-6 rounded-t-[4px] bg-brand-600 transition-colors group-hover:bg-brand-700"
                        style={{ height: `max(${h}%, 2px)` }}
                      />
                    )}
                    {isPeak && (
                      <span
                        className="num absolute -translate-y-full pb-1 text-[11px] font-medium text-slate-700 group-hover:invisible"
                        style={{ bottom: `${h}%` }}
                      >
                        {formatINRCompact(value)}
                      </span>
                    )}
                    {/* tooltip */}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block group-focus-visible:block"
                    >
                      <span className="block font-medium">{monthYearFmt.format(date)}</span>
                      <span className="num block text-slate-300">
                        {d.count} deposit{d.count === 1 ? "" : "s"} · {formatINR(value)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          {/* X axis */}
          <div className="mt-1.5 flex text-[11px] text-slate-500" aria-hidden>
            {data.map((d) => {
              const date = new Date(`${d.month}-01T00:00:00Z`);
              const jan = date.getUTCMonth() === 0;
              return (
                <span key={d.month} className="flex-1 text-center">
                  {monthFmt.format(date)}
                  {jan && <span className="block text-slate-400">{date.getUTCFullYear()}</span>}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">View as table</summary>
        <table className="data-table mt-2">
          <thead>
            <tr>
              <th>Month</th>
              <th className="text-right">Deposits</th>
              <th className="text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.month}>
                <td>{monthYearFmt.format(new Date(`${d.month}-01T00:00:00Z`))}</td>
                <td className="num text-right">{d.count}</td>
                <td className="num text-right">{formatINR(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
