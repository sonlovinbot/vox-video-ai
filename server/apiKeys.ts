export const API_KEY_ENV_NAMES = {
  deepseek: "DEEPSEEK_API_KEY",
  coachio: "COACHIO_API_KEY",
  gemini: "GEMINI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  pexels: "PEXELS_API_KEY",
  serper: "SERPER_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
  groq: "GROQ_API_KEY",
} as const;

export type ApiKeyProvider = keyof typeof API_KEY_ENV_NAMES;

/**
 * Cập nhật đúng các key được phép, giữ nguyên comment và cấu hình khác.
 * JSON string là cú pháp dotenv hợp lệ và tránh newline/quote phá cấu trúc file.
 */
export function updateEnvContent(
  current: string,
  updates: Partial<Record<ApiKeyProvider, string>>,
) {
  const lines = current ? current.replace(/\r\n/g, "\n").split("\n") : [];
  for (const [provider, rawValue] of Object.entries(updates) as Array<
    [ApiKeyProvider, string]
  >) {
    const envName = API_KEY_ENV_NAMES[provider];
    if (!envName) continue;
    const value = rawValue.trim();
    if (!value) continue;
    const nextLine = `${envName}=${JSON.stringify(value)}`;
    const matcher = new RegExp(`^\\s*${envName}\\s*=`);
    const matches = lines.flatMap((line, index) =>
      matcher.test(line) ? [index] : [],
    );
    if (!matches.length) {
      lines.push(nextLine);
      continue;
    }
    lines[matches[0]] = nextLine;
    for (let index = matches.length - 1; index >= 1; index -= 1) {
      lines.splice(matches[index], 1);
    }
  }
  return `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`;
}
