import type { RoomView } from "./protocol";
// An older GET must not replace the result of a command that started after that GET.
export class RoomUpdates {
  epoch = 0;
  current: RoomView | null = null;
  beginCommand() { return ++this.epoch; }
  accept(view: RoomView, epoch = this.epoch) {
    if (epoch !== this.epoch || this.current?.id === view.id && this.current.version > view.version) return false;
    this.current = view; return true;
  }
}
