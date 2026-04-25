import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { auth } from "@/lib/auth";
import { Providers } from "./Providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PropScore",
  description: "MLS Property Opportunity Scoring",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Hydrate SessionProvider from the server so the client never has to fetch
  // /api/auth/session on first paint.
  const session = await auth();
  return (
    <html lang="en" data-mui-color-scheme="dark" className={inter.variable}>
      <body>
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
