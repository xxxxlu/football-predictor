import type { ShareTextOptions, SingleMatchVictoryData, SeasonVictoryData } from "./types";

export function formatShareTitle(options: ShareTextOptions): string {
  const { data, locale } = options;
  if (data.kind === "MATCH") {
    switch (locale) {
      case "en": return `PULSE Victory: ${data.homeTeam} vs ${data.awayTeam}`;
      case "de": return `PULSE Spieltag-Erfolg: ${data.homeTeam} vs ${data.awayTeam}`;
      case "es": return `PULSE Pronóstico Ganador: ${data.homeTeam} vs ${data.awayTeam}`;
      default: return `PULSE 命中战报：${data.homeTeam} 对 ${data.awayTeam}`;
    }
  }

  switch (locale) {
    case "en": return `PULSE Season Record (${data.seasonLabel || "Season"})`;
    case "de": return `PULSE Saison-Leistung (${data.seasonLabel || "Saison"})`;
    case "es": return `PULSE Rendimiento de Temporada (${data.seasonLabel || "Temporada"})`;
    default: return `PULSE 赛季长期战绩（${data.seasonLabel || "赛季"}）`;
  }
}

function formatMatchShareText(data: SingleMatchVictoryData, locale: ShareTextOptions["locale"]): string {
  const outcomeEmoji = data.outcome === "WIN" ? "🎯" : data.outcome === "PUSH" ? "🔄" : "⏱️";
  switch (locale) {
    case "en":
      return [
        `🏆 [PULSE Sports Club · Victory Ticket]`,
        `⚽ ${data.homeTeam} vs ${data.awayTeam}`,
        `📊 ${data.competition}`,
        `${outcomeEmoji} Pick: ${data.selection} @ ${data.odds}`,
        `💰 Net Profit: ${data.netPoints}`,
        `🔒 Ledger Verified · Ticket #${data.ticketId}`,
      ].join("\n");

    case "de":
      return [
        `🏆 [PULSE Sports Club · Spieltag-Erfolg]`,
        `⚽ ${data.homeTeam} vs ${data.awayTeam}`,
        `📊 ${data.competition}`,
        `${outcomeEmoji} Tipp: ${data.selection} @ ${data.odds}`,
        `💰 Nettogewinn: ${data.netPoints}`,
        `🔒 Hauptbuch geprüft · Ticket #${data.ticketId}`,
      ].join("\n");

    case "es":
      return [
        `🏆 [PULSE Sports Club · Boleto Ganador]`,
        `⚽ ${data.homeTeam} vs ${data.awayTeam}`,
        `📊 ${data.competition}`,
        `${outcomeEmoji} Pronóstico: ${data.selection} @ ${data.odds}`,
        `💰 Beneficio neto: ${data.netPoints}`,
        `🔒 Auditoría oficial · Boleto #${data.ticketId}`,
      ].join("\n");

    default:
      return [
        `🏆【PULSE 体育俱乐部 · 命中战报】`,
        `⚽ ${data.homeTeam} 对 ${data.awayTeam}`,
        `📊 赛事：${data.competition}`,
        `${outcomeEmoji} 判断：${data.selection} @ ${data.odds}`,
        `💰 净积分收益：${data.netPoints}`,
        `🔒 官方账本已结算验证 · 票号 #${data.ticketId}`,
      ].join("\n");
  }
}

function formatSeasonShareText(data: SeasonVictoryData, locale: ShareTextOptions["locale"]): string {
  switch (locale) {
    case "en":
      return [
        `👑 [PULSE Sports Club · Season Performance]`,
        `📈 Net Points: ${data.netPoints}`,
        `🎯 Hit Rate: ${data.hitRate} (${data.wins} Wins / ${data.settledTickets} Settled)`,
        `🏆 Verified Audit Trail Across All Events`,
      ].join("\n");

    case "de":
      return [
        `👑 [PULSE Sports Club · Saison-Leistung]`,
        `📈 Gesamt-Nettopunkte: ${data.netPoints}`,
        `🎯 Trefferquote: ${data.hitRate} (${data.wins} Siege / ${data.settledTickets} Abgerechnet)`,
        `🏆 Verifizierte Prüfpfade über alle Wettbewerbe`,
      ].join("\n");

    case "es":
      return [
        `👑 [PULSE Sports Club · Rendimiento de Temporada]`,
        `📈 Puntos netos: ${data.netPoints}`,
        `🎯 Tasa de acierto: ${data.hitRate} (${data.wins} Aciertos / ${data.settledTickets} Liquidados)`,
        `🏆 Registro auditado en todas las competiciones`,
      ].join("\n");

    default:
      return [
        `👑【PULSE 体育俱乐部 · 赛季长期战绩】`,
        `📈 累计净积分：${data.netPoints}`,
        `🎯 命中胜率：${data.hitRate}（${data.wins} 场命中 / ${data.settledTickets} 场结算）`,
        `🏆 全赛事真实缓存与双花审计追溯`,
      ].join("\n");
  }
}

export function buildVictoryShareText(options: ShareTextOptions): string {
  const content = options.data.kind === "MATCH"
    ? formatMatchShareText(options.data, options.locale)
    : formatSeasonShareText(options.data, options.locale);

  if (options.url) {
    return `${content}\n🔗 ${options.url}`;
  }
  return content;
}
