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
export function chineseVoice(voices: readonly SpeechSynthesisVoice[]) {
  return [...voices].filter(v => /^zh(?:[-_]|$)/i.test(v.lang))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || Number(/^zh[-_]CN$/i.test(b.lang)) - Number(/^zh[-_]CN$/i.test(a.lang)))[0];
}

// Use our own short queue so fast CPUs cannot create minutes of stale speech.
// Under load discard chatter yields to confirmed calls and wins.
export class VoiceAnnouncer {
  private queue: { text: string; kind: TableEvent["kind"] | "preview" }[] = [];
  private active = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private platform: SpeechPlatform | null, private onError: () => void = () => {}) {}
  get supported() { return !!this.platform; }
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
      u.lang = "zh-CN"; u.rate = 1.18; u.volume = 0.85;
      const voice = chineseVoice(synth.getVoices());
      if (voice) u.voice = voice;
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
