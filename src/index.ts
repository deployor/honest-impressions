import { pbkdf2Sync } from "node:crypto";
import { App } from "@slack/bolt";
import * as db from "./db";

const app = new App({
	token: process.env.SLACK_BOT_TOKEN,
	signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const REVIEW_CHANNEL = process.env.REVIEW_CHANNEL_ID!;
const ADMINS = process.env.ADMIN_USER_IDS!.split(",");
const SALT = process.env.HASH_SALT!;

const hashUser = (userId: string): string =>
	pbkdf2Sync(userId, SALT, 100000, 32, "sha256").toString("hex");

app.shortcut("reply_impression", async ({ ack, body, client }) => {
	await ack();
	const shortcut = body as any;

	if (!shortcut.message.thread_ts) {
		await client.chat.postEphemeral({
			channel: shortcut.channel.id,
			user: shortcut.user.id,
			text: ":ms-no: You can't start a thread with this, but you can contribute to an existing one! :ms-slight-smile:",
		});
		return;
	}

	const userHash = hashUser(shortcut.user.id);
	if (await db.getBanInfo(userHash)) {
		await client.chat.postEphemeral({
			channel: shortcut.channel.id,
			user: shortcut.user.id,
			text: ":ms-no-entry: You've been banned from using this bot, if you believe this is a mistake, please contact an admin. Don't even try :ms-expressionless:",
		});
		return;
	}

	await client.views.open({
		trigger_id: shortcut.trigger_id,
		view: {
			type: "modal",
			callback_id: "reply_modal",
			title: { type: "plain_text", text: "Honest Impressions Reply" },
			blocks: [
				{
					type: "input",
					block_id: "msg",
					label: { type: "plain_text", text: "Honestly I think..." },
					element: {
						type: "plain_text_input",
						action_id: "text",
						multiline: true,
						placeholder: {
							type: "plain_text",
							text: "Share your honest thoughts here...",
						},
					},
				},
			],
			submit: { type: "plain_text", text: "Submit" },
			private_metadata: `${shortcut.message.thread_ts}|${shortcut.channel.id}`,
		},
	});
});

app.view("reply_modal", async ({ ack, body, view, client }) => {
	await ack();
	const [threadTs, channelId] = view.private_metadata.split("|");
	const text = view.state.values.msg.text.value;
	const userHash = hashUser(body.user.id);

	if (await db.getBanInfo(userHash)) return;

	const msg = await db.createMessage({
		userHash,
		text: text || "",
		channelId,
		threadTs,
	});

	const banInfo = await db.getBanInfo(userHash);

	const reviewBlocks: any[] = [
		{
			type: "section",
			text: { type: "mrkdwn", text: `:ms-envelope-with-arrow: ${text}` },
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: ":ms-thinking: Pending review..." }],
		},
	];

	if (banInfo) {
		reviewBlocks.push({
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: `:ms-war-hammer: User banned by <@${banInfo.bannedBy}> - ${banInfo.reason}`,
				},
			],
		});
	}

	reviewBlocks.push({
		type: "context",
		elements: [{ type: "mrkdwn", text: `_${userHash}_` }],
	});

	const buttons: any[] = [
		{
			type: "button",
			text: { type: "plain_text", text: "Approve" },
			style: "primary",
			action_id: "approve",
			value: msg.id.toString(),
		},
		{
			type: "button",
			text: { type: "plain_text", text: "Deny" },
			style: "danger",
			action_id: "deny",
			value: msg.id.toString(),
		},
	];

	if (ADMINS.some((id) => id.trim())) {
		buttons.push({
			type: "button",
			text: { type: "plain_text", text: "Ban User" },
			action_id: "ban_user",
			value: userHash,
		});
	}

	reviewBlocks.push({ type: "actions", elements: buttons });

	await client.chat.postMessage({
		channel: REVIEW_CHANNEL,
		text: "New reply",
		blocks: reviewBlocks,
	});
});

app.action("approve", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;
	const msgId = Number.parseInt(action.actions[0].value);
	const msg = await db.getMessage(msgId);

	if (!msg || msg.status !== "pending") return;

	const posted = await client.chat.postMessage({
		channel: msg.channelId,
		thread_ts: msg.threadTs,
		text: msg.text,
	});

	await db.approveMessage(msgId, body.user.id, posted.ts);

	const banInfo = await db.getBanInfo(msg.userHash);

	const updatedBlocks: any[] = [
		{
			type: "section",
			text: { type: "mrkdwn", text: `:ms-envelope-with-arrow: ${msg.text}` },
		},
		{
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: `:ms-green-tick: Approved by <@${body.user.id}>`,
				},
			],
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: `_${msg.userHash}_` }],
		},
	];

	if (banInfo) {
		updatedBlocks.push({
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: `:ms-war-hammer: User banned by <@${banInfo.bannedBy}> - Reason: ${banInfo.reason}`,
				},
			],
		});
	}

	await client.chat.update({
		channel: action.channel.id,
		ts: action.message.ts,
		text: ":ms-smiley: Approved and posted!",
		blocks: updatedBlocks,
	});
});

