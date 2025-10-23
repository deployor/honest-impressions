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

const buildThreadLink = async (client: any, channelId: string, threadTs: string) => {
	const team = await client.team.info();
	const domain = team.team?.domain || "slack";
	return `https://${domain}.slack.com/archives/${channelId}/p${threadTs.replace(".", "")}`;
};

const extractThreadLink = (blocks: any[] | undefined): string => {
	if (!blocks) return "#";
	const contextBlock = blocks.find((b: any) =>
		b.type === "context" && b.elements?.[0]?.text?.includes("View thread")
	);
	if (contextBlock?.elements?.[0]?.text) {
		const match = String(contextBlock.elements[0].text).match(/https:\/\/[^\|>]+/);
		if (match) return match[0];
	}
	return "#";
};

const buildReviewBlocks = (text: string, threadLink: string, banInfo: any = null) => {
	const blocks: any[] = [
		{
			type: "context",
			elements: [{
				type: "mrkdwn",
				text: `:ms-thinking: *PENDING* · <${threadLink}|View thread>`,
			}],
		},
	];

	if (banInfo) {
		blocks.push({
			type: "context",
			elements: [{
				type: "mrkdwn",
				text: `:ms-war-hammer: User banned (Case #${banInfo.caseId}) by <@${banInfo.bannedBy}> - ${banInfo.reason}`,
			}],
		});
	}

	blocks.push(
		{ type: "divider" },
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `>${text.split("\n").join("\n>")}`,
			},
		},
		{ type: "divider" }
	);

	return blocks;
};

const updateReviewMessage = (status: string, reviewer: string, threadLink: string, text: string, banInfo: any = null) => {
	const statusEmojis: Record<string, string> = {
		approved: ":ms-green-tick: *APPROVED*",
		denied: ":ms-no: *DENIED*",
	};

	const blocks: any[] = [
		{
			type: "context",
			elements: [{
				type: "mrkdwn",
				text: `${statusEmojis[status]} by <@${reviewer}> · <${threadLink}|View thread>`,
			}],
		},
	];

	if (banInfo) {
		blocks.push({
			type: "context",
			elements: [{
				type: "mrkdwn",
				text: `:ms-war-hammer: User banned (Case #${banInfo.caseId}) by <@${banInfo.bannedBy}> - ${banInfo.reason}`,
			}],
		});
	}

	blocks.push(
		{ type: "divider" },
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `>${text.split("\n").join("\n>")}`,
			},
		},
		{ type: "divider" }
	);

	return blocks;
};

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
	const banInfo = await db.getBanInfo(userHash);
	if (banInfo) {
		await client.chat.postEphemeral({
			channel: shortcut.channel.id,
			user: shortcut.user.id,
			text: `:ms-no-entry: You've been banned from using this bot (Case #${banInfo.caseId}). If you believe this is a mistake, please contact an admin. Don't even try to post :ms-expressionless:`,
		});
		return;
	}

	await client.views.open({
		trigger_id: shortcut.trigger_id,
		view: {
			type: "modal",
			callback_id: "reply_modal",
			title: { type: "plain_text", text: ":ms-thinking: Honest Impressions", emoji: true },
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
	const threadLink = await buildThreadLink(client, channelId, threadTs);
	const reviewBlocks = buildReviewBlocks(text || "", threadLink, banInfo);

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
			value: msg.id.toString(),
		});
	}

	reviewBlocks.push({ type: "actions", elements: buttons });

	await client.chat.postMessage({
		channel: REVIEW_CHANNEL,
		text: "New honest impression",
		blocks: reviewBlocks,
	});
});

app.action("approve", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;

	if (!ADMINS.includes(body.user.id)) {
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

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
	const threadLink = await buildThreadLink(client, msg.channelId, msg.threadTs);
	const blocks = updateReviewMessage("approved", body.user.id, threadLink, msg.text, banInfo);

	await client.chat.update({
		channel: action.channel.id,
		ts: action.message.ts,
		text: ":ms-smiley: Approved and posted!",
		blocks,
	});
});

