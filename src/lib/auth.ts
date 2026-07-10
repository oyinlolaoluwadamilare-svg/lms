import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db, schema } from '@/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // The pilot's demo credentials are 7 characters (wfg2026).
    minPasswordLength: 7,
    // Sign-up is only ever called server-side by CSST creating a unit's
    // login (and the seed). It must not replace the admin's own session.
    autoSignIn: false,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  plugins: [nextCookies()],
});
