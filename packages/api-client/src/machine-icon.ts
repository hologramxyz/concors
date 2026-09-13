import { z } from "zod";

/** One emoji, including flags, skin tones and joined sequences. No Intl.Segmenter dependency in native clients. */
export const MachineIconSchema = z
  .string()
  .max(32)
  .regex(
    /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)$/u,
    "Choose a single emoji",
  )
  .nullable();
