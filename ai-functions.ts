export const aiFunctions = [
  {
    name: "create_user",
    description: "Register a new member name and spiritual interest.",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        area_of_interest: { type: "string", description: "e.g., healing, career, faith" }
      },
      required: ["first_name"]
    }
  },
  {
    name: "search_mentors",
    description: "Find mentors based on a query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" }
      }
    }
  },
  {
    name: "connect_to_mentor",
    description: "Connect a user to a specific mentor by name.",
    parameters: { 
      type: "object",
      properties: {
        mentor_name: { type: "string" }
      },
      required: ["mentor_name"]
    }
  }
];