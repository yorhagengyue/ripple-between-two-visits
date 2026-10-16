/**
 * SPEECH_PROVIDER=trtc: TRTC realtime and file transcription (hackathon allowance). Not built yet: every
 * method throws SpeechError("not_configured"), whether or not TRTC_SDK_APP_ID / TRTC_SDK_SECRET_KEY are
 * set. Routes answer 503 not_configured. The preflight (web-app.md section 2, item 4) decides whether
 * TRTC can diarise and handle mixed Mandarin and English before this is written.
 */
import { SpeechError, type FileJobInput, type FileJobResult, type SpeechProvider } from "./types";

const NOT_CONFIGURED = "TRTC speech is not configured yet (SPEECH_PROVIDER=trtc is a stub; use mock)";

export class TrtcSpeechProvider implements SpeechProvider {
  readonly name = "trtc" as const;

  async realtimeToken(): Promise<{ token: string; expiresAt: number }> {
    throw new SpeechError("not_configured", NOT_CONFIGURED);
  }

  async createFileJob(input: FileJobInput): Promise<{ jobId: string }> {
    void input;
    throw new SpeechError("not_configured", NOT_CONFIGURED);
  }

  async getFileJob(jobId: string): Promise<FileJobResult> {
    void jobId;
    throw new SpeechError("not_configured", NOT_CONFIGURED);
  }
}
