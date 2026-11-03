import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
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
import { isBotOwner } from "./permissions";
import {
  closeTicket as markTicketClosed,
  ensureGuildSettings,
  findOpenTicketForUser,
  getRobloxAccount,
  getTicket,
  getWhitelist,
  isBlacklisted,
  isWhitelisted,
  listGuildTickets,
  markTicketDeleted,
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
  if (!isBotOwner(opener.id) && (await isBlacklisted(guild.id, opener.id))) {
    throw new Error("You are blacklisted from using the shop.");
  }
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
      .setFooter({
        text: "STOCKW SHOP • A staff member will help you shortly.",
      })
      .setTimestamp();
    await channel.send({
      content: `@everyone <@${opener.id}>`,
      embeds: [embed],
      allowedMentions: {
        parse: ["everyone"],
        users: [opener.id],
      },
    });
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x17151d)
          .setTitle("Pick payment method")
          .setDescription("Choose how you would like to pay.")
          .setFooter({ text: "STOCKW SHOP" }),
      ],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId("ticket:payment-method")
            .setPlaceholder("Pick payment method")
            .addOptions(
              { label: "PayPal", value: "paypal" },
              { label: "LTC", value: "ltc" },
              { label: "Tikkie", value: "tikkie" },
              { label: "SOL", value: "sol" },
              { label: "Crypto", value: "crypto" },
              { label: "BTC", value: "btc" },
            ),
        ),
      ],
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
              .setFooter({ text: "STOCKW SHOP • Ticket log" })
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

