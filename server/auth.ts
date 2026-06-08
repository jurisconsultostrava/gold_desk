import type { Express, NextFunction, Request, Response } from "express";
import session from "express-session";
import crypto from "node:crypto";
import { encryptionConfigured, config } from "./config";

declare module "express-session" {
  interface SessionData {
    appUser?: {
      username: string;
      loggedInAt: string;
    };
  }
}

const explicitEnabled = String(process.env.APP_AUTH_ENABLED || "").toLowerCase();
const authUsername = process.env.APP_AUTH_USERNAME || process.env.APP_LOGIN_USERNAME || "";
const plainPassword = process.env.APP_AUTH_PASSWORD || process.env.APP_LOGIN_PASSWORD || "";
const passwordHash = process.env.APP_AUTH_PASSWORD_HASH || "";

export function appAuthConfigured(): boolean {
  return !!(authUsername && (plainPassword || passwordHash));
}

export function appAuthEnabled(): boolean {
  if (explicitEnabled === "false" || explicitEnabled === "0" || explicitEnabled === "off") return false;
  if (explicitEnabled === "true" || explicitEnabled === "1" || explicitEnabled === "on") return true;
  return appAuthConfigured();
}

function sessionSecret(): string {
  return (
    process.env.APP_SESSION_SECRET ||
    process.env.SESSION_SECRET ||
    (encryptionConfigured() ? config.encryptionKey : "") ||
    "dev-only-change-me"
  );
}

function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

function verifyScryptPassword(password: string, stored: string): boolean {
  // Supported format: scrypt:<saltHex>:<derivedKeyHex>
  const [scheme, saltHex, derivedHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !derivedHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(derivedHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function verifyPassword(password: string): boolean {
  if (!password) return false;
  if (passwordHash) return verifyScryptPassword(password, passwordHash);
  return safeEqual(password, plainPassword);
}

function isHttpsCookieEnabled(): boolean {
  const raw = String(process.env.APP_COOKIE_SECURE || "").toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return true;
  return process.env.NODE_ENV === "production";
}

export function setupAppAuth(app: Express) {
  if (appAuthEnabled() && !appAuthConfigured()) {
    throw new Error(
      "APP_AUTH_ENABLED=true, ale chybí APP_AUTH_USERNAME a APP_AUTH_PASSWORD nebo APP_AUTH_PASSWORD_HASH.",
    );
  }

  app.set("trust proxy", 1);

  app.use(
    session({
      name: process.env.APP_SESSION_COOKIE_NAME || "golddesk.sid",
      secret: sessionSecret(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isHttpsCookieEnabled(),
        maxAge: Number(process.env.APP_SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 12),
      },
    }),
  );

  app.get("/api/app-auth/me", (req: Request, res: Response) => {
    const enabled = appAuthEnabled();
    res.json({
      auth_enabled: enabled,
      authenticated: !enabled || !!req.session.appUser,
      username: req.session.appUser?.username || null,
    });
  });

  app.post("/api/app-auth/login", (req: Request, res: Response) => {
    if (!appAuthEnabled()) {
      return res.json({ ok: true, auth_enabled: false, username: null });
    }

    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!safeEqual(username, authUsername) || !verifyPassword(password)) {
      return res.status(401).json({ message: "Nesprávné jméno nebo heslo." });
    }

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ message: "Nepodařilo se vytvořit přihlašovací session." });
      req.session.appUser = { username: authUsername, loggedInAt: new Date().toISOString() };
      return res.json({ ok: true, auth_enabled: true, username: authUsername });
    });
  });

  app.post("/api/app-auth/logout", (req: Request, res: Response) => {
    req.session.destroy(() => {
      res.clearCookie(process.env.APP_SESSION_COOKIE_NAME || "golddesk.sid");
      res.json({ ok: true });
    });
  });

  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (!appAuthEnabled()) return next();
    if (req.path.startsWith("/app-auth/") || req.path === "/status") return next();
    if (req.session.appUser) return next();
    return res.status(401).json({ message: "Nejste přihlášeni do aplikace." });
  });
}
