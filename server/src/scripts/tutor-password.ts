/**
 * Set a tutor's password from the server, for when no reset email can be sent:
 *
 *   npm run tutor:password -w server -- someone@example.com
 *
 * The new password is read from stdin, so it never lands in shell history.
 * Every session the tutor had is signed out.
 */
import { createInterface } from 'node:readline/promises';
import { MIN_PASSWORD_LENGTH } from '../auth/password';
import { setPassword, tutorByEmail } from '../auth/tutors';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run tutor:password -w server -- <email>');
  process.exit(1);
}
const tutor = await tutorByEmail(email);
if (!tutor) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = (await rl.question('New password: ')).trim();
rl.close();
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(1);
}
await setPassword(tutor.id, password);
console.log(`Password changed for ${tutor.email}; their other sessions are signed out.`);
process.exit(0);
