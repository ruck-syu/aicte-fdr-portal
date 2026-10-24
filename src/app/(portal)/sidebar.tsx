import {
  Banknote,
  Bell,
  Building2,
  ClipboardList,
  FileBarChart,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Undo2,
  Users,
} from "lucide-react";
import { requireUser, isOfficial } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CLEARANCE_CELL_LABELS, REGION_LABELS, ROLE_LABELS } from "@/lib/labels";
import { NavLink } from "@/components/nav-link";
import { GlobalSearch } from "@/components/global-search";
import { Logo } from "@/components/logo";
import { Skeleton } from "@/components/ui";
import { signOut } from "../auth-actions";

const iconCls = "size-4 shrink-0 opacity-80";

export async function Sidebar() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: unread }, { count: pending }, { count: pendingClearances }] = await Promise.all([
    supabase.rpc("unread_notification_count"),
    isOfficial(user.role)
      ? supabase.from("deposits").select("id", { count: "exact", head: true }).eq("status", "submitted")
      : supabase
          .from("deposits")
          .select("id", { count: "exact", head: true })
          .in("status", ["draft", "discrepancy"]),
    user.role === "release_officer" && user.clearance_cell
      ? supabase
          .from("release_clearances")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .eq("cell", user.clearance_cell)
      : Promise.resolve({ count: 0 }),
  ]);
  const official = isOfficial(user.role);

  const scope =
    user.role === "institute_user"
      ? user.institution?.name
      : user.role === "regional_officer" && user.region
        ? REGION_LABELS[user.region]
        : user.role === "release_officer" && user.clearance_cell
          ? `${CLEARANCE_CELL_LABELS[user.clearance_cell]} cell`
          : "All regions";

  const nav = (
    <nav className="space-y-0.5">
      <GlobalSearch />
      <NavLink href="/dashboard">
        <LayoutDashboard className={iconCls} /> Dashboard
      </NavLink>
      <NavLink href="/deposits" badge={pending ?? 0}>
        <Banknote className={iconCls} /> Deposits
      </NavLink>
      <NavLink href="/demands">
        <ClipboardList className={iconCls} /> Deposit demands
      </NavLink>
      <NavLink href="/releases" badge={user.role === "release_officer" ? (pendingClearances ?? 0) : undefined}>
        <Undo2 className={iconCls} /> Release requests
      </NavLink>
      <NavLink href="/notifications" badge={(unread as number | null) ?? 0}>
        <Bell className={iconCls} /> Alerts
      </NavLink>
      {official && (
        <NavLink href="/reports">
          <FileBarChart className={iconCls} /> Reports
        </NavLink>
      )}
      <NavLink href="/audit">
        <FileClock className={iconCls} /> Audit trail
      </NavLink>
      {user.role === "admin" && (
        <>
          <div className="px-3 pt-5 pb-1.5 text-[11px] font-semibold tracking-wider text-brand-300 uppercase">
            Administration
          </div>
          <NavLink href="/admin/users">
            <Users className={iconCls} /> Users
          </NavLink>
          <NavLink href="/admin/institutions">
            <Building2 className={iconCls} /> Institutions
          </NavLink>
          <NavLink href="/admin/settings">
            <Settings className={iconCls} /> Settings
          </NavLink>
        </>
      )}
    </nav>
  );

  const account = (
    <div className="border-t border-white/10 pt-4">
      <div className="flex items-start gap-2.5 px-1">
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">
          {(user.full_name || user.email).slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 text-xs">
          <div className="truncate font-medium text-white">{user.full_name || user.email}</div>
          <div className="flex items-center gap-1 text-brand-200">
            <ShieldCheck className="size-3" /> {ROLE_LABELS[user.role]}
          </div>
          <div className="truncate text-brand-300">{scope}</div>
        </div>
      </div>
      <form action={signOut} className="mt-3">
        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-100 hover:bg-white/8 hover:text-white">
          <LogOut className={iconCls} /> Sign out
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Mobile */}
      <header className="sticky top-0 z-30 bg-brand-900 text-white lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2.5">
              <Logo className="size-7" />
              <span className="text-sm font-semibold">AICTE FDR Portal</span>
            </span>
            <Menu className="size-5" />
          </summary>
          <div className="space-y-4 px-3 pb-4">
            {nav}
            {account}
          </div>
        </details>
      </header>

      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-brand-900 px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">AICTE</div>
            <div className="text-xs text-brand-200">Security Deposit &amp; FDR</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        {account}
      </aside>
    </>
  );
}

export function SidebarSkeleton() {
  return (
    <>
      <div className="h-13 bg-brand-900 lg:hidden" />
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col gap-2 bg-brand-900 px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 bg-white/10" />
        ))}
      </aside>
    </>
  );
}
