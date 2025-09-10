/**
 * Complete Admin API routes for user, organization, and system management
 */

import { Hono } from "hono";

import organizationRoutes from "./admin/organizations";
import userRoutes from "./admin/users";

const admin = new Hono<{ Bindings: CloudflareBindings }>();

// System metrics endpoint
admin.get("/metrics", async (c) => {
  const { GATEWAY_KV } = c.env;
  const { mode } = c.req.query(); // Get the 'mode' query parameter

  if (mode === "exact") {
    // --- This is the potentially slow logic ---
    async function getExactCount(prefix: string): Promise<number> {
      let count = 0;
      let cursor: string | undefined;
      do {
        const result = await GATEWAY_KV.list({ prefix, cursor });
        count += result.keys.length;
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor);
      return count;
    }

    const userCount = await getExactCount("user:");
    const orgCount = await getExactCount("org:");
    const apiKeyCount = await getExactCount("apikey:");

    return c.json({
      timestamp: new Date().toISOString(),
      entities: {
        users: userCount,
        organizations: orgCount,
        api_keys: apiKeyCount,
      },
    });
  }
  // --- This is the default fast, estimated logic ---
  async function getCountEstimate(prefix: string): Promise<string | number> {
    const result = await GATEWAY_KV.list({ prefix, limit: 1000 });
    if (result.keys.length < 1000) {
      return result.keys.length; // It's an exact count
    }
    return "1000+"; // It's an estimate
  }

  const userCount = await getCountEstimate("user:");
  const orgCount = await getCountEstimate("org:");
  const apiKeyCount = await getCountEstimate("apikey:");

  return c.json({
    timestamp: new Date().toISOString(),
    system: {
      version: "1.0.0",
    },
    entities: {
      users: userCount,
      organizations: orgCount,
      api_keys: apiKeyCount,
    },
    note: 'Counts are exact up to 1,000. "1000+" indicates more records exist. For an exact count, use ?mode=exact (may be slow).',
  });
});

admin.route("/organizations", organizationRoutes);
admin.route("/users", userRoutes);

export default admin;
