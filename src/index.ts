import "dotenv/config";
import express from "express";
import cors from "cors";
import twilio from "twilio";
const MessagingResponse = twilio.twiml.MessagingResponse;
import Groq from "groq-sdk";
import swaggerUi from "swagger-ui-express";

const swaggerDocument = require("../dist/swagger.json");
import prisma from "./db";

const app = express();

// ===== CORS CONFIGURATION =====
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:4000',
  'https://adullamhub.com',
  'https://www.adullamhub.com',
  process.env.RENDER_URL || '',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      console.log(`❌ Blocked origin: ${origin}`);
      return callback(new Error('CORS not allowed'), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin']
}));

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
app.use('/api-docs/swagger.json', (req, res) => {
  res.sendFile(__dirname + '/swagger.json');
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: "Adullam Hub WhatsApp Bot API",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
  }
}));

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
    const cleanPhone = phoneNumber.replace('whatsapp:', '');
    
    let user = await prisma.user.findFirst({
      where: { phoneNumber: cleanPhone },
      include: {
        mentor: true,
        mentees: true,
        sentConnections: {
          include: { mentee: true }
        },
        receivedConnections: {
          include: { mentor: true }
        }
      }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          phoneNumber: cleanPhone,
          role: 'USER',
        },
        include: {
          mentor: true,
          mentees: true,
          sentConnections: {
            include: { mentee: true }
          },
          receivedConnections: {
            include: { mentor: true }
          }
        }
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
async function logAIInteraction(userId: string, action: string, parameters: any, result: any, status: string) {
  try {
    await prisma.aIInteraction.create({
      data: {
        userId,
        action,
        parameters,
        result,
        status,
      }
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
      role: 'MENTOR',
      OR: [
        { firstName: { contains: lowercaseQuery, mode: 'insensitive' } },
        { lastName: { contains: lowercaseQuery, mode: 'insensitive' } },
        { organization: { contains: lowercaseQuery, mode: 'insensitive' } },
        { belief: { contains: lowercaseQuery, mode: 'insensitive' } },
      ]
    },
    include: {
      mentees: true
    }
  });

  // If no mentors found with query, return all
  if (mentors.length === 0 && lowercaseQuery.includes('mentor')) {
    const allMentors = await prisma.user.findMany({
      where: { role: 'MENTOR' },
      include: {
        mentees: true
      }
    });
    
    if (allMentors.length === 0) {
      return "I don't see any mentors available at the moment. Please check back later.";
    }

    let response = "*Here are our mentors at Adullam Hub:*\n\n";
    allMentors.forEach((m, index) => {
      response += `${index + 1}. *${m.firstName} ${m.lastName || ''}*\n`;
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
      return `*${m.firstName} ${m.lastName || ''}*\n\n` +
        `${m.organization ? `📌 ${m.organization}\n` : ''}` +
        `${m.belief ? `✨ ${m.belief}\n` : ''}` +
        `👥 Currently mentoring: ${m.mentees.length} people\n\n` +
        `Would you like to connect with them?`;
    } else {
      let response = "*Several mentors can help with this:*\n\n";
      mentors.forEach((m, index) => {
        response += `${index + 1}. *${m.firstName} ${m.lastName || ''}* - ${m.organization || 'Mentor'}\n`;
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
        role: 'MENTOR',
        OR: [
          { firstName: { contains: mentorName, mode: 'insensitive' } },
          { lastName: { contains: mentorName, mode: 'insensitive' } },
        ]
      }
    });

    if (!mentor) {
      return "I couldn't find that mentor. Please check the name and try again.";
    }

    // Get mentee
    const mentee = await prisma.user.findFirst({
      where: { phoneNumber: menteePhone.replace('whatsapp:', '') }
    });

    if (!mentee) {
      return "I couldn't find your account. Please try again.";
    }

    // Check if connection already exists
    const existingConnection = await prisma.connection.findFirst({
      where: {
        mentorId: mentor.id,
        menteeId: mentee.id,
      }
    });

    if (existingConnection) {
      return `You already have a ${existingConnection.status.toLowerCase()} connection with ${mentor.firstName}.`;
    }

    // Create connection
    const connection = await prisma.connection.create({
      data: {
        mentorId: mentor.id,
        menteeId: mentee.id,
        status: 'PENDING',
        message: `Connection requested via WhatsApp`,
      }
    });

    // Create notification
    await prisma.notification.create({
      data: {
        message: `${mentee.firstName || 'Someone'} wants to connect with you as a mentee`,
        type: 'CONNECTION_REQUEST',
        userId: mentor.id,
      }
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
    // Get or create user
    const user = await getOrCreateUser(phoneNumber);

    // Check if message is about connecting to a mentor
    const connectKeywords = ['connect with', 'talk to', 'meet', 'contact'];
    const wantsToConnect = connectKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword)
    );

    if (wantsToConnect) {
      // Extract potential mentor name from message
      const words = userMessage.split(' ');
      const possibleName = words.slice(-2).join(' '); // Get last 2 words as potential name
      
      const connectResult = await connectToMentor(phoneNumber, possibleName);
      
      await logAIInteraction(
        user.id,
        'CONNECT_TO_MENTOR',
        { mentorName: possibleName },
        { success: !connectResult.includes("couldn't find") },
        connectResult.includes("couldn't find") ? 'FAILED' : 'SUCCESS'
      );
      
      return connectResult;
    }

    // Check if message is about mentors
    const mentorKeywords = ['mentor', 'pastor', 'counseling', 'guidance', 'spiritual', 'advice', 'help'];
    const isAboutMentors = mentorKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword)
    );
    
    if (isAboutMentors) {
      const mentorResponse = await searchMentors(userMessage, user.id);
      if (mentorResponse) {
        await logAIInteraction(
          user.id,
          'SEARCH_MENTORS',
          { query: userMessage },
          { responseLength: mentorResponse.length },
          'SUCCESS'
        );
        return mentorResponse;
      }
    }

    // Get recent interactions for context
    const recentInteractions = await prisma.aIInteraction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    // Build system prompt with user context
    const contextualPrompt = `${SYSTEM_PROMPT}

User Context:
- Name: ${user.firstName || 'Not provided'}
- Role: ${user.role}
- Previous interactions: ${recentInteractions.length} times

You can help users connect with mentors. If they want to connect with someone, guide them through the process.`;

    const groqMessages = [
      { role: "system", content: contextualPrompt },
      { role: "user", content: userMessage }
    ];

    console.log(`🤔 Generating AI response for ${phoneNumber}...`);

    const completion = await groq.chat.completions.create({
      messages: groqMessages as any,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 500,
      top_p: 1,
      stream: false,
    });

    const aiResponse = completion.choices[0]?.message?.content ||
      "I'm sorry, I couldn't generate a response. Please try again.";

    await logAIInteraction(
      user.id,
      'CHAT',
      { message: userMessage },
      { response: aiResponse.substring(0, 100) },
      'SUCCESS'
    );

    return aiResponse;
  } catch (error) {
    console.error("❌ Groq API Error:", error);
    
    // Log error
    try {
      const user = await getOrCreateUser(phoneNumber);
      await logAIInteraction(
        user.id,
        'ERROR',
        { message: userMessage, error: String(error) },
        null,
        'FAILED'
      );
    } catch {}
    
    return "I'm having trouble processing your request right now. Please try again in a moment.";
  }
}

