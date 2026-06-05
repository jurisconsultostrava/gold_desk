// SMTP send via nodemailer (for IMAP accounts).
import nodemailer from "nodemailer";
import { decrypt } from "../crypto";
import type { Account } from "@shared/schema";

export async function sendViaSmtp(account: Account, to: string[], subject: string, body: string): Promise<void> {
  if (!account.smtp_host || !account.smtp_password_enc) {
    throw new Error("SMTP není pro tento účet nakonfigurováno.");
  }
  const transporter = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port || 587,
    secure: (account.smtp_port || 587) === 465,
    auth: { user: account.email, pass: decrypt(account.smtp_password_enc) },
  });
  await transporter.sendMail({
    from: account.email,
    to: to.join(", "),
    subject,
    text: body,
  });
}
