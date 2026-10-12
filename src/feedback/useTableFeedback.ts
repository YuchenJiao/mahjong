import { useEffect, useRef, useState } from "react";
import type { Game, TableEvent } from "../engine/types";
import { EventCursor } from "./events";
import { browserSpeech, chineseVoice, chineseVoices, VoiceAnnouncer } from "./voice";

export function useTableFeedback(game: Game | null, stream: string, replay: boolean,
  voiceEnabled: boolean, soundEnabled: boolean, sound: (kind: string, enabled: boolean) => void,
  voiceChoice = "auto", voiceRate = .92) {
  const cursor = useRef(new EventCursor());
  const unlocked = useRef(false);
  const [voiceError, setVoiceError] = useState("");
  const speaker = useRef<VoiceAnnouncer | null>(null);
  if (!speaker.current) speaker.current = new VoiceAnnouncer(browserSpeech(), () => setVoiceError("语音未能播放，请点试听或检查系统中文声音"));
  const [activity, setActivity] = useState<TableEvent | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  useEffect(() => {
    const platform = browserSpeech();
    if (!platform) return;
    const refresh = () => {
      try { setVoices(chineseVoices(platform.synth.getVoices())); } catch { setVoices([]); }
    };
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    const timer = setTimeout(() => { refresh(); setVoicesLoaded(true); }, 1200);
    return () => { clearTimeout(timer); window.speechSynthesis.removeEventListener("voiceschanged", refresh); };
  }, []);
  useEffect(() => { speaker.current!.configure(voiceChoice, voiceRate); setVoiceError(""); }, [voiceChoice, voiceRate]);
  useEffect(() => {
    const fresh = cursor.current.read(stream, game?.events ?? [], replay);
    if (!fresh.length) return;
    setActivity(fresh.at(-1)!);
    fresh.forEach(e => {
      sound(e.kind, soundEnabled);
      if (voiceEnabled && unlocked.current && document.visibilityState !== "hidden") speaker.current!.announce(e);
    });
  }, [game, stream, replay, voiceEnabled, soundEnabled, sound]);
  useEffect(() => {
    setActivity(null);
    speaker.current!.stop();
  }, [stream]);
  useEffect(() => {
    if (!activity) return;
    const timer = setTimeout(() => setActivity(null), activity.kind === "win" ? 2600 : 1800);
    return () => clearTimeout(timer);
  }, [activity]);
  useEffect(() => { if (!voiceEnabled || replay) speaker.current!.stop(); }, [voiceEnabled, replay]);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") speaker.current!.stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); speaker.current!.stop(); };
  }, []);
  return { activity: replay ? null : activity, voiceError, supported: speaker.current.supported,
    voices, voicesLoaded, selectedVoice: chineseVoice(voices, voiceChoice),
    unlock: () => { unlocked.current = true; },
    preview: () => { unlocked.current = true; setVoiceError(""); speaker.current!.preview(); } };
}