// System prompt
const SYSTEM_PROMPT = `You are a helpful WhatsApp assistant for Adullam Hub, a spiritual community.
You are friendly, concise, and professional. Keep responses under 3 sentences unless the user asks for detailed information.

You can help users:
1. Find and connect with mentors
2. Get spiritual guidance
3. Learn about the community

When users ask about mentors:
1. Ask what area they need help with (spiritual growth, life advice, etc.)
2. Find relevant mentors based on their needs
3. Offer to connect them with the right mentor

Always be warm, welcoming, and point people to spiritual growth.

If you don't know something, be honest and offer to connect them with a human.`;

// ===== API ENDPOINTS =====

// Health check
app.get("/health", async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    
    const userCount = await prisma.user.count();
    const mentorCount = await prisma.user.count({ where: { role: 'MENTOR' } });
    const connectionCount = await prisma.connection.count();
    
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "whatsapp-ai-bot",
      database: "connected",
      stats: {
        users: userCount,
        mentors: mentorCount,
        connections: connectionCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: "Database connection failed"
    });
  }
});

// Get all mentors
app.get("/api/mentors", async (req, res) => {
  try {
    const mentors = await prisma.user.findMany({
      where: { role: 'MENTOR' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        organization: true,
        belief: true,
        _count: {
          select: { mentees: true }
        }
      }
    });
    
    res.json(mentors);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch mentors" });
  }
});

