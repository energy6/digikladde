import 'fake-indexeddb/auto';
import { afterEach, beforeEach } from 'vitest';
import { db } from '../db/database';

beforeEach(async () => {
  await db.open();
});

afterEach(async () => {
  await db.delete();
});
