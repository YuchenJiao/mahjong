import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  initCore,
  suit,
  tileName,
  evaluate,
  fanReference,
} from "./engine/core";
import {
  newGame,
  copyGame,
  doExchange,
  doVoid,
  discard,
  ownActions,
  act,
  respond,
  advance,
  publicView,
  snapshot,
  winScore,
  allowedDiscards,
} from "./engine/game";
import { advise, chooseOwn, chooseResponse, knownCounts } from "./engine/ai";
import { rules } from "./engine/rules";
import { BONUS, defaultConfig } from "./engine/types";
import type { Game, Config, Action, Frame, Player, PlayStyle, AiDifficulty } from "./engine/types";
import { Tile } from "./Tile";
import { useTableFeedback } from "./feedback/useTableFeedback";
import { eventLabel } from "./feedback/events";
import { CenterFeedback } from "./feedback/CenterFeedback";
import { voiceId, voiceKind } from "./feedback/voice";
import "./style.css";
import { useRoom } from "./online/useRoom";
import { RoomPanel } from "./online/RoomPanel";
import type { RoomCommand } from "./online/protocol";
const SAVE = "quiet-mahjong-v3";
const PREF = "quiet-mahjong-preferences";
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
const initial = stored<Game | null>(SAVE, null);
const validInitial = initial?.version === 3 ? initial : null;
if (validInitial)
  validInitial.config = { ...defaultConfig, ...validInitial.config };
