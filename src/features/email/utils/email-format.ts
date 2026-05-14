export function formatEmailDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const day = String(parsed.getDate());
  const month = parsed
    .toLocaleString("en-US", { month: "short" })
    .replace(".", "");
  const currentYear = new Date().getFullYear();
  if (parsed.getFullYear() === currentYear) {
    return `${day}${month}`;
  }
  const year2 = String(parsed.getFullYear()).slice(-2);
  return `${day}${month}${year2}`;
}

export function formatEmailDetailDate(raw: string) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}
