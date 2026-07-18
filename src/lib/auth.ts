import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Gmail is connected via a standalone OAuth flow (src/app/api/gmail/*), NOT as
// a NextAuth login provider — the mailbox is an attachment on the logged-in
// user, not a login identity. This flag just gates the Connect-Gmail UI on the
// presence of Google credentials.
export const googleAuthEnabled = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

// NEXTAUTH_SECRET is optional in env.ts so ETL/CLI scripts that transitively
// import `env` don't crash without it. The web server, however, must never
// boot without a real secret — enforce that here, at the single point of use.
// This module is imported only by the Next.js app (src/app/**, src/server/api/**),
// never by an ETL stage, so this guard can't fire in a cron context.
function requireAuthSecret(): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required to run the web server (missing or < 16 chars). " +
        "Set it in the service environment. ETL & CLI scripts do not need it.",
    );
  }
  return secret;
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  secret: requireAuthSecret(),
  // Required on any non-Vercel deployment (Render, Fly, Railway, etc.) —
  // without this NextAuth refuses to operate on a non-localhost host and
  // returns the "Server error" config page.
  trustHost: true,
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    Credentials({
      name: "Email + Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({ where: { email: parsed.data.email } });
        if (!user?.hashedPassword) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.hashedPassword);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role?: string }).role ?? "USER";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        (session.user as { role?: string }).role = (token.role as string) ?? "USER";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
