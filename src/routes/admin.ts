/**
 * Complete Admin API routes for virtual keys, organization, and system management
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import organizationRoutes from "./admin/organizations";
import userRoutes from "./admin/users";
import vkeyRoutes from "./admin/vkeys";

const admin = new Hono<{ Bindings: CloudflareBindings }>();

// System metrics endpoint
admin.get(
  "/metrics",
  describeRoute({
    description: "Get system metrics and entity counts",
    tags: ["System"],
    parameters: [
      {
        name: "mode",
        in: "query",
        description:
          'Count mode: "fast" (default, estimates for 1000+) or "exact" (precise count, may be slow)',
        required: false,
        schema: {
          type: "string",
          enum: ["fast", "exact"],
          default: "fast",
        },
      },
    ],
    responses: {
      200: {
        description: "System metrics with entity counts",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                timestamp: { type: "string" },
                system: {
                  type: "object",
                  properties: {
                    version: { type: "string" },
                  },
                },
                entities: {
                  type: "object",
                  properties: {
                    virtual_keys: {
                      oneOf: [{ type: "number" }, { type: "string" }],
                    },
                    organizations: {
                      oneOf: [{ type: "number" }, { type: "string" }],
                    },
                  },
                },
                note: { type: "string" },
              },
            },
          },
        },
      },
    },
  }),
  async (c) => {
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

    const vkeyCount = await getExactCount("vkey:");
    const orgCount = await getExactCount("org:");

    return c.json({
      timestamp: new Date().toISOString(),
      entities: {
        virtual_keys: vkeyCount,
        organizations: orgCount,
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

  const vkeyCount = await getCountEstimate("vkey:");
  const orgCount = await getCountEstimate("org:");

  return c.json({
    timestamp: new Date().toISOString(),
    system: {
      version: "1.0.0",
    },
    entities: {
      virtual_keys: vkeyCount,
      organizations: orgCount,
    },
    note: 'Counts are exact up to 1,000. "1000+" indicates more records exist. For an exact count, use ?mode=exact (may be slow).',
  });
  },
);

admin.route("/organizations", organizationRoutes);
admin.route("/users", userRoutes);
admin.route("/vkeys", vkeyRoutes);

export default admin;