app.action("deny", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;

	if (!ADMINS.includes(body.user.id)) {
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

	const msgId = Number.parseInt(action.actions[0].value);
	const msg = await db.getMessage(msgId);

	if (!msg || msg.status !== "pending") return;

	await db.denyMessage(msgId, body.user.id);

	const banInfo = await db.getBanInfo(msg.userHash);
	const threadLink = await buildThreadLink(client, msg.channelId, msg.threadTs);
	const blocks = updateReviewMessage("denied", body.user.id, threadLink, msg.text, banInfo);

	await client.chat.update({
		channel: action.channel.id,
		ts: action.message.ts,
		text: ":ms-no: Denied",
		blocks,
	});
});

app.action("ban_user", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;
	const msgId = Number.parseInt(action.actions[0].value);
	const msg = await db.getMessage(msgId);
	
	if (!msg) {
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
			text: ":ms-worried: Message not found...",
		});
		return;
	}
	
	const userHash = msg.userHash;

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
			title: { type: "plain_text", text: ":ms-war-hammer: Ban User", emoji: true },
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `${warning}You are about to ban this user. Please provide a reason.`,
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

	const getMessageId = async () => {
		if (!messageTs || !channelId) return undefined;
		try {
			const history = await client.conversations.history({
				channel: channelId,
				latest: messageTs,
				limit: 1,
				inclusive: true,
			});
			const msg = history.messages?.[0];
			return msg?.blocks?.find((b: any) =>
				b.type === "actions" && b.elements?.[0]?.value
			)?.elements?.[0]?.value;
		} catch (err) {
			console.error("Failed to fetch message for ID:", err);
			return undefined;
		}
	};

	try {
		const storedMessageId = await getMessageId();
		const caseId = await db.ban(userHash, body.user.id, reason);
		const reviewLink = await buildThreadLink(client, channelId, messageTs);

		await client.chat.postMessage({
			channel: REVIEW_CHANNEL,
			text: `:ms-war-hammer: User banned (Case #${caseId})`,
			blocks: [
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-war-hammer: *User Banned*\nCase ID: #${caseId}\nBanned by: <@${body.user.id}>\nReason: ${reason}\n\n<${reviewLink}|View review message to unban>`,
					},
				},
			],
		});

		if (messageTs && channelId && storedMessageId) {
			try {
				const msgId = Number.parseInt(storedMessageId);
				const dbMsg = await db.getMessage(msgId);
				if (dbMsg?.status === "pending") {
					await db.denyMessage(msgId, body.user.id);
				}

				const history = await client.conversations.history({
					channel: channelId,
					latest: messageTs,
					limit: 1,
					inclusive: true,
				});

				const msg = history.messages?.[0];
				if (msg) {
					const threadLink = extractThreadLink(msg.blocks);
					const contentBlock = msg.blocks?.find((b: any) => b.type === "section" && b.text);

					const updatedBlocks: any[] = [
						{
							type: "context",
							elements: [{
								type: "mrkdwn",
								text: `:ms-no: *DENIED* (user banned) by <@${body.user.id}> · <${threadLink}|View thread>`,
							}],
						},
						{
							type: "context",
							elements: [{
								type: "mrkdwn",
								text: `:ms-war-hammer: User banned (Case #${caseId}) by <@${body.user.id}> - ${reason}`,
							}],
						},
						{ type: "divider" },
					];

					if (contentBlock) updatedBlocks.push(contentBlock);
					updatedBlocks.push(
						{ type: "divider" },
						{
							type: "actions",
							elements: [{
								type: "button",
								text: { type: "plain_text", text: "Unban User" },
								action_id: "unban_user_from_review",
								value: `${caseId}|${storedMessageId}|${messageTs}|${channelId}`,
							}],
						}
					);

					await client.chat.update({
						channel: channelId,
						ts: messageTs,
						text: "User banned and message denied",
						blocks: updatedBlocks,
					});
				}
			} catch (err) {
				console.error("Failed to update original message:", err);
			}
		}
	} catch (error: any) {
		if (error?.code === "23505" || error?.constraint_name === "banned_users_user_hash_unique") {
			await db.unban(userHash);
			const newCaseId = await db.ban(userHash, body.user.id, reason);
			const reviewLink = await buildThreadLink(client, channelId, messageTs);

			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-mild-panic: User re-banned (Case #${newCaseId})`,
				blocks: [{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-mild-panic: *User Re-Banned*\nNew Case ID: #${newCaseId}\nThis user was already banned, but the ban has been updated.\nUpdated by: <@${body.user.id}>\nNew reason: ${reason}\n\n<${reviewLink}|View review message to unban>`,
					},
				}],
			});
		} else {
			console.error("Ban error:", error);
			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-crt-test-pattern: Failed to ban user - <@${body.user.id}> please check logs`,
				blocks: [{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-crt-test-pattern: *Ban Failed*\nAttempted by: <@${body.user.id}>\nError: ${error?.message || "Unknown error"}`,
					},
				}],
			});
		}
	}
});

