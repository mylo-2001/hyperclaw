/**
 * src/channels/runner.ts
 * Starts channel connectors and wires them to the gateway /api/chat.
 * Runs alongside the gateway when channels are enabled.
 */

import fs from 'fs-extra';
import path from 'path';
import http from 'http';
import { getHyperClawDir, getConfigPath } from '../infra/paths';
import { chunkForChannel, withRetry } from './delivery';

const HC_DIR = getHyperClawDir();

export interface ChannelRunnerOpts {
  port: number;
  bind?: string;
  authToken?: string;
}

const connectors: Array<{ stop: () => Promise<void> }> = [];
let emailConnectorRef: { triggerPoll: () => void } | null = null;
export type WebhookOpts = { signature?: string; timestamp?: string; lineSignature?: string; twilioSignature?: string; webhookUrl?: string };

const webhookConnectors: Record<string, {
  handleWebhook: (body: string, opts?: WebhookOpts) => Promise<string | void>;
  verifyWebhook?: (mode: string, token: string, challenge: string) => string | null;
}> = {};

export interface ChannelRunnerResult {
  stop: () => Promise<void>;
  handleWebhook?: (channelId: string, body: string, opts?: WebhookOpts) => Promise<string | void>;
  verifyWebhook?: (channelId: string, mode: string, token: string, challenge: string) => string | null;
}

