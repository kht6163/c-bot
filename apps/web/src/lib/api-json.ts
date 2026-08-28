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
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `${label} ${status}`;
    throw new Error(message);
  }
  return data as T;
}