export async function grantBotOwnerTicketAccess(
  guild: Guild,
  ownerIds: readonly string[],
): Promise<void> {
  const tickets = await listGuildTickets(guild.id);
  for (const ticket of tickets) {
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    for (const ownerId of ownerIds) {
      try {
        await channel.permissionOverwrites.edit(
          ownerId,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
          },
          { reason: "Grant bot owner access to existing shop tickets" },
        );
      } catch (error) {
        logger.warn(
          { error, guildId: guild.id, channelId: channel.id, ownerId },
          "Could not grant bot owner access to ticket",
        );
      }
    }
  }
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawQuantity = interaction.fields.getTextInputValue("quantity").trim();
  const rawDuration = interaction.fields.getTextInputValue("duration").trim();
  const quantity = Number(rawQuantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    await interaction.reply({
      content: "Enter a boost quantity from 1 to 100.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (rawDuration !== "1" && rawDuration !== "3") {
    await interaction.reply({
      content: "Duration must be 1 or 3 months.",
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create your ticket.";
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleShopItemSelection(
  interaction: StringSelectMenuInteraction,
  client: Client,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: "This shop can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.values[0];
  if (!value) {
    await interaction.reply({
      content: "Choose one of the available items.",
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let product: string | undefined;
  if (value.startsWith("roblox:")) {
    const accountId = Number(value.slice("roblox:".length));
    if (!Number.isInteger(accountId) || accountId < 1) {
      await interaction.editReply({
        content: "That account listing is no longer available.",
      });
      return;
    }
    const account = await getRobloxAccount(interaction.guild.id, accountId);
    if (!account) {
      await interaction.editReply({
        content: "That account listing is no longer available.",
      });
      return;
    }
    product = robloxProduct(account).details;
  } else {
    product = productForStaticValue(value)?.details;
  }

  if (!product) {
    await interaction.editReply({
      content: "That item is no longer available.",
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
    await interaction.editReply({
      content: `Your order ticket is ready: <#${ticket.id}>`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not create your ticket.";
    await interaction.editReply({
      content: message,
    });
  }
}

export async function handlePaymentMethodSelection(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const selected = interaction.values[0];
  const paymentMethods: Record<string, string> = {
    paypal: "PayPal",
    ltc: "LTC",
    tikkie: "Tikkie",
    sol: "SOL",
    crypto: "Crypto",
    btc: "BTC",
  };
  const method = selected ? paymentMethods[selected] : undefined;
  if (!method) {
    await interaction.reply({
      content: "Choose one of the available payment methods.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const record = await getTicket(interaction.channelId);
  if (
    !interaction.guild ||
    !record ||
    record.guild_id !== interaction.guild.id ||
    record.status !== "open"
  ) {
    await interaction.reply({
      content: "This is not an open shop ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (
    !isBotOwner(interaction.user.id) &&
    (await isBlacklisted(record.guild_id, interaction.user.id))
  ) {
    await interaction.reply({
      content: "You are blacklisted from using the shop.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (interaction.user.id !== record.opener_user_id) {
    await interaction.reply({
      content: "Only the customer who opened this ticket can choose the payment method.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x17151d)
        .setTitle("Payment method selected")
        .setDescription(
          `<@${record.opener_user_id}> has chosen to pay with **${method}**.`,
        )
        .setFooter({ text: "STOCKW SHOP" })
        .setTimestamp(),
    ],
    components: [],
    allowedMentions: { parse: [] },
  });
}

export async function closeTicketFromMessage(
  channel: TextChannel,
  member: GuildMember,
): Promise<{ closed: boolean; message?: string }> {
  const record = await getTicket(channel.id);
  if (!record || record.status !== "open") {
    return {
      closed: false,
      message: "This channel is not an open shop ticket.",
    };
  }
  const canClose =
    isBotOwner(member.id) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.id === record.opener_user_id ||
    (await isWhitelisted(record.guild_id, member.id));
  if (!canClose) {
    return {
      closed: false,
      message:
        "Only the ticket customer, whitelisted staff, or an administrator can close this ticket.",
    };
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
        .setFooter({ text: "STOCKW SHOP" })
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  });

  return { closed: true };
}

export async function sendDoneEmbed(
  channel: TextChannel,
  member: GuildMember,
): Promise<{ sent: boolean; message?: string }> {
  const record = await getTicket(channel.id);
  if (!record || record.status !== "open") {
    return { sent: false, message: "This channel is not an open shop ticket." };
  }
  const canSend =
    isBotOwner(member.id) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (await isWhitelisted(record.guild_id, member.id));
  if (!canSend) {
    return {
      sent: false,
      message: "Only whitelisted staff or an administrator can use `.done`.",
    };
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x17151d)
        .setTitle("Purchase complete")
        .setDescription(
          `**Customer:** <@${record.opener_user_id}>\n\nHead over to <#1535992619153236109> and use this format \`+rep @clique37 (amount) (reason)\`.\n\nPlease submit a **SCREENSHOT**. Thanks for your purchase. <:865852discordclyde:1548061027520749641>`,
        )
        .setFooter({ text: "STOCKW SHOP" })
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  });
  return { sent: true };
}

export async function requestTicketDeletion(
  channel: TextChannel,
  member: GuildMember,
): Promise<{ requested: boolean; message?: string }> {
  const record = await getTicket(channel.id);
  if (!record || record.status === "deleted") {
    return { requested: false, message: "This is not an active shop ticket." };
  }
  const canDelete =
    isBotOwner(member.id) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    (await isWhitelisted(record.guild_id, member.id));
  if (!canDelete) {
    return {
      requested: false,
      message: "Only whitelisted staff or an administrator can delete tickets.",
    };
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xb42318)
        .setTitle("Delete this ticket?")
        .setDescription(
          "This permanently deletes the ticket channel and all of its messages. This cannot be undone.",
        )
        .setFooter({ text: "STOCKW SHOP • Confirm only if you are sure." }),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket:delete-confirm:${channel.id}:${member.id}`)
          .setLabel("Delete ticket")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket:delete-cancel:${channel.id}:${member.id}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  });
  return { requested: true };
}

export async function handleTicketDeleteButton(
  interaction: ButtonInteraction,
): Promise<void> {
  const [prefix, action, channelId, requesterId] =
    interaction.customId.split(":");
  if (prefix !== "ticket" || !channelId || !requesterId) return;

  if (interaction.user.id !== requesterId) {
    await interaction.reply({
      content: "Only the staff member who requested this deletion can confirm it.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guild = interaction.guild;
  const member = await guild?.members.fetch(interaction.user.id).catch(() => null);
  if (
    !guild ||
    !member ||
    (!isBotOwner(member.id) &&
      !member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(await isWhitelisted(guild.id, member.id)))
  ) {
    await interaction.reply({
      content: "Only whitelisted staff or an administrator can delete tickets.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "delete-cancel") {
    await interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor(0x17151d)
          .setTitle("Ticket deletion cancelled")
          .setFooter({ text: "STOCKW SHOP" }),
      ],
      components: [],
    });
    return;
  }
  if (action !== "delete-confirm") return;

  const record = await getTicket(channelId);
  if (!record || record.guild_id !== guild.id || record.status === "deleted") {
    await interaction.reply({
      content: "This ticket has already been deleted or is no longer available.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const channel = await guild.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: "The ticket channel could not be found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await channel.delete(`Ticket deletion confirmed by ${interaction.user.tag}`);
  } catch (error) {
    logger.error({ error, channelId }, "Could not delete ticket channel");
    await interaction.editReply(
      "I could not delete the ticket channel. Check that the bot has Manage Channels permission.",
    );
    return;
  }

  try {
    await markTicketDeleted(channelId);
  } catch (error) {
    logger.error({ error, channelId }, "Could not update deleted ticket record");
    await interaction.editReply(
      "The ticket channel and messages were deleted, but its saved status could not be updated.",
    );
    return;
  }
  await interaction.editReply("Ticket and its messages have been deleted.");
}

