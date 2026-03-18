"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_js_1 = require("../generated/prisma/client.js"); // Change from client.js to index.js
const adapter_pg_1 = require("@prisma/adapter-pg");
const connectionString = `${process.env.DATABASE_URL}`;
// Make sure connection string is valid
if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
}
const adapter = new adapter_pg_1.PrismaPg({ connectionString });
const prisma = new client_js_1.PrismaClient({ adapter });
exports.default = prisma;
