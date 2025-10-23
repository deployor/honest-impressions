import { eq } from "drizzle-orm";
import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client);

export const bannedUsers = pgTable("banned_users", {
	id: serial("id").primaryKey(),
	userHash: varchar("user_hash", { length: 128 }).notNull().unique(),
	caseId: varchar("case_id", { length: 16 }).notNull().unique(),
	bannedAt: timestamp("banned_at").defaultNow().notNull(),
	bannedBy: varchar("banned_by", { length: 64 }),
	reason: text("reason"),
});

export const messages = pgTable("messages", {
	id: serial("id").primaryKey(),
	userHash: varchar("user_hash", { length: 128 }).notNull(),
	text: text("text").notNull(),
	channelId: varchar("channel_id", { length: 64 }).notNull(),
	threadTs: varchar("thread_ts", { length: 64 }).notNull(),
	reviewTs: varchar("review_ts", { length: 64 }),
	status: varchar("status", { length: 20 }).notNull(),
	reviewedBy: varchar("reviewed_by", { length: 64 }),
	reviewedAt: timestamp("reviewed_at"),
	postedTs: varchar("posted_ts", { length: 64 }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

async function generateCaseId(): Promise<string> {
	let digits = 4;
	const maxAttempts = 100;

	while (digits <= 8) {
		for (let i = 0; i < maxAttempts; i++) {
			const min = 10 ** (digits - 1);
			const max = 10 ** digits - 1;
			const caseId = Math.floor(
				Math.random() * (max - min + 1) + min,
			).toString();

			const [existing] = await db
				.select()
				.from(bannedUsers)
				.where(eq(bannedUsers.caseId, caseId))
				.limit(1);

			if (!existing) return caseId;
		}
		digits++;
	}

	throw new Error("Unable to generate unique case ID");
}

export async function getBanInfo(hash: string) {
	const [result] = await db
		.select()
		.from(bannedUsers)
		.where(eq(bannedUsers.userHash, hash))
		.limit(1);
	return result || null;
}

export async function getBanByCaseId(caseId: string) {
	const [result] = await db
		.select()
		.from(bannedUsers)
		.where(eq(bannedUsers.caseId, caseId))
		.limit(1);
	return result || null;
}

export async function ban(hash: string, by: string, reason?: string) {
	const caseId = await generateCaseId();
	await db.insert(bannedUsers).values({
		userHash: hash,
		caseId,
		bannedBy: by,
		reason,
	});
	return caseId;
}

export async function unban(hash: string) {
	const result = await db
		.delete(bannedUsers)
		.where(eq(bannedUsers.userHash, hash))
		.returning();
	return result.length > 0;
}

export async function unbanByCaseId(caseId: string) {
	const result = await db
		.delete(bannedUsers)
		.where(eq(bannedUsers.caseId, caseId))
		.returning();
	return result.length > 0 ? result[0] : null;
}

export async function listBans() {
	return await db.select().from(bannedUsers);
}

export async function createMessage(data: {
	userHash: string;
	text: string;
	channelId: string;
	threadTs: string;
}) {
	const [msg] = await db
		.insert(messages)
		.values({ ...data, status: "pending" })
		.returning();
	return msg;
}

export async function getMessage(id: number) {
	const [msg] = await db
		.select()
		.from(messages)
		.where(eq(messages.id, id))
		.limit(1);
	return msg;
}

export async function approveMessage(
	id: number,
	by: string,
	postedTs?: string,
) {
	await db
		.update(messages)
		.set({
			status: "approved",
			reviewedBy: by,
			reviewedAt: new Date(),
			postedTs,
		})
		.where(eq(messages.id, id));
}

export async function denyMessage(id: number, by: string) {
	await db
		.update(messages)
		.set({
			status: "denied",
			reviewedBy: by,
			reviewedAt: new Date(),
		})
		.where(eq(messages.id, id));
}
