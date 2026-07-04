import { z } from "zod";
import { defineTool } from "../base/tools";
import { db } from "@/lib/db";

/**
 * find_listings_by_agent — cross-listing lookup using Bridge's own
 * ListAgentFullName/CoListAgentFullName/ListAgentMlsId fields (stored in
 * Listing.raw). This is what powers "what else does this agent have
 * listed" without any external API call — the data is already in Bridge's
 * sync payload, it's just never been queried by name/MLS ID before.
 */
export const findListingsByAgentTool = defineTool({
  name: "find_listings_by_agent",
  description:
    "Find active listings where the given person is the list agent or co-list agent, using Bridge's MLS data already stored in PropScore. Pass agentName and/or agentMlsId (MLS ID is more precise if known). Returns address, price, and whether they're the list or co-list agent.",
  input: z
    .object({
      agentName: z.string().min(1).optional(),
      agentMlsId: z.string().min(1).optional(),
    })
    .refine((v) => v.agentName || v.agentMlsId, {
      message: "Provide agentName and/or agentMlsId.",
    }),
  run: async ({ agentName, agentMlsId }) => {
    const nameFilters = agentName
      ? [
          {
            raw: {
              path: ["ListAgentFullName"],
              string_contains: agentName,
              mode: "insensitive" as const,
            },
          },
          {
            raw: {
              path: ["CoListAgentFullName"],
              string_contains: agentName,
              mode: "insensitive" as const,
            },
          },
        ]
      : [];
    const mlsIdFilter = agentMlsId
      ? [{ raw: { path: ["ListAgentMlsId"], equals: agentMlsId } }]
      : [];

    const rows = await db.listing.findMany({
      where: {
        status: "Active",
        OR: [...nameFilters, ...mlsIdFilter],
      },
      select: { mlsId: true, address: true, price: true, raw: true },
      take: 25,
    });

    return rows.map((r) => {
      const raw = (r.raw ?? {}) as Record<string, unknown>;
      const isListAgent =
        agentMlsId && typeof raw.ListAgentMlsId === "string"
          ? raw.ListAgentMlsId === agentMlsId
          : agentName
            ? String(raw.ListAgentFullName ?? "").toLowerCase().includes(agentName.toLowerCase())
            : true;
      return {
        mlsId: r.mlsId,
        address: r.address,
        price: r.price,
        role: isListAgent ? ("list" as const) : ("co-list" as const),
      };
    });
  },
});
