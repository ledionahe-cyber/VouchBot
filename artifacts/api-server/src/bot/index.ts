import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
  type Message,
  type TextChannel,
} from "discord.js";
import { logger } from "../lib/logger";
import {
  addToBlacklist,
  addToWhitelist,
  createVouch,
  ensureGuildSettings,
  isBlacklisted,
  removeFromBlacklist,
  removeFromWhitelist,
  removeRobloxAccount,
  saveRobloxAccount,
  seedStaffWhitelist,
  setGuildField,
} from "./store";
import { buildCategoryResponse, refreshShopPanel, updateShopSetup } from "./shop";
import {
  closeTicketFromMessage,
  createOrderTicket,
  handleCustomBoostButton,
  handleCustomBoostSubmit,
  handlePaymentMethodSelection,
  handleShopItemSelection,
  handleTicketDeleteButton,
  requestTicketDeletion,
  sendDoneEmbed,
} from "./tickets";
import { SHOP_CATEGORIES, STAFF_USER_ID } from "./catalog";

const adminPermission = PermissionFlagsBits.Administrator;
const BOT_OWNER_IDS = ["1483135478923399258", "1502364479739007037"];
const VOUCH_ROLE_ID = "1535983891054067742";

const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("owner")
    .setDescription("Show the bot owners."),
  new SlashCommandBuilder()
    .setName("shopsetup")
    .setDescription("Post or refresh the shop panel in this channel.")
    .setDefaultMemberPermissions(adminPermission),
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Choose where private order tickets are created.")
    .setDefaultMemberPermissions(adminPermission)
    .addChannelOption((option) =>
      option
        .setName("category")
        .setDescription("The Discord category for new tickets")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true),
    )
    .addChannelOption((option) =>
      option
        .setName("log_channel")
        .setDescription("Optional channel for ticket open notices")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName("vouchsetup")
    .setDescription("Set this channel as the vouch channel.")
    .setDefaultMemberPermissions(adminPermission),
  new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Manage who can see private order tickets.")
    .setDefaultMemberPermissions(adminPermission)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Allow a user to see and handle tickets.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The staff member to add")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a user's ticket access.")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("The staff member to remove")
            .setRequired(true),
        ),
    ),
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Block a user from browsing and buying in the shop.")
    .setDefaultMemberPermissions(adminPermission)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to block from the shop")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("unblacklist")
    .setDescription("Restore a user's access to the shop.")
    .setDefaultMemberPermissions(adminPermission)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to restore")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("robloxadd")
    .setDescription("Add or update a Roblox account listing.")
    .setDefaultMemberPermissions(adminPermission)
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("The Roblox account username")
        .setMaxLength(64)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("price")
        .setDescription("Price to show (for example: 230$)")
        .setMaxLength(32)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("description")
        .setDescription("A short description of the account")
        .setMaxLength(1000)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a Roblox account listing.")
    .setDefaultMemberPermissions(adminPermission)
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("The listed Roblox username")
        .setMaxLength(64)
        .setRequired(true),
    ),
];

function isAdministrator(
  interaction: ChatInputCommandInteraction,
): boolean {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function handleOwnerCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    content: `Owners : <@${BOT_OWNER_IDS[0]}>/<@${BOT_OWNER_IDS[1]}>`,
    allowedMentions: { users: BOT_OWNER_IDS },
  });
}

