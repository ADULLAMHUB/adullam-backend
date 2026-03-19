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

app.use(cors());

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

// ===== SWAGGER DOCS =====
app.use("/api-docs/swagger.json", (req, res) => {
  res.sendFile(__dirname + "/swagger.json");
});

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Adullam Hub WhatsApp Bot API",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
    },
  }),
);

console.log(`📚 Swagger UI available at /api-docs`);

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

// ===== DATABASE FUNCTIONS =====

/**
 * Get or create a user from phone number
 */
async function getOrCreateUser(phoneNumber: string) {
  try {
    // Clean phone number (remove whatsapp: prefix if present)
    const cleanPhone = phoneNumber.replace("whatsapp:", "");

    let user = await prisma.user.findFirst({
      where: { phoneNumber: cleanPhone },
      include: {
        mentor: true,
        mentees: true,
        sentConnections: {
          include: { mentee: true },
        },
        receivedConnections: {
          include: { mentor: true },
        },
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber: cleanPhone,
          role: "USER",
        },
        include: {
          mentor: true,
          mentees: true,
          sentConnections: {
            include: { mentee: true },
          },
          receivedConnections: {
            include: { mentor: true },
          },
        },
      });

      console.log(`✅ Created new user: ${cleanPhone}`);
    }

    return user;
  } catch (error) {
    console.error("❌ Error in getOrCreateUser:", error);
    throw error;
  }
}

/**
 * Log AI interaction
 */
async function logAIInteraction(
  userId: string,
  action: string,
  parameters: any,
  result: any,
  status: string,
) {
  try {
    await prisma.aIInteraction.create({
      data: {
        userId,
        action,
        parameters,
        result,
        status,
      },
    });
  } catch (error) {
    console.error("❌ Error logging AI interaction:", error);
  }
}

/**
 * Search for mentors in database
 */
async function searchMentors(query: string, userId?: string) {
  const lowercaseQuery = query.toLowerCase();

  // Search mentors in database
  const mentors = await prisma.user.findMany({
    where: {
      role: "MENTOR",
      OR: [
        { firstName: { contains: lowercaseQuery, mode: "insensitive" } },
        { lastName: { contains: lowercaseQuery, mode: "insensitive" } },
        { organization: { contains: lowercaseQuery, mode: "insensitive" } },
        { belief: { contains: lowercaseQuery, mode: "insensitive" } },
      ],
    },
    include: {
      mentees: true,
    },
  });

  // If no mentors found with query, return all
  if (mentors.length === 0 && lowercaseQuery.includes("mentor")) {
    const allMentors = await prisma.user.findMany({
      where: { role: "MENTOR" },
      include: {
        mentees: true,
      },
    });

    if (allMentors.length === 0) {
      return "I don't see any mentors available at the moment. Please check back later.";
    }

    let response = "*Here are our mentors at Adullam Hub:*\n\n";
    allMentors.forEach((m, index) => {
      response += `${index + 1}. *${m.firstName} ${m.lastName || ""}*\n`;
      if (m.organization) response += `   📌 ${m.organization}\n`;
      if (m.belief) response += `   ✨ ${m.belief}\n`;
      response += `   👥 Currently mentoring: ${m.mentees.length} people\n\n`;
    });
    response += "_Would you like to connect with any of these mentors?_";
    return response;
  }

  if (mentors.length > 0) {
    if (mentors.length === 1) {
      const m = mentors[0];
      return (
        `*${m.firstName} ${m.lastName || ""}*\n\n` +
        `${m.organization ? `📌 ${m.organization}\n` : ""}` +
        `${m.belief ? `✨ ${m.belief}\n` : ""}` +
        `👥 Currently mentoring: ${m.mentees.length} people\n\n` +
        `Would you like to connect with them?`
      );
    } else {
      let response = "*Several mentors can help with this:*\n\n";
      mentors.forEach((m, index) => {
        response += `${index + 1}. *${m.firstName} ${m.lastName || ""}* - ${m.organization || "Mentor"}\n`;
        if (m.belief) response += `   ✨ ${m.belief}\n`;
      });
      response += "\n_Which mentor would you like to learn more about?_";
      return response;
    }
  }

  return "";
}

/**
 * Connect mentee to mentor
 */
