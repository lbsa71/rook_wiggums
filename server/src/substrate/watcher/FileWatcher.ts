import * as fs from "node:fs";
import { IClock } from "../abstractions/IClock";
import { SubstrateConfig } from "../config";
import { SubstrateFileType, SUBSTRATE_FILE_SPECS } from "../types";
import { ILoopEventSink } from "../../loop/ILoopEventSink";
import { LoopEvent } from "../../loop/types";

/**
 * Watches substrate files for changes and emits file_changed events via websocket.
 * 
 * This service watches the substrate directory for file changes and emits
 * file_changed events so that client panels can refresh their content when
 * files are updated on disk (either by the system or externally).
 */
export class FileWatcher {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly debounceMs: number = 100; // Debounce rapid file changes

  constructor(
    private readonly config: SubstrateConfig,
    private readonly eventSink: ILoopEventSink,
    private readonly clock: IClock,
    debounceMs: number = 100
  ) {
    this.debounceMs = debounceMs;
  }

  /**
   * Start watching all substrate files for changes.
   */
  start(): void {
    // Watch individual substrate files for better reliability across platforms
    // fs.watch on directories can be unreliable, especially on Linux
    for (const [fileType, spec] of Object.entries(SUBSTRATE_FILE_SPECS)) {
      const filePath = this.config.getFilePath(fileType as SubstrateFileType);
      const fileName = spec.fileName;
      
      try {
        const watcher = fs.watch(filePath, (eventType) => {
          // Only process change events
          if (eventType !== "change") return;
          
          // Debounce rapid changes (e.g., multiple writes in quick succession)
          this.debounceFileChange(fileType as SubstrateFileType, fileName);
        });
        
        this.watchers.set(filePath, watcher);
      } catch (error) {
        // File might not exist yet, that's okay - we'll catch it when it's created
        // Log at debug level since missing optional files are expected
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error(`Failed to watch ${filePath}:`, error);
        }
      }
    }
  }

  /**
   * Stop watching files and clean up resources.
   */
  stop(): void {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Close all watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
  }

  private debounceFileChange(fileType: SubstrateFileType, filename: string): void {
    const key = fileType;
    
    // Clear existing timer if any
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.emitFileChanged(fileType, filename);
    }, this.debounceMs);
    
    this.debounceTimers.set(key, timer);
  }

  private emitFileChanged(fileType: SubstrateFileType, filename: string): void {
    const event: LoopEvent = {
      type: "file_changed",
      timestamp: this.clock.now().toISOString(),
      data: {
        fileType,
        filename,
      },
    };
    
    this.eventSink.emit(event);
  }
}
