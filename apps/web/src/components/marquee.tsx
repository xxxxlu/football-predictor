/** Seamless infinite ticker. Two identical tracks scroll left; pauses on hover. */
export function Marquee({ items, reverse = false, className = "" }: { items: string[]; reverse?: boolean; className?: string }) {
  const track = (
    <div className="marquee__track" aria-hidden="true">
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-6">
          {item}
          <span className="marquee__sep">/</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`marquee ${reverse ? "marquee--reverse" : ""} ${className}`}>
      {track}
      {track}
    </div>
  );
}
