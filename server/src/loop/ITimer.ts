export interface ITimer {
  delay(ms: number): Promise<void>;
}
