import { router } from "./trpc";
import { listingsRouter } from "./routers/listings";
import { filtersRouter } from "./routers/filters";
import { etlRouter } from "./routers/etl";
import { scoringRouter } from "./routers/scoring";
import { agentsRouter } from "./routers/agents";

export const appRouter = router({
  listings: listingsRouter,
  filters: filtersRouter,
  etl: etlRouter,
  scoring: scoringRouter,
  agents: agentsRouter,
});

export type AppRouter = typeof appRouter;
