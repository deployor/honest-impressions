<div align="center">

# Honest Impressions Bot

Anonymous Slack replies with moderation.

[![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Biome](https://img.shields.io/badge/Biome-60A5FA?style=flat&logo=biome&logoColor=white)](https://biomejs.dev/) [![Drizzle ORM](https://img.shields.io/badge/Drizzle-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/) [![Slack Bolt](https://img.shields.io/badge/Slack_Bolt-4A154B?style=flat&logo=slack&logoColor=white)](https://slack.dev/bolt-js/) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

## How It Works

Users can reply anonymously to threads. All replies go to a review channel first where admins approve or deny them before they're posted.

### Review Workflow

When someone submits an honest impression, it appears in the review channel as pending:

![Pending Review](https://i.postimg.cc/pVSxgGtF/Pending.jpg)

Admins can approve the message:

![Approved Message](https://i.postimg.cc/440ZrLTY/Approved.jpg)

Or deny it:

![Denied Message](https://i.postimg.cc/NGnYWJw9/Denied.jpg)

### Ban Management

Click "Ban User" on any review message to ban someone. The system assigns a random Case ID for privacy, this case is also shown to the user when they try to submit again:

![Ban Review](https://i.postimg.cc/pVSxgGtn/Ban-Review.jpg)

To make sure everyone notices a ban, the bot posts a message user with the Case ID:

![Ban Message](https://i.postimg.cc/DfNFtjK4/Ban-Message.jpg)

### Unban a User

Navigate to the review message (linked in ban notifications) and click "Unban User" to unban them.

### List All Bans

View all currently banned users with `/hi-list-bans`:

![Ban List](https://i.postimg.cc/0Qm3FfGR/Clean-Shot-2025-10-23-at-11-06-35.png)

## Setup

Create a Slack app using [`manifest.yml`](manifest.yml), set which channels are allowed in env then:

```bash
bun install
cp .env.example .env
# Generate a secure salt for HASH_SALT
openssl rand -base64 32
# Configure .env with your Slack tokens, database, admins, and the generated salt
bun run db:push
bun start
```

## Commands

All things are admin only (configured via `ADMIN_USER_IDS` in `.env`):

- `/hi-list-bans` - Show all banned users with their Case IDs

---

<div align="center">

Made with ❤️ for [Hack Club](https://hackclub.com)

</div>