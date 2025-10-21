import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import type { OrganizationConfig, VirtualKeyConfig } from "../../types";
import { getOrganizationQuotaRecord } from "../../lib/quota";

const organizations = new Hono<{ Bindings: CloudflareBindings }>();

const CreateOrganizationSchema = z.object({
  name: z.string().min(1),
  monthly_budget_usd: z.number().positive().optional(),
  failure_mode: z.enum(["fail-open", "fail-closed"]).optional(),
  provider_keys: z.record(z.string()).optional(),
});

const UpdateOrganizationSchema = z.object({
  name: z.string().min(1).optional(),
  monthly_budget_usd: z.number().positive().optional(),
  failure_mode: z.enum(["fail-open", "fail-closed"]).optional(),
  provider_keys: z.record(z.string()).optional(),
});

const OrgIdParamSchema = z.object({
  org_id: z.string().min(1),
});

// Organization Management
organizations.post(
  "/",
  zValidator("json", CreateOrganizationSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;

    try {
      const {
        name,
        monthly_budget_usd = 100,
        failure_mode = "fail-closed",
        provider_keys = {},
      } = c.req.valid("json");

      const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const organizationConfig: OrganizationConfig = {
        org_id: orgId,
        name,
        monthly_budget_usd,
        failure_mode,
        provider_keys,
        created_at: new Date().toISOString(),
      };

      await GATEWAY_KV.put(
        `org:${orgId}:config`,
        JSON.stringify(organizationConfig),
      );

      return c.json(
        {
          message: "Organization created successfully",
          organization: organizationConfig,
        },
        201,
      );
    } catch (error) {
      console.error("Create organization error:", error);
      return c.json(
        {
          error: {
            message: "Failed to create organization",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

organizations.get(
  "/org_id",
  zValidator("param", OrgIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const orgId = c.req.param("org_id");

    try {
      const organizationConfig = (await GATEWAY_KV.get(
        `org:${orgId}:config`,
        "json",
      )) as OrganizationConfig | null;
      if (!organizationConfig) {
        return c.json(
          { error: { message: "Organization not found", type: "not_found" } },
          404,
        );
      }

      return c.json({ organization: organizationConfig });
    } catch (error) {
      console.error("Get organization error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get organization",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

organizations.patch(
  "/:org_id",
  zValidator("param", OrgIdParamSchema),
  zValidator("json", UpdateOrganizationSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const orgId = c.req.param("org_id");

    try {
      const body = c.req.valid("json");
      const organizationConfig = (await GATEWAY_KV.get(
        `org:${orgId}:config`,
        "json",
      )) as OrganizationConfig | null;
      if (!organizationConfig) {
        return c.json(
          { error: { message: "Organization not found", type: "not_found" } },
          404,
        );
      }

      if (body.name !== undefined) organizationConfig.name = body.name;
      if (body.monthly_budget_usd !== undefined)
        organizationConfig.monthly_budget_usd = body.monthly_budget_usd;
      if (body.failure_mode !== undefined)
        organizationConfig.failure_mode = body.failure_mode;
      if (body.provider_keys !== undefined)
        organizationConfig.provider_keys = body.provider_keys;

      await GATEWAY_KV.put(
        `org:${orgId}:config`,
        JSON.stringify(organizationConfig),
      );

      return c.json({
        message: "Organization updated successfully",
        organization: organizationConfig,
      });
    } catch (error) {
      console.error("Update organization error:", error);
      return c.json(
        {
          error: {
            message: "Failed to update organization",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

organizations.get(
  "/:org_id/vkeys",
  zValidator("param", OrgIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const orgId = c.req.param("org_id");

    try {
      const organizationConfig = (await GATEWAY_KV.get(
        `org:${orgId}:config`,
        "json",
      )) as OrganizationConfig | null;
      if (!organizationConfig) {
        return c.json(
          { error: { message: "Organization not found", type: "not_found" } },
          404,
        );
      }

      // List all virtual key configs
      const { keys } = await GATEWAY_KV.list({ prefix: "vkey:" });
      const vkeyConfigs = [];

      for (const key of keys) {
        if (key.name.endsWith(":config")) {
          const vkeyConfig = (await GATEWAY_KV.get(
            key.name,
            "json",
          )) as VirtualKeyConfig | null;
          if (vkeyConfig && vkeyConfig.org_id === orgId) {
            // Return config without sensitive key_hash
            vkeyConfigs.push({
              key_id: vkeyConfig.key_id,
              org_id: vkeyConfig.org_id,
              user: vkeyConfig.user,
              name: vkeyConfig.name,
              monthly_limit_usd: vkeyConfig.monthly_limit_usd,
              status: vkeyConfig.status,
              created_at: vkeyConfig.created_at,
            });
          }
        }
      }

      return c.json({
        organization_id: orgId,
        virtual_keys: vkeyConfigs,
      });
    } catch (error) {
      console.error("Get organization virtual keys error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get organization virtual keys",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

organizations.get(
  "/:org_id/usage",
  zValidator("param", OrgIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const orgId = c.req.param("org_id");

    try {
      const organizationConfig = (await GATEWAY_KV.get(
        `org:${orgId}:config`,
        "json",
      )) as OrganizationConfig | null;
      if (!organizationConfig) {
        return c.json(
          { error: { message: "Organization not found", type: "not_found" } },
          404,
        );
      }

      const orgQuotaRecord = await getOrganizationQuotaRecord(
        GATEWAY_KV,
        orgId,
      );

      return c.json({
        organization_id: orgId,
        monthly_budget_usd: organizationConfig.monthly_budget_usd,
        current_month: orgQuotaRecord.current_month,
        month_usage_usd: orgQuotaRecord.month_usage_usd,
        remaining_budget_usd:
          organizationConfig.monthly_budget_usd -
          orgQuotaRecord.month_usage_usd,
        request_count: orgQuotaRecord.request_count,
        last_update: new Date(orgQuotaRecord.last_update).toISOString(),
      });
    } catch (error) {
      console.error("Get organization usage error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get organization usage",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

export default organizations;
