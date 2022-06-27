import { Telegraf } from "telegraf";
import { getMessageType } from "./utils/handlers/messageType.js";
import { evaluateGuildsRegistryState, verifyGuild } from "./utils/arweave.js";
import {
  isGuildLinkable,
  isActiveGuild,
  canJoinGuild,
  getUserArkProfile,
} from "./utils/handlers/guild.js";
import {
  msgGuildSuccess,
  msgInvalidChatType,
  msgOnlyAdmin,
  msgSendInvitation,
  msgBotNotAdmin,
  msgGuildFailure,
  msgGuildNotFound,
  msgUserReentrancy,
  msgArkIdentityVoid0,
  msgCantJoinGuild,
  msgDuplicatedRequests,
  msgLoading,
} from "./utils/handlers/messages.js";
import { isSuperUser } from "./utils/handlers/isAdmin.js";
import { userExistenceInGrp } from "./utils/handlers/userExistenceInGrp.js";
import { BOT_USERNAME } from "./utils/constants.js";
import { cacheUserRequest, hasRequestedToJoin } from "./utils/cache/cache.js";
import axios from "axios";
import "./utils/setEnv.js";

const bot = new Telegraf(process.env.TG_BOT_TOKEN);

bot.command("/link_ark_guild", async (ctx) => {
  await msgLoading(ctx);

  const chat_admins = await ctx.telegram.getChatAdministrators(
    ctx.message.chat.id
  );

  const message = ctx.update.message;
  const registrant_username = message.from?.username;
  const guild_id = message.text.replace("/link_ark_guild ", "");
  const isCallerAdmin = await isSuperUser(chat_admins, registrant_username);
  const isBotAdmin = await isSuperUser(chat_admins, BOT_USERNAME);

  // command caller must be an admin
  if (!isCallerAdmin.status) {
    await msgOnlyAdmin(ctx);
    return false;
  }

  // the bot must be an admin
  if (!isBotAdmin.status) {
    await msgBotNotAdmin(ctx);
    return false;
  }

  const messageType = await getMessageType(message);

  if (messageType === "private") {
    await msgInvalidChatType(ctx, "group");
    return false;
  }

  const registryState = await evaluateGuildsRegistryState();

  const isLinkable = await isGuildLinkable({
    registry_state: registryState,
    guild_id: guild_id,
    caller_username: `@${registrant_username}`.toUpperCase(),
  });

  if (isLinkable) {
    const verificationId = await verifyGuild(guild_id, ctx.message.chat.id);

    await msgGuildSuccess(ctx, guild_id, registrant_username, verificationId);

    return true;
  } else {
    await msgGuildFailure(ctx);
    return false;
  }
});

bot.command("/join_ark_guild", async (ctx) => {
  await msgLoading(ctx);

  const message = ctx.update.message;
  const messageType = await getMessageType(message);
  const registrant_username = message.from?.username;

  // this command can only be invoked in private message
  if (messageType === "supergroup") {
    await msgInvalidChatType(ctx, "private");

    return false;
  }

  const guild_id = message.text.replace("/join_ark_guild ", "");
  const registryState = await evaluateGuildsRegistryState();
  const guildProfile = await isActiveGuild(registryState, guild_id);

  // check if the guild exist or is linked to a group
  if (!guildProfile.status) {
    await msgGuildNotFound(ctx);
    return false;
  }

  const group_id = guildProfile["guild"]["dec_group_id"];

  const callerExistenceInGrp = await userExistenceInGrp(ctx, group_id);

  if (callerExistenceInGrp?.user?.id === ctx.message.chat.id) {
    await msgUserReentrancy(ctx);
    return false;
  }

  const callerArkProfile = await getUserArkProfile(registrant_username);

  //check if the command caller has a valid Ark Protocol identity
  if (!callerArkProfile) {
    await msgArkIdentityVoid0(ctx);
    return false;
  }

  const registrant_arweave_address = callerArkProfile.arweave_address;
  const canJoin = await canJoinGuild(
    registrant_arweave_address,
    guildProfile["guild"]
  );

  if (canJoin) {
    // users can request only once to join a guild
    const hasRequestedPreviously = await hasRequestedToJoin(
      callerArkProfile.telegram_username,
      guildProfile["guild"]["group_id"]
    );
    if (hasRequestedPreviously) {
      await msgDuplicatedRequests(ctx);
      return false;
    }
    // generate the invitation URL
    const invite = await ctx.telegram.createChatInviteLink(group_id, 1);

    await msgSendInvitation(ctx, invite.invite_link, guild_id);
    await cacheUserRequest(
      callerArkProfile.telegram_username,
      guildProfile["guild"]["group_id"]
    );

    return true;
  }

  await msgCantJoinGuild(ctx);

  return false;
});

bot.launch();

// Enable graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
