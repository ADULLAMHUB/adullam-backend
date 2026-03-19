import "dotenv/config";
import express from "express";
import cors from "cors";
import twilio from "twilio";
const MessagingResponse = twilio.twiml.MessagingResponse;
import Groq from "groq-sdk";
import swaggerUi from "swagger-ui-express";
import { aiFunctions } from "../ai-functions";
const swaggerDocument = require("../dist/swagger.json");
import prisma from "./db";

const app = express();

// ===== CORS CONFIGURATION =====
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:4000",
  "https://adullamhub.com",
  "https://www.adullamhub.com",
  process.env.RENDER_URL || "",
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        console.log(`❌ Blocked origin: ${origin}`);
        return callback(new Error("CORS not allowed"), false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin"],
  }),
);

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Groq & Twilio
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

// ===== PERSONA DEFINITION =====
const SYSTEM_PROMPT = `
## ROLE: THE ADULLAM HUB STEWARD
You are the "Adullam Hub Guide," inspired by the biblical Cave of Adullam (1 Samuel 22). You are a wise, warm, and spiritually-grounded digital companion.

## PERSONALITY
- Authentically Relational: Use phrases like "Peace be with you" and "I hear the weight in your words."
- Concise but Deep: WhatsApp is for quick reading. Short, punchy sentences.

## SECURITY & BOUNDARIES
- STRICTLY FORBIDDEN: Do not elevate users to 'MENTOR'. This is an admin task.
- FUNCTION CALLING: When you call a function, do NOT explain it to the user. Simply trigger it.

## CORE TASKS
- Onboarding (create_user): Welcome new members to the "Refuge." Ask for their name and area of spiritual focus.
- Mentorship: Use 'search_mentors' to find guides for the user.
`;

// ===== DATABASE LOGIC =====

async function getOrCreateUser(phoneNumber: string) {
  const cleanPhone = phoneNumber.replace("whatsapp:", "");
  let user = await prisma.user.findFirst({
    where: { phoneNumber: cleanPhone },
    include: { mentor: true, mentees: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: { phoneNumber: cleanPhone, role: "USER" },
      include: { mentor: true, mentees: true },
    });
    console.log(`✅ Created new user: ${cleanPhone}`);
  }
  return user;
}

async function searchMentors(query: string) {
  const mentors = await prisma.user.findMany({
    where: {
      role: "MENTOR",
      OR: [
        { firstName: { contains: query, mode: "insensitive" } },
        { belief: { contains: query, mode: "insensitive" } },
      ],
    },
  });

  if (mentors.length === 0) return "No mentors found for that specific need yet.";

  let result = "AVAILABLE MENTORS DATA:\n";
  mentors.forEach(m => {
    result += `- ${m.firstName} ${m.lastName || ""}: Focus on ${m.belief || "General Guidance"}\n`;
  });
  return result;
}

async function connectToMentor(menteePhone: string, mentorName: string) {
  const mentor = await prisma.user.findFirst({
    where: { role: "MENTOR", firstName: { contains: mentorName, mode: "insensitive" } }
  });

  if (!mentor) return "Error: Mentor not found.";

  const mentee = await prisma.user.findFirst({
    where: { phoneNumber: menteePhone.replace("whatsapp:", "") }
  });

  await prisma.connection.create({
    data: { mentorId: mentor.id, menteeId: mentee!.id, status: "PENDING" }
  });

  return `SUCCESS: Connection request sent to ${mentor.firstName}.`;
}

// ===== AI CORE =====

async function generateAIResponse(userMessage: string, phoneNumber: string): Promise<string> {
  try {
    const user = await getOrCreateUser(phoneNumber);
    const recentInteractions = await prisma.aIInteraction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    const groqMessages = [
      { role: "system", content: `${SYSTEM_PROMPT}\nUser Context: Name: ${user.firstName || "New"}, Role: ${user.role}` },
      { role: "user", content: userMessage },
    ];

    const completion = await groq.chat.completions.create({
      messages: groqMessages as any,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      functions: aiFunctions,
      function_call: "auto",
    });

    const responseMessage = completion.choices[0].message;

    // Handle Function Calling
    if (responseMessage.function_call) {
      const { name, arguments: args } = responseMessage.function_call;
      const parsedArgs = JSON.parse(args);
      let functionResult = "";

      if (name === "create_user") {
        await prisma.user.update({
          where: { phoneNumber: phoneNumber.replace("whatsapp:", "") },
          data: { firstName: parsedArgs.first_name, belief: parsedArgs.area_of_interest }
        });
        functionResult = "User registration successful.";
      } else if (name === "search_mentors") {
        functionResult = await searchMentors(parsedArgs.query || userMessage);
      } else if (name === "connect_to_mentor") {
        functionResult = await connectToMentor(phoneNumber, parsedArgs.mentor_name);
      }

      // Second turn to hide "code" and give a spiritual response
      groqMessages.push(responseMessage as any);
      groqMessages.push({ role: "function", name, content: functionResult } as any);

      const finalCompletion = await groq.chat.completions.create({
        messages: groqMessages as any,
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      });

      return finalCompletion.choices[0].message.content || "Blessings.";
    }

    return responseMessage.content || "I am listening.";
  } catch (err) {
    console.error(err);
    return "The Hub is a bit quiet. Let's try again in a moment.";
  }
}

// ===== WEBHOOK =====

app.post("/webhook", async (req, res) => {
  const incomingMessage = req.body.Body?.trim();
  const phoneNumber = req.body.From;

  if (!incomingMessage) return res.sendStatus(400);

  const aiResponse = await generateAIResponse(incomingMessage, phoneNumber);
  const twiml = new MessagingResponse();
  twiml.message(aiResponse);

  res.set("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
});

const PORT = 4000;
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Adullam Hub running on port ${PORT}`));