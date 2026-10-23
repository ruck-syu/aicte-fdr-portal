"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";

/**
 * Global search box. Pressing "/" focuses it from anywhere outside another
 * field; Escape returns focus to the page. The form is a plain GET to /search,
 * so it works before hydration too.
 */
export function GlobalSearch() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      // The sidebar renders twice (mobile header, desktop aside); prefer the visible one.
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-global-search]"));
      const field = inputs.find((el) => el.offsetParent !== null) ?? ref.current;
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.select();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form action="/search" role="search" className="mb-3 px-1">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-brand-200" />
        <input
          ref={ref}
          data-global-search
          name="q"
          type="search"
          aria-label="Search deposits, releases, demands and institutions"
          aria-keyshortcuts="/"
          placeholder="Search the register…"
          title="Search the register (press /)"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className="w-full rounded-md border border-white/15 bg-white/10 py-1.5 pr-8 pl-8 text-sm text-white placeholder:text-brand-200 focus:border-white/30 focus:ring-2 focus:ring-white/20 focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-white/20 px-1 text-[10px] text-brand-200">
          /
        </kbd>
      </div>
    </form>
  );
}
