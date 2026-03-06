# API Keys — Πλήρης Οδηγός

Αυτό το README περιγράφει πώς το HyperClaw διαχειρίζεται API keys **για οποιαδήποτε εφαρμογή** (όχι μόνο bug bounty). Διάβασέ το για να καταλάβεις τη ροή και να αποφασίσεις αν αξίζει να επεκταθεί.

---

## Περιεχόμενα

1. [Γενική εικόνα](#γενική-εικόνα)
2. [Πώς το Wizard παίρνει API keys](#πώς-το-wizard-παίρνει-api-keys)
3. [Πού αποθηκεύονται τα keys](#πού-αποθηκεύονται-τα-keys)
4. [Τρόποι προσθήκης keys](#τρόποι-προσθήκης-keys)
5. [Skills & requiresKeys](#skills--requireskeys)
6. [Ροή διαβάσματος από tools](#ροή-διαβάσματος-από-tools)
7. [Αναλυτικά paths & formats](#αναλυτικά-paths--formats)

---

## Γενική εικόνα

Το HyperClaw υποστηρίζει API keys για:

| Κατηγορία | Παραδείγματα |
|-----------|--------------|
| **AI Providers** | Anthropic, OpenAI, OpenRouter, Google, xAI |
| **Skills** | Tavily, DeepL, GitHub, OpenWeather, Home Assistant |
| **Channels** | Telegram, Discord, Slack (bot tokens) |
| **Bug bounty / Custom** | HackerOne, Bugcrowd, Synack, **οποιαδήποτε εφαρμογή με API key** |
| **Talk Mode** | ElevenLabs |
| **Gateway** | authToken για remote access |

Όλα τα keys αποθηκεύονται ασφαλώς (file mode 0o600) και μπορούν να προστεθούν μέσω:

- **Wizard (onboard/init/quickstart)** — interactive κατά το setup
- **CLI** — `hyperclaw auth add`, `hyperclaw config set-service-key`, `hyperclaw secrets set`
- **Env vars** — για CI/CD ή προηγμένη χρήση

---

## Πώς το Wizard παίρνει API keys

Το `HyperClawWizard` (`src/cli/onboard.ts`) συλλέγει keys σε διάφορα βήματα:

### 1. AI Provider (`selectProviderAndModel`)

- Επιλογή provider (Anthropic, OpenAI, OpenRouter, κλπ.)
- Αν `authType === 'api_key'`: `inquirer.prompt` με `type: 'password'`, `mask: '●'`
- Αν custom: `baseUrl`, `apiKey`, `modelId`
- Αποθήκευση: `provider.apiKey` στο config

### 2. Service API Keys (`configureServiceApiKeys`)

```
🔑 Service API Keys — οποιοδήποτε app με API key

Αποθηκεύονται ασφαλώς στο config. Πώς λειτουργούν:
  • Wizard: εδώ προσθέτεις keys
  • Config: ~/.hyperclaw/hyperclaw.json → skills.apiKeys
  • Env: HACKERONE_*, BUGCROWD_*, SYNACK_*, ή CUSTOM_ID_API_KEY
  • Tools: τα built-in tools τα διαβάζουν αυτόματα για research
```

**Known services (checkbox):**

| ID | Όνομα | Hint |
|----|-------|------|
| `hackerone` | HackerOne | username:token (Basic auth) |
| `bugcrowd` | Bugcrowd | Token από Bugcrowd API Credentials |
| `synack` | Synack | API token από Synack |
| `__custom__` | Άλλο (custom) | Οποιαδήποτε εφαρμογή με API key |

- Αν επιλεγεί custom: `customId` (π.χ. my-app, ads-power) + `customKey`
- Αποθήκευση: `skills.apiKeys[customId]` στο config

### 3. Talk Mode (`configureTalkMode`)

- ElevenLabs API key
- Αποθήκευση: `talkMode.apiKey`

### 4. Channels (`selectChannels`)

- Bot tokens (Telegram, Discord, κλπ.)
- Αποθήκευση: `channelConfigs[channelId].token`

### 5. Gateway Auth Token (`configureGateway`)

- `authToken` — blank = auto-generate
- Αποθήκευση: `gateway.authToken`

### 6. HyperClaw Bot (`configureHyperClawBot`)

- Telegram Bot token για remote control
- Αποθήκευση: `~/.hyperclaw/` (hyperclawbot config)

---

## Πού αποθηκεύονται τα keys

| Πηγή | Θέση αποθήκευσης |
|------|-------------------|
| Wizard → provider | `~/.hyperclaw/hyperclaw.json` → `provider.apiKey` |
| Wizard → service keys (HackerOne, Bugcrowd, custom) | `~/.hyperclaw/hyperclaw.json` → `skills.apiKeys` |
| Wizard → talk mode | `~/.hyperclaw/hyperclaw.json` → `talkMode.apiKey` |
| Wizard → channels | `~/.hyperclaw/hyperclaw.json` → `channelConfigs[ch].token` |
| Wizard → gateway | `~/.hyperclaw/hyperclaw.json` → `gateway.authToken` |
| `hyperclaw auth add` | `~/.hyperclaw/credentials/<service_id>.json` + `~/.hyperclaw/.env` |
| `hyperclaw config set-service-key` | `~/.hyperclaw/hyperclaw.json` → `skills.apiKeys` |
| `hyperclaw secrets set KEY=val` | `~/.hyperclaw/.env` |

### Merge στο save

Στο `saveAll()` του wizard:

```ts
// src/cli/onboard.ts
const skillsPatch = { installed: current?.skills?.installed || [] };
if (data.serviceApiKeys && Object.keys(data.serviceApiKeys).length > 0) {
  skillsPatch.apiKeys = { ...(current?.skills?.apiKeys || {}), ...data.serviceApiKeys };
}
```

Νέα keys συγχωνεύονται με υπάρχουσες χωρίς αντικατάσταση.

---

## Τρόποι προσθήκης keys

### 1. `hyperclaw auth add <service_id>`

Για **οποιαδήποτε** υπηρεσία (skills, providers, custom apps):

```bash
hyperclaw auth add <service_id>              # Ζητάει το key interactively
hyperclaw auth add tavily --key tvly-xxx     # Με --key
hyperclaw auth add my-api --key sk-xxx --base-url https://api.example.com
hyperclaw auth remove <service_id>           # Αφαίρεση
```

- Αποθηκεύει σε `~/.hyperclaw/credentials/<service_id>.json` (mode 0o600)
- Γράφει στο `.env` τη γραμμή `<SERVICE_ID>_API_KEY=...`
- Αν η υπηρεσία είναι γνωστή (api-keys-guide.ts), εμφανίζει βήματα setup

### 2. `hyperclaw config set-service-key <serviceId> [apiKey]`

Για service keys (HackerOne, Bugcrowd, Synack, custom):

```bash
hyperclaw config set-service-key hackerone
hyperclaw config set-service-key my-app sk-xxx
```

- Αποθηκεύει στο `skills.apiKeys` του config
- Τα tools τα διαβάζουν από config ή env

### 3. `hyperclaw secrets set KEY=value`

Για env vars (όλα τα known secrets):

```bash
hyperclaw secrets set TAVILY_API_KEY=tvly-xxx
hyperclaw secrets apply   # Γράφει σε ~/.bashrc, ~/.zshrc
hyperclaw secrets reload  # Reload στο running gateway
```

### 4. `hyperclaw config set-key KEY=value`

Για provider keys (AuthStore).

---

## Skills & requiresKeys

Τα skills δηλώνουν τι χρειάζονται μέσω `requiresKeys` (`src/plugins/hub.ts`):

| Skill | requiresKeys |
|-------|--------------|
| web-search | `TAVILY_API_KEY` |
| calendar | `GOOGLE_CALENDAR_CREDS` |
| github | `GITHUB_TOKEN` |
| home-assistant | `HA_URL`, `HA_TOKEN` |
| translator | `DEEPL_API_KEY` |
| weather | `OPENWEATHER_API_KEY` |
| db-reader | `DATABASE_URL` |

Το `KNOWN_SECRETS` στο `src/secrets/manager.ts` mapάρει env vars → `requiredBy`:

```ts
{ key: 'TAVILY_API_KEY',    requiredBy: ['web-search'] },
{ key: 'DEEPL_API_KEY',     requiredBy: ['translator'] },
{ key: 'GITHUB_TOKEN',      requiredBy: ['github'] },
// ...
```

Έλεγχος: `hyperclaw secrets audit [--required-by web-search,github]`

---

## Ροή διαβάσματος από tools

1. **Provider key**: `config.provider.apiKey` ή `process.env.ANTHROPIC_API_KEY` κλπ.
2. **Skill keys**: `process.env.TAVILY_API_KEY` κλπ. (από credentials store → .env ή auth add)
3. **Service keys (bug bounty / custom)**: `config.skills.apiKeys[serviceId]` ή `process.env.HACKERONE_API_KEY` κλπ.
4. **Talk mode**: `config.talkMode.apiKey` ή `ELEVENLABS_API_KEY`

Προτεραιότητα: env var > config (ανάλογα με το component).

---

## Αναλυτικά paths & formats

### Config: `~/.hyperclaw/hyperclaw.json`

```json
{
  "provider": { "providerId": "anthropic", "apiKey": "sk-ant-...", "modelId": "claude-3-5-sonnet" },
  "gateway": { "port": 18789, "authToken": "...", "bind": "127.0.0.1" },
  "skills": {
    "installed": ["web-search", "github"],
    "apiKeys": {
      "hackerone": "user:token",
      "bugcrowd": "token",
      "my-custom-app": "sk-xxx"
    }
  },
  "talkMode": { "apiKey": "...", "voiceId": "21m00Tcm4TlvDq8ikWAM" },
  "channelConfigs": {
    "telegram": { "token": "..." }
  }
}
```

### Credentials: `~/.hyperclaw/credentials/<service_id>.json`

```json
{
  "providerId": "tavily",
  "apiKey": "tvly-xxx",
  "baseUrl": "https://api.tavily.com",
  "updatedAt": "2025-03-03T..."
}
```

### Env: `~/.hyperclaw/.env`

```
TAVILY_API_KEY=tvly-xxx
HACKERONE_API_KEY=user:token
MY_APP_API_KEY=sk-xxx
```

---

## Αξίζει να επεκταθεί;

- Το σύστημα **ήδη υποστηρίζει οποιαδήποτε εφαρμογή με API key** (custom στο wizard, `auth add`, `config set-service-key`).
- Προσθήκες που θα μπορούσαν να γίνουν:
  - Περισσότερα known services στο wizard (εκτός HackerOne/Bugcrowd/Synack)
  - Περισσότερα guides στο `api-keys-guide.ts`
  - Οπτιonal migration: skills keys από config → credentials store (πιο ασφαλές)
  - UI / dashboard για διαχείριση keys

Για περισσότερα: `docs/security.md`, `docs/configuration.md`, `src/infra/api-keys-guide.ts`.
