import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
  name: z.string().max(80).optional(),
});

export async function POST(req: Request) {
  const json = (await req.json().catch(() => null)) as unknown;
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const hashedPassword = await bcrypt.hash(parsed.data.password, 10);
  await db.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name || null,
      hashedPassword,
      role: "USER",
    },
  });
  return NextResponse.json({ ok: true });
}
