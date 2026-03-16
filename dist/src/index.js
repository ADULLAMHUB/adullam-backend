"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const twilio_1 = __importDefault(require("twilio"));
const MessagingResponse = twilio_1.default.twiml.MessagingResponse;
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_json_1 = __importDefault(require("../dist/swagger.json")); // Make sure this path is correct
const app = (0, express_1.default)();
// ===== CORS CONFIGURATION =====
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:4000',
    'https://adullamhub.com',
    'https://www.adullamhub.com',
    process.env.RENDER_URL || '',
].filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, postman, twilio)
        if (!origin)
            return callback(null, true);
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
// Handle preflight requests
app.options('*', (0, cors_1.default)());
// ===== MIDDLEWARE =====
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Request logging
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.url}`);
    next();
});
// ===== SWAGGER DOCS =====
// Serve swagger.json statically
app.use('/api-docs/swagger.json', (req, res) => {
    res.sendFile(__dirname + '/swagger.json');
});
// Setup swagger UI
app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_json_1.default, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: "Adullam Hub WhatsApp Bot API",
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
    }
}));
console.log(`📚 Swagger UI available at /api-docs`);
// Initialize Groq
const groq = new groq_sdk_1.default({
    apiKey: process.env.GROQ_API_KEY,
});
// Initialize Twilio client
const twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const conversations = new Map();
// Enhanced mentors array
const mentors = [
    {
        id: 1,
        name: "Pastor Adebisis Ikotun",
        title: "Lead Teens Pastor",
        expertise: ["Youth mentorship", "Spiritual guidance", "Teen counseling"],
        bio: "Experienced in guiding teenagers through spiritual and life challenges"
    },
    {
        id: 2,
        name: "Femi Lazarus",
        title: "Pastor",
        expertise: ["Biblical teaching", "Marriage counseling", "Leadership"],
        bio: "Passionate about teaching scripture and building strong relationships"
    },
    {
        id: 3,
        name: "Joshua Selman",
        title: "Evangelist",
        expertise: ["Evangelism", "Spiritual growth", "Prayer ministry"],
        bio: "Dedicated to spreading the gospel and spiritual development"
    },
];
// System prompt
const SYSTEM_PROMPT = `You are a helpful WhatsApp assistant for Adullam Hub, a spiritual community.
You are friendly, concise, and professional. Keep responses under 3 sentences unless the user asks for detailed information.

Here is our list of mentors available at Adullam Hub:
${mentors.map(m => `- ${m.name} (${m.title}): ${m.bio}`).join('\n')}

When users ask about mentors, spiritual guidance, or counseling:
1. If they ask generally about mentors, list all available mentors
2. If they ask about a specific mentor by name, provide that person's details
3. If they mention an area of interest (teens, marriage, evangelism), suggest relevant mentors
4. Always offer to connect them with the appropriate mentor

Remember to be warm, welcoming, and always point people to spiritual growth.

If you don't know something, be honest and offer to connect them with a human.`;
/**
 * Search for mentors based on user query
 */
function searchMentors(query) {
    const lowercaseQuery = query.toLowerCase();
    // Check if asking for all mentors
    const listKeywords = ['list', 'all', 'who are', 'mentors available', 'show me'];
    const wantsAllMentors = listKeywords.some(keyword => lowercaseQuery.includes(keyword));
    if (wantsAllMentors) {
        let response = "*Here are our mentors at Adullam Hub:*\n\n";
        mentors.forEach((m, index) => {
            response += `${index + 1}. *${m.name}* - ${m.title}\n   📌 ${m.bio}\n   ✨ Expertise: ${m.expertise.join(", ")}\n\n`;
        });
        response += "_Would you like more information about any specific mentor?_";
        return response;
    }
    // Search by name
    const nameMatch = mentors.find(m => m.name.toLowerCase().includes(lowercaseQuery) ||
        lowercaseQuery.includes(m.name.toLowerCase().split(' ')[0]));
    if (nameMatch) {
        return `*${nameMatch.name}* (${nameMatch.title})\n\n📌 ${nameMatch.bio}\n✨ Areas of expertise: ${nameMatch.expertise.join(", ")}\n\nWould you like to connect with ${nameMatch.name.split(' ')[0]}? I can help arrange a meeting.`;
    }
    // Search by expertise
    const expertiseMatches = mentors.filter(m => m.expertise.some(e => lowercaseQuery.includes(e.toLowerCase())) ||
        lowercaseQuery.includes(m.title.toLowerCase()));
    if (expertiseMatches.length > 0) {
        if (expertiseMatches.length === 1) {
            const m = expertiseMatches[0];
            return `*${m.name}* specializes in this area. ${m.bio}\n\nWould you like to connect with them?`;
        }
        else {
            let response = "*Several mentors can help with this:*\n\n";
            expertiseMatches.forEach((m, index) => {
                response += `${index + 1}. *${m.name}* - ${m.title}\n   ✨ ${m.expertise.join(", ")}\n`;
            });
            response += "\n_Which mentor would you like to learn more about?_";
            return response;
        }
    }
    return "";
}
/**
 * Generate AI response using Groq
 */
