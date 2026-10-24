import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

/**
 * Column header that sorts the list through the URL, so a sorted view can be
 * bookmarked, shared and exported. `aria-sort` lives on the parent <th>.
 */
export function SortLink({
  label,
  href,
  active,
  dir,
  align = "left",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  align?: "left" | "right";
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-1 hover:text-slate-900 ${align === "right" ? "flex-row-reverse" : ""}`}
      title={`Sort by ${label.toLowerCase()}`}
    >
      {label}
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="size-3.5 text-brand-700" />
        ) : (
          <ArrowDown className="size-3.5 text-brand-700" />
        )
      ) : (
        <ChevronsUpDown className="size-3.5 text-slate-300 group-hover:text-slate-500" />
      )}
    </Link>
  );
}
