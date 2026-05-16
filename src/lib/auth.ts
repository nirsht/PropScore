import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Gmail scopes for the rent-roll outreach feature.
//   gmail.compose  → create drafts (never sends, per product decision)
//   gmail.modify   → read message threads + apply labels for reply tracking
// Combined with openid/email/profile so we can match the Google email to the
// existing Credentials user via account-linking.
const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
].join(" ");

const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const googleAuthEnabled = googleConfigured;

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  secret: env.NEXTAUTH_SECRET,
  // Required on any non-Vercel deployment (Render, Fly, Railway, etc.) —
  // without this NextAuth refuses to operate on a non-localhost host and
  // returns the "Server error" config page.
  trustHost: true,
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    ...(googleConfigured
      ? [
          Google({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Single-user dev/prod where the Gmail email matches the
            // Credentials email — links the new Google Account row to the
            // existing User instead of creating a duplicate.
            allowDangerousEmailAccountLinking: true,
            authorization: {
              params: {
                access_type: "offline",
                prompt: "consent",
                scope: GMAIL_SCOPES,
              },
            },
          }),
        ]
      : []),
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
