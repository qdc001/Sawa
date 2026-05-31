interface KlaruMarkProps {
  size?: number;
  ringColor?: string;
  dotColor?: string;
  className?: string;
}

// Símbolo oficial Klaru: círculo a contorno (a conversa) + ponto descentrado (o sim).
// Geometria do brand sheet (viewBox 100x100): círculo r=42, ponto cx=63 cy=61 r=9.
export function KlaruMark({ size = 28, ringColor = 'currentColor', dotColor = '#C8553D', className }: KlaruMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <circle cx="50" cy="50" r="42" fill="none" stroke={ringColor} strokeWidth="6" />
      <circle cx="63" cy="61" r="9" fill={dotColor} />
    </svg>
  );
}

interface KlaruLogoProps {
  size?: number;
  ringColor?: string;
  dotColor?: string;
  wordColor?: string;
  showWord?: boolean;
}

// Logótipo horizontal: símbolo + wordmark "Klaru" em Fraunces.
export default function KlaruLogo({
  size = 28,
  ringColor = 'currentColor',
  dotColor = '#C8553D',
  wordColor = 'currentColor',
  showWord = true,
}: KlaruLogoProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <KlaruMark size={size} ringColor={ringColor} dotColor={dotColor} />
      {showWord && (
        <span
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: size * 0.82,
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: wordColor,
            lineHeight: 1,
          }}
        >
          Klaru
        </span>
      )}
    </span>
  );
}
