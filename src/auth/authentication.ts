import { Request } from "express";
import jwt from "jsonwebtoken";
import prisma from "../db.js";

export async function expressAuthentication(
  request: Request,
  securityName: string,
  scopes?: string[],
): Promise<any> {
  if (securityName === "bearerAuth") {
    // Look for token in both cookie and header
    const tokenFromCookie = request.cookies?.token;
    const tokenFromHeader = request.headers["authorization"]?.split(" ")[1];
    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
      throw new Error("No token provided");
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.BEARERAUTH_SECRET!);
    } catch (error) {
      throw new Error("Invalid or expired token");
    }

    // ✅ Attach USER to request
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
    });

    if (!user) {
      throw new Error("User not found");
    }

    (request as any).user = user;

     if (decoded.progressId) {
      (request as any).progressId = decoded.progressId;
      console.log("📋 Progress ID attached to request in expressAuthentication:", decoded.progressId);
    }
    // Update user online status
    await prisma.user.update({
      where: { id: user.id },
      data: { isOnline: true, lastActive: new Date() },
    });

    return decoded;
  }

  throw new Error(`Security scheme ${securityName} not implemented`);
}
