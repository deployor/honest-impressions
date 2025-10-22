<div align="center">

# Honest Impressions Bot

Anonymous Slack replies with moderation.

[![Bun](https://img.shields.io/badge/Bun-000000?style=flat&logo=bun&logoColor=white)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![Biome](https://img.shields.io/badge/Biome-60A5FA?style=flat&logo=biome&logoColor=white)](https://biomejs.dev/) [![Drizzle ORM](https://img.shields.io/badge/Drizzle-C5F74F?style=flat&logo=drizzle&logoColor=black)](https://orm.drizzle.team/) [![Slack Bolt](https://img.shields.io/badge/Slack_Bolt-4A154B?style=flat&logo=slack&logoColor=white)](https://slack.dev/bolt-js/) [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

## How It Works

Users can reply anonymously to threads. All replies go to a review channel first where admins approve or deny them before they're posted.

### Pending Review

When someone submits an honest anonymous impression, it appears in the review channel:

![Pending Review](https://i.postimg.cc/Jn9CTWjF/Clean-Shot-2025-10-22-at-00-18-35.png)

Moderators can approve or deny the message. They can also ban users by their hash.

### Ban a User

Ban a user:

![User Banned](https://i.postimg.cc/4NfBrSw7/Clean-Shot-2025-10-22-at-00-14-25.png)

### Unban a User

Remove a ban to allow the user to submit replies again:

![User Unbanned](https://i.postimg.cc/V6tVk0bX/Clean-Shot-2025-10-22-at-00-15-08.png)

### List All Bans

View all currently banned hashes with their reasons:

![Ban List](https://i.postimg.cc/2ypgQ7fJ/Clean-Shot-2025-10-22-at-00-15-49.png)

## Setup

Create a Slack app using [`manifest.yml`](manifest.yml), then:

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

All commands are admin-only, which are set in .env!

- `/hi-ban <hash> [reason]` - Ban a user by their hash
- `/hi-unban <hash>` - Remove a ban
- `/hi-list-bans` - Show all banned hashes

---

<div align="center">

Made with ❤️ for [Hack Club](https://hackclub.com)

</div>
