// A single addr-spec: exactly one "@", a dotted domain, and no separators,
// whitespace, or control chars. Rejecting whitespace/CR/LF also prevents
// header injection into the RFC-2822 messages we build for Gmail. This is
// deliberately strict — a To header takes one recipient, not a list.
//
// Kept free of any env/config imports so it can be unit-tested in isolation.
export function isValidEmailAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/.test(
    trimmed,
  );
}