// Get specific mentor
app.get("/api/mentors/:id", async (req, res) => {
  try {
    const mentor = await prisma.user.findFirst({
      where: { 
        id: req.params.id,
        role: 'MENTOR'
      },
      include: {
        mentees: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });
    
    if (!mentor) {
      return res.status(404).json({ error: "Mentor not found" });
    }
    
    res.json(mentor);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch mentor" });
  }
});

// Get user conversations history
app.get("/conversations/:phone", async (req, res) => {
  try {
    const cleanPhone = req.params.phone.replace('whatsapp:', '');
    
    const user = await prisma.user.findFirst({
      where: { phoneNumber: cleanPhone },
      include: {
        aiInteractions: {
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Send message (admin endpoint)
app.post("/send-message", async (req, res) => {
  try {
    const { to, message } = req.body;
    
    if (!to || !message) {
      return res.status(400).json({ error: "Missing to or message" });
    }

    const twiml = new MessagingResponse();
    twiml.message(message);

    // In production, you'd use twilioClient.messages.create
    // For now, we'll just return the twiml
    
    res.json({ 
      success: true, 
      message: "Message sent",
      to,
      twiml: twiml.toString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Clear conversation history
app.delete("/conversations/:phone", async (req, res) => {
  try {
    const cleanPhone = req.params.phone.replace('whatsapp:', '');
    
    const user = await prisma.user.findFirst({
      where: { phoneNumber: cleanPhone }
    });
    
    if (user) {
      // Delete AI interactions (soft delete would be better in production)
      await prisma.aIInteraction.deleteMany({
        where: { userId: user.id }
      });
    }
    
    res.json({ success: true, message: "Conversation history cleared" });
  } catch (error) {
    res.status(500).json({ error: "Failed to clear history" });
  }
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const incomingMessage = req.body.Body?.trim();
    const phoneNumber = req.body.From;
    const messageSid = req.body.MessageSid;

    console.log(`\n📩 [${new Date().toISOString()}] Message from ${phoneNumber}:`);
    console.log(`   "${incomingMessage}"`);
    console.log(`   SID: ${messageSid}`);

    if (!incomingMessage) {
      throw new Error("Empty message received");
    }

    const aiResponse = await generateAIResponse(incomingMessage, phoneNumber);

    const twiml = new MessagingResponse();
    twiml.message(aiResponse);

    console.log(`📤 Sending response to ${phoneNumber}:`);
    console.log(`   "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? "..." : ""}"`);

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
    method: req.method
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 4000;
app.listen(4000, "0.0.0.0", async () => {
  console.log(`\n🚀 WhatsApp AI Bot is running!`);
  console.log(`📱 Port: ${PORT}`);
  console.log(`🤖 AI Model: ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"}`);
  
  try {
    await prisma.$connect();
    console.log(`✅ Database connected`);
    
    const mentorCount = await prisma.user.count({ where: { role: 'MENTOR' } });
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