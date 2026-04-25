import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const TEST_EMAIL = "test@propscore.local";
const TEST_PASSWORD = "123456";

async function main() {
  const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);

  await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: { hashedPassword, role: "ADMIN" },
    create: {
      email: TEST_EMAIL,
      name: "PropScore Test",
      hashedPassword,
      role: "ADMIN",
    },
  });

  console.log(`Seeded test user: ${TEST_EMAIL} / ${TEST_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
