import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import { getUserQuotaRecord } from "../../lib/quota";
import type {
  OrganizationConfig,
  UserConfig,
  VirtualKeyConfig,
} from "../../types";

const users = new Hono<{ Bindings: CloudflareBindings }>();

// Schemas
const CreateUserSchema = z.object({
  user: z.string().min(1),
  org_id: z.string().min(1),
  monthly_limit_usd: z.number().positive().optional(),
});

const UpdateUserSchema = z.object({
  monthly_limit_usd: z.number().positive().optional(),
});

const UserParamSchema = z.object({
  user: z.string().min(1),
});

// User Management APIs
users.post("/", zValidator("json", CreateUserSchema), async (c) => {
  const { GATEWAY_KV } = c.env;

  try {
    const { user, org_id, monthly_limit_usd = 50 } = c.req.valid("json");

    // Validate organization exists
    const organizationConfig = (await GATEWAY_KV.get(
      `org:${org_id}:config`,
      "json",
    )) as OrganizationConfig | null;
    if (!organizationConfig) {
      return c.json(
        { error: { message: "Organization not found", type: "not_found" } },
        404,
      );
    }

    // Check if user already exists
    const existingUserConfig = (await GATEWAY_KV.get(
      `user:${user}:config`,
      "json",
    )) as UserConfig | null;
    if (existingUserConfig) {
      return c.json(
        {
          error: { message: "User already exists", type: "already_exists" },
        },
        409,
      );
    }

    const userConfig: UserConfig = {
      user,
      org_id,
      monthly_limit_usd,
      created_at: new Date().toISOString(),
    };

    // Store in KV
    await GATEWAY_KV.put(`user:${user}:config`, JSON.stringify(userConfig));

    return c.json(
      {
        message: "User created successfully",
        user: userConfig,
      },
      201,
    );
  } catch (error) {
    console.error("Create user error:", error);
    return c.json(
      {
        error: {
          message: "Failed to create user",
          type: "server_error",
        },
      },
      500,
    );
  }
});

users.get("/:user", zValidator("param", UserParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const user = c.req.param("user");

  try {
    const userConfig = (await GATEWAY_KV.get(
      `user:${user}:config`,
      "json",
    )) as UserConfig | null;
    if (!userConfig) {
      return c.json(
        { error: { message: "User not found", type: "not_found" } },
        404,
      );
    }

    return c.json({ user: userConfig });
  } catch (error) {
    console.error("Get user error:", error);
    return c.json(
      {
        error: { message: "Failed to get user", type: "server_error" },
      },
      500,
    );
  }
});

users.patch(
  "/:user",
  zValidator("param", UserParamSchema),
  zValidator("json", UpdateUserSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const user = c.req.param("user");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${user}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const { monthly_limit_usd } = c.req.valid("json");

      if (monthly_limit_usd !== undefined) {
        userConfig.monthly_limit_usd = monthly_limit_usd;
      }

      await GATEWAY_KV.put(`user:${user}:config`, JSON.stringify(userConfig));

      return c.json({
        message: "User updated successfully",
        user: userConfig,
      });
    } catch (error) {
      console.error("Update user error:", error);
      return c.json(
        {
          error: {
            message: "Failed to update user",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

users.delete("/:user", zValidator("param", UserParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const user = c.req.param("user");

  try {
    const userConfig = (await GATEWAY_KV.get(
      `user:${user}:config`,
      "json",
    )) as UserConfig | null;
    if (!userConfig) {
      return c.json(
        { error: { message: "User not found", type: "not_found" } },
        404,
      );
    }

    // Delete user config and quota
    await GATEWAY_KV.delete(`user:${user}:config`);
    await GATEWAY_KV.delete(`user:${user}:quota`);

    return c.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    return c.json(
      {
        error: {
          message: "Failed to delete user",
          type: "server_error",
        },
      },
      500,
    );
  }
});

// User Usage API
users.get(
  "/:user/usage",
  zValidator("param", UserParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const user = c.req.param("user");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${user}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const quotaRecord = await getUserQuotaRecord(GATEWAY_KV, user);
      const remainingUsd =
        userConfig.monthly_limit_usd - quotaRecord.month_usage_usd;

      return c.json({
        user: user,
        org_id: userConfig.org_id,
        usage: {
          current_month: quotaRecord.current_month,
          usage_usd: quotaRecord.month_usage_usd,
          limit_usd: userConfig.monthly_limit_usd,
          remaining_usd: remainingUsd,
          request_count: quotaRecord.request_count,
          last_update: new Date(quotaRecord.last_update).toISOString(),
        },
      });
    } catch (error) {
      console.error("Get user usage error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get user usage",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

// List user's virtual keys
users.get(
  "/:user/vkeys",
  zValidator("param", UserParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const user = c.req.param("user");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${user}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
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
          if (vkeyConfig && vkeyConfig.user === user) {
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
        user: user,
        org_id: userConfig.org_id,
        virtual_keys: vkeyConfigs,
      });
    } catch (error) {
      console.error("Get user virtual keys error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get user virtual keys",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

export default users;