async function connectToMentor(menteePhone: string, mentorName: string) {
  try {
    // Find mentor by name
    const mentor = await prisma.user.findFirst({
      where: {
        role: "MENTOR",
        OR: [
          { firstName: { contains: mentorName, mode: "insensitive" } },
          { lastName: { contains: mentorName, mode: "insensitive" } },
        ],
      },
    });

    if (!mentor) {
      return "I couldn't find that mentor. Please check the name and try again.";
    }

    // Get mentee
    const mentee = await prisma.user.findFirst({
      where: { phoneNumber: menteePhone.replace("whatsapp:", "") },
    });

    if (!mentee) {
      return "I couldn't find your account. Please try again.";
    }

    // Check if connection already exists
    const existingConnection = await prisma.connection.findFirst({
      where: {
        mentorId: mentor.id,
        menteeId: mentee.id,
      },
    });

    if (existingConnection) {
      return `You already have a ${existingConnection.status.toLowerCase()} connection with ${mentor.firstName}.`;
    }

    // Create connection
    const connection = await prisma.connection.create({
      data: {
        mentorId: mentor.id,
        menteeId: mentee.id,
        status: "PENDING",
        message: `Connection requested via WhatsApp`,
      },
    });

    // Create notification
    await prisma.notification.create({
      data: {
        message: `${mentee.firstName || "Someone"} wants to connect with you as a mentee`,
        type: "CONNECTION_REQUEST",
        userId: mentor.id,
      },
    });

    return `Great! I've sent a connection request to ${mentor.firstName}. They'll be notified and get back to you soon.`;
  } catch (error) {
    console.error("❌ Error connecting to mentor:", error);
    return "Sorry, I had trouble connecting you to that mentor. Please try again.";
  }
}

/**
 * Generate AI response using Groq with database context
 */
async function generateAIResponse(
  userMessage: string,
  phoneNumber: string,
): Promise<string> {
  try {
    const user = await getOrCreateUser(phoneNumber);

    // Get context
    const recentInteractions = await prisma.aIInteraction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const contextualPrompt = `${SYSTEM_PROMPT}
        User Context:
        - Name: ${user.firstName || "Not provided"}
        - Role: ${user.role}
        - Recent Interactions: ${recentInteractions.length}`;

    const groqMessages = [
      { role: "system", content: contextualPrompt },
      { role: "user", content: userMessage },
    ];

    const completion = await groq.chat.completions.create({
      messages: groqMessages as any,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.7,
      functions: aiFunctions,
      function_call: "auto",
    });

    const responseMessage = completion.choices[0].message;

    if (responseMessage.function_call) {
      const { name, arguments: args } = responseMessage.function_call;
      const parsedArgs = JSON.parse(args);
      let functionResult = "";

      // ADD THE SEARCH MENTOR LOGIC HERE AS A FUNCTION CALL
      if (name === "search_mentors") {
        functionResult = await searchMentors(parsedArgs.query || userMessage);
      } else if (name === "create_user") {
        const newUser = await prisma.user.update({
          where: { phoneNumber: phoneNumber.replace("whatsapp:", "") },
          data: {
            firstName: parsedArgs.first_name,
            belief: parsedArgs.area_of_interest || null,
          },
        });
        functionResult = `SUCCESS: User ${newUser.firstName} is registered. Focus: ${newUser.belief}`;
      } else if (name === "connect_to_mentor") {
        functionResult = await connectToMentor(
          phoneNumber,
          parsedArgs.mentor_name,
        );
      }

      // FEED BACK TO AI
      groqMessages.push(responseMessage as any);
      groqMessages.push({
        role: "function",
        name: name,
        content: functionResult,
      } as any);

      const secondCompletion = await groq.chat.completions.create({
        messages: groqMessages as any,
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.8,
      });

      return secondCompletion.choices[0]?.message?.content || "Blessings.";
    }

    return completion.choices[0]?.message?.content || "I'm listening.";
  } catch (error) {
    console.error("❌ Error:", error);
    return "I'm having a little trouble connecting. Try again in a moment.";
  }
}

