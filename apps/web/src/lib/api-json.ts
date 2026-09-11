/** A refused API call: the server's message, its status, and the reason code it named, if any. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function parseApiBody<T>(text: string, status: number, label: string): T {
  const start = text.trimStart();
  if (start.startsWith("<!") || start.toLowerCase().startsWith("<html")) {
    throw new Error(
      `${label}: 웹 페이지가 왔습니다. 터미널의 c-bot listening 주소를 여세요. :5173 은 UI 핫리로드입니다.`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label}: 응답이 JSON이 아닙니다`);
  }
  if (status < 200 || status >= 300) {
    const body = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
    const message = typeof body.error === "string" ? body.error : `${label} ${status}`;
    throw new ApiError(message, status, typeof body.reason === "string" ? body.reason : undefined);
  }
  return data as T;
}
