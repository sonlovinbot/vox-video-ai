/**
 * Chạy worker trên từng phần tử với trần số việc song song.
 *
 * Không phải chia lô: worker rảnh là lấy ngay việc kế tiếp, nên một request chậm
 * không chặn phần còn lại. Hàng đợi chạy đến khi hết việc.
 */
export async function runWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  const queue = items.map((item, index) => ({ item, index }));
  const runners = Array.from(
    { length: Math.min(Math.max(limit, 1), queue.length) },
    async () => {
      while (queue.length) {
        const next = queue.shift();
        if (next) await worker(next.item, next.index);
      }
    },
  );
  await Promise.all(runners);
}
