import { SoccerBall } from "./football";

/** Full-screen branded intro loader (volt), shown while the session resolves. */
export function KickoffLoader() {
  return (
    <div className="kickoff" role="status" aria-label="加载中">
      <div className="flex flex-col items-center gap-7 px-6 text-center">
        <span className="kinetic text-[clamp(2.75rem,11vw,6.5rem)] leading-none">
          KICK<span className="text-stroke"> OFF</span>
        </span>
        <span className="kickoff__ball block">
          <SoccerBall className="size-14" />
        </span>
      </div>
    </div>
  );
}