let audio: AudioContext | null = null;
function sound(kind: string, enabled: boolean) {
  if (!enabled) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().catch(() => {});
    const notes =
      kind === "win"
        ? [440, 554, 659]
        : kind.includes("Kong") || ["pung", "kong", "chow"].includes(kind)
          ? [330, 440]
          : [240];
    notes.forEach((freq, i) => {
      const o = audio!.createOscillator(),
        a = audio!.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      o.connect(a);
      a.connect(audio!.destination);
      const at = audio!.currentTime + i * 0.07;
      a.gain.setValueAtTime(0.045, at);
      a.gain.exponentialRampToValueAtTime(0.001, at + 0.12);
      o.start(at);
      o.stop(at + 0.13);
    });
  } catch {
    /* Optional sound never blocks play. */
  }
}
const amount = (n: number) => (n > 0 ? "+" + n : "" + n);
const actionName = (type: string) => ({ pass: "过", win: "胡", chow: "吃", pung: "碰", kong: "杠", addedKong: "补杠", concealedKong: "暗杠" } as Record<string,string>)[type] ?? type;
function Melds({ p, reveal = false }: { p: Player; reveal?: boolean }) {
  return (
    <div className="melds">
      {p.melds.map((m, j) => (
        <div className="meld" key={j}>
          {m.tiles.map((t, k) => (
            <Tile
              key={k}
              tile={t}
              small
              hidden={m.concealed && !reveal}
            />
          ))}
          <span>
            {m.concealed
              ? "暗杠"
              : m.added
                ? "补杠"
                : m.kind === "chow"
                  ? "吃"
                  : m.kind === "pung"
                    ? "碰"
                    : "杠"}
          </span>
        </div>
      ))}
    </div>
  );
}
function Opponent({
  p,
  seat,
  current,
  dealer,
  reveal = false,
  winningTile,
  activity,
}: {
  p: Player;
  seat: number;
  current: boolean;
  dealer: boolean;
  reveal?: boolean;
  winningTile?: number;
  activity?: string;
}) {
  // Only one copy of the winning tile is public before the round ends.
  const winningIndex = p.won ? p.hand.lastIndexOf(winningTile ?? -1) : -1;
  return (
    <section
      className={`opponent seat-${seat} ${current ? "current" : ""} ${p.won ? "won" : ""} ${activity ? "action-flash" : ""}`}
    >
      <div className="player-meta">
        <span className="avatar">{p.name[0]}</span>
        <div>
          <strong>{p.name}</strong>
          <span>
            {p.won
              ? "已胡牌"
              : p.voidSuit >= 0
                ? "缺" + ["万", "筒", "条"][p.voidSuit]
                : "电脑 · 进阶"}
            {dealer ? " · 庄" : ""}
          </span>
        </div>
        <b
          className={
            p.roundDelta > 0 ? "positive" : p.roundDelta < 0 ? "negative" : ""
          }
        >
          {amount(p.score)}
        </b>
      </div>
      <span className="player-action" aria-hidden={!activity}>{activity ?? ""}</span>
      <div className="opponent-hand">
        {p.hand.map((t, k) => (
          <Tile key={k} tile={t} small hidden={!reveal && k !== winningIndex} />
        ))}
      </div>
      <Melds p={p} reveal={reveal} />
    </section>
  );
}
function Setup({
  config,
  onStart,
  onClose,
  hasGame,
}: {
  config: Config;
  onStart: (c: Config) => void;
  onClose?: () => void;
  hasGame: boolean;
}) {
  const [c, setC] = useState({ ...config, bonus: { ...config.bonus } });
  const sc = c.mode === "sichuan";
  const put = (x: Partial<Config>) => setC({ ...c, ...x });
  return (
    <div className="overlay">
      <div className="setup modal">
        <div className="modal-head">
          <div>
            <span className="eyebrow">YOUR TABLE, YOUR RULES</span>
            <h2>开一桌，慢慢打。</h2>
          </div>
          {onClose && (
            <button className="icon-button" onClick={onClose} aria-label="关闭">
              ×
            </button>
          )}
        </div>
        <p className="muted">你与三位电脑对手。自由连续对局，分数持续累计。</p>
        <div className="mode-cards">
          {(["sichuan", "mcr"] as const).map((mode) => (
            <button
              key={mode}
              className={`mode-card ${c.mode === mode ? "active" : ""}`}
              onClick={() => put({ mode })}
            >
              <span className="mode-glyph">
                {mode === "sichuan" ? "川" : "国"}
              </span>
              <div>
                <strong>{rules[mode].title}</strong>
                <p>
                  {mode === "sichuan"
                    ? "换三张 · 定缺 · 血战到底"
                    : "136张 · 可吃上家 · 一家胡牌结算"}
                </p>
              </div>
              <span className="radio-dot" />
            </button>
          ))}
        </div>
        <div className="setup-fields">
          <label>电脑智能程度
            <select value={c.aiDifficulty ?? "advanced"} onChange={e => put({ aiDifficulty: e.target.value as AiDifficulty })}>
              <option value="easy">基础 · 向听与进张</option><option value="normal">标准 · 公开牌与风险</option><option value="advanced">进阶 · 做牌、后续进张与对手推断</option>
            </select>
          </label>
          <label className="switch-row">
            <div>
              <strong>计算胡牌番数</strong>
              <span>
                {c.scoring
                  ? sc
                    ? "按已确认的川麻番型计算"
                    : c.mcrEightPointMinimum !== false
                      ? "完整国标算番 · 8分起胡"
                      : "完整国标算番 · 不限制起胡分数"
                  : "合法牌型即可胡 · 每笔胡牌固定1底"}
              </span>
            </div>
            <input
              type="checkbox"
              checked={c.scoring}
              onChange={(e) => put({ scoring: e.target.checked })}
            />
          </label>
          {!sc && c.scoring && (
            <label className="switch-row">
              <div>
                <strong>至少8分才能胡牌</strong>
                <span>关闭后允许不足8分的合法牌型胡牌，仍按实际番数与8分底分结算</span>
              </div>
              <input
                type="checkbox"
                checked={c.mcrEightPointMinimum !== false}
                onChange={(e) => put({ mcrEightPointMinimum: e.target.checked })}
              />
            </label>
          )}
          {(sc || !c.scoring) && (
            <label>
              底分
              <select
                value={c.base}
                onChange={(e) => put({ base: +e.target.value })}
              >
                {[1, 2, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} 分
                  </option>
                ))}
              </select>
            </label>
          )}
          {sc && c.scoring && (
            <div className="field-grid">
              <label>
                封顶
                <select
                  value={c.cap}
                  onChange={(e) => put({ cap: +e.target.value })}
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} 番 · {2 ** n} 倍
                    </option>
                  ))}
                </select>
              </label>
              <label>
                自摸
                <select
                  value={c.selfDraw}
                  onChange={(e) =>
                    put({ selfDraw: e.target.value as Config["selfDraw"] })
                  }
                >
                  <option value="base">加底 · 封顶后＋1底</option>
                  <option value="fan">加番 · ＋1番后封顶</option>
                </select>
              </label>
            </div>
          )}
          {sc && c.scoring && (
            <details className="advanced">
              <summary>
                附加番型 · {Object.values(c.bonus).filter(Boolean).length}
                项已开启
              </summary>
              <div className="bonus-grid">
                {Object.entries(BONUS).map(([key, name]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={c.bonus[key]}
                      onChange={(e) =>
                        put({ bonus: { ...c.bonus, [key]: e.target.checked } })
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
        <div className="setup-note">
          {sc
            ? "同花色换三张，方向随机；强制定缺；允许一炮多响；杠分、查花猪、查大叫与退税开启。无过手胡、无呼叫转移。"
            : "无花牌；胡牌优先于碰杠、碰杠优先于吃。多人同时点胡时按行牌顺序取最近一家。"}
        </div>
        {hasGame && (
          <p className="warning">
            新开牌桌会重置累计分数；当前牌桌可先关闭此窗口继续。
          </p>
        )}
        <button className="primary start" onClick={() => onStart(c)}>
          {hasGame ? "重开牌桌" : "开始对局"}
          <span>→</span>
        </button>
        <p className="tiny centered">电脑只依据自己的手牌与公开信息决策</p>
      </div>
    </div>
  );
}
function RulesPanel({ config }: { config: Config }) {
  const sc = config.mode === "sichuan";
  const fans = useMemo(() => (sc ? [] : fanReference()), [sc]);
  return (
    <div className="rules-panel">
      <h3>{sc ? "川麻规则" : "国标规则"}</h3>
      {sc ? (
        <>
          <p>
            108张，无字牌、不吃。先换三张，再定缺。有缺门牌时必须优先打出，不能使用缺门牌碰杠胡。三家胡牌或牌墙摸完时结束。
          </p>
          <table>
            <tbody>
              {[
                ["平胡", "0番"],
                ["对对胡", "1番"],
                ["七对", "2番"],
                ["清一色", "＋2番"],
                ["根（含杠）", "每根＋1番"],
                ["金钩钓", "对对胡基础＋1番"],
                ["带幺九", "2番，可叠加清一色和根"],
                ["将对", "3番，替代对对胡"],
                ["杠上花／炮、抢杠", "＋1番"],
                ["海底自摸／点炮", "＋1番"],
                ["天胡／地胡", "5番，替代其他番型"],
              ].map(([a, b]) => (
                <tr key={a}>
                  <td>{a}</td>
                  <td>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            七对不叠加对对胡；龙七对按七对＋根计算。天胡：换牌定缺后庄家首打前胡；地胡：无人碰杠时胡庄家首张弃牌。
          </p>
          <p>
            直杠：放杠者付2底；补杠：每位未胡者付1底；暗杠：每位未胡者付2底。仅补杠可被抢，抢杠成功不计该次杠分。杠上花由所有其他未胡者付款。无呼叫转移、无过手胡。
          </p>
          <p>
            查花猪赔所有非花猪玩家封顶分；查大叫：非花猪的未听者赔未胡听牌者可胡最高牌型分（不含自摸或事件奖励）；未胡且未听／花猪者退还已收杠分。关闭番数时花猪和查叫每笔固定1底。
          </p>
          <p>
            胡牌退出后不再摸打或支付后续胡牌、杠分。流局罚款和退税按上述规则处理。首位胡牌者下局坐庄；首轮一炮多响时放炮者下局坐庄；流局无人胡时保留庄家。
          </p>
        </>
      ) : (
        <>
          <p>
            136张，无花牌。支持基本胡、七对、十三幺、全不靠／七星不靠、组合龙等合法结构。按完整番型兼计规则取最高合法计分。8分起胡限制可在开局时选择，默认开启；关闭后不足8分的合法牌型也可胡。
          </p>
          <p>
            自摸：每家付8＋番种总分。点炮：放炮者付8＋番种总分，另外两家各付8。杠不立即收取独立杠分。每局轮换庄家，四局换圈风，东南西北循环。
          </p>
          <div className="fan-list">
            {fans
              .filter((f) => f.name !== "花牌")
              .map((f) => (
                <div key={f.name}>
                  <span>{f.name}</span>
                  <b>{f.value}分</b>
                </div>
              ))}
          </div>
          <p className="tiny">
            明暗杠5分作为一明杠与一暗杠的组合处理。算番算法：Jeff Wang /
            summerinsects，MIT许可。
          </p>
        </>
      )}
      <h4>简化计分</h4>
      <p>
        关闭番数后取消国标8分门槛和8分底分；点炮由放炮者付1底，自摸由所有其他未胡者各付1底，合法特殊胡牌结构仍支持。
      </p>
      <h4>操作</h4>
      <p>
        点击手牌选中，再点“打出”或双击式再次点击确认。空格确认出牌；数字1–9选前九张牌。吃碰杠胡由按钮选择；有多种吃法时逐项展示。
      </p>
    </div>
  );
}
function App() {
  const online = useRoom();
  const [roomsOpen, setRoomsOpen] = useState(!!online.session || new URL(location.href).searchParams.has("room"));
  const [createName, setCreateName] = useState<string | null>(null);
  const [ready, setReady] = useState(false),
    [failure, setFailure] = useState(""),
    [localGame, setGame] = useState<Game | null>(validInitial);
  const game = online.session ? online.room?.game ?? null : localGame;
  const [localSession, setLocalSession] = useState(0);
  const [config, setConfig] = useState<Config>(
      validInitial?.config ?? defaultConfig,
    ),
    [setup, setSetup] = useState(!validInitial && !online.session && !new URL(location.href).searchParams.has("room"));
  const [selected, setSelected] = useState<number[]>([]),
    [prefs, setPrefs] = useState(
      { hints: true, sound: true, voice: true, voiceChoice: "auto", voiceRate: .92, speed: 650, assistantStyle: "balanced" as PlayStyle,
        ...stored<Partial<{ hints: boolean; sound: boolean; voice: boolean; voiceChoice: string; voiceRate: number; speed: number; assistantStyle: PlayStyle }>>(PREF, {}) },
    );
  const [paused, setPaused] = useState(false),
    [tab, setTab] = useState<"advice" | "log" | "rules">("advice");
  const [replay, setReplay] = useState<Frame[] | null>(null),
    [replayIndex, setReplayIndex] = useState(0),
    [replayPlay, setReplayPlay] = useState(false),
    [notice, setNotice] = useState(""),
    [saveWarning, setSaveWarning] = useState("");
  const feedbackStream = `${online.session?.id ?? `solo:${localSession}`}:${game?.round ?? 0}:${game?.seed ?? 0}`;
  const feedback = useTableFeedback(game, feedbackStream, !!replay, prefs.voice, prefs.sound, sound, prefs.voiceChoice, prefs.voiceRate);
  const latestDiscard = !replay ? [...(game?.events ?? [])].reverse().find(e => e.kind === "discard") : undefined;
  useEffect(() => {
    initCore()
      .then(() => setReady(true))
      .catch((e) => setFailure(String(e)));
  }, []);
  useEffect(() => {
    if (game && !online.session && game.seed !== 0)
      try {
        localStorage.setItem(SAVE, JSON.stringify(game));
        setSaveWarning("");
      } catch {
        setSaveWarning(
          "浏览器存储空间不足，自动保存失败。请下载存档以保留进度。",
        );
      }
  }, [game, online.session]);
  useEffect(() => {
    if (!online.room) return;
    setConfig(online.room.config);
    setSetup(false);
    setPaused(false);
  }, [online.room]);
  useEffect(() => { online.setAdviceStyle(prefs.assistantStyle); }, [prefs.assistantStyle]);
  useEffect(() => {
    setSelected([]);
    setReplay(null);
  }, [online.room?.stage]);
  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  const change = (fn: (g: Game) => void, _sfx = "discard", command?: RoomCommand) => {
    if (online.session) {
      if (command) void online.send(command).then(ok => { if (ok) setSelected([]); });
      return;
    }
    if (!game) return;
    try {
      const next = copyGame(game);
      fn(next);
      setGame(next);
      setNotice("");
      setSelected([]);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const auto =
    !online.session &&
    ready &&
    game &&
    !paused &&
    !setup &&
    !replay &&
    ((game.phase === "turn" && game.current !== 0) ||
      (game.pending &&
        (game.pending.responses.some((x, i) => i !== 0 && x === null) ||
          game.pending.responses.every((x) => x !== null))));
  useEffect(() => {
    if (!auto || !game) return;
    const id = setTimeout(() => {
      const n = copyGame(game);
      try {
        if (n.pending) {
          for (let i = 1; i < 4; i++)
            if (n.pending.responses[i] === null)
              respond(
                n,
                i,
                chooseResponse(publicView(n, i), n.pending.actions[i]),
              );
          advance(n);
        } else if (n.phase === "turn" && n.current !== 0) {
          const i = n.current,
            v = publicView(n, i),
            a = chooseOwn(v, ownActions(n, i));
          if (a) act(n, i, a);
          else discard(n, i, advise(v)[0].tile);
        }
        setGame(n);
      } catch (e) {
        setPaused(true);
        setNotice("对局已暂停：" + String(e));
      }
    }, prefs.speed);
    return () => clearTimeout(id);
  }, [auto, game, paused, setup, replay, prefs.speed, prefs.sound]);
  useEffect(() => {
    if (!replayPlay || !replay) return;
    const id = setInterval(
      () =>
        setReplayIndex((i) => {
          if (i >= replay.length - 1) {
            setReplayPlay(false);
            return i;
          }
          return i + 1;
        }),
      900,
    );
    return () => clearInterval(id);
  }, [replayPlay, replay]);
  const ourTurn =
    game?.phase === "turn" && game.current === 0 && !game.players[0].won &&
    (!online.session || (!!online.room && !online.room.seats[0].autoplay && !online.busy));
  const analysis = useMemo(
    () =>
      ready && game && ourTurn && prefs.hints && !replay
        ? online.session ? online.advice : advise(publicView(game, 0), { style: prefs.assistantStyle, difficulty: "advanced" })
        : [],
    [ready, game, ourTurn, prefs.hints, prefs.assistantStyle, replay, online.session, online.advice],
  );
  const waiting = useMemo(() => {
    if (
      !ready ||
      !game ||
      !prefs.hints ||
      game.players[0].won ||
      game.phase === "exchange" ||
      game.phase === "void"
    )
      return null;
    const p = game.players[0];
    if (p.hand.length % 3 !== 1) return null;
    const v = publicView(game, 0),
      r = evaluate(v.hand, v.melds, game.config.mode === "mcr"),
      k = knownCounts(v);
    return {
      ...r,
      useful: r.useful
        .filter(
          (t) =>
            t < rules[game.config.mode].tiles &&
            (game.config.mode !== "sichuan" || suit(t) !== p.voidSuit),
        )
        .map((tile) => ({ tile, left: Math.max(0, 4 - k[tile]) })),
    };
  }, [ready, game, prefs.hints]);
  const playerActions = online.session ? online.room?.actions ?? [] : game ? ownActions(game, 0) : [];
  const claim =
    online.session ? online.room && !online.room.seats[0].autoplay ? online.room.claims : [] : game?.pending && game.pending.responses[0] === null
      ? game.pending.actions[0]
      : [];
  const display = game ? (replay ? replay[replayIndex] : snapshot(game)) : null;
  const hideWonHand = !!game && !replay && game.config.mode === "sichuan" &&
    game.phase !== "end" && game.players[0].won;
  const humanWinningIndex = game?.players[0].hand.lastIndexOf(
    game.winners.find((w) => w.player === 0)?.tile ?? -1,
  ) ?? -1;
  const start = (c: Config) => {
    if (createName !== null) {
      void online.enter(createName, c);
      setCreateName(null); setSetup(false); return;
    }
    setConfig(c);
    setLocalSession(n => n + 1);
    setGame(newGame(c));
    setSetup(false);
    setPaused(false);
    setReplay(null);
    setSelected([]);
    setNotice("");
    sound("start", prefs.sound);
  };
  const submitDiscard = () => {
    if (game && ourTurn && selected.length === 1)
      change((g) => discard(g, 0, g.players[0].hand[selected[0]]), "discard", { type: "discard", tile: game.players[0].hand[selected[0]] });
  };
  const pick = (k: number) => {
    if (!game || replay) return;
    if (game.phase === "exchange") {
      setSelected((xs) =>
        xs.includes(k)
          ? xs.filter((x) => x !== k)
          : xs.length < 3
            ? [...xs, k]
            : xs,
      );
      return;
    }
    if (ourTurn) {
      if (selected.length === 1 && selected[0] === k)
        change((g) => discard(g, 0, g.players[0].hand[k]), "discard", { type: "discard", tile: game.players[0].hand[k] });
      else setSelected([k]);
    }
  };
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        setup ||
        replay
      )
        return;
      if (e.code === "Space" && ourTurn) {
        e.preventDefault();
        submitDiscard();
      } else if (/^[1-9]$/.test(e.key) && ourTurn) pick(+e.key - 1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  function download(value: unknown, name: string) {
    const a = document.createElement("a");
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    a.href = u;
    a.download = name;
    a.click();
    URL.revokeObjectURL(u);
  }
  const openReplay = (frames: Frame[]) => {
    setReplay(frames);
    setReplayIndex(0);
    setReplayPlay(false);
  };
  if (failure)
    return (
      <div className="loading">
        <h2>规则引擎加载失败</h2>
        <p>{failure}</p>
        <button onClick={() => location.reload()}>重新加载</button>
      </div>
    );
  if (!ready)
    return (
      <div className="loading">
        <div className="brand-mark">一</div>
        <h2>一桌麻将</h2>
        <p>正在准备牌桌与规则引擎…</p>
      </div>
    );
  const title = game?.config.mode === "mcr" ? "国标麻将" : "四川麻将";
  let status = "等待开始";
  if (game) {
    status = replay
      ? "牌谱回放"
      : game.phase === "exchange"
        ? "请选择三张同花色牌交换"
        : game.phase === "void"
          ? "选择本局要打缺的花色"
          : game.phase === "end"
            ? game.endReason
            : claim.length
              ? "这张牌可以操作"
              : ourTurn
                ? "轮到你出牌"
                : game.players[0].won
                  ? "你已胡牌，观看剩余对局"
                  : `${game.players[game.current].name}正在思考`;
  }
  if (online.pending) status = `正在提交${online.pending.type === "claim" || online.pending.type === "act" ? actionName(online.pending.action.type) : "操作"}…`;
  else if (online.room?.game?.pending?.responses[0] && online.room.game.pending.actions[0].length) status = `已选择${actionName(online.room.game.pending.responses[0].type)}，等待其他玩家`;
  return (
    <div className={`app ${replay ? "is-replay" : ""}`} translate="no" onPointerDownCapture={feedback.unlock} onKeyDownCapture={feedback.unlock}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">一</span>
          <div>
            <h1>一桌麻将</h1>
            <span>JUST ONE MORE HAND</span>
          </div>
        </div>
        <div className="header-tools">
          <span className="save-status">
            {online.session ? online.connected ? "联机牌局已同步" : "正在重连" : saveWarning
              ? "存档异常"
              : game
                ? "进度已自动保存"
                : "单人 · 三位电脑"}
          </span>
          <button onClick={() => setRoomsOpen(v => !v)}>联机房间</button>
          <button disabled={!!online.session} onClick={() => { setCreateName(null); setSetup(true); }}>新牌桌</button>
          <button className="text-button" onClick={() => setTab("rules")}>
            规则
          </button>
        </div>
      </header>
      <main>
        {(roomsOpen || online.session) && <RoomPanel room={online.room} active={!!online.session}
          busy={online.busy} connected={online.connected} error={online.error}
          onCreate={name => { setCreateName(name); setSetup(true); }}
          onJoin={(name, id) => void online.enter(name, undefined, id)} send={async c => {
            const ok = await online.send(c);
            if (ok && c.type === "leave") { setGame(stored<Game | null>(SAVE, null)); setReplay(null); }
            return ok;
          }}
          forget={() => { online.forget(); setGame(stored<Game | null>(SAVE, null)); }} />}
        <div className="game-heading">
          <div>
            <span className="eyebrow">{replay ? "REPLAY" : online.session ? "ONLINE TABLE" : "SOLO TABLE"}</span>
            <h2>
              {online.session && !game ? "等待开局" : title}
              <span className="pill">
                {game?.config.scoring ? "番数计分" : "简化计分"}
              </span>
            </h2>
          </div>
          <div className="game-controls">
            <label>电脑
              <select aria-label="电脑智能程度" value={game?.config.aiDifficulty ?? config.aiDifficulty ?? "advanced"}
                disabled={!!online.session && (!online.room?.isHost || online.busy)}
                onChange={e => { const difficulty = e.target.value as AiDifficulty;
                  if (online.session) void online.send({ type: "difficulty", difficulty });
                  else { setConfig({ ...config, aiDifficulty: difficulty }); if (game) setGame({ ...game, config: { ...game.config, aiDifficulty: difficulty } }); }
                }}>
                <option value="easy">基础</option><option value="normal">标准</option><option value="advanced">进阶</option>
              </select>
            </label>
            <label>助手
              <select aria-label="打牌助手风格" value={prefs.assistantStyle} onChange={e => setPrefs({ ...prefs, assistantStyle: e.target.value as PlayStyle })}>
                <option value="attack">偏进攻</option><option value="balanced">攻守平衡</option><option value="defense">偏防守</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={prefs.hints}
                onChange={(e) =>
                  setPrefs({ ...prefs, hints: e.target.checked })
                }
              />
              提示
            </label>
            <label>
              <input
                type="checkbox"
                checked={prefs.sound}
                onChange={(e) =>
                  setPrefs({ ...prefs, sound: e.target.checked })
                }
              />
              音效
            </label>
            <label title={feedback.supported ? "播报已确认的出牌和吃碰杠胡" : "此浏览器不支持语音播报"}>
              <input type="checkbox" checked={prefs.voice} disabled={!feedback.supported}
                onChange={e => setPrefs({ ...prefs, voice: e.target.checked })} />
              语音
            </label>
            <label>音色
              <select className="voice-select" aria-label="播报音色" disabled={!feedback.supported || !prefs.voice} value={prefs.voiceChoice}
                onChange={e => setPrefs({ ...prefs, voiceChoice: e.target.value })}>
                <option value="auto">自动 · 优先柔和女声</option>
                {feedback.voices.map(v => <option key={voiceId(v)} value={voiceId(v)}>{v.name}{voiceKind(v) === "female" ? " · 女声" : ""}</option>)}
                {prefs.voiceChoice !== "auto" && !feedback.voices.some(v => voiceId(v) === prefs.voiceChoice) && <option value={prefs.voiceChoice}>原音色不可用 · 自动选择</option>}
              </select>
            </label>
            <label>语速
              <select aria-label="播报语速" disabled={!prefs.voice || !feedback.supported} value={prefs.voiceRate}
                onChange={e => setPrefs({ ...prefs, voiceRate: Number(e.target.value) })}>
                <option value={.85}>舒缓</option><option value={.92}>柔和</option><option value={1.05}>轻快</option>
              </select>
            </label>
            <button className="voice-preview" disabled={!feedback.supported || !prefs.voice} onClick={feedback.preview}>试听语音</button>
            <button
              onClick={() => setPaused(!paused)}
              disabled={!!online.session || !game || game.phase === "end"}
            >
              {paused ? "继续" : "暂停"}
            </button>
            <select
              aria-label="电脑出牌速度"
              disabled={!!online.session}
              value={prefs.speed}
              onChange={(e) => setPrefs({ ...prefs, speed: +e.target.value })}
            >
              <option value={1100}>慢速</option>
              <option value={650}>标准</option>
              <option value={180}>快速</option>
            </select>
          </div>
        </div>
        {(feedback.voiceError || !feedback.supported) && <p className="voice-note" role="status">{feedback.voiceError || "此浏览器不支持语音播报；可继续正常打牌。"}</p>}
        {prefs.voice && feedback.supported && feedback.voicesLoaded && <p className="voice-current">
          {feedback.selectedVoice ? `当前音色：${feedback.selectedVoice.name}${voiceKind(feedback.selectedVoice) === "female" ? " · 女声" : " · 可换音色试听"}` : "未检测到可选中文音色，将尝试系统默认中文声音"}
        </p>}
        <div className="layout">
          <div className="table-column">
            <div className="table">
              <div className="table-topline">
                <span className="round-badge">
                  第 {display?.round ?? game?.round ?? 1} 局
                  {game?.config.mode === "mcr"
                    ? ` · ${["东", "南", "西", "北"][display?.wind ?? game.wind]}风圈`
                    : ""}
                </span>
                <span className="table-state">{replay ? "牌谱回放" : game?.phase === "end" ? "本局结束" : claim.length ? "等待你的响应" : ourTurn ? "轮到你出牌" : "牌局进行中"}</span>
                <span className="remaining-badge"><strong>{display?.remaining ?? (config.mode === "sichuan" ? 55 : 83)}</strong><span>张余牌</span></span>
              </div>
              {display && game ? (
                <>
                  <Opponent
                    p={display.players[2]}
                    seat={2}
                    activity={feedback.activity?.actor === 2 ? eventLabel(feedback.activity) : undefined}
                    winningTile={game.winners.find((w) => w.player === 2)?.tile}
                    current={display.current === 2 && display.phase !== "end"}
                    dealer={display.dealer === 2}
                    reveal={!!replay || game.phase === "end"}
                  />
                  <Opponent
                    p={display.players[3]}
                    seat={3}
                    activity={feedback.activity?.actor === 3 ? eventLabel(feedback.activity) : undefined}
                    winningTile={game.winners.find((w) => w.player === 3)?.tile}
                    current={display.current === 3 && display.phase !== "end"}
                    dealer={display.dealer === 3}
                    reveal={!!replay || game.phase === "end"}
                  />
                  <Opponent
                    p={display.players[1]}
                    seat={1}
                    activity={feedback.activity?.actor === 1 ? eventLabel(feedback.activity) : undefined}
                    winningTile={game.winners.find((w) => w.player === 1)?.tile}
                    current={display.current === 1 && display.phase !== "end"}
                    dealer={display.dealer === 1}
                    reveal={!!replay || game.phase === "end"}
                  />
                  <div className="river-area">
                    {[2, 3, 1, 0].map((i) => (
                      <div key={i} className={`river river-${i}`}>
                        <div className="river-label">
                          {display.players[i].name}
                          <span>{display.players[i].river.length}张</span>
                        </div>
                        <div className="river-tiles">
                          {display.players[i].river.map((t, k) => (
                            <Tile
                              key={k}
                              tile={t}
                              small
                              entering={feedback.activity?.kind === "discard" && feedback.activity.actor === i && k === display.players[i].river.length - 1}
                              selected={
                                k === display.players[i].river.length - 1 &&
                                display.lastFrom === i
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                    <CenterFeedback mode={game.config.mode} activity={feedback.activity}
                      actorName={feedback.activity ? display.players[feedback.activity.actor].name : ""}
                      tile={display.lastTile ?? latestDiscard?.tile}
                      caption={display.phase === "end" ? "本局已结束" : display.lastTile !== undefined ? "当前出牌" : latestDiscard ? "上一张出牌" : "等待出牌"}
                      eventKey={`${feedbackStream}:${feedback.activity?.id ?? 0}`}
                      tileKey={replay ? `replay:${replayIndex}` : `${feedbackStream}:${latestDiscard?.id ?? 0}`}
                      replay={!!replay} />
                  </div>
                  <div className={`human-zone ${feedback.activity?.actor === 0 ? "action-flash" : ""}`}>
                    <div className="human-info">
                      <div>
                        <strong>{display.players[0].name}</strong>
                        <span>
                          {display.dealer === 0 ? "庄家 · " : ""}
                          {display.players[0].voidSuit >= 0
                            ? "缺" +
                              ["万", "筒", "条"][display.players[0].voidSuit]
                            : game.config.mode === "mcr"
                              ? ["东", "南", "西", "北"][
                                  (0 - display.dealer + 4) % 4
                                ] + "风位"
                              : "等待定缺"}
                          {display.players[0].won ? " · 已胡牌" : ""}
                        </span>
                      </div>
                      <b
                        className={
                          display.players[0].roundDelta >= 0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {amount(display.players[0].score)}
                        <small> 累计分</small>
                        <span className="round-delta">本局 {amount(display.players[0].roundDelta)}</span>
                      </b>
                    </div>
                    <Melds p={display.players[0]} reveal={!hideWonHand} />
                    <div className="human-hand">
                      {display.players[0].hand.map((t, k) => {
                        const allowed =
                          (game.phase === "exchange" && (!online.session || (!!online.room && !online.room.exchangeReady[0] && !online.room.seats[0].autoplay && !online.busy))) ||
                          (ourTurn && allowedDiscards(game, 0).includes(t));
                        return (
                          <Tile
                            key={k}
                            tile={t}
                            hidden={hideWonHand && k !== humanWinningIndex}
                            selected={!replay && selected.includes(k)}
                            suggested={!replay && analysis[0]?.tile === t}
                            dim={!replay && ourTurn && !allowed}
                            disabled={!allowed || !!replay}
                            onClick={() => pick(k)}
                            drawn={
                              !replay &&
                              game.drawnTile === t &&
                              game.current === 0 &&
                              game.phase === "turn" &&
                              display.players[0].hand.lastIndexOf(t) === k
                            }
                          />
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-table">
                  <span className="empty-glyph">一</span>
                  <p>一张牌，一次选择。</p>
                </div>
              )}
            </div>
            <div className="action-bar" aria-live="polite">
              <div className="turn-status">
                <span className={`status-dot ${ourTurn ? "you" : ""}`} />
                <strong>{paused && !replay ? "对局已暂停" : status}</strong>
                <span className="muted">{online.error || notice || saveWarning}</span>
              </div>
              <div className="actions">
                {game && !replay && game.phase === "exchange" && (!online.session || (online.room && !online.room.exchangeReady[0] && !online.room.seats[0].autoplay && !online.busy)) && (
                  <button
                    className="primary"
                    disabled={
                      selected.length !== 3 ||
                      new Set(
                        selected.map((k) => suit(game.players[0].hand[k])),
                      ).size !== 1
                    }
                    onClick={() =>
                      change(
                        (g) =>
                          doExchange(
                            g,
                            selected.map((k) => g.players[0].hand[k]),
                          ),
                        "chow",
                        { type: "exchange", tiles: selected.map(k => game.players[0].hand[k]) },
                      )
                    }
                  >
                    换三张（{selected.length}/3）
                  </button>
                )}
                {game &&
                  !replay &&
                  game.phase === "void" &&
                  (!online.session || (online.room && !online.room.voidReady[0] && !online.room.seats[0].autoplay && !online.busy)) &&
                  [0, 1, 2].map((s) => (
                    <button
                      key={s}
                      onClick={() => change((g) => doVoid(g, s), "chow", { type: "void", suit: s })}
                    >
                      缺{["万", "筒", "条"][s]}
                    </button>
                  ))}
                {!replay &&
                  claim.map((a, k) => (
                    <button
                      className={a.type === "win" ? "primary" : ""}
                      key={`${a.type}:${a.tile}:${a.tiles?.join(",")}`}
                      disabled={online.busy}
                      onClick={() => change((g) => respond(g, 0, a), a.type, { type: "claim", action: a })}
                    >
                      {a.type === "win"
                        ? "胡"
                        : a.type === "pung"
                          ? "碰"
                          : a.type === "kong"
                            ? "杠"
                            : `吃 ${a.tiles!.map(tileName).join(" ")}`}
                    </button>
                  ))}
                {!replay && claim.length > 0 && (
                  <button
                    disabled={online.busy}
                    onClick={() =>
                      change((g) => respond(g, 0, { type: "pass" }), "pass", { type: "claim", action: { type: "pass" } })
                    }
                  >
                    过
                  </button>
                )}
                {!replay &&
                  ourTurn &&
                  playerActions.map((a, k) => (
                    <button
                      className={a.type === "win" ? "primary" : ""}
                      key={k}
                      onClick={() => change((g) => act(g, 0, a), a.type, { type: "act", action: a })}
                    >
                      {a.type === "win"
                        ? "自摸"
                        : a.type === "concealedKong"
                          ? "暗杠 " + tileName(a.tile!)
                          : "补杠 " + tileName(a.tile!)}
                    </button>
                  ))}
                {!replay && ourTurn && (
                  <button
                    className="primary"
                    disabled={
                      selected.length !== 1 ||
                      !game ||
                      !allowedDiscards(game, 0).includes(
                        game.players[0].hand[selected[0]],
                      )
                    }
                    onClick={submitDiscard}
                  >
                    打出
                    {selected.length === 1 && game
                      ? " " + tileName(game.players[0].hand[selected[0]])
                      : ""}
                  </button>
                )}
                {!replay && game?.phase === "end" && (
                  <>
                    <button onClick={() => openReplay(game.frames)}>
                      复盘本局
                    </button>
                    <button
                      className="primary"
                      disabled={!!online.session && (!online.room?.isHost || online.busy)}
                      onClick={() => {
                        if (online.session) { void online.send({ type: "next" }); return; }
                        setGame(newGame(game.config, game));
                        setSelected([]);
                        setPaused(false);
                      }}
                    >
                      继续下一局 →
                    </button>
                  </>
                )}
                {replay && (
                  <button
                    onClick={() => {
                      setReplay(null);
                      setReplayPlay(false);
                    }}
                  >
                    返回牌桌
                  </button>
                )}
              </div>
            </div>
            {replay && (
              <div className="replay-bar">
                <button
                  disabled={replayIndex === 0}
                  onClick={() => setReplayIndex((i) => i - 1)}
                >
                  上一步
                </button>
                <button onClick={() => setReplayPlay(!replayPlay)}>
                  {replayPlay ? "暂停回放" : "自动回放"}
                </button>
                <input
                  aria-label="回放进度"
                  type="range"
                  min={0}
                  max={replay.length - 1}
                  value={replayIndex}
                  onChange={(e) => setReplayIndex(+e.target.value)}
                />
                <button
                  disabled={replayIndex === replay.length - 1}
                  onClick={() => setReplayIndex((i) => i + 1)}
                >
                  下一步
                </button>
                <span>
                  {replayIndex + 1}/{replay.length} ·{" "}
                  {replay[replayIndex].label}
                </span>
              </div>
            )}
            {game?.phase === "end" && !replay && (
              <section className="result">
                <div className="result-heading">
                  <h3>本局结算</h3>
                  <span>{game.endReason}</span>
                </div>
                <div className="score-grid">
                  {[...game.players]
                    .sort((a, b) => b.score - a.score)
                    .map((p) => (
                      <div key={p.name}>
                        <span>{p.name}</span>
                        <strong
                          className={
                            p.roundDelta >= 0 ? "positive" : "negative"
                          }
                        >
                          {amount(p.roundDelta)}
                        </strong>
                        <small>累计 {amount(p.score)}</small>
                      </div>
                    ))}
                </div>
                {game.winners.map((w, k) => (
                  <div className="winner-detail" key={k}>
                    <strong>
                      {game.players[w.player].name} ·{" "}
                      {w.self ? "自摸" : "胡" + game.players[w.from].name} ·{" "}
                      {w.score.fan}
                      {game.config.mode === "mcr" ? "分" : "番"}
                    </strong>
                    <span>
                      {w.score.items
                        .map((f) => f.name + (f.count > 1 ? "×" + f.count : ""))
                        .join(" ＋ ")}{" "}
                      · 收入 {w.received}
                    </span>
                  </div>
                ))}
                <details>
                  <summary>查看逐笔收支（{game.payments.length}笔）</summary>
                  <div className="payment-list">
                    {game.payments.map((p, k) => (
                      <div key={k}>
                        <span>
                          {game.players[p.from].name} →{" "}
                          {game.players[p.to].name}
                        </span>
                        <span>{p.note}</span>
                        <b>{p.amount}</b>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            )}
          </div>
          <aside>
            <div className="aside-tabs">
              {(["advice", "log", "rules"] as const).map((t) => (
                <button
                  className={tab === t ? "active" : ""}
                  key={t}
                  onClick={() => setTab(t)}
                >
                  {t === "advice"
                    ? "打牌助手"
                    : t === "log"
                      ? "对局记录"
                      : "规则说明"}
                </button>
              ))}
            </div>
            {tab === "advice" ? (
              <div className="advice-panel">
                <span className="eyebrow">A LITTLE CLARITY</span>
                <h3>{replay ? "先看选择，再看结果。" : "下一张，怎么打？"}</h3>
                {online.session && prefs.hints && ourTurn && (online.adviceLoading || online.adviceError) &&
                  <p className="tiny" role="status">{online.adviceError || "后端正在重新计算当前风格的建议…"}</p>}
                {!prefs.hints ? (
                  <p className="muted">
                    提示已关闭。打开右上方“提示”即可查看向听数与进张建议。
                  </p>
                ) : analysis.length > 0 ? (
                  <>
                    <div className="recommend">
                      <Tile tile={analysis[0].tile} />
                      <div>
                        <span>建议打出</span>
                        <strong>{tileName(analysis[0].tile)}</strong>
                        <p>{analysis[0].reason}</p>
                      </div>
                    </div>
                    <div className="metrics">
                      <div>
                        <strong>{analysis[0].shanten}</strong>
                        <span>向听数</span>
                      </div>
                      <div>
                        <strong>{analysis[0].ukeire}</strong>
                        <span>有效进张</span>
                      </div>
                      <div>
                        <strong>
                          {analysis[0].risk < 1.4
                            ? "低"
                            : analysis[0].risk < 3
                              ? "中"
                              : "高"}
                        </strong>
                        <span>估计风险</span>
                      </div>
                    </div>
                    <h4>有效进张</h4>
                    <div className="useful">
                      {analysis[0].useful
                        .filter((x) => x.left > 0)
                        .map((x) => (
                          <span key={x.tile}>
                            <Tile tile={x.tile} small />
                            <small>约{x.left}张</small>
                          </span>
                        ))}
                    </div>
                    <h4>其他候选</h4>
                    <div className="alternatives">
                      {analysis.slice(1, 4).map((a) => (
                        <button
                          key={a.tile}
                          onClick={() =>
                            game &&
                            setSelected([game.players[0].hand.indexOf(a.tile)])
                          }
                        >
                          <Tile tile={a.tile} small />
                          <span>
                            {a.shanten}向听 · {a.ukeire}进张
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : waiting ? (
                  <>
                    <p className="muted">
                      {waiting.shanten === 0
                        ? "结构已听牌"
                        : `当前${waiting.shanten}向听`}
                      。
                      {game?.config.mode === "mcr" && game.config.scoring && game.config.mcrEightPointMinimum !== false
                        ? "国标还需满足8分起胡条件。"
                        : ""}
                    </p>
                    <div className="useful">
                      {waiting.useful
                        .filter((x) => x.left > 0)
                        .map((x) => (
                          <span key={x.tile}>
                            <Tile tile={x.tile} small />
                            <small>约{x.left}张</small>
                          </span>
                        ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    {game?.phase === "exchange"
                      ? "选择不适合当前做牌方向的三张同花色牌。"
                      : game?.phase === "void"
                        ? "通常优先打缺数量少、连接较差的一门。"
                        : game?.phase === "end"
                          ? "打开牌谱回放，查看四家手牌与每一步操作。"
                          : "轮到你出牌时，这里会给出向听数、有效进张和策略建议。"}
                  </p>
                )}
                {ourTurn &&
                  game?.config.mode === "mcr" &&
                  game.config.scoring &&
                  !playerActions.some((a) => a.type === "win") && (
                    <p className="tiny">
                      {winScore(game, 0, true).reason?.includes("仅")
                        ? winScore(game, 0, true).reason
                        : ""}
                    </p>
                  )}
                <div className="assistant-note">
                  向听数0表示结构听牌。进张数量根据你的手牌和公开牌估算；弃牌与筋只是风险线索，不保证安全。
                </div>
                <div className="storage-tools">
                  <button
                    disabled={!!online.session || !game}
                    onClick={() => game && download(game, "一桌麻将-存档.json")}
                  >
                    下载存档
                  </button>
                  <label className="file-button">
                    导入存档
                    <input
                      type="file"
                      disabled={!!online.session}
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const n = JSON.parse(await f.text()) as Game;
                          if (
                            n.version !== 3 ||
                            n.players?.length !== 4 ||
                            !rules[n.config?.mode]
                          )
                            throw Error("存档格式不匹配");
                          setLocalSession(value => value + 1);
                          setGame(n);
                          n.config = { ...defaultConfig, ...n.config };
                          setConfig(n.config);
                          setSetup(false);
                          setReplay(null);
                          setSelected([]);
                          setPaused(true);
                          setNotice("存档已导入，点击继续恢复。");
                        } catch (err) {
                          setNotice("导入失败：" + String(err));
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : tab === "log" ? (
              <div className="log-panel">
                <h3>这局发生了什么</h3>
                <ol>
                  {(game?.log ?? []).map((s, k) => (
                    <li key={k}>
                      <span>{String(k + 1).padStart(2, "0")}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                {game?.phase === "end" && (
                  <button
                    onClick={() =>
                      download(
                        {
                          config: game.config,
                          frames: game.frames,
                          payments: game.payments,
                        },
                        "一桌麻将-牌谱.json",
                      )
                    }
                  >
                    下载本局牌谱
                  </button>
                )}
                {!!game?.previous.length && (
                  <>
                    <h4>最近三局</h4>
                    {game.previous.map((fs, k) => (
                      <button
                        className="history-button"
                        key={k}
                        onClick={() => openReplay(fs)}
                      >
                        复盘第 {game.round - game.previous.length + k} 局 ·{" "}
                        {fs.length} 步
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <RulesPanel config={game?.config ?? config} />
            )}
          </aside>
        </div>
        <footer>
          <span>一桌麻将 · 认真打牌，慢慢来。</span>
          <span>川麻 / 国标 · 进阶电脑 · 本地续局</span>
        </footer>
      </main>
      {setup && (
        <Setup
          config={config}
          onStart={start}
          onClose={game || createName !== null ? () => { setSetup(false); setCreateName(null); } : undefined}
          hasGame={!!game}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
