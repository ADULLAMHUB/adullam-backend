"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.expressAuthentication = expressAuthentication;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_js_1 = __importDefault(require("../db.js"));
async function expressAuthentication(request, securityName, scopes) {
    if (securityName === "bearerAuth") {
        // Look for token in both cookie and header
        const tokenFromCookie = request.cookies?.token;
        const tokenFromHeader = request.headers["authorization"]?.split(" ")[1];
        const token = tokenFromCookie || tokenFromHeader;
        if (!token) {
            throw new Error("No token provided");
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, process.env.BEARERAUTH_SECRET);
        }
        catch (error) {
            throw new Error("Invalid or expired token");
        }
        // ✅ Attach USER to request
        const user = await db_js_1.default.user.findUnique({
            where: { id: decoded.id },
        });
        if (!user) {
            throw new Error("User not found");
        }
        request.user = user;
        if (decoded.progressId) {
            request.progressId = decoded.progressId;
            console.log("📋 Progress ID attached to request in expressAuthentication:", decoded.progressId);
        }
        // Update user online status
        await db_js_1.default.user.update({
            where: { id: user.id },
            data: { isOnline: true, lastActive: new Date() },
        });
        return decoded;
    }
    throw new Error(`Security scheme ${securityName} not implemented`);
}
