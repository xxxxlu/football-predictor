"use client";

import React from "react";

export function RollText({
  top,
  bottom,
  className = "",
}: {
  top: React.ReactNode;
  bottom?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`roll-text ${className}`}>
      <span className="roll-text-inner">
        <span className="roll-text-top">{top}</span>
        <span className="roll-text-bottom">{bottom ?? top}</span>
      </span>
    </span>
  );
}
