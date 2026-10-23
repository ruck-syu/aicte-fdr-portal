import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { buttonClass, Skeleton } from "@/components/ui";
import { signOut } from "../auth-actions";

export default function PendingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-xs">
        <Logo />
        <Suspense fallback={<Skeleton className="mt-6 h-24" />}>
          <PendingBody />
        </Suspense>
      </div>
    </div>
  );
}

async function PendingBody() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role && user.is_active) redirect("/dashboard");
  return (
    <>
      <h1 className="mt-6 text-lg font-semibold">
        {user.is_active ? "Account awaiting activation" : "Account deactivated"}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        You are signed in as <strong>{user.email}</strong>, but no portal role is assigned
        {user.is_active ? " yet" : ""}. Please contact the AICTE portal administrator.
      </p>
      <form action={signOut} className="mt-6">
        <button className={buttonClass("secondary")}>Sign out</button>
      </form>
    </>
  );
}
