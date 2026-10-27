import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed model receipts. The guarded Cameo connector reads the model, saves the project and signs
 * what it saw; the ITEROP connector accepts "Update system model" only with a valid signature. Both
 * run on the user's computer and share CAMEO_RECEIPT_KEY from .env, so Claude can carry a receipt
 * from one to the other but cannot write one itself.
 */
export type ModelReceipt = {
  systemModel_reference: string;
  systemModel_revision: string;
  systemModel_summary: string;
};

const MARK = ' · receipt ';
const sign = (key: string, reference: string, revision: string, summary: string) =>
  createHmac('sha256', key)
    .update(`${reference}\n${revision}\n${summary}`)
    .digest('hex')
    .slice(0, 16);

export function signReceipt(
  key: string,
  r: { reference: string; revision: string; summary: string },
): ModelReceipt {
  return {
    systemModel_reference: r.reference,
    systemModel_revision: `${r.revision}${MARK}${sign(key, r.reference, r.revision, r.summary)}`,
    systemModel_summary: r.summary,
  };
}

export function verifyReceipt(key: string, values: Record<string, unknown>) {
  const reference = String(values.systemModel_reference ?? '');
  const signed = String(values.systemModel_revision ?? '');
  const summary = String(values.systemModel_summary ?? '');
  const at = signed.lastIndexOf(MARK);
  if (!reference || at < 0) return false;
  const given = signed.slice(at + MARK.length);
  if (!/^[0-9a-f]{16}$/.test(given)) return false;
  const expected = sign(key, reference, signed.slice(0, at), summary);
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
