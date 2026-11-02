import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type Client,
  type Guild,
  type MessageCreateOptions,
  type StringSelectMenuInteraction,
} from "discord.js";
import path from "node:path";
import { logger } from "../lib/logger";
import {
  BOOST_PRODUCTS,
  GIFT_EMOJI_TEXT,
  getStaticProducts,
  NITRO_EMOJI_TEXT,
  robloxProduct,
  SHOP_CATEGORIES,
  type ShopCategory,
} from "./catalog";
import {
  ensureGuildSettings,
  listRobloxAccounts,
} from "./store";

const bannerPath = path.resolve(
  process.cwd(),
  "assets",
  "shop-banner.jpg",
);
const shopColor = 0x17151d;
type ShopPanelPayload = Omit<MessageCreateOptions, "flags">;

async function getStaffStatus(guild: Guild): Promise<boolean> {
  try {
    const staff = await guild.members.fetch({
      user: "1483135478923399258",
      force: true,
    });
    return Boolean(staff.presence && staff.presence.status !== "offline");
  } catch {
    return false;
  }
}

export async function buildShopPayload(
  guild: Guild,
): Promise<ShopPanelPayload> {
  const settings = await ensureGuildSettings(guild.id);
  const staffOnline = await getStaffStatus(guild);
  const staffLine = staffOnline
    ? "<a:on:1548061023183835337> Staff online"
    : "<a:off:1548061024731529299> Staff offline";

  const embed = new EmbedBuilder()
    .setColor(shopColor)
    .setAuthor({ name: "STOCKW SHOP" })
    .setDescription("Cheap and reliable service.\nSelect a category below to start your order!")
    .addFields(
      { name: "Vouches", value: `**${settings.vouch_count.toLocaleString()}**`, inline: true },
      { name: "Members", value: `**${guild.memberCount.toLocaleString()}**`, inline: true },
      { name: "Staff", value: staffLine, inline: true },
    )
    .setImage("attachment://shop-banner.jpg")
    .setFooter({ text: "Select a category to view available items." });

  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId("shop:category")
    .setPlaceholder("Select a category")
    .addOptions(
      SHOP_CATEGORIES.map((category) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(category.label)
          .setValue(category.value)
          .setEmoji(category.emoji),
      ),
    );
  const refresh = new ButtonBuilder()
    .setCustomId("shop:refresh")
    .setLabel("Refresh")
    .setEmoji("🔄")
    .setStyle(ButtonStyle.Secondary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(categoryMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(refresh),
    ],
    files: [new AttachmentBuilder(bannerPath, { name: "shop-banner.jpg" })],
  };
}

export async function refreshShopPanel(
  client: Client,
  guildId: string,
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const settings = await ensureGuildSettings(guildId);
  if (!settings.shop_channel_id || !settings.shop_message_id) return;
  try {
    const channel = await guild.channels.fetch(settings.shop_channel_id);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }
    const message = await channel.messages.fetch(settings.shop_message_id);
    await message.edit(await buildShopPayload(guild));
  } catch (error) {
    logger.warn({ error, guildId }, "Could not refresh Discord shop panel");
  }
}

export async function buildCategoryPayload(
  guild: Guild,
  category: ShopCategory,
): Promise<{
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
}> {
  let products;
  let title = "";
  let description = "";

  if (category === "roblox") {
    const accounts = await listRobloxAccounts(guild.id);
    products = accounts.map(robloxProduct).slice(0, 25);
    title = "Roblox Accounts";
    description = products.length
      ? products.map((product) => `**${product.label}** — ${product.description}\n${product.details.split("\n").slice(2).join(" ")}`).join("\n\n").slice(0, 4000)
      : "No Roblox accounts are listed yet.";
  } else {
    products = getStaticProducts(category);
    title =
      category === "boost"
        ? "Server Boost"
        : category === "nitro"
          ? "Nitro"
          : "Profile Decos";
    description =
      category === "boost"
        ? `${BOOST_PRODUCTS.slice(0, 4).map((product) => `**${product.label}** — ${product.description.split(" — ").at(-1)}`).join("\n")}\n\nCustom quantity is also available.`
        : category === "nitro"
          ? products
              .map(
                (product) =>
                  `${NITRO_EMOJI_TEXT} **${product.label}** — ${product.description}`,
              )
              .join("\n")
          : category === "decos"
          ? `-# frames/deco/nameplates/effects/bundles\n\n${products
              .map((product) => `${GIFT_EMOJI_TEXT} ${product.label}`)
              .join("\n")}`
          : products
            .map((product) => `**${product.label}**\n${product.description}`)
            .join("\n");
  }

  const embed = new EmbedBuilder()
    .setColor(shopColor)
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: "STOCKW SHOP • Choose an item to open a private order ticket.",
    });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop:item:${category}`)
    .setPlaceholder(
      products.length ? "Select an item" : "No accounts listed",
    )
    .setDisabled(products.length === 0)
    .addOptions(
      products.length
        ? products.map((product) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(product.label)
              .setDescription(product.description.slice(0, 100))
              .setValue(product.value)
              .setEmoji(product.emoji ?? { name: "🛍️" }),
          )
        : [
            new StringSelectMenuOptionBuilder()
              .setLabel("No accounts available")
              .setValue("none"),
          ],
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
  };
}

export async function updateShopSetup(
  guild: Guild,
  channelId: string,
  previousChannelId: string | null,
  previousMessageId: string | null,
): Promise<{ channelId: string; messageId: string }> {
  const channel = await guild.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error("Run /shopsetup in a text channel.");
  }

  if (previousChannelId && previousMessageId === null) {
    logger.debug({ guildId: guild.id }, "Shop panel has no saved message");
  }

  if (previousChannelId === channelId && previousMessageId) {
    try {
      const oldMessage = await channel.messages.fetch(previousMessageId);
      await oldMessage.edit(await buildShopPayload(guild));
      return { channelId, messageId: oldMessage.id };
    } catch (error) {
      logger.info({ error, guildId: guild.id }, "Posting replacement shop panel");
    }
  }

  const message = await channel.send(await buildShopPayload(guild));
  return { channelId, messageId: message.id };
}

export async function buildCategoryResponse(
  interaction: StringSelectMenuInteraction,
  category: ShopCategory,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This shop can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({
    ...(await buildCategoryPayload(interaction.guild, category)),
    flags: MessageFlags.Ephemeral,
  });
}
