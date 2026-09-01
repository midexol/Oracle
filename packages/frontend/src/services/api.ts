/**
 * Oracle API Client
 * Handles all communication with @signal/oracle-analytics backend
 */

const API_BASE = "http://localhost:4000/api";

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

  return response.json();
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

export interface UserProfile {
  wallet: string;
  username?: string;
  avatar?: string;
  totalPredictions: number;
  winRate: number;
  score: number;
  momentum: number;
  credibleInterval: { lower: number; upper: number };
  categoryBreakdown: Array<{
    category: string;
    winRate: number;
    count: number;
  }>;
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

export interface LeaderboardEntry {
  rank: number;
  wallet: string;
  username: string;
  avatar: string;
  score: number;
  winRate: number;
  predictionsCount: number;
  momentum?: number;
  specialties?: Array<{ market: string; winRate: number }>;
}

export interface LeaderboardParams {
  asset?: string;
  duration?: string;
  sortBy?: "score" | "winRate" | "momentum";
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