async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await replyEphemeral(interaction, "This command only works inside a server.");
    return;
  }
  if (!isAdministrator(interaction)) {
    await replyEphemeral(interaction, "Only server administrators can use this command.");
    return;
  }

  const guildId = interaction.guildId;
  if (interaction.commandName === "shopsetup") {
    const settings = await ensureGuildSettings(guildId);
    const posted = await updateShopSetup(
      interaction.guild,
      interaction.channelId,
      settings.shop_channel_id,
      settings.shop_message_id,
    );
    await setGuildField(guildId, "shop_channel_id", posted.channelId);
    await setGuildField(guildId, "shop_message_id", posted.messageId);
    await replyEphemeral(interaction, "Shop panel posted and linked to this channel.");
    return;
  }

  if (interaction.commandName === "ticketsetup") {
    const category = interaction.options.getChannel("category", true);
    if (category.type !== ChannelType.GuildCategory) {
      await replyEphemeral(interaction, "Choose a server category channel.");
      return;
    }
    await setGuildField(guildId, "ticket_category_id", category.id);
    const logChannel = interaction.options.getChannel("log_channel");
    if (logChannel) {
      await setGuildField(guildId, "ticket_log_channel_id", logChannel.id);
    }
    await replyEphemeral(
      interaction,
      `New order tickets will be created in **${category.name}**.`,
    );
    return;
  }

  if (interaction.commandName === "vouchsetup") {
    if (
      !interaction.channel ||
      !interaction.channel.isTextBased() ||
      !("send" in interaction.channel)
    ) {
      await replyEphemeral(interaction, "Run this in a text channel.");
      return;
    }
    await setGuildField(guildId, "vouch_channel_id", interaction.channelId);
    await replyEphemeral(interaction, "Vouches are now configured for this channel.");
    return;
  }

  if (interaction.commandName === "whitelist") {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser("user", true);
    if (subcommand === "add") {
      await addToWhitelist(guildId, user.id);
      await replyEphemeral(interaction, `${user.tag} can now see and handle tickets.`);
      return;
    }
    if (user.id === STAFF_USER_ID) {
      await replyEphemeral(
        interaction,
        "The configured staff account stays on the ticket whitelist.",
      );
      return;
    }
    const removed = await removeFromWhitelist(guildId, user.id);
    await replyEphemeral(
      interaction,
      removed
        ? `${user.tag} no longer has whitelist access.`
        : `${user.tag} was not on the whitelist.`,
    );
    return;
  }

  if (interaction.commandName === "blacklist") {
    const user = interaction.options.getUser("user", true);
    await addToBlacklist(guildId, user.id);
    await replyEphemeral(
      interaction,
      `${user.tag} is now blocked from browsing and buying in the shop.`,
    );
    return;
  }

  if (interaction.commandName === "unblacklist") {
    const user = interaction.options.getUser("user", true);
    const removed = await removeFromBlacklist(guildId, user.id);
    await replyEphemeral(
      interaction,
      removed
        ? `${user.tag} can use the shop again.`
        : `${user.tag} was not on the shop blacklist.`,
    );
    return;
  }

  if (interaction.commandName === "robloxadd") {
    const username = interaction.options.getString("username", true).trim();
    const price = interaction.options.getString("price", true).trim();
    const description = interaction.options.getString("description", true).trim();
    await saveRobloxAccount(guildId, username, price, description);
    await replyEphemeral(
      interaction,
      `**${username}** is now listed at **${price}**. It will appear in the Roblox category.`,
    );
    return;
  }

  if (interaction.commandName === "remove") {
    const username = interaction.options.getString("username", true).trim();
    const removed = await removeRobloxAccount(guildId, username);
    await replyEphemeral(
      interaction,
      removed
        ? `Removed **${username}** from the Roblox listings.`
        : `No Roblox listing named **${username}** was found.`,
    );
  }
}

async function registerCommands(guild: Guild): Promise<void> {
  try {
    await guild.commands.set(commandDefinitions.map((command) => command.toJSON()));
    await ensureGuildSettings(guild.id);
    await seedStaffWhitelist(guild.id, STAFF_USER_ID);
    logger.info({ guildId: guild.id }, "Discord commands registered");
  } catch (error) {
    logger.error({ error, guildId: guild.id }, "Could not register Discord commands");
  }
}

async function handleVouch(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;
  if (
    !message.member.permissions.has(PermissionFlagsBits.Administrator) &&
    !message.member.roles.cache.has(VOUCH_ROLE_ID)
  ) {
    await message.reply(
      "You need the vouch role or Administrator permission to use +rep.",
    );
    return;
  }
  const match = message.content.match(/^\+rep\s+(?:<@!?(\d+)>|(\d+))\s+([\s\S]+)$/i);
  const targetId = message.mentions.users.first()?.id ?? match?.[1] ?? match?.[2];
  const body = match?.[3]?.trim();
  if (!targetId || !body) {
    await message.reply("Use `+rep @user your vouch text`.");
    return;
  }
  if (targetId === message.author.id) {
    await message.reply("You cannot vouch for yourself.");
    return;
  }
  if (body.length > 1500) {
    await message.reply("Keep the vouch text under 1,500 characters.");
    return;
  }

  const settings = await ensureGuildSettings(message.guild.id);
  if (!settings.vouch_channel_id) {
    await message.reply("An administrator needs to run `/vouchsetup` first.");
    return;
  }
  if (message.channelId !== settings.vouch_channel_id) {
    await message.reply(`Please post vouches in <#${settings.vouch_channel_id}>.`);
    return;
  }
  if (!message.channel.isTextBased() || !("send" in message.channel)) {
    await message.reply("Vouches can only be posted in a text channel.");
    return;
  }
  const vouchChannel = message.channel as TextChannel;

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await message.reply("I could not find that member in this server.");
    return;
  }

  const number = await createVouch({
    guildId: message.guild.id,
    targetUserId: targetId,
    authorUserId: message.author.id,
    body,
  });
  const embed = new EmbedBuilder()
    .setColor(0x17151d)
    .setTitle("New vouch created!")
    .addFields(
      { name: "Vouch", value: body.slice(0, 1024) },
      { name: "Vouch No.", value: `${number}`, inline: true },
      { name: "Vouched by", value: `<@${message.author.id}>`, inline: true },
      {
        name: "Vouched at",
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: false,
      },
    )
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .setFooter({ text: `STOCKW SHOP • ${message.guild.name} • Vouch ${number}` })
    .setTimestamp();

  await vouchChannel.send({
    content: `<@${targetId}>`,
    embeds: [embed],
    allowedMentions: { users: [targetId] },
  });

  if (number % 100 === 0) {
    await vouchChannel.send({
      content: `@everyone **${message.guild.name} has reached ${number} vouches!** Thank you to everyone who helped us get here.`,
      allowedMentions: { parse: ["everyone"] },
    });
  }

  await refreshShopPanel(message.client, message.guild.id);
}