async function generateAIResponse(userMessage, phoneNumber) {
    try {
        // Check if message is about mentors
        const mentorKeywords = ['mentor', 'pastor', 'counseling', 'guidance', 'spiritual', 'advice', 'help with', 'talk to'];
        const isAboutMentors = mentorKeywords.some(keyword => userMessage.toLowerCase().includes(keyword));
        // If it's about mentors, search first
        if (isAboutMentors) {
            const mentorResponse = searchMentors(userMessage);
            if (mentorResponse) {
                let conversation = conversations.get(phoneNumber);
                if (!conversation) {
                    conversation = {
                        phoneNumber,
                        messages: [],
                        lastActivity: new Date(),
                    };
                    conversations.set(phoneNumber, conversation);
                }
                conversation.messages.push({
                    role: "user",
                    content: userMessage,
                    timestamp: new Date(),
                });
                conversation.messages.push({
                    role: "assistant",
                    content: mentorResponse,
                    timestamp: new Date(),
                });
                return mentorResponse;
            }
        }
        // Get or create conversation history
        let conversation = conversations.get(phoneNumber);
        if (!conversation) {
            conversation = {
                phoneNumber,
                messages: [],
                lastActivity: new Date(),
            };
            conversations.set(phoneNumber, conversation);
        }
        conversation.messages.push({
            role: "user",
            content: userMessage,
            timestamp: new Date(),
        });
        const recentMessages = conversation.messages.slice(-10);
        const groqMessages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...recentMessages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            })),
        ];
        console.log(`🤔 Generating AI response for ${phoneNumber}...`);
        const completion = await groq.chat.completions.create({
            messages: groqMessages,
            model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 500,
            top_p: 1,
            stream: false,
        });
        const aiResponse = completion.choices[0]?.message?.content ||
            "I'm sorry, I couldn't generate a response. Please try again.";
        conversation.messages.push({
            role: "assistant",
            content: aiResponse,
            timestamp: new Date(),
        });
        conversation.lastActivity = new Date();
        console.log(`✅ AI response generated (${aiResponse.length} chars)`);
        return aiResponse;
    }
    catch (error) {
        console.error("❌ Groq API Error:", error);
        return "I'm having trouble processing your request right now. Please try again in a moment.";
    }
}
// ===== HEALTH CHECK =====
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "whatsapp-ai-bot",
        activeConversations: conversations.size,
        model: process.env.GROQ_MODEL,
    });
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
    }
    catch (error) {
        console.error("❌ Webhook Error:", error);
        const twiml = new MessagingResponse();
        twiml.message("Sorry, an error occurred. Please try again.");
        res.set("Content-Type", "text/xml");
        res.status(200).send(twiml.toString());
    }
});
// ===== MENTOR ENDPOINTS =====
app.get("/api/mentors", (req, res) => {
    res.json({
        count: mentors.length,
        mentors: mentors
    });
});
app.get("/api/mentors/:id", (req, res) => {
    const mentor = mentors.find(m => m.id === parseInt(req.params.id));
    if (!mentor) {
        return res.status(404).json({ error: "Mentor not found" });
    }
    res.json(mentor);
});
// ===== CONVERSATION ENDPOINTS =====
app.get("/conversations/:phoneNumber", (req, res) => {
    const phoneNumber = req.params.phoneNumber;
    const conversation = conversations.get(phoneNumber);
    if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
    }
    res.json({
        phoneNumber: conversation.phoneNumber,
        lastActivity: conversation.lastActivity,
        messageCount: conversation.messages.length,
        messages: conversation.messages.map((m) => ({
            role: m.role,
            content: m.content.substring(0, 100) + (m.content.length > 100 ? "..." : ""),
            timestamp: m.timestamp,
        })),
    });
});
app.post("/send-message", async (req, res) => {
    try {
        const { to, message } = req.body;
        if (!to || !message) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const result = await twilioClient.messages.create({
            from: process.env.TWILIO_SANDBOX_NUMBER || "whatsapp:+14155238886",
            to: `whatsapp:${to}`,
            body: message,
        });
        res.json({
            success: true,
            messageSid: result.sid,
        });
    }
    catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ error: "Failed to send message" });
    }
});
app.delete("/conversations/:phoneNumber", (req, res) => {
    const phoneNumber = req.params.phoneNumber;
    const deleted = conversations.delete(phoneNumber);
    res.json({
        success: deleted,
        message: deleted ? "Conversation cleared" : "Conversation not found",
    });
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
app.listen(4000, "0.0.0.0", () => {
    console.log(`\n🚀 WhatsApp AI Bot is running!`);
    console.log(`📱 Port: ${PORT}`);
    console.log(`🤖 AI Model: ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"}`);
    console.log(`👥 Mentors available: ${mentors.length}`);
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
