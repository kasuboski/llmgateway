import { Hono } from "hono";
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
app.get("/health", async (c) => {
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
});

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

export default app;
