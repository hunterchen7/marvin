import {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
} from "discord.js";
import fetch from "node-fetch";
import { generateImageCF, generateImageGemini, getAIReply, getIntent } from "./ai";

const { OPENROUTER_API_KEY, DISCORD_TOKEN } = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

interface HistoryItem {
  user: string;
  content: string;
}

const PREFIX = "!";
const HISTORY_LIMIT = 30;

const histories = new Map<string, HistoryItem[]>();

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on("messageCreate", async (msg: Message) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();
  const channelId = msg.channel.id;

  if (content.startsWith(PREFIX)) {
    const [cmd, ...rest] = content.slice(PREFIX.length).split(" ");
    const argString = rest.join(" ").trim();

    switch (cmd.toLowerCase()) {
      case "credits": {
        await (msg.channel as TextChannel).sendTyping();
        const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
        });
        if (resp.status !== 200) {
          await msg.reply("Failed to fetch credits info from OpenRouter.");
          break;
        }
        const data = (await resp.json()) as any;
        const { usage, limit, is_free_tier: isFree, label } = data.data;
        const credits =
          limit == null ? "Unlimited" : `${limit - usage} left out of ${limit}`;
        await msg.reply(
          `**Key label:** ${label}\n**Free tier:** ${
            isFree ? "Yes" : "No"
          }\n**Credits:** ${credits}`
        );
        break;
      }

      case "generate": {
        if (!argString) {
          await msg.reply("Usage: !generate <prompt>");
          break;
        }
        await (msg.channel as TextChannel).sendTyping();
        const file = await generateImageGemini(argString);
        await msg.reply({
          files: file ? [file] : [],
          content: file ? "" : "Failed to generate image.",
        });
        break;
      }

      case "generate-sd": {
        if (!argString) {
          await msg.reply("Usage: !generate_sd <prompt>");
          break;
        }
        await (msg.channel as TextChannel).sendTyping();
        const file = await generateImageCF(
          argString,
          "stable-diffusion-xl-lightning"
        );
        await msg.reply({
          files: file ? [file] : [],
          content: file ? "" : "Failed to generate image.",
        });
        break;
      }

      case "generate-ds": {
        if (!argString) {
          await msg.reply("Usage: !generate_ds <prompt>");
          break;
        }
        await (msg.channel as TextChannel).sendTyping();
        const file = await generateImageCF(argString, "dreamshaper-8-lcm");
        await msg.reply({
          files: file ? [file] : [],
          content: file ? "" : "Failed to generate image.",
        });
        break;
      }

      case "clear": {
        histories.set(channelId, []);
        await msg.reply("Conversation history cleared.");
        break;
      }

      default:
        await msg.reply("Unknown command");
    }
    return;
  }

  const hist = histories.get(channelId) ?? [];
  hist.push({ user: msg.author.username, content });
  if (hist.length > HISTORY_LIMIT) hist.shift();
  histories.set(channelId, hist);

  if (msg.channel.type === ChannelType.DM) {
    await handleUserMessage(msg, hist, `this is a message: ${content}`);
    return;
  }

  if (msg.reference) {
    const replied = await msg.channel.messages.fetch(msg.reference.messageId!);
    if (replied.author.id === client.user?.id) {
      const prompt = `the user replied to your message: ${replied.content} and this is the message they sent you: ${content}`;
      await handleUserMessage(msg, hist, prompt);
      return;
    }
  }

  if (msg.mentions.has(client.user!.id)) {
    const pattern = new RegExp(`<@!?${client.user?.id}>`, "g");
    const userMsg = content.replace(pattern, "").trim();
    const prompt = `you have been mentioned, this is the message the user sent you: ${userMsg}`;
    await handleUserMessage(msg, hist, prompt);
    return;
  }
});

async function handleUserMessage(
  discordMsg: Message,
  hist: HistoryItem[],
  prompt: string
) {
  await (discordMsg.channel as TextChannel).sendTyping();

  const reply = await getAIReply(hist, prompt);
  const intentObj = await getIntent(
    prompt,
    hist.map((h) => `${h.user}: ${h.content}`).join("\n")
  );

  const wantsImage = intentObj.image;
  const description = reply.description || intentObj.description;
  const messageText = reply.message || "";

  console.log({ wantsImage, description, messageText });

  if (wantsImage) {
    let attachment: AttachmentBuilder | null = await generateImageGemini(
      description
    );
    if (!attachment) attachment = await generateImageCF(description);

    if (attachment) {
      await discordMsg.reply({ content: messageText, files: [attachment] });
    } else {
      await discordMsg.reply("Failed to generate image.");
    }
  } else {
    await discordMsg.reply(messageText);
  }
}

client.login(DISCORD_TOKEN);
