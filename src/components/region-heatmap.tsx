import Link from "next/link";
import { REGION_LABELS } from "@/lib/labels";
import type { Region } from "@/lib/types";
import { EmptyState } from "./ui";

export type RegionStatusCounts = {
  region: Region;
  held: number;
  pending: number;
  returned: number;
  released: number;
};

const BUCKETS = [
  { key: "held", label: "Held", status: "held" },
  { key: "pending", label: "Pending", status: "submitted" },
  { key: "returned", label: "Returned", status: "discrepancy" },
  { key: "released", label: "Released", status: "released" },
] as const;

/** "North-Western (Chandigarh)" is too long for a heatmap row label. */
const shortRegion = (region: Region) => REGION_LABELS[region].split(" (")[0];

/**
 * Region × workflow state. Shading is volume-relative so the busiest cell is
 * always readable; every cell carries its number (and a title) so the colours
 * are never the only signal.
 */
export function RegionHeatmap({ rows }: { rows: RegionStatusCounts[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => BUCKETS.map((b) => r[b.key])));
  const total = rows.reduce((sum, r) => sum + BUCKETS.reduce((n, b) => n + r[b.key], 0), 0);
  if (!total) return <EmptyState title="No deposits yet" />;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="pb-1.5 text-left font-medium text-slate-500">Region</th>
              {BUCKETS.map((b) => (
                <th key={b.key} className="pb-1.5 text-center font-medium text-slate-500">
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.region}>
                <td className="py-1 pr-2 whitespace-nowrap">
                  <Link className="hover:underline" href={`/deposits?region=${r.region}`}>
                    {shortRegion(r.region)}
                  </Link>
                </td>
                {BUCKETS.map((b) => {
                  const n = r[b.key];
                  const ratio = n / max;
                  const shade = n === 0 ? undefined : 0.12 + 0.78 * Math.sqrt(ratio);
                  return (
                    <td key={b.key} className="p-0.5">
                      <Link
                        href={`/deposits?region=${r.region}&status=${b.status}`}
                        title={`${REGION_LABELS[r.region]} · ${b.label}: ${n}`}
                        className={`num grid h-7 place-items-center rounded-sm ${
                          n === 0 ? "bg-slate-50 text-slate-400" : ratio > 0.5 ? "text-white" : "text-slate-800"
                        }`}
                        style={shade === undefined ? undefined : { backgroundColor: `rgb(47 98 176 / ${shade.toFixed(2)})` }}
                      >
                        {n || "—"}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 text-xs text-slate-500">Cells shade with volume; click one to open the filtered register.</p>
    </>
  );
}
