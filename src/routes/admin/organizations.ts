import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import * as z from "zod";
import type {
  OrganizationConfig,
  UserConfig,
  VirtualKeyConfig,
} from "../../types";
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
organizations.get(
  "/",
  describeRoute({
    description: "List all organizations",
    tags: ["Organizations"],
    responses: { 200: { description: "List of organizations" } },
  }),
  async (c) => {
  const { GATEWAY_KV } = c.env;

  try {
    // List all organizations
    const { keys } = await GATEWAY_KV.list({ prefix: "org:" });
    const orgConfigs = [];

    for (const key of keys) {
      if (key.name.endsWith(":config")) {
        const orgConfig = (await GATEWAY_KV.get(
          key.name,
          "json",
        )) as OrganizationConfig | null;
        if (orgConfig) {
          // Return config without sensitive provider keys
          orgConfigs.push({
            org_id: orgConfig.org_id,
            name: orgConfig.name,
            monthly_budget_usd: orgConfig.monthly_budget_usd,
            failure_mode: orgConfig.failure_mode,
            created_at: orgConfig.created_at,
          });
        }
      }
    }

    return c.json({
      organizations: orgConfigs,
      count: orgConfigs.length,
    });
  } catch (error) {
    console.error("List organizations error:", error);
    return c.json(
      {
        error: {
          message: "Failed to list organizations",
          type: "server_error",
        },
      },
      500,
    );
  }
  },
);

organizations.post(
  "/",
  describeRoute({
    description: "Create a new organization",
    tags: ["Organizations"],
    responses: { 201: { description: "Organization created" } },
  }),
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
  "/:org_id",
  describeRoute({
    description: "Get organization details",
    tags: ["Organizations"],
    responses: { 200: { description: "Organization details" } },
  }),
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
  describeRoute({
    description: "Update organization configuration",
    tags: ["Organizations"],
    responses: { 200: { description: "Organization updated" } },
  }),
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
  describeRoute({
    description: "List organization's virtual keys",
    tags: ["Organizations"],
    responses: { 200: { description: "List of virtual keys" } },
  }),
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
  describeRoute({
    description: "Get organization usage statistics",
    tags: ["Organizations"],
    responses: { 200: { description: "Organization usage statistics" } },
  }),
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

organizations.delete(
  "/:org_id",
  describeRoute({
    description: "Delete an organization and cascade delete all associated resources",
    tags: ["Organizations"],
    responses: { 200: { description: "Organization deleted" } },
  }),
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

      // Cascade delete: Delete all virtual keys in the organization
      const vkeyList = await GATEWAY_KV.list({ prefix: "vkey:" });
      const deletedVkeys = [];

      for (const key of vkeyList.keys) {
        if (key.name.endsWith(":config")) {
          const vkeyConfig = (await GATEWAY_KV.get(
            key.name,
            "json",
          )) as VirtualKeyConfig | null;
          if (vkeyConfig && vkeyConfig.org_id === orgId) {
            // Delete virtual key config, quota, and id index
            await GATEWAY_KV.delete(`vkey:${vkeyConfig.key_hash}:config`);
            await GATEWAY_KV.delete(`vkey:${vkeyConfig.key_hash}:quota`);
            await GATEWAY_KV.delete(`vkey:id:${vkeyConfig.key_id}`);
            deletedVkeys.push(vkeyConfig.key_id);
          }
        }
      }

      // Cascade delete: Delete all users in the organization
      const userList = await GATEWAY_KV.list({ prefix: "user:" });
      const deletedUsers = [];

      for (const key of userList.keys) {
        if (key.name.endsWith(":config")) {
          const userConfig = (await GATEWAY_KV.get(
            key.name,
            "json",
          )) as UserConfig | null;
          if (userConfig && userConfig.org_id === orgId) {
            // Delete user config and quota
            await GATEWAY_KV.delete(`user:${userConfig.user}:config`);
            await GATEWAY_KV.delete(`user:${userConfig.user}:quota`);
            deletedUsers.push(userConfig.user);
          }
        }
      }

      // Delete organization config and quota
      await GATEWAY_KV.delete(`org:${orgId}:config`);
      await GATEWAY_KV.delete(`org:${orgId}:quota`);

      return c.json({
        message: "Organization and all associated resources deleted successfully",
        organization_id: orgId,
        deleted_virtual_keys: deletedVkeys.length,
        deleted_users: deletedUsers.length,
        virtual_keys: deletedVkeys,
        users: deletedUsers,
      });
    } catch (error) {
      console.error("Delete organization error:", error);
      return c.json(
        {
          error: {
            message: "Failed to delete organization",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

export default organizations;
