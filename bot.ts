import {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
} from "discord.js";
import {
  generateImageCF,
  generateImageGemini,
  getAIReply,
} from "./ai";

const { DISCORD_TOKEN } = process.env;

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

const histories = new Map<string, HistoryItem[]>();

client.once("ready", () => {
  console.log(`Logged in as ${client.user?.tag}`);
});

client.on("messageCreate", async (msg: Message) => {
  if (msg.author.bot) return;

  const content = msg.content.trim();
  const channelId = msg.channel.id;

  const hist = histories.get(channelId) ?? [];
  hist.push({ user: msg.author.username, content });
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

  const pattern = new RegExp(`<@!?${client.user?.id}>`, "g");
  const userMsg = content.replace(pattern, "").trim();
  const prompt = `reply to this message: ${userMsg}`;
  await handleUserMessage(msg, hist, prompt);
});

async function handleUserMessage(
  discordMsg: Message,
  hist: HistoryItem[],
  prompt: string
) {
  await (discordMsg.channel as TextChannel).sendTyping();

  const reply = await getAIReply(hist, prompt);

  const wantsImage = true; // intentObj.image;
  const description = reply.description;
  const messageText = reply.caption || "";

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