app.action("unban_user_from_review", async ({ ack, body, client }) => {
	await ack();
	const action = body as any;
	const [caseId, msgId, messageTs, channelId] = action.actions[0].value.split("|");

	if (!ADMINS.includes(body.user.id)) {
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
			text: ":ms-stop-sign: You don't look like an admin to me...",
		});
		return;
	}

	try {
		const ban = await db.unbanByCaseId(caseId);

		if (ban) {
			await client.chat.postMessage({
				channel: REVIEW_CHANNEL,
				text: `:ms-slight-smile: User unbanned (Case #${caseId})`,
				blocks: [{
					type: "section",
					text: {
						type: "mrkdwn",
						text: `:ms-slight-smile: *User Unbanned*\nCase ID: #${caseId}\nUnbanned by: <@${body.user.id}>\nThey've been given another chance.`,
					},
				}],
			});

			try {
				const history = await client.conversations.history({
					channel: channelId,
					latest: messageTs,
					limit: 1,
					inclusive: true,
				});

				const msg = history.messages?.[0];
				if (msg) {
					const threadLink = extractThreadLink(msg.blocks);
					const contentBlock = msg.blocks?.find((b: any) => b.type === "section" && b.text);

					const updatedBlocks: any[] = [
						{
							type: "context",
							elements: [{
								type: "mrkdwn",
								text: `:ms-no: *DENIED* by <@${body.user.id}> · <${threadLink}|View thread>`,
							}],
						},
						{ type: "divider" },
					];

					if (contentBlock) updatedBlocks.push(contentBlock);
					updatedBlocks.push(
						{ type: "divider" },
						{
							type: "actions",
							elements: [{
								type: "button",
								text: { type: "plain_text", text: "Ban User" },
								action_id: "ban_user",
								value: msgId,
							}],
						}
					);

					await client.chat.update({
						channel: channelId,
						ts: messageTs,
						text: "User unbanned",
						blocks: updatedBlocks,
					});
				}
			} catch (err) {
				console.error("Failed to update review message:", err);
			}
		} else {
			await client.chat.postEphemeral({
				channel: action.channel.id,
				user: body.user.id,
				text: `:ms-worried: Case #${caseId} not found in ban list...`,
			});
		}
	} catch (error: any) {
		console.error("Unban error:", error);
		await client.chat.postEphemeral({
			channel: action.channel.id,
			user: body.user.id,
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

	const MAX_MSG_LENGTH = 2500;
	const header = `:ms-monocle: *Banned Users (${bans.length} total)*\n\n`;
	let msgBuffer = "";

	for (let i = 0; i < bans.length; i++) {
		const ban = bans[i];
		const line = `${i + 1}. Case #${ban.caseId}\n   Banned: ${new Date(ban.bannedAt).toLocaleDateString()}\n   By: ${ban.bannedBy ? `<@${ban.bannedBy}>` : "Unknown"}\n   Reason: ${ban.reason || "N/A"}\n\n`;

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
