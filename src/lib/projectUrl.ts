const CREATE_PATH = "/create";

/**
 * Mỗi video có một URL bền vững theo project id. Chỉ lưu ID trong URL; toàn bộ
 * nội dung dự án vẫn được đọc từ storage hiện tại.
 */
export function projectUrl(projectId: string) {
  const params = new URLSearchParams({ id: projectId });
  return `${CREATE_PATH}?${params.toString()}`;
}

export function projectIdFromUrl(input: string) {
  try {
    const url = new URL(input, "http://localhost");
    if (url.pathname !== CREATE_PATH) return "";
    return (url.searchParams.get("id") || url.searchParams.get("project") || "").trim();
  } catch {
    return "";
  }
}
