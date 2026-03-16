"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_js_1 = __importDefault(require("../db.js"));
const verifyToken = async (req, res, next) => {
    try {
        const token = req.cookies?.token;
        const tokenAuthorization = req.headers.authorization.split(" ")[1];
        if (!token || !tokenAuthorization) {
            res.status(404).json({ message: "No token was found." });
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, process.env.BEARERAUTH_SECRET);
        }
        catch {
            return res.status(403).json({ message: "Invalid or expired token" });
        }
        const user = await db_js_1.default.user.findUnique({
            where: {
                id: decoded.id,
            },
        });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        req.user = user;
        await db_js_1.default.user.update({
            where: {
                id: user.id,
            },
            data: {
                isOnline: true,
                lastActive: new Date(),
            },
        });
        return next();
    }
    catch (error) {
        res.status(500).json({
            message: "An error occured",
            error: error.message,
        });
    }
};
exports.verifyToken = verifyToken;
