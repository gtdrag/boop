/**
 * Text-to-speech integration for Boop.
 *
 * Dormant until Growth phase.
 * Will integrate ElevenLabs TTS.
 */

export interface TtsConfig {
  enabled: boolean;
  provider?: string;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  enabled: false,
};
