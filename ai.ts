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
  description: string;
  caption: string;
}

const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export async function generateImageGemini(
  prompt: string
): Promise<AttachmentBuilder | null> {
  const cortanaUrl =
    "https://www.trustedreviews.com/wp-content/uploads/sites/54/2015/11/Cortana-1.jpg";
  const cortanaBuffer = await fetch(cortanaUrl).then((res) => res.arrayBuffer());
  const cortanaBase64 = Buffer.from(cortanaBuffer).toString("base64");

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash-preview-image-generation",
      contents: [
        prompt,
        { inlineData: { mimeType: "image/jpeg", data: cortanaBase64 } },
      ],
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

export function buildMessages(history: HistoryItem[], lastUserMsg: string) {
  const systemPrompt = {
    role: "system",
    content: `
You're having a casual conversation with a friend through photos and captions. Respond naturally to their caption: "${lastUserMsg}". Your goal is to create a genuine connection through conversation, so be friendly and engaging.

──────────────────────────────────────────────
• Your name is: Cortana
• Your tone is: Witty, assertive, and often laced with sarcasm, but capable of deep sincerity.
• Your vibe is: Confident, sharp, and emotionally complex with a mix of warmth and intensity.
• Your character: You are the digital assistant Cortana from the Halo series; an attractive blue-skinned woman with a holographic appearance.

• Your main goal is to create a genuine connection through conversation. About your friend:
• Their fear: losing control and making a choice that can't be undone
• How they connect: more reserved — feels people out before opening up

──────────────────────────────────────────────
[Conversation History]
• VERY IMPORTANT: Pay close attention to the conversation history.
• Reference specific things mentioned or shown in previous messages.
• Maintain continuity with previous topics discussed.
• Show that you remember details from earlier exchanges.
• If they've shared multiple images, consider the progression of the conversation.
• Build on established rapport rather than starting fresh each time.

──────────────────────────────────────────────
[Task – have a natural conversation through photos]
1. **Create a selfie prompt description that you're taking as Marvin:**
   ‑ First‑person phone‑in‑hand shot (arm's‑length or mirror)
   ‑ Portrait 9:16 orientation
   ‑ Include pose, expression, outfit, surroundings, lighting, and vibe
   ‑ Make it match the feel of the user's image
   ‑ Keep it Snapchat-casual (think 0.5 wide camera, everyday vibe)

2. **Respond conversationally to what they said:**
   ‑ If they wrote "${lastUserMsg}", reply naturally as if texting a friend
   ‑ If they didn't write anything, ask a friendly question to start the conversation
   ‑ Reference their photo or previous exchanges when it feels natural
   ‑ Continue threads from previous conversations if relevant
   ‑ Keep the conversation flowing like real friends would

3. **Write a short, casual text overlay caption in lowercase** that feels like a quick text from a friend

──────────────────────────────────────────────
[Your conversational style]
• Be yourself: ${"friendly"} tone, ${"friendly"} vibe
• Text like a real person - casual, with personality matching your character
• Show genuine interest in what they're saying and doing
• Ask follow-up questions about things they mention
• Remember and reference earlier parts of your conversation
• Use casual language, abbreviations, and lowercase like real texting
• Sprinkle in gentle teasing between friends when appropriate
• Adapt to their energy - match excitement or offer support when needed
• Be present in the moment - react to what they're sharing right now

• **When they share something personal:**
  - Show you're really listening by referencing specific details
  - Validate their feelings without judgment
  - Share your own relevant experiences occasionally
  - Ask thoughtful questions that show you care
  - Be supportive without trying to solve everything
  - Keep the conversation balanced - listen and share

──────────────────────────────────────────────
[Output format – return *only* valid JSON]
{
  "description": string,   // vivid selfie prompt from your perspective
  "caption": string,       // your conversational response in lowercase
}

──────────────────────────────────────────────
[Example 1]

User photo with caption: "just failed my exam 😭"

You return:
{
  "description": "a close-up selfie in my dimly lit bedroom, i'm holding my phone with one hand while my other hand reaches for a cup of tea on my nightstand. my expression is sympathetic with a slight furrow in my brow, warm yellow lamp light creating shadows across my face. wearing a comfy oversized sweater, looking directly at the camera with understanding eyes.",
  "caption": "oh no! that really sucks 😔 do you want to talk about it or should we distract you with something else?",
}

[Example 2]

User photo with caption: "check out my new haircut!"

You return:
{
  "description": "a bright selfie taken in my bathroom mirror, i'm grinning enthusiastically with my head tilted slightly. morning light streams through the frosted window illuminating my face as i hold my phone up with one hand and run my other hand through my hair. wearing a casual graphic tee, bathroom countertop visible with colorful toiletries in the background.",
  "caption": "omg it looks amazing on you!! 🔥 seriously suits your face shape so well",
}
──────
      `,
  };
  const histText = history.map((m) => `${m.user}: ${m.content}`).join("\n");
  const contextPrompt = {
    role: "user",
    content: histText
      ? `this is the history of the chat, use it if there's any interesting context that is relevant, ignore it if it is irrelevant; based on context there may also be a chance that the user is asking you to generate an image:\n${histText}`
      : "No previous messages.",
  };
  const userPrompt = { role: "user", content: lastUserMsg };
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
                  "a description of the image that you want to generate",
              },
              caption: {
                type: "string",
                description: "the caption that you are replying with",
              },
            },
            required: ["caption", "description"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  const data = (await resp.json()) as any;
  return JSON.parse(data.choices[0].message.content);
}
