import type { TableEvent } from "../engine/types";
import { eventSpeech } from "./events";

export type SpeechPlatform = {
  synth: Pick<SpeechSynthesis, "speak" | "cancel" | "resume" | "getVoices">;
  utterance: (text: string) => SpeechSynthesisUtterance;
};
export function browserSpeech(): SpeechPlatform | null {
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") return null;
  return { synth: window.speechSynthesis, utterance: text => new SpeechSynthesisUtterance(text) };
}
export const voiceId = (voice: SpeechSynthesisVoice) => JSON.stringify([voice.voiceURI ?? "", voice.name ?? "", voice.lang]);
const femaleNames = /xiaoxiao|xiaohan|xiaomo|xiaoyi|xiaoshuang|xiaomeng|晓晓|晓涵|晓墨|晓伊|晓双|晓梦|ting[ -]?ting|婷婷|mei[ -]?jia|美佳|sin[ -]?ji|善怡/i;
const maleNames = /yunxi|yunyang|yunjian|yunxia|yunfeng|yunhao|云希|云扬|云健|云夏|云枫|云皓|kangkang|康康|liangliang|亮亮|zhiwei|智伟/i;
export function voiceKind(v: SpeechSynthesisVoice): "female" | "male" | "unknown" {
  const name = `${v.name ?? ""} ${v.voiceURI ?? ""}`;
  if (femaleNames.test(name)) return "female";
  if (maleNames.test(name)) return "male";
  return "unknown"; // The Web Speech API does not provide a gender property.
}
function voiceRank(v: SpeechSynthesisVoice) {
  const name = `${v.name ?? ""} ${v.voiceURI ?? ""}`, kind = voiceKind(v);
  let score = kind === "female" ? 1000 : kind === "male" ? -1000 : 0;
  if (/^zh[-_]CN$/i.test(v.lang)) score += 100;
  else if (/^zh[-_]TW$/i.test(v.lang)) score += 80;
  if (/neural|natural|premium|enhanced|增强|高质量|优质/i.test(name)) score += 250;
  if (/compact|精简/i.test(name)) score -= 100;
  if (/xiaoxiao|晓晓/i.test(name)) score += 150;
  else if (/xiaohan|晓涵|xiaomo|晓墨/i.test(name)) score += 120;
  if (/google/i.test(name)) score += 25;
  if (v.localService) score += 5;
  return score;
}
export function chineseVoices(voices: readonly SpeechSynthesisVoice[]) {
  const unique = new Map(voices.filter(v => /^zh(?:[-_]|$)/i.test(v.lang)).map(v => [voiceId(v), v]));
  return [...unique.values()].sort((a, b) => voiceRank(b) - voiceRank(a) || voiceId(a).localeCompare(voiceId(b)));
}
export function chineseVoice(voices: readonly SpeechSynthesisVoice[], choice = "auto") {
  const available = chineseVoices(voices);
  return available.find(v => voiceId(v) === choice) ?? available[0];
}

// Use our own short queue so fast CPUs cannot create minutes of stale speech.
// Under load discard chatter yields to confirmed calls and wins.
export class VoiceAnnouncer {
  private queue: { text: string; kind: TableEvent["kind"] | "preview" }[] = [];
  private active = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private choice = "auto";
  private rate = .92;
  constructor(private platform: SpeechPlatform | null, private onError: () => void = () => {}) {}
  get supported() { return !!this.platform; }
  configure(choice: string, rate: number) {
    if (this.choice !== choice) this.stop();
    this.choice = choice;
    this.rate = Number.isFinite(rate) ? Math.min(1.15, Math.max(.8, rate)) : .92;
  }
  announce(event: TableEvent) {
    const text = eventSpeech(event);
    if (text) this.enqueue(text, event.kind);
  }
  preview() { this.stop(); this.enqueue("一万，九筒，三条，吃，碰，杠，胡", "preview"); }
  private enqueue(text: string, kind: TableEvent["kind"] | "preview") {
    if (!this.platform) return;
    if (this.queue.length >= 8) {
      const disposable = this.queue.findIndex(e => e.kind === "discard");
      if (disposable < 0 && kind === "discard") return;
      this.queue.splice(disposable < 0 ? 0 : disposable, 1);
    }
    this.queue.push({ text, kind });
    this.pump();
  }
  private pump() {
    if (this.active || !this.platform || !this.queue.length) return;
    const item = this.queue.shift()!, ticket = ++this.generation;
    this.active = true;
    try {
      const { synth, utterance } = this.platform, u = utterance(item.text);
      u.lang = "zh-CN"; u.rate = this.rate; u.pitch = 1; u.volume = .8;
      const voice = chineseVoice(synth.getVoices(), this.choice);
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      const finish = () => {
        if (this.generation !== ticket) return;
        ++this.generation;
        clearTimeout(this.timer);
        this.active = false;
        this.pump();
      };
      u.onend = finish;
      u.onerror = () => { if (this.generation === ticket) { this.onError(); this.stop(); } };
      // A broken platform callback must not stall future speech forever.
      this.timer = setTimeout(() => {
        if (this.generation !== ticket) return;
        this.stop(); this.onError();
      }, item.kind === "preview" ? 10000 : 5000);
      synth.resume(); synth.speak(u);
    } catch { this.stop(); this.onError(); }
  }
  stop() {
    ++this.generation;
    clearTimeout(this.timer);
    this.queue = []; this.active = false;
    try { this.platform?.synth.cancel(); } catch { /* Optional audio. */ }
  }
}
