/**
 * src/commands/gmail-watch-setup.ts
 * Gmail Pub/Sub watch setup — call users.watch API to enable push notifications.
 * Requires: hyperclaw auth oauth google-gmail (or oauth google with gmail scope).
 */

import fs from 'fs-extra';
import path from 'path';
import { getHyperClawDir } from '../infra/paths';

async function getGmailAccessToken(): Promise<string> {
  const hcDir = getHyperClawDir();
  const paths = [
    path.join(hcDir, 'oauth-google-gmail.json'),
    path.join(hcDir, 'oauth-google.json')
  ];
  for (const p of paths) {
    if (!(await fs.pathExists(p))) continue;
    const data = await fs.readJson(p);
    if (data.access_token) return data.access_token;
  }
  throw new Error('No Gmail OAuth token found. Run: hyperclaw auth oauth google-gmail');
}

export async function setupGmailWatch(opts: {
  topicName: string;
  labelIds?: string[];
}): Promise<{ historyId: string; expiration: string }> {
  const token = await getGmailAccessToken();
  const body = JSON.stringify({
    topicName: opts.topicName,
    labelIds: opts.labelIds || ['INBOX'],
    labelFilterBehavior: 'INCLUDE'
  });

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${err}`);
  }

  return res.json();
}
