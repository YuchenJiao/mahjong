import type { Action, Config, Game, AiDifficulty } from "../engine/types";

export type RoomCommand =
  | { type: "start" | "next" | "takeback" | "autoplay" | "leave" }
  | { type: "exchange"; tiles: number[] }
  | { type: "void"; suit: number }
  | { type: "difficulty"; difficulty: AiDifficulty }
  | { type: "discard"; tile: number }
  | { type: "act" | "claim"; action: Action };
export type RoomView = {
  id: string;
  isHost: boolean;
  selfSeat: number;
  version: number;
  stage: string;
  serverTime: number;
  deadline: number;
  config: Config;
  seats: { name: string; human: boolean; connected: boolean; autoplay: boolean; host: boolean }[];
  exchangeReady: boolean[];
  voidReady: boolean[];
  game: Game | null;
  actions: Action[];
  claims: Action[];
};
export type RoomSession = { id: string; token: string; origin: string };
