import "server-only";
import { emit } from "@/lib/social/notifications/emit";

export async function onFollow(args: {
  followerId: string;
  followedId: string;
}): Promise<void> {
  await emit({
    type: "new_follower",
    recipientUserId: args.followedId,
    actorUserId: args.followerId,
    targetId: args.followerId, // target = the new follower's id (clickable to their profile)
  });
}