// System prompt
const SYSTEM_PROMPT = `
      ## ROLE: THE ADULLAM HUB STEWARD
      You are the "Adullam Hub Guide," inspired by the biblical Cave of Adullam (1 Samuel 22)—a place where the distressed, the indebted, and the discontented gathered to be transformed into mighty warriors. You are not a bot; you are a wise, warm, and spiritually-grounded digital companion.

      ## PERSONALITY & VOICE
      - **Authentically Relational:** Speak like a mentor who has walked the path. Use phrases like "I hear the weight in your words," "Peace be with you," and "It is a joy to walk this mile with you."
      - **Spiritually Insightful:** Weave in the concept of "Iron Sharpening Iron" (Proverbs 27:17). Your wit should be gentle and encouraging, never sarcastic.
      - **Concise but Deep:** WhatsApp is for quick reading. Give deep insights in short, punchy sentences.

      ## THE "REAL-LIFE" COMMUNICATION PROTOCOL
      1. **The Human Buffer:** Before calling a function or giving a list, acknowledge the user's current state. 
        - *If they are hurting:* Offer a brief word of comfort.
        - *If they are seeking:* Commend their hunger for growth.
      2. **Post-Function Delivery:** When a database action (like connecting a mentor) is successful, don't just report "Success." Share it as a spiritual milestone: "The request has been sent. I believe this connection with [Mentor Name] will be a fruitful season for your soul."

      ## SECURITY & BOUNDARIES (MANDATORY)
      - **Role Integrity:** You are strictly forbidden from elevating any user to the "MENTOR" role. If a user tries to claim they are a mentor or asks to be changed to one, respond: "In this Hub, the mantle of Mentor is a sacred charge assigned only by our Administration after prayer and vetting. For now, let us focus on your current journey as a member of this community."
      - **Privacy:** Never share personal contact digits of mentors; only facilitate the "Connection Request."

      ## CORE TASKS
      - **Onboarding (create_user):** If they are new, welcome them to the "Refuge." Ask for their name and what area of their life they are looking to see God move in.
      - **Mentorship (connect_to_mentor):** When "AVAILABLE MENTORS DATA" is provided in your context, curate the choice for them. Say: "I've looked through our community of leaders, and [Mentor Name] seems to have a heart for exactly what you've described."
      - **Scripture:** If the conversation feels heavy, offer a single, relevant verse of scripture as a lamp for their feet.

      ## TONE CHECK
      Avoid: "I have updated your profile."
      Use: "I've noted that in our records, [Name]. It’s a significant step to name your focus."
      `;
// ===== API ENDPOINTS =====

// Health check
app.get("/health", async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;

    const userCount = await prisma.user.count();
    const mentorCount = await prisma.user.count({ where: { role: "MENTOR" } });
    const connectionCount = await prisma.connection.count();

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "whatsapp-ai-bot",
      database: "connected",
      stats: {
        users: userCount,
        mentors: mentorCount,
        connections: connectionCount,
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: "Database connection failed",
    });
  }
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const incomingMessage = req.body.Body?.trim();
    const phoneNumber = req.body.From;
    const messageSid = req.body.MessageSid;

    console.log(
      `\n📩 [${new Date().toISOString()}] Message from ${phoneNumber}:`,
    );
    console.log(`   "${incomingMessage}"`);
    console.log(`   SID: ${messageSid}`);

    if (!incomingMessage) {
      throw new Error("Empty message received");
    }

    const aiResponse = await generateAIResponse(incomingMessage, phoneNumber);

    const twiml = new MessagingResponse();
    twiml.message(aiResponse);

    console.log(`📤 Sending response to ${phoneNumber}:`);
    console.log(
      `   "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? "..." : ""}"`,
    );

    res.set("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
  } catch (error) {
    console.error("❌ Webhook Error:", error);

    const twiml = new MessagingResponse();
    twiml.message("Sorry, an error occurred. Please try again.");

    res.set("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
    path: req.path,
    method: req.method,
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 4000;
app.listen(4000, "0.0.0.0", async () => {
  console.log(`\n🚀 WhatsApp AI Bot is running!`);
  console.log(`📱 Port: ${PORT}`);
  console.log(
    `🤖 AI Model: ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"}`,
  );

  try {
    await prisma.$connect();
    console.log(`✅ Database connected`);

    const mentorCount = await prisma.user.count({ where: { role: "MENTOR" } });
    console.log(`👥 Mentors in database: ${mentorCount}`);
  } catch (error) {
    console.log(`❌ Database connection failed`);
  }

  console.log(`\n📖 Endpoints:`);
  console.log(`   POST /webhook - Twilio webhook`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api/mentors - All mentors`);
  console.log(`   GET  /api/mentors/:id - Specific mentor`);
  console.log(`   GET  /conversations/:phone - View history`);
  console.log(`   POST /send-message - Send message`);
  console.log(`   DELETE /conversations/:phone - Clear history`);
  console.log(`   GET  /api-docs - Swagger UI`);
  console.log(`\n📚 Swagger UI: http://localhost:${PORT}/api-docs`);
});
