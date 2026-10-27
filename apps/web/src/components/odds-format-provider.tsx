"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { formatOdds, type OddsFormat, ODDS_FORMAT_COOKIE, SUPPORTED_ODDS_FORMATS } from "@/lib/odds-format";

type OddsFormatContextValue = {
  oddsFormat: OddsFormat;
  setOddsFormat: (format: OddsFormat) => void;
  displayOdds: (decimalValue: string | number | undefined | null) => string;
};

const OddsFormatContext = createContext<OddsFormatContextValue | null>(null);

function getInitialFormat(): OddsFormat {
  if (typeof document === "undefined") return "decimal";
  const match = document.cookie.match(new RegExp(`(^| )${ODDS_FORMAT_COOKIE}=([^;]+)`));
  const cookieValue = match?.[2] as OddsFormat | undefined;
  if (cookieValue && SUPPORTED_ODDS_FORMATS.includes(cookieValue)) return cookieValue;
  return "decimal";
}

export function OddsFormatProvider({ children }: { children: React.ReactNode }) {
  const [oddsFormat, setOddsFormatState] = useState<OddsFormat>(getInitialFormat);

  const setOddsFormat = (format: OddsFormat) => {
    setOddsFormatState(format);
    if (typeof document !== "undefined") {
      document.cookie = `${ODDS_FORMAT_COOKIE}=${format}; path=/; max-age=31536000; samesite=lax`;
    }
  };

  const value = useMemo(
    () => ({
      oddsFormat,
      setOddsFormat,
      displayOdds: (raw: string | number | undefined | null) => formatOdds(raw, oddsFormat),
    }),
    [oddsFormat]
  );

  return <OddsFormatContext.Provider value={value}>{children}</OddsFormatContext.Provider>;
}

export function useOddsFormat(): OddsFormatContextValue {
  const context = useContext(OddsFormatContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      oddsFormat: "decimal",
      setOddsFormat: () => {},
      displayOdds: (raw) => formatOdds(raw, "decimal"),
    };
  }
  return context;
}
