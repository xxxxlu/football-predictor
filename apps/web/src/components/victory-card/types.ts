import type { Locale } from "@/lib/i18n/messages";

export type SingleMatchVictoryData = {
  kind: "MATCH";
  competition: string;
  season?: string | number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  settledAt?: string;
  selection: string;
  odds: string;
  stakePoints: string;
  grossReturnPoints: string;
  netPoints: string;
  outcome: "WIN" | "PUSH" | "LOSS";
  ticketId: string;
  roomName?: string;
  auditId?: string;
  inviteUrl?: string;
};

export type SeasonVictoryData = {
  kind: "SEASON";
  seasonLabel: string;
  netPoints: string;
  hitRate: string;
  settledTickets: number;
  wins: number;
  voids: number;
  coveredTickets: number;
  userName?: string;
  inviteUrl?: string;
};

export type VictoryCardData = SingleMatchVictoryData | SeasonVictoryData;

export type ShareTextOptions = {
  data: VictoryCardData;
  locale: Locale;
  url?: string;
};