async function handleCloseCommand(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;
  if (message.channel.type !== ChannelType.GuildText) {
    await message.reply("Use `.close` in a ticket channel.");
    return;
  }
  const textChannel = message.channel as TextChannel;
  const result = await closeTicketFromMessage(textChannel, message.member);
  if (!result.closed && result.message) {
    await message.reply({
      content: result.message,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleDoneCommand(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;
  if (message.channel.type !== ChannelType.GuildText) {
    await message.reply("Use `.done` in a ticket channel.");
    return;
  }
  const result = await sendDoneEmbed(
    message.channel as TextChannel,
    message.member,
  );
  if (!result.sent && result.message) {
    await message.reply({
      content: result.message,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleDeleteCommand(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;
  if (message.channel.type !== ChannelType.GuildText) {
    await message.reply("Use `.delete` in a ticket channel.");
    return;
  }
  const result = await requestTicketDeletion(
    message.channel as TextChannel,
    message.member,
  );
  if (!result.requested && result.message) {
    await message.reply({
      content: result.message,
      allowedMentions: { parse: [] },
    });
  }
}

async function handleMessage(message: Message): Promise<void> {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  if (/^\.delete(?:\s|$)/i.test(content)) {
    await handleDeleteCommand(message);
    return;
  }
  if (/^\.done(?:\s|$)/i.test(content)) {
    await handleDoneCommand(message);
    return;
  }
  if (/^\.close(?:\s|$)/i.test(content)) {
    await handleCloseCommand(message);
    return;
  }
  if (/^\+rep(?:\s|$)/i.test(content)) {
    await handleVouch(message);
  }
}

async function handleInteraction(
  client: Client,
  interaction: Interaction,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "owner") {
      await handleOwnerCommand(interaction);
      return;
    }
    await handleAdminCommand(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "shop:category") {
      if (
        interaction.guildId &&
        (await isBlacklisted(interaction.guildId, interaction.user.id))
      ) {
        await interaction.reply({
          content: "You are blacklisted from using the shop.",
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
      const selected = interaction.values[0];
      if (
        selected &&
        SHOP_CATEGORIES.some((category) => category.value === selected)
      ) {
        await buildCategoryResponse(
          interaction,
          selected as (typeof SHOP_CATEGORIES)[number]["value"],
        );
      }
      return;
    }
    if (interaction.customId.startsWith("shop:item:")) {
      if (
        interaction.guildId &&
        (await isBlacklisted(interaction.guildId, interaction.user.id))
      ) {
        await interaction.reply({
          content: "You are blacklisted from using the shop.",
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await handleShopItemSelection(interaction, client);
      return;
    }
    if (interaction.customId === "ticket:payment-method") {
      await handlePaymentMethodSelection(interaction);
      return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("ticket:delete-")) {
      await handleTicketDeleteButton(interaction);
      return;
    }
    if (interaction.customId === "shop:refresh" && interaction.guildId) {
      await interaction.deferUpdate();
      await refreshShopPanel(client, interaction.guildId);
      return;
    }
    if (interaction.customId === "shop:custom-modal") {
      if (
        interaction.guildId &&
        (await isBlacklisted(interaction.guildId, interaction.user.id))
      ) {
        await interaction.reply({
          content: "You are blacklisted from using the shop.",
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
      await handleCustomBoostButton(interaction);
    }
    return;
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "shop:custom-submit"
  ) {
    if (
      interaction.guildId &&
      (await isBlacklisted(interaction.guildId, interaction.user.id))
    ) {
      await interaction.reply({
        content: "You are blacklisted from using the shop.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    await handleCustomBoostSubmit(interaction, client);
  }
}

export function startDiscordBot(): Client | undefined {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is missing; the Discord bot was not started");
    return undefined;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { username: readyClient.user.tag, guildCount: readyClient.guilds.cache.size },
      "Discord bot connected",
    );
    readyClient.user.setActivity("STOCKW SHOP");
    for (const guild of readyClient.guilds.cache.values()) {
      void registerCommands(guild);
    }
  });

  client.on(Events.GuildCreate, (guild) => {
    void registerCommands(guild);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(client, interaction).catch(async (error: unknown) => {
      logger.error({ error }, "Discord interaction failed");
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content: "Something went wrong while handling that request.",
            flags: MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
          })
          .catch(() => undefined);
      }
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message).catch((error: unknown) => {
      logger.error({ error, guildId: message.guildId }, "Discord message command failed");
    });
  });

  client.on(Events.GuildMemberAdd, (member) => {
    void refreshShopPanel(client, member.guild.id);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    void refreshShopPanel(client, member.guild.id);
  });

  client.on(Events.PresenceUpdate, (_oldPresence, presence) => {
    if (presence.userId === STAFF_USER_ID && presence.guild) {
      void refreshShopPanel(client, presence.guild.id);
    }
  });

  client.on(Events.Error, (error) => {
    logger.error({ error }, "Discord client error");
  });

  void client.login(token).catch((error: unknown) => {
    logger.error(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : String(error),
      },
      "Discord bot login failed",
    );
  });

  return client;
}
