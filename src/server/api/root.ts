import { router } from "./trpc";
import { listingsRouter } from "./routers/listings";
import { filtersRouter } from "./routers/filters";
import { etlRouter } from "./routers/etl";
import { scoringRouter } from "./routers/scoring";
import { agentsRouter } from "./routers/agents";
import { chatRouter } from "./routers/chat";
import { starredListingsRouter } from "./routers/starredListings";
import { listingReviewsRouter } from "./routers/listingReviews";
import { emailsRouter } from "./routers/emails";
import { listingDocumentsRouter } from "./routers/listingDocuments";

export const appRouter = router({
  listings: listingsRouter,
  filters: filtersRouter,
  etl: etlRouter,
  scoring: scoringRouter,
  agents: agentsRouter,
  chat: chatRouter,
  starredListings: starredListingsRouter,
  listingReviews: listingReviewsRouter,
  emails: emailsRouter,
  listingDocuments: listingDocumentsRouter,
});

export type AppRouter = typeof appRouter;
