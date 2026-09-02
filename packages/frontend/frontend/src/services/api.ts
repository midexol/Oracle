/**
 * Oracle API Client
 * Handles all communication with @signal/oracle-analytics backend
 */

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api";

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, error.message || response.statusText);
  }

  // Every oracle-analytics route wraps its payload as `{ data: ... }`.
  const body = await response.json();
  return body.data;
}

// ─────────────────────────────────────────────────────────────
// Predictions
// ─────────────────────────────────────────────────────────────

export interface CreatePredictionPayload {
  wallet: string;
  marketId: string;
  asset: string;
  duration: string;
  prediction: "UP" | "DOWN";
  entryPrice: number;
  username?: string;
  avatar?: string;
}

export async function createPrediction(payload: CreatePredictionPayload) {
  return apiFetch("/predictions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getPredictionContext(predictionId: string) {
  return apiFetch(`/predictions/${predictionId}/context`);
}

// ─────────────────────────────────────────────────────────────
// Users & Profiles
// ─────────────────────────────────────────────────────────────

export interface ProfileHistoryEntry {
  id: string;
  market: string;
  asset: string;
  dir: "UP" | "DOWN";
  result: "WON" | "LOST";
  price: number;
  resolvedAt: string | null;
}

export interface ProfileCategoryStat {
  label: string;
  asset: string;
  duration: string;
  totalPredictions: number;
  totalWins: number;
  accuracy: number;
  categoryScore: number;
}

// Field names match `oracle-analytics`'s actual /users/:wallet/profile
// response (see packages/oracle-analytics/src/routes/analytics.ts) — this
// previously drifted from the real shape (score/winRate/momentum vs. the
// real predictionScore/winRate/momentumScore etc.), so nothing that read it
// ever saw real values.
export interface UserProfile {
  wallet: string;
  username?: string;
  avatar?: string;
  totalPredictions: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  predictionScore: number;
  momentumScore: number;
  credibleInterval90: { lower: number; upper: number };
  categoryBreakdown: ProfileCategoryStat[];
  history: ProfileHistoryEntry[];
}

export async function getUserProfile(wallet: string): Promise<UserProfile> {
  return apiFetch(`/users/${wallet}/profile`);
}

export async function getScoreBreakdown(wallet: string) {
  return apiFetch(`/users/${wallet}/score-breakdown`);
}

// ─────────────────────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────────────────────

// Field names match `oracle-analytics`'s actual GET /leaderboard response
// (see packages/oracle-analytics/src/routes/analytics.ts) — this previously
// declared score/winRate/predictionsCount/momentum/specialties, none of
// which the backend returns, so LeaderboardView crashed on real data
// (`r.winRate.toFixed` on undefined).
export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  username: string;
  avatar: string;
  asset?: string;
  duration?: string;
  totalPredictions: number;
  totalWins: number;
  totalLosses?: number;
  accuracy: number;
  predictionScore: number;
}

export interface LeaderboardParams {
  asset?: string;
  duration?: string;
  sortBy?: "prediction_score" | "accuracy";
  limit?: number;
}

export async function getLeaderboard(params: LeaderboardParams = {}): Promise<LeaderboardEntry[]> {
  const query = new URLSearchParams();
  if (params.asset) query.append("asset", params.asset);
  if (params.duration) query.append("duration", params.duration);
  if (params.sortBy) query.append("sortBy", params.sortBy);
  if (params.limit) query.append("limit", String(params.limit));

  const queryStr = query.toString();
  return apiFetch(`/leaderboard${queryStr ? `?${queryStr}` : ""}`);
}

// ─────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────

export { ApiError };
