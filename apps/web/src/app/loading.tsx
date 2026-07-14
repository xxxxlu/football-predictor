import { PitchLoader } from "@/components/football";

export default function Loading() {
  return <div className="grid min-h-screen place-items-center bg-[var(--paper)]"><PitchLoader label="加载中…" /></div>;
}
