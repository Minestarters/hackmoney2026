import { SESSION_API_URL } from "../config";

export type SessionStatus = "waiting_for_joiner" | "waiting_for_invite" | "invite_ready";

const apiFetch = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(`${SESSION_API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error?.error || response.statusText;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
};

export const createJoinCode = (creatorAddress?: string) =>
  apiFetch<{ code: string; expiresAt: number }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ creatorAddress }),
  });

export const joinSession = (code: string, joinerAddress: string) =>
  apiFetch<{ status: SessionStatus; invite?: string }>(`/api/sessions/${code}/join`, {
    method: "POST",
    body: JSON.stringify({ joinerAddress }),
  });

export const getSession = (code: string) =>
  apiFetch<{
    status: SessionStatus;
    joinerAddress?: string;
    expiresAt: number;
    appSessionId?: string;
    appSessionVersion?: number;
  }>(`/api/sessions/${code}`);

export const uploadInvite = (code: string, invite: string) =>
  apiFetch<{ status: "invite_ready" }>(`/api/sessions/${code}/invite`, {
    method: "POST",
    body: JSON.stringify({ invite }),
  });

export const getInvite = (code: string) =>
  apiFetch<{ status: SessionStatus; invite?: string }>(`/api/sessions/${code}/invite`);

export const uploadAppSession = (code: string, appSessionId: string, version?: number) =>
  apiFetch<{ status: "app_session_ready" }>(`/api/sessions/${code}/app-session`, {
    method: "POST",
    body: JSON.stringify({ appSessionId, version }),
  });

export const getAppSession = (code: string) =>
  apiFetch<{
    status: "waiting_for_app_session" | "app_session_ready";
    appSessionId?: string;
    version?: number;
  }>(`/api/sessions/${code}/app-session`);

export const deleteSession = (code: string) =>
  apiFetch<{ status: "deleted" }>(`/api/sessions/${code}`, {
    method: "DELETE",
  });
