import Image from "next/image";

const CIRCUIT_ASSETS: Record<string, { src: string; country: string }> = {
  "albert-park": { src: "/design-system/f1/circuits/albert_park.webp", country: "AU" },
  shanghai: { src: "/design-system/f1/circuits/shanghai.webp", country: "CN" },
  suzuka: { src: "/design-system/f1/circuits/suzuka.webp", country: "JP" },
  miami: { src: "/design-system/f1/circuits/miami.webp", country: "US" },
  montreal: { src: "/design-system/f1/circuits/villeneuve.webp", country: "CA" },
  monaco: { src: "/design-system/f1/circuits/monaco.webp", country: "MC" },
  catalunya: { src: "/design-system/f1/circuits/catalunya.webp", country: "ES" },
  "red-bull-ring": { src: "/design-system/f1/circuits/red_bull_ring.webp", country: "AT" },
  silverstone: { src: "/design-system/f1/circuits/silverstone.webp", country: "GB" },
  spa: { src: "/design-system/f1/circuits/spa.webp", country: "BE" },
  hungaroring: { src: "/design-system/f1/circuits/hungaroring.webp", country: "HU" },
  zandvoort: { src: "/design-system/f1/circuits/zandvoort.webp", country: "NL" },
  monza: { src: "/design-system/f1/circuits/monza.webp", country: "IT" },
  madrid: { src: "/design-system/f1/circuits/madrid.webp", country: "ES" },
  baku: { src: "/design-system/f1/circuits/baku.webp", country: "AZ" },
  "marina-bay": { src: "/design-system/f1/circuits/marina_bay.webp", country: "SG" },
  americas: { src: "/design-system/f1/circuits/americas.webp", country: "US" },
  rodriguez: { src: "/design-system/f1/circuits/rodriguez.webp", country: "MX" },
  interlagos: { src: "/design-system/f1/circuits/interlagos.webp", country: "BR" },
  vegas: { src: "/design-system/f1/circuits/vegas.webp", country: "US" },
  losail: { src: "/design-system/f1/circuits/losail.webp", country: "QA" },
  "yas-marina": { src: "/design-system/f1/circuits/yas_marina.webp", country: "AE" },
};

export function PulseCircuit({ circuitKey, className = "" }: { circuitKey: string; className?: string }) {
  const circuit = CIRCUIT_ASSETS[circuitKey.toLowerCase()];
  if (!circuit) {
    return <div className={`pulse-circuit pulse-circuit--empty ${className}`} aria-label="赛道图暂不可用"><span>TRACK DATA</span></div>;
  }
  return (
    <div className={`pulse-circuit ${className}`}>
      <Image src={circuit.src} alt={`${circuitKey} 赛道图`} fill sizes="(max-width: 767px) 100vw, 33vw" />
      <span className="pulse-circuit__country">{circuit.country}</span>
      <span className="pulse-circuit__scan" aria-hidden="true" />
    </div>
  );
}
