import { NextFunction, Response, Request } from "express";
import jwt from "jsonwebtoken";
import prisma from "../db.js";
export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.cookies?.token;
    const tokenAuthorization = req.headers.authorization.split(" ")[1];

    if (!token || !tokenAuthorization) {
      res.status(404).json({ message: "No token was found." });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, process.env.BEARERAUTH_SECRET!);
    } catch {
      return res.status(403).json({ message: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({
      where: {
        id: decoded.id,
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.user = user;

    await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        isOnline: true,
        lastActive: new Date(),
      },
    });

    return next();
  } catch (error: any) {
    res.status(500).json({
      message: "An error occured",
      error: error.message,
    });
  }
};
