import type { RoomSummary } from "@/features/matchday/types";

export function RoomFilter({ rooms, value, onChange }: { rooms: RoomSummary[]; value: string; onChange(value: string): void }) {
  return <label className="block max-w-sm"><span className="mb-1.5 block text-xs font-bold text-[var(--muted)]">房间范围</span><select value={value} onChange={event => onChange(event.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-bold"><option value="" disabled>选择一个房间</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>;
}
