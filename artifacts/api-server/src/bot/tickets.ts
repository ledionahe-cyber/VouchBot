import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger";
import { productForStaticValue, robloxProduct } from "./catalog";
import {
  closeTicket as markTicketClosed,
  ensureGuildSettings,
  findOpenTicketForUser,
  getRobloxAccount,
  getTicket,
  getWhitelist,
  isWhitelisted,
  saveTicket,
} from "./store";

const USER_TICKET_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

function safeChannelPart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45);
  return result || "order";
}

export async function createOrderTicket(
  client: Client,
  guild: Guild,
  opener: GuildMember,
  product: string,
): Promise<TextChannel> {
  const settings = await ensureGuildSettings(guild.id);
  if (!settings.ticket_category_id) {
    throw new Error("An administrator needs to run /ticketsetup first.");
  }

  const existing = await findOpenTicketForUser(guild.id, opener.id);
  if (existing) {
    throw new Error(
      `You already have an open ticket: <#${existing.channel_id}>`,
    );
  }

  const category = await guild.channels.fetch(settings.ticket_category_id);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error("The configured ticket category is missing. Run /ticketsetup again.");
  }

  const whitelist = await getWhitelist(guild.id);
  const botUserId = client.user?.id;
  if (!botUserId) throw new Error("The bot is not ready yet.");
  const permissionOverwrites = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: opener.id,
      allow: USER_TICKET_PERMISSIONS,
    },
    {
      id: botUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
    ...whitelist
      .filter((userId) => userId !== opener.id && userId !== botUserId)
      .map((userId) => ({
        id: userId,
        allow: USER_TICKET_PERMISSIONS,
      })),
  ];

  const channel = await guild.channels.create({
    name: `ticket-${safeChannelPart(opener.user.username)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites,
    reason: `Shop order from ${opener.user.tag}`,
  });

  if (channel.type !== ChannelType.GuildText) {
    await channel.delete("Could not create a text ticket channel");
    throw new Error("Discord did not create a text ticket channel.");
  }

  try {
    await saveTicket(channel.id, guild.id, opener.id, product);
    const embed = new EmbedBuilder()
      .setColor(0x17151d)
      .setTitle("New order")
      .setDescription(
        `**Customer:** <@${opener.id}>\n**Item:**\n${product}`,
      )
      .setFooter({ text: "A staff member will help you shortly." })
      .setTimestamp();
    await channel.send({
      content: `@everyone <@${opener.id}>`,
      embeds: [embed],
      allowedMentions: {
        parse: ["everyone"],
        users: [opener.id],
      },
    });
  } catch (error) {
    await channel.delete("Ticket setup failed");
    throw error;
  }

  if (settings.ticket_log_channel_id) {
    try {
      const logChannel = await guild.channels.fetch(
        settings.ticket_log_channel_id,
      );
      if (logChannel?.isTextBased() && "send" in logChannel) {
        await logChannel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x17151d)
              .setTitle("Ticket opened")
              .setDescription(
                `**Channel:** <#${channel.id}>\n**Customer:** <@${opener.id}>\n**Item:** ${product.slice(0, 1500)}`,
              )
              .setTimestamp(),
          ],
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      logger.warn({ error, guildId: guild.id }, "Could not post ticket log");
    }
  }

  return channel;
}

export async function handleCustomBoostButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const quantity = new TextInputBuilder()
    .setCustomId("quantity")
    .setLabel("How many boosts?")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("For example: 14")
    .setRequired(true)
    .setMaxLength(3);
  const duration = new TextInputBuilder()
    .setCustomId("duration")
    .setLabel("Duration: 1 month or 3 months")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("1 or 3")
    .setRequired(true)
    .setMaxLength(1);
  const modal = new ModalBuilder()
    .setCustomId("shop:custom-submit")
    .setTitle("Custom server boost")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(quantity),
      new ActionRowBuilder<TextInputBuilder>().addComponents(duration),
    );
  await interaction.showModal(modal);
}

export async function handleCustomBoostSubmit(
  interaction: ModalSubmitInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({
      content: "This order can only be opened inside a server.",
      ephemeral: true,
    });
    return;
  }

  const rawQuantity = interaction.fields.getTextInputValue("quantity").trim();
  const rawDuration = interaction.fields.getTextInputValue("duration").trim();
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    await interaction.reply({
      content: "Enter a boost quantity from 1 to 100.",
      ephemeral: true,
    });
    return;
  }
  if (rawDuration !== "1" && rawDuration !== "3") {
    await interaction.reply({
      content: "Duration must be 1 or 3 months.",
      ephemeral: true,
    });
    return;
  }

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const ticket = await createOrderTicket(
      client,
      interaction.guild,
      member,
      `Custom server boost — ${quantity} boosts for ${rawDuration} month(s). Price to confirm with staff.`,
    );
    await interaction.reply({
      content: `Your order ticket is ready: <#${ticket.id}>`,
      ephemeral: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create your ticket.";
    await interaction.reply({ content: message, ephemeral: true });
  }
}

export async function handleShopItemSelection(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This shop can only be used inside a server.",
      ephemeral: true,
    });
    return;
  }

  const value = interaction.values[0];
  if (!value) {
    await interaction.reply({
      content: "Choose one of the available items.",
      ephemeral: true,
    });
    return;
  }

  if (value === "boost:custom") {
    await interaction.reply({
      content: "Choose your custom boost quantity and duration.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId("shop:custom-modal")
            .setLabel("Enter custom boosts")
            .setStyle(ButtonStyle.Primary),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  let product: string | undefined;
  if (value.startsWith("roblox:")) {
    const accountId = Number(value.slice("roblox:".length));
    if (!Number.isInteger(accountId) || accountId < 1) {
      await interaction.reply({
        content: "That account listing is no longer available.",
        ephemeral: true,
      });
      return;
    }
    const account = await getRobloxAccount(interaction.guild.id, accountId);
    if (!account) {
      await interaction.reply({
        content: "That account listing is no longer available.",
        ephemeral: true,
      });
      return;
    }
    product = robloxProduct(account).details;
  } else {
    product = productForStaticValue(value)?.details;
  }

  if (!product) {
    await interaction.reply({
      content: "That item is no longer available.",
      ephemeral: true,
    });
    return;
  }

  try {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    const ticket = await createOrderTicket(
      client,
      interaction.guild,
      member,
      product,
    );
    await interaction.reply({
      content: `Your order ticket is ready: <#${ticket.id}>`,
      ephemeral: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create your ticket.";
    await interaction.reply({ content: message, ephemeral: true });
  }
}

export async function closeTicketFromMessage(
  channel: TextChannel,
  member: GuildMember,
): Promise<string> {
  const record = await getTicket(channel.id);
  if (!record || record.status !== "open") {
    return "This channel is not an open shop ticket.";
  }
  const canClose =
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.id === record.opener_user_id ||
    (await isWhitelisted(record.guild_id, member.id));
  if (!canClose) {
    return "Only the ticket customer, whitelisted staff, or an administrator can close this ticket.";
  }

  await markTicketClosed(channel.id);
  await channel.permissionOverwrites.edit(record.opener_user_id, {
    ViewChannel: false,
    SendMessages: false,
  });
  const closedName = `closed-${channel.name.replace(/^ticket-/, "")}`.slice(
    0,
    100,
  );
  await channel.setName(closedName);
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x17151d)
        .setTitle("Ticket closed")
        .setDescription("This ticket has been closed and saved for staff.")
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  });

  return "Ticket closed. The channel is saved for whitelisted staff and administrators.";
}

