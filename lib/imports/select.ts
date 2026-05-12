import "server-only";
import { imports, platformConnections } from "@/lib/db/schema";

/** Projection for /api/imports/[importId]/status. */
export const importStatusProjection = {
  id: imports.id,
  status: imports.status,
  importedCount: imports.importedCount,
  totalCount: imports.totalCount,
  errorMessage: imports.errorMessage,
  conflictsJsonb: imports.conflictsJsonb,
  unmatchedJsonb: imports.unmatchedJsonb,
  startedAt: imports.startedAt,
  completedAt: imports.completedAt,
  createdAt: imports.createdAt,
  userId: imports.userId,
} as const;

/** Projection for listConnections — joined to count + lastSyncedAt. */
export const connectionListProjection = {
  platform: platformConnections.platform,
  externalId: platformConnections.externalId,
  lastSyncedAt: platformConnections.lastSyncedAt,
  isActive: platformConnections.isActive,
} as const;
