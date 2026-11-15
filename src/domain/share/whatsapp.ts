/**
 * A wa.me link that opens WhatsApp with the message filled in. Its own
 * module so the share buttons (a client component) import nothing else.
 */
export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
