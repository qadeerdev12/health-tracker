import { db } from './supabase.js';

export class UnauthorizedError extends Error {
  constructor(message = 'Sign in required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Resolves the Supabase access token the app sends into a user id.
 *
 * The token is verified by Supabase rather than locally: it costs a round trip,
 * but it means the server never holds the JWT secret, and a user deleted or
 * banned mid-session stops being accepted immediately instead of at expiry.
 */
export async function requireUser(req, res, next) {
  try {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');

    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedError('Missing bearer token.');
    }

    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedError('Invalid or expired session.');
    }

    req.userId = data.user.id;
    next();
  } catch (err) {
    next(err);
  }
}
