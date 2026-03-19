import "dotenv/config";
import express from "express";
import cors from "cors";
import twilio from "twilio";
const MessagingResponse = twilio.twiml.MessagingResponse;
import Groq from "groq-sdk";
import swaggerUi from "swagger-ui-express";
import { aiFunctions } from "../ai-functions"; // Make sure path is correct
const swaggerDocument = require("../dist/swagger.json");
import prisma from "./db";

const app = express();

// ===== TYPE DEFINITIONS =====
interface CreateUserArgs {
  first_name: string;
  area_of_interest?: string;
}

interface SearchMentorsArgs {
  query?: string;
  user_interest?: string;
}

interface ConnectToMentorArgs {
  mentor_name: string;
}

type FunctionArgs = CreateUserArgs | SearchMentorsArgs | ConnectToMentorArgs | Record<string, any>;

interface FunctionResult {
  name: string;
  args: FunctionArgs;
  result: string;
}

// Define the AIInteraction type based on your Prisma schema
interface AIInteraction {
  id: string;
  userId: string;
  userMessage: string; // or 'content' or 'message' - adjust based on your schema
  aiResponse: string;
  createdAt: Date;
  [key: string]: any; // for any other fields
}

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

## FUNCTION CALLING FORMAT
When you need to perform an action, respond with the function name and parameters in this exact format:
<function>function_name{"param":"value"}</function>

Available functions:
- create_user: Use when a new user shares their name and spiritual interest. Parameters: {"first_name": "name", "area_of_interest": "interest"}
- search_mentors: Use when a user asks for guidance or mentors. Parameters: {"query": "their need or interest"}
- connect_to_mentor: Use when a user wants to connect with a specific mentor. Parameters: {"mentor_name": "name of mentor"}

Do NOT explain that you're calling a function. Just output the tag and nothing else for that turn.
The system will execute it and you'll get the result to craft a proper response.

## CORE TASKS
- Onboarding: Welcome new members to the "Refuge." Ask for their name and area of spiritual focus, then use create_user function.
- Mentorship: When users seek guidance, use 'search_mentors' to find guides.
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

  if (!mentee) return "Error: User not found.";

  await prisma.connection.create({
    data: { mentorId: mentor.id, menteeId: mentee.id, status: "PENDING" }
  });

  return `SUCCESS: Connection request sent to ${mentor.firstName}. They will be notified.`;
}

// ===== FUNCTION PARSING AND EXECUTION =====

async function parseAndExecuteFunctions(
  responseContent: string, 
  phoneNumber: string, 
  userMessage: string
): Promise<{ text: string; functionCalls: FunctionResult[] }> {
  // Regular expression to find <function> tags
  const functionTagRegex = /<function>(\w+)(\{.*?\})?<\/function>/g;
  let match;
  let lastIndex = 0;
  let functionResults: FunctionResult[] = [];
  let textParts: string[] = [];

  // Find all function calls
  while ((match = functionTagRegex.exec(responseContent)) !== null) {
    // Add text before the function tag
    if (match.index > lastIndex) {
      textParts.push(responseContent.substring(lastIndex, match.index));
    }
    
    const functionName = match[1];
    let functionArgs: FunctionArgs = {};
    
    try {
      // Parse the JSON if it exists
      if (match[2]) {
        functionArgs = JSON.parse(match[2]);
      }
    } catch (e) {
      console.error("Failed to parse function args:", e);
    }
    
    // Execute the function with type assertions
    let functionResult = "";
    
    if (functionName === "create_user") {
      const args = functionArgs as CreateUserArgs;
      await prisma.user.update({
        where: { phoneNumber: phoneNumber.replace("whatsapp:", "") },
        data: { 
          firstName: args.first_name, 
          belief: args.area_of_interest 
        }
      });
      functionResult = "User registration successful.";
    } 
    else if (functionName === "search_mentors") {
      const args = functionArgs as SearchMentorsArgs;
      const query = args.query || args.user_interest || userMessage;
      functionResult = await searchMentors(query);
    } 
    else if (functionName === "connect_to_mentor") {
      const args = functionArgs as ConnectToMentorArgs;
      functionResult = await connectToMentor(phoneNumber, args.mentor_name);
    } 
    else {
      functionResult = `Unknown function: ${functionName}`;
    }
    
    functionResults.push({
      name: functionName,
      args: functionArgs,
      result: functionResult
    });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < responseContent.length) {
    textParts.push(responseContent.substring(lastIndex));
  }
  
  return {
    text: textParts.join('').trim(),
    functionCalls: functionResults
  };
}

