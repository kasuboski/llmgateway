import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import * as z from "zod";
import { generateApiKey, hashApiKey } from "../../lib/crypto";
import { getCurrentMonth, getQuotaRecord } from "../../lib/quota";
import type {
  OrganizationConfig,
  QuotaRecord,
  VirtualKeyConfig,
} from "../../types";

const vkeys = new Hono<{ Bindings: CloudflareBindings }>();

// Schemas
const CreateVirtualKeySchema = z.object({
  org_id: z.string().min(1),
  user: z.string().optional(), // Optional user identifier for grouping
  name: z.string().optional(), // Optional friendly name
  monthly_limit_usd: z.number().positive().optional(),
});

const UpdateVirtualKeySchema = z.object({
  name: z.string().optional(),
  monthly_limit_usd: z.number().positive().optional(),
  status: z.enum(["active", "revoked"]).optional(),
  user: z.string().optional(),
});

// Param Schemas
const KeyIdParamSchema = z.object({
  key_id: z.string().min(1),
});

// Virtual Key Management APIs
vkeys.post("/", zValidator("json", CreateVirtualKeySchema), async (c) => {
  const { GATEWAY_KV } = c.env;

  try {
    const { org_id, user, name, monthly_limit_usd = 10 } = c.req.valid("json");

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

    // Generate virtual key
    const keyId = `vkey_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);

    const vkeyConfig: VirtualKeyConfig = {
      key_id: keyId,
      key_hash: keyHash,
      org_id: org_id,
      user: user,
      name: name,
      monthly_limit_usd: monthly_limit_usd,
      status: "active",
      created_at: new Date().toISOString(),
    };

    // Store in KV
    await GATEWAY_KV.put(`vkey:${keyHash}:config`, JSON.stringify(vkeyConfig));
    await GATEWAY_KV.put(`vkey:id:${keyId}`, keyHash); // Index for key_id lookups

    return c.json({
      virtual_key: {
        key_id: vkeyConfig.key_id,
        org_id: vkeyConfig.org_id,
        user: vkeyConfig.user,
        name: vkeyConfig.name,
        monthly_limit_usd: vkeyConfig.monthly_limit_usd,
        status: vkeyConfig.status,
        created_at: vkeyConfig.created_at,
      },
      api_key: apiKey,
      message:
        "Virtual key created successfully. Save the API key - it will not be shown again.",
    });
  } catch (error) {
    console.error("Create virtual key error:", error);
    return c.json(
      {
        error: {
          message: "Failed to create virtual key",
          type: "server_error",
        },
      },
      500,
    );
  }
});

vkeys.get("/:key_id", zValidator("param", KeyIdParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const keyId = c.req.param("key_id");

  try {
    // Lookup key hash by key_id
    const keyHash = await GATEWAY_KV.get(`vkey:id:${keyId}`);
    if (!keyHash) {
      return c.json(
        { error: { message: "Virtual key not found", type: "not_found" } },
        404,
      );
    }

    const vkeyConfig = (await GATEWAY_KV.get(
      `vkey:${keyHash}:config`,
      "json",
    )) as VirtualKeyConfig | null;

    if (!vkeyConfig) {
      return c.json(
        { error: { message: "Virtual key not found", type: "not_found" } },
        404,
      );
    }

    // Return config without key_hash (sensitive)
    return c.json({
      virtual_key: {
        key_id: vkeyConfig.key_id,
        org_id: vkeyConfig.org_id,
        user: vkeyConfig.user,
        name: vkeyConfig.name,
        monthly_limit_usd: vkeyConfig.monthly_limit_usd,
        status: vkeyConfig.status,
        created_at: vkeyConfig.created_at,
      },
    });
  } catch (error) {
    console.error("Get virtual key error:", error);
    return c.json(
      {
        error: { message: "Failed to get virtual key", type: "server_error" },
      },
      500,
    );
  }
});

vkeys.patch(
  "/:key_id",
  zValidator("param", KeyIdParamSchema),
  zValidator("json", UpdateVirtualKeySchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const keyId = c.req.param("key_id");

    try {
      // Lookup key hash by key_id
      const keyHash = await GATEWAY_KV.get(`vkey:id:${keyId}`);
      if (!keyHash) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
          404,
        );
      }

      const vkeyConfig = (await GATEWAY_KV.get(
        `vkey:${keyHash}:config`,
        "json",
      )) as VirtualKeyConfig | null;

      if (!vkeyConfig) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
          404,
        );
      }

      const { name, monthly_limit_usd, status, user } = c.req.valid("json");

      if (name !== undefined) vkeyConfig.name = name;
      if (monthly_limit_usd !== undefined)
        vkeyConfig.monthly_limit_usd = monthly_limit_usd;
      if (status !== undefined) vkeyConfig.status = status;
      if (user !== undefined) vkeyConfig.user = user;

      await GATEWAY_KV.put(
        `vkey:${keyHash}:config`,
        JSON.stringify(vkeyConfig),
      );

      return c.json({
        virtual_key: {
          key_id: vkeyConfig.key_id,
          org_id: vkeyConfig.org_id,
          user: vkeyConfig.user,
          name: vkeyConfig.name,
          monthly_limit_usd: vkeyConfig.monthly_limit_usd,
          status: vkeyConfig.status,
          created_at: vkeyConfig.created_at,
        },
        message: "Virtual key updated successfully",
      });
    } catch (error) {
      console.error("Update virtual key error:", error);
      return c.json(
        {
          error: {
            message: "Failed to update virtual key",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

vkeys.delete("/:key_id", zValidator("param", KeyIdParamSchema), async (c) => {
  const { GATEWAY_KV } = c.env;
  const keyId = c.req.param("key_id");

  try {
    // Lookup key hash by key_id
    const keyHash = await GATEWAY_KV.get(`vkey:id:${keyId}`);
    if (!keyHash) {
      return c.json(
        { error: { message: "Virtual key not found", type: "not_found" } },
        404,
      );
    }

    const vkeyConfig = (await GATEWAY_KV.get(
      `vkey:${keyHash}:config`,
      "json",
    )) as VirtualKeyConfig | null;

    if (!vkeyConfig) {
      return c.json(
        { error: { message: "Virtual key not found", type: "not_found" } },
        404,
      );
    }

    // Delete both config and quota
    await GATEWAY_KV.delete(`vkey:${keyHash}:config`);
    await GATEWAY_KV.delete(`vkey:${keyHash}:quota`);
    await GATEWAY_KV.delete(`vkey:id:${keyId}`);

    return c.json({ message: "Virtual key deleted successfully" });
  } catch (error) {
    console.error("Delete virtual key error:", error);
    return c.json(
      {
        error: {
          message: "Failed to delete virtual key",
          type: "server_error",
        },
      },
      500,
    );
  }
});

// Usage APIs
vkeys.get(
  "/:key_id/usage",
  zValidator("param", KeyIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const keyId = c.req.param("key_id");

    try {
      // Lookup key hash by key_id
      const keyHash = await GATEWAY_KV.get(`vkey:id:${keyId}`);
      if (!keyHash) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
          404,
        );
      }

      const vkeyConfig = (await GATEWAY_KV.get(
        `vkey:${keyHash}:config`,
        "json",
      )) as VirtualKeyConfig | null;

      if (!vkeyConfig) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
          404,
        );
      }

      const quotaRecord = await getQuotaRecord(GATEWAY_KV, keyHash);
      const remainingUsd =
        vkeyConfig.monthly_limit_usd - quotaRecord.month_usage_usd;

      return c.json({
        key_id: keyId,
        name: vkeyConfig.name,
        user: vkeyConfig.user,
        usage: {
          current_month: quotaRecord.current_month,
          usage_usd: quotaRecord.month_usage_usd,
          limit_usd: vkeyConfig.monthly_limit_usd,
          remaining_usd: remainingUsd,
          request_count: quotaRecord.request_count,
          last_update: new Date(quotaRecord.last_update).toISOString(),
        },
      });
    } catch (error) {
      console.error("Get virtual key usage error:", error);
      return c.json(
        {
          error: {
            message: "Failed to get virtual key usage",
            type: "server_error",
          },
        },
        500,
      );
    }
  },
);

vkeys.post(
  "/:key_id/reset-quota",
  zValidator("param", KeyIdParamSchema),
  async (c) => {
    const { GATEWAY_KV } = c.env;
    const keyId = c.req.param("key_id");

    try {
      // Lookup key hash by key_id
      const keyHash = await GATEWAY_KV.get(`vkey:id:${keyId}`);
      if (!keyHash) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
          404,
        );
      }

      const vkeyConfig = (await GATEWAY_KV.get(
        `vkey:${keyHash}:config`,
        "json",
      )) as VirtualKeyConfig | null;

      if (!vkeyConfig) {
        return c.json(
          { error: { message: "Virtual key not found", type: "not_found" } },
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
        `vkey:${keyHash}:quota`,
        JSON.stringify(resetQuotaRecord),
      );

      return c.json({
        message: "Virtual key quota reset successfully",
        key_id: keyId,
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

export default vkeys;
