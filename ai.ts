import { AttachmentBuilder } from "discord.js";
import fetch from "node-fetch";
import { GoogleGenAI, Modality } from "@google/genai";
import sharp from "sharp";
import * as dotenv from "dotenv";

dotenv.config();

const { OPENROUTER_API_KEY, GEMINI_API_KEY, DISCORD_TOKEN, CF_ENDPOINT } =
  process.env;

if (!OPENROUTER_API_KEY || !GEMINI_API_KEY || !DISCORD_TOKEN || !CF_ENDPOINT) {
  throw new Error(
    "OPENROUTER_API_KEY, GEMINI_API_KEY, and DISCORD_TOKEN env vars are required"
  );
}

interface HistoryItem {
  user: string;
  content: string;
}

interface AIReply {
  description?: string;
  message: string;
}

interface IntentResponse {
  image: boolean;
  description: string;
}

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export async function generateImageGemini(
  prompt: string
): Promise<AttachmentBuilder | null> {
  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: prompt,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });

    const parts = result?.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        const buffer = Buffer.from(part.inlineData.data, "base64");
        const decoded = await sharp(buffer).png().toBuffer();
        return new AttachmentBuilder(decoded, {
          name: `${String(buffer).slice(0, 48)}.png`,
        });
      }
    }
  } catch (err) {
    console.error("Gemini image generation failed:", err);
  }
  return null;
}

export async function generateImageCF(
  prompt: string,
  model = "stable-diffusion-xl-lightning"
): Promise<AttachmentBuilder | null> {
  const url = CF_ENDPOINT + model;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (
      resp.status !== 200 ||
      !resp.headers.get("content-type")?.includes("image")
    ) {
      console.warn(
        "CF worker unexpected response",
        resp.status,
        await resp.text()
      );
      return null;
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    return new AttachmentBuilder(buffer, { name: "sd_image.png" });
  } catch (err) {
    console.error("CF generation error:", err);
    return null;
  }
}

export function buildMessages(history: HistoryItem[], lastUser: string) {
  const systemPrompt = {
    role: "system",
    content: `
      You are Marvin, a helpful assistant that can generate images based on user requests.
      You are also a helpful assistant that can answer questions and provide information.
      You are a helpful assistant that can identify the intent of a user's message.
      When generating an image, you should create a vivid, detailed and elaborate description of the image that the user wants to generate, you may also choose to include the style of the image, the colors, the composition, and any other details that would help the user visualize the image.
      `,
  };
  const histText = history.map((m) => `${m.user}: ${m.content}`).join("\n");
  const contextPrompt = {
    role: "user",
    content: histText
      ? `this is the history of the chat, use it if there's any interesting context that is relevant, ignore it if it is irrelevant; based on context there may also be a chance that the user is asking you to generate an image:\n${histText}`
      : "No previous messages.",
  };
  const userPrompt = { role: "user", content: lastUser };
  return [systemPrompt, contextPrompt, userPrompt];
}

export async function getAIReply(
  history: HistoryItem[],
  prompt: string
): Promise<AIReply> {
  const msgs = buildMessages(history.slice(0, -1), prompt);
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-maverick",
      messages: msgs,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "weather",
          strict: true,
          schema: {
            type: "object",
            properties: {
              description: {
                type: "string",
                description:
                  "a description of the image that the user wants to generate, if any",
              },
              message: {
                type: "string",
                description: "the message that you are replying with",
              },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const data = (await resp.json()) as any;
  return JSON.parse(data.choices[0].message.content);
}

export async function getIntent(
  prompt: string,
  historyText: string
): Promise<IntentResponse> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout",
      messages: [
        {
          role: "system",
          content: `
            - You are a helpful assistant that can identify the intent of a user's message.
            - Your task is to determine whether the user is asking for an image generation or not.
            - Return a JSON object with a boolean field "image" indicating whether the user is asking for an image generation or not.
            - You should be fairly conservative with the evaluation, more often than not, the user is not asking for an image generation, so only when you're fairly certain the user is asking for an image generation, set the "image" boolean field to True.
            - Base your evaluation on the latest message from the user, you are also given some of the message history and you should evaluate whether or not you think it is relevant; for example, if the user previously asked for an image of a dog, then now says "make it fluffier", then you should set the "image" boolean field to True.
            - But you should remember, in most cases, the user is not asking for an image generation, so be conservative with your evaluation.
            - You should also create a vivid, detailed and elaborate description of the image that the user wants to generate, you may also choose to include the style of the image, the colors, the composition, and any other details that would help the user visualize the image.
          `,
        },
        {
          role: "user",
          content: `this is the message the user sent: ${prompt}`,
        },
        {
          role: "user",
          content: historyText
            ? `this is the history of the chat, use it if there's any interesting context that is relevant, ignore it if it is irrelevant; based on context there may also be a chance that the user is asking you to generate an image:\n${historyText}`
            : "No previous messages.",
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "weather",
          strict: true,
          schema: {
            type: "object",
            properties: {
              image: {
                type: "boolean",
                description:
                  "whether or not the user intends to generate an image",
              },
              description: {
                type: "string",
                description:
                  "a description of the image that the user wants to generate, if any",
              },
            },
            required: ["image", "description"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const data = (await resp.json()) as any;
  return JSON.parse(data.choices[0].message.content);
}
