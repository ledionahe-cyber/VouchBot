import { pool } from "@workspace/db";

export type GuildSettings = {
  guild_id: string;
  vouch_count: number;
  shop_channel_id: string | null;
  shop_message_id: string | null;
  vouch_channel_id: string | null;
  ticket_category_id: string | null;
  ticket_log_channel_id: string | null;
};

export type RobloxAccount = {
  id: number;
  guild_id: string;
  username: string;
  price: string;
  description: string;
};

export type TicketRecord = {
  channel_id: string;
  guild_id: string;
  opener_user_id: string;
  product: string;
  status: "open" | "closed" | "deleted";
};

export async function ensureGuildSettings(
  guildId: string,
): Promise<GuildSettings> {
  await pool.query(
    `INSERT INTO discord_guild_settings (guild_id)
     VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId],
  );
  const result = await pool.query<GuildSettings>(
    `SELECT guild_id, vouch_count, shop_channel_id, shop_message_id,
            vouch_channel_id, ticket_category_id, ticket_log_channel_id
     FROM discord_guild_settings
     WHERE guild_id = $1`,
    [guildId],
  );
  const settings = result.rows[0];
  if (!settings) throw new Error("Could not load server settings");
  return settings;
}

export async function setGuildField(
  guildId: string,
  field:
    | "shop_channel_id"
    | "shop_message_id"
    | "vouch_channel_id"
    | "ticket_category_id"
    | "ticket_log_channel_id",
  value: string | null,
): Promise<void> {
  const allowedFields = new Set([
    "shop_channel_id",
    "shop_message_id",
    "vouch_channel_id",
    "ticket_category_id",
    "ticket_log_channel_id",
  ]);
  if (!allowedFields.has(field)) throw new Error("Invalid server setting");
  await ensureGuildSettings(guildId);
  await pool.query(
    `UPDATE discord_guild_settings
     SET ${field} = $1, updated_at = NOW()
     WHERE guild_id = $2`,
    [value, guildId],
  );
}

export async function seedStaffWhitelist(
  guildId: string,
  staffUserId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_whitelist (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, staffUserId],
  );
}

export async function getWhitelist(guildId: string): Promise<string[]> {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM discord_whitelist WHERE guild_id = $1`,
    [guildId],
  );
  return result.rows.map((row) => row.user_id);
}

export async function isWhitelisted(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM discord_whitelist
     WHERE guild_id = $1 AND user_id = $2
     LIMIT 1`,
    [guildId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addToWhitelist(
  guildId: string,
  userId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_whitelist (guild_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (guild_id, user_id) DO NOTHING`,
    [guildId, userId],
  );
}

export async function removeFromWhitelist(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM discord_whitelist WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function saveRobloxAccount(
  guildId: string,
  username: string,
  price: string,
  description: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO roblox_accounts (guild_id, username, price, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, username)
     DO UPDATE SET price = EXCLUDED.price, description = EXCLUDED.description`,
    [guildId, username, price, description],
  );
}

export async function removeRobloxAccount(
  guildId: string,
  username: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM roblox_accounts
     WHERE guild_id = $1 AND LOWER(username) = LOWER($2)`,
    [guildId, username],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listRobloxAccounts(
  guildId: string,
): Promise<RobloxAccount[]> {
  const result = await pool.query<RobloxAccount>(
    `SELECT id, guild_id, username, price, description
     FROM roblox_accounts
     WHERE guild_id = $1
     ORDER BY username ASC`,
    [guildId],
  );
  return result.rows;
}

export async function getRobloxAccount(
  guildId: string,
  id: number,
): Promise<RobloxAccount | undefined> {
  const result = await pool.query<RobloxAccount>(
    `SELECT id, guild_id, username, price, description
     FROM roblox_accounts
     WHERE guild_id = $1 AND id = $2`,
    [guildId, id],
  );
  return result.rows[0];
}

export async function createVouch(input: {
  guildId: string;
  targetUserId: string;
  authorUserId: string;
  body: string;
}): Promise<number> {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `INSERT INTO discord_guild_settings (guild_id)
       VALUES ($1)
       ON CONFLICT (guild_id) DO NOTHING`,
      [input.guildId],
    );
    const result = await connection.query<{ vouch_count: number }>(
      `UPDATE discord_guild_settings
       SET vouch_count = vouch_count + 1, updated_at = NOW()
       WHERE guild_id = $1
       RETURNING vouch_count`,
      [input.guildId],
    );
    const number = result.rows[0]?.vouch_count;
    if (number === undefined) throw new Error("Could not allocate vouch number");
    await connection.query(
      `INSERT INTO discord_vouches
         (guild_id, vouch_number, target_user_id, author_user_id, body)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.guildId,
        number,
        input.targetUserId,
        input.authorUserId,
        input.body,
      ],
    );
    await connection.query("COMMIT");
    return number;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

export async function findOpenTicketForUser(
  guildId: string,
  userId: string,
): Promise<TicketRecord | undefined> {
  const result = await pool.query<TicketRecord>(
    `SELECT channel_id, guild_id, opener_user_id, product, status
     FROM discord_tickets
     WHERE guild_id = $1 AND opener_user_id = $2 AND status = 'open'
     LIMIT 1`,
    [guildId, userId],
  );
  return result.rows[0];
}

export async function saveTicket(
  channelId: string,
  guildId: string,
  openerUserId: string,
  product: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO discord_tickets
       (channel_id, guild_id, opener_user_id, product)
     VALUES ($1, $2, $3, $4)`,
    [channelId, guildId, openerUserId, product],
  );
}

export async function getTicket(
  channelId: string,
): Promise<TicketRecord | undefined> {
  const result = await pool.query<TicketRecord>(
    `SELECT channel_id, guild_id, opener_user_id, product, status
     FROM discord_tickets WHERE channel_id = $1 LIMIT 1`,
    [channelId],
  );
  return result.rows[0];
}

export async function closeTicket(channelId: string): Promise<void> {
  await pool.query(
    `UPDATE discord_tickets
     SET status = 'closed', closed_at = NOW()
     WHERE channel_id = $1 AND status = 'open'`,
    [channelId],
  );
}

export async function markTicketDeleted(channelId: string): Promise<void> {
  await pool.query(
    `UPDATE discord_tickets
     SET status = 'deleted', closed_at = NOW()
     WHERE channel_id = $1`,
    [channelId],
  );
}
