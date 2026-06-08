import crypto from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs '<heslo>'");
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync(password, salt, 64);
console.log(`scrypt:${salt.toString("hex")}:${derived.toString("hex")}`);
