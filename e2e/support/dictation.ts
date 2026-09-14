import type { Page } from "@playwright/test";

/** Deterministic browser speech/microphone adapters. Never requests real microphone access. */
export async function mockDictation(page: Page) {
  await page.addInitScript(() => {
    interface SpeechEvent {
      resultIndex: number;
      results: { isFinal: boolean; 0: { transcript: string } }[];
    }
    const capture = { stops: 0, aborts: 0, tracks: 0, contexts: 0, volume: 0.1 };
    const current: { speech?: Recognition } = {};
    class Recognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: ((event: SpeechEvent) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      start() {
        current.speech = this;
      }
      stop() {
        capture.stops++;
      }
      abort() {
        capture.aborts++;
        this.onend?.();
      }
    }
    class Audio {
      state = "running";
      constructor() {
        capture.contexts++;
      }
      resume() {
        return Promise.resolve();
      }
      close() {
        if (this.state !== "closed") capture.contexts--;
        this.state = "closed";
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return {
          connect() {
            return undefined;
          },
          disconnect() {
            return undefined;
          },
        };
      }
      createAnalyser() {
        return {
          fftSize: 512,
          getFloatTimeDomainData(data: Float32Array) {
            data.fill(capture.volume);
          },
        };
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: Recognition });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: Audio });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        capture.tracks++;
        let ended = false;
        return {
          getTracks: () => [
            {
              stop() {
                if (!ended) capture.tracks--;
                ended = true;
              },
            },
          ],
        };
      },
    });
    Object.assign(window, {
      testDictation: {
        capture,
        result(text: string, final = false) {
          current.speech?.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: final, 0: { transcript: text } }],
          });
        },
        end() {
          current.speech?.onend?.();
        },
        error(error: string) {
          current.speech?.onerror?.({ error });
        },
      },
    });
  });
}

declare global {
  interface Window {
    testDictation: {
      capture: { stops: number; aborts: number; tracks: number; contexts: number; volume: number };
      result: (text: string, final?: boolean) => void;
      end: () => void;
      error: (error: string) => void;
    };
  }
}