// ===== AI CORE =====

async function generateAIResponse(userMessage: string, phoneNumber: string): Promise<string> {
  try {
    const user = await getOrCreateUser(phoneNumber);
    
    // Get recent interactions for context - fix the field names based on your schema
    const recentInteractions = await prisma.aIInteraction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    // Build conversation history
    const groqMessages: any[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\nUser Context: Name: ${user.firstName || "New"}, Role: ${user.role}` },
    ];
    
    // Add recent interactions - use type assertion to handle unknown fields
    recentInteractions.reverse().forEach((interaction: any) => {
      // Try to determine the correct field names
      // Common field names: 'userMessage', 'message', 'content', 'prompt'
      const userMsg = interaction.userMessage || interaction.message || interaction.content || interaction.prompt || "";
      const aiMsg = interaction.aiResponse || interaction.response || interaction.reply || interaction.answer || "";
      
      if (userMsg) {
        groqMessages.push({ role: "user", content: userMsg });
      }
      if (aiMsg) {
        groqMessages.push({ role: "assistant", content: aiMsg });
      }
    });
    
    // Add current message
    groqMessages.push({ role: "user", content: userMessage });

    // First call to get AI response (which might contain function tags)
    const completion = await groq.chat.completions.create({
      messages: groqMessages,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 500,
    });

    const responseContent = completion.choices[0].message.content || "";
    
    // Parse and execute any function calls in the response
    const { text, functionCalls } = await parseAndExecuteFunctions(responseContent, phoneNumber, userMessage);
    
    // If there were function calls, we need a second response to acknowledge the result
    if (functionCalls.length > 0) {
      // Build context with function results
      const functionContext = functionCalls.map(fc => 
        `Function ${fc.name} executed. Result: ${fc.result}`
      ).join('\n');
      
      // Second call to get a human-friendly response
      groqMessages.push({ 
        role: "assistant", 
        content: text || `[Calling ${functionCalls.map(fc => fc.name).join(', ')}]` 
      });
      
      groqMessages.push({ 
        role: "user", 
        content: `The function(s) were executed with these results:\n${functionContext}\n\nNow provide a warm, spiritual response to the user based on these results. Be encouraging and personal. Do not mention the function calls or technical details.` 
      });
      
      const finalCompletion = await groq.chat.completions.create({
        messages: groqMessages,
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature: 0.7,
      });
      
      const finalResponse = finalCompletion.choices[0].message.content || "Blessings on your journey.";
      
      // Save the interaction to database - use the correct field names
      await prisma.aIInteraction.create({
        data: {
          userId: user.id,
          userMessage: userMessage, // Adjust field name if needed
          aiResponse: finalResponse, // Adjust field name if needed
        } as any // Use type assertion if field names don't match
      });
      
      return finalResponse;
    }
    
    // No function calls, just return the response
    const finalResponse = responseContent || "I am listening.";
    
    // Save the interaction - use the correct field names
    await prisma.aIInteraction.create({
      data: {
        userId: user.id,
        userMessage: userMessage, // Adjust field name if needed
        aiResponse: finalResponse, // Adjust field name if needed
      } as any // Use type assertion if field names don't match
    });
    
    return finalResponse;
    
  } catch (err) {
    console.error("Error in generateAIResponse:", err);
    return "The Hub is a bit quiet. Let's try again in a moment. Peace be with you.";
  }
}

// ===== WEBHOOK =====

app.post("/webhook", async (req, res) => {
  try {
    const incomingMessage = req.body.Body?.trim();
    const phoneNumber = req.body.From;
    const mediaUrl = req.body.MediaUrl0; // For handling images if needed

    if (!incomingMessage) {
      const twiml = new MessagingResponse();
      twiml.message("I didn't catch that. How can I support you today?");
      res.set("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    console.log(`📨 Message from ${phoneNumber}: ${incomingMessage}`);
    
    const aiResponse = await generateAIResponse(incomingMessage, phoneNumber);
    
    const twiml = new MessagingResponse();
    twiml.message(aiResponse);

    res.set("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
    
  } catch (error) {
    console.error("Webhook error:", error);
    const twiml = new MessagingResponse();
    twiml.message("The Refuge is experiencing a moment of silence. Please try again shortly.");
    res.set("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Adullam Hub is running" });
});

const PORT = process.env.PORT || 4000;
app.listen(4000, "0.0.0.0", () => console.log(`🚀 Adullam Hub running on port ${PORT}`));