import { env } from '../env';

/** Whether a forgotten password can be reset by email on this server. */
export const resetByEmail = () => Boolean(env.resendApiKey && env.publicUrl);

/** Send the reset link through Resend. Throws if Resend refuses it. */
export async function sendResetEmail(to: string, token: string): Promise<void> {
  const link = `${env.publicUrl}/reset?token=${encodeURIComponent(token)}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.resendFrom,
      to,
      subject: 'Reset your whiteboard password',
      text: `Someone asked to reset the password for this account. If it was you, open this link within an hour:\n\n${link}\n\nIf it wasn't, ignore this email; nothing changes.`,
    }),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}`);
}
