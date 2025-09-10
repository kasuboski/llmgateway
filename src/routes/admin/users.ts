import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import { generateApiKey, hashApiKey } from "../../lib/crypto";
import { getCurrentMonth, getQuotaRecord } from "../../lib/quota";
import type {
  ApiKeyRecord,
  OrganizationConfig,
  QuotaRecord,
  UserConfig,
} from "../../types";

const users = new Hono<{ Bindings: CloudflareBindings }>();

// Schemas
const CreateUserSchema = z.object({
  email: z.string().email(),
  org_id: z.string().min(1),
  monthly_limit_usd: z.number().positive().optional(),
});

const UpdateUserSchema = z.object({
  email: z.string().email().optional(),
  monthly_limit_usd: z.number().positive().optional(),
  status: z.enum(["active", "suspended"]).optional(),
});

// Param Schemas
const UserIdParamSchema = z.object({
  user_id: z.string().min(1),
});

const UserKeyParamSchema = z.object({
  user_id: z.string().min(1),
  key_id: z.string().min(1),
});

// User Management APIs
users.post("/", zValidator("json", CreateUserSchema), async (c) => {
  const { GATEWAY_KV } = c.env;

  try {
    const { email, org_id, monthly_limit_usd = 10 } = c.req.valid("json");

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

    const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    const user: UserConfig = {
      user_id: userId,
      org_id: org_id,
      email: email,
      monthly_limit_usd: monthly_limit_usd,
      status: "active",
      created_at: new Date().toISOString(),
    };

    const apiKeyRecord: ApiKeyRecord = {
      user_id: userId,
      key_id: keyId,
      status: "active",
      created_at: new Date().toISOString(),
    };

    await GATEWAY_KV.put(`user:${userId}:config`, JSON.stringify(user));
    await GATEWAY_KV.put(`apikey:${keyHash}`, JSON.stringify(apiKeyRecord));
    await GATEWAY_KV.put(`user:${userId}:apikey:${keyId}`, keyHash);
    await GATEWAY_KV.put(`apikey:${keyId}`, keyHash);

    return c.json({
      user: user,
      api_key: apiKey,
      message:
        "User created successfully. Save the API key - it will not be shown again.",
    });
  } catch (error) {
    console.error("Create user error:", error);
    return c.json(
      { error: { message: "Failed to create user", type: "server_error" } },
      500,
    );
  }
});

users.get("/:user_id", zValidator("param", UserIdParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param("user_id");

  try {
    const userConfig = (await GATEWAY_KV.get(
      `user:${userId}:config`,
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
      { error: { message: "Failed to get user", type: "server_error" } },
      500,
    );
  }
});

users.patch(
  "/:user_id",
  zValidator("param", UserIdParamSchema),
  zValidator("json", UpdateUserSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;

      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const { email, monthly_limit_usd, status } = c.req.valid("json");

      if (email !== undefined) userConfig.email = email;
      if (monthly_limit_usd !== undefined)
        userConfig.monthly_limit_usd = monthly_limit_usd;
      if (status !== undefined) userConfig.status = status;

      await GATEWAY_KV.put(`user:${userId}:config`, JSON.stringify(userConfig));

      return c.json({ user: userConfig, message: "User updated successfully" });
    } catch (error) {
      console.error("Update user error:", error);
      return c.json(
        { error: { message: "Failed to update user", type: "server_error" } },
        500,
      );
    }
  },
);

users.delete("/:user_id", zValidator("param", UserIdParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const userId = c.req.param("user_id");

  try {
    const userConfig = (await GATEWAY_KV.get(
      `user:${userId}:config`,
      "json",
    )) as UserConfig | null;

    if (!userConfig) {
      return c.json(
        { error: { message: "User not found", type: "not_found" } },
        404,
      );
    }

    await GATEWAY_KV.delete(`user:${userId}:config`);
    await GATEWAY_KV.delete(`user:${userId}:quota`);

    return c.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete user error:", error);
    return c.json(
      { error: { message: "Failed to delete user", type: "server_error" } },
      500,
    );
  }
});

