import { ITimer } from "./ITimer";

export class NodeTimer implements ITimer {
  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
