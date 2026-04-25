import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext(),
    onError({ error, path, type }) {
      // Always log — silently swallowing tRPC errors hides root causes.
      // eslint-disable-next-line no-console
      console.error(`[tRPC ${type} ${path}] ${error.code} ${error.message}`);
      if (error.cause) {
        // eslint-disable-next-line no-console
        console.error(error.cause);
      }
    },
  });

export { handler as GET, handler as POST };