// API Key Management
users.post(
  "/:user_id/api-keys",
  zValidator("param", UserIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);

      const apiKeyRecord: ApiKeyRecord = {
        user_id: userId,
        key_id: keyId,
        status: "active",
        created_at: new Date().toISOString(),
      };

      await GATEWAY_KV.put(`apikey:${keyHash}`, JSON.stringify(apiKeyRecord));
      await GATEWAY_KV.put(`user:${userId}:apikey:${keyId}`, keyHash);
      await GATEWAY_KV.put(`apikey:${keyId}`, keyHash);

      return c.json({
        api_key: apiKey,
        key_id: keyId,
        message:
          "API key created successfully. Save the key - it will not be shown again.",
      });
    } catch (error) {
      console.error("Create API key error:", error);
      return c.json(
        {
          error: { message: "Failed to create API key", type: "server_error" },
        },
        500,
      );
    }
  },
);

users.get(
  "/:user_id/api-keys",
  zValidator("param", UserIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      // Get all API keys for this user using the index
      const apiKeys = [];
      let cursor: string | undefined;

      do {
        const result = await GATEWAY_KV.list({
          prefix: `user:${userId}:apikey:`,
          cursor,
        });

        for (const key of result.keys) {
          const keyHash = await GATEWAY_KV.get(key.name);
          if (keyHash) {
            const apiKeyRecord = (await GATEWAY_KV.get(
              `apikey:${keyHash}`,
              "json",
            )) as ApiKeyRecord | null;
            if (apiKeyRecord) {
              apiKeys.push({
                key_id: apiKeyRecord.key_id,
                status: apiKeyRecord.status,
                created_at: apiKeyRecord.created_at,
              });
            }
          }
        }

        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor);

      return c.json({
        user_id: userId,
        api_keys: apiKeys.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      });
    } catch (error) {
      console.error("Get API keys error:", error);
      return c.json(
        { error: { message: "Failed to get API keys", type: "server_error" } },
        500,
      );
    }
  },
);

users.delete(
  "/:user_id/api-keys/:key_id",
  zValidator("param", UserKeyParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");
    const keyId = c.req.param("key_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      // Find the API key using the index
      const keyHash = await GATEWAY_KV.get(`user:${userId}:apikey:${keyId}`);
      let foundApiKey = false;

      if (keyHash) {
        const apiKeyRecord = (await GATEWAY_KV.get(
          `apikey:${keyHash}`,
          "json",
        )) as ApiKeyRecord | null;
        if (
          apiKeyRecord &&
          apiKeyRecord.user_id === userId &&
          apiKeyRecord.key_id === keyId
        ) {
          // Found the API key, update its status to revoked
          apiKeyRecord.status = "revoked";
          await GATEWAY_KV.put(
            `apikey:${keyHash}`,
            JSON.stringify(apiKeyRecord),
          );
          foundApiKey = true;
        }
      }

      if (!foundApiKey) {
        return c.json(
          { error: { message: "API key not found", type: "not_found" } },
          404,
        );
      }

      return c.json({
        message: "API key revoked successfully",
        key_id: keyId,
        user_id: userId,
      });
    } catch (error) {
      console.error("Revoke API key error:", error);
      return c.json(
        {
          error: { message: "Failed to revoke API key", type: "server_error" },
        },
        500,
      );
    }
  },
);

// Usage APIs
users.get(
  "/:user_id/usage",
  zValidator("param", UserIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const quotaRecord = await getQuotaRecord(GATEWAY_KV, userId);
      const remainingUsd =
        userConfig.monthly_limit_usd - quotaRecord.month_usage_usd;

      return c.json({
        user_id: userId,
        email: userConfig.email,
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
          error: { message: "Failed to get user usage", type: "server_error" },
        },
        500,
      );
    }
  },
);

users.post(
  "/:user_id/reset-quota",
  zValidator("param", UserIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const userId = c.req.param("user_id");

    try {
      const userConfig = (await GATEWAY_KV.get(
        `user:${userId}:config`,
        "json",
      )) as UserConfig | null;
      if (!userConfig) {
        return c.json(
          { error: { message: "User not found", type: "not_found" } },
          404,
        );
      }

      const currentMonth = getCurrentMonth();
      const resetQuotaRecord: QuotaRecord = {
        month_usage_usd: 0,
        current_month: currentMonth,
        request_count: 0,
        last_update: Date.now(),
      };

      await GATEWAY_KV.put(
        `user:${userId}:quota`,
        JSON.stringify(resetQuotaRecord),
      );

      return c.json({
        message: "User quota reset successfully",
        user_id: userId,
        quota: resetQuotaRecord,
      });
    } catch (error) {
      console.error("Reset quota error:", error);
      return c.json(
        { error: { message: "Failed to reset quota", type: "server_error" } },
        500,
      );
    }
  },
);

export default users;
