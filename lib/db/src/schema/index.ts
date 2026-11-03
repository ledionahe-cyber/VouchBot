import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const discordGuildSettings = pgTable("discord_guild_settings", {
  guildId: varchar("guild_id", { length: 24 }).primaryKey(),
  vouchCount: integer("vouch_count").notNull().default(62),
  shopChannelId: varchar("shop_channel_id", { length: 24 }),
  shopMessageId: varchar("shop_message_id", { length: 24 }),
  vouchChannelId: varchar("vouch_channel_id", { length: 24 }),
  ticketCategoryId: varchar("ticket_category_id", { length: 24 }),
  ticketLogChannelId: varchar("ticket_log_channel_id", { length: 24 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const discordWhitelist = pgTable(
  "discord_whitelist",
  {
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    userId: varchar("user_id", { length: 24 }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);

export const discordBlacklist = pgTable(
  "discord_blacklist",
  {
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    userId: varchar("user_id", { length: 24 }).notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.guildId, table.userId] }),
    index("discord_blacklist_guild_idx").on(table.guildId),
  ],
);

export const robloxAccounts = pgTable(
  "roblox_accounts",
  {
    id: serial("id").primaryKey(),
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    username: varchar("username", { length: 64 }).notNull(),
    price: varchar("price", { length: 32 }).notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("roblox_accounts_guild_username_unique").on(
      table.guildId,
      table.username,
    ),
    index("roblox_accounts_guild_idx").on(table.guildId),
  ],
);

export const discordVouches = pgTable(
  "discord_vouches",
  {
    id: serial("id").primaryKey(),
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    vouchNumber: integer("vouch_number").notNull(),
    targetUserId: varchar("target_user_id", { length: 24 }).notNull(),
    authorUserId: varchar("author_user_id", { length: 24 }).notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("discord_vouches_guild_number_unique").on(
      table.guildId,
      table.vouchNumber,
    ),
    index("discord_vouches_guild_idx").on(table.guildId),
  ],
);

export const discordTickets = pgTable(
  "discord_tickets",
  {
    channelId: varchar("channel_id", { length: 24 }).primaryKey(),
    guildId: varchar("guild_id", { length: 24 }).notNull(),
    openerUserId: varchar("opener_user_id", { length: 24 }).notNull(),
    product: text("product").notNull(),
    status: varchar("status", { length: 12 }).notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    index("discord_tickets_guild_status_idx").on(table.guildId, table.status),
    index("discord_tickets_opener_idx").on(table.guildId, table.openerUserId),
  ],
);

export const discordBotControl = pgTable("discord_bot_control", {
  id: integer("id").primaryKey().default(1),
  isShutdown: boolean("is_shutdown").notNull().default(false),
  updatedBy: varchar("updated_by", { length: 24 }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});