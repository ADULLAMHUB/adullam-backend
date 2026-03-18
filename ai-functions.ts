// lib/ai-functions.ts
export const aiFunctions = [
  {
    name: "create_user",
    description: "Create a new user (mentor or mentee) in the system",
    parameters: {
      type: "object",
      properties: {
        first_name: {
          type: "string",
          description: "The user's first name"
        },
        last_name: {
          type: "string",
          description: "The user's last name (optional)"
        },
        phone_number: {
          type: "string",
          description: "The user's phone number"
        },
        email: {
          type: "string",
          description: "The user's email address (optional)"
        },
        role: {
          type: "string",
          enum: ["mentor", "mentee"],
          description: "Whether the user is a mentor or mentee"
        }
      },
      required: ["first_name", "phone_number", "role"]
    }
  },
  {
    name: "connect_to_mentor",
    description: "Connect a mentee to an existing mentor",
    parameters: {
      type: "object",
      properties: {
        menteeId: {
          type: "string",
          description: "The ID of the mentee user"
        },
        mentorId: {
          type: "string",
          description: "The ID of the mentor user"
        }
      },
      required: ["menteeId", "mentorId"]
    }
  },
  {
    name: "find_mentors",
    description: "Find available mentors in the system",
    parameters: {
      type: "object",
      properties: {}, // No parameters needed
    }
  }
];