import Link from "next/link";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { PAGE_SIZE, withParams } from "@/lib/query";
import { buttonClass } from "./ui";

type Params = Record<string, string | string[] | undefined>;

/** GET form: filters live in the URL so views are shareable and bookmarkable. */
export function FilterBar({
  action,
  q,
  placeholder,
  children,
  resetHref,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  children?: ReactNode;
  resetHref?: string;
}) {
  return (
    <form action={action} className="mb-4 flex flex-wrap items-end gap-2" role="search">
      {placeholder !== undefined && (
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder={placeholder} className="input pl-9" />
        </label>
      )}
      {children}
      <button className={buttonClass("secondary")}>Apply</button>
      {resetHref && (
        <Link href={resetHref} className={buttonClass("ghost")}>
          Reset
        </Link>
      )}
    </form>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: [string, string][];
}) {
  return (
    <label className="w-auto">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="input pr-8">
        <option value="">{label}: all</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pagination({
  basePath,
  params,
  page,
  total,
}: {
  basePath: string;
  params: Params;
  page: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span className="num">
        {from}–{to} of {total}
      </span>
      <div className="no-print flex gap-1.5">
        {page > 1 ? (
          <Link className={buttonClass("secondary", "sm")} href={`${basePath}${withParams(params, { page: page - 1 })}`}>
            Previous
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Previous</span>
        )}
        {page < pages ? (
          <Link className={buttonClass("secondary", "sm")} href={`${basePath}${withParams(params, { page: page + 1 })}`}>
            Next
          </Link>
        ) : (
          <span className={buttonClass("secondary", "sm", "pointer-events-none opacity-50")}>Next</span>
        )}
      </div>
    </div>
  );
}