export async function startChannelRunners(opts: ChannelRunnerOpts): Promise<ChannelRunnerResult> {
  const port = opts.port;
  const baseUrl = `http://${opts.bind || '127.0.0.1'}:${port}`;
  const authToken = opts.authToken || '';

  let cfg: any = {};
  try { cfg = await fs.readJson(getConfigPath()); } catch {}

  // Merge config.json (channels add writes there)
  let channelConfigs: Record<string, any> = {};
  let configChannels: string[] = [];
  try {
    const configPath = path.join(HC_DIR, 'config.json');
    if (await fs.pathExists(configPath)) {
      const c2 = await fs.readJson(configPath);
      channelConfigs = c2.channelConfigs || {};
      configChannels = Array.isArray(c2.channels) ? c2.channels : [];
    }
  } catch {}

  const enabledIds = (cfg.gateway?.enabledChannels?.length ? cfg.gateway.enabledChannels : configChannels) || [];
  const ids = Array.isArray(enabledIds) ? enabledIds : [];
  if (ids.length === 0) return { stop: async () => {} };

  const wrap = (c: { sendMessage: (id: string, t: string) => Promise<any>; sendTyping?: (id: string) => Promise<any> }) => {
    const ty = c.sendTyping;
    return {
      sendMessage: (id: string | number, t: string) => c.sendMessage(String(id), t),
      sendTyping: ty ? (id: string | number) => ty(String(id)) : undefined
    };
  };
  const handleMsg = async (msg: { chatId: string | number; text: string; audioPath?: string }, conn: { sendMessage: (id: string | number, t: string) => Promise<any>; sendTyping?: (id: string | number) => Promise<any> }, channelId: string) => {
    try {
      conn.sendTyping?.(msg.chatId).catch(() => {});
      const { enrichVoiceNote, withRetry } = await import('./delivery');
      const text = await enrichVoiceNote(msg);
      const response = await withRetry(
        () => postChat(baseUrl, text, channelId, authToken),
        { onRetry: (n, err) => console.error(`[channels] ${channelId} agent retry ${n}: ${err.message}`) }
      );
      const chunks = chunkForChannel(response, channelId);
      for (const chunk of chunks) {
        await withRetry(() => conn.sendMessage(msg.chatId, chunk), {
          onRetry: (n, err) => console.error(`[channels] ${channelId} send retry ${n}: ${err.message}`)
        });
      }
    } catch (e: any) {
      console.error(`[channels] ${channelId} error: ${e.message}`);
      await conn.sendMessage(msg.chatId, `Error: ${e.message}`).catch(() => {});
    }
  };

  for (const id of ids) {
    const chCfg = cfg.channels?.[id] || channelConfigs[id];
    const dmObj = chCfg?.dmPolicy;
    const dmPolicy = (typeof dmObj === 'object' ? dmObj?.policy : dmObj) || 'pairing';
    const allowFrom = chCfg?.allowFrom || (typeof dmObj === 'object' ? dmObj?.allowFrom : []) || [];
    const allowFromArr = Array.isArray(allowFrom) ? allowFrom : [];

    if (id === 'telegram') {
      const token = chCfg?.token || chCfg?.botToken || process.env.TELEGRAM_BOT_TOKEN;
      if (!token) continue;
      try {
        const { TelegramConnector } = await import('../../extensions/telegram/src/connector');
        const conn = new TelegramConnector(token, { dmPolicy: dmPolicy as any, allowFrom: allowFromArr, pendingPairings: {}, approvedPairings: [] });
        conn.on('message', (msg: { chatId: number; text: string }) => handleMsg(msg, wrap(conn as any), 'telegram'));
        await conn.connect();
        connectors.push({ stop: async () => { await conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Telegram failed to start: ${e.message}`);
      }
    } else if (id === 'discord') {
      const token = chCfg?.token || process.env.DISCORD_BOT_TOKEN;
      if (!token) continue;
      try {
        const { DiscordConnector } = await import('../../extensions/discord/src/connector');
        const conn = new DiscordConnector(token, { dmPolicy: dmPolicy as any, allowFrom: allowFromArr, pendingPairings: {}, approvedPairings: [] });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'discord'));
        await conn.connect();
        connectors.push({ stop: async () => { await conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Discord failed to start: ${e.message}`);
      }
    } else if (id === 'slack') {
      const botToken = chCfg?.botToken || chCfg?.token || process.env.SLACK_BOT_TOKEN;
      const signingSecret = chCfg?.signingSecret || process.env.SLACK_SIGNING_SECRET;
      if (!botToken || !signingSecret) continue;
      try {
        const { SlackConnector } = await import('../../extensions/slack/src/connector');
        const conn = new SlackConnector({ botToken, signingSecret, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string; threadTs?: string }) => {
          const send = (id: string | number, t: string) => conn.sendMessage(String(id), t, msg.threadTs);
          const typing = conn.sendTyping ? (id: string | number) => conn.sendTyping(String(id)) : undefined;
          handleMsg({ chatId: msg.chatId, text: msg.text }, { sendMessage: send, sendTyping: typing }, 'slack');
        });
        await conn.connect();
        webhookConnectors['slack'] = {
          handleWebhook: async (body, opts) => (await conn.handleWebhook(body, opts?.signature ?? '', opts?.timestamp ?? '')) ?? undefined,
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => {} });
      } catch (e: any) {
        console.error(`[channels] Slack failed to start: ${e.message}`);
      }
    } else if (id === 'signal') {
      const signalCliUrl = chCfg?.signalCliUrl || process.env.SIGNAL_CLI_URL || 'http://localhost:8080';
      const phoneNumber = chCfg?.phoneNumber || chCfg?.token || process.env.SIGNAL_PHONE_NUMBER;
      if (!phoneNumber) continue;
      try {
        const { SignalConnector } = await import('../../extensions/signal/src/connector');
        const conn = new SignalConnector({ signalCliUrl, phoneNumber, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'signal'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Signal failed to start: ${e.message}`);
      }
    } else if (id === 'matrix') {
      const homeserver = chCfg?.homeserver || chCfg?.homeserverUrl || process.env.MATRIX_HOMESERVER;
      const accessToken = chCfg?.accessToken || chCfg?.token || process.env.MATRIX_ACCESS_TOKEN;
      const userId = chCfg?.userId || process.env.MATRIX_USER_ID;
      if (!homeserver || !accessToken || !userId) continue;
      try {
        const { MatrixConnector } = await import('../../extensions/matrix/src/connector');
        const conn = new MatrixConnector({ homeserver, accessToken, userId, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'matrix'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Matrix failed to start: ${e.message}`);
      }
    } else if (id === 'nostr') {
      const privateKeyHex = chCfg?.privateKeyHex || process.env.NOSTR_PRIVATE_KEY;
      const relays = chCfg?.relays || (process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://nos.lol').split(',');
      if (!privateKeyHex || !Array.isArray(relays) || relays.length === 0) continue;
      try {
        const { NostrConnector } = await import('../../extensions/nostr/src/connector');
        const conn = new NostrConnector({ privateKeyHex, relays, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'nostr'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Nostr failed to start: ${e.message}`);
      }
    } else if (id === 'line') {
      const channelAccessToken = chCfg?.channelAccessToken || chCfg?.token || process.env.LINE_CHANNEL_ACCESS_TOKEN;
      const channelSecret = chCfg?.channelSecret || process.env.LINE_CHANNEL_SECRET;
      if (!channelAccessToken || !channelSecret) continue;
      try {
        const { LINEConnector } = await import('../../extensions/line/src/connector');
        const conn = new LINEConnector({ channelAccessToken, channelSecret, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', async (msg: { chatId: string; text: string; replyToken?: string }) => {
          const send = (id: string | number, t: string) => msg.replyToken ? conn.replyMessage(msg.replyToken, t) : conn.pushMessage(String(id), t);
          await handleMsg({ chatId: msg.chatId, text: msg.text }, { sendMessage: send }, 'line');
        });
        await conn.connect();
        webhookConnectors['line'] = {
          handleWebhook: (body, opts) => conn.handleWebhook(body, opts?.signature ?? ''),
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] LINE failed to start: ${e.message}`);
      }
    } else if (id === 'feishu' || id === 'lark') {
      const appId = chCfg?.appId || process.env.FEISHU_APP_ID;
      const appSecret = chCfg?.appSecret || process.env.FEISHU_APP_SECRET;
      if (!appId || !appSecret) continue;
      try {
        const { FeishuConnector } = await import('../../extensions/feishu/src/connector');
        const conn = new FeishuConnector({ appId, appSecret, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'feishu'));
        await conn.connect();
        const feishuHandler = {
          handleWebhook: async (body: string) => {
            const ch = (conn as any).handleChallenge?.(body);
            if (ch) return ch;
            await conn.handleWebhook(body);
          },
          verifyWebhook: undefined as undefined
        };
        webhookConnectors['feishu'] = feishuHandler;
        if (id === 'lark') webhookConnectors['lark'] = feishuHandler;
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Feishu failed to start: ${e.message}`);
      }
    } else if (id === 'msteams' || id === 'teams') {
      const appId = chCfg?.appId || process.env.MSTEAMS_APP_ID;
      const appPassword = chCfg?.appPassword || chCfg?.password || process.env.MSTEAMS_APP_PASSWORD;
      if (!appId || !appPassword) continue;
      try {
        const { MSTeamsConnector } = await import('../../extensions/msteams/src/connector');
        const conn = new MSTeamsConnector({ appId, appPassword, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string; serviceUrl?: string; activity?: any }) => {
          const m = msg as { chatId: string; text: string; serviceUrl: string; activity: any };
          const send = (id: string | number, t: string) => conn.reply(m.serviceUrl, String(id), m.activity, t);
          handleMsg(msg, { sendMessage: send }, 'msteams');
        });
        await conn.connect();
        webhookConnectors['msteams'] = {
          handleWebhook: (body) => conn.handleWebhook(body),
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] MS Teams failed to start: ${e.message}`);
      }
    } else if (id === 'bluebubbles' || id === 'imessage') {
      const serverUrl = chCfg?.serverUrl || process.env.BLUEBUBBLES_SERVER_URL;
      const password = chCfg?.password || process.env.BLUEBUBBLES_PASSWORD;
      if (!serverUrl || !password) continue;
      try {
        const { BlueBubblesConnector } = await import('../../extensions/bluebubbles/src/connector');
        const conn = new BlueBubblesConnector({ serverUrl, password, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'bluebubbles'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] BlueBubbles failed to start: ${e.message}`);
      }
    } else if (id === 'imessage-native' && process.platform === 'darwin') {
      try {
        const { IMessageNativeConnector } = await import('../../extensions/imessage-native/src/connector');
        const conn = new IMessageNativeConnector({ dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'imessage-native'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] imessage-native failed: ${e.message}. Install imsg (github.com/steipete/imsg) and grant Full Disk Access + Automation.`);
      }
    } else if (id === 'instagram') {
      const pageAccessToken = chCfg?.pageAccessToken || chCfg?.token || process.env.INSTAGRAM_PAGE_ACCESS_TOKEN;
      const instagramAccountId = chCfg?.instagramAccountId || chCfg?.instagramAccountID || process.env.INSTAGRAM_ACCOUNT_ID;
      const verifyToken = chCfg?.verifyToken || process.env.INSTAGRAM_VERIFY_TOKEN || 'hyperclaw';
      if (!pageAccessToken || !instagramAccountId) continue;
      try {
        const { InstagramConnector } = await import('../../extensions/instagram/src/connector');
        const conn = new InstagramConnector({ pageAccessToken, instagramAccountId, verifyToken, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'instagram'));
        await conn.connect();
        webhookConnectors['instagram'] = {
          handleWebhook: (body) => conn.handleWebhook(body),
          verifyWebhook: (mode, token, challenge) => conn.verifyWebhook(mode, token, challenge)
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Instagram failed: ${e.message}`);
      }
    } else if (id === 'messenger') {
      const pageAccessToken = chCfg?.pageAccessToken || chCfg?.token || process.env.MESSENGER_PAGE_ACCESS_TOKEN;
      const verifyToken = chCfg?.verifyToken || process.env.MESSENGER_VERIFY_TOKEN || 'hyperclaw';
      const appSecret = chCfg?.appSecret || process.env.MESSENGER_APP_SECRET;
      const pageId = chCfg?.pageId || chCfg?.page_id || process.env.MESSENGER_PAGE_ID;
      if (!pageAccessToken || !verifyToken || !appSecret || !pageId) continue;
      try {
        const { MessengerConnector } = await import('../../extensions/messenger/src/connector');
        const conn = new MessengerConnector({ pageAccessToken, verifyToken, appSecret, pageId, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'messenger'));
        await conn.connect();
        webhookConnectors['messenger'] = {
          handleWebhook: async (body: string, opts?: WebhookOpts) => {
            await conn.handleWebhook(body, opts?.signature ?? '');
          },
          verifyWebhook: (mode, token, challenge) => conn.verifyWebhook(mode, token, challenge)
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Messenger failed: ${e.message}`);
      }
    } else if (id === 'twitter') {
      const bearerToken = chCfg?.bearerToken || process.env.TWITTER_BEARER_TOKEN;
      const apiKey = chCfg?.apiKey || process.env.TWITTER_API_KEY;
      const apiSecret = chCfg?.apiSecret || process.env.TWITTER_API_SECRET;
      const accessToken = chCfg?.accessToken || process.env.TWITTER_ACCESS_TOKEN;
      const accessTokenSecret = chCfg?.accessTokenSecret || process.env.TWITTER_ACCESS_TOKEN_SECRET;
      if (!bearerToken || !apiKey || !apiSecret || !accessToken || !accessTokenSecret) continue;
      try {
        const { TwitterConnector } = await import('../../extensions/twitter/src/connector');
        const conn = new TwitterConnector({ bearerToken, apiKey, apiSecret, accessToken, accessTokenSecret, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap({ sendMessage: (id: string, t: string) => conn.sendDM(id, t) }), 'twitter'));
        await conn.connect();
        webhookConnectors['twitter'] = {
          handleWebhook: (body) => conn.handleWebhook(body),
          verifyWebhook: (mode, token) => conn.handleCRC ? conn.handleCRC(token) : null
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Twitter failed: ${e.message}`);
      }
    } else if (id === 'viber') {
      const authToken = chCfg?.authToken || chCfg?.token || process.env.VIBER_AUTH_TOKEN;
      const botName = chCfg?.botName || chCfg?.bot_name || 'HyperClaw';
      const webhookUrl = chCfg?.webhookUrl || process.env.VIBER_WEBHOOK_URL || `${baseUrl}/webhook/viber`;
      if (!authToken) continue;
      try {
        const { ViberConnector } = await import('../../extensions/viber/src/connector');
        const conn = new ViberConnector({ authToken, botName, webhookUrl, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'viber'));
        await conn.connect();
        webhookConnectors['viber'] = {
          handleWebhook: async (body: string, opts?: WebhookOpts) => {
            await conn.handleWebhook(body, opts?.signature ?? '');
          },
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Viber failed: ${e.message}`);
      }
    } else if (id === 'zalo-personal') {
      const cookie = chCfg?.cookie || process.env.ZALO_PERSONAL_COOKIE;
      if (!cookie) continue;
      try {
        const { ZaloPersonalConnector } = await import('../../extensions/zalo-personal/src/connector');
        const conn = new ZaloPersonalConnector({ cookie, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'zalo-personal'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Zalo Personal failed: ${e.message}`);
      }
    } else if (id === 'zalo') {
      const appId = chCfg?.appId || process.env.ZALO_APP_ID;
      const appSecret = chCfg?.appSecret || process.env.ZALO_APP_SECRET;
      const oaAccessToken = chCfg?.oaAccessToken || chCfg?.token || process.env.ZALO_OA_ACCESS_TOKEN;
      if (!appId || !appSecret || !oaAccessToken) continue;
      try {
        const { ZaloConnector } = await import('../../extensions/zalo/src/connector');
        const conn = new ZaloConnector({ appId, appSecret, oaAccessToken, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'zalo'));
        await conn.connect();
        webhookConnectors['zalo'] = { handleWebhook: (body) => conn.handleWebhook(body), verifyWebhook: undefined };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Zalo failed to start: ${e.message}`);
      }
    } else if (id === 'email') {
      const imapHost = chCfg?.imapHost || process.env.EMAIL_IMAP_HOST;
      const imapPort = chCfg?.imapPort ?? parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
      const smtpHost = chCfg?.smtpHost || process.env.EMAIL_SMTP_HOST;
      const smtpPort = chCfg?.smtpPort ?? parseInt(process.env.EMAIL_SMTP_PORT || '587', 10);
      const username = chCfg?.username || process.env.EMAIL_USERNAME;
      const password = chCfg?.password || process.env.EMAIL_PASSWORD;
      if (!imapHost || !smtpHost || !username || !password) continue;
      try {
        const { EmailConnector } = await import('../../extensions/email/src/connector');
        const conn = new EmailConnector({ imapHost, imapPort, smtpHost, smtpPort, username, password, pollIntervalMs: 30000, inboxFolder: 'INBOX', markAsRead: true, subjectPrefix: '', fromAllowlist: allowFromArr });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'email'));
        await conn.connect();
        emailConnectorRef = conn;
        webhookConnectors['gmail-pubsub'] = {
          handleWebhook: async (body: string) => {
            try {
              const json = JSON.parse(body || '{}');
              if (json.message?.data) {
                emailConnectorRef?.triggerPoll?.();
              }
            } catch {}
          },
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); emailConnectorRef = null; delete webhookConnectors['gmail-pubsub']; } });
      } catch (e: any) {
        console.error(`[channels] Email failed to start: ${e.message}`);
      }
    } else if (id === 'sms') {
      const accountSid = chCfg?.accountSid || process.env.TWILIO_ACCOUNT_SID;
      const authToken = chCfg?.authToken || process.env.TWILIO_AUTH_TOKEN;
      const fromNumber = chCfg?.fromNumber || process.env.TWILIO_FROM_NUMBER;
      if (!accountSid || !authToken || !fromNumber) continue;
      try {
        const { SMSConnector } = await import('../../extensions/sms/src/connector');
        const conn = new SMSConnector({ accountSid, authToken, fromNumber, dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {} });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'sms'));
        await conn.connect();
        webhookConnectors['sms'] = {
          handleWebhook: (body, opts) => conn.handleWebhook(body, opts?.twilioSignature ?? '', opts?.webhookUrl ?? ''),
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] SMS failed to start: ${e.message}`);
      }
    } else if (id === 'whatsapp-baileys') {
      try {
        const { WhatsAppBaileysConnector } = await import('../../extensions/whatsapp-baileys/src/connector');
        const conn = new WhatsAppBaileysConnector({
          dmPolicy: dmPolicy as any,
          allowFrom: allowFromArr,
          approvedPairings: [],
          pendingPairings: {}
        });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'whatsapp-baileys'));
        await conn.connect();
        connectors.push({ stop: () => { conn.disconnect(); return Promise.resolve(); } });
      } catch (e: any) {
        console.error(`[channels] WhatsApp Baileys failed: ${e.message}. Install: npm install @whiskeysockets/baileys`);
      }
    } else if (id === 'whatsapp') {
      const phoneNumberId = chCfg?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
      const accessToken = chCfg?.accessToken || chCfg?.token || process.env.WHATSAPP_ACCESS_TOKEN;
      const verifyToken = chCfg?.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || 'hyperclaw-verify';
      if (!phoneNumberId || !accessToken) continue;
      try {
        const { WhatsAppConnector } = await import('../../extensions/whatsapp/src/connector');
        const conn = new WhatsAppConnector({ phoneNumberId, accessToken, verifyToken, dmPolicy: dmPolicy as any, allowFrom: allowFromArr });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'whatsapp'));
        await conn.connect();
        webhookConnectors['whatsapp'] = {
          handleWebhook: (body: string) => conn.handleWebhook(body),
          verifyWebhook: (mode, token, challenge) => conn.verifyWebhook(mode, token, challenge)
        };
        connectors.push({ stop: () => { conn.disconnect(); return Promise.resolve(); } });
      } catch (e: any) {
        console.error(`[channels] WhatsApp failed to start: ${e.message}`);
      }
    } else if (id === 'irc') {
      const server = chCfg?.server || process.env.IRC_SERVER;
      const nick = chCfg?.nick || process.env.IRC_NICK || 'hyperclaw';
      const channels = (chCfg?.channels || process.env.IRC_CHANNELS || '').split(',').filter(Boolean).map((c: string) => c.trim());
      if (!server) continue;
      try {
        const { IrcConnector } = await import('../../extensions/irc/src/connector');
        const conn = new IrcConnector({ server, nick, channels, dmPolicy: dmPolicy as any, allowFrom: allowFromArr });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'irc'));
        await conn.connect();
        connectors.push({ stop: async () => { await conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] IRC failed to start: ${e.message}`);
      }
    } else if (id === 'mattermost') {
      const serverUrl = chCfg?.serverUrl || process.env.MATTERMOST_SERVER_URL;
      const token = chCfg?.token || process.env.MATTERMOST_TOKEN;
      const webhookToken = chCfg?.webhookToken || process.env.MATTERMOST_WEBHOOK_TOKEN;
      if (!serverUrl || !token || !webhookToken) continue;
      try {
        const { MattermostConnector } = await import('../../extensions/mattermost/src/connector');
        const conn = new MattermostConnector({
          serverUrl, token, webhookToken,
          dmPolicy: dmPolicy as any, allowFrom: allowFromArr, approvedPairings: [], pendingPairings: {}
        });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'mattermost'));
        await conn.connect();
        webhookConnectors['mattermost'] = {
          handleWebhook: async (body: string, opts?: WebhookOpts) => {
            await conn.handleWebhook(body, opts ? { contentType: (opts as any).contentType } : undefined);
          },
          verifyWebhook: undefined
        };
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Mattermost failed to start: ${e.message}`);
      }
    } else if (id === 'gchat' || id === 'google-chat') {
      try {
        const { GoogleChatConnector } = await import('../../extensions/google-chat/src/connector');
        const conn = new GoogleChatConnector({ baseUrl });
        await conn.connect();
        webhookConnectors['gchat'] = { handleWebhook: (body) => conn.handleWebhook(body), verifyWebhook: undefined };
        if (id === 'google-chat') webhookConnectors['google-chat'] = webhookConnectors['gchat'];
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Google Chat failed to start: ${e.message}`);
      }
    } else if (id === 'synology-chat') {
      const incomingWebhookUrl = chCfg?.incomingWebhookUrl || chCfg?.token || process.env.SYNOLOGY_CHAT_WEBHOOK_URL;
      const webhookToken = chCfg?.webhookToken || process.env.SYNOLOGY_CHAT_OUTGOING_TOKEN;
      const webhookPort = chCfg?.webhookPort || process.env.SYNOLOGY_CHAT_WEBHOOK_PORT;
      if (!incomingWebhookUrl) continue;
      try {
        const { SynologyChatConnector } = await import('../../extensions/synology-chat/src/connector');
        const conn = new SynologyChatConnector({
          incomingWebhookUrl,
          webhookToken,
          ...(webhookPort ? { webhookPort: Number(webhookPort) } : {})
        });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'synology-chat'));
        await conn.connect();
        // Synology Chat connector manages its own inbound HTTP server — no gateway webhook needed
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Synology Chat failed to start: ${e.message}`);
      }
    } else if (id === 'twitch') {
      const username = chCfg?.username || process.env.TWITCH_BOT_USERNAME;
      const oauthToken = chCfg?.oauthToken || chCfg?.token || process.env.TWITCH_OAUTH_TOKEN;
      const channels = String(chCfg?.channels || process.env.TWITCH_CHANNELS || '')
        .split(',')
        .map((c: string) => c.trim())
        .filter(Boolean);
      if (!username || !oauthToken || channels.length === 0) continue;
      try {
        const { TwitchConnector } = await import('../../extensions/twitch/src/connector');
        const conn = new TwitchConnector({ username, oauthToken, channels });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'twitch'));
        await conn.connect();
        connectors.push({ stop: async () => { await conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Twitch failed to start: ${e.message}`);
      }
    } else if (id === 'tlon') {
      // TlonConnector uses Urbit Eyre API — requires ship URL, ship name, and login code
      const shipUrl = chCfg?.shipUrl || process.env.TLON_SHIP_URL;
      const ship = chCfg?.ship || process.env.TLON_SHIP;
      const code = chCfg?.code || chCfg?.token || process.env.TLON_CODE;
      const group = chCfg?.group || process.env.TLON_GROUP;
      if (!shipUrl || !ship || !code) continue;
      try {
        const { TlonConnector } = await import('../../extensions/tlon/src/connector');
        const conn = new TlonConnector({ shipUrl, ship, code, ...(group ? { group } : {}) });
        conn.on('message', (msg: { chatId: string; text: string }) => handleMsg(msg, wrap(conn as any), 'tlon'));
        await conn.connect();
        connectors.push({ stop: async () => { conn.disconnect(); } });
      } catch (e: any) {
        console.error(`[channels] Tlon failed to start: ${e.message}`);
      }
    }
  }

  return {
    stop: async () => {
      for (const c of connectors) await c.stop().catch(() => {});
      connectors.length = 0;
      emailConnectorRef = null;
      Object.keys(webhookConnectors).forEach(k => delete webhookConnectors[k]);
    },
    handleWebhook: async (channelId: string, body: string, opts?: { signature?: string; timestamp?: string }) => {
      const h = webhookConnectors[channelId];
      if (h) {
        const result = await h.handleWebhook(body, opts);
        return result;
      }
    },
    verifyWebhook: (channelId: string, mode: string, token: string, challenge: string) => {
      const h = webhookConnectors[channelId];
      return h?.verifyWebhook ? h.verifyWebhook(mode, token, challenge) : null;
    }
  };
}

function postChat(baseUrl: string, message: string, source?: string, authToken?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ message });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) };
    if (source) headers['X-HyperClaw-Source'] = source;
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const url = new URL(`${baseUrl}/api/chat`);
    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) reject(new Error(j.error));
          else resolve(j.response || '');
        } catch { reject(new Error('Invalid response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
}
