import { Hono } from "hono";
import { describeRoute, openAPIRouteHandler } from "hono-openapi";
import {
  adminAuthMiddleware,
  authMiddleware,
  requestIdMiddleware,
} from "./lib/auth";
import adminRoutes from "./routes/admin";
import chatRoutes from "./routes/chat";

const app = new Hono<{ Bindings: CloudflareBindings }>();

// Apply request ID middleware to all routes
app.use("*", requestIdMiddleware);

// Enhanced health check endpoint with system diagnostics
app.get(
  "/health",
  describeRoute({
    description: "System health check with diagnostics",
    tags: ["System"],
    responses: {
      200: {
        description: "System health status",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                status: { type: "string" },
                timestamp: { type: "string" },
                version: { type: "string" },
                services: {
                  type: "object",
                  properties: {
                    ai_gateway: { type: "string" },
                  },
                },
                performance: {
                  type: "object",
                  properties: {
                    response_time_ms: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
  }),
  async (c) => {
    const startTime = Date.now();
    const health = {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      services: {
        ai_gateway: "unknown",
      },
      performance: {
        response_time_ms: 0,
      },
    };

    // AI Gateway configuration check (no actual call to avoid costs)
    if (
      c.env.AI_GATEWAY_ACCOUNT_ID &&
      c.env.AI_GATEWAY_ID &&
      c.env.AI_GATEWAY_TOKEN
    ) {
      health.services.ai_gateway = "configured";
    } else {
      health.services.ai_gateway = "misconfigured";
      health.status = "degraded";
    }

    health.performance.response_time_ms = Date.now() - startTime;

    return c.json(health);
  },
);

// Root endpoint (temporary)
app.get("/", (c) => {
  return c.text("AI Gateway Proxy - Ready");
});

// Apply authentication middleware to routes
app.use("/v1/*", authMiddleware);
app.use("/admin/*", adminAuthMiddleware);

// Route handlers
app.route("/admin", adminRoutes);
app.route("/v1", chatRoutes);

// OpenAPI specification endpoint
app.get(
  "/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
      openapi: "3.1.0",
      info: {
        title: "AI Gateway Proxy API",
        version: "1.0.0",
        description:
          "Cloudflare Workers-based AI Gateway proxy with virtual key-based request management, three-level quota enforcement (virtual key, user, organization), and KV-only storage for optimal edge performance.",
        contact: {
          name: "API Support",
        },
      },
      servers: [
        {
          url: "https://your-worker.workers.dev",
          description: "Production server",
        },
        {
          url: "http://localhost:8787",
          description: "Development server",
        },
      ],
      tags: [
        {
          name: "System",
          description: "System health and metrics endpoints",
        },
        {
          name: "Chat",
          description: "OpenAI-compatible chat completions with quota enforcement",
        },
        {
          name: "Virtual Keys",
          description: "Virtual key management and usage tracking",
        },
        {
          name: "Users",
          description: "User management and aggregate usage tracking",
        },
        {
          name: "Organizations",
          description:
            "Organization management, provider keys, and budget tracking",
        },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "Virtual API key for authentication",
          },
          AdminAuth: {
            type: "http",
            scheme: "bearer",
            description: "Admin API key for management operations",
          },
        },
      },
      security: [],
    },
  }),
);

export default app;
