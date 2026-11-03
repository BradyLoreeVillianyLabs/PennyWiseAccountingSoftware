import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PrismaClient } from "@clearledger/db";
import type { IdentityAdapter } from "../auth/identity-adapter.js";
import { UiSummaryService } from "../services/ui-summary-service.js";
import { requireOrganizationContext } from "./request-context.js";

const dateQuery = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const moduleParams = z
  .object({ module: z.enum(["sales", "expenses", "banking", "contacts", "taxes"]) })
  .strict();

export function registerUiSummaryRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  identityAdapter: IdentityAdapter,
  summaries: UiSummaryService
): void {
  app.get("/v1/ui/home-summary", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = dateQuery.parse(request.query);
    return reply.header("cache-control", "private, no-store").send({
      summary: await summaries.homeSummary(context, query.asOf)
    });
  });
  app.get("/v1/ui/attention-queue", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = dateQuery.parse(request.query);
    return reply.header("cache-control", "private, no-store").send({
      queue: await summaries.attentionQueue(context, query.asOf)
    });
  });
  app.get("/v1/ui/landing/:module", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const params = moduleParams.parse(request.params);
    const query = dateQuery.parse(request.query);
    return reply.header("cache-control", "private, no-store").send({
      landing: await summaries.landing(context, params.module, query.asOf)
    });
  });
  app.get("/v1/ui/tax-calendar", async (request, reply) => {
    const context = await requireOrganizationContext(request, prisma, identityAdapter);
    const query = dateQuery.parse(request.query);
    return reply.header("cache-control", "private, no-store").send({
      calendar: await summaries.taxCalendar(context, query.asOf)
    });
  });
}
