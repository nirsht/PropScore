import { redirect } from "next/navigation";
import { Container } from "@mui/material";
import { auth } from "@/lib/auth";
import { AdminNav } from "@/components/admin/AdminNav";

// Server-side guard for the whole /admin/* section. The (app) layout already
// enforces a logged-in session; this narrows it to ADMIN only. Non-admins are
// bounced to the listings page (the Admin nav is also hidden for them).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const role = (session?.user as { role?: "USER" | "ADMIN" } | undefined)?.role;
  if (role !== "ADMIN") redirect("/listings");
  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <AdminNav />
      {children}
    </Container>
  );
}
