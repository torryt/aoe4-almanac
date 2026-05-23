export function Spinner({
  size = 14,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block animate-spin ${className}`}
      aria-hidden
    >
      <path d="M12 2v4" opacity={0.9} />
      <path d="M12 18v4" opacity={0.2} />
      <path d="m4.93 4.93 2.83 2.83" opacity={0.7} />
      <path d="m16.24 16.24 2.83 2.83" opacity={0.3} />
      <path d="M2 12h4" opacity={0.5} />
      <path d="M18 12h4" opacity={0.4} />
      <path d="m4.93 19.07 2.83-2.83" opacity={0.5} />
      <path d="m16.24 7.76 2.83-2.83" opacity={0.6} />
    </svg>
  );
}
