// services/ai-user.service.ts
import prisma from '../src/db';

export interface AICreateUserParams {
  first_name: string;
  phone_number: string;
  role: 'mentor' | 'mentee';
  email?: string;
  last_name?: string;
}

export interface AIConnectMentorParams {
  menteeId: string;
  mentorId: string;
}

export class AIUserService {
  // Called by AI to create a user
  static async createUser(params: AICreateUserParams) {
    try {
      const user = await prisma.user.create({
        data: {
          firstName: params.first_name,
          lastName: params.last_name,
          phoneNumber: params.phone_number,
          email: params.email,
          role: params.role === 'mentor' ? 'MENTOR' : 'USER',
          createdAt: new Date(),
        }
      });
      
      return {
        success: true,
        userId: user.id,
        message: `User ${params.first_name} created successfully as a ${params.role}`
      };
    } catch (error: any) {
      console.error("AI User creation failed:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Called by AI to connect mentee to mentor
  static async connectToMentor(params: AIConnectMentorParams) {
    try {
      // Update mentee with mentorId
      const updatedMentee = await prisma.user.update({
        where: { id: params.menteeId },
        data: { mentorId: params.mentorId }
      });
      
      return {
        success: true,
        message: `Mentee connected to mentor successfully`,
        connection: updatedMentee
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper for AI to find available mentors
  static async findAvailableMentors() {
    const mentors = await prisma.user.findMany({
      where: { role: 'MENTOR' }
    });
    return mentors;
  }
}