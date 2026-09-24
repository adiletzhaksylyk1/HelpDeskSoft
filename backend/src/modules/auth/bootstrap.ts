import { eq } from "drizzle-orm";
import { getDb, closeDb } from "../../db/index.js";
import { withDbLock } from "../../db/lock.js";
import { users, roles } from "../../db/schema.js";
import { UsersRepository } from "../users/users.repository.js";
import { z } from "zod";
async function bootstrap() {
  const email = z.string().email().parse(process.argv[2]).toLowerCase();
  const invitation = await withDbLock(getDb(), 740003, async (tx) => {
    const staff = await tx
      .select({ user: users, role: roles })
      .from(users)
      .innerJoin(roles, eq(users.role, roles.name));
    if (
      staff.some(
        (s) => s.role.isAdmin && s.user.isActive && s.user.passwordHash,
      )
    )
      throw new Error(
        "An initialized administrator already exists. Request an invitation from them.",
      );
    const repo = new UsersRepository(tx);
    let user = await repo.findByEmail(email);
    if (user)
      user = await repo.update(user.id, {
        role: "admin",
        isActive: true,
        name: user.name,
      });
    else
      user = await repo.create({
        name: "Administrator",
        email,
        role: "admin",
        isActive: true,
      });
    return repo.issueInvitation(user!.id);
  });
  // Intentionally printed once to the local operator, never sent to application logs.
  process.stdout.write(
    "Deliver this one-hour invitation privately to " +
      email +
      ":\n" +
      invitation +
      "\n",
  );
}
bootstrap()
  .catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  })
  .finally(closeDb);
