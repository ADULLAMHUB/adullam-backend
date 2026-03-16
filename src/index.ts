import "dotenv/config";
import express from "express";
import cors from "cors";
import twilio from "twilio";
const MessagingResponse = twilio.twiml.MessagingResponse;
import Groq from "groq-sdk";

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Initialize Twilio client (for sending proactive messages)
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

// In-memory conversation history (replace with Redis in production)
interface Conversation {
  phoneNumber: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
  }>;
  lastActivity: Date;
}

const conversations: Map<string, Conversation> = new Map();

// Enhanced mentors array with more details
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

// System prompt with mentor information
const SYSTEM_PROMPT = `You are a helpful WhatsApp assistant for Adullam Hub, a spiritual community.
You are friendly, concise, and professional. Keep responses under 3 sentences unless the user asks for detailed information.

Here is our list of mentors available at Adullam Hub:
${mentors.map(m => `- ${m.name} (${m.title}): ${m.bio}`).join('\n')}

When users ask about mentors, spiritual guidance, or counseling:
1. If they ask generally about mentors, list all available mentors
2. If they ask about a specific mentor by name, provide that person's details
3. If they mention an area of interest (teens, marriage, evangelism), suggest relevant mentors
4. Always offer to connect them with the appropriate mentor

For example:
- "I need guidance" → Suggest relevant mentors based on their situation
- "Tell me about Pastor Adebisis" → Share his details
- "I need marriage counseling" → Suggest Femi Lazarus
- "Who are your mentors?" → List all mentors

Remember to be warm, welcoming, and always point people to spiritual growth.

You help with:
- Answering questions about Adullam Hub services
- Providing information about mentors and their areas
- Engaging in friendly conversation
- Directing users to appropriate spiritual resources

If you don't know something, be honest and offer to connect them with a human.`;

/**
 * Search for mentors based on user query
 */
function searchMentors(query: string): string {
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
  const nameMatch = mentors.find(m => 
    m.name.toLowerCase().includes(lowercaseQuery) ||
    lowercaseQuery.includes(m.name.toLowerCase().split(' ')[0])
  );
  
  if (nameMatch) {
    return `*${nameMatch.name}* (${nameMatch.title})\n\n📌 ${nameMatch.bio}\n✨ Areas of expertise: ${nameMatch.expertise.join(", ")}\n\nWould you like to connect with ${nameMatch.name.split(' ')[0]}? I can help arrange a meeting.`;
  }
  
  // Search by expertise
  const expertiseMatches = mentors.filter(m =>
    m.expertise.some(e => lowercaseQuery.includes(e.toLowerCase())) ||
    lowercaseQuery.includes(m.title.toLowerCase())
  );
  
  if (expertiseMatches.length > 0) {
    if (expertiseMatches.length === 1) {
      const m = expertiseMatches[0];
      return `*${m.name}* specializes in this area. ${m.bio}\n\nWould you like to connect with them?`;
    } else {
      let response = "*Several mentors can help with this:*\n\n";
      expertiseMatches.forEach((m, index) => {
        response += `${index + 1}. *${m.name}* - ${m.title}\n   ✨ ${m.expertise.join(", ")}\n`;
      });
      response += "\n_Which mentor would you like to learn more about?_";
      return response;
    }
  }
  
  return ""; // No matches found
}

/**
 * Generate AI response using Groq
 */
async function generateAIResponse(
  userMessage: string,
  phoneNumber: string,
): Promise<string> {
  try {
    // Check if message is about mentors
    const mentorKeywords = ['mentor', 'pastor', 'counseling', 'guidance', 'spiritual', 'advice', 'help with', 'talk to'];
    const isAboutMentors = mentorKeywords.some(keyword => 
      userMessage.toLowerCase().includes(keyword)
    );
    
    // If it's about mentors, search first
    if (isAboutMentors) {
      const mentorResponse = searchMentors(userMessage);
      if (mentorResponse) {
        // Store in conversation history
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

    // Get or create conversation history for AI response
    let conversation = conversations.get(phoneNumber);

    if (!conversation) {
      conversation = {
        phoneNumber,
        messages: [],
        lastActivity: new Date(),
      };
      conversations.set(phoneNumber, conversation);
    }

    // Add user message to history
    conversation.messages.push({
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    });

    // Keep only last 10 messages for context
    const recentMessages = conversation.messages.slice(-10);

    // Prepare messages for Groq
    const groqMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...recentMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    ] as any;

    console.log(`🤔 Generating AI response for ${phoneNumber}...`);

    // Call Groq API
    const completion = await groq.chat.completions.create({
      messages: groqMessages,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 500, // Increased for mentor responses
      top_p: 1,
      stream: false,
    });

    const aiResponse =
      completion.choices[0]?.message?.content ||
      "I'm sorry, I couldn't generate a response. Please try again.";

    // Add AI response to history
    conversation.messages.push({
      role: "assistant",
      content: aiResponse,
      timestamp: new Date(),
    });

    conversation.lastActivity = new Date();

    console.log(`✅ AI response generated (${aiResponse.length} chars)`);

    return aiResponse;
  } catch (error) {
    console.error("❌ Groq API Error:", error);
    return "I'm having trouble processing your request right now. Please try again in a moment.";
  }
}

// ... (rest of your code remains the same - webhook, health check, etc.)
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

    // Generate AI response
    const aiResponse = await generateAIResponse(incomingMessage, phoneNumber);

    // Create Twilio response
    const twiml = new MessagingResponse();
    twiml.message(aiResponse);

    console.log(`📤 Sending response to ${phoneNumber}:`);
    console.log(
      `   "${aiResponse.substring(0, 100)}${aiResponse.length > 100 ? "..." : ""}"`,
    );

    // Send response
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
/**
 * New endpoint to get all mentors
 */
app.get("/api/mentors", (req, res) => {
  res.json({
    count: mentors.length,
    mentors: mentors
  });
});

/**
 * New endpoint to get a specific mentor
 */
app.get("/api/mentors/:id", (req, res) => {
  const mentor = mentors.find(m => m.id === parseInt(req.params.id));
  if (!mentor) {
    return res.status(404).json({ error: "Mentor not found" });
  }
  res.json(mentor);
});

// Start server
const PORT = process.env.PORT || 4000;
app.listen(4000, "0.0.0.0", () => {
  console.log(`\n🚀 WhatsApp AI Bot is running!`);
  console.log(`📱 Port: ${PORT}`);
  console.log(`🤖 AI Model: ${process.env.GROQ_MODEL || "llama-3.3-70b-versatile"}`);
  console.log(`👥 Mentors available: ${mentors.length}`);
  console.log(`\n📖 Endpoints:`);
  console.log(`   POST /webhook - Twilio webhook for incoming messages`);
  console.log(`   GET  /health - Health check`);
  console.log(`   GET  /api/mentors - Get all mentors`);
  console.log(`   GET  /api/mentors/:id - Get specific mentor`);
  console.log(`   GET  /conversations/:phone - View conversation history`);
  console.log(`   POST /send-message - Send proactive message`);
  console.log(`   DELETE /conversations/:phone - Clear conversation`);
  console.log(`\n🌐 Public URL (for Twilio webhook):`);
  console.log(`   https://your-ngrok-url.ngrok.io/webhook`);
  console.log(
    `\n💬 Test by sending a WhatsApp message to your sandbox number!\n`,
  );
});