import { NextResponse } from "next/server";

// Public self-service sign-up is disabled — users are created only by an
// admin (see the /admin/users screen and the admin.createUser tRPC
// procedure). This endpoint is kept as an explicit hard stop rather than a
// dangling 404 in case anything still points at it.
export async function POST() {
  return NextResponse.json(
    { error: "Public sign-up is disabled. Ask an administrator to create your account." },
    { status: 403 },
  );
}