app.action("deny", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;
	const msgId = Number.parseInt(action.actions[0].value);
	const msg = await db.getMessage(msgId);

	if (!msg || msg.status !== "pending") return;

	await db.denyMessage(msgId, body.user.id);

	const banInfo = await db.getBanInfo(msg.userHash);

	const updatedBlocks: any[] = [
		{
			type: "section",
			text: { type: "mrkdwn", text: `:ms-envelope-with-arrow: ${msg.text}` },
		},
		{
			type: "context",
			elements: [
				{ type: "mrkdwn", text: `:ms-no: Denied by <@${body.user.id}>` },
			],
		},
		{
			type: "context",
			elements: [{ type: "mrkdwn", text: `_${msg.userHash}_` }],
		},
	];

	if (banInfo) {
		updatedBlocks.push({
			type: "context",
			elements: [
				{
					type: "mrkdwn",
					text: `:ms-war-hammer: User banned by <@${banInfo.bannedBy}> - Reason: ${banInfo.reason}`,
				},
			],
		});
	}

	await client.chat.update({
		channel: action.channel.id,
		ts: action.message.ts,
		text: ":ms-no: Denied",
		blocks: updatedBlocks,
	});
});

app.action("ban_user", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;
	const userHash = action.actions[0].value;

	if (!ADMINS.includes(body.user.id)) {
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

	const existingBan = await db.getBanInfo(userHash);
	const warning = existingBan
		? ":ms-anguished: **Warning**: This user is already banned!\nYou can still ban them again with a new reason if needed.\n\n"
		: "";

	await client.views.open({
		trigger_id: action.trigger_id,
		view: {
			type: "modal",
			callback_id: "ban_modal",
			title: { type: "plain_text", text: "Ban User" },
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `${warning}Ban user with hash:\n\`${userHash}\``,
					},
				},
				{
					type: "input",
					block_id: "reason",
					label: { type: "plain_text", text: "Reason" },
					element: {
						type: "plain_text_input",
						action_id: "text",
						placeholder: {
							type: "plain_text",
							text: "Why are you banning this user?",
						},
					},
				},
			],
			submit: { type: "plain_text", text: "Ban" },
			private_metadata: `${userHash}|${action.message.ts}|${action.channel.id}`,
		},
	});
});

app.view("ban_modal", async ({ ack, body, view, client }) => {
	await ack();
	const [userHash, messageTs, channelId] = view.private_metadata.split("|");
	const reason = view.state.values.reason.text.value || "No reason";

	try {
		await db.ban(userHash, body.user.id, reason);

		await client.chat.postMessage({
			channel: REVIEW_CHANNEL,
			text: `:ms-war-hammer: User banned by <@${body.user.id}>`,
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-war-hammer: *User Banned*\nBanned by: <@${body.user.id}>\nReason: ${reason}`,
					},
				},
				{
					type: "context",
					elements: [{ type: "mrkdwn", text: `Hash: \`${userHash}\`` }],
				},
			],
		});

		if (messageTs && channelId) {
			try {
				const history = await client.conversations.history({
					channel: channelId,
					latest: messageTs,
					limit: 1,
					inclusive: true,
				});

				if (history.messages?.[0]) {
					const currentBlocks = history.messages[0].blocks || [];

					const existingBanIdx = currentBlocks.findIndex((b: any) =>
						b.elements?.[0]?.text?.includes("User banned by"),
					);

					const banContext = {
						type: "context",
						elements: [
							{
								type: "mrkdwn",
								text: `:ms-war-hammer: User banned by <@${body.user.id}> - Reason: ${reason}`,
							},
						],
					};

					let updatedBlocks: any[];
					if (existingBanIdx >= 0) {
						updatedBlocks = [...currentBlocks];
						updatedBlocks[existingBanIdx] = banContext;
					} else {
						updatedBlocks = [...currentBlocks, banContext];
					}

					await client.chat.update({
						channel: channelId,
						ts: messageTs,
						text: "User banned",
						blocks: updatedBlocks,
					});
				}
			} catch (err) {
				console.error("Failed to update original message:", err);
			}
		}
	} catch (error: any) {
		if (
			error?.code === "23505" ||
			error?.constraint_name === "banned_users_user_hash_unique"
		) {
			await db.unban(userHash);
			await db.ban(userHash, body.user.id, reason);

			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-mild-panic: User re-banned by <@${body.user.id}>`,
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `:ms-mild-panic: *User Re-Banned*\nThis user was already banned, but the ban has been updated.\nUpdated by: <@${body.user.id}>\nNew reason: ${reason}`,
						},
					},
					{
						type: "context",
						elements: [{ type: "mrkdwn", text: `Hash: \`${userHash}\`` }],
					},
				],
			});
		} else {
			console.error("Ban error:", error);
			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-crt-test-pattern: Failed to ban user - <@${body.user.id}> please check logs`,
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `:ms-crt-test-pattern: *Ban Failed*\nAttempted by: <@${body.user.id}>\nError: ${error?.message || "Unknown error"}`,
						},
					},
				],
			});
		}
	}
});

app.command("/hi-ban", async ({ ack, command, client }) => {
	await ack();
	if (!ADMINS.includes(command.user_id)) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

	const [userHash, ...reasonParts] = command.text.trim().split(/\s+/);
	const reason = reasonParts.join(" ") || "No reason";

	if (!userHash || userHash.length !== 64) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: ":ms-anguished: Usage: `/hi-ban <hash> [reason]`\n\nThe hash looks invalid!",
		});
		return;
	}

	try {
		await db.ban(userHash, command.user_id, reason);

		await client.chat.postMessage({
			channel: REVIEW_CHANNEL,
			text: `:ms-war-hammer: User banned by <@${command.user_id}>`,
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-war-hammer: *User Banned*\nBanned by: <@${command.user_id}>\nReason: ${reason}`,
					},
				},
				{
					type: "context",
					elements: [{ type: "mrkdwn", text: `Hash: \`${userHash}\`` }],
				},
			],
		});
	} catch (error: any) {
		if (
			error?.code === "23505" ||
			error?.constraint_name === "banned_users_user_hash_unique"
		) {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: command.user_id,
				text: ":ms-anguished: That user is already banned!\nUse `/hi-list-bans` to see all bans.",
			});
		} else {
			console.error("Ban error:", error);
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: command.user_id,
				text: `:ms-crt-test-pattern: Failed to ban user!\nError: ${error?.message || "Unknown error"}`,
			});
		}
	}
});

