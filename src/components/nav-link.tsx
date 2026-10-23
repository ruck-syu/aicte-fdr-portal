"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import type { ReactNode } from "react";

export function NavLink({ href, children, badge }: { href: string; children: ReactNode; badge?: number }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        active ? "bg-white/12 font-medium text-white" : "text-brand-100 hover:bg-white/8 hover:text-white",
      )}
    >
      <span className="flex items-center gap-2.5">{children}</span>
      {badge ? (
        <span className="num rounded-full bg-saffron-500 px-1.5 py-px text-[11px] font-semibold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </Link>
  );
}
