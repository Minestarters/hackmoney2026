import express from "express";
import cors from "cors";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const SESSION_TTL_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

const app = express();
app.use(cors());
app.use(express.json());

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/i, "Invalid address");

const SessionCreateSchema = z.object({
  creatorAddress: AddressSchema.optional(),
});

const JoinSchema = z.object({
  joinerAddress: AddressSchema,
});

const InviteSchema = z.object({
  invite: z.string().min(10),
});

const AppSessionSchema = z.object({
  appSessionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/i, "Invalid app session id"),
  version: z.number().int().positive().optional(),
});

type SessionRecord = {
  code: string;
  creatorAddress?: `0x${string}`;
  joinerAddress?: `0x${string}`;
  invite?: string;
  appSessionId?: `0x${string}`;
  appSessionVersion?: number;
  createdAt: number;
  expiresAt: number;
};

const sessions = new Map<string, SessionRecord>();

const generateCode = () => {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[idx];
  }
  return code;
};

const generateUniqueCode = () => {
  let code = generateCode();
  while (sessions.has(code)) {
    code = generateCode();
  }
  return code;
};

const now = () => Date.now();

const getSession = (code: string) => {
  const session = sessions.get(code.toUpperCase());
  if (!session) return null;
  if (session.expiresAt <= now()) {
    sessions.delete(code.toUpperCase());
    return null;
  }
  return session;
};

const getStatus = (session: SessionRecord) => {
  if (!session.joinerAddress) return "waiting_for_joiner";
  if (!session.invite) return "waiting_for_invite";
  return "invite_ready";
};

app.post("/api/sessions", (req, res) => {
  const parsed = SessionCreateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const code = generateUniqueCode();
  const createdAt = now();
  const expiresAt = createdAt + SESSION_TTL_MS;

  const record: SessionRecord = {
    code,
    creatorAddress: parsed.data.creatorAddress as `0x${string}` | undefined,
    createdAt,
    expiresAt,
  };

  sessions.set(code, record);
  return res.json({ code, expiresAt });
});

app.get("/api/sessions/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json({
    status: getStatus(session),
    joinerAddress: session.joinerAddress,
    expiresAt: session.expiresAt,
    appSessionId: session.appSessionId,
    appSessionVersion: session.appSessionVersion,
  });
});

app.post("/api/sessions/:code/join", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const parsed = JoinSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const joinerAddress = parsed.data.joinerAddress as `0x${string}`;
  if (session.joinerAddress && session.joinerAddress.toLowerCase() !== joinerAddress.toLowerCase()) {
    return res.status(409).json({ error: "Session already claimed by another joiner" });
  }

  session.joinerAddress = joinerAddress;
  sessions.set(code, session);

  const status = getStatus(session);
  return res.json({
    status,
    invite: session.invite,
  });
});

app.post("/api/sessions/:code/invite", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const parsed = InviteSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  session.invite = parsed.data.invite;
  sessions.set(code, session);

  return res.json({ status: "invite_ready" });
});

app.get("/api/sessions/:code/invite", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const status = getStatus(session);
  return res.json({
    status,
    invite: session.invite,
  });
});

app.post("/api/sessions/:code/app-session", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const parsed = AppSessionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  session.appSessionId = parsed.data.appSessionId as `0x${string}`;
  session.appSessionVersion = parsed.data.version;
  sessions.set(code, session);

  return res.json({ status: "app_session_ready" });
});

app.get("/api/sessions/:code/app-session", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json({
    status: session.appSessionId ? "app_session_ready" : "waiting_for_app_session",
    appSessionId: session.appSessionId,
    version: session.appSessionVersion,
  });
});

app.delete("/api/sessions/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSession(code);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  sessions.delete(code);
  return res.json({ status: "deleted" });
});

const cleanup = () => {
  const cutoff = now();
  for (const [code, session] of sessions.entries()) {
    if (session.expiresAt <= cutoff) {
      sessions.delete(code);
    }
  }
};

setInterval(cleanup, CLEANUP_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`Session service listening on :${PORT}`);
});
