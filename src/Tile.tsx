import { rank, suit, tileName } from "./engine/core";
export function TileFace({ tile }: { tile: number }) {
  const s = suit(tile),
    n = rank(tile);
  if (s === 0)
    return (
      <span className="characters">
        <b>{["一", "二", "三", "四", "五", "六", "七", "八", "九"][n - 1]}</b>
        <em>萬</em>
      </span>
    );
  if (s === 3)
    return (
      <span className={"honor h" + tile}>
        {["東", "南", "西", "北", "中", "發", "白"][tile - 27]}
      </span>
    );
  const dots: Record<number, number[][]> = {
    1: [[18, 24]],
    2: [
      [18, 12],
      [18, 36],
    ],
    3: [
      [10, 10],
      [18, 24],
      [26, 38],
    ],
    4: [
      [10, 12],
      [26, 12],
      [10, 36],
      [26, 36],
    ],
    5: [
      [9, 10],
      [27, 10],
      [18, 24],
      [9, 38],
      [27, 38],
    ],
    6: [
      [10, 10],
      [26, 10],
      [10, 24],
      [26, 24],
      [10, 38],
      [26, 38],
    ],
    7: [
      [9, 8],
      [18, 15],
      [27, 22],
      [10, 30],
      [26, 30],
      [10, 42],
      [26, 42],
    ],
    8: [
      [10, 7],
      [26, 7],
      [10, 18],
      [26, 18],
      [10, 30],
      [26, 30],
      [10, 42],
      [26, 42],
    ],
    9: [
      [8, 9],
      [18, 9],
      [28, 9],
      [8, 24],
      [18, 24],
      [28, 24],
      [8, 39],
      [18, 39],
      [28, 39],
    ],
  };
  if (s === 1)
    return (
      <svg viewBox="0 0 36 48" aria-hidden="true">
        {dots[n].map(([x, y], i) => (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={n === 1 ? 10 : 4.3}
              fill={i === 0 && n % 2 === 1 ? "#b84d45" : "#274b76"}
            />
            <circle
              cx={x}
              cy={y}
              r={n === 1 ? 6 : 2}
              fill="none"
              stroke="#fffdf6"
              strokeWidth="1"
            />
            {n === 1 && <circle cx={x} cy={y} r="2.5" fill="#fffdf6" />}
          </g>
        ))}
      </svg>
    );
  if (n === 1)
    return (
      <svg viewBox="0 0 36 48" aria-hidden="true">
        <path d="M17 8c-8 1-12 7-7 15l7 8-8 10 13-5 5-15-3-9z" fill="#276955" />
        <path d="M16 17l11 5-5 10-9-5z" fill="#a3be88" />
        <path d="M20 12l8-1-5 4" fill="#b94e40" />
        <circle cx="20" cy="11" r="1.3" fill="#f7f7ed" />
      </svg>
    );
  return (
    <svg viewBox="0 0 36 48" aria-hidden="true">
      {dots[n].map(([x, y], i) => (
        <g key={i}>
          <path
            d={`M${x} ${y - 4}v8`}
            stroke={n === 7 && i < 3 ? "#aa4e48" : "#266d54"}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path d={`M${x - 2} ${y}h4`} stroke="#f1eedc" strokeWidth=".8" />
        </g>
      ))}
    </svg>
  );
}
export function Tile({
  tile,
  small = false,
  hidden = false,
  selected = false,
  suggested = false,
  dim = false,
  disabled = false,
  onClick,
  drawn = false,
}: {
  tile?: number;
  small?: boolean;
  hidden?: boolean;
  selected?: boolean;
  suggested?: boolean;
  dim?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  drawn?: boolean;
}) {
  const label = hidden ? "背面牌" : tile === undefined ? "牌" : tileName(tile);
  const cls = `tile ${small ? "small" : ""} ${hidden ? "back" : ""} ${selected ? "selected" : ""} ${suggested ? "suggested" : ""} ${dim ? "dim" : ""} ${drawn ? "drawn" : ""}`;
  const face = hidden ? (
    <span className="back-mark">一</span>
  ) : tile === undefined ? null : (
    <>
      <TileFace tile={tile} />
      <span className="tile-caption">{label}</span>
    </>
  );
  return onClick ? (
    <button
      className={cls}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {face}
    </button>
  ) : (
    <span className={cls} title={label} aria-label={label}>
      {face}
    </span>
  );
}