app.command("/hi-unban", async ({ ack, command, client }) => {
	await ack();
	if (!ADMINS.includes(command.user_id)) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

	const userHash = command.text.trim();
	if (!userHash || userHash.length !== 64) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: ":ms-anguished: Usage: `/hi-unban <hash>`\n\nThe hash looks invalid!",
		});
		return;
	}

	try {
		const removed = await db.unban(userHash);

		if (removed) {
			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-slight-smile: User unbanned by <@${command.user_id}>`,
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `:ms-slight-smile: *User Unbanned*\nUnbanned by: <@${command.user_id}>\nThey've been given another chance.`,
						},
					},
					{
						type: "context",
						elements: [{ type: "mrkdwn", text: `Hash: \`${userHash}\`` }],
					},
				],
			});
		} else {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: command.user_id,
				text: `:ms-worried: That hash wasn't in the ban list...`,
			});
		}
	} catch (error: any) {
		console.error("Unban error:", error);
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: `:ms-crt-test-pattern: Failed to unban user!\nError: ${error?.message || "Unknown error"}`,
		});
	}
});

app.command("/hi-list-bans", async ({ ack, command, client }) => {
	await ack();
	if (!ADMINS.includes(command.user_id)) return;

	const bans = await db.listBans();
	if (bans.length === 0) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: ":ms-smiley: No banned users! Everyone's behaving perfectly :ms-content:",
		});
		return;
	}

	// Slack has a limit of 3000 characters, THEORETICALLY.
	const MAX_MSG_LENGTH = 2500;
	const header = `:ms-monocle: *Banned Users (${bans.length} total)*\n\n`;

	let msgBuffer = "";

	for (let i = 0; i < bans.length; i++) {
		const ban = bans[i];
		const line = `${i + 1}. \`${ban.userHash}\`\n   Banned: ${new Date(ban.bannedAt).toLocaleDateString()}\n   By: ${ban.bannedBy ? `<@${ban.bannedBy}>` : "Unknown"}\n   Reason: ${ban.reason || "N/A"}\n\n`;

		if ((header + msgBuffer + line).length > MAX_MSG_LENGTH) {
			await client.chat.postEphemeral({
				channel: command.channel_id,
				user: command.user_id,
				text: `${header}${msgBuffer}\n_... continued in next message ..._`,
			});
			msgBuffer = "";
		}

		msgBuffer += line;
	}

	if (msgBuffer) {
		await client.chat.postEphemeral({
			channel: command.channel_id,
			user: command.user_id,
			text: `${header}${msgBuffer}`,
		});
	}
});

await app.start(process.env.PORT || 3000);
console.log("Bot running! Port: ", process.env.PORT || 3000);
