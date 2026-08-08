import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/sign-in");
  const role = (session.user as { role?: "USER" | "ADMIN" }).role ?? "USER";
  return (
    <AppShell userEmail={session.user.email ?? ""} role={role}>
      {children}
    </AppShell>
  );
}
