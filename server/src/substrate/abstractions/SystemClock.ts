import { IClock } from "./IClock";

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
}
